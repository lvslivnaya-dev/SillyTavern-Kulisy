import test from 'node:test';
import assert from 'node:assert/strict';
import { EARTH_CLOCK, READY_SYSTEMS, makeClock, normalizeSystem, normalizeSystems, systemClimate, yearLength } from '../src/core/calendar-system.js';
import { addDays, daysBetween, humanDate, shortDate, weekdayOf } from '../src/core/calendar.js';
import { forecastDay } from '../src/core/weather.js';

const week = names => names.map(name => ({ name, short: name.slice(0, 2) }));
const system = (extra = {}) => normalizeSystem({
  id: 's1', name: 'Мой мир', era: 'эры Огня', startWeekday: 2,
  weekdays: week(['Первень', 'Второй', 'Третий', 'Четвёртый', 'Пятый']),
  seasons: [{ id: 'cold', name: 'Холод', min: -5, max: 3, kinds: { snow: 3, cloudy: 2 } }, { id: 'warm', name: 'Тепло', min: 14, max: 24, kinds: { clear: 4, rain: 1 } }],
  months: [{ name: 'Льдов', of: 'Льдов', days: 20, season: 'cold' }, { name: 'Цветов', days: 25, season: 'warm' }, { name: 'Зноя', of: 'Зноя', days: 30, season: 'warm' }],
  ...extra,
});

test('the earthly clock agrees with the old date functions', () => {
  for (const iso of ['2025-04-08', '2024-02-29', '1999-12-31', '2026-01-01']) {
    assert.equal(EARTH_CLOCK.weekdayOf(iso), weekdayOf(iso));
    assert.equal(EARTH_CLOCK.addDays(iso, 400), addDays(iso, 400));
    assert.equal(EARTH_CLOCK.humanDate(iso), humanDate(iso));
    assert.equal(EARTH_CLOCK.shortDate(iso), shortDate(iso));
  }
  assert.equal(EARTH_CLOCK.daysBetween('2025-04-08', '2025-05-08'), daysBetween('2025-04-08', '2025-05-08'));
  assert.equal(EARTH_CLOCK.parse('2025-02-30'), null);
  assert.equal(makeClock(null), EARTH_CLOCK);
  assert.deepEqual([EARTH_CLOCK.monthOf('2025-04-08'), EARTH_CLOCK.yearOf('2025-04-08'), EARTH_CLOCK.weekdayCount, EARTH_CLOCK.monthsCount], [4, 2025, 7, 12]);
});

test('a system needs weekdays, months, a name; the rest is tidied', () => {
  assert.equal(normalizeSystem(null), null);
  assert.equal(normalizeSystem({ id: 'x', name: 'n', weekdays: week(['a']), months: [{ name: 'm', days: 10 }] }), null, 'one weekday is not a week');
  assert.equal(normalizeSystem({ id: 'x', name: 'n', weekdays: week(['a', 'b']), months: [] }), null);
  const clean = system();
  assert.equal(yearLength(clean), 75);
  assert.deepEqual(clean.months.map(month => month.days), [20, 25, 30]);
  const odd = normalizeSystem({ id: 'x', name: 'n', startWeekday: 99, weekdays: week(['a', 'b']), months: [{ name: 'm', days: 500, season: 'nope' }, { name: ' ' }], leap: { every: 1 } });
  assert.deepEqual([odd.startWeekday, odd.months.length, odd.months[0].days, odd.months[0].season, odd.leap], [2, 1, 99, '', undefined]);
  assert.equal(normalizeSystems([clean, clean, null]).length, 1, 'the same id once');
  for (const ready of READY_SYSTEMS) assert.ok(ready && ready.months.length >= 10, ready?.name);
});

test('dates of your own calendar: parse, format and add days agree, across year ends', () => {
  const clock = makeClock(system());
  assert.equal(clock.parse('1-1-1'), 0);
  assert.equal(clock.parse('0001-01-01'), 0);
  assert.equal(clock.parse('0001-02-26'), null, 'month two has 25 days');
  assert.equal(clock.parse('0001-04-01'), null, 'there are three months');
  for (let index = 0; index < 400; index += 7) {
    const iso = clock.format(index);
    assert.equal(clock.parse(iso), index, iso);
  }
  assert.equal(clock.addDays('0001-03-30', 1), '0002-01-01');
  assert.equal(clock.addDays('0002-01-01', -1), '0001-03-30');
  assert.equal(clock.daysBetween('0001-01-01', '0003-02-05'), 75 * 2 + 20 + 4);
  assert.equal(clock.format(-1), '');
});

test('leap years add days to their month', () => {
  const clock = makeClock(system({ leap: { every: 4, month: 2, extra: 3 } }));
  assert.equal(clock.daysInMonth(4, 2), 28);
  assert.equal(clock.daysInMonth(3, 2), 25);
  assert.equal(clock.parse('0004-02-28') !== null, true);
  assert.equal(clock.parse('0003-02-28'), null);
  assert.equal(clock.yearLength(4), 78);
  assert.equal(clock.daysBetween('0004-01-01', '0005-01-01'), 78);
  for (let index = 0; index < 1200; index += 11) assert.equal(clock.parse(clock.format(index)), index, String(index));
});

test('weekdays follow the weekdays of the system and its first weekday', () => {
  const clock = makeClock(system());
  assert.equal(clock.weekdayOf('0001-01-01'), 2, 'year 1 starts on the second weekday');
  assert.equal(clock.weekdayOf('0001-01-05'), 1, 'five weekdays: it wraps');
  assert.equal(clock.weekdayCount, 5);
  assert.equal(clock.weekdayOf('0001-01-06'), 2);
  assert.equal(clock.weekdayOf('garbage'), 0);
});

test('words: the date is written with the names of the system', () => {
  const clock = makeClock(system());
  assert.equal(clock.humanDate('0014-02-03'), 'Четвёртый, 3 Цветов, 14 год эры Огня');
  assert.equal(clock.humanDate('0014-03-30', { year: false, weekday: false }), '30 Зноя');
  assert.equal(clock.shortDate('0014-02-03'), 'Че 3 Цве');
  assert.equal(makeClock(system({ era: '' })).humanDate('0014-02-03', { weekday: false }), '3 Цветов, 14 год');
  assert.equal(clock.seasonOf(2).name, 'Тепло');
  assert.equal(clock.custom, true);
});

test('seasons become a climate for the weather forecast, month by month', () => {
  const climate = systemClimate(system());
  assert.equal(climate.months.length, 3);
  assert.deepEqual(climate.months[0], { min: -5, max: 3, kinds: { snow: 3, cloudy: 2 } });
  for (let day = 1; day < 40; day += 1) {
    const cold = forecastDay(climate, { day, month: 1 });
    assert.ok(['snow', 'cloudy'].includes(cold.kind), cold.kind);
    const warm = forecastDay(climate, { day, month: 3 });
    assert.ok(['clear', 'rain'].includes(warm.kind), warm.kind);
  }
  // A month in a season without weather: no climate at all, no guessing.
  assert.equal(systemClimate(system({ seasons: [{ id: 'cold', name: 'Холод', min: -5, max: 3, kinds: { snow: 3 } }, { id: 'warm', name: 'Тепло' }] })), null);
  assert.equal(systemClimate(null), null);
});
