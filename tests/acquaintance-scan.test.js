import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcquaintanceScan, scanAcquaintances } from '../src/integration/acquaintance-scan.js';

const state = {
  entities: {
    ran: { id: 'ran', name: 'Ран', aliases: [] },
    rindo: { id: 'rindo', name: 'Риндо', aliases: [] },
    suzu: { id: 'suzu', name: 'Судзу', aliases: [] },
  },
  ui: { personaId: 'suzu' },
};

test('only well-formed pairs of registered characters survive', () => {
  const ids = new Set(Object.keys(state.entities));
  const pairs = parseAcquaintanceScan(JSON.stringify({ pairs: [
    { ids: ['ran', 'rindo'], status: 'known', evidence: 'Ран — старший брат Риндо' },
    { ids: ['rindo', 'ran'], status: 'known' },
    { ids: ['ran', 'ghost'], status: 'known' },
    { ids: ['ran', 'rindo', 'suzu'], status: 'known' },
    { ids: ['ran', 'suzu'], status: 'friends' },
    { ids: ['rindo', 'suzu'], status: 'seen', evidence: 'x'.repeat(300) },
  ] }), ids);
  assert.deepEqual(pairs.map(pair => `${pair.firstId}|${pair.secondId}:${pair.status}`), ['ran|rindo:known', 'rindo|suzu:seen']);
  assert.equal(pairs[1].evidence.length, 160);
});

test('the model gets the registry, the persona and the lore; the answer is parsed', async () => {
  const calls = [];
  const context = { async generateRaw(options) { calls.push(options); return '{"pairs":[{"ids":["ran","rindo"],"status":"known","evidence":"братья"}]}'; } };
  const pairs = await scanAcquaintances(context, state, { loreContext: '## Ран\nСтарший брат Риндо.' });
  assert.match(calls[0].prompt[0].content, /same group, gang or school alone is NOT evidence/);
  assert.match(calls[0].prompt[1].content, /The user persona is suzu \(Судзу\)/);
  assert.match(calls[0].prompt[1].content, /Старший брат Риндо/);
  assert.deepEqual(pairs, [{ firstId: 'ran', secondId: 'rindo', status: 'known', evidence: 'братья' }]);
});

test('no lore: a clear error instead of a guess', async () => {
  await assert.rejects(scanAcquaintances({ generateRaw: async () => '{}' }, state, {}), /Нет лора для скана/);
});
