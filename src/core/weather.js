/**
 * Weather of the story. Two sources, and the text of the story beats both:
 *
 *   - what the chronicler (or the user) set: `state.world.weather` = { kind, temp, text, lock, day },
 *     a journaled operation `weather.set`, so a swipe takes it back;
 *   - a forecast: a climate (twelve months of temperatures and odds of each kind of weather)
 *     and scenarios on top of it («тайфун на 3 дня»). The forecast is computed from the story
 *     day and date, never stored, and does not change on a swipe. The plan lives in `state.ui.weatherPlan`.
 *
 * Which weather is in force today (weatherOf): a locked one; else one set today; else a scenario
 * that covers today; else the forecast; else none. Pure functions, no DOM, no model.
 */

export const WEATHER_KINDS = Object.freeze({
  clear: { label: 'Ясно', icon: '☀', en: 'clear sky' },
  cloudy: { label: 'Пасмурно', icon: '☁', en: 'overcast' },
  rain: { label: 'Дождь', icon: '🌧', en: 'rain' },
  storm: { label: 'Гроза', icon: '⛈', en: 'thunderstorm' },
  snow: { label: 'Снег', icon: '❄', en: 'snow' },
  fog: { label: 'Туман', icon: '🌫', en: 'fog' },
  wind: { label: 'Ветер', icon: '🌬', en: 'strong wind' },
  heat: { label: 'Жара', icon: '🌡', en: 'oppressive heat' },
});
export const WEATHER_KIND_IDS = Object.freeze(Object.keys(WEATHER_KINDS));
export const WEATHER_LIMITS = Object.freeze({ text: 160, temp: 60, scenarios: 40, days: 60, name: 60, climates: 30 });
export const MONTH_NAMES = Object.freeze(['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']);

const PART_OFFSET = Object.freeze({ dawn: -3, morning: -2, day: 0, evening: -2, dusk: -2, night: -4 });

// ---- Ready climates ------------------------------------------------------------

/** Row: 'min max kind:weight …'. Twelve rows, January first. */
function climate(id, name, rows) {
  return {
    id, name, builtin: true,
    months: rows.map(row => {
      const [min, max, ...odds] = row.split(/\s+/);
      const kinds = {};
      for (const odd of odds) { const [kind, weight] = odd.split(':'); kinds[kind] = Number(weight); }
      return { min: Number(min), max: Number(max), kinds };
    }),
  };
}

export const BUILTIN_CLIMATES = Object.freeze([
  climate('tokyo', 'Токио и центральная Япония', [
    '2 10 clear:6 cloudy:3 wind:1', '3 11 clear:6 cloudy:3 snow:0.5 wind:1', '6 14 clear:4 cloudy:4 rain:2 wind:1', '11 19 clear:4 cloudy:4 rain:2',
    '16 24 clear:5 cloudy:3 rain:2', '20 27 cloudy:4 rain:5 clear:1 fog:0.5', '24 31 clear:4 cloudy:2 rain:2 heat:2 storm:1', '25 33 clear:3 heat:4 storm:2 cloudy:1 rain:1',
    '22 28 cloudy:3 rain:4 clear:2 storm:1 wind:1', '16 22 clear:4 cloudy:3 rain:3', '10 17 clear:5 cloudy:3 rain:1.5', '4 12 clear:6 cloudy:2 wind:2',
  ]),
  climate('temperate', 'Умеренный: Россия, Европа', [
    '-9 -3 cloudy:5 snow:4 clear:2 fog:1', '-8 -2 cloudy:5 snow:3 clear:3 wind:1', '-3 5 cloudy:5 clear:3 rain:2 snow:1 wind:1', '3 12 cloudy:4 clear:4 rain:3 wind:1',
    '9 19 clear:4 cloudy:3 rain:3 storm:0.5', '13 23 clear:5 cloudy:3 rain:3 storm:1', '15 25 clear:5 cloudy:3 rain:3 storm:1.5 heat:0.5', '14 24 clear:5 cloudy:3 rain:2 storm:1',
    '9 17 cloudy:4 rain:4 clear:3 fog:1', '4 11 cloudy:6 rain:4 fog:1 wind:1', '-1 5 cloudy:6 rain:2 snow:2 fog:1', '-6 0 cloudy:5 snow:4 clear:2 fog:1',
  ]),
  climate('subtropic', 'Жаркий и влажный: юг, побережье', [
    '16 24 clear:6 cloudy:2 rain:2', '17 25 clear:6 cloudy:2 rain:2', '19 27 clear:6 cloudy:2 rain:2', '22 30 clear:5 cloudy:2 rain:2 heat:1',
    '25 33 clear:4 heat:3 storm:2 rain:1', '27 35 heat:4 clear:3 storm:2 rain:1', '28 37 heat:5 clear:3 storm:2', '28 37 heat:5 clear:3 storm:2',
    '26 34 clear:4 heat:3 storm:2 rain:1', '23 31 clear:5 rain:3 cloudy:2', '20 28 clear:6 cloudy:2 rain:2', '17 25 clear:6 cloudy:2 rain:2',
  ]),
  climate('north', 'Суровый север', [
    '-26 -16 clear:3 snow:4 cloudy:3 wind:2', '-25 -15 clear:3 snow:4 cloudy:3 wind:2', '-18 -8 clear:3 snow:4 cloudy:3 wind:2', '-9 0 cloudy:4 snow:3 clear:3 fog:1 wind:1',
    '-2 7 cloudy:5 rain:2 snow:2 fog:2 wind:1', '5 14 cloudy:4 rain:3 fog:2 clear:2', '9 19 cloudy:4 rain:3 clear:3 fog:1', '7 16 cloudy:4 rain:4 fog:2 clear:2',
    '2 9 cloudy:5 rain:3 wind:2 fog:1', '-5 2 cloudy:5 snow:3 wind:2 fog:1', '-15 -7 snow:4 cloudy:4 wind:2 clear:1', '-23 -14 snow:4 clear:3 cloudy:3 wind:2',
  ]),
  climate('autumn', 'Вечная осень', Array(12).fill('6 14 cloudy:5 rain:4 fog:2 wind:2 clear:1')),
]);

// ---- Ready scenarios -----------------------------------------------------------

/** A scenario template: `temp` fixes the temperature, `tempDelta` shifts the forecast one. */
export const BUILTIN_SCENARIOS = Object.freeze([
  { id: 'typhoon', name: 'Тайфун', days: 2, kind: 'storm', tempDelta: -3, text: 'ливень и шквальный ветер, транспорт встаёт' },
  { id: 'longrain', name: 'Затяжные дожди', days: 5, kind: 'rain', tempDelta: -2, text: 'сырость, лужи не просыхают' },
  { id: 'heatwave', name: 'Жара', days: 4, kind: 'heat', tempDelta: 6, text: 'духота, асфальт плавится' },
  { id: 'snowfall', name: 'Снегопад', days: 2, kind: 'snow', temp: -1, text: 'снег валит весь день, сугробы' },
  { id: 'blizzard', name: 'Метель', days: 2, kind: 'snow', temp: -9, text: 'метель, видимость почти нулевая' },
  { id: 'coldsnap', name: 'Похолодание', days: 3, kind: 'cloudy', tempDelta: -8, text: 'резко похолодало, изо рта пар' },
  { id: 'fogday', name: 'Туманное утро', days: 1, kind: 'fog', tempDelta: -2, text: 'плотный туман, шаги слышно раньше, чем видно' },
  { id: 'clearweek', name: 'Ясная неделя', days: 7, kind: 'clear', tempDelta: 2, text: 'ни облачка' },
]);

// ---- Cleaning -------------------------------------------------------------------

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const wholeDay = value => { const day = Math.round(Number(value)); return Number.isFinite(day) && day > 0 ? Math.min(day, 99999) : 0; };
const cleanTemp = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && Math.abs(number) <= WEATHER_LIMITS.temp ? number : null;
};

/** What `weather.set` stores: { kind, temp, text, lock, day }. */
export function cleanWeather(raw, day = 0) {
  if (!raw || !WEATHER_KIND_IDS.includes(raw.kind)) return null;
  const out = { kind: raw.kind, temp: cleanTemp(raw.temp), text: clip(raw.text, WEATHER_LIMITS.text), day: wholeDay(raw.day ?? day) };
  if (raw.lock === true) out.lock = true;
  return out;
}

export function normalizeClimate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const months = Array.isArray(raw.months) ? raw.months : [];
  if (months.length !== 12) return null;
  const clean = months.map(month => {
    const a = cleanTemp(month?.min);
    const b = cleanTemp(month?.max);
    if (a == null || b == null) return null;
    const kinds = {};
    for (const [kind, weight] of Object.entries(month?.kinds ?? {})) {
      const value = Number(weight);
      if (WEATHER_KIND_IDS.includes(kind) && Number.isFinite(value) && value > 0) kinds[kind] = Math.min(value, 100);
    }
    return Object.keys(kinds).length ? { min: Math.min(a, b), max: Math.max(a, b), kinds } : null;
  });
  if (clean.some(month => !month)) return null;
  const id = clip(raw.id, 80);
  const name = clip(raw.name, WEATHER_LIMITS.name);
  return id && name ? { id, name, months: clean } : null;
}

export function normalizeClimates(list) {
  const seen = new Set(BUILTIN_CLIMATES.map(item => item.id));
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const clean = normalizeClimate(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
    if (out.length >= WEATHER_LIMITS.climates) break;
  }
  return out;
}

function cleanScenario(raw) {
  if (!raw || !WEATHER_KIND_IDS.includes(raw.kind)) return null;
  const startDay = wholeDay(raw.startDay);
  const days = Math.min(WEATHER_LIMITS.days, wholeDay(raw.days));
  if (!startDay || !days) return null;
  const temp = cleanTemp(raw.temp);
  const delta = Math.round(Number(raw.tempDelta));
  return {
    id: clip(raw.id, 80) || `weather-${startDay}-${raw.kind}`,
    name: clip(raw.name, WEATHER_LIMITS.name) || WEATHER_KINDS[raw.kind].label,
    startDay, days, kind: raw.kind,
    ...(temp != null ? { temp } : {}),
    ...(temp == null && Number.isFinite(delta) && delta ? { tempDelta: Math.max(-40, Math.min(40, delta)) } : {}),
    text: clip(raw.text, WEATHER_LIMITS.text),
  };
}

/** state.ui.weatherPlan: { climateId, month (0 = from the calendar), scenarios }. */
export function normalizePlan(raw) {
  const scenarios = [];
  for (const item of Array.isArray(raw?.scenarios) ? raw.scenarios : []) {
    const clean = cleanScenario(item);
    if (clean) scenarios.push(clean);
    if (scenarios.length >= WEATHER_LIMITS.scenarios) break;
  }
  const month = Math.round(Number(raw?.month));
  return { climateId: clip(raw?.climateId, 80), month: month >= 1 && month <= 12 ? month : 0, scenarios };
}

/** A scenario from a ready template, starting on `startDay`. `days` overrides the template's length. */
export function scenarioFrom(template, startDay, days) {
  return cleanScenario({ ...template, id: `${template.id}-${startDay}`, startDay, days: days || template.days });
}

export function addScenario(plan, scenario) {
  const next = normalizePlan(plan);
  const clean = cleanScenario(scenario);
  if (!clean) throw new Error('Для сценария нужны день начала и число дней.');
  next.scenarios = [...next.scenarios.filter(item => item.id !== clean.id), clean].sort((left, right) => left.startDay - right.startDay);
  return next;
}

export function removeScenario(plan, id) {
  const next = normalizePlan(plan);
  next.scenarios = next.scenarios.filter(item => item.id !== id);
  return next;
}

export function findClimate(id, custom = []) {
  return [...BUILTIN_CLIMATES, ...normalizeClimates(custom)].find(item => item.id === id) ?? null;
}

// ---- Forecast ------------------------------------------------------------------

function hash(text) {
  let h = 2166136261;
  for (let index = 0; index < text.length; index += 1) { h ^= text.charCodeAt(index); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function random(seed) {
  let a = hash(seed);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function pick(kinds, roll) {
  const entries = Object.entries(kinds);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let at = roll * total;
  for (const [kind, weight] of entries) { at -= weight; if (at < 0) return kind; }
  return entries.at(-1)[0];
}

/**
 * The forecast of one story day: { kind, temp } or null. `month` 1–12. Yesterday's weather
 * weighs double, so days come in spells instead of flipping every morning.
 */
export function forecastDay(model, { day, month }) {
  const info = model?.months?.[month - 1];
  if (!info || !(day >= 1)) return null;
  const base = key => pick(info.kinds, random(`${model.id}|${key}|kind`)());
  const yesterday = base(day - 1);
  const kinds = { ...info.kinds, [yesterday]: (info.kinds[yesterday] ?? 0) + (info.kinds[yesterday] ?? 0.5) };
  const roll = random(`${model.id}|${day}|kind`)();
  const kind = pick(kinds, roll);
  const spread = random(`${model.id}|${day}|temp`)();
  let temp = info.min + (info.max - info.min) * (0.2 + 0.7 * spread);
  if (kind === 'rain' || kind === 'storm') temp -= 1.5;
  if (kind === 'heat') temp = Math.max(temp, info.max);
  if (kind === 'snow') temp = Math.min(temp, 0);
  return { kind, temp: Math.round(temp) };
}

const monthOfDate = iso => { const month = Number(String(iso ?? '').slice(5, 7)); return month >= 1 && month <= 12 ? month : 0; };

/**
 * Weather in force on `day` (0 = unknown): { kind, temp, text, source } or null.
 * source: 'lock' | 'set' | 'scenario' | 'forecast'. `date` is the calendar date of that day, if known.
 */
export function weatherFor(state, { plan, climates = [], date = '', day = state?.world?.clock?.day ?? 0, part = state?.world?.clock?.part ?? '', climate, monthOf = monthOfDate } = {}) {
  const set = state?.world?.weather;
  const shift = PART_OFFSET[part] ?? 0;
  const withPart = value => (value == null ? null : value + shift);
  if (set?.lock) return { kind: set.kind, temp: set.temp, text: set.text ?? '', source: 'lock' };
  if (set && (set.day === day || !day || !set.day)) return { kind: set.kind, temp: set.temp, text: set.text ?? '', source: 'set' };
  const clean = normalizePlan(plan);
  // `climate`: a model given by the caller (the seasons of the chat's own calendar); `false` = that calendar has none, do not guess.
  const model = climate === false ? null : climate ?? (clean.climateId ? findClimate(clean.climateId, climates) : null);
  const month = monthOf(date) || clean.month;
  const base = model && month && day ? forecastDay(model, { day, month }) : null;
  const scenario = day ? clean.scenarios.find(item => day >= item.startDay && day < item.startDay + item.days) : null;
  if (scenario) {
    const temp = scenario.temp ?? (base ? base.temp + (scenario.tempDelta ?? 0) : null);
    return { kind: scenario.kind, temp: withPart(temp), text: scenario.text, source: 'scenario', scenario: scenario.name };
  }
  if (base) return { kind: base.kind, temp: withPart(base.temp), text: '', source: 'forecast' };
  return null;
}

/** The next `count` days from `fromDay`: [{ day, date, kind, temp, source }] (days with no weather are left out). */
export function weekForecast(state, { plan, climates = [], dateOfDay = () => '', fromDay = state?.world?.clock?.day ?? 0, count = 7, climate, monthOf } = {}) {
  const out = [];
  if (!fromDay) return out;
  for (let day = fromDay; day < fromDay + count; day += 1) {
    const found = weatherFor({ ...state, world: { ...state?.world, weather: day === fromDay ? state?.world?.weather : null } }, { plan, climates, date: dateOfDay(day), day, part: 'day', climate, monthOf });
    if (found) out.push({ day, date: dateOfDay(day), ...found });
  }
  return out;
}

// ---- What the model gets ----------------------------------------------------------

/** «weather: rain, about 14°C — drizzle» for the scene block, or '' when there is none. */
export function weatherLine(weather) {
  if (!weather || !WEATHER_KINDS[weather.kind]) return '';
  const temp = weather.temp == null ? '' : `, about ${weather.temp > 0 ? '+' : ''}${weather.temp}°C`;
  return `weather: ${WEATHER_KINDS[weather.kind].en}${temp}${weather.text ? ` — ${weather.text}` : ''}`;
}

/** «🌧 14°» for the drawer. */
export function weatherBadge(weather) {
  if (!weather || !WEATHER_KINDS[weather.kind]) return '';
  return `${WEATHER_KINDS[weather.kind].icon}${weather.temp == null ? '' : ` ${weather.temp}°`}`;
}
