import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, anchorFor, buildCalendarPrompt, dateOfDay, eventsOn, fromTemplate, humanDate, normalizeCalendar, normalizeEvent,
  occursOn, toTemplate, upcoming, weekdayOf,
} from '../src/core/calendar.js';

test('dates: weekdays, adding days, a story day to a date and back', () => {
  assert.equal(weekdayOf('2025-04-07'), 1, 'Monday');
  assert.equal(weekdayOf('2025-04-13'), 7, 'Sunday');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(humanDate('2025-04-08'), 'вторник, 8 апреля 2025');
  const calendar = { anchor: anchorFor('2025-04-08', 2) };
  assert.equal(calendar.anchor, '2025-04-07');
  assert.equal(dateOfDay(calendar, 15), '2025-04-21');
  assert.equal(dateOfDay({}, 3), '', 'no anchor, no date');
});

test('events: once, spans, weekly, yearly (also over New Year), until', () => {
  const once = normalizeEvent({ title: 'Контрольная', date: '2025-04-10' });
  assert.ok(occursOn(once, '2025-04-10') && !occursOn(once, '2025-04-11'));
  const session = normalizeEvent({ title: 'Сессия', date: '2025-07-20', endDate: '2025-07-31' });
  assert.ok(occursOn(session, '2025-07-25') && !occursOn(session, '2025-08-01'));
  const lessons = normalizeEvent({ title: 'Анатомия', date: '2025-04-07', repeat: 'weekly', weekdays: [2, 4], until: '2025-07-15' });
  assert.ok(occursOn(lessons, '2025-04-08') && occursOn(lessons, '2025-04-10') && !occursOn(lessons, '2025-04-09'));
  assert.ok(!occursOn(lessons, '2025-07-17'), 'after until');
  const birthday = normalizeEvent({ title: 'День рождения', date: '2024-11-03', repeat: 'yearly' });
  assert.ok(occursOn(birthday, '2027-11-03') && !occursOn(birthday, '2023-11-03'));
  const holidays = normalizeEvent({ title: 'Каникулы', date: '2024-12-28', endDate: '2025-01-05', repeat: 'yearly' });
  assert.ok(occursOn(holidays, '2026-01-03'), 'the span that started in December');
  assert.equal(normalizeEvent({ title: 'Без даты' }), null);
});

test('the narrator block: must and background today, coming soon only within «ahead»', () => {
  const calendar = normalizeCalendar({ anchor: '2025-04-07', events: [
    { title: 'Контрольная по анатомии', date: '2025-04-08', time: '10:00', must: true, who: ['suzu'], note: 'препод строгий' },
    { title: 'Ярмарка у станции', date: '2025-04-08' },
    { title: 'Практика на ферме', date: '2025-04-10', ahead: 3 },
    { title: 'Фестиваль', date: '2025-04-20', ahead: 3 },
  ] });
  const state = { ui: { calendar }, world: { clock: { day: 2 } }, entities: { suzu: { name: 'Судзу' } } };
  const block = buildCalendarPrompt(state);
  assert.match(block, /today: вторник, 8 апреля 2025 \(story day 2\)/);
  assert.match(block, /must-today: 10:00 Контрольная по анатомии \(Судзу\) — препод строгий/);
  assert.match(block, /background-today: Ярмарка у станции/);
  assert.match(block, /soon \(in 2 d\., чт 10 апр\): Практика на ферме/);
  assert.doesNotMatch(block, /Фестиваль/, 'too far ahead');
  assert.equal(buildCalendarPrompt(state, { flashback: true }), '');
  assert.equal(buildCalendarPrompt({ ...state, ui: {} }), '');
  assert.equal(eventsOn(calendar, '2025-04-08')[0].title, 'Контрольная по анатомии', 'timed first');
  assert.equal(upcoming(calendar, '2025-04-08').length, 1);
});

test('templates keep month-days and land in any academic year', () => {
  const events = normalizeCalendar({ events: [
    { title: 'Начало семестра', date: '2025-04-07' },
    { title: 'Сессия', date: '2026-01-20', endDate: '2026-02-05', who: ['suzu'] },
  ] }).events;
  const template = toTemplate('Ветеринар, Тодай', events, 4, '', 'suzu');
  assert.deepEqual(template.events.map(event => event.date), ['04-07', '01-20']);
  assert.equal(template.events[1].persona, true);
  const placed = fromTemplate(template, 2030, { whoForPersona: 'me' });
  assert.deepEqual(placed.map(event => event.date), ['2030-04-07', '2031-01-20'], 'January falls in the next year');
  assert.equal(placed[1].endDate, '2031-02-05');
  assert.deepEqual(placed[1].who, ['me']);
});

test('the generator\'s answer: only events with a month-day survive, fields are cleaned', async () => {
  const { parseCalendarTemplate } = await import('../src/integration/calendar-generation.js');
  const template = parseCalendarTemplate(JSON.stringify({ name: 'Ветеринарный, 3 курс', startMonth: 4, events: [
    { title: 'Анатомия', date: '04-08', repeat: 'weekly', weekdays: [2, 9, 4], until: '07-15' },
    { title: 'Сессия', date: '07-20', endDate: '07-31', must: true, ahead: 30, persona: true },
    { title: 'Без даты' },
    { title: 'Плохая дата', date: '13-40' },
  ] }));
  assert.equal(template.startMonth, 4);
  assert.deepEqual(template.events.map(event => event.title), ['Анатомия', 'Сессия']);
  assert.deepEqual(template.events[0].weekdays, [2, 4]);
  assert.equal(template.events[1].ahead, 14);
  assert.equal(template.events[1].persona, true);
});
