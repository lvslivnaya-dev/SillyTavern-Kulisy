import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquaintanceOf, applyOperation, applyOperations, createDefaultState, createEntity, createOperation, dossier,
  exportState, importState, pairKey, presentIds, rollbackMessage, whoKnows,
} from '../src/core/index.js';
import { rebuildWithoutAutomaticHistory } from '../src/integration/history.js';

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');
const draken = createEntity('Дракен');

function cast() {
  return applyOperations(createDefaultState(), [ran, suzu, mikey, draken].map(entity => createOperation('entity.upsert', entity)));
}

/** Operations an analysed reply #index would produce. */
function fromMessage(index, type, payload) {
  return createOperation(type, payload, { messageId: String(index), messageIndex: index, transactionId: `message:${index}` });
}

function alley(index = 140) {
  return fromMessage(index, 'event.add', { item: { id: 'alley', text: 'Ран и Судзу говорили в подворотне', witnessIds: [ran.id, suzu.id], location: 'подворотня', secret: true } });
}

test('a new state carries empty knowledge in the state and in the baseline', () => {
  const state = createDefaultState();
  assert.deepEqual(state.knowledge, { events: [], learned: [], acquaintances: {}, scene: { presentIds: [], location: '' } });
  assert.deepEqual(state.baseline.knowledge, state.knowledge);
});

test('witnesses know an event; everyone else is in "does not know"', () => {
  const state = applyOperation(cast(), alley());
  const ranFile = dossier(state, ran.id);
  assert.equal(ranFile.knows.length, 1);
  assert.equal(ranFile.knows[0].source, 'seen');
  const mikeyFile = dossier(state, mikey.id);
  assert.deepEqual(mikeyFile.knows, []);
  assert.deepEqual(mikeyFile.doesNotKnow.map(event => event.id), ['alley']);
  assert.equal(state.knowledge.events[0].secret, true);
});

test('being told moves an event into "knows", with who told', () => {
  const state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told', fromId: ran.id } }),
  ]);
  const file = dossier(state, mikey.id);
  assert.equal(file.doesNotKnow.length, 0);
  assert.deepEqual({ source: file.knows[0].source, fromId: file.knows[0].fromId }, { source: 'told', fromId: ran.id });
  assert.deepEqual([...whoKnows(state, 'alley').keys()].sort(), [ran.id, suzu.id, mikey.id].sort());
});

test('a witness cannot "learn" their own event, and the first way someone learned wins', () => {
  const state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l0', eventId: 'alley', entityId: ran.id, source: 'rumor' } }),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'rumor' } }),
    fromMessage(142, 'learned.add', { item: { id: 'l2', eventId: 'alley', entityId: mikey.id, source: 'told', fromId: suzu.id } }),
  ]);
  assert.deepEqual(state.knowledge.learned.map(entry => entry.id), ['l1']);
  assert.equal(dossier(state, mikey.id).knows[0].source, 'rumor');
});

test('swiping the reply that created an event removes it and everything learned about it', () => {
  let state = applyOperations(cast(), [
    alley(140),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told', fromId: ran.id } }),
  ]);
  state = rollbackMessage(state, '140');
  assert.deepEqual(state.knowledge.events, []);
  // The later "Ran told Mikey" points at a vanished event: a harmless no-op on replay.
  assert.deepEqual(state.knowledge.learned, []);
  assert.deepEqual(dossier(state, mikey.id), { knows: [], doesNotKnow: [] });
});

test('swiping the reply where Mikey was told takes the knowledge back, the event stays', () => {
  let state = applyOperations(cast(), [
    alley(140),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told', fromId: ran.id } }),
  ]);
  state = rollbackMessage(state, '141');
  assert.equal(state.knowledge.events.length, 1);
  assert.deepEqual(dossier(state, mikey.id).doesNotKnow.map(event => event.id), ['alley']);
});

test('manual edits survive a rollback of the reply they refer to only if their target survives', () => {
  let state = applyOperations(cast(), [
    alley(140),
    createOperation('event.add', { item: { id: 'bridge', text: 'Драка у моста', witnessIds: [mikey.id, draken.id] } }, { transactionId: 'manual' }),
    createOperation('knowledge.toggle', { kind: 'event', itemId: 'alley', disabled: true }, { transactionId: 'manual' }),
  ]);
  state = rollbackMessage(state, '140');
  assert.deepEqual(state.knowledge.events.map(event => event.id), ['bridge'], 'manual event kept, toggle of a gone event is a no-op');
});

test('switching an event off hides it from every dossier; switching a "learned" off means not known', () => {
  let state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told' } }),
    createOperation('knowledge.toggle', { kind: 'learned', itemId: 'l1', disabled: true }),
  ]);
  assert.deepEqual(dossier(state, mikey.id).doesNotKnow.map(event => event.id), ['alley']);
  state = applyOperation(state, createOperation('knowledge.toggle', { kind: 'event', itemId: 'alley', disabled: true }));
  assert.deepEqual(dossier(state, mikey.id), { knows: [], doesNotKnow: [] });
  assert.deepEqual(dossier(state, ran.id), { knows: [], doesNotKnow: [] });
});

test('editing witnesses drops "learned" entries that became redundant', () => {
  const state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told' } }),
    createOperation('event.update', { eventId: 'alley', changes: { witnessIds: [ran.id, suzu.id, mikey.id], secret: false } }),
  ]);
  assert.deepEqual(state.knowledge.learned, []);
  assert.equal(dossier(state, mikey.id).knows[0].source, 'seen');
  assert.equal(state.knowledge.events[0].secret, undefined);
});

test('unknown characters are dropped from lists instead of breaking the journal', () => {
  const state = applyOperations(cast(), [
    fromMessage(1, 'event.add', { item: { id: 'e', text: 'Что-то', witnessIds: [ran.id, 'entity:ghost'] } }),
    fromMessage(1, 'learned.add', { item: { id: 'l', eventId: 'e', entityId: 'entity:ghost' } }),
    fromMessage(1, 'scene.set', { presentIds: [ran.id, 'entity:ghost'], location: 'склад' }),
  ]);
  assert.deepEqual(state.knowledge.events[0].witnessIds, [ran.id]);
  assert.deepEqual(state.knowledge.learned, []);
  assert.deepEqual(presentIds(state), [ran.id]);
});

test('the scene follows the replies, and a swipe restores the previous one', () => {
  let state = applyOperations(cast(), [
    fromMessage(10, 'scene.set', { presentIds: [ran.id, suzu.id], location: 'подворотня' }),
    fromMessage(11, 'scene.set', { presentIds: [mikey.id, draken.id, suzu.id], location: 'гараж Тосвы' }),
  ]);
  assert.equal(state.knowledge.scene.location, 'гараж Тосвы');
  state = rollbackMessage(state, '11');
  assert.deepEqual(state.knowledge.scene, { presentIds: [ran.id, suzu.id].sort(), location: 'подворотня' });
});

test('toggling who is present keeps the place', () => {
  const state = applyOperations(cast(), [
    fromMessage(10, 'scene.set', { presentIds: [ran.id], location: 'подворотня' }),
    createOperation('scene.set', { presentIds: [ran.id, mikey.id] }),
  ]);
  assert.equal(state.knowledge.scene.location, 'подворотня');
  assert.deepEqual(presentIds(state), [ran.id, mikey.id].sort());
});

test('acquaintance: explicit value, the old strangers flag, then the persona rule', () => {
  let state = cast();
  state = { ...state, ui: { ...state.ui, personaId: suzu.id, strangerPairs: [pairKey(ran.id, draken.id)] } };
  assert.equal(acquaintanceOf(state, mikey.id, draken.id), null, 'two characters: canon decides');
  assert.equal(acquaintanceOf(state, ran.id, draken.id), 'strangers', 'engine flag still works');
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'strangers', 'nobody knows the persona by default');
  assert.equal(acquaintanceOf(state, suzu.id, mikey.id), 'strangers', 'order does not matter');
  state = applyOperations(state, [
    createOperation('acquaintance.set', { firstId: suzu.id, secondId: ran.id, status: 'known' }),
    fromMessage(12, 'acquaintance.set', { firstId: mikey.id, secondId: suzu.id, status: 'seen' }),
  ]);
  assert.equal(acquaintanceOf(state, ran.id, suzu.id), 'known');
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'seen');
  state = rollbackMessage(state, '12');
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'strangers', 'meeting rolled back with its reply');
  state = applyOperation(state, createOperation('acquaintance.set', { firstId: ran.id, secondId: suzu.id, status: null }));
  assert.equal(acquaintanceOf(state, ran.id, suzu.id), 'strangers', 'cleared back to the default');
  assert.throws(() => applyOperation(state, createOperation('acquaintance.set', { firstId: ran.id, secondId: suzu.id, status: 'besties' })), /Unknown acquaintance status/);
});

test('removing a character cleans every knowledge list but keeps the events', () => {
  let state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'told', fromId: ran.id } }),
    createOperation('acquaintance.set', { firstId: ran.id, secondId: mikey.id, status: 'known' }),
    fromMessage(142, 'scene.set', { presentIds: [ran.id, mikey.id], location: 'мост' }),
  ]);
  state = applyOperation(state, createOperation('entity.remove', { entityId: ran.id }));
  assert.deepEqual(state.knowledge.events[0].witnessIds, [suzu.id]);
  assert.equal(state.knowledge.learned[0].fromId, undefined, 'teller is forgotten, the knowledge stays');
  assert.deepEqual(state.knowledge.acquaintances, {});
  assert.deepEqual(presentIds(state), [mikey.id]);
});

test('a state with knowledge survives export → import (journal replay check included)', () => {
  const state = applyOperations(cast(), [
    alley(),
    fromMessage(141, 'learned.add', { item: { id: 'l1', eventId: 'alley', entityId: mikey.id, source: 'rumor' } }),
    createOperation('acquaintance.set', { firstId: ran.id, secondId: suzu.id, status: 'known' }),
    fromMessage(142, 'scene.set', { presentIds: [mikey.id], location: 'гараж' }),
  ]);
  const imported = importState(exportState(state));
  assert.deepEqual(imported.knowledge, state.knowledge);
});

test('a Relationship Engine state without knowledge imports and gets empty knowledge', () => {
  const engine = cast();
  delete engine.knowledge;
  delete engine.baseline.knowledge;
  const imported = importState(JSON.stringify(engine));
  assert.deepEqual(imported.knowledge.events, []);
  assert.deepEqual(imported.baseline.knowledge.events, []);
});

test('import rejects knowledge that does not match its journal', () => {
  const state = applyOperation(cast(), alley());
  state.knowledge.events[0].text = 'подделка';
  assert.throws(() => importState(JSON.stringify(state)), /does not match its operation journal/);
});

test('import rejects broken knowledge shapes', () => {
  const state = cast();
  state.knowledge.acquaintances[pairKey(ran.id, 'entity:ghost')] = 'known';
  assert.throws(() => importState(JSON.stringify(state)), /acquaintance .* unknown characters/);
});

test('re-analysing history keeps manual knowledge and drops what replies produced', () => {
  const state = applyOperations(cast(), [
    alley(140),
    createOperation('event.add', { item: { id: 'manual', text: 'Вписано вручную', witnessIds: [mikey.id] } }, { transactionId: 'manual' }),
  ]);
  const rebuilt = rebuildWithoutAutomaticHistory(state);
  assert.deepEqual(rebuilt.knowledge.events.map(event => event.id), ['manual']);
});
