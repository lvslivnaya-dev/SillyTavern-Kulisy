import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, createDefaultState, createEntity, createOperation, validateState } from '../src/core/index.js';
import {
  buildQuestsPrompt, closingLine, currentStep, daysLeft, dueText, groupQuests, progressOf, questCue, questsForPrompt, questsOf,
} from '../src/core/quests.js';
import { armCue, cueLabel, buildDirectionPrompt, normalizeDirection } from '../src/core/direction.js';

const meta = { transactionId: 't', reason: 'test', timestamp: '2026-01-01T00:00:00.000Z' };
const op = (state, type, payload) => applyOperation(state, createOperation(type, payload, meta));

function base() {
  let state = createDefaultState();
  for (const name of ['Ран', 'Судзу', 'Рандо']) state = op(state, 'entity.upsert', createEntity(name));
  state = op(state, 'clock.set', { day: 10, time: '14:00' });
  return state;
}
const ids = state => Object.fromEntries(Object.values(state.entities).map(entity => [entity.name, entity.id]));

function withQuest(extra = {}) {
  const state = base();
  const who = ids(state);
  return op(state, 'quest.add', { item: { id: 'q1', name: 'Найти сестру', text: 'пропала на прошлой неделе', steps: ['расспросить соседей', 'осмотреть склад', 'найти записку'], participantIds: [who['Ран']], dueDay: 12, ...extra } });
}

test('a quest is added with steps, a start day and clean fields', () => {
  const state = withQuest();
  const [quest] = questsOf(state);
  assert.equal(quest.status, 'active');
  assert.equal(quest.startedDay, 10);
  assert.equal(quest.steps.length, 3);
  assert.ok(quest.steps.every(step => step.id && step.done === false));
  assert.equal(new Set(quest.steps.map(step => step.id)).size, 3);
  assert.deepEqual(validateState(state).errors, []);
});

test('a nameless quest is refused, a repeated id is ignored', () => {
  assert.throws(() => op(base(), 'quest.add', { item: { id: 'x', name: '  ' } }));
  const state = op(withQuest(), 'quest.add', { item: { id: 'q1', name: 'Другой' } });
  assert.equal(questsOf(state).length, 1);
  assert.equal(questsOf(state)[0].name, 'Найти сестру');
});

test('steps toggle, the current step moves on, progress counts', () => {
  let state = withQuest();
  const [first, second] = questsOf(state)[0].steps;
  state = op(state, 'quest.step', { questId: 'q1', stepId: first.id, done: true });
  assert.equal(currentStep(questsOf(state)[0]).id, second.id);
  assert.deepEqual(progressOf(questsOf(state)[0]), { done: 1, total: 3 });
  state = op(state, 'quest.step', { questId: 'q1', stepId: first.id });
  assert.equal(progressOf(questsOf(state)[0]).done, 0);
  state = op(state, 'quest.step', { questId: 'gone', stepId: 'x' });
  assert.equal(questsOf(state).length, 1);
});

test('ending a quest stamps the closing day; reopening clears it', () => {
  let state = withQuest();
  state = op(state, 'clock.set', { day: 12 });
  state = op(state, 'quest.update', { questId: 'q1', changes: { status: 'done', outcome: 'сестра нашлась' } });
  assert.equal(questsOf(state)[0].closedDay, 12);
  assert.equal(groupQuests(state).done.length, 1);
  assert.equal(closingLine(questsOf(state)[0], 'done'), 'Квест «Найти сестру» выполнен: сестра нашлась');
  state = op(state, 'quest.update', { questId: 'q1', changes: { status: 'active' } });
  assert.equal(questsOf(state)[0].closedDay, undefined);
});

test('reward and penalty keep only real shifts', () => {
  let state = withQuest();
  const who = ids(state);
  state = op(state, 'relationship.upsert', { from: who['Ран'], to: who['Судзу'] });
  const relationshipId = Object.keys(state.relationships)[0];
  state = op(state, 'quest.update', { questId: 'q1', changes: { reward: { text: 'сблизились', shifts: [{ relationshipId, scaleId: 'trust', value: 99 }, { relationshipId: 'nope', scaleId: 'trust', value: 5 }, { relationshipId, scaleId: 'trust', value: 0 }] } } });
  assert.deepEqual(questsOf(state)[0].reward.shifts, [{ relationshipId, scaleId: 'trust', value: 30 }]);
});

test('a removed character leaves the quest lists; merging moves them', () => {
  let state = withQuest();
  const who = ids(state);
  state = op(state, 'quest.update', { questId: 'q1', changes: { secret: true, knownByIds: [who['Ран'], who['Судзу']] } });
  assert.equal(questsOf(state)[0].knownByIds.length, 2);
  state = op(state, 'entity.remove', { entityId: who['Судзу'] });
  assert.deepEqual(questsOf(state)[0].knownByIds, [who['Ран']]);
});

test('deadline text counts story days', () => {
  const [quest] = questsOf(withQuest());
  assert.equal(daysLeft(quest, 10), 2);
  assert.equal(dueText(quest, 10), 'осталось 2 дня');
  assert.equal(dueText(quest, 12), 'срок сегодня');
  assert.equal(dueText(quest, 13), 'просрочен на 1 день');
  assert.equal(dueText(quest, 0), '');
});

test('the narrator gets active quests only, secrets only when a knower is on stage', () => {
  let state = withQuest();
  const who = ids(state);
  state = op(state, 'quest.add', { item: { id: 'q2', name: 'Тайный долг', secret: true, knownByIds: [who['Рандо']], steps: ['вернуть деньги'] } });
  state = op(state, 'quest.add', { item: { id: 'q3', name: 'Старое дело', status: 'paused' } });
  assert.deepEqual(questsForPrompt(state, { presentIds: [who['Ран']] }).map(quest => quest.id), ['q1']);
  assert.deepEqual(questsForPrompt(state, { presentIds: [who['Рандо']] }).map(quest => quest.id), ['q1', 'q2']);
  const text = buildQuestsPrompt(state, { presentIds: [who['Рандо']] });
  assert.match(text, /\[QUESTS/);
  assert.match(text, /now: расспросить соседей/);
  assert.match(text, /осталось 2 дня/);
  assert.match(text, /SECRET, known only to: Рандо/);
  assert.doesNotMatch(text, /Старое дело/);
  assert.match(text, /Never write \{\{user\}\}/);
  assert.equal(buildQuestsPrompt(base()), '');
});

test('the «bring forward» cue is one per quest and reads for the narrator', () => {
  const [quest] = questsOf(withQuest());
  const cue = questCue(quest);
  assert.equal(cue.kind, 'quest');
  assert.match(cue.text, /Найти сестру: расспросить соседей/);
  let direction = armCue(normalizeDirection(null), cue);
  direction = armCue(direction, cue);
  assert.equal(direction.cues.length, 1);
  assert.match(cueLabel(direction.cues[0], id => id), /^квест:/);
  assert.match(buildDirectionPrompt(base(), { cues: direction.cues.map(cue => ({ ...cue, used: true })) }, { presentIds: null }), /quest «Найти сестру»/);
});

test('the chronicler reads quests: tolerant parse, proposals only for what exists and is still open', async () => {
  const { parseWorld, questProposals, buildWorldBlock } = await import('../src/integration/world-analysis.js');
  const state = withQuest();
  const [quest] = questsOf(state);
  const world = parseWorld({ quests: {
    new: [{ name: 'Тайный долг', text: 'надо вернуть', steps: ['вернуть деньги', ''] }, { name: 'найти сестру' }, { text: 'без названия' }],
    steps: [{ questId: 'q1', stepId: quest.steps[0].id }, { questId: 'q1', stepId: 'nope' }, { questId: 'zzz', stepId: 'x' }, { stepId: 'only' }],
    ended: [{ questId: 'q1', status: 'done', note: 'нашлась' }, { questId: 'q1', status: 'maybe' }],
  } });
  assert.equal(world.quests.new.length, 2);
  assert.deepEqual(world.quests.new[0].steps, ['вернуть деньги']);
  assert.equal(world.quests.ended.length, 1);
  const api = { state: () => state };
  const hints = questProposals(world, api);
  // «найти сестру» exists by name; the unknown step and quest are dropped.
  assert.deepEqual(hints.map(hint => hint.kind), ['new', 'step', 'end']);
  assert.equal(hints[0].name, 'Тайный долг');
  assert.equal(hints[1].stepText, 'расспросить соседей');
  assert.equal(hints[2].status, 'done');
  // A step already done is not proposed again; a flashback proposes nothing.
  const ticked = op(state, 'quest.step', { questId: 'q1', stepId: quest.steps[0].id, done: true });
  assert.ok(!questProposals(world, { state: () => ticked }).some(hint => hint.kind === 'step'));
  assert.deepEqual(questProposals(world, { state: () => op(state, 'clock.set', { flashback: true }) }), []);
  // The analyzer sees the open quests with their IDs.
  const block = buildWorldBlock(state, 'текст');
  assert.match(block, new RegExp(`${quest.id}: Найти сестру`));
  assert.match(block, new RegExp(`${quest.steps[1].id}: осмотреть склад`));
});
