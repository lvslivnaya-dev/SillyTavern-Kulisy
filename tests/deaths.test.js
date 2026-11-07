import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, createDefaultState, createEntity, createOperation, deathOf, isDead, presentIds, rollbackMessage,
  selectKnowledgeLines, selectRuntimePrompt, validateKnowledge,
} from '../src/core/index.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { materializeKnowledge, parseKnowledge } from '../src/integration/knowledge-analysis.js';

const ran = createEntity('Ран');
const rindo = createEntity('Риндо');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');

function base(operations = []) {
  const state = applyOperations(createDefaultState(), [
    ...[ran, rindo, suzu, mikey].map(entity => createOperation('entity.upsert', entity)),
    createOperation('scene.set', { presentIds: [ran.id, rindo.id, suzu.id] }),
    ...operations,
  ]);
  return { ...state, ui: { ...state.ui, personaId: suzu.id } };
}

const dies = (id = ran.id, note = 'погиб в драке у моста', meta = {}) => createOperation('death.set', { entityId: id, note }, meta);

test('a death takes the character off stage and keeps how it happened', () => {
  const state = base([dies()]);
  assert.ok(isDead(state, ran.id));
  assert.deepEqual(deathOf(state, ran.id), { note: 'погиб в драке у моста' });
  assert.deepEqual(presentIds(state), [rindo.id, suzu.id].sort());
  assert.deepEqual(validateKnowledge(state.knowledge, new Set(Object.keys(state.entities))), []);
});

test('the dead do not walk back on stage; «Воскресить» brings them back', () => {
  let state = base([dies(), createOperation('scene.set', { presentIds: [ran.id, mikey.id] })]);
  assert.deepEqual(presentIds(state), [mikey.id]);
  state = applyOperations(state, [createOperation('death.set', { entityId: ran.id, dead: false })]);
  assert.equal(isDead(state, ran.id), false);
  state = applyOperations(state, [createOperation('scene.set', { presentIds: [ran.id, mikey.id] })]);
  assert.ok(presentIds(state).includes(ran.id));
});

test('a death confirmed on a reply goes away with that reply', () => {
  const state = base([dies(ran.id, '', { messageId: '7', messageIndex: 7 })]);
  assert.ok(isDead(state, ran.id));
  assert.equal(isDead(rollbackMessage(state, '7'), ran.id), false);
});

test('the narrator gets dead[] for every dead character, and no knowledge lines for them', () => {
  const state = base([
    createOperation('event.add', { item: { id: 'bridge', text: 'Драка у моста', witnessIds: [mikey.id] } }),
    dies(),
    dies(mikey.id, ''),
  ]);
  const lines = selectKnowledgeLines(state, { castIds: [ran.id, rindo.id, suzu.id] });
  assert.equal(lines[0].startsWith('scene: '), true);
  assert.equal(lines[1], 'dead[Ран]: погиб в драке у моста', 'the mentioned dead first');
  assert.equal(lines[2], 'dead[Майки]', 'not mentioned, still listed, no note');
  assert.ok(!lines.some(line => /^(unknown|heard|secret)\[Ран\]/.test(line)), lines.join('\n'));
  assert.ok(lines.some(line => line.startsWith('unknown[Риндо]')), 'the living keep their lines');
});

test('the lines of the dead are frozen; what others feel toward them still changes and is sent', () => {
  let state = base([
    createOperation('relationship.upsert', { from: ran.id, to: rindo.id }),
    createOperation('relationship.upsert', { from: rindo.id, to: ran.id }),
  ]);
  state = applyOperations(state, [
    createOperation('scale.delta', { relationshipId: Object.keys(state.relationships).find(id => state.relationships[id].from === ran.id), scaleId: 'trust', value: 40 }),
    createOperation('scale.delta', { relationshipId: Object.keys(state.relationships).find(id => state.relationships[id].from === rindo.id), scaleId: 'trust', value: 40 }),
    dies(),
  ]);
  const { operations } = applyAnalysisResult(state, { operations: [
    { subjectId: ran.id, objectId: rindo.id, metric: 'trust', delta: 5, reason: 'x' },
    { subjectId: rindo.id, objectId: ran.id, metric: 'trust', delta: -5, reason: 'горе' },
  ] }, { messageId: '3' }, [], { linkedScales: false });
  assert.equal(operations.length, 1);
  assert.equal(state.relationships[operations[0].payload.relationshipId].from, rindo.id);
  const prompt = selectRuntimePrompt(state, { maxCharacters: 4000 });
  assert.match(prompt, /^Риндо>Ран;/m);
  assert.doesNotMatch(prompt, /^Ран>Риндо/m);
});

test('the chronicler only proposes deaths, and never one that is already marked', () => {
  const chronicle = parseKnowledge({ deaths: [
    { entityId: ran.id, note: 'застрелен', quote: 'Ран упал и больше не дышал' },
    { entityId: mikey.id, note: 'x' },
    { entityId: 'ghost' },
    { note: 'без имени' },
  ] });
  assert.equal(chronicle.deaths.length, 3);
  const state = base([dies(mikey.id, '')]);
  const added = [];
  const { deaths } = materializeKnowledge(chronicle, {
    state: () => state, add: (...args) => added.push(args), resolveId: id => (state.entities[id] ? id : null),
  });
  assert.deepEqual(deaths, [{ entityId: ran.id, note: 'застрелен', quote: 'Ран упал и больше не дышал' }]);
  assert.ok(!added.some(([type]) => type === 'death.set'), 'nothing journaled by the chronicler itself');
});
