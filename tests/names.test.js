/** Names in any script: sound matching, the matching steps, other names from lorebooks, safe merges. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyOperations, createDefaultState, createEntity, createOperation, duplicateCandidates, matchEntity, mergeClashes,
  namesMaybeAlike, namesSoundAlike, relationshipId, resolveEntityId,
} from '../src/core/index.js';
import { aliasesFromBooks, keyNames } from '../src/integration/name-sources.js';

test('the same sound across scripts and romanizations', () => {
  for (const [left, right] of [
    ['Ran Haitani', 'Ран Хайтани'], ['Хайтани Ран', 'Ran Haitani'], ['Haruchiyo Sanzu', 'Харучиё Сандзу'], ['Haruchiyo', 'Харутиё'],
    ['Kanji Mochizuki', 'Канджи Мотидзуки'], ['Kanji Mochizuki', 'Канджи Мочизуки'], ['Takeomi Akashi', 'Такэоми Акаси'],
    ['Keisuke Baji', 'Кейсукэ Баджи'], ['Manjiro Sano', 'Мандзиро Сано'], ['Shibuya', 'Сибуя'], ['Leon', 'Леон'], ['Hitto', 'Хито'],
  ]) assert.ok(namesSoundAlike(left, right), `${left} = ${right}`);
  assert.equal(namesSoundAlike('Ran', 'Рин'), false);
  assert.equal(namesSoundAlike('Акаши Хина', 'Takeomi Akashi'), false);
  assert.ok(namesMaybeAlike('Hitto Kakucho', 'Хитто Какуче'), 'one letter off: maybe');
  assert.ok(namesMaybeAlike('Haruchiyo Sanzu', 'Харучие Санзу'));
  assert.equal(namesMaybeAlike('Ran', 'Рин'), false, 'short words are never "maybe"');
});

const ran = createEntity('Ran Haitani');
const rindo = createEntity('Rindo Haitani');
const kakucho = createEntity('Hitto Kakucho');
const hina = createEntity('Акаши Хина', { aliases: ['Хина'] });
const takeomi = createEntity('Takeomi Akashi');
const base = () => applyOperations(createDefaultState(), [ran, rindo, kakucho, hina, takeomi].map(entity => createOperation('entity.upsert', entity)));

test('matching: sure by sound only when one fits; one letter off is a question; one shared word is nothing', () => {
  const state = base();
  assert.deepEqual(matchEntity(state, 'Ран Хайтани'), { id: ran.id, sure: true });
  assert.equal(resolveEntityId(state, 'Хайтани Риндо'), rindo.id);
  assert.equal(resolveEntityId(state, 'Хайтани'), null, 'Ran or Rindo? not a guess');
  assert.deepEqual(matchEntity(state, 'Хитто Какуче'), { ids: [kakucho.id], sure: false });
  assert.equal(resolveEntityId(state, 'Хитто Какуче'), null, 'a maybe never resolves by itself');
  assert.equal(resolveEntityId(state, 'Акаши'), null);
});

test('twins: sure ones and maybe ones; «Разные люди» is remembered', () => {
  let state = applyOperations(base(), [createOperation('entity.upsert', createEntity('Ран Хайтани')), createOperation('entity.upsert', createEntity('Хитто Какуче'))]);
  const pairs = duplicateCandidates(state);
  assert.ok(pairs.some(pair => pair.sure && state.entities[pair.intoId].name === 'Ran Haitani'));
  const maybe = pairs.find(pair => !pair.sure);
  assert.ok(maybe);
  state = { ...state, ui: { ...state.ui, distinctPairs: [[maybe.fromId, maybe.intoId].sort().join('|')] } };
  assert.ok(!duplicateCandidates(state).some(pair => !pair.sure), 'not offered again');
});

test('merging keeps the scales: the kept line stays; an empty kept line takes the twin one; the clash is shown first', () => {
  const twin = createEntity('Ран Хайтани');
  let state = applyOperations(base(), [
    createOperation('entity.upsert', twin),
    createOperation('scale.set', { from: ran.id, to: hina.id, scaleId: 'trust', value: 40 }),
    createOperation('scale.set', { from: twin.id, to: hina.id, scaleId: 'trust', value: 5 }),
    createOperation('relationship.upsert', { from: ran.id, to: takeomi.id }),
    createOperation('scale.set', { from: twin.id, to: takeomi.id, scaleId: 'respect', value: 25 }),
  ]);
  const clashes = mergeClashes(state, [{ fromId: twin.id, intoId: ran.id }]);
  assert.deepEqual(clashes.map(clash => [clash.line, clash.kept, clash.dropped]), [['Ran Haitani → Акаши Хина', 'доверие 40', 'доверие 5']], 'the empty line is no clash');
  state = applyOperations(state, [createOperation('entity.merge', { fromId: twin.id, intoId: ran.id })]);
  assert.equal(state.relationships[relationshipId(ran.id, hina.id)].scales.trust, 40, 'kept: no sum, no jump');
  assert.equal(state.relationships[relationshipId(ran.id, takeomi.id)].scales.respect, 25, 'the empty one took what the story built');
});

test('other names from the lorebook: plain and «whole word» regex keys; never a name that fits two', () => {
  assert.deepEqual(keyNames('/(?<![\\p{L}\\p{M}\\p{N}_-])(?:харучие|харучиё)(?![\\p{L}\\p{M}\\p{N}_-])/iu'), ['Харучие', 'Харучиё']);
  assert.deepEqual(keyNames('/(?<![\\p{L}\\p{M}\\p{N}_-])сано[ \\t]+манджиро(?![\\p{L}\\p{M}\\p{N}_-])/iu'), ['Сано Манджиро']);
  assert.deepEqual(keyNames('/(?<![\\p{L}])главар(?:е|ей)[ \\t]+бонтен(?![\\p{L}])/iu'), [], 'endings: nothing');
  assert.deepEqual(keyNames('Ран-сан'), ['Ран-сан']);
  const book = { entries: {
    1: { comment: '[ Ran Haitani ] - Basic Info', key: ['Ран', 'Хайтани', 'Хайтани Ран', 'ran'] },
    2: { comment: '[ Rindo Haitani ] - Basic Info', key: ['Риндо', 'Хайтани'] },
    3: { comment: '[ Takeomi Akashi ] - Visual', key: ['Такеоми', 'Акаши', 'Akashi'] },
    4: { comment: 'Ран и Судзу', key: ['Судзу'] },
  } };
  const found = aliasesFromBooks(base(), [book]);
  assert.deepEqual(found.get(ran.id), ['Ран', 'Хайтани Ран', 'Ran']);
  assert.deepEqual(found.get(rindo.id), ['Риндо']);
  assert.deepEqual(found.get(takeomi.id), ['Такеоми'], 'Акаши is a word of Хина too');
});

// ---- The page ---------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { createRelationshipStudio } = await import('../src/ui/studio.js');

test('«Персонажи»: a maybe pair asks «Это один» / «Разные люди»; the dossier sets the main name', async () => {
  const state = base();
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? async payload => { calls.push([name, payload]); return true; } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    duplicates: [{ fromId: kakucho.id, intoId: ran.id, sure: false, fromName: 'Хитто Какуче', intoName: 'Hitto Kakucho' }],
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'characters' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    assert.match(shadow.querySelector('.ku-twins.maybe').textContent, /Возможно, это один персонаж · 1/);
    byText('Разные люди').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onDistinctCharacters', { firstId: kakucho.id, secondId: ran.id }]);
    byText('Другие имена из лорбука').click();
    await flush();
    assert.equal(calls.at(-1)[0], 'onAliasesFromLore');
    shadow.querySelector('.ku-person').click();
    assert.ok(shadow.querySelector('select[aria-label="Главное имя"]'));
  } finally { studio.destroy(); }
});
