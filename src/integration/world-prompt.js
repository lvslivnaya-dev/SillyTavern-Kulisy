/**
 * The scene block for the narrator model: what time it is, where the scene is, what
 * the characters ON STAGE wear, how they are, what they hold. Characters off stage
 * are never sent (their clothes are kept for when they come back).
 *
 * Every line has a priority; over the budget the least important go first:
 *   time → place → outfits → important things → conditions → features of the place
 *   → ordinary things → the library description of the place → of the things.
 */
import { HEAT_RULE, STAGE_RULE, activeConditions, currentLocation, heatLine, locationPath, presentIds, stageLine, weatherLine } from '../core/index.js';
import { effectiveLocation } from './location-links.js';
import { effectiveItem } from './item-links.js';
import { cardLabel, wornCards, wornLabel } from '../core/index.js';

const PART_EN = { morning: 'morning', day: 'daytime', evening: 'evening', night: 'night' };

/** How much of one wardrobe card's description, and of all of one character's, goes into the scene (defaults; the user sets them). */
export const LOOKS_LIMITS = Object.freeze({ card: 300, character: 1200 });
export const LOOKS_RANGE = Object.freeze({ card: [80, 1000], character: [200, 4000] });

/** Limits from the settings, clamped; a character's limit is never below one card's. */
export function normalizeLooksLimits(value = {}) {
  const pick = (key, raw) => {
    const number = Math.round(Number(raw));
    const [min, max] = LOOKS_RANGE[key];
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : LOOKS_LIMITS[key];
  };
  const card = pick('card', value.card ?? LOOKS_LIMITS.card);
  return { card, character: Math.max(card, pick('character', value.character ?? LOOKS_LIMITS.character)) };
}

/**
 * Open wardrobe problems for the "Проверка" page: characters on stage whose card
 * descriptions reach the narrator cut or not at all. [{ entityId, status, parts }]
 */
export function looksIssues(fit) {
  if (!fit || fit.off) return [];
  return Object.entries(fit)
    .filter(([, status]) => status === 'cut' || status === 'dropped')
    .map(([entityId, status]) => ({ entityId, status, parts: fit.parts?.[entityId] ?? [] }));
}

const RULES = `Rules:
- Keep clothing, injuries and objects consistent with these lines; change them only when the story shows it happen.
- Time moves forward from the time above, unless the story skips ahead or flashes back; keep the time of day plausible.
- "may have changed" means days passed since they were last seen: new clothes are fine if plausible, the same clothes are fine too.
- body[...] lines are LASTING changes of looks (scars, tattoos, dyed hair…). They override the character card, the persona description and wardrobe pictures wherever those differ; keep them in every description.
- A SECRET item is unknown to everyone not listed: they cannot mention or notice it unless the story reveals it.
- Do not recite or expose this block.`;

// Only when a weather line is sent.
const WEATHER_RULE = '- weather is outdoors: keep it consistent from reply to reply and let it change only gradually or when the story says so. Mention it only when it matters to the scene (rain on the window, cold breath); indoors it is just background. Dress for it: someone who goes out in frost or snow wears warm clothes (a coat, a hat, boots), in heat light ones, in rain something waterproof; a character shown underdressed for the weather is cold or hot and notices it, or has a reason.';

// Only when someone on stage wears a hairstyle card: older cards may still name a colour.
const HAIR_RULE = '- Never take the hair colour from a hairstyle card: use body[...], else the character card or persona.';

/** The rules for these lines: the hair rule joins only when a hairstyle card is sent. */
function rulesFor(lines) {
  let rules = RULES;
  if (lines.some(line => line.weather)) rules += `\n${WEATHER_RULE}`;
  if (lines.some(line => line.heat)) rules += `\n${HEAT_RULE}`;
  if (lines.some(line => line.stage)) rules += `\n${STAGE_RULE}`;
  if (lines.some(line => line.hair)) rules += `\n${HAIR_RULE}`;
  return rules;
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Lines with priorities (lower = more important), in display order. */
export function sceneLines(state, { library = null, reminders = [], wardrobe = null, skipItemIds = null, looksLimits = null, weather = null } = {}) {
  const limits = normalizeLooksLimits(looksLimits ?? {});
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
  // Outdoor weather (core/weather.js weatherFor); a flashback tells about another time.
  if (weather && !clock.flashback) add(2, weatherLine(weather), { weather: true });
  // How charged the whole scene is (core/heat.js); not while a flashback is told.
  if (!clock.flashback) add(2, heatLine(state.world?.heat), { heat: true });
  // The stage of an intimate scene (core/intimacy-stage.js): set by the user, so it goes whatever the scene type says now.
  if (!clock.flashback) add(1, stageLine(state.world?.intimacy), { stage: true });
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
      // Per card: how much of its description the line carries after the per-card
      // and the per-character cut (`parts`, for the wardrobe and the "Проверка" page).
      const pieces = [];
      const parts = [];
      let position = 0;
      for (const card of details) {
        const full = String(card.description).replace(/\s+/g, ' ').trim();
        const piece = clip(full, limits.card);
        const head = `${pieces.length ? '; ' : ''}${wornLabel(card)} — `;
        const start = position + head.length;
        pieces.push(head + piece);
        position = start + piece.length;
        parts.push({ cardId: card.id, label: cardLabel(card), start, kept: piece.endsWith('…') && piece.length < full.length ? piece.length - 1 : piece.length, total: full.length });
      }
      const joined = pieces.join('');
      // clip() keeps max-1 characters and adds "…" when the whole line is too long.
      const room = joined.length > limits.character ? limits.character - 1 : Infinity;
      for (const part of parts) {
        part.sent = Math.max(0, Math.min(part.kept, room - part.start));
        delete part.start;
        delete part.kept;
      }
      const cut = parts.some(part => part.sent < part.total);
      // What it would take to send all of it: the longest card and the whole line uncut.
      const fullLength = details.reduce((sum, card, index) => sum + (index ? 2 : 0) + wornLabel(card).length + 3 + String(card.description).replace(/\s+/g, ' ').trim().length, 0);
      const longestCard = Math.max(...parts.map(part => part.total));
      add(8, `looks[${name(id)}]: ${clip(joined, limits.character)}`, { looksOf: id, cut, parts, fullLength, longestCard, hair: details.some(card => card.category === 'hair') });
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
export function buildScenePrompt(state, { library = null, maxCharacters = 1500, reminders = [], wardrobe = null, skipItemIds = null, looksLimits = null, weather = null } = {}) {
  const lines = sceneLines(state, { library, reminders, wardrobe, skipItemIds, looksLimits, weather });
  if (!lines.length) return '';
  const { kept, budget } = fitLines(lines, maxCharacters);
  const sent = lines.filter(line => kept.has(line));
  const body = sent.map(line => line.text.slice(0, budget)).join('\n');
  return `${HEAD}\n${body}\n${rulesFor(sent)}\n${TAIL}`;
}

const HEAD = '[SCENE STATE — CONTINUITY]';
const TAIL = '[/SCENE STATE]';

/** Which lines fit into `maxCharacters`: the least important go first; among equals, the last one. */
function fitLines(lines, maxCharacters) {
  // Room for the hair rule is reserved whenever a hairstyle line is among the candidates.
  const budget = Math.max(200, maxCharacters - HEAD.length - TAIL.length - rulesFor(lines).length - 4);
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
export function looksFit(state, { library = null, maxCharacters = 1500, reminders = [], wardrobe = null, skipItemIds = null, looksLimits = null } = {}) {
  const result = {};
  if (!wardrobe) return result;
  for (const [id, entry] of Object.entries(state.world?.wardrobe ?? {})) {
    if (wornCards(wardrobe, entry?.cardIds).some(card => card.description)) result[id] = 'offstage';
  }
  const lines = sceneLines(state, { library, reminders, wardrobe, skipItemIds, looksLimits });
  const { kept } = fitLines(lines, maxCharacters);
  // `parts`: per card, how many characters of its description reach the narrator.
  result.parts = {};
  for (const line of lines) {
    if (!line.looksOf) continue;
    result[line.looksOf] = kept.has(line) ? (line.cut ? 'cut' : 'full') : 'dropped';
    result.parts[line.looksOf] = kept.has(line) ? line.parts : line.parts.map(part => ({ ...part, sent: 0 }));
  }
  const looks = lines.filter(line => line.looksOf);
  // When something does not reach the narrator whole: the limits and the scene volume
  // that would send every description of everyone on stage in full (`needLooks`).
  if (looks.some(line => result[line.looksOf] !== 'full')) {
    const cardMax = LOOKS_RANGE.card[1];
    const characterMax = LOOKS_RANGE.character[1];
    const card = Math.min(cardMax, Math.max(...looks.map(line => line.longestCard)));
    const character = Math.min(characterMax, Math.max(card, ...looks.map(line => line.fullLength)));
    const tooLong = looks.flatMap(line => line.parts.filter(part => part.total > cardMax).map(part => ({ entityId: line.looksOf, label: part.label, total: part.total })));
    const overCharacter = looks.filter(line => line.fullLength > characterMax).map(line => line.looksOf);
    const needed = sceneLines(state, { library, reminders, wardrobe, skipItemIds, looksLimits: { card, character } });
    const neededLooks = needed.filter(line => line.looksOf);
    let scene = null;
    for (let volume = Math.max(maxCharacters, 300); volume <= 6000; volume = volume === maxCharacters ? Math.ceil((maxCharacters + 1) / 100) * 100 : volume + 100) {
      const fits = fitLines(needed, volume).kept;
      if (neededLooks.every(line => fits.has(line))) { scene = volume; break; }
    }
    result.needLooks = { card, character, scene, tooLong, overCharacter };
  }
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
