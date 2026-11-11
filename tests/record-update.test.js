import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, importState, rollbackMessage } from '../src/core/index.js';

function setup() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'Анна' }),
    createOperation('entity.upsert', { id: 'b', name: 'Леон' }),
    createOperation('entity.upsert', { id: 'c', name: 'Мира' }),
    createOperation('memory.add', { shared: true, item: { id: 'm1', text: 'Поцелуй под дождём', intensity: 3, participantIds: ['a', 'b'], knownBy: ['a', 'b'] } }, { messageId: '7' }),
  ]);
}

test('record.update edits text, intensity, participants and who knows', () => {
  const state = applyOperations(setup(), [createOperation('record.update', {
    kind: 'memory', shared: true, itemId: 'm1',
    changes: { text: 'Поцелуй под дождём у вокзала', intensity: 5, participantIds: ['a', 'b'], knownBy: ['c'] },
  })]);
  const item = state.records.memories[0];
  assert.equal(item.text, 'Поцелуй под дождём у вокзала');
  assert.equal(item.intensity, 5);
  assert.deepEqual(item.knownBy, ['a', 'b', 'c'], 'участники всегда знают о своём событии');
  assert.doesNotThrow(() => importState(state), 'правка проходит проверку журнала');
});

test('record.update after its record was rolled back is a harmless no-op', () => {
  const edited = applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { text: 'Новый текст' } })]);
  const rolled = rollbackMessage(edited, '7');
  assert.equal(rolled.records.memories.length, 0);
  assert.doesNotThrow(() => importState(rolled));
});

test('record.update rejects empty text and unknown characters', () => {
  assert.throws(() => applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { text: '   ' } })]), /text is required/);
  assert.throws(() => applyOperations(setup(), [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { knownBy: ['ghost'] } })]), /Unknown record participant/);
});

test('a pinned record is always sent: past the per-line limit and past the ranking budget', async () => {
  const { selectRuntimePrompt } = await import('../src/core/index.js');
  let state = applyOperations(setup(), [
    createOperation('relationship.upsert', { from: 'a', to: 'b', scales: { trust: 10 } }),
  ]);
  const relationshipId = Object.keys(state.relationships)[0];
  const add = (id, text) => createOperation('memory.add', { relationshipId, item: { id, text, intensity: 1 } });
  state = applyOperations(state, [add('p1', 'Старая клятва'), add('p2', 'Вторая'), add('p3', 'Третья'), add('p4', 'Четвёртая')]);
  assert.match(selectRuntimePrompt(state, { memoryLimit: 2 }), /mem=Третья \| Четвёртая/);
  state = applyOperations(state, [createOperation('record.update', { kind: 'memory', relationshipId, itemId: 'p1', changes: { pinned: true } })]);
  const line = selectRuntimePrompt(state, { memoryLimit: 2 });
  assert.match(line, /mem=Старая клятва \| Третья \| Четвёртая/);
  assert.doesNotMatch(selectRuntimePrompt(state, { includeMemories: false }), /Старая клятва/, 'выключенный вид записей не шлётся и закреплённым');
  state = applyOperations(state, [createOperation('record.update', { kind: 'memory', relationshipId, itemId: 'p1', changes: { pinned: false } })]);
  assert.doesNotThrow(() => importState(state));

  // Shared records: the pinned old weak one survives a budget that fits a single record.
  state = applyOperations(state, [
    createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { intensity: 1, pinned: true } }),
    createOperation('memory.add', { shared: true, item: { id: 'm2', text: 'Свежая ссора на кухне', intensity: 5, participantIds: ['a', 'b'], knownBy: ['a', 'b'] } }),
  ]);
  const tight = selectRuntimePrompt(state, { maxCharacters: 130, relationshipIds: [] });
  assert.match(tight, /Поцелуй под дождём/);
  assert.doesNotMatch(tight, /Свежая ссора/);
  const unpinned = applyOperations(state, [createOperation('record.update', { kind: 'memory', shared: true, itemId: 'm1', changes: { pinned: false } })]);
  assert.equal(unpinned.records.memories[0].pinned, undefined);
});
