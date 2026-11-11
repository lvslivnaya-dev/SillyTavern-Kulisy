/**
 * «Накал»: насколько сцена сейчас накалена, 0–100. Это про сцену целиком (давление, угроза, возбуждение),
 * а не про чувства одного к другому: те живут в шкалах линий («Тревога» и остальные).
 *
 * state.world.heat = { value 0..100, why?, day?, lock? }  — нет записи = спокойно.
 * Его ведёт летописец («к концу ответа накал такой-то и почему»), правит рука в шторке.
 * Падает он логично: не быстрее HEAT_MAX_DROP за ответ, пока история не перескочила на дни вперёд,
 * а то, что поставила рука с замком, летописец не трогает.
 */
export const HEAT_MAX_DROP = 25;
export const HEAT_LEVELS = Object.freeze([
  { from: 0, id: 'calm', label: 'спокойно', hint: 'ничего не давит' },
  { from: 20, id: 'low', label: 'напряжённо', hint: 'чувствуется напряжение' },
  { from: 40, id: 'mid', label: 'накаляется', hint: 'давление растёт' },
  { from: 60, id: 'high', label: 'накалено', hint: 'давление высокое, на грани' },
  { from: 80, id: 'peak', label: 'предел', hint: 'вот-вот прорвёт' },
]);

const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

export function heatLevel(value) {
  let found = HEAT_LEVELS[0];
  for (const level of HEAT_LEVELS) if (value >= level.from) found = level;
  return found;
}

/** A stored heat, tidy; null when it is empty or calm. */
export function cleanHeat(raw, day = 0) {
  const value = Number(raw?.value);
  if (!Number.isFinite(value)) return null;
  const heat = { value: clamp(value) };
  const why = String(raw?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (why) heat.why = why;
  if (day) heat.day = day;
  if (raw?.lock) heat.lock = true;
  return heat.value > 0 || heat.lock ? heat : null;
}

/** Operation payload → the new heat: { value } sets, { delta } shifts, { clear } removes, { lock } holds. */
export function nextHeat(current, payload, day = 0) {
  if (payload?.clear) return null;
  const base = current?.value ?? 0;
  const value = payload?.value != null ? Number(payload.value) : base + (Number(payload?.delta) || 0);
  return cleanHeat({
    value,
    why: payload?.why !== undefined ? payload.why : current?.why,
    lock: payload?.lock !== undefined ? payload.lock : current?.lock,
  }, day || current?.day || 0);
}

/**
 * The level the chronicler reports → what is recorded: a drop is limited (calm does not come in one reply
 * unless days passed), a locked heat is the user's, a flashback says nothing about now. null = no change.
 */
export function heatFromReply(current, proposed, { flashback = false, daysSkipped = 0 } = {}) {
  if (!proposed || flashback || current?.lock) return null;
  const level = Number(proposed.level);
  if (!Number.isFinite(level)) return null;
  const before = current?.value ?? 0;
  let value = clamp(level);
  if (!daysSkipped && value < before - HEAT_MAX_DROP) value = before - HEAT_MAX_DROP;
  if (Math.abs(value - before) < 3 && !(value === 0 && before > 0)) return null;
  return { value, why: proposed.why ?? '' };
}

/** The line for the scene block, or '' when it is calm. */
export function heatLine(heat) {
  if (!heat || heat.value < 15) return '';
  const level = heatLevel(heat.value);
  return `scene heat: ${heat.value}/100 (${level.id}: ${level.hint})${heat.why ? ` — ${heat.why}` : ''}`;
}

export const HEAT_RULE = '- scene heat is how charged the whole scene is right now (pressure, threat, arousal), 0 calm to 100 at the limit. Let it colour pacing and what people dare to say or do: high heat means short fuses, sharp or breathless words, little patience for small talk; low heat leaves room to breathe. Keep it consistent from reply to reply: it rises with what happens on page and eases only for a reason in the story (a pause, a retreat, an apology, time passing), never by itself in a single beat. Never announce the number.';
