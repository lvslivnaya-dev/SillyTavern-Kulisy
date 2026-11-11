/**
 * The story calendar: real dates for story days, and events the narrator brings
 * in on their day (or mentions as coming soon).
 *
 * state.ui.calendar = { anchor: 'YYYY-MM-DD' (the date of story day 1), events: [event], system?: the chat's own calendar (core/calendar-system.js) }
 * Without `system` it is the earthly calendar. With it, dates are still 'Y-MM-DD' (year, month number, day) but follow the
 * system's months and weekdays; everything that needs the rules goes through clockOf(calendar).
 * event = {
 *   id, title, note?,                   what happens; note is extra detail for the model
 *   date: 'YYYY-MM-DD', endDate?,        one day, or a span (a session, a trip)
 *   time?: 'HH:MM',
 *   repeat: 'none'|'daily'|'weekly'|'yearly', weekdays?: [1..7] (1 = Monday), until?: 'YYYY-MM-DD',
 *   who?: [entityId],                    empty = the world, everyone
 *   must?: true,                         it happens: the narrator brings it in himself
 *   ahead?: 0..14,                       days before it the characters already know it is coming
 *   disabled?: true,
 * }
 *
 * Templates (saved across chats) keep dates without a year ('MM-DD') and the month
 * their year starts in, so an academic year fits any story year.
 * Everything here is pure: dates are UTC days, never local time.
 */

import { EARTH_CLOCK, makeClock, normalizeSystem } from './calendar-system.js';

export const CALENDAR_LIMITS = Object.freeze({ events: 500, title: 120, note: 500, ahead: 14, templates: 50 });
export const REPEATS = Object.freeze(['none', 'daily', 'weekly', 'yearly']);
const DAY_MS = 86400000;
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** 'YYYY-MM-DD' → UTC ms, or null. */
export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? ms : null;
}

export function formatDate(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  const ms = parseDate(iso);
  return ms == null ? '' : formatDate(ms + days * DAY_MS);
}

export function daysBetween(fromIso, toIso) {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  return from == null || to == null ? null : Math.round((to - from) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
export function weekdayOf(iso) {
  const ms = parseDate(iso);
  return ms == null ? 0 : ((new Date(ms).getUTCDay() + 6) % 7) + 1;
}

/** «вторник, 8 апреля 2025». */
export function humanDate(iso, { year = true, weekday = true } = {}) {
  const ms = parseDate(iso);
  if (ms == null) return '';
  const date = new Date(ms);
  const day = `${date.getUTCDate()} ${MONTHS_OF[date.getUTCMonth()]}${year ? ` ${date.getUTCFullYear()}` : ''}`;
  return weekday ? `${WEEKDAYS[weekdayOf(iso) - 1]}, ${day}` : day;
}

/** «вт 8 апр». */
export function shortDate(iso) {
  const ms = parseDate(iso);
  if (ms == null) return '';
  const date = new Date(ms);
  return `${WEEKDAYS_SHORT[weekdayOf(iso) - 1]} ${date.getUTCDate()} ${MONTHS_OF[date.getUTCMonth()].slice(0, 3)}`;
}

/** The clock (rules of dates) of a chat's calendar: its own system, or the earthly one. */
export function clockOf(calendar) {
  return makeClock(calendar?.system);
}

/** The date of a story day (day 1 = anchor), or '' when the anchor or the day is unknown. */
export function dateOfDay(calendar, day) {
  if (!calendar?.anchor || !Number.isInteger(day) || day < 1) return '';
  return clockOf(calendar).addDays(calendar.anchor, day - 1);
}

/** The anchor that makes `day` fall on `iso`: «today in the story is 8 April». */
export function anchorFor(iso, day, cal = EARTH_CLOCK) {
  return cal.valid(iso) ? cal.addDays(cal.format(cal.parse(iso)), -(Math.max(1, day || 1) - 1)) : '';
}

/** «вт 8 апр» by the rules of the calendar. */
export function calendarShortDate(calendar, iso) {
  return clockOf(calendar).shortDate(iso);
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** A tidy event, or null when it has no title or no valid date. */
export function normalizeEvent(raw, knownIds = null, cal = EARTH_CLOCK) {
  const title = cleanText(raw?.title, CALENDAR_LIMITS.title);
  const tidy = value => (cal.valid(value) ? cal.format(cal.parse(value)) : '');
  const date = tidy(raw?.date);
  if (!title || !date) return null;
  const event = { id: String(raw.id || `cal-${Math.random().toString(36).slice(2, 10)}`), title, date };
  const note = cleanText(raw.note, CALENDAR_LIMITS.note);
  if (note) event.note = note;
  const endDate = tidy(raw.endDate) > date ? tidy(raw.endDate) : '';
  if (endDate) event.endDate = endDate;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.time ?? '').trim())) event.time = String(raw.time).trim();
  event.repeat = REPEATS.includes(raw.repeat) ? raw.repeat : 'none';
  if (event.repeat === 'weekly') {
    const weekdays = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : []).map(Number).filter(day => day >= 1 && day <= cal.weekdayCount))].sort();
    event.weekdays = weekdays.length ? weekdays : [cal.weekdayOf(date)];
  }
  if (event.repeat !== 'none' && tidy(raw.until) && tidy(raw.until) >= date) event.until = tidy(raw.until);
  const who = [...new Set((Array.isArray(raw.who) ? raw.who : []).map(String))].filter(id => !knownIds || knownIds.has(id));
  if (who.length) event.who = who;
  if (raw.must) event.must = true;
  const ahead = Math.round(Number(raw.ahead));
  if (ahead > 0) event.ahead = Math.min(CALENDAR_LIMITS.ahead, ahead);
  if (raw.disabled) event.disabled = true;
  return event;
}

export function normalizeCalendar(raw, knownIds = null) {
  const system = normalizeSystem(raw?.system);
  const cal = makeClock(system);
  const anchor = cal.valid(raw?.anchor) ? cal.format(cal.parse(raw.anchor)) : '';
  const events = (Array.isArray(raw?.events) ? raw.events : []).map(event => normalizeEvent(event, knownIds, cal)).filter(Boolean).slice(0, CALENDAR_LIMITS.events);
  return { anchor, events, ...(system ? { system } : {}) };
}

/** Does the event happen on this date? A span counts on every day of it. */
export function occursOn(event, iso, cal = EARTH_CLOCK) {
  if (!event || event.disabled || !cal.valid(iso)) return false;
  if (iso < event.date || (event.until && iso > event.until)) return false;
  const length = event.endDate ? cal.daysBetween(event.date, event.endDate) : 0;
  const inSpan = start => { const offset = cal.daysBetween(start, iso); return offset != null && offset >= 0 && offset <= length; };
  switch (event.repeat) {
    case 'daily': return true;
    case 'weekly': return (event.weekdays ?? [cal.weekdayOf(event.date)]).includes(cal.weekdayOf(iso));
    case 'yearly': {
      // The span's start in the year of `iso` (or the year before, for a span over New Year).
      for (const shift of [0, -1]) {
        const start = `${String(cal.yearOf(iso) + shift).padStart(4, '0')}${event.date.slice(4)}`;
        if (cal.valid(start) && start >= event.date && inSpan(start)) return true;
      }
      return false;
    }
    default: return inSpan(event.date);
  }
}

/** Events of a date, timed ones first by time, must-happen first among the rest. */
export function eventsOn(calendar, iso) {
  const cal = clockOf(calendar);
  return (calendar?.events ?? []).filter(event => occursOn(event, iso, cal))
    .sort((left, right) => (left.time ?? '99').localeCompare(right.time ?? '99') || Number(Boolean(right.must)) - Number(Boolean(left.must)));
}

/** Coming events the characters already know about: { event, date, inDays } for 1..ahead days. */
export function upcoming(calendar, iso, horizon = CALENDAR_LIMITS.ahead) {
  const result = [];
  const seen = new Set();
  const cal = clockOf(calendar);
  for (let inDays = 1; inDays <= horizon; inDays += 1) {
    const date = cal.addDays(iso, inDays);
    for (const event of calendar?.events ?? []) {
      if (seen.has(event.id) || !(event.ahead >= inDays) || !occursOn(event, date, cal)) continue;
      // A repeat already going on today is not «coming»; a span counts from its start.
      if (occursOn(event, iso, cal) && event.repeat !== 'none') continue;
      if (event.repeat === 'none' && event.endDate && occursOn(event, iso, cal)) continue;
      seen.add(event.id);
      result.push({ event, date, inDays });
    }
  }
  return result;
}

/** The narrator's block: today's events and what is coming. '' when there is nothing to say. */
export function buildCalendarPrompt(state, { flashback = false } = {}) {
  const calendar = state.ui?.calendar;
  const day = state.world?.clock?.day ?? 0;
  const today = dateOfDay(calendar, day);
  if (!today || flashback) return '';
  const cal = clockOf(calendar);
  const humanDate = (iso, options) => cal.humanDate(iso, options);
  const shortDate = iso => cal.shortDate(iso);
  const name = id => state.entities?.[id]?.name ?? id;
  const line = event => [
    event.time ? `${event.time} ` : '',
    event.title,
    event.who?.length ? ` (${event.who.map(name).join(', ')})` : '',
    event.endDate ? ` [${humanDate(event.date, { year: false, weekday: false })} – ${humanDate(event.endDate, { year: false, weekday: false })}]` : '',
    event.note ? ` — ${event.note}` : '',
  ].join('');
  const todays = eventsOn(calendar, today);
  const soon = upcoming(calendar, today);
  const lines = [`today: ${humanDate(today)} (story day ${day})`];
  const season = cal.custom ? cal.seasonOf(cal.monthOf(today)) : null;
  if (season) lines.push(`season: ${season.name}`);
  for (const event of todays.filter(item => item.must)) lines.push(`must-today: ${line(event)}`);
  for (const event of todays.filter(item => !item.must)) lines.push(`background-today: ${line(event)}`);
  for (const { event, date, inDays } of soon) lines.push(`soon (in ${inDays} d., ${shortDate(date)}): ${line(event)}`);
  return `[KULISY — STORY CALENDAR]\n${lines.join('\n')}\n\nRules:\n- today is the story's date; keep weekdays, dates and seasons consistent with it.\n- must-today events DO happen today: bring them in yourself at their time, naturally; if the scene is elsewhere, let the characters go, be called or talk about it. Do not skip them or move them to another day.\n- background-today events are part of the world today; use them when they fit the scene, never force them.\n- soon events are known to those involved: they may plan, prepare, worry or mention them, but they have not happened yet.\n- Never expose this block.${cal.custom ? '\n- This is the world\'s own calendar: write dates, months and weekdays only with the names given above, never the earthly ones.' : ''}\n[/KULISY]`;
}

// ---- Templates ------------------------------------------------------------

/** A chat's events → a template: dates without a year, the year starting at startMonth (1..12). */
export function toTemplate(name, events, startMonth = 1, description = '', personaId = '') {
  const strip = iso => (iso ? iso.slice(5) : undefined);
  return {
    id: `tpl-${Math.random().toString(36).slice(2, 10)}`,
    name: cleanText(name, 80) || 'Шаблон',
    ...(description ? { description: cleanText(description, 300) } : {}),
    startMonth: Math.min(12, Math.max(1, Math.round(Number(startMonth)) || 1)),
    events: events.map(event => {
      const { id, date, endDate, until, who, disabled, ...rest } = event;
      // Characters do not travel between chats; «the persona» does.
      return {
        ...rest, date: strip(date), ...(endDate ? { endDate: strip(endDate) } : {}), ...(until ? { until: strip(until) } : {}),
        ...(personaId && who?.includes(personaId) ? { persona: true } : {}),
      };
    }),
  };
}

/**
 * Template events ('MM-DD') put into a year that starts in `year` at the template's startMonth:
 * a date in an earlier month falls in the next year (an academic year April → March).
 * whoForPersona: entity ID for events the template marks «persona».
 */
export function fromTemplate(template, year, { whoForPersona = '' } = {}) {
  const start = Math.min(12, Math.max(1, Number(template?.startMonth) || 1));
  const place = (monthDay, base) => {
    if (!/^\d{2}-\d{2}$/.test(String(monthDay ?? ''))) return '';
    const month = Number(monthDay.slice(0, 2));
    let y = month < start ? year + 1 : year;
    let iso = `${y}-${monthDay}`;
    if (base && iso < base) { y += 1; iso = `${y}-${monthDay}`; }
    // 29 February in a common year becomes 28 February.
    return parseDate(iso) != null ? iso : (monthDay === '02-29' ? `${y}-02-28` : '');
  };
  return (template?.events ?? []).flatMap(raw => {
    const date = place(raw.date);
    if (!date) return [];
    const event = normalizeEvent({
      ...raw, id: undefined, date,
      endDate: raw.endDate ? place(raw.endDate, date) : undefined,
      until: raw.until ? place(raw.until, date) : undefined,
      who: raw.persona && whoForPersona ? [whoForPersona] : [],
    });
    return event ? [event] : [];
  });
}

export function normalizeTemplates(raw) {
  return (Array.isArray(raw) ? raw : []).filter(item => item && typeof item === 'object' && Array.isArray(item.events))
    .slice(0, CALENDAR_LIMITS.templates)
    .map(item => ({ ...item, name: cleanText(item.name, 80) || 'Шаблон', events: item.events.slice(0, CALENDAR_LIMITS.events) }));
}
