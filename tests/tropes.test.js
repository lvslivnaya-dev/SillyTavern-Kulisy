import test from 'node:test';
import assert from 'node:assert/strict';
import { pairTropeFactors, pairTropes, triangleTropeFactors, triangleTropes } from '../src/integration/tropes.js';
import { applyOperations, createDefaultState, createOperation, selectRuntimePrompt } from '../src/core/index.js';

const SCALES = createDefaultState().config.scales.map(scale => scale.id);
const TRIANGLE = { id: 't', name: 'Тест', centerId: 'c', firstId: 'a', secondId: 'b' };

test('every pair trope yields valid factors on the default scales', () => {
  assert.ok(pairTropes().length >= 8);
  for (const trope of pairTropes()) {
    const factors = pairTropeFactors(trope.id, SCALES);
    assert.ok(factors.length >= 4, trope.id);
    assert.ok(factors.every(factor => SCALES.includes(factor.scaleId) && ['up', 'down'].includes(factor.direction) && factor.text.length <= 200));
    assert.ok(factors.some(factor => factor.direction === 'down'), `${trope.id}: есть и рост, и падение`);
  }
});

test('pair trope skips scales the chat does not have', () => {
  const factors = pairTropeFactors('slowburn', ['trust', 'love']);
  assert.ok(factors.every(factor => ['trust', 'love'].includes(factor.scaleId)));
  assert.ok(factors.length > 0);
});

test('triangle trope expands roles to both sides symmetrically and suggests a goal', () => {
  const result = triangleTropeFactors('love-triangle', TRIANGLE, SCALES);
  assert.ok(result.goal.length > 20);
  const lines = new Set(result.factors.map(factor => `${factor.from}>${factor.to}`));
  for (const line of ['a>c', 'b>c', 'a>b', 'b>a', 'c>a', 'c>b']) assert.ok(lines.has(line), line);
  assert.ok(result.factors.every(factor => factor.from !== factor.to));
});

test('triangle trope never writes factors for the persona\'s own feelings', () => {
  const result = triangleTropeFactors('love-triangle', { ...TRIANGLE, centerId: 'p' }, SCALES, 'p');
  assert.ok(result.factors.length > 0);
  assert.ok(result.factors.every(factor => factor.from !== 'p'));
  assert.ok(triangleTropes().every(trope => trope.goal));
});

test('triangle goal reaches the runtime prompt with a do-not-rush rule', () => {
  const state = applyOperations(createDefaultState(), ['c', 'a', 'b'].map(id => createOperation('entity.upsert', { id, name: id.toUpperCase() })));
  state.ui.triangles = [{ ...TRIANGLE, goal: 'C выбирает A' }];
  const text = selectRuntimePrompt(state, { maxCharacters: 4000 });
  assert.match(text, /long-term end point: C выбирает A — a distant direction/);
  assert.match(text, /never rush/);
});

test('new tropes: united front, fast passion, body first, both sides of violence', async () => {
  const { pairTropePace } = await import('../src/integration/tropes.js');
  const ids = pairTropes().map(trope => trope.id);
  for (const id of ['fast-passion', 'body-first', 'violence-victim', 'violence-aggressor']) assert.ok(ids.includes(id), id);
  assert.deepEqual(pairTropePace('body-first', SCALES), { attraction: 'fast', love: 'slow', trust: 'slow', affection: 'slow' });
  assert.equal(pairTropePace('fast-passion', SCALES).love, 'fast');
  assert.ok(pairTropes().every(trope => trope.description.length > 20), 'у каждого тропа есть описание');
  const united = triangleTropeFactors('united-front', TRIANGLE, SCALES).factors;
  assert.ok(united.some(factor => factor.from === 'a' && factor.to === 'b' && factor.scaleId === 'jealousy' && factor.direction === 'down'));
  assert.ok(!united.some(factor => factor.scaleId === 'jealousy' && factor.direction === 'up'), 'никакой ревности между сторонами');
});

test('pace: slow caps, fast amplifies, spills respect slow scales, rollback undoes it', async () => {
  const { applyAnalysisResult, pacedDelta } = await import('../src/integration/analysis-operations.js');
  const { parseAnalysis } = await import('../src/integration/analyzer.js');
  const { rollbackMessage } = await import('../src/core/index.js');
  assert.equal(pacedDelta(7, 'slow'), 2);
  assert.equal(pacedDelta(-7, 'slow'), -2);
  assert.equal(pacedDelta(6, 'fast'), 9);
  assert.equal(pacedDelta(20, 'fast'), 25);
  assert.equal(pacedDelta(5, undefined), 5);
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: [], pace: { attraction: 'fast', love: 'slow', affection: 'slow' } })]);
  const result = parseAnalysis(JSON.stringify({ operations: [
    { subjectId: 'a', objectId: 'b', metric: 'attraction', delta: 6, reason: 'Близость' },
    { subjectId: 'a', objectId: 'b', metric: 'love', delta: 8, reason: 'Признание' },
  ] }));
  const applied = applyAnalysisResult(state, result, { messageId: '9' }).state;
  const scales = applied.relationships[id].scales;
  assert.equal(scales.attraction, 9, 'быстро: 6 × 1,5');
  assert.equal(scales.love, 2, 'медленно: не больше 2');
  assert.ok(Math.abs(scales.affection) <= 2, 'связанная шкала с медленным темпом тоже ограничена');
  assert.equal(rollbackMessage(applied, '9').relationships[id].scales.attraction, 0);
});

test('factor origin and pace survive the journal; an unknown origin is dropped', () => {
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, pace: { love: 'slow', ghost: 'fast' }, factors: [
    { scaleId: 'trust', direction: 'up', text: 'Тропный', origin: 'pair-trope:slowburn' },
    { scaleId: 'trust', direction: 'down', text: 'Странный', origin: '<script>' },
  ] })]);
  const relation = state.relationships[id];
  assert.equal(relation.factors[0].origin, 'pair-trope:slowburn');
  assert.equal(relation.factors[1].origin, undefined);
  assert.deepEqual(relation.pace, { love: 'slow' });
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: relation.factors })]);
  assert.deepEqual(state.relationships[id].pace, { love: 'slow' }, 'без pace в операции темп не сбрасывается');
});

test('obsession: both sides exist, the obsessed line grows fast', async () => {
  const { pairTropePace } = await import('../src/integration/tropes.js');
  const ids = pairTropes().map(trope => trope.id);
  assert.ok(ids.includes('obsession') && ids.includes('obsessed-over'));
  assert.equal(pairTropePace('obsession', SCALES).dependency, 'fast');
  assert.ok(pairTropeFactors('obsession', SCALES).length >= 10);
});

test('trope texts are about what the other one does, with names and genders filled in', async () => {
  const { fillTropeText } = await import('../src/integration/tropes.js');
  const people = { subj: { name: 'Ран', gender: 'male' }, obj: { name: 'Судзу', gender: 'female' } };
  const texts = pairTropeFactors('protector', SCALES, people).map(factor => factor.text);
  assert.ok(texts.includes('Судзу не пришла, когда была нужна'), texts.join('\n'));
  assert.ok(texts.includes('Судзу защищает его без просьбы'));
  assert.equal(fillTropeText('{obj} {o:пришёл|пришла}', { obj: 'Майки' }), 'Майки пришёл/пришла', 'gender not set: both forms');
  assert.equal(fillTropeText('{o:был|была} рядом'), 'Был/была рядом');
  for (const trope of pairTropes()) {
    for (const factor of pairTropeFactors(trope.id, SCALES, people)) {
      assert.doesNotMatch(factor.text, /\{|\}/, `${trope.id}: all placeholders filled`);
    }
  }
});

test('names only stand in the nominative: no placeholder right after a preposition', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../src/integration/tropes.js', import.meta.url), 'utf8');
  const bad = source.match(/(?:^|[\s«(])(?:с|со|к|о|об|у|для|от|без|про|над|под|при|за|на|в|из|ради|перед|после|рядом с)\s+\{(?:obj|subj|center|rival)\}/gimu) ?? [];
  assert.deepEqual(bad, []);
});

test('triangle trope texts get each line\'s own names', () => {
  const names = { a: { name: 'Ран', gender: 'male' }, b: { name: 'Риндо', gender: 'male' }, c: { name: 'Судзу', gender: 'female' } };
  const { factors } = triangleTropeFactors('love-triangle', TRIANGLE, SCALES, '', id => names[id]);
  const line = factors.find(factor => factor.from === 'a' && factor.to === 'c' && factor.scaleId === 'love');
  assert.equal(line.text, 'Судзу выбирает его, а Риндо остаётся в стороне');
});

test('chat tempo scales every change before the line pace; a change never vanishes', async () => {
  const { applyAnalysisResult, tempoDelta } = await import('../src/integration/analysis-operations.js');
  assert.equal(tempoDelta(10, 'very-slow'), 3, '×0.4 = 4, capped at 3');
  assert.equal(tempoDelta(1, 'very-slow'), 1, 'never zero');
  assert.equal(tempoDelta(-8, 'slow'), -5);
  assert.equal(tempoDelta(6, 'fast'), 9);
  assert.equal(tempoDelta(6, 'normal'), 6);
  assert.equal(tempoDelta(6, undefined), 6);
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: [], pace: { love: 'fast' } })]);
  const result = { operations: [
    { subjectId: 'a', objectId: 'b', metric: 'trust', delta: 10, reason: 'r' },
    { subjectId: 'a', objectId: 'b', metric: 'love', delta: 10, reason: 'r' },
  ] };
  const applied = applyAnalysisResult(state, result, { messageId: '1' }, [], { linkedScales: false, tempo: 'slow' });
  assert.equal(applied.state.relationships[id].scales.trust, 6, '10 × 0.65 = 6.5 → 7, capped at 6');
  assert.equal(applied.state.relationships[id].scales.love, 9, 'chat slow (6) then line fast (×1.5)');
  assert.match(applied.operations[0].reason, /темп чата: медленно/);
});

test('the analyzer may name the factor it matched; it is kept only when scale and direction agree', async () => {
  const { applyAnalysisResult } = await import('../src/integration/analysis-operations.js');
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'a', name: 'A' }),
    createOperation('entity.upsert', { id: 'b', name: 'B' }),
    createOperation('relationship.upsert', { from: 'a', to: 'b' }),
  ]);
  const id = Object.keys(state.relationships)[0];
  state = applyOperations(state, [createOperation('factors.set', { relationshipId: id, factors: [
    { scaleId: 'trust', direction: 'up', text: 'B держит слово' },
    { scaleId: 'fear', direction: 'up', text: 'B угрожает' },
  ] })]);
  const { operations } = applyAnalysisResult(state, { operations: [
    { subjectId: 'a', objectId: 'b', metric: 'trust', delta: 3, reason: 'сдержал обещание', factor: 1 },
    { subjectId: 'a', objectId: 'b', metric: 'respect', delta: 2, reason: 'не то', factor: 2 },
    { subjectId: 'a', objectId: 'b', metric: 'trust', delta: -2, reason: 'не в ту сторону', factor: 1 },
  ] }, { messageId: '1' }, [], { linkedScales: false });
  assert.equal(operations[0].payload.factor, 'B держит слово');
  assert.match(operations[0].reason, /по фактору: «B держит слово»/);
  assert.equal(operations[1].payload.factor, undefined, 'another scale');
});
