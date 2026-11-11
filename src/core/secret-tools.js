/**
 * Secrets and events, kept tidy (pure: no DOM, no model).
 *
 *   - a secret is only what a person made by hand, a lorebook entry, or an automatic
 *     proposal the person confirmed; the chronicler never marks one on its own any more;
 *   - an event that repeats the previous one (same people, same place, the next reply)
 *     is written into it instead of starting a new record;
 *   - old automatic «secrets» and chains of near-identical events can be tidied up in one go.
 */

/** The longest text an event may reach by merging; the prompt shows the start of it. */
export const MERGE_LIMIT = 400;
/** How many replies apart two events may be and still count as one scene. */
export const MERGE_SPAN = 4;

const witnessKey = event => [...(event.witnessIds ?? [])].sort().join('|');

/** Map eventId → index of the message whose analysis wrote it (events made by hand are absent). */
export function bornAt(state) {
  const born = new Map();
  for (const operation of state.operations ?? []) {
    if (operation.type !== 'event.add') continue;
    const id = operation.payload?.item?.id;
    const at = Number(operation.messageIndex);
    if (id && Number.isFinite(at) && !born.has(id)) born.set(id, at);
  }
  return born;
}

/** Whether nothing but its own text stands behind the event: no lore, no secret text, nobody told later. */
function plain(event, told) {
  return !event.disabled && !event.lore && !event.own && !event.secret && !told.has(event.id);
}

const toldAbout = state => new Set((state.knowledge?.learned ?? []).map(item => item.eventId));

/** Two texts as one sentence run: «A; B». */
export function joinEventTexts(first, second) {
  const head = String(first ?? '').trim().replace(/[.;\s]+$/u, '');
  return `${head}; ${String(second ?? '').trim()}`;
}

/**
 * The recent event a new one continues: same witnesses, same place, within the last three events
 * and a few replies, and the joined text still fits. null when it should be a record of its own.
 */
export function mergeTarget(state, { witnessIds, location = '', messageIndex = null, text }) {
  const events = state.knowledge?.events ?? [];
  const key = [...(witnessIds ?? [])].sort().join('|');
  if (!key) return null;
  const told = toldAbout(state);
  const born = bornAt(state);
  for (let index = events.length - 1; index >= Math.max(0, events.length - 3); index -= 1) {
    const event = events[index];
    if (!plain(event, told) || witnessKey(event) !== key) continue;
    if ((event.location ?? '') !== (location ?? '')) continue;
    const at = born.get(event.id);
    if (messageIndex != null && at != null && messageIndex - at > MERGE_SPAN) continue;
    if (joinEventTexts(event.text, text).length > MERGE_LIMIT) continue;
    return event;
  }
  return null;
}

/** Events the chronicler marked secret by itself before: not from a lorebook, not made by hand. */
export function autoSecrets(state) {
  return (state.knowledge?.events ?? []).filter(event => event.secret && !event.lore && !event.own && !event.disabled);
}

/**
 * Events that may be folded together, grouped by their witnesses: [{ key, events }] with two or more.
 * Left out: lorebook and hand-made secrets, switched-off events, events the fold has already looked at
 * (`state.ui.tidyEvents`, so the button can run out), and anything somebody was told about later
 * (folding would lose who heard it from whom).
 */
export function duplicateBuckets(state, { minimum = 2 } = {}) {
  const told = toldAbout(state);
  const looked = new Set(state.ui?.tidyEvents ?? []);
  const buckets = new Map();
  for (const event of state.knowledge?.events ?? []) {
    if (event.disabled || event.lore || event.own || looked.has(event.id) || told.has(event.id)) continue;
    const key = `${witnessKey(event)}#${event.secret ? 's' : ''}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  }
  return [...buckets].filter(([, events]) => events.length >= minimum).map(([key, events]) => ({ key, events }));
}
