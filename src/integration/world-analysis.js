/**
 * The scene chronicler: time, place, clothes and things of one reply.
 *
 * It rides in the same analyzer request as relationships and knowledge (or in the
 * chronicler's separate request) and reports, for one reply:
 *   clock      — story time at its end (24 h), skipped days, a stated date, flashback;
 *   place      — the listed location card the scene ends in, or a new place;
 *                permanent features shown for the first time, temporary changes;
 *   outfits    — full outfit of whoever visibly changed or was first described;
 *   conditions — temporary physical states (wet, bruised) and the ones that ended;
 *   items      — story-relevant objects that appear, change hands, move or are gone.
 *
 * The model only proposes. Everything is resolved here, and whatever the user locked
 * (a place, an outfit, an item) is never touched.
 *
 * Order matters and is kept by applyAnalysisResult: place → clock → scene (who came
 * in) → the rest, so "three days later Rindo walks in" lets Rindo change clothes.
 */
import { SCENE_MODES, WEATHER_KINDS, WEATHER_KIND_IDS, formatTime, parseTime, presentIds, uniqueId } from '../core/index.js';
import { mentionedEntities } from './headcanon-retrieval.js';
import { effectiveLocation, findInLibrary, linkPayloads, linkedCards } from './location-links.js';
import { findItemInLibrary, itemFromLibrary, linkedItems } from './item-links.js';
import { cardLabel, composeOutfit, wornCards } from '../core/index.js';

/** Characters the reply concerns: on stage before it, plus everyone it mentions (same rule as the knowledge chronicler). */
function chronicleCast(state, text) {
  return new Set([...presentIds(state), ...mentionedEntities(state, text)]);
}

export const WORLD_CHRONICLE_LIMITS = Object.freeze({
  locations: 30, items: 30, outfits: 8, conditions: 8, features: 8, gone: 8, traits: 4, notes: 4, slips: 4, text: 300, feature: 400, name: 120, outfit: 500,
  /** A time this much earlier than the last one is a small correction, not the next day. */
  backwardsTolerance: 60,
});

const IMPORTANCE = new Set(['normal', 'important', 'key']);
export const SLIP_KINDS = new Set(['outfit', 'item', 'time', 'place', 'looks']);
const FEATURE_KIND = new Set(['scar', 'tattoo', 'piercing', 'hair', 'eyes', 'body', 'other']);

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function same(left, right) {
  return clip(left, 1000).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === clip(right, 1000).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

const PART_RU = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };

/** Location cards worth showing: the current one, its surroundings, then the most recent others. */
function candidateLocations(state) {
  const locations = state.world?.locations ?? [];
  const currentId = state.knowledge?.scene?.locationId ?? '';
  const current = locations.find(location => location.id === currentId);
  const near = new Set();
  if (current) {
    near.add(current.id);
    let parent = current;
    const visited = new Set();
    while (parent?.parentId && !visited.has(parent.parentId)) {
      visited.add(parent.parentId);
      near.add(parent.parentId);
      parent = locations.find(location => location.id === parent.parentId);
    }
    for (const location of locations) if (location.parentId === current.id) near.add(location.id);
  }
  const rest = [...locations].reverse().filter(location => !near.has(location.id));
  return [...locations.filter(location => near.has(location.id)), ...rest].slice(0, WORLD_CHRONICLE_LIMITS.locations);
}

/**
 * Items worth showing: owned by the reply's cast, lying around (no owner), and key items.
 * Switched-off and long-unmentioned ones (`skip`) are left out; if the reply brings one
 * back by name, it is found by its name and switched on again.
 */
function candidateItems(state, cast, skip = null) {
  return (state.world?.items ?? [])
    .filter(item => !item.off && !skip?.has(item.id))
    .filter(item => (item.ownerId && cast.has(item.ownerId)) || !item.ownerId || item.importance === 'key')
    .slice(-WORLD_CHRONICLE_LIMITS.items);
}

/**
 * The SCENE STATE block of the analyzer's user prompt. `library`: places of library
 * cards read from there; `wardrobe`: the cards people wear and the saved looks.
 */
export function buildWorldBlock(state, text, library = null, wardrobe = null, skipItemIds = null) {
  const name = id => state.entities?.[id]?.name ?? id;
  const tag = id => `${name(id)} (${id})`;
  const clock = state.world?.clock ?? { label: '', day: 0, time: '', part: '' };
  const cast = chronicleCast(state, text);
  const currentId = state.knowledge?.scene?.locationId ?? '';
  const lines = [
    'SCENE STATE TRACKING',
    `Story time before this reply: ${[
      clock.day ? `day ${clock.day}` : 'day unknown',
      clock.time || 'time unknown',
      clock.part ? PART_RU[clock.part] : '',
      clock.label ? `"${clock.label}"` : '',
      clock.flashback ? 'NOW IN A FLASHBACK' : '',
    ].filter(Boolean).join(', ')}.`,
  ];
  const locations = candidateLocations(state);
  if (locations.length) {
    lines.push('Location cards (ID: name | inside | features | current changes):');
    for (const card of locations) {
      const location = effectiveLocation(card, library);
      const parent = location.parentId ? (state.world.locations.find(item => item.id === location.parentId)?.name ?? '') : '';
      lines.push(`- ${location.id}: ${location.name}${location.id === currentId ? ' [CURRENT]' : ''}${location.locked ? ' [LOCKED]' : ''}`
        + ` | ${parent || '—'} | ${location.traits.slice(0, 8).join('; ') || '—'} | ${location.notes.slice(0, 6).join('; ') || '—'}`);
    }
  } else {
    lines.push('No location cards yet.');
  }
  const wardrobeCards = wardrobe;
  const outfits = [...cast].filter(id => state.entities?.[id]).map(id => {
    const entry = state.world?.wardrobe?.[id];
    const conditions = (entry?.conditions ?? []).map(condition => `${condition.id}: ${condition.text}`).join('; ');
    const away = entry?.awayDays ? ` | away ${entry.awayDays} day(s): may have changed` : '';
    const cards = wardrobeCards ? wornCards(wardrobeCards, entry?.cardIds).map(card => `${card.id}: ${cardLabel(card)}`).join('; ') : '';
    const looks = (entry?.features ?? []).map(feature => `${feature.id}: ${feature.text}${feature.locked ? ' [LOCKED]' : ''}`).join('; ');
    return `- ${tag(id)}${entry?.locked ? ' [LOCKED]' : ''}: ${entry?.outfit || '(outfit unknown)'}${cards ? ` | wardrobe cards on: ${cards}` : ''}${looks ? ` | lasting looks: ${looks}` : ''}${conditions ? ` | conditions: ${conditions}` : ''}${away}`;
  });
  if (outfits.length) lines.push('Outfits of the characters of this reply:', ...outfits);
  const looks = (wardrobeCards?.looks ?? []).slice(0, 30);
  if (looks.length) lines.push(`Saved looks (ID: name): ${looks.map(look => `${look.id}: ${look.name}`).join('; ')}`);
  const items = candidateItems(state, cast, skipItemIds ? new Set(skipItemIds) : null);
  if (items.length) {
    lines.push('Tracked items (ID: name | holder | where | importance):');
    for (const item of items) {
      lines.push(`- ${item.id}: ${item.name}${item.locked ? ' [LOCKED]' : ''}${item.secret ? ' [SECRET]' : ''} | ${item.ownerId ? name(item.ownerId) : 'nobody'} | ${item.place || '—'} | ${item.importance}`);
    }
  }
  return `\n${lines.join('\n').slice(0, 9000)}\nEND SCENE STATE TRACKING\n`;
}

/** Instructions appended to the analyzer's system prompt. */
export const WORLD_INSTRUCTIONS = ` Also return "world": {"clock":{"time":"HH:MM","advanceDays":0,"label":"","flashback":false,"mode":"calm"},"weather":{"kind":"clear|cloudy|rain|storm|snow|fog|wind|heat","tempC":null,"text":""},"place":{"locationId":"listed ID or null","new":{"name":"short place","parentId":"listed ID or null","traits":["feature"]},"addTraits":[],"addNotes":[],"removeNotes":[]},"outfits":[{"entityId":"a","outfit":"full current outfit","cardIds":["listed wardrobe card IDs still worn"],"lookId":"listed look ID or null"}],"conditions":[{"entityId":"a","text":"short state","days":1}],"conditionsGone":[{"entityId":"a","conditionId":"listed ID"}],"features":[{"entityId":"a","text":"lasting look, Russian","kind":"scar"}],"featuresChanged":[{"entityId":"a","featureId":"listed ID","text":"the full new text"}],"featuresGone":[{"entityId":"a","featureId":"listed ID"}],"items":[{"itemId":"listed ID, omit for a new item","name":"short name","ownerId":"a or null","place":"where exactly","importance":"normal","secret":false}],"itemsGone":["listed ID"],"slips":[{"kind":"outfit","entityId":"a","quote":"words from the reply","note":"short Russian: what contradicts what"}]}.
SCENE STATE RULES:
- clock.time: story time at the END of this reply, 24-hour HH:MM. Estimate from cues (dawn, lunch, "after midnight", how long things take) and keep it consistent with the previous time; omit when nothing suggests a time. advanceDays: whole days this reply skips ("three days later" = 3; crossing midnight into the next day = 1); 0 otherwise. label: weekday or date ONLY if the text states it. flashback: true only while the reply narrates the past, false when it returns to the present. mode: what the scene is at the END of this reply — "fight" when a physical fight or battle is under way or breaking out, "intim" when sexual intimacy is under way or clearly starting (undressing each other, heavy petting, sex), otherwise "calm". Always give it.
- weather: the weather OUTDOORS at the END of this reply, ONLY when the reply states or clearly shows it (rain on the window, snow, a hot sun, someone shivering from cold, wet hair from rain). kind is one of the listed words; tempC a number only if stated or obvious, otherwise null; text a few Russian words about how it looks («моросит, лужи»). Omit "weather" when the reply says nothing about it, and during a flashback.
- place.locationId: the listed card where the scene is at the END of the reply. A place that is not listed goes to "new" (a few Russian words; parentId when it is inside a listed place) with locationId null. addTraits: permanent physical features shown for the first time (layout, furniture, smell) — not people, not weather. addNotes: temporary changes of the place (a broken window, lit candles); removeNotes: exact listed note text that is no longer true. Omit "place" when the place is unclear.
- outfits: ONLY when clothing visibly changes or is described for the first time: the FULL current outfit in Russian, not the difference. Never for [LOCKED]. Someone off stage keeps their clothes. cardIds: of the listed "wardrobe cards on", the ones still worn after the change (omit when none are listed). lookId: a listed saved look they put on as a whole ("надел форму Тосвы"), else null.
- conditions: temporary physical states shown on page (wet, bloodied, bruise on the cheek, messy hair, drunk); days = how many story days it plausibly lasts. conditionsGone: a listed condition the reply shows ending (washed, dried, healed).
- features: LASTING looks that appear in the story or are revealed for the first time and stay — a scar, a tattoo, a piercing, dyed or cut hair, coloured lenses, a crooked nose after a break; kind: scar|tattoo|piercing|hair|eyes|body|other. Russian, where and what ("шрам через левую бровь"). Not clothes, not make-up, not a passing state (that is a condition), not what the character card already says unless it changed. When a listed condition leaves a lasting mark (the cut healed into a scar), add the feature and put the condition into conditionsGone. featuresChanged: a listed lasting look that changes or gets a new detail (the hair dyed again, we learn where the scar is from) — the FULL new text, the old detail kept when still true. Never for [LOCKED]. featuresGone: only when it is truly gone (a tattoo removed).
- items: only story-relevant objects that appear, change hands, are hidden or moved — a weapon, a letter, a gift, keys, money in an envelope. Not furniture, not food or drink used at once, not a cigarette, a napkin, a cup or anything else used once and forgotten, not clothing. When in doubt, leave it out. ownerId: who has it now (null = lying somewhere, then "place" says where). importance: "key" plot-critical, "important" meaningful, "normal" otherwise. secret: true when its holder hides it from the others. Never for [LOCKED]. itemsGone: used up, destroyed or lost for good.
- slips: continuity errors of THIS reply against the listed state, shown on page with no in-story reason — kind "outfit" (wears something other than the listed outfit without changing; never for "may have changed"), "item" (uses or shows an item they do not have, or one listed as gone), "time" (contradicts the listed time without a skip), "place" (acts as if elsewhere), "looks" (describes someone against their listed lasting looks — the old hair colour, no scar where one is listed). quote: the exact words, at most 120 characters. A slip is never written into outfits/items. An empty array is the normal answer; never guess.
Empty arrays and omitted parts are correct and frequent.`;

const ID = value => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
const TEXTS = (value, max, itemMax = WORLD_CHRONICLE_LIMITS.text) => (Array.isArray(value)
  ? [...new Set(value.map(item => clip(item, itemMax)).filter(Boolean))].slice(0, max) : []);
const OBJECT = value => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

/** Strict, tolerant parse of the "world" object: bad items are dropped, a missing part is empty. */
export function parseWorld(value) {
  const source = OBJECT(value) ?? {};
  const rawClock = OBJECT(source.clock);
  let clock = null;
  if (rawClock) {
    const minutes = parseTime(rawClock.time);
    const days = Math.round(Number(rawClock.advanceDays));
    clock = {
      ...(minutes != null ? { time: formatTime(minutes) } : {}),
      ...(Number.isFinite(days) && days > 0 ? { advanceDays: Math.min(days, 3650) } : {}),
      ...(clip(rawClock.label, 120) ? { label: clip(rawClock.label, 120) } : {}),
      ...(typeof rawClock.flashback === 'boolean' ? { flashback: rawClock.flashback } : {}),
      ...(SCENE_MODES.includes(rawClock.mode) ? { mode: rawClock.mode } : {}),
    };
    if (!Object.keys(clock).length) clock = null;
  }
  const rawWeather = OBJECT(source.weather);
  const tempC = rawWeather && rawWeather.tempC != null && rawWeather.tempC !== '' ? Math.round(Number(rawWeather.tempC)) : null;
  const weather = rawWeather && WEATHER_KIND_IDS.includes(rawWeather.kind)
    ? { kind: rawWeather.kind, temp: Number.isFinite(tempC) && Math.abs(tempC) <= 60 ? tempC : null, text: clip(rawWeather.text, 120) } : null;
  const rawPlace = OBJECT(source.place);
  let place = null;
  if (rawPlace) {
    const rawNew = OBJECT(rawPlace.new);
    place = {
      locationId: ID(rawPlace.locationId),
      new: rawNew && clip(rawNew.name, WORLD_CHRONICLE_LIMITS.name)
        ? { name: clip(rawNew.name, WORLD_CHRONICLE_LIMITS.name), parentId: ID(rawNew.parentId), traits: TEXTS(rawNew.traits, WORLD_CHRONICLE_LIMITS.traits * 2) }
        : null,
      addTraits: TEXTS(rawPlace.addTraits, WORLD_CHRONICLE_LIMITS.traits),
      addNotes: TEXTS(rawPlace.addNotes, WORLD_CHRONICLE_LIMITS.notes),
      removeNotes: TEXTS(rawPlace.removeNotes, WORLD_CHRONICLE_LIMITS.notes),
    };
    if (!place.locationId && !place.new) place = null;
  }
  const list = (key, max) => (Array.isArray(source[key]) ? source[key] : []).filter(OBJECT).slice(0, max);
  const outfits = list('outfits', WORLD_CHRONICLE_LIMITS.outfits)
    .filter(item => ID(item.entityId) && (clip(item.outfit, WORLD_CHRONICLE_LIMITS.outfit) || ID(item.lookId)))
    .map(item => ({
      entityId: ID(item.entityId),
      outfit: clip(item.outfit, WORLD_CHRONICLE_LIMITS.outfit),
      ...(Array.isArray(item.cardIds) ? { cardIds: item.cardIds.map(ID).filter(Boolean).slice(0, 40) } : {}),
      ...(ID(item.lookId) ? { lookId: ID(item.lookId) } : {}),
    }));
  const conditions = list('conditions', WORLD_CHRONICLE_LIMITS.conditions)
    .filter(item => ID(item.entityId) && clip(item.text, WORLD_CHRONICLE_LIMITS.text))
    .map(item => {
      const days = Math.round(Number(item.days));
      return { entityId: ID(item.entityId), text: clip(item.text, WORLD_CHRONICLE_LIMITS.text), ...(Number.isFinite(days) && days > 0 ? { days: Math.min(days, 3650) } : {}) };
    });
  const conditionsGone = list('conditionsGone', WORLD_CHRONICLE_LIMITS.gone)
    .filter(item => ID(item.entityId) && ID(item.conditionId))
    .map(item => ({ entityId: ID(item.entityId), conditionId: ID(item.conditionId) }));
  const features = list('features', WORLD_CHRONICLE_LIMITS.features)
    .filter(item => ID(item.entityId) && clip(item.text, WORLD_CHRONICLE_LIMITS.feature))
    .map(item => ({ entityId: ID(item.entityId), text: clip(item.text, WORLD_CHRONICLE_LIMITS.feature), kind: FEATURE_KIND.has(item.kind) ? item.kind : 'other' }));
  const featuresChanged = list('featuresChanged', WORLD_CHRONICLE_LIMITS.features)
    .filter(item => ID(item.entityId) && ID(item.featureId) && clip(item.text, WORLD_CHRONICLE_LIMITS.feature))
    .map(item => ({ entityId: ID(item.entityId), featureId: ID(item.featureId), text: clip(item.text, WORLD_CHRONICLE_LIMITS.feature) }));
  const featuresGone = list('featuresGone', WORLD_CHRONICLE_LIMITS.gone)
    .filter(item => ID(item.entityId) && ID(item.featureId))
    .map(item => ({ entityId: ID(item.entityId), featureId: ID(item.featureId) }));
  const items = list('items', WORLD_CHRONICLE_LIMITS.items)
    .filter(item => ID(item.itemId) || clip(item.name, WORLD_CHRONICLE_LIMITS.name))
    .map(item => ({
      ...(ID(item.itemId) ? { itemId: ID(item.itemId) } : {}),
      ...(clip(item.name, WORLD_CHRONICLE_LIMITS.name) ? { name: clip(item.name, WORLD_CHRONICLE_LIMITS.name) } : {}),
      // null = nobody holds it now; undefined = the holder did not change.
      ...(Object.hasOwn(item, 'ownerId') ? { ownerId: ID(item.ownerId) } : {}),
      ...(item.place != null ? { place: clip(item.place, WORLD_CHRONICLE_LIMITS.text) } : {}),
      ...(IMPORTANCE.has(item.importance) ? { importance: item.importance } : {}),
      ...(typeof item.secret === 'boolean' ? { secret: item.secret } : {}),
    }));
  const itemsGone = (Array.isArray(source.itemsGone) ? source.itemsGone : []).map(ID).filter(Boolean).slice(0, WORLD_CHRONICLE_LIMITS.gone);
  const slips = list('slips', WORLD_CHRONICLE_LIMITS.slips)
    .filter(item => SLIP_KINDS.has(item.kind) && clip(item.quote, 160))
    .map(item => ({ kind: item.kind, ...(ID(item.entityId) ? { entityId: ID(item.entityId) } : {}), quote: clip(item.quote, 160), note: clip(item.note, 200) }));
  return { clock, weather, place, outfits, conditions, conditionsGone, features, featuresChanged, featuresGone, items, itemsGone, slips };
}

/**
 * Step 1: the place. Returns the location card ID the scene ends in, or undefined
 * when the chronicler said nothing about the place. A "new" place whose name matches
 * an existing card reuses that card instead of making a twin.
 */
export function materializePlace(world, api) {
  const place = world?.place;
  if (!place) return undefined;
  const locations = () => api.state().world?.locations ?? [];
  if (place.locationId && locations().some(location => location.id === place.locationId)) return place.locationId;
  if (!place.new) return undefined;
  const twin = locations().find(location => same(location.name, place.new.name));
  if (twin) return twin.id;
  // A place from the library that this chat has not switched on yet: switch it on
  // (with the places it sits in) instead of making a twin. Part of this reply, so a swipe undoes it.
  const known = api.library ? findInLibrary(api.library, place.new.name) : null;
  if (known) {
    const payloads = linkPayloads(api.state(), api.library, [known.id]);
    for (const payload of payloads) api.add('location.add', payload, `Место из библиотеки: ${payload.item.name}`);
    return linkedCards(api.state()).get(known.id)?.id;
  }
  const id = uniqueId('location');
  const parentId = place.new.parentId && locations().some(location => location.id === place.new.parentId) ? place.new.parentId : '';
  api.add('location.add', { item: { id, name: place.new.name, traits: place.new.traits, ...(parentId ? { parentId } : {}) } }, `Новое место: ${place.new.name}`);
  return id;
}

/**
 * Step 2: the clock. Time never runs backwards: an earlier time than the last one
 * (beyond a small correction) means midnight was crossed. In a flashback the present
 * clock stands still; only the flag changes.
 */
export function materializeClock(world, api) {
  const proposed = world?.clock;
  if (!proposed) return;
  const clock = api.state().world?.clock ?? { label: '', day: 0, time: '', part: '' };
  if (proposed.flashback === true) {
    if (!clock.flashback) api.add('clock.set', { flashback: true }, 'Флешбек');
    return;
  }
  const payload = {};
  if (proposed.flashback === false && clock.flashback) payload.flashback = false;
  if (proposed.mode && proposed.mode !== (clock.mode ?? 'calm')) payload.mode = proposed.mode;
  let days = proposed.advanceDays ?? 0;
  const now = parseTime(clock.time);
  const next = proposed.time != null ? parseTime(proposed.time) : null;
  if (!days && now != null && next != null && next < now - WORLD_CHRONICLE_LIMITS.backwardsTolerance) days = 1;
  if (proposed.label && proposed.label !== clock.label) payload.label = proposed.label;
  if (next != null && (proposed.time !== clock.time || days)) payload.time = proposed.time;
  if (!clock.day && (next != null || days || payload.label)) payload.day = 1 + days;
  else if (days) payload.advanceDays = days;
  if (!Object.keys(payload).length) return;
  const modeText = { calm: 'сцена спокойная', fight: 'бой', intim: 'близость' }[payload.mode] ?? '';
  const when = [payload.advanceDays ? `+${payload.advanceDays} дн.` : '', payload.time ?? '', payload.label ?? '', modeText].filter(Boolean).join(', ');
  api.add('clock.set', payload, `Время: ${when || (payload.flashback === false ? 'конец флешбека' : 'уточнено')}`);
}

/**
 * The weather the reply shows. Locked weather is the user's; flashbacks say nothing about now;
 * the same weather again (same day, same kind, nothing new) is not recorded twice.
 */
export function materializeWeather(world, api) {
  const proposed = world?.weather;
  if (!proposed) return;
  const state = api.state();
  const clock = state.world?.clock ?? {};
  const current = state.world?.weather;
  if (current?.lock || clock.flashback) return;
  const day = clock.day || 0;
  if (current && (current.day === day || !day) && current.kind === proposed.kind
    && (proposed.temp == null || proposed.temp === current.temp) && (!proposed.text || proposed.text === current.text)) return;
  const keepTemp = current && current.day === day && current.kind === proposed.kind ? current.temp : null;
  api.add('weather.set', { kind: proposed.kind, temp: proposed.temp ?? keepTemp, text: proposed.text }, `Погода: ${WEATHER_KINDS[proposed.kind].label.toLowerCase()}${proposed.text ? `, ${proposed.text}` : ''}`);
}

/** Step 4: features of the place, outfits, conditions, items. Locked entries are skipped. */
export function materializeWorldRest(world, api, locationId) {
  if (!world) return;
  const { add, resolveId } = api;
  const state = () => api.state();
  const nameOf = id => state().entities?.[id]?.name ?? id;

  // Place features: only for an existing, unlocked card.
  const place = world.place;
  const location = locationId ? (state().world?.locations ?? []).find(item => item.id === locationId) : null;
  if (place && location && !location.locked) {
    const traits = [...location.traits, ...place.addTraits.filter(text => !location.traits.some(trait => same(trait, text)))];
    const notes = [
      ...location.notes.filter(note => !place.removeNotes.some(text => same(text, note))),
      ...place.addNotes.filter(text => !location.notes.some(note => same(note, text))),
    ];
    const changes = {};
    if (traits.length !== location.traits.length) changes.traits = traits;
    if (JSON.stringify(notes) !== JSON.stringify(location.notes)) changes.notes = notes;
    if (Object.keys(changes).length) add('location.update', { locationId: location.id, changes }, `Место изменилось: ${location.name}`);
  }

  for (const item of world.outfits) {
    const entityId = resolveId(item.entityId);
    if (!entityId) continue;
    const entry = state().world?.wardrobe?.[entityId];
    if (entry?.locked) continue;
    // Wardrobe cards: a saved look put on whole, or the worn cards that stay on.
    const look = item.lookId && api.wardrobe ? api.wardrobe.looks.find(candidate => candidate.id === item.lookId) : null;
    const known = new Set((api.wardrobe?.cards ?? []).map(card => card.id));
    const cardIds = look ? look.cardIds : (item.cardIds ?? []).filter(id => known.has(id) && (entry?.cardIds ?? []).includes(id));
    const outfit = item.outfit || (look ? composeOutfit(api.wardrobe, look.cardIds) : '');
    if (!outfit || (same(entry?.outfit ?? '', outfit) && !look)) continue;
    add('wardrobe.set', { entityId, outfit, ...(look || cardIds.length ? { cardIds } : {}) }, `${nameOf(entityId)} одет(а): ${look ? look.name : outfit}`);
  }

  for (const item of world.conditionsGone) {
    const entityId = resolveId(item.entityId);
    const entry = entityId ? state().world?.wardrobe?.[entityId] : null;
    const condition = entry?.conditions?.find(candidate => candidate.id === item.conditionId);
    if (!condition || entry.locked) continue;
    add('condition.remove', { entityId, conditionId: condition.id }, `${nameOf(entityId)}: прошло «${condition.text}»`);
  }
  for (const item of world.conditions) {
    const entityId = resolveId(item.entityId);
    if (!entityId) continue;
    const entry = state().world?.wardrobe?.[entityId];
    if (entry?.locked || (entry?.conditions ?? []).some(condition => same(condition.text, item.text))) continue;
    add('condition.add', { entityId, item: { id: uniqueId('condition'), text: item.text, ...(item.days ? { days: item.days } : {}) } },
      `${nameOf(entityId)}: ${item.text}`);
  }

  // Lasting looks: new ones (never a twin of a listed one), changed, gone. Locked ones stay.
  for (const item of world.features ?? []) {
    const entityId = resolveId(item.entityId);
    if (!entityId || !state().entities?.[entityId]) continue;
    const have = state().world?.wardrobe?.[entityId]?.features ?? [];
    if (have.some(feature => same(feature.text, item.text))) continue;
    add('feature.add', { entityId, item: { id: uniqueId('feature'), text: item.text, kind: item.kind } }, `${nameOf(entityId)}: ${item.text}`);
  }
  for (const item of world.featuresChanged ?? []) {
    const entityId = resolveId(item.entityId);
    const feature = state().world?.wardrobe?.[entityId]?.features?.find(candidate => candidate.id === item.featureId);
    if (!feature || feature.locked || same(feature.text, item.text)) continue;
    add('feature.update', { entityId, featureId: feature.id, changes: { text: item.text } }, `${nameOf(entityId)}: ${item.text}`);
  }
  for (const item of world.featuresGone ?? []) {
    const entityId = resolveId(item.entityId);
    const feature = state().world?.wardrobe?.[entityId]?.features?.find(candidate => candidate.id === item.featureId);
    if (!feature || feature.locked) continue;
    add('feature.remove', { entityId, featureId: feature.id }, `${nameOf(entityId)}: больше нет — ${feature.text}`);
  }

  const items = () => state().world?.items ?? [];
  for (const proposed of world.items) {
    const ownerId = proposed.ownerId === undefined ? undefined : (proposed.ownerId ? resolveId(proposed.ownerId) : null);
    // A listed ID first. Else by name: the one with the same holder, or the only one so named
    // (a letter handed over is the same letter). Two same-named things elsewhere = a new one.
    let existing = proposed.itemId ? items().find(item => item.id === proposed.itemId) : null;
    if (!existing && proposed.name) {
      const named = items().filter(item => same(item.name, proposed.name));
      existing = named.find(item => ownerId !== undefined && (item.ownerId ?? null) === ownerId) ?? (named.length === 1 ? named[0] : null);
    }
    // A thing from the library (by its name or another name): the chat's copy of it,
    // or — not switched on here yet — switch it on as part of this reply.
    const shelved = !existing && proposed.name && api.library ? findItemInLibrary(api.library, proposed.name) : null;
    if (shelved) {
      existing = linkedItems(state()).get(shelved.id) ?? null;
      if (!existing) {
        const base = itemFromLibrary(state(), shelved);
        const holder = ownerId !== undefined ? ownerId : (base.ownerId ?? null);
        add('item.add', {
          item: {
            ...base,
            ...(holder ? { ownerId: holder } : { ownerId: '' }),
            ...(proposed.place ? { place: proposed.place } : {}),
            ...(proposed.importance ? { importance: proposed.importance } : {}),
            ...(proposed.secret ? { secret: true } : {}),
          },
        }, `Вещь из библиотеки: ${shelved.name}${holder ? ` (у ${nameOf(holder)})` : ''}`);
        continue;
      }
    }
    if (existing) {
      if (existing.locked) continue;
      const changes = {};
      if (proposed.name && !same(proposed.name, existing.name) && !existing.libraryId) changes.name = proposed.name;
      if (ownerId !== undefined && (existing.ownerId ?? null) !== ownerId) changes.ownerId = ownerId ?? '';
      if (proposed.place != null && !same(proposed.place, existing.place ?? '')) changes.place = proposed.place;
      if (proposed.importance && proposed.importance !== existing.importance) changes.importance = proposed.importance;
      if (proposed.secret != null && proposed.secret !== Boolean(existing.secret)) changes.secret = proposed.secret;
      // Switched off, but the story brought it back: on again.
      if (existing.off) changes.off = false;
      if (existing.shade) changes.shade = false;
      if (!Object.keys(changes).length) continue;
      const holder = changes.ownerId !== undefined ? ` → ${changes.ownerId ? nameOf(changes.ownerId) : 'ни у кого'}` : '';
      add('item.update', { itemId: existing.id, changes }, `Предмет: ${existing.name}${holder}`);
      continue;
    }
    if (!proposed.name) continue;
    add('item.add', {
      item: {
        id: uniqueId('item'), name: proposed.name,
        ...(ownerId ? { ownerId } : {}),
        ...(proposed.place ? { place: proposed.place } : {}),
        importance: proposed.importance ?? 'normal',
        ...(proposed.secret ? { secret: true } : {}),
      },
    }, `Новый предмет: ${proposed.name}${ownerId ? ` (у ${nameOf(ownerId)})` : ''}`);
  }
  for (const itemId of world.itemsGone) {
    const item = items().find(candidate => candidate.id === itemId);
    if (!item || item.locked) continue;
    add('item.remove', { itemId: item.id }, `Предмета больше нет: ${item.name}`);
  }
}

/** Scene change without the knowledge chronicler (it is switched off): only the place card. */
export function materializeSceneLocation(api, locationId) {
  const scene = api.state().knowledge?.scene ?? {};
  if (!locationId || scene.locationId === locationId) return;
  api.add('scene.set', { presentIds: presentIds(api.state()), locationId }, 'Сцена: смена места');
}

/**
 * Slips worth showing: the character exists (for outfit and item slips), and an
 * outfit slip is dropped when the character may have changed (away for days) or this
 * very reply recorded a new outfit for them. `before`: the state before this reply's
 * scene operations. Not journaled: like leaks, they describe this text.
 */
export function confirmSlips(world, api, before) {
  const slips = [];
  const seen = new Set();
  for (const slip of world?.slips ?? []) {
    const entityId = slip.entityId ? api.resolveId(slip.entityId) : null;
    if ((slip.kind === 'outfit' || slip.kind === 'item' || slip.kind === 'looks') && !entityId) continue;
    // Looks against nothing recorded is a guess, not a slip.
    if (slip.kind === 'looks' && !(before.world?.wardrobe?.[entityId]?.features ?? []).length) continue;
    if (slip.kind === 'outfit') {
      const was = before.world?.wardrobe?.[entityId];
      const now = api.state().world?.wardrobe?.[entityId];
      if (!was?.outfit || was.awayDays || (now?.outfit ?? '') !== was.outfit) continue;
    }
    const key = `${slip.kind}|${entityId ?? ''}|${slip.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slips.push({ kind: slip.kind, ...(entityId ? { entityId } : {}), quote: slip.quote, ...(slip.note ? { note: slip.note } : {}) });
  }
  return slips;
}
