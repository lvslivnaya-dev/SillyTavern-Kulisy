import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCALES, applyOperation, createDefaultState, createOperation, exportState, importState, validateState } from '../src/core/index.js';
import { HEAT_MAX_DROP, cleanHeat, heatFromReply, heatLevel, heatLine, nextHeat } from '../src/core/heat.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';
import { materializeHeat, parseWorld, buildWorldBlock } from '../src/integration/world-analysis.js';

const meta = { transactionId: 't', reason: 'test', timestamp: '2026-01-01T00:00:00.000Z' };
const op = (state, type, payload) => applyOperation(state, createOperation(type, payload, meta));

test('heat levels have words, and a calm scene sends nothing', () => {
  assert.equal(heatLevel(0).id, 'calm');
  assert.equal(heatLevel(45).id, 'mid');
  assert.equal(heatLevel(100).id, 'peak');
  assert.equal(heatLine({ value: 10 }), '');
  assert.match(heatLine({ value: 72, why: 'ссора перешла на крик' }), /scene heat: 72\/100 \(high: .*\) — ссора перешла на крик/);
});

test('heat.set sets, shifts, locks and clears; values stay in 0..100', () => {
  let state = createDefaultState();
  state = op(state, 'heat.set', { value: 150, why: 'драка' });
  assert.equal(state.world.heat.value, 100);
  state = op(state, 'heat.set', { delta: -30 });
  assert.equal(state.world.heat.value, 70);
  assert.equal(state.world.heat.why, 'драка', 'the reason stays when only the number moves');
  state = op(state, 'heat.set', { lock: true });
  assert.equal(state.world.heat.lock, true);
  state = op(state, 'heat.set', { clear: true });
  assert.equal(state.world.heat, undefined);
  assert.deepEqual(validateState(state).errors, []);
  assert.equal(cleanHeat({ value: 'x' }), null);
  assert.equal(nextHeat(null, { delta: -5 }), null);
});

test('the chronicler cannot drop the heat in one beat, nor touch a locked one, nor speak in a flashback', () => {
  const current = { value: 80 };
  assert.deepEqual(heatFromReply(current, { level: 10, why: 'помирились' }), { value: 80 - HEAT_MAX_DROP, why: 'помирились' });
  assert.equal(heatFromReply(current, { level: 10 }, { daysSkipped: 2 }).value, 10, 'days passed: calm may come');
  assert.equal(heatFromReply({ value: 80, lock: true }, { level: 10 }), null);
  assert.equal(heatFromReply(current, { level: 10 }, { flashback: true }), null);
  assert.equal(heatFromReply(current, { level: 81 }), null, 'a shift under three points is noise');
  assert.equal(heatFromReply(null, { level: 55, why: 'угроза' }).value, 55);
  assert.equal(heatFromReply({ value: 4 }, { level: 0 }).value, 0, 'the last bit of heat can go out');
});

test('the reply’s heat is read tolerantly, recorded as an operation and shown to the analyzer', () => {
  const world = parseWorld({ heat: { level: 130, why: 'угрожает ножом' } });
  assert.deepEqual(world.heat, { level: 100, why: 'угрожает ножом' });
  assert.equal(parseWorld({ heat: { level: 'high' } }).heat, null);
  const added = [];
  const state = op(createDefaultState(), 'heat.set', { value: 40, why: 'спор' });
  materializeHeat(world, { state: () => state, add: (type, payload, reason) => added.push([type, payload, reason]) });
  assert.deepEqual(added.map(item => item[0]), ['heat.set']);
  assert.equal(added[0][1].value, 100);
  assert.match(buildWorldBlock(state, 'текст'), /Scene heat before this reply: 40\/100 \(спор\)/);
});

test('the narrator gets the heat line and its rule only when the scene is charged', () => {
  let state = createDefaultState();
  state = op(state, 'clock.set', { day: 2, time: '20:00' });
  assert.doesNotMatch(buildScenePrompt(state), /scene heat/);
  state = op(state, 'heat.set', { value: 75, why: 'драка' });
  const text = buildScenePrompt(state);
  assert.match(text, /scene heat: 75\/100/);
  assert.match(text, /scene heat is how charged the whole scene is/);
  state = op(state, 'clock.set', { flashback: true });
  assert.doesNotMatch(buildScenePrompt(state), /scene heat: 75/, 'not while a flashback is told');
});

test('anxiety is a scale like any other, also in chats saved before it existed', () => {
  assert.ok(DEFAULT_SCALES.some(scale => scale.id === 'anxiety' && scale.label === 'Тревога'));
  const old = JSON.parse(exportState(createDefaultState()));
  old.config.scales = old.config.scales.filter(scale => scale.id !== 'anxiety');
  for (const relation of Object.values(old.relationships)) delete relation.scales.anxiety;
  const loaded = importState(old);
  assert.ok(loaded.config.scales.some(scale => scale.id === 'anxiety'));
});
