import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, createDefaultState, createOperation, validateState } from '../src/core/index.js';
import {
  BUILTIN_CLIMATES, BUILTIN_SCENARIOS, addScenario, cleanWeather, findClimate, forecastDay, normalizeClimate, normalizePlan, removeScenario, scenarioFrom,
  weatherBadge, weatherFor, weatherLine, weekForecast,
} from '../src/core/weather.js';
import { materializeWeather, parseWorld } from '../src/integration/world-analysis.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';
import { parseClimate } from '../src/integration/weather-generation.js';

const meta = { transactionId: 't', reason: 'test', timestamp: '2026-01-01T00:00:00.000Z' };
const withClock = (day, extra = {}) => {
  let state = createDefaultState();
  state = applyOperation(state, createOperation('clock.set', { day, time: '14:00' }, meta));
  for (const [kind, payload] of Object.entries(extra)) state = applyOperation(state, createOperation(kind, payload, meta));
  return state;
};
const tokyo = BUILTIN_CLIMATES.find(item => item.id === 'tokyo');

test('every ready climate has twelve usable months', () => {
  for (const item of BUILTIN_CLIMATES) {
    assert.equal(item.months.length, 12, item.id);
    assert.ok(normalizeClimate({ id: item.id, name: item.name, months: item.months }), item.id);
  }
  assert.equal(normalizeClimate({ id: 'x', name: 'x', months: [] }), null);
  assert.equal(findClimate('tokyo').name, 'Токио и центральная Япония');
});

test('the forecast is the same every time, stays in the month range and spells in streaks', () => {
  const first = forecastDay(tokyo, { day: 12, month: 6 });
  assert.deepEqual(forecastDay(tokyo, { day: 12, month: 6 }), first);
  for (let day = 1; day <= 60; day += 1) {
    const found = forecastDay(tokyo, { day, month: 1 });
    assert.ok(found.temp >= 2 - 2 && found.temp <= 10, `temp ${found.temp}`);
    assert.ok(['clear', 'cloudy', 'wind', 'snow'].includes(found.kind), found.kind);
  }
  assert.equal(forecastDay(tokyo, { day: 0, month: 6 }), null);
  // June in Tokyo is the rainy season: rain is the commonest kind.
  const counts = {};
  for (let day = 1; day <= 200; day += 1) { const { kind } = forecastDay(tokyo, { day, month: 6 }); counts[kind] = (counts[kind] ?? 0) + 1; }
  assert.equal(Object.entries(counts).sort((left, right) => right[1] - left[1])[0][0], 'rain');
});

test('what is in force: a lock beats everything, then what was set today, then a scenario, then the forecast', () => {
  const plan = { climateId: 'tokyo', month: 6, scenarios: [{ id: 's', name: 'Тайфун', startDay: 5, days: 2, kind: 'storm', tempDelta: -3, text: 'шквал' }] };
  const options = day => ({ plan, climates: [], date: '', day, part: 'day' });
  const idle = withClock(3);
  assert.equal(weatherFor(idle, options(3)).source, 'forecast');
  const scenic = weatherFor(withClock(5), options(5));
  assert.deepEqual([scenic.kind, scenic.source, scenic.scenario], ['storm', 'scenario', 'Тайфун']);
  assert.equal(weatherFor(withClock(7), options(7)).source, 'forecast', 'the scenario ended');
  // Set today wins over the scenario; yesterday's set weather does not carry over.
  const set = withClock(5, { 'weather.set': { kind: 'clear', temp: 20, text: 'солнце' } });
  assert.deepEqual([weatherFor(set, options(5)).kind, weatherFor(set, options(5)).source], ['clear', 'set']);
  assert.equal(weatherFor(set, options(7)).source, 'forecast');
  const locked = withClock(5, { 'weather.set': { kind: 'snow', temp: -3, lock: true } });
  assert.deepEqual([weatherFor(locked, options(9)).kind, weatherFor(locked, options(9)).source], ['snow', 'lock']);
  // Nothing known: no weather, no guessing.
  assert.equal(weatherFor(withClock(3), { plan: {}, climates: [], date: '', day: 3 }), null);
  assert.equal(weatherFor(withClock(3), { plan: { climateId: 'tokyo' }, climates: [], date: '', day: 3 }), null, 'no month known');
  // The month comes from the calendar date when there is one.
  const dated = weatherFor(withClock(3), { plan: { climateId: 'tokyo' }, climates: [], date: '2026-01-15', day: 3 });
  assert.ok(dated && dated.temp <= 12);
});

test('the time of day shifts the temperature of a forecast, not a stated one', () => {
  const plan = { climateId: 'tokyo', month: 7 };
  const noon = weatherFor(withClock(4), { plan, climates: [], date: '', day: 4, part: 'day' });
  const night = weatherFor(withClock(4), { plan, climates: [], date: '', day: 4, part: 'night' });
  assert.equal(noon.temp - night.temp, 4);
  const set = withClock(4, { 'weather.set': { kind: 'rain', temp: 14 } });
  assert.equal(weatherFor(set, { plan, climates: [], date: '', day: 4, part: 'night' }).temp, 14);
});

test('weather.set is journaled: set, replaced, cleared, and the state stays valid', () => {
  let state = withClock(2);
  state = applyOperation(state, createOperation('weather.set', { kind: 'rain', temp: 14.4, text: '  моросит,   лужи ' }, meta));
  assert.deepEqual(state.world.weather, { kind: 'rain', temp: 14, text: 'моросит, лужи', day: 2 });
  state = applyOperation(state, createOperation('weather.set', { kind: 'fog', lock: true }, meta));
  assert.deepEqual([state.world.weather.kind, state.world.weather.lock, state.world.weather.temp], ['fog', true, null]);
  state = applyOperation(state, createOperation('weather.set', { kind: 'nonsense' }, meta));
  assert.equal(state.world.weather.kind, 'fog', 'an unknown kind changes nothing');
  assert.equal(validateState(state).valid, true);
  state = applyOperation(state, createOperation('weather.set', { clear: true }, meta));
  assert.equal(state.world.weather, undefined);
  assert.equal(cleanWeather({ kind: 'rain', temp: 999 }).temp, null);
});

test('scenarios: from a ready template, added in day order, replaced, removed', () => {
  const typhoon = BUILTIN_SCENARIOS.find(item => item.id === 'typhoon');
  const made = scenarioFrom(typhoon, 10, 3);
  assert.deepEqual([made.startDay, made.days, made.kind], [10, 3, 'storm']);
  let plan = addScenario({}, made);
  plan = addScenario(plan, scenarioFrom(BUILTIN_SCENARIOS.find(item => item.id === 'heatwave'), 2));
  assert.deepEqual(plan.scenarios.map(item => item.startDay), [2, 10]);
  assert.equal(addScenario(plan, made).scenarios.length, 2, 'the same one is replaced, not doubled');
  assert.equal(removeScenario(plan, made.id).scenarios.length, 1);
  assert.throws(() => addScenario(plan, { kind: 'rain', startDay: 0, days: 2 }), /день начала/);
  assert.deepEqual(normalizePlan({ climateId: 'x', month: 13, scenarios: [{ kind: 'bad', startDay: 1, days: 1 }] }), { climateId: 'x', month: 0, scenarios: [] });
  const snowfall = scenarioFrom(BUILTIN_SCENARIOS.find(item => item.id === 'snowfall'), 4);
  assert.equal(snowfall.temp, -1);
});

test('the week ahead: the first day shows what is set, the others the forecast', () => {
  const state = withClock(5, { 'weather.set': { kind: 'clear', temp: 21 } });
  const week = weekForecast(state, { plan: { climateId: 'tokyo', month: 6 }, climates: [], dateOfDay: day => `2026-06-${String(day).padStart(2, '0')}` });
  assert.equal(week.length, 7);
  assert.deepEqual([week[0].source, week[0].kind, week[0].date], ['set', 'clear', '2026-06-05']);
  assert.ok(week.slice(1).every(item => item.source === 'forecast'));
  assert.deepEqual(weekForecast(withClock(0), { plan: { climateId: 'tokyo', month: 6 } }), []);
});

test('the scene block carries one weather line with its rule, none in a flashback', () => {
  const state = withClock(3);
  const weather = { kind: 'rain', temp: 14, text: 'моросит', source: 'set' };
  assert.equal(weatherLine(weather), 'weather: rain, about +14°C — моросит');
  assert.equal(weatherBadge(weather), '🌧 14°');
  const block = buildScenePrompt(state, { weather });
  assert.match(block, /weather: rain, about \+14°C — моросит/);
  assert.match(block, /weather is outdoors/);
  assert.doesNotMatch(buildScenePrompt(state, {}), /weather/);
  const flash = applyOperation(state, createOperation('clock.set', { flashback: true }, meta));
  assert.doesNotMatch(buildScenePrompt(flash, { weather }), /weather/);
});

test('the chronicler: weather is read tolerantly and recorded once; a lock and a flashback are respected', () => {
  const parsed = parseWorld({ weather: { kind: 'rain', tempC: '14', text: ' моросит ' } }).weather;
  assert.deepEqual(parsed, { kind: 'rain', temp: 14, text: 'моросит' });
  assert.equal(parseWorld({ weather: { kind: 'tornado' } }).weather, null);
  assert.equal(parseWorld({ weather: { kind: 'snow', tempC: 400 } }).weather.temp, null);
  const run = state => { const ops = []; materializeWeather({ weather: parsed }, { state: () => state, add: (type, payload, reason) => ops.push({ type, payload, reason }) }); return ops; };
  const fresh = withClock(2);
  const ops = run(fresh);
  assert.deepEqual([ops.length, ops[0].type, ops[0].payload.kind], [1, 'weather.set', 'rain']);
  assert.match(ops[0].reason, /Погода: дождь, моросит/);
  const same = applyOperation(fresh, createOperation('weather.set', ops[0].payload, meta));
  assert.deepEqual(run(same), [], 'the same weather again is not recorded twice');
  assert.deepEqual(run(applyOperation(fresh, createOperation('weather.set', { kind: 'clear', lock: true }, meta))), [], 'locked by hand');
  assert.deepEqual(run(applyOperation(fresh, createOperation('clock.set', { flashback: true }, meta))), [], 'a flashback says nothing about now');
  const tomorrow = applyOperation(same, createOperation('clock.set', { day: 3 }, meta));
  assert.equal(run(tomorrow).length, 1, 'a new day, the same rain: recorded for that day');
});

test('a climate from the model must have twelve months', () => {
  const months = BUILTIN_CLIMATES[0].months;
  assert.equal(parseClimate({ name: 'Мой', months }, 'c1').months.length, 12);
  assert.throws(() => parseClimate({ name: 'Мой', months: months.slice(0, 5) }, 'c1'), /двенадцать/);
  assert.throws(() => parseClimate({ name: 'Мой', months: months.map(item => ({ ...item, kinds: {} })) }, 'c1'));
});
