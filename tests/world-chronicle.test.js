import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, createDefaultState, createEntity, createOperation, currentLocation, outfitOf, rollbackMessage,
} from '../src/core/index.js';
import { buildWorldBlock, parseWorld } from '../src/integration/world-analysis.js';
import { analyzeKnowledge, analyzeMessage, parseAnalysis } from '../src/integration/analyzer.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const ran = createEntity('Ран');
const rindo = createEntity('Риндо');
const mikey = createEntity('Майки', { aliases: ['Манджиро'] });

/** Day 1, 23:30, Ran in the bar «Хаос» (in Roppongi) wearing a suit; Rindo left earlier; a gun in Ran's pocket. */
function setting() {
  const manual = (type, payload) => createOperation(type, payload, { transactionId: 'manual' });
  const reply = (index, type, payload) => createOperation(type, payload, { messageId: String(index), messageIndex: index, transactionId: `message:${index}` });
  return applyOperations(createDefaultState(), [
    ...[ran, rindo, mikey].map(entity => createOperation('entity.upsert', entity)),
    manual('location.add', { item: { id: 'roppongi', name: 'Роппонги' } }),
    manual('location.add', { item: { id: 'bar', name: 'Бар «Хаос»', parentId: 'roppongi', traits: ['камин'] } }),
    reply(10, 'clock.set', { day: 1, time: '23:30' }),
    reply(10, 'scene.set', { presentIds: [ran.id, rindo.id], locationId: 'bar' }),
    reply(10, 'wardrobe.set', { entityId: ran.id, outfit: 'чёрный костюм' }),
    reply(10, 'wardrobe.set', { entityId: rindo.id, outfit: 'белый костюм, очки' }),
    reply(11, 'scene.set', { presentIds: [ran.id] }),
    reply(11, 'item.add', { item: { id: 'gun', name: 'пистолет', ownerId: ran.id, place: 'внутренний карман', importance: 'key', secret: true } }),
  ]);
}

function analyse(state, world, knowledge = null, index = 12, options = {}) {
  return applyAnalysisResult(state, { operations: [], world: parseWorld(world), knowledge }, {
    messageId: String(index), messageIndex: index, transactionId: `message:${index}`,
  }, [], options).state;
}

test('the block shows time, the current card with its surroundings, outfits of the cast and their items', () => {
  const block = buildWorldBlock(setting(), 'Ран посмотрел на Риндо.');
  assert.match(block, /day 1, 23:30, ночь/);
  assert.match(block, /bar: Бар «Хаос» \[CURRENT\] \| Роппонги \| камин/);
  assert.match(block, /roppongi: Роппонги/);
  assert.match(block, /Риндо \(.+\): белый костюм, очки/, 'Rindo is off stage but mentioned: his clothes are shown');
  assert.match(block, /gun: пистолет \[SECRET\] \| Ран \| внутренний карман \| key/);
  assert.doesNotMatch(block, /Майки/, 'Mikey is neither on stage nor mentioned');
});

test('parse is tolerant: bad time, junk items and empty parts are dropped', () => {
  const world = parseWorld({
    clock: { time: '26:00', advanceDays: -2, label: '' },
    place: { locationId: null, new: { name: '  ' } },
    outfits: [{ entityId: 'a' }, { entityId: 'a', outfit: 'куртка' }, 'junk'],
    items: [{ name: '' }, { name: 'письмо', ownerId: null }],
    itemsGone: ['x', 5],
  });
  assert.equal(world.clock, null);
  assert.equal(world.place, null);
  assert.deepEqual(world.outfits, [{ entityId: 'a', outfit: 'куртка' }]);
  assert.deepEqual(world.items, [{ name: 'письмо', ownerId: null }]);
  assert.deepEqual(world.itemsGone, ['x']);
  assert.deepEqual(parseWorld(null).outfits, []);
});

test('crossing midnight: an earlier time is the next day; a small step back is only a correction', () => {
  let state = analyse(setting(), { clock: { time: '01:15' } });
  assert.deepEqual([state.world.clock.day, state.world.clock.time, state.world.clock.part], [2, '01:15', 'night']);
  state = analyse(state, { clock: { time: '00:50' } }, null, 13);
  assert.deepEqual([state.world.clock.day, state.world.clock.time], [2, '00:50'], 'within an hour back: same day');
  state = analyse(state, { clock: { time: '00:50' } }, null, 14);
  assert.equal(state.operations.filter(operation => operation.messageId === '14').length, 0, 'nothing changed, nothing journaled');
});

test('a flashback freezes the present clock; returning keeps going from where it was', () => {
  let state = analyse(setting(), { clock: { time: '14:00', label: 'Десять лет назад', flashback: true } });
  assert.deepEqual([state.world.clock.time, state.world.clock.flashback, state.world.clock.label], ['23:30', true, '']);
  state = analyse(state, { clock: { time: '23:45', flashback: false } }, null, 13);
  assert.deepEqual([state.world.clock.time, state.world.clock.flashback], ['23:45', undefined]);
});

test('"three days later Rindo walks into a new place": new card, clock, arrival — he may have changed', () => {
  const state = analyse(setting(), {
    clock: { time: '18:00', advanceDays: 3 },
    place: { locationId: null, new: { name: 'Крыша склада', parentId: 'roppongi', traits: ['ржавая лестница'] } },
  }, { scene: { presentIds: [ran.id, rindo.id], location: 'крыша' }, events: [], learned: [], met: [], leaks: [] });
  assert.equal(state.world.clock.day, 4);
  const card = currentLocation(state);
  assert.equal(card.name, 'Крыша склада');
  assert.equal(card.parentId, 'roppongi');
  assert.equal(state.knowledge.scene.location, 'Крыша склада', 'the card name wins over free text');
  assert.equal(outfitOf(state, rindo.id).awayDays, 3);
  assert.equal(outfitOf(state, ran.id).awayDays, 3, 'three days passed for Ran too');
});

test('a "new" place with the name of an existing card reuses it', () => {
  const state = analyse(setting(), { place: { new: { name: 'бар «хаос»' } } });
  assert.equal(state.world.locations.length, 2);
  assert.equal(currentLocation(state).id, 'bar');
});

test('place features and changes are added; removed notes go; a locked place is left alone', () => {
  let state = analyse(setting(), { place: { locationId: 'bar', addTraits: ['Камин', 'стойка из тёмного дерева'], addNotes: ['разбито окно'] } });
  let bar = currentLocation(state);
  assert.deepEqual(bar.traits, ['камин', 'стойка из тёмного дерева']);
  assert.deepEqual(bar.notes, ['разбито окно']);
  state = analyse(state, { place: { locationId: 'bar', removeNotes: ['Разбито окно'] } }, null, 13);
  assert.deepEqual(currentLocation(state).notes, []);
  state = applyOperations(state, [createOperation('location.update', { locationId: 'bar', changes: { locked: true } })]);
  state = analyse(state, { place: { locationId: 'bar', addTraits: ['диско-шар'] } }, null, 14);
  bar = currentLocation(state);
  assert.equal(bar.traits.includes('диско-шар'), false);
});

test('outfits and conditions: a new outfit is written, the same one is not, a locked one never', () => {
  let state = analyse(setting(), {
    outfits: [{ entityId: ran.id, outfit: 'Чёрный костюм' }, { entityId: 'Риндо', outfit: 'кожаная куртка' }],
    conditions: [{ entityId: ran.id, text: 'промок под дождём', days: 1 }],
  });
  assert.equal(state.world.wardrobe[rindo.id].outfit, 'кожаная куртка', 'names resolve to IDs');
  assert.equal(state.operations.filter(operation => operation.type === 'wardrobe.set' && operation.messageId === '12').length, 1, 'the same outfit is not rewritten');
  const wet = state.world.wardrobe[ran.id].conditions[0];
  assert.equal(wet.text, 'промок под дождём');
  state = applyOperations(state, [createOperation('wardrobe.set', { entityId: ran.id, outfit: 'кимоно', locked: true })]);
  state = analyse(state, { outfits: [{ entityId: ran.id, outfit: 'пижама' }], conditionsGone: [{ entityId: ran.id, conditionId: wet.id }] }, null, 13);
  assert.equal(state.world.wardrobe[ran.id].outfit, 'кимоно');
  assert.equal(state.world.wardrobe[ran.id].conditions.length, 1, 'a locked wardrobe keeps its conditions too');
});

test('items: handed over by ID, found again by name, new ones added, gone ones removed — locked ones kept', () => {
  let state = analyse(setting(), {
    items: [
      { itemId: 'gun', ownerId: 'Майки', place: 'за поясом' },
      { name: 'письмо от Риндо', ownerId: ran.id, importance: 'important' },
    ],
  });
  const gun = state.world.items.find(item => item.id === 'gun');
  assert.deepEqual([gun.ownerId, gun.place], [mikey.id, 'за поясом']);
  const letter = state.world.items.find(item => item.name === 'письмо от Риндо');
  assert.deepEqual([letter.ownerId, letter.importance], [ran.id, 'important']);
  state = analyse(state, { items: [{ name: 'Письмо от Риндо', ownerId: null, place: 'в камине' }] }, null, 13);
  assert.equal(state.world.items.filter(item => item.name.toLowerCase().startsWith('письмо')).length, 1, 'the same letter, not a twin');
  assert.equal(state.world.items.find(item => item.id === letter.id).place, 'в камине');
  assert.equal(state.world.items.find(item => item.id === letter.id).ownerId, undefined);
  state = applyOperations(state, [createOperation('item.update', { itemId: 'gun', changes: { locked: true } })]);
  state = analyse(state, { itemsGone: ['gun', letter.id] }, null, 14);
  assert.deepEqual(state.world.items.map(item => item.id), ['gun']);
});

test('a swipe of the analysed reply takes all of it back', () => {
  let state = analyse(setting(), {
    clock: { advanceDays: 1, time: '09:00' },
    place: { new: { name: 'Кафе' } },
    outfits: [{ entityId: ran.id, outfit: 'свитер' }],
    items: [{ name: 'ключи', ownerId: ran.id }],
  });
  state = rollbackMessage(state, '12');
  assert.deepEqual([state.world.clock.day, state.world.clock.time], [1, '23:30']);
  assert.equal(currentLocation(state).id, 'bar');
  assert.equal(state.world.wardrobe[ran.id].outfit, 'чёрный костюм');
  assert.deepEqual(state.world.items.map(item => item.id), ['gun']);
});

test('the scene chronicler switched off writes nothing; without knowledge it still moves the scene', () => {
  const world = { place: { new: { name: 'Кафе' } }, outfits: [{ entityId: ran.id, outfit: 'свитер' }] };
  const off = analyse(setting(), world, null, 12, { trackWorld: false });
  assert.equal(off.world.locations.length, 2);
  const alone = analyse(setting(), world, null, 12, { trackKnowledge: false });
  assert.equal(currentLocation(alone).name, 'Кафе');
  assert.deepEqual(alone.knowledge.scene.presentIds, [ran.id]);
});

function fakeModel(reply) {
  const calls = [];
  return { calls, context: { async generateRaw(options) { calls.push(options); return reply; }, getTokenCount: text => Math.ceil(text.length / 4) } };
}

test('the analyzer asks for the scene state only when told to, and parses it', async () => {
  const reply = JSON.stringify({ operations: [], world: { clock: { time: '7:05' } } });
  const asked = fakeModel(reply);
  const result = await analyzeMessage(asked.context, setting(), { mes: 'Утро.' }, { analysisMaxCharacters: 12000 }, '', { world: true });
  assert.match(asked.calls[0].prompt[0].content, /SCENE STATE RULES/);
  assert.match(asked.calls[0].prompt[1].content, /SCENE STATE TRACKING/);
  assert.equal(result.world.clock.time, '07:05');
  const silent = fakeModel(reply);
  await analyzeMessage(silent.context, setting(), { mes: 'Утро.' }, { analysisMaxCharacters: 12000 });
  assert.doesNotMatch(silent.calls[0].prompt[0].content, /SCENE STATE RULES/);
  assert.equal(parseAnalysis(JSON.stringify({ operations: [] })).world, null);
});

test('separate-request mode can carry the scene state alone or together with knowledge', async () => {
  const both = fakeModel(JSON.stringify({ knowledge: { met: [] }, world: { outfits: [{ entityId: ran.id, outfit: 'свитер' }] } }));
  const chronicle = await analyzeKnowledge(both.context, setting(), { mes: 'Ран переоделся.' }, { analysisMaxCharacters: 12000 }, [], { knowledge: true, world: true });
  assert.match(both.calls[0].prompt[0].content, /KNOWLEDGE RULES[\s\S]*SCENE STATE RULES/);
  assert.deepEqual(chronicle.world.outfits, [{ entityId: ran.id, outfit: 'свитер' }]);
  assert.deepEqual(chronicle.knowledge.met, []);
  const alone = fakeModel(JSON.stringify({ world: { clock: { time: '10:00' } } }));
  const onlyWorld = await analyzeKnowledge(alone.context, setting(), { mes: 'Утро.' }, { analysisMaxCharacters: 12000 }, [], { knowledge: false, world: true });
  assert.match(alone.calls[0].prompt[0].content, /continuity log/);
  assert.doesNotMatch(alone.calls[0].prompt[0].content, /KNOWLEDGE RULES/);
  assert.equal(onlyWorld.knowledge, null);
  assert.equal(onlyWorld.world.clock.time, '10:00');
});
