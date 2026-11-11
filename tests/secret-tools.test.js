import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createEntity, createOperation, dossier, presentIds, rollbackMessage } from '../src/core/index.js';
import { buildKnowledgePrompt } from '../src/core/knowledge-prompt.js';
import { MERGE_LIMIT, autoSecrets, duplicateBuckets, joinEventTexts, mergeTarget } from '../src/core/secret-tools.js';
import { materializeKnowledge, parseKnowledge } from '../src/integration/knowledge-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const maki = createEntity('Маки');
const yu = createEntity('Ю');
const nobara = createEntity('Нобара');
const panda = createEntity('Панда');

function base(extra = []) {
  const state = applyOperations(createDefaultState(), [
    ...[maki, yu, nobara, panda].map(entity => createOperation('entity.upsert', entity)),
    createOperation('scene.set', { presentIds: [maki.id, yu.id], location: 'ванная' }, { messageId: '10', messageIndex: 10 }),
    ...extra,
  ]);
  return { ...state, ui: { ...state.ui, personaId: yu.id } };
}
const at = (index, type, payload) => createOperation(type, payload, { messageId: String(index), messageIndex: index });
const analyse = (state, knowledge, index) => applyAnalysisResult(state, { operations: [], knowledge },
  { transactionId: `message:${index}`, messageId: String(index), messageIndex: index }, [], { trackKnowledge: true });

test('the chronicler no longer marks a secret itself: the event is plain and the guess is offered', () => {
  const { state, secrets } = analyse(base(), parseKnowledge({
    events: [{ key: 'n1', text: 'Махито шепнул Ю не верить Маки', witnessIds: [maki.id, yu.id], secret: true }],
  }), 11);
  const event = state.knowledge.events[0];
  assert.equal(event.secret, undefined);
  assert.deepEqual(secrets, [{ eventId: event.id, text: event.text, knowIds: [maki.id, yu.id].sort() }]);
  // Without the flag there is nothing to offer.
  assert.deepEqual(analyse(base(), parseKnowledge({ events: [{ key: 'n1', text: 'Маки вымыла Ю', witnessIds: [maki.id, yu.id] }] }), 11).secrets, []);
});

test('the next beat of the same scene is written into the last event; another place or other people start a new one', () => {
  let { state } = analyse(base(), parseKnowledge({ events: [{ key: 'a', text: 'Маки заставила Ю принять ванну', witnessIds: [maki.id, yu.id] }] }), 11);
  ({ state } = analyse(state, parseKnowledge({ events: [{ key: 'b', text: 'Маки вымыла Ю', witnessIds: [maki.id, yu.id] }] }), 13));
  assert.equal(state.knowledge.events.length, 1);
  assert.equal(state.knowledge.events[0].text, 'Маки заставила Ю принять ванну; Маки вымыла Ю');
  ({ state } = analyse(state, parseKnowledge({ events: [{ key: 'c', text: 'Нобара стучала в дверь', witnessIds: [maki.id, yu.id, nobara.id] }] }), 15));
  assert.equal(state.knowledge.events.length, 2, 'другие свидетели');
  ({ state } = analyse(state, parseKnowledge({ scene: { presentIds: [maki.id, yu.id], location: 'коридор' }, events: [{ key: 'd', text: 'Маки вывела Ю', witnessIds: [maki.id, yu.id] }] }), 17));
  assert.equal(state.knowledge.events.length, 3, 'другое место');
});

test('merging is journaled with its message, so a swipe takes it back', () => {
  let { state } = analyse(base(), parseKnowledge({ events: [{ key: 'a', text: 'Маки заставила Ю принять ванну', witnessIds: [maki.id, yu.id] }] }), 11);
  ({ state } = analyse(state, parseKnowledge({ events: [{ key: 'b', text: 'Маки вымыла Ю', witnessIds: [maki.id, yu.id] }] }), 13));
  const back = rollbackMessage(state, '13');
  assert.equal(back.knowledge.events[0].text, 'Маки заставила Ю принять ванну');
});

test('merging stops at the limit, after a long gap, and for events somebody was told about', () => {
  const place = { witnessIds: [maki.id, yu.id], location: 'ванная' };
  const one = (id, text) => at(11, 'event.add', { item: { id, text, ...place } });
  const ask = (state, text, messageIndex) => mergeTarget(state, { ...place, messageIndex, text });
  assert.equal(ask(base([one('e1', 'x'.repeat(MERGE_LIMIT - 20))]), 'коротко', 12)?.id, 'e1');
  assert.equal(ask(base([one('e1', 'x'.repeat(MERGE_LIMIT - 20))]), 'y'.repeat(40), 12), null, 'не влезает');
  assert.equal(ask(base([one('e1', 'раз')]), 'два', 30), null, 'давно');
  const told = base([one('e1', 'раз'), at(11, 'learned.add', { item: { id: 'l1', eventId: 'e1', entityId: nobara.id, source: 'told' } })]);
  assert.equal(ask(told, 'два', 12), null, 'кому-то рассказали');
  assert.equal(joinEventTexts('Раз.', 'два'), 'Раз; два');
});

test('a secret made by hand: its text goes to those who know and is silent when none of them is in the scene', () => {
  const state = base([
    createOperation('event.add', { item: { id: 's1', text: 'Махито о чём-то предупредил Ю', witnessIds: [yu.id, panda.id], own: true, detail: 'Махито шепнул не верить Маки.' } }),
  ]);
  const event = state.knowledge.events[0];
  assert.equal(event.secret, true);
  assert.equal(event.own, true);
  assert.equal(event.detail, 'Махито шепнул не верить Маки.');
  // Panda on stage knows it: he gets the text, Maki is told she does not know.
  const withPanda = applyOperations(state, [createOperation('scene.set', { presentIds: [maki.id, panda.id, yu.id] })]);
  const text = buildKnowledgePrompt(withPanda, {});
  assert.match(text, /secret\[Панда\]: Махито о чём-то предупредил Ю — Махито шепнул не верить Маки/);
  assert.match(text, /unknown\[Маки\]: .*Махито о чём-то предупредил Ю/);
  // Nobody who knows is on stage: nothing about it is sent.
  const alone = applyOperations(state, [createOperation('scene.set', { presentIds: [maki.id, nobara.id] })]);
  assert.doesNotMatch(buildKnowledgePrompt(alone, {}), /Махито/);
  assert.equal(dossier(withPanda, panda.id).knows.length, 1);
});

test('an ordinary event becomes a secret by hand and back; detail only belongs to a secret', () => {
  let state = base([createOperation('event.add', { item: { id: 'e1', text: 'Маки вымыла Ю', witnessIds: [maki.id, yu.id] } })]);
  state = applyOperations(state, [createOperation('event.update', { eventId: 'e1', changes: { detail: 'не секрет' } })]);
  assert.equal(state.knowledge.events[0].detail, undefined);
  state = applyOperations(state, [createOperation('event.update', { eventId: 'e1', changes: { own: true, detail: 'Подробности.' } })]);
  assert.deepEqual([state.knowledge.events[0].own, state.knowledge.events[0].secret, state.knowledge.events[0].detail], [true, true, 'Подробности.']);
  state = applyOperations(state, [createOperation('event.update', { eventId: 'e1', changes: { own: false, secret: false } })]);
  assert.deepEqual([state.knowledge.events[0].own, state.knowledge.events[0].secret, state.knowledge.events[0].detail], [undefined, undefined, undefined]);
});

test('a reveal of a hand-made secret is asked, not learned silently', () => {
  const state = base([createOperation('event.add', { item: { id: 's1', text: 'Тайна Ю', witnessIds: [yu.id], own: true, detail: 'Подробности.' } })]);
  const added = [];
  const api = { state: () => state, add: type => added.push(type), resolveId: ref => ref };
  const { reveals } = materializeKnowledge(parseKnowledge({ learned: [{ eventId: 's1', entityId: maki.id, source: 'told', fromId: yu.id }] }), api);
  assert.equal(reveals.length, 1);
  assert.deepEqual(added, []);
});

test('tidy-up helpers: old automatic secrets are found, folding buckets skip secrets of the user and told events', () => {
  const both = [maki.id, yu.id];
  const state = base([
    createOperation('event.add', { item: { id: 'a1', text: 'раз', witnessIds: both, secret: true } }),
    createOperation('event.add', { item: { id: 'a2', text: 'два', witnessIds: both, secret: true } }),
    createOperation('event.add', { item: { id: 'p1', text: 'три', witnessIds: both } }),
    createOperation('event.add', { item: { id: 'p2', text: 'четыре', witnessIds: both } }),
    createOperation('event.add', { item: { id: 'p3', text: 'пять', witnessIds: both } }),
    createOperation('event.add', { item: { id: 'o1', text: 'свой', witnessIds: both, own: true } }),
    createOperation('learned.add', { item: { id: 'l1', eventId: 'p3', entityId: nobara.id, source: 'told' } }),
  ]);
  assert.deepEqual(autoSecrets(state).map(event => event.id), ['a1', 'a2']);
  const buckets = duplicateBuckets(state);
  assert.deepEqual(buckets.map(bucket => bucket.events.map(event => event.id)).sort(), [['a1', 'a2'], ['p1', 'p2']]);
  assert.deepEqual(presentIds(state).sort(), both.slice().sort());
});

test('events the fold already looked at are not offered again, so the button runs out', () => {
  const both = [maki.id, yu.id];
  let state = base([
    createOperation('event.add', { item: { id: 'p1', text: 'раз', witnessIds: both } }),
    createOperation('event.add', { item: { id: 'p2', text: 'два', witnessIds: both } }),
    createOperation('event.add', { item: { id: 'p3', text: 'три', witnessIds: both } }),
  ]);
  assert.equal(duplicateBuckets(state)[0].events.length, 3);
  state = { ...state, ui: { ...state.ui, tidyEvents: ['p1', 'p2'] } };
  assert.deepEqual(duplicateBuckets(state), [], 'один оставшийся — не пара');
  state = applyOperations(state, [createOperation('event.add', { item: { id: 'p4', text: 'четыре', witnessIds: both } })]);
  assert.deepEqual(duplicateBuckets(state)[0].events.map(event => event.id), ['p3', 'p4'], 'новые события снова становятся кандидатами');
});
