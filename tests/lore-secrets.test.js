import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, createDefaultState, createEntity, createOperation, loreSecretEvent, parseSecretMark, secretEntriesOf,
  selectKnowledgeLines, stripSecretEntries, validateKnowledge,
} from '../src/core/index.js';
import { loadGroupLore, matchLoreEntries } from '../src/integration/lorebooks.js';
import { parseSecretScan, scanLoreSecrets } from '../src/integration/secret-scan.js';

const ran = createEntity('Ран');
const rindo = createEntity('Риндо');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');

const SCARS = 'Под одеждой у Судзу много старых шрамов. Знает о них только Риндо: он когда-то её зашивал.';

function stateWith(operations = [], personaId = suzu.id) {
  const state = applyOperations(createDefaultState(), [
    ...[ran, rindo, suzu, mikey].map(entity => createOperation('entity.upsert', entity)),
    ...operations,
  ]);
  return { ...state, ui: { ...state.ui, personaId } };
}

const scarsEvent = (witnessIds = [rindo.id, suzu.id]) => createOperation('event.add', {
  item: { id: 'scars', text: 'Шрамы Судзу под одеждой', witnessIds, secret: true, lore: { book: 'Судзу', uid: 4 }, detail: SCARS },
});

test('the mark is read from the title, with or without names', () => {
  assert.deepEqual(parseSecretMark('[Секрет] Шрамы'), { title: 'Шрамы', names: [] });
  assert.deepEqual(parseSecretMark('  [секрет: Риндо, Санзу; Риндо] Шрамы '), { title: 'Шрамы', names: ['Риндо', 'Санзу'] });
  assert.deepEqual(parseSecretMark('[Secret]'), { title: '', names: [] });
  assert.deepEqual(parseSecretMark('[Секрет]: шрамы'), { title: 'шрамы', names: [] });
  assert.deepEqual(parseSecretMark('[Секрет: Риндо] — шрамы'), { title: 'шрамы', names: ['Риндо'] });
  assert.equal(parseSecretMark('Шрамы [Секрет]'), null, 'the mark must open the title');
  assert.equal(parseSecretMark('[Секретная база]'), null);
  assert.equal(parseSecretMark(undefined), null);
});

test('only enabled secret entries with text are picked from a book', () => {
  const book = { entries: {
    1: { uid: 1, comment: '[Секрет] Шрамы', key: ['Судзу'], content: SCARS },
    2: { uid: 2, comment: 'Судзу', key: ['Судзу'], content: 'Внешность' },
    3: { uid: 3, comment: '[Секрет] Выключен', disable: true, content: 'x' },
    4: { uid: 4, comment: '[Секрет]', key: ['тату'], content: 'Тату на спине' },
    5: { uid: 5, comment: '[Секрет] Пусто', content: '  ' },
  } };
  assert.deepEqual(secretEntriesOf(book, 'Судзу').map(entry => `${entry.uid}:${entry.title}`), ['1:Шрамы', '4:тату']);
});

test('secret entries are cut out of the lists SillyTavern scans, in place', () => {
  const globalLore = [{ uid: 1, comment: '[Секрет] Шрамы' }, { uid: 2, comment: 'Ран' }];
  const personaLore = [{ uid: 3, comment: '[secret: Риндо] тату' }];
  const lists = { globalLore, characterLore: [], chatLore: [], personaLore };
  assert.equal(stripSecretEntries(lists), 2);
  assert.equal(lists.globalLore, globalLore, 'the same array SillyTavern keeps using');
  assert.deepEqual(globalLore.map(entry => entry.uid), [2]);
  assert.deepEqual(personaLore, []);
});

test('a lore secret is one event per entry and keeps its text', () => {
  const state = stateWith([scarsEvent(), createOperation('event.add', { item: { id: 'again', text: 'Другое', lore: { book: 'Судзу', uid: '4' } } })]);
  assert.equal(state.knowledge.events.length, 1, 'the second import of entry 4 is a no-op');
  const event = loreSecretEvent(state, 'Судзу', 4);
  assert.deepEqual(event.lore, { book: 'Судзу', uid: '4' });
  assert.equal(event.detail, SCARS);
  assert.deepEqual(validateKnowledge(state.knowledge, new Set(Object.keys(state.entities))), []);
  const edited = applyOperations(state, [createOperation('event.update', { eventId: 'scars', changes: { detail: 'Новый текст' } })]);
  assert.equal(edited.knowledge.events[0].detail, 'Новый текст');
});

test('nobody on stage knows the secret: the model hears nothing about it', () => {
  const state = stateWith([scarsEvent(), createOperation('scene.set', { presentIds: [ran.id, mikey.id, suzu.id] })]);
  const lines = selectKnowledgeLines(state);
  assert.ok(!lines.some(line => /шрам/i.test(line)), lines.join('\n'));
});

test('someone on stage knows: they get the text, the others are told they do not know', () => {
  const state = stateWith([scarsEvent(), createOperation('scene.set', { presentIds: [ran.id, rindo.id, suzu.id] })]);
  const lines = selectKnowledgeLines(state);
  const secret = lines.find(line => line.startsWith('secret[Риндо]: '));
  assert.ok(secret?.includes('зашивал'), lines.join('\n'));
  assert.ok(lines.includes('unknown[Ран]: (secret) Шрамы Судзу под одеждой'), lines.join('\n'));
  assert.ok(!lines.some(line => line.startsWith('secret[Судзу]') || line.startsWith('unknown[Судзу]')), 'the persona is the user\'s to play');
  assert.ok(!lines.some(line => line.startsWith('heard[')), 'knowing by the lore is not hearsay');
});

test('a character who learns the secret on page gets its text too', () => {
  const state = stateWith([
    scarsEvent([suzu.id]),
    createOperation('learned.add', { item: { id: 'l1', eventId: 'scars', entityId: ran.id, source: 'told' } }),
    createOperation('scene.set', { presentIds: [ran.id, mikey.id, suzu.id] }),
  ]);
  const lines = selectKnowledgeLines(state);
  assert.ok(lines.some(line => line.startsWith('secret[Ран]: ')), lines.join('\n'));
  assert.ok(lines.includes('unknown[Майки]: (secret) Шрамы Судзу под одеждой'));
});

test('secrets never reach the analyzer lore or the generation lore', async () => {
  const book = { entries: {
    1: { uid: 1, comment: '[Секрет] Шрамы', key: ['Судзу'], content: SCARS },
    2: { uid: 2, comment: 'Судзу', key: ['Судзу'], content: 'Розовые волосы' },
  } };
  const state = stateWith();
  assert.deepEqual(matchLoreEntries(book, state.entities, 'Судзу').map(entry => entry.uid), [2]);
  const lore = await loadGroupLore({ loadWorldInfo: async () => book }, state, [suzu.id], { books: ['Судзу'] });
  assert.match(lore, /Розовые волосы/);
  assert.doesNotMatch(lore, /шрам/i);
});

test('the scan answer is parsed to registered characters only', () => {
  const found = parseSecretScan(JSON.stringify({ secrets: [
    { key: 's1', label: 'Шрамы Судзу', aboutId: suzu.id, knowIds: [rindo.id, 'ghost'], evidence: 'он зашивал' },
    { key: 's9', label: 'лишнее' },
  ] }), new Set(['s1']), new Set([rindo.id, suzu.id]));
  assert.deepEqual([...found.keys()], ['s1']);
  assert.deepEqual(found.get('s1').knowIds, [rindo.id]);
  assert.equal(found.get('s1').aboutId, suzu.id);
});

test('the model finds who knows; names in the title win; the persona knows her own book', async () => {
  const state = stateWith();
  const calls = [];
  const context = { async generateRaw(options) {
    calls.push(options);
    return JSON.stringify({ secrets: [
      { key: 's1', label: 'Шрамы Судзу под одеждой', aboutId: suzu.id, knowIds: [rindo.id, suzu.id], evidence: 'он когда-то её зашивал' },
      { key: 's2', label: 'Тату Рана', aboutId: ran.id, knowIds: [ran.id, mikey.id] },
    ] });
  } };
  const proposals = await scanLoreSecrets(context, state, [
    { book: 'Судзу', uid: '1', title: 'Шрамы', names: [], content: SCARS },
    { book: 'Ран', uid: '2', title: 'Тату', names: ['Риндо', 'Санзу'], content: 'Тату на спине Рана' },
  ], { personaBook: 'Судзу' });
  assert.match(calls[0].prompt[1].content, /from the persona's lorebook/);
  assert.match(calls[0].prompt[1].content, /fixed knowers: /);
  assert.deepEqual(proposals[0].knowIds, [rindo.id, suzu.id].sort());
  assert.equal(proposals[0].guessed, true);
  assert.deepEqual(proposals[1].knowIds, [ran.id, rindo.id].sort(), 'title names + whom it is about, not the model\'s Mikey');
  assert.deepEqual(proposals[1].missing, ['Санзу']);
  assert.equal(proposals[1].guessed, false);
});

test('a broken model answer still works for secrets with names in the title', async () => {
  const state = stateWith();
  const context = { generateRaw: async () => 'не JSON' };
  const [proposal] = await scanLoreSecrets(context, state, [{ book: 'Ран', uid: '2', title: 'Тату', names: ['Риндо'], content: 'Тату' }]);
  assert.equal(proposal.label, 'Тату');
  assert.deepEqual(proposal.knowIds, [rindo.id]);
  await assert.rejects(scanLoreSecrets(context, state, [{ book: 'Ран', uid: '3', title: 'Долг', names: [], content: 'Долг' }]), /\[Секрет: Риндо\]/);
});
