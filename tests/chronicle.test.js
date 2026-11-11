import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquaintanceOf, applyOperations, createDefaultState, createEntity, createOperation, dossier, presentIds, rollbackMessage,
} from '../src/core/index.js';
import {
  buildKnowledgeBlock, materializeKnowledge, parseKnowledge, selectKnowledgeCandidates,
} from '../src/integration/knowledge-analysis.js';
import { analyzeKnowledge, analyzeMessage, parseAnalysis } from '../src/integration/analyzer.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки', { aliases: ['Манджиро'] });
const draken = createEntity('Дракен');

/** Ran and Suzu talked in the alley (secret); Mikey and Draken fought at the bridge. Suzu is the persona. */
function world() {
  let state = applyOperations(createDefaultState(), [
    ...[ran, suzu, mikey, draken].map(entity => createOperation('entity.upsert', entity)),
    createOperation('event.add', { item: { id: 'bridge', text: 'Драка у моста', witnessIds: [mikey.id, draken.id] } }, { messageId: '90', messageIndex: 90 }),
    createOperation('event.add', { item: { id: 'alley', text: 'Ран и Судзу говорили в подворотне', witnessIds: [ran.id, suzu.id], secret: true } }, { messageId: '140', messageIndex: 140 }),
    createOperation('scene.set', { presentIds: [mikey.id, draken.id, suzu.id], location: 'гараж Тосвы' }, { messageId: '142', messageIndex: 142 }),
  ]);
  state = { ...state, ui: { ...state.ui, personaId: suzu.id } };
  return state;
}

const REPLY = 'Майки поднял голову от байка и прищурился: «Ты же вчера с Раном в подворотне была. Чего он хотел?»';

test('candidates: events someone in the scene does not know, secrets first', () => {
  const candidates = selectKnowledgeCandidates(world(), REPLY);
  assert.deepEqual(candidates.map(item => item.event.id), ['alley', 'bridge']);
  const alley = candidates[0];
  // On stage: Mikey, Draken, Suzu; mentioned: Ran. Mikey and Draken were not in the alley.
  assert.deepEqual(alley.unknownTo.sort(), [mikey.id, draken.id].sort());
  assert.deepEqual(candidates[1].unknownTo.sort(), [suzu.id, ran.id].sort(), 'the persona and the merely mentioned Ran missed the bridge fight');
});

test('candidates: disabled events are left out; similarity ranks when given; the limit holds', () => {
  let state = world();
  state = applyOperations(state, [createOperation('knowledge.toggle', { kind: 'event', itemId: 'alley', disabled: true })]);
  assert.deepEqual(selectKnowledgeCandidates(state, REPLY).map(item => item.event.id), ['bridge']);
  const ranked = selectKnowledgeCandidates(world(), REPLY, { similarity: new Map([['bridge', 0.9], ['alley', 0.2]]) });
  assert.deepEqual(ranked.map(item => item.event.id), ['bridge', 'alley']);
  assert.equal(selectKnowledgeCandidates(world(), REPLY, { limit: 1 }).length, 1);
});

test('knowledge block names the scene, who does not know, and who has not met', () => {
  const block = buildKnowledgeBlock(world(), REPLY, selectKnowledgeCandidates(world(), REPLY));
  assert.match(block, /present = .*Майки/);
  assert.match(block, /location = "гараж Тосвы"/);
  assert.match(block, /alley: Ран и Судзу говорили в подворотне \| saw: Ран, Судзу \| SECRET \| unknown to: .*Майки/);
  assert.match(block, /Майки \(.*\) & Судзу \(.*\): strangers|Судзу \(.*\) & Майки \(.*\): strangers/, 'the persona is a stranger to Mikey');
  assert.doesNotMatch(block, /Майки \(.*\) & Дракен/, 'two characters with no record: canon decides, not listed');
});

test('parseKnowledge keeps good items, drops bad ones, never throws', () => {
  assert.deepEqual(parseKnowledge(null), { scene: null, events: [], learned: [], met: [], leaks: [], deaths: [] });
  const parsed = parseKnowledge({
    scene: { presentIds: ['a', 'a', 7, 'b'], location: '  склад  ' },
    events: [{ text: '' }, { key: 'n1', text: 'Признание', witnessIds: ['a'], secret: 'yes' }],
    learned: [{ eventId: 'e', entityId: 'c', source: 'gossip' }, { eventId: 'e' }],
    met: [{ ids: ['a', 'b'], status: 'friends' }, { ids: ['a', 'b'], status: 'known' }],
    leaks: [{ entityId: 'c', eventId: 'e', quote: 'x'.repeat(500) }],
  });
  assert.deepEqual(parsed.scene, { presentIds: ['a', 'b'], entered: [], left: [], location: 'склад', lore: null });
  assert.deepEqual(parsed.events, [{ key: 'n1', text: 'Признание', witnessIds: ['a'], secret: false }]);
  assert.deepEqual(parsed.learned, [{ eventId: 'e', entityId: 'c', source: 'told' }]);
  assert.deepEqual(parsed.met, [{ ids: ['a', 'b'], status: 'known' }]);
  assert.equal(parsed.leaks[0].quote.length, 160);
});

test('parseAnalysis: knowledge is null when the chronicler was not asked', () => {
  assert.equal(parseAnalysis('{"operations":[]}').knowledge, null);
  assert.deepEqual(parseAnalysis('{"operations":[],"knowledge":{"leaks":[]}}').knowledge.leaks, []);
});

function analyse(state, knowledge, messageIndex = 143) {
  return applyAnalysisResult(state, { operations: [], knowledge },
    { transactionId: `message:${messageIndex}`, messageId: String(messageIndex), messageIndex }, [], { trackKnowledge: true });
}

test('a told secret becomes knowledge; names resolve; witnesses default to who is present', () => {
  const { state, operations, leaks } = analyse(world(), parseKnowledge({
    scene: { presentIds: ['Майки', 'Дракен', 'Судзу', 'Ран'], location: 'гараж Тосвы' },
    events: [{ key: 'n1', text: 'Ран признался, что следил за Тосвой' }],
    learned: [
      { eventId: 'alley', entityId: 'Манджиро', source: 'told', fromId: 'Ран' },
      { eventId: 'alley', entityId: 'Ран', source: 'told' },
    ],
    leaks: [],
  }));
  assert.deepEqual(leaks, []);
  assert.ok(operations.every(operation => operation.messageId === '143'), 'all journaled with the reply');
  const mikeyKnows = dossier(state, mikey.id).knows.find(item => item.event.id === 'alley');
  assert.deepEqual({ source: mikeyKnows.source, fromId: mikeyKnows.fromId }, { source: 'told', fromId: ran.id });
  assert.equal(state.knowledge.learned.filter(entry => entry.entityId === ran.id).length, 0, 'a witness is never "told"');
  const confession = state.knowledge.events.find(event => event.text.startsWith('Ран признался'));
  assert.deepEqual(confession.witnessIds, [ran.id, suzu.id, mikey.id, draken.id].sort(), 'present at the end of the reply');
  assert.equal(confession.location, 'гараж Тосвы');
  assert.deepEqual(presentIds(state), [ran.id, suzu.id, mikey.id, draken.id].sort());
});

test('a leak is kept only while the character still cannot know', () => {
  const leak = { entityId: mikey.id, eventId: 'alley', quote: 'Ты же вчера с Раном в подворотне была' };
  const alone = analyse(world(), parseKnowledge({ leaks: [leak, leak] }));
  assert.deepEqual(alone.leaks, [leak], 'one leak, duplicates merged');
  assert.equal(alone.operations.length, 0, 'a leak itself writes nothing to the journal');
  const toldInTheSameReply = analyse(world(), parseKnowledge({
    learned: [{ eventId: 'alley', entityId: mikey.id, source: 'rumor' }],
    leaks: [leak],
  }));
  assert.deepEqual(toldInTheSameReply.leaks, [], 'he heard the rumour on page, so it is not a leak');
  assert.deepEqual(analyse(world(), parseKnowledge({ leaks: [{ ...leak, entityId: ran.id }] })).leaks, [], 'a witness cannot leak');
});

test('introductions only move forward; pairs without a record stay to the canon', () => {
  let { state } = analyse(world(), parseKnowledge({ met: [{ ids: [mikey.id, suzu.id], status: 'seen' }, { ids: [mikey.id, draken.id], status: 'known' }] }));
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'seen');
  assert.equal(acquaintanceOf(state, mikey.id, draken.id), null, 'nothing recorded for two characters');
  ({ state } = analyse(state, parseKnowledge({ met: [{ ids: [mikey.id, suzu.id], status: 'known' }] }), 144));
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'known');
  ({ state } = analyse(state, parseKnowledge({ met: [{ ids: [mikey.id, suzu.id], status: 'seen' }] }), 145));
  assert.equal(acquaintanceOf(state, mikey.id, suzu.id), 'known', 'never back to "seen"');
});

test('an unchanged scene writes nothing; swiping the reply restores everything', () => {
  const quiet = analyse(world(), parseKnowledge({ scene: { presentIds: [mikey.id, draken.id, suzu.id], location: 'гараж Тосвы' } }));
  assert.equal(quiet.operations.length, 0);
  const busy = analyse(world(), parseKnowledge({
    scene: { presentIds: [mikey.id], location: 'мост' },
    events: [{ key: 'n1', text: 'Майки один на мосту', witnessIds: [mikey.id] }],
    learned: [{ eventId: 'alley', entityId: mikey.id, source: 'rumor' }],
    met: [{ ids: [mikey.id, suzu.id], status: 'known' }],
  }));
  const back = rollbackMessage(busy.state, '143');
  assert.deepEqual(back.knowledge, world().knowledge);
});

test('who came and went wins over a cast list the model merely repeated', () => {
  // world(): Майки, Дракен and Судзу are in the garage; Ран is elsewhere.
  const same = [mikey.id, draken.id, suzu.id];
  const cast = scene => analyse(world(), parseKnowledge({ scene })).state.knowledge.scene.presentIds;
  assert.deepEqual(cast({ presentIds: same, entered: [ran.id] }), [...same, ran.id].sort(), 'вошёл, а список повторён старый');
  assert.deepEqual(cast({ presentIds: same, left: [draken.id] }), [mikey.id, suzu.id].sort(), 'ушёл, а в списке остался');
  assert.deepEqual(cast({ entered: [ran.id], left: [suzu.id] }), [mikey.id, draken.id, ran.id].sort(), 'списка нет вовсе');
  assert.deepEqual(cast({ presentIds: same, entered: [ran.id], left: [ran.id] }), same.slice().sort(), 'зашёл и вышел за один ответ');
  assert.equal(parseKnowledge({ scene: { location: 'мост' } }).scene, null);
});

test('a new event repeating a known one maps onto it instead of duplicating', () => {
  const { state } = analyse(world(), parseKnowledge({
    events: [{ key: 'n1', text: 'Драка  у  моста', witnessIds: [suzu.id] }],
    learned: [{ eventId: 'n1', entityId: suzu.id, source: 'rumor' }],
  }));
  assert.equal(state.knowledge.events.length, 2);
  assert.equal(dossier(state, suzu.id).knows.find(item => item.event.id === 'bridge').source, 'rumor');
});

test('trackKnowledge off: the chronicle is ignored', () => {
  const result = applyAnalysisResult(world(), { operations: [], knowledge: parseKnowledge({ scene: { presentIds: [ran.id] } }) },
    { messageId: '143' }, [], { trackKnowledge: false });
  assert.equal(result.operations.length, 0);
  assert.deepEqual(result.leaks, []);
});

test('materializeKnowledge with nothing to do is a no-op', () => {
  assert.deepEqual(materializeKnowledge(null, {}), { leaks: [], deaths: [], reveals: [], secrets: [] });
});

function fakeModel(reply) {
  const calls = [];
  return {
    calls,
    context: {
      async generateRaw(options) { calls.push(options); return reply; },
      getTokenCount: text => Math.ceil(text.length / 4),
    },
  };
}

const SETTINGS = { analysisMaxCharacters: 12000 };

test('the analyzer sends the knowledge block and rules only when asked', async () => {
  const quiet = fakeModel('{"operations":[]}');
  await analyzeMessage(quiet.context, world(), { mes: REPLY }, SETTINGS);
  assert.doesNotMatch(quiet.calls[0].prompt[0].content, /KNOWLEDGE RULES/);
  assert.doesNotMatch(quiet.calls[0].prompt[1].content, /KNOWLEDGE TRACKING/);

  const asked = fakeModel(JSON.stringify({ operations: [], knowledge: { leaks: [{ entityId: mikey.id, eventId: 'alley', quote: 'подворотне' }] } }));
  const result = await analyzeMessage(asked.context, world(), { mes: REPLY }, SETTINGS, '', { knowledge: { candidates: selectKnowledgeCandidates(world(), REPLY) } });
  assert.match(asked.calls[0].prompt[0].content, /KNOWLEDGE RULES/);
  assert.match(asked.calls[0].prompt[1].content, /KNOWLEDGE TRACKING[\s\S]*alley:/);
  assert.equal(result.knowledge.leaks[0].eventId, 'alley');
});

test('separate-request mode: its own prompt, parsed into a chronicle', async () => {
  const model = fakeModel(JSON.stringify({ knowledge: { met: [{ ids: [mikey.id, suzu.id], status: 'known' }] } }));
  const chronicle = await analyzeKnowledge(model.context, world(), { mes: REPLY }, SETTINGS, selectKnowledgeCandidates(world(), REPLY));
  assert.equal(model.calls.length, 1);
  assert.match(model.calls[0].prompt[0].content, /You track who knows what/);
  assert.match(model.calls[0].prompt[1].content, /Scene \(the reply to check\)/);
  assert.deepEqual(chronicle.knowledge.met, [{ ids: [mikey.id, suzu.id], status: 'known' }]);
  assert.equal(chronicle.world, null, 'the scene state was not asked');
});
