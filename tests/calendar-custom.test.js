import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/core/index.js';
import { READY_SYSTEMS, makeClock, normalizeSystem } from '../src/core/calendar-system.js';
import { anchorFor, buildCalendarPrompt, calendarShortDate, clockOf, dateOfDay, eventsOn, normalizeCalendar, normalizeEvent, occursOn, upcoming } from '../src/core/calendar.js';

const week = names => names.map(name => ({ name, short: name.slice(0, 2) }));
const system = normalizeSystem({
  id: 's1', name: 'Мой мир', era: 'эры Огня', startWeekday: 1,
  weekdays: week(['Первень', 'Второй', 'Третий', 'Четвёртый', 'Пятый']),
  seasons: [{ id: 'cold', name: 'Холод', min: -5, max: 3, kinds: { snow: 3 } }, { id: 'warm', name: 'Тепло', min: 14, max: 24, kinds: { clear: 4 } }],
  months: [{ name: 'Льдов', of: 'Льдов', days: 20, season: 'cold' }, { name: 'Цветов', days: 25, season: 'warm' }, { name: 'Зноя', of: 'Зноя', days: 30, season: 'warm' }],
});
const cal = makeClock(system);

test('a chat calendar remembers its system and tidies the dates by its rules', () => {
  const calendar = normalizeCalendar({ anchor: '14-2-3', system, events: [{ id: 'e', title: 'Праздник', date: '14-3-30' }, { id: 'bad', title: 'Нет такого дня', date: '14-2-26' }] });
  assert.equal(calendar.anchor, '0014-02-03');
  assert.deepEqual(calendar.events.map(event => event.date), ['0014-03-30'], 'month two has 25 days: the 26th is not a date');
  assert.equal(calendar.system.name, 'Мой мир');
  assert.equal(clockOf(calendar).custom, true);
  assert.equal(clockOf({}).custom, false, 'no system: the earthly calendar');
  assert.equal(normalizeCalendar({ anchor: '2025-04-08' }).system, undefined);
  assert.equal(normalizeCalendar({ anchor: '2025-04-08' }).anchor, '2025-04-08');
});

test('story days go by the months of the calendar', () => {
  const calendar = normalizeCalendar({ anchor: '0014-03-29', system });
  assert.equal(dateOfDay(calendar, 1), '0014-03-29');
  assert.equal(dateOfDay(calendar, 3), '0015-01-01', 'year ends after the 30th of the last month');
  assert.equal(anchorFor('0015-01-01', 3, cal), '0014-03-29');
  assert.equal(calendarShortDate(calendar, '0014-03-29'), cal.shortDate('0014-03-29'));
  assert.equal(anchorFor('0014-02-30', 1, cal), '');
});

test('events: a span, weekly by the weekdays of the world, every year', () => {
  const weekly = normalizeEvent({ title: 'Рынок', date: '0001-01-01', repeat: 'weekly', weekdays: [2, 9] }, null, cal);
  assert.deepEqual(weekly.weekdays, [2], 'only the weekdays that exist (there are five)');
  assert.deepEqual([...Array(10)].map((_, index) => occursOn(weekly, cal.addDays('0001-01-01', index), cal)), [false, true, false, false, false, false, true, false, false, false]);
  const span = normalizeEvent({ title: 'Ярмарка', date: '0003-02-10', endDate: '0003-02-12' }, null, cal);
  assert.deepEqual(['0003-02-09', '0003-02-10', '0003-02-12', '0003-02-13'].map(iso => occursOn(span, iso, cal)), [false, true, true, false]);
  const yearly = normalizeEvent({ title: 'Праздник Огня', date: '0003-03-30', repeat: 'yearly' }, null, cal);
  assert.equal(occursOn(yearly, '0007-03-30', cal), true);
  assert.equal(occursOn(yearly, '0007-03-29', cal), false);
  assert.equal(occursOn(yearly, '0002-03-30', cal), false, 'not before it began');
  // A yearly span over the new year.
  const over = normalizeEvent({ title: 'Долгая ночь', date: '0003-03-29', endDate: '0004-01-02', repeat: 'yearly' }, null, cal);
  assert.equal(over.endDate, '0004-01-02', 'an end in the next year is a valid span');
  assert.equal(occursOn(over, '0008-01-01', cal), true, 'and it comes round again over the new year');
  const calendar = normalizeCalendar({ anchor: '0001-01-01', system, events: [{ id: 'y', title: 'Праздник Огня', date: '0003-03-30', repeat: 'yearly', must: true, ahead: 3 }] });
  assert.deepEqual(eventsOn(calendar, '0009-03-30').map(event => event.id), ['y']);
  assert.deepEqual(upcoming(calendar, '0009-03-28').map(item => [item.event.id, item.inDays]), [['y', 2]]);
});

test('the narrator gets the date in the words of the world, the season, and the rule to use them', () => {
  const state = createDefaultState();
  state.world.clock.day = 3;
  state.ui = { calendar: normalizeCalendar({ anchor: '0014-02-01', system, events: [{ id: 'f', title: 'Праздник цветов', date: '0014-02-03', must: true }] }) };
  const block = buildCalendarPrompt(state);
  assert.match(block, /today: Третий, 3 Цветов, 14 год эры Огня \(story day 3\)/);
  assert.match(block, /season: Тепло/);
  assert.match(block, /must-today: Праздник цветов/);
  assert.match(block, /the world's own calendar: write dates, months and weekdays only with the names given above/);
  // The earthly calendar is as before: no season, no extra rule.
  state.ui = { calendar: normalizeCalendar({ anchor: '2025-04-08' }) };
  const earth = buildCalendarPrompt(state);
  assert.match(earth, /today: .*апреля 2025/);
  assert.doesNotMatch(earth, /season:|own calendar/);
});

test('the ready calendars are real calendars: every month has a season with weather', () => {
  for (const ready of READY_SYSTEMS) {
    const clock = makeClock(ready);
    assert.equal(clock.custom, true, ready.name);
    for (let month = 1; month <= clock.monthsCount; month += 1) assert.ok(clock.seasonOf(month)?.kinds, `${ready.name}: month ${month}`);
    assert.equal(clock.parse(clock.format(1234)), 1234);
  }
});
