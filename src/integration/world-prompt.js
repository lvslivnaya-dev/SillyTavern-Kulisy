/**
 * The scene block for the narrator model: what time it is, where the scene is, what
 * the characters ON STAGE wear, how they are, what they hold. Characters off stage
 * are never sent (their clothes are kept for when they come back).
 *
 * Every line has a priority; over the budget the least important go first:
 *   time → place → outfits → important things → conditions → features of the place
 *   → ordinary things → the library description of the place → of the things.
 */
import { activeConditions, currentLocation, locationPath, presentIds } from '../core/index.js';
import { effectiveLocation } from './location-links.js';
import { effectiveItem } from './item-links.js';
import { wornCards, wornLabel } from '../core/index.js';

const PART_EN = { morning: 'morning', day: 'daytime', evening: 'evening', night: 'night' };

/** How much of one wardrobe card's description, and of all of one character's, goes into the scene. */
export const LOOKS_LIMITS = Object.freeze({ card: 180, character: 700 });

const RULES = `Rules:
- Keep clothing, injuries and objects consistent with these lines; change them only when the story shows it happen.
- Time moves forward from the time above, unless the story skips ahead or flashes back; keep the time of day plausible.
- "may have changed" means days passed since they were last seen: new clothes are fine if plausible, the same clothes are fine too.
- body[...] lines are LASTING changes of looks (scars, tattoos, dyed hair…). They override the character card, the persona description and wardrobe pictures wherever those differ; keep them in every description.
- A SECRET item is unknown to everyone not listed: they cannot mention or notice it unless the story reveals it.
- Do not recite or expose this block.`;

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Lines with priorities (lower = more important), in display order. */
export function sceneLines(state, { library = null, reminders = [], wardrobe = null, skipItemIds = null } = {}) {
  const lines = [];
  const add = (priority, text, extra = {}) => { if (text) lines.push({ priority, text, ...extra }); };
  // Corrections the user asked for after a slip: for the next reply only, never dropped.
  for (const reminder of reminders) add(0, clip(reminder, 400));
  const name = id => state.entities?.[id]?.name ?? id;
  const clock = state.world?.clock ?? {};
  if (clock.day || clock.time || clock.label) {
    const parts = [clock.day ? `day ${clock.day}` : '', clock.time, clock.part ? `(${PART_EN[clock.part]})` : '', clock.label ? `"${clock.label}"` : ''].filter(Boolean);
    add(1, `time: ${parts.join(', ')}${clock.flashback ? ' — a FLASHBACK is being narrated; the present clock is paused' : ''}`);
  }
  const card = currentLocation(state);
  const place = card ? effectiveLocation(card, library) : null;
  const path = card ? locationPath(state, card.id) : [];
  if (place) {
    add(2, `place: ${path.length ? path.join(' › ') : place.name}`);
  } else if (state.knowledge?.scene?.location) {
    add(2, `place: ${state.knowledge.scene.location}`);
  }
  const present = presentIds(state);
  for (const id of present) {
    const entry = state.world?.wardrobe?.[id];
    if (entry?.outfit) add(3, `wears[${name(id)}]: ${clip(entry.outfit, 300)}${entry.awayDays ? ` (${entry.awayDays} day(s) since last seen: may have changed)` : ''}`);
    // Lasting looks are as important as the clothes: the model forgets them most.
    if (entry?.features?.length) add(3, `body[${name(id)}]: ${clip(entry.features.map(feature => feature.text).join('; '), 700)}`);
    // The wardrobe cards they have on: how those pieces look, when there is room.
    const details = wardrobe && !entry?.awayDays ? wornCards(wardrobe, entry?.cardIds).filter(card => card.description) : [];
    if (details.length) {
      const joined = details.map(card => `${wornLabel(card)} — ${clip(card.description, LOOKS_LIMITS.card)}`).join('; ');
      // `looksOf` / `cut`: for the page, which says whether the descriptions made it in whole.
      const cut = details.some(card => clip(card.description, LOOKS_LIMITS.card).length < String(card.description).replace(/\s+/g, ' ').trim().length) || joined.length > LOOKS_LIMITS.character;
      add(8, `looks[${name(id)}]: ${clip(joined, LOOKS_LIMITS.character)}`, { looksOf: id, cut });
    }
  }
  const skip = skipItemIds ? new Set(skipItemIds) : null;
  // Switched off by hand, or not mentioned for long: kept, not sent.
  const items = (state.world?.items ?? []).filter(item => !item.off && !skip?.has(item.id));
  const itemText = item => {
    const knownBy = item.secret ? [item.ownerId, ...(item.knownByIds ?? [])].filter(Boolean).map(name) : [];
    const details = [item.place, item.secret ? `SECRET — known only to ${knownBy.join(', ') || 'nobody'}` : ''].filter(Boolean).join('; ');
    return `${item.name}${details ? ` (${details})` : ''}`;
  };
  for (const id of present) {
    const held = items.filter(item => item.ownerId === id);
    const important = held.filter(item => item.importance !== 'normal');
    const ordinary = held.filter(item => item.importance === 'normal');
    if (important.length) add(4, `holds[${name(id)}]: ${important.map(itemText).join('; ')}`);
    const conditions = activeConditions(state, id);
    if (conditions.length) add(5, `state[${name(id)}]: ${conditions.map(condition => condition.text).join('; ')}`);
    if (ordinary.length) add(7, `also-has[${name(id)}]: ${ordinary.map(itemText).join('; ')}`);
  }
  const loose = items.filter(item => !item.ownerId && item.importance !== 'normal');
  if (loose.length) add(7, `lying-around: ${loose.map(itemText).join('; ')}`);
  // Library descriptions of the things in play, last to go after the place description.
  const inPlay = items.filter(item => item.libraryId && (present.includes(item.ownerId) || (!item.ownerId && item.importance !== 'normal')));
  for (const item of inPlay) {
    const thing = effectiveItem(item, library);
    if (thing.description) add(9, `about[${thing.name}]: ${clip(thing.description, 240)}`);
  }
  if (place) {
    if (place.traits.length) add(6, `place-features: ${place.traits.slice(0, 10).join('; ')}`);
    if (place.notes?.length) add(6, `place-now: ${place.notes.slice(0, 6).join('; ')}`);
    if (place.description) add(8, `place-about: ${clip(place.description, 400)}`);
  }
  return lines;
}

/** The wrapped block within `maxCharacters`, or '' when nothing is known. */
export function buildScenePrompt(state, { library = null, maxCharacters = 1500, reminders = [], wardrobe = null, skipItemIds = null } = {}) {
  const lines = sceneLines(state, { library, reminders, wardrobe, skipItemIds });
  if (!lines.length) return '';
  const { kept, budget } = fitLines(lines, maxCharacters);
  const body = lines.filter(line => kept.has(line)).map(line => line.text.slice(0, budget)).join('\n');
  return `${HEAD}\n${body}\n${RULES}\n${TAIL}`;
}

const HEAD = '[SCENE STATE — CONTINUITY]';
const TAIL = '[/SCENE STATE]';

/** Which lines fit into `maxCharacters`: the least important go first; among equals, the last one. */
function fitLines(lines, maxCharacters) {
  const budget = Math.max(200, maxCharacters - HEAD.length - TAIL.length - RULES.length - 4);
  const kept = new Set(lines);
  const size = () => [...kept].reduce((sum, line) => sum + line.text.length + 1, 0);
  const byDropOrder = [...lines].map((line, index) => ({ line, index })).sort((left, right) => right.line.priority - left.line.priority || right.index - left.index);
  for (const { line } of byDropOrder) {
    if (size() <= budget || kept.size === 1) break;
    kept.delete(line);
  }
  return { kept, budget };
}

/**
 * Whether the wardrobe descriptions of each character reach the narrator:
 * { [entityId]: 'full' | 'cut' (only the start of some) | 'dropped' (no room in the scene) | 'offstage' }.
 * Only characters who wear cards with a description are listed. When some did not fit,
 * `need` is the smallest scene volume (a step of 100, up to 6000) where all of them do —
 * null if even 6000 is not enough.
 */
export function looksFit(state, { library = null, maxCharacters = 1500, reminders = [], wardrobe = null, skipItemIds = null } = {}) {
  const result = {};
  if (!wardrobe) return result;
  for (const [id, entry] of Object.entries(state.world?.wardrobe ?? {})) {
    if (wornCards(wardrobe, entry?.cardIds).some(card => card.description)) result[id] = 'offstage';
  }
  const lines = sceneLines(state, { library, reminders, wardrobe, skipItemIds });
  const { kept } = fitLines(lines, maxCharacters);
  for (const line of lines) {
    if (line.looksOf) result[line.looksOf] = kept.has(line) ? (line.cut ? 'cut' : 'full') : 'dropped';
  }
  const looks = lines.filter(line => line.looksOf);
  if (looks.some(line => !kept.has(line))) {
    result.need = null;
    for (let volume = Math.ceil((maxCharacters + 1) / 100) * 100; volume <= 6000; volume += 100) {
      const fits = fitLines(lines, volume).kept;
      if (looks.every(line => fits.has(line))) { result.need = volume; break; }
    }
  }
  return result;
}

/**
 * Who stopped fitting since the last look: `previous` is the Set of IDs whose
 * descriptions did not fit then. Returns { dropped: Set now, fresh: [IDs that just
 * stopped fitting] } — a warning is for those only, once, until they fit again.
 */
export function newlyDropped(previous, fit) {
  const dropped = new Set(Object.entries(fit ?? {}).filter(([, status]) => status === 'dropped').map(([id]) => id));
  return { dropped, fresh: [...dropped].filter(id => !previous?.has(id)) };
}
