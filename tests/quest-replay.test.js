/** A quest with steps must survive the journal check: the state is replayed from the operations and has to come out identical. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, importState, rollbackTransaction } from '../src/core/index.js';

const base = () => applyOperations(createDefaultState(), [createOperation('entity.upsert', { id: 'a', name: 'А' })]);

test('a quest with steps is saved: the step IDs do not depend on chance', () => {
  const added = applyOperations(base(), [createOperation('quest.add', { item: { id: 'q1', name: 'Найти ключ', text: 'ключ у бармена', steps: ['Расспросить бармена', 'Обыскать подсобку', 'Расспросить бармена'] } }, { transactionId: 't1' })]);
  assert.doesNotThrow(() => importState(added), 'the journal replays to the same state');
  assert.deepEqual(added.world.quests[0].steps.map(step => step.id), ['q1-s1', 'q1-s2', 'q1-s3']);
  // New steps typed over old ones keep the IDs of steps that are given with their own ID.
  const edited = applyOperations(added, [createOperation('quest.update', { questId: 'q1', changes: { steps: [{ id: 'q1-s2', text: 'Обыскать подсобку', done: true }, 'Отдать ключ'] } })]);
  assert.doesNotThrow(() => importState(edited));
  assert.deepEqual(edited.world.quests[0].steps.map(step => [step.id, step.done]), [['q1-s2', true], ['q1-s1', false]]);
  assert.equal(importState(added).world.quests[0].steps.length, 3, 'a saved and loaded quest is the same');
  assert.doesNotThrow(() => importState(rollbackTransaction(added, 't1')), 'taking it back is fine too');
});
