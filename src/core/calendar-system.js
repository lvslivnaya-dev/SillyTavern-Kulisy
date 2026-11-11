/**
 * Calendar systems: the earthly calendar and the user's own (months, days of the week, seasons with a climate).
 *
 * system = {
 *   id, name, era?,                         era: «эры Огня» (the year is written «14 год эры Огня»)
 *   startWeekday: 1..W,                     the weekday of the first day of year 1
 *   weekdays: [{ name, short }],            2..14 of them
 *   months:   [{ name, of?, days, season }], 1..36; `of` is the form after a number («3 Тающих льдов»), default = name
 *   seasons:  [{ id, name, min, max, kinds }], the climate of a season: temperatures and the odds of each weather (core/weather.js kinds)
 *   leap?:    { every, month, extra }       every N-th year month #month (1-based) has `extra` more days
 * }
 *
 * A date is the same text as ever, 'Y-MM-DD': year, month number, day of the month. Everything that needs the
 * rules (parse, add days, the weekday, words) goes through a clock made from a system: makeClock(system).
 * No system = the earthly calendar. Pure, no DOM.
 */
import { WEATHER_KIND_IDS } from './weather.js';

export const SYSTEM_LIMITS = Object.freeze({ weekdays: [2, 14], months: [1, 36], days: [1, 99], seasons: 12, name: 40, systems: 30, maxYear: 9999 });
const DAY_MS = 86400000;

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const whole = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

// ---- Earth ---------------------------------------------------------------------

const EARTH_WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const EARTH_WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const EARTH_MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const EARTH_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const earthMs = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(ms);
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]) ? ms : null;
};
const earthIso = ms => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

function earthClock() {
  const clock = {
    custom: false,
    id: 'earth',
    name: 'Земной календарь',
    weekdayCount: 7,
    monthsCount: 12,
    weekdayNames: EARTH_WEEKDAYS,
    weekdayShort: EARTH_WEEKDAYS_SHORT,
    monthNames: EARTH_MONTHS,
    parse: iso => { const ms = earthMs(iso); return ms == null ? null : Math.round(ms / DAY_MS); },
    format: index => (Number.isFinite(index) ? earthIso(index * DAY_MS) : ''),
    daysInMonth: (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(),
    seasonOf: () => null,
    seasons: [],
  };
  clock.valid = iso => clock.parse(iso) != null;
  clock.addDays = (iso, days) => { const index = clock.parse(iso); return index == null ? '' : clock.format(index + days); };
  clock.daysBetween = (from, to) => { const a = clock.parse(from); const b = clock.parse(to); return a == null || b == null ? null : b - a; };
  clock.weekdayOf = iso => { const ms = earthMs(iso); return ms == null ? 0 : ((new Date(ms).getUTCDay() + 6) % 7) + 1; };
  clock.monthOf = iso => (clock.valid(iso) ? Number(iso.slice(5, 7)) : 0);
  clock.yearOf = iso => (clock.valid(iso) ? Number(iso.slice(0, 4)) : 0);
  clock.humanDate = (iso, { year = true, weekday = true } = {}) => {
    const ms = earthMs(iso);
    if (ms == null) return '';
    const date = new Date(ms);
    const day = `${date.getUTCDate()} ${EARTH_MONTHS_OF[date.getUTCMonth()]}${year ? ` ${date.getUTCFullYear()}` : ''}`;
    return weekday ? `${EARTH_WEEKDAYS[clock.weekdayOf(iso) - 1]}, ${day}` : day;
  };
  clock.shortDate = iso => {
    const ms = earthMs(iso);
    if (ms == null) return '';
    const date = new Date(ms);
    return `${EARTH_WEEKDAYS_SHORT[clock.weekdayOf(iso) - 1]} ${date.getUTCDate()} ${EARTH_MONTHS_OF[date.getUTCMonth()].slice(0, 3)}`;
  };
  return clock;
}

export const EARTH_CLOCK = earthClock();

// ---- A system of the user's own ------------------------------------------------------

/** A tidy system, or null when it cannot be a calendar (too few weekdays, no months…). */
export function normalizeSystem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const [minW, maxW] = SYSTEM_LIMITS.weekdays;
  const weekdays = (Array.isArray(raw.weekdays) ? raw.weekdays : []).map(item => {
    const name = clip(typeof item === 'string' ? item : item?.name, 24);
    return name ? { name, short: clip(item?.short, 5) || name.slice(0, 2) } : null;
  }).filter(Boolean).slice(0, maxW);
  const seasonIds = new Set();
  const seasons = [];
  for (const item of Array.isArray(raw.seasons) ? raw.seasons : []) {
    const name = clip(item?.name, SYSTEM_LIMITS.name);
    const id = clip(item?.id, 40);
    if (!name || !id || seasonIds.has(id) || seasons.length >= SYSTEM_LIMITS.seasons) continue;
    seasonIds.add(id);
    const season = { id, name };
    const min = Math.round(Number(item.min));
    const max = Math.round(Number(item.max));
    const kinds = {};
    for (const [kind, weight] of Object.entries(item.kinds ?? {})) {
      const value = Number(weight);
      if (WEATHER_KIND_IDS.includes(kind) && Number.isFinite(value) && value > 0) kinds[kind] = Math.min(value, 100);
    }
    // A season has weather when it has both a range and at least one kind.
    if (Number.isFinite(min) && Number.isFinite(max) && Object.keys(kinds).length) Object.assign(season, { min: Math.min(min, max), max: Math.max(min, max), kinds });
    seasons.push(season);
  }
  const months = (Array.isArray(raw.months) ? raw.months : []).map(item => {
    const name = clip(item?.name, SYSTEM_LIMITS.name);
    if (!name) return null;
    return { name, ...(clip(item.of, SYSTEM_LIMITS.name) ? { of: clip(item.of, SYSTEM_LIMITS.name) } : {}), days: whole(item.days, ...SYSTEM_LIMITS.days, 30), season: seasonIds.has(item.season) ? item.season : '' };
  }).filter(Boolean).slice(0, SYSTEM_LIMITS.months[1]);
  const id = clip(raw.id, 80);
  const name = clip(raw.name, SYSTEM_LIMITS.name);
  if (!id || !name || weekdays.length < minW || !months.length) return null;
  const system = {
    id, name,
    ...(clip(raw.era, SYSTEM_LIMITS.name) ? { era: clip(raw.era, SYSTEM_LIMITS.name) } : {}),
    startWeekday: whole(raw.startWeekday, 1, weekdays.length, 1),
    weekdays, months, seasons,
  };
  const leap = raw.leap;
  if (leap && Number(leap.every) >= 2 && Number(leap.extra) >= 1) {
    system.leap = { every: whole(leap.every, 2, 1000, 4), month: whole(leap.month, 1, months.length, months.length), extra: whole(leap.extra, 1, 30, 1) };
  }
  return system;
}

export function normalizeSystems(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const clean = normalizeSystem(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= SYSTEM_LIMITS.systems) break;
  }
  return out;
}

/** Days in a year of this system (a common one). */
export const yearLength = system => system.months.reduce((sum, month) => sum + month.days, 0);

function customClock(system) {
  const W = system.weekdays.length;
  const N = system.months.length;
  const base = yearLength(system);
  const leap = system.leap ?? null;
  const isLeap = year => Boolean(leap) && year % leap.every === 0;
  const daysInMonth = (year, month) => system.months[month - 1].days + (isLeap(year) && leap.month === month ? leap.extra : 0);
  const before = year => (year - 1) * base + (leap ? leap.extra * Math.floor((year - 1) / leap.every) : 0);
  const yearDays = year => base + (isLeap(year) ? leap.extra : 0);
  const split = iso => {
    const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso ?? '').trim());
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (year < 1 || year > SYSTEM_LIMITS.maxYear || month < 1 || month > N || day < 1 || day > daysInMonth(year, month)) return null;
    return { year, month, day };
  };
  const pad = (year, month, day) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const clock = {
    custom: true,
    id: system.id,
    name: system.name,
    system,
    weekdayCount: W,
    monthsCount: N,
    weekdayNames: system.weekdays.map(item => item.name),
    weekdayShort: system.weekdays.map(item => item.short),
    monthNames: system.months.map(item => item.name),
    seasons: system.seasons,
    daysInMonth,
    yearLength: yearDays,
    parse: iso => {
      const parts = split(iso);
      if (!parts) return null;
      let index = before(parts.year);
      for (let month = 1; month < parts.month; month += 1) index += daysInMonth(parts.year, month);
      return index + parts.day - 1;
    },
    format: index => {
      if (!Number.isFinite(index) || index < 0) return '';
      let year = 1 + Math.floor(index / (base + (leap ? leap.extra / leap.every : 0)));
      while (year > 1 && before(year) > index) year -= 1;
      while (before(year + 1) <= index) year += 1;
      if (year > SYSTEM_LIMITS.maxYear) return '';
      let rest = index - before(year);
      for (let month = 1; month <= N; month += 1) {
        const length = daysInMonth(year, month);
        if (rest < length) return pad(year, month, rest + 1);
        rest -= length;
      }
      return '';
    },
    seasonOf: month => system.seasons.find(item => item.id === system.months[month - 1]?.season) ?? null,
  };
  clock.valid = iso => split(iso) != null;
  clock.addDays = (iso, days) => { const index = clock.parse(iso); return index == null ? '' : clock.format(index + days); };
  clock.daysBetween = (from, to) => { const a = clock.parse(from); const b = clock.parse(to); return a == null || b == null ? null : b - a; };
  clock.weekdayOf = iso => { const index = clock.parse(iso); return index == null ? 0 : ((((index + system.startWeekday - 1) % W) + W) % W) + 1; };
  clock.monthOf = iso => split(iso)?.month ?? 0;
  clock.yearOf = iso => split(iso)?.year ?? 0;
  const yearText = year => `${year} год${system.era ? ` ${system.era}` : ''}`;
  clock.humanDate = (iso, { year = true, weekday = true } = {}) => {
    const parts = split(iso);
    if (!parts) return '';
    const month = system.months[parts.month - 1];
    const text = `${parts.day} ${month.of || month.name}${year ? `, ${yearText(parts.year)}` : ''}`;
    return weekday ? `${system.weekdays[clock.weekdayOf(iso) - 1].name}, ${text}` : text;
  };
  clock.shortDate = iso => {
    const parts = split(iso);
    if (!parts) return '';
    return `${system.weekdays[clock.weekdayOf(iso) - 1].short} ${parts.day} ${system.months[parts.month - 1].name.slice(0, 3)}`;
  };
  return clock;
}

const cache = new WeakMap();
/** The clock of a system (null / nothing = the earthly one). Clocks are cached per system object. */
export function makeClock(system) {
  if (!system) return EARTH_CLOCK;
  if (!cache.has(system)) {
    const clean = normalizeSystem(system);
    cache.set(system, clean ? customClock(clean) : EARTH_CLOCK);
  }
  return cache.get(system);
}

// ---- Weather by season -----------------------------------------------------------------

/**
 * The climate of a system for core/weather.js forecastDay: one «month» of weather per month of the
 * calendar, taken from its season. null when some month has no season with weather.
 */
export function systemClimate(system) {
  const clean = system && normalizeSystem(system);
  if (!clean || !clean.seasons.length) return null;
  const months = clean.months.map(month => {
    const season = clean.seasons.find(item => item.id === month.season);
    return season && season.kinds ? { min: season.min, max: season.max, kinds: season.kinds } : null;
  });
  if (months.some(month => !month)) return null;
  return { id: `system:${clean.id}`, name: `Сезоны: ${clean.name}`, months };
}

// ---- Ready calendars ----------------------------------------------------------------------

const season = (id, name, min, max, kinds) => ({ id, name, min, max, kinds });

/** Examples to start from; the user copies one and changes it. */
export const READY_SYSTEMS = Object.freeze([
  {
    id: 'ready-fantasy', name: 'Фэнтези: десять месяцев', era: 'эры Пепла', startWeekday: 1,
    weekdays: ['Солнцедень', 'Лунень', 'Огнедень', 'Водень', 'Ветродень', 'Землень'].map(name => ({ name, short: name.slice(0, 2) })),
    seasons: [
      season('thaw', 'Оттепель', 2, 12, { cloudy: 4, rain: 4, clear: 2, fog: 1 }),
      season('bloom', 'Цветение', 12, 22, { clear: 5, cloudy: 2, rain: 2 }),
      season('blaze', 'Зной', 22, 34, { clear: 4, heat: 4, storm: 2 }),
      season('ember', 'Угасание', 6, 16, { cloudy: 4, rain: 4, wind: 2, fog: 1 }),
      season('frost', 'Стужа', -14, -2, { snow: 5, cloudy: 3, clear: 2, wind: 2 }),
    ],
    months: [
      ['Тающих льдов', 'Тающих льдов', 36, 'thaw'], ['Первой травы', 'Первой травы', 36, 'thaw'], ['Цветов', 'Цветов', 36, 'bloom'], ['Светлых ночей', 'Светлых ночей', 36, 'bloom'],
      ['Жара', 'Жара', 36, 'blaze'], ['Громов', 'Громов', 36, 'blaze'], ['Жатвы', 'Жатвы', 36, 'ember'], ['Падающих листьев', 'Падающих листьев', 36, 'ember'],
      ['Первого снега', 'Первого снега', 36, 'frost'], ['Долгой ночи', 'Долгой ночи', 36, 'frost'],
    ].map(([name, of, days, seasonId]) => ({ name, of, days, season: seasonId })),
  },
  {
    id: 'ready-lunar', name: 'Лунный: тринадцать месяцев по 28 дней', era: '', startWeekday: 1,
    weekdays: ['Понедень', 'Второй', 'Третий', 'Четвёртый', 'Пятый', 'Шестой', 'Седьмой'].map(name => ({ name, short: name.slice(0, 2) })),
    seasons: [
      season('cold', 'Холодная пора', -6, 6, { cloudy: 4, snow: 3, clear: 2, wind: 1 }),
      season('mild', 'Тёплая пора', 12, 24, { clear: 5, cloudy: 3, rain: 2 }),
      season('hot', 'Жаркая пора', 24, 36, { clear: 4, heat: 4, storm: 2 }),
    ],
    months: ['Волка', 'Снега', 'Ворона', 'Почки', 'Рассвета', 'Колоса', 'Зноя', 'Жатвы', 'Урожая', 'Охоты', 'Тумана', 'Инея', 'Тихий'].map((name, index) => ({
      name, days: 28, season: index < 2 || index >= 10 ? 'cold' : index < 5 ? 'mild' : index < 8 ? 'hot' : 'mild',
    })),
  },
].map(item => normalizeSystem(item)));
