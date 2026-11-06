import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOperations, buildKnowledgePrompt, createDefaultState, createEntity, createOperation, selectKnowledgeLines,
} from '../src/core/index.js';

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');
const draken = createEntity('Дракен');
const rindo = createEntity('Риндо');

/** Garage scene: Mikey, Draken and the persona Suzu on stage. */
function garage() {
  let state = applyOperations(createDefaultState(), [
    ...[ran, suzu, mikey, draken, rindo].map(entity => createOperation('entity.upsert', entity)),
    createOperation('event.add', { item: { id: 'bridge', text: 'Драка у моста', witnessIds: [mikey.id, draken.id] } }),
    createOperation('event.add', { item: { id: 'alley', text: 'Ран и Судзу говорили в подворотне', witnessIds: [ran.id, suzu.id], secret: true } }),
    createOperation('event.add', { item: { id: 'warehouse', text: 'Риндо ранен на складе', witnessIds: [rindo.id, ran.id] } }),
    createOperation('learned.add', { item: { id: 'l1', eventId: 'warehouse', entityId: draken.id, source: 'rumor' } }),
    createOperation('acquaintance.set', { firstId: draken.id, secondId: suzu.id, status: 'seen' }),
    createOperation('scene.set', { presentIds: [mikey.id, draken.id, suzu.id], location: 'гараж Тосвы' }),
  ]);
  state = { ...state, ui: { ...state.ui, personaId: suzu.id } };
  return state;
}

test('the scene line names who is present and where', () => {
  const [first] = selectKnowledgeLines(garage());
  assert.match(first, /^scene: present=.*Майки.*; place=гараж Тосвы$/);
});

test('who has not met the persona comes right after the scene, the character first', () => {
  const lines = selectKnowledgeLines(garage());
  assert.equal(lines[1], 'strangers[Майки & Судзу]', 'nobody knows the persona by default');
  assert.ok(lines.includes('seen[Дракен & Судзу]'), 'met, names unknown');
  assert.ok(!lines.some(line => /strangers\[Майки & Дракен\]|strangers\[Дракен & Майки\]/.test(line)), 'two characters without a record: canon decides');
});

test('"unknown" lists what each character did not see and was not told, secrets first', () => {
  const lines = selectKnowledgeLines(garage());
  const mikeyLine = lines.find(line => line.startsWith('unknown[Майки]'));
  assert.equal(mikeyLine, 'unknown[Майки]: (secret) Ран и Судзу говорили в подворотне | Риндо ранен на складе');
  const drakenLine = lines.find(line => line.startsWith('unknown[Дракен]'));
  assert.equal(drakenLine, 'unknown[Дракен]: (secret) Ран и Судзу говорили в подворотне', 'the rumour counts as known');
  assert.ok(!lines.some(line => line.startsWith('unknown[Судзу]')), 'the persona is the user’s to play');
});

test('second-hand knowledge says how it was learned', () => {
  assert.ok(selectKnowledgeLines(garage()).includes('heard[Дракен]: rumour — Риндо ранен на складе'));
});

test('characters the last messages mention join the cast', () => {
  const lines = selectKnowledgeLines(garage(), { castIds: [mikey.id, draken.id, suzu.id, ran.id] });
  assert.ok(lines.some(line => line.startsWith('unknown[Ран]: Драка у моста')));
  assert.ok(lines.includes('strangers[Ран & Судзу]'), 'until an introduction is recorded, the persona rule holds for him too');
});

test('under a tight budget rumours go first, then old events; meetings and secrets stay', () => {
  const lines = selectKnowledgeLines(garage(), { maxCharacters: 200 });
  assert.ok(lines.some(line => line.startsWith('strangers[Майки & Судзу]')));
  assert.ok(lines.some(line => line.startsWith('unknown[Майки]: (secret)')));
  assert.ok(!lines.some(line => line.startsWith('heard[')), 'rumours left out first');
  assert.ok(lines.join('\n').length <= 200);
});

test('the block carries the rules, and is empty when there is nothing to say', () => {
  const block = buildKnowledgePrompt(garage());
  assert.match(block, /^\[KULISY — WHO KNOWS WHAT/);
  assert.match(block, /unknown\[X\] lists events X did NOT witness and was NOT told/);
  assert.match(block, /strangers\[A & B\]: A and B have never met\. They do not know each other's names/);
  assert.match(block, /have to get acquainted in the story first/);
  assert.equal(buildKnowledgePrompt(createDefaultState()), '');
});

test('switching an event off or introducing them removes the lines', () => {
  const state = applyOperations(garage(), [
    createOperation('knowledge.toggle', { kind: 'event', itemId: 'alley', disabled: true }),
    createOperation('acquaintance.set', { firstId: mikey.id, secondId: suzu.id, status: 'known' }),
  ]);
  const lines = selectKnowledgeLines(state);
  assert.ok(!lines.some(line => line.includes('подворотне')));
  assert.ok(!lines.some(line => line.startsWith('strangers[Майки')));
});
