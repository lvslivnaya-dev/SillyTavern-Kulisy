import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createEntity, createOperation, relationshipId, selectRuntimePrompt } from '../src/core/index.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const ran = createEntity('Ран');
const rindo = createEntity('Риндо');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');

function base(present, triangle = {}) {
  const state = applyOperations(createDefaultState(), [
    ...[ran, rindo, suzu, mikey].map(entity => createOperation('entity.upsert', entity)),
    createOperation('relationship.upsert', { from: ran.id, to: suzu.id }),
    createOperation('relationship.upsert', { from: rindo.id, to: ran.id }),
    createOperation('scene.set', { presentIds: present }),
  ]);
  state.ui.personaId = mikey.id;
  state.ui.triangles = [{ id: 't', name: 'Братья', centerId: suzu.id, firstId: ran.id, secondId: rindo.id, ...triangle }];
  return state;
}
const closer = { operations: [{ subjectId: ran.id, objectId: suzu.id, metric: 'love', delta: 6, reason: 'поцелуй' }] };
const jealousy = (state, from, to) => state.relationships[relationshipId(from, to)]?.scales.jealousy ?? 0;

test('the rival who saw the center and the other side grow closer gets jealous of that side', () => {
  const { state, operations } = applyAnalysisResult(base([ran.id, rindo.id, suzu.id]), closer, { messageId: '5' }, [], { linkedScales: false });
  assert.equal(jealousy(state, rindo.id, ran.id), 3, 'half of +6');
  assert.match(operations.at(-1).reason, /Ревность третьего: Риндо видит, как Ран и Судзу сближаются/);
});

test('no jealousy when the rival was not there, the echo is off, or the triangle is resolved', () => {
  for (const [present, extra] of [[[ran.id, suzu.id], {}], [[ran.id, rindo.id, suzu.id], { noEcho: true }], [[ran.id, rindo.id, suzu.id], { resolved: { chosenId: ran.id } }]]) {
    const { state } = applyAnalysisResult(base(present, extra), closer, { messageId: '5' }, [], { linkedScales: false });
    assert.equal(jealousy(state, rindo.id, ran.id), 0, JSON.stringify(extra));
  }
});

test('the analyzer\'s own jealousy change is not doubled', () => {
  const result = { operations: [...closer.operations, { subjectId: rindo.id, objectId: ran.id, metric: 'jealousy', delta: 5, reason: 'сжал кулаки' }] };
  const { state } = applyAnalysisResult(base([ran.id, rindo.id, suzu.id]), result, { messageId: '5' }, [], { linkedScales: false });
  assert.equal(jealousy(state, rindo.id, ran.id), 5);
});

test('the triangle reaches the narrator only with two of three in the scene, and never once resolved', () => {
  const state = base([]);
  assert.match(selectRuntimePrompt(state, { sceneIds: [ran.id, suzu.id] }), /triangle center=Судзу/);
  assert.doesNotMatch(selectRuntimePrompt(state, { sceneIds: [ran.id, mikey.id] }), /triangle /);
  state.ui.triangles[0].resolved = { chosenId: ran.id };
  assert.doesNotMatch(selectRuntimePrompt(state, { sceneIds: [ran.id, suzu.id] }), /triangle /);
});
