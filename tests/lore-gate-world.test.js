import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, rollbackMessage } from '../src/core/index.js';
import { applyGate, entryKeysHit, normalizeGate, planGate, worldEntries } from '../src/integration/lore-gate.js';
import { buildKnowledgeBlock, parseKnowledge } from '../src/integration/knowledge-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const rx = word => `/(?<![\\p{L}\\p{M}\\p{N}_-])${word}(?![\\p{L}\\p{M}\\p{N}_-])/iu`;

function setup(present = ['mikey']) {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'me', name: 'Иоко' }),
    createOperation('entity.upsert', { id: 'mikey', name: 'Майки' }),
    createOperation('entity.upsert', { id: 'sanzu', name: 'Санзу' }),
    createOperation('scene.set', { presentIds: present }),
  ]);
  state.ui = { ...state.ui, personaId: 'me' };
  return state;
}

let uid = 0;
const entry = (comment, key, content = 'text') => ({ uid: uid += 1, world: 'Бонтен', comment, key: [rx(key)], keysecondary: [], content, constant: false });

function worldLists() {
  return {
    globalLore: [],
    characterLore: [
      entry('[ Манджиро ] - Basic Info', 'майки'),
      entry('Пентхаус Бонтен - Комната Майки', 'спальн', 'a'.repeat(300)),
      entry('Пентхаус Бонтен - Кухня', 'кухн', 'b'.repeat(200)),
      entry('Пентхаус Бонтен - Бассейн', 'бассейн(?:ом|ы|а|е)?', 'c'.repeat(100)),
      entry('Законы мира', 'закон', 'd'.repeat(50)),
      { ...entry('Константа мира', 'мир'), constant: true },
      entry('[Секрет] Шрамы', 'шрам', 'секрет'),
    ],
    chatLore: [],
    personaLore: [entry('Личное Иоко', 'иоко')],
  };
}

const titles = payload => Object.values(payload).flat().map(item => item.comment);
const forced = payload => Object.values(payload).flat().filter(item => item.constant).map(item => item.comment);
const withFocus = (lore, present = ['mikey']) => applyOperations(setup(present), [createOperation('scene.set', { presentIds: present, ...(lore ? { lore } : {}) })]);

function plan(state, { config = {}, ...rest } = {}) {
  const payload = worldLists();
  const { decisions, report } = planGate({ lists: payload, state, config: { enabled: true, ...config }, presentIds: ['mikey'], turn: 1, ...rest });
  applyGate(payload, decisions);
  return { report, left: titles(payload), sent: forced(payload) };
}

test('world notes: the chronicler picked these, the rest is held back; sheets, constants, secrets and the persona are not its business', () => {
  assert.deepEqual(worldEntries(worldLists()).map(item => item.title), ['Пентхаус Бонтен - Комната Майки', 'Пентхаус Бонтен - Кухня', 'Пентхаус Бонтен - Бассейн', 'Законы мира']);
  const { left, sent, report } = plan(withFocus(['Пентхаус Бонтен - Комната Майки', 'законы мира']));
  assert.ok(sent.includes('Пентхаус Бонтен - Комната Майки'), 'выбранное идёт всегда');
  assert.ok(sent.includes('Законы мира'), 'названия сравниваются без учёта регистра');
  assert.ok(!left.includes('Пентхаус Бонтен - Кухня') && !left.includes('Пентхаус Бонтен - Бассейн'), 'остальное придержано');
  assert.ok(left.includes('Константа мира'), 'константы не трогаются');
  assert.ok(left.includes('Личное Иоко'), 'лорбук персоны не трогается');
  assert.deepEqual([report.world.forced, report.world.dropped, report.world.kept, report.world.savedCharacters], [2, 2, 0, 300]);
  assert.deepEqual(report.world.picked, ['Пентхаус Бонтен - Комната Майки', 'законы мира']);
});

test('world notes: a note the fresh post names by its own key stays with SillyTavern; an empty pick holds everything', () => {
  const kept = plan(withFocus(['Законы мира']), { namedText: 'А что у нас с бассейном?' });
  assert.ok(kept.left.includes('Пентхаус Бонтен - Бассейн'), 'ключ из свежего поста: оставлено ключам таверны');
  assert.ok(!kept.sent.includes('Пентхаус Бонтен - Бассейн'), 'но не принудительно');
  assert.ok(!kept.left.includes('Пентхаус Бонтен - Кухня'));
  assert.equal(kept.report.world.kept, 1);
  const none = plan(withFocus([]));
  assert.equal(none.report.world.dropped, 4);
  assert.deepEqual(none.sent.filter(title => /Пентхаус|Законы/.test(title)), []);
});

test('world notes: nothing is held back until the chronicler has answered, nor when the setting says keys', () => {
  const unasked = plan(withFocus(null));
  assert.equal(unasked.report.world, undefined);
  assert.ok(unasked.left.includes('Пентхаус Бонтен - Кухня'));
  const byKeys = plan(withFocus(['Законы мира']), { config: { world: 'keys' } });
  assert.equal(byKeys.report.world, undefined);
  assert.ok(byKeys.left.includes('Пентхаус Бонтен - Кухня'));
  assert.equal(normalizeGate({ world: 'nope' }).world, 'chronicler');
  assert.equal(normalizeGate({ world: 'keys' }).world, 'keys');
});

test('keys as SillyTavern writes them: regex with flags or plain words, primary keys only', () => {
  const regexEntry = { key: [rx('кухн(?:я|и|е)')] };
  assert.equal(entryKeysHit(regexEntry, 'Пойдём на Кухне'), true);
  assert.equal(entryKeysHit(regexEntry, 'кухонный нож'), false);
  assert.equal(entryKeysHit({ key: ['Бассейн'] }, 'в бассейне тихо'), true);
  assert.equal(entryKeysHit({ key: ['/(/'] }, 'скобка'), false, 'сломанный регекс не роняет шлюз');
  assert.equal(entryKeysHit({ key: [] }, 'что угодно'), false);
});

test('the chronicler is shown the titles; its picks are stored with the scene and checked against the lorebook', () => {
  const block = buildKnowledgeBlock(setup(), 'Текст ответа', [], { loreList: ['Пентхаус Бонтен - Кухня', 'Законы мира'] });
  assert.match(block, /LORE LIST[^\n]*\n- Пентхаус Бонтен - Кухня\n- Законы мира\nEND LORE LIST/);
  assert.equal(buildKnowledgeBlock(setup(), 'Текст ответа', []).includes('LORE LIST'), false, 'без списка блока нет');
  assert.deepEqual(parseKnowledge({ scene: { presentIds: ['mikey'], lore: [' Законы мира ', 'Законы мира', ''] } }).scene.lore, ['Законы мира']);
  assert.equal(parseKnowledge({ scene: { presentIds: ['mikey'] } }).scene.lore, null, 'поле не прислали: «не спрашивали»');

  const apply = (state, scene, known, index) => applyAnalysisResult(state, { operations: [], knowledge: parseKnowledge({ scene }) },
    { transactionId: `message:${index}`, messageId: String(index), messageIndex: index }, [], { trackKnowledge: true, loreTitles: known });
  const known = new Set(['Законы мира', 'Пентхаус Бонтен - Кухня']);
  let { state } = apply(setup(), { presentIds: ['mikey'], lore: ['Законы мира', 'Выдуманная запись'] }, known, 5);
  assert.deepEqual(state.knowledge.scene.lore, ['Законы мира'], 'выдуманные названия отброшены');
  assert.equal(apply(state, { presentIds: ['mikey'], lore: ['Законы мира'] }, known, 7).operations.length, 0, 'тот же выбор ничего не пишет');
  ({ state } = apply(state, { presentIds: ['mikey', 'sanzu'] }, known, 9));
  assert.deepEqual(state.knowledge.scene.lore, ['Законы мира'], 'поле не прислали: прежний выбор остаётся');
  ({ state } = apply(state, { presentIds: ['mikey', 'sanzu'], lore: [] }, known, 11));
  assert.deepEqual(state.knowledge.scene.lore, [], 'пустой список: «ничего не нужно»');
  assert.equal(rollbackMessage(state, '11').knowledge.scene.lore.length, 1, 'свайп забирает выбор вместе с сообщением');
});
