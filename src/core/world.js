/**
 * The physical side of the scene: story time, places, what people wear, things.
 *
 * state.world = {
 *   clock:     { label, day, time, part, flashback? }  day 0 = unknown; time 'HH:MM' (24 h) or '' = unknown;
 *                                                     part: morning|day|evening|night|'' (follows the time when it is known)
 *   locations: [{ id, name, parentId?, traits[], notes[], libraryId?, locked? }]
 *   wardrobe:  { entityId: { outfit, conditions[{ id, text, sinceDay?, days? }], seenDay?, awayDays?, locked?, cardIds? } }
 *              cardIds: wardrobe cards (core/wardrobe.js) they have on; a new outfit in words drops them
 *              features: [{ id, text, kind, sinceDay?, locked? }] — LASTING looks that changed or came
 *              out in the story (a scar, a tattoo, dyed hair); unlike conditions they never pass by themselves
 *   items:     [{ id, name, ownerId?, place?, note?, importance, secret?, knownByIds?, locked?, libraryId?, off? }]
 *              off: switched off by hand — kept, but neither sent to the model nor shown to the chronicler
 *              shade: put into the shade by hand (see integration/item-tidy.js); activeSince: the message
 *              it was brought back into use by hand, so the shade counts from there
 * }
 *
 * The current place lives in knowledge.scene (location text + optional locationId),
 * so the witness log and the scene stay one thing.
 *
 * Wardrobe of a character who is off stage is kept but not sent. `awayDays` says how many
 * story days passed since they were last seen (they were away, or the story jumped ahead):
 * 0 = same outfit for sure, more = they may have changed if the story makes it plausible.
 * A new outfit clears it.
 *
 * `locked` marks what the user fixed by hand: the chronicler must not overwrite it
 * (the integration layer checks; the core only stores the flag).
 *
 * Like knowledge, replay never fails on history: an operation pointing at a removed
 * place, item or character is a no-op, unknown IDs are dropped from lists.
 */

import { cleanWeather } from './weather.js';
import { nextHeat } from './heat.js';
import { nextStage } from './intimacy-stage.js';
import { QUEST_OPERATION_TYPES, applyQuestMutation, forgetQuestEntity, mergeQuestEntity, validateQuests } from './quests.js';

export const WORLD_OPERATION_TYPES = Object.freeze([
  'clock.set', 'weather.set', 'heat.set', 'intimacy.set',
  'location.add', 'location.update', 'location.remove',
  'wardrobe.set', 'condition.add', 'condition.update', 'condition.remove',
  'item.add', 'item.update', 'item.remove',
  'feature.add', 'feature.update', 'feature.remove',
  ...QUEST_OPERATION_TYPES,
]);

/** Kinds of a lasting feature of someone's looks. */
export const FEATURE_KINDS = Object.freeze(['scar', 'tattoo', 'piercing', 'hair', 'eyes', 'body', 'other']);

export const DAY_PARTS = Object.freeze(['morning', 'day', 'evening', 'night']);
/** What kind of scene it is now; 'calm' is the default and is not stored. */
export const SCENE_MODES = Object.freeze(['calm', 'fight', 'intim']);
/** normal: sent only when its owner is on stage or it is mentioned; important: always for present owners; key: always. */
export const ITEM_IMPORTANCE = Object.freeze(['normal', 'important', 'key']);

export const WORLD_LIMITS = Object.freeze({
  locations: 500, items: 1000, conditions: 12, features: 30, featureText: 400, traits: 20, notes: 20,
  name: 120, text: 300, outfit: 500, label: 120, maxDay: 1_000_000, maxDays: 3650,
});

export function emptyWorld() {
  return { clock: { label: '', day: 0, time: '', part: '' }, locations: [], wardrobe: {}, items: [] };
}

const MINUTES_PER_DAY = 24 * 60;

/** '7:05', '07:05', '19.30' → minutes after midnight; anything else (or 24:00+) → null. */
export function parseTime(value) {
  const match = /^\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*$/.exec(String(value ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight → 'HH:MM'. */
export function formatTime(minutes) {
  const value = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/** Part of the day for a time: 05–11 morning, 12–16 day, 17–22 evening, 23–04 night. */
export function dayPartOf(minutes) {
  const hour = Math.floor(minutes / 60);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'day';
  if (hour >= 17 && hour < 23) return 'evening';
  return 'night';
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanList(values, max, itemMax) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = cleanText(value, itemMax);
    const key = text.toLocaleLowerCase('ru-RU');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function dayNumber(value) {
  const day = Math.round(Number(value));
  return Number.isFinite(day) && day > 0 ? Math.min(day, WORLD_LIMITS.maxDay) : 0;
}

function worldOf(next) {
  next.world ??= emptyWorld();
  const world = next.world;
  world.clock ??= { label: '', day: 0, time: '', part: '' };
  world.clock.time ??= '';
  world.locations ??= [];
  world.wardrobe ??= {};
  world.items ??= [];
  return world;
}

function wardrobeOf(world, entityId) {
  world.wardrobe[entityId] ??= { outfit: '', conditions: [] };
  world.wardrobe[entityId].conditions ??= [];
  return world.wardrobe[entityId];
}

/** A parent link that exists and does not make a loop (a place cannot be inside itself). */
function validParent(world, locationId, parentId) {
  let current = String(parentId ?? '');
  const visited = new Set([locationId]);
  while (current) {
    if (visited.has(current)) return '';
    visited.add(current);
    const parent = world.locations.find(location => location.id === current);
    if (!parent) return '';
    current = parent.parentId ?? '';
  }
  return String(parentId ?? '');
}

function applyLocationFields(world, location, fields) {
  if (fields.name != null) {
    const name = cleanText(fields.name, WORLD_LIMITS.name);
    if (!name) throw new TypeError('location needs a name');
    location.name = name;
  }
  if (fields.parentId !== undefined) {
    const parentId = validParent(world, location.id, fields.parentId);
    if (parentId) location.parentId = parentId; else delete location.parentId;
  }
  if (fields.traits != null) location.traits = cleanList(fields.traits, WORLD_LIMITS.traits, WORLD_LIMITS.text);
  if (fields.notes != null) location.notes = cleanList(fields.notes, WORLD_LIMITS.notes, WORLD_LIMITS.text);
  if (fields.libraryId !== undefined) {
    const libraryId = cleanText(fields.libraryId, WORLD_LIMITS.name);
    if (libraryId) location.libraryId = libraryId; else delete location.libraryId;
  }
  if (fields.locked != null) {
    if (fields.locked) location.locked = true; else delete location.locked;
  }
}

function applyItemFields(next, item, fields) {
  if (fields.name != null) {
    const name = cleanText(fields.name, WORLD_LIMITS.name);
    if (!name) throw new TypeError('item needs a name');
    item.name = name;
  }
  if (fields.ownerId !== undefined) {
    const ownerId = String(fields.ownerId ?? '');
    if (ownerId && next.entities[ownerId]) item.ownerId = ownerId; else delete item.ownerId;
  }
  for (const field of ['place', 'note']) {
    if (fields[field] === undefined) continue;
    const text = cleanText(fields[field], WORLD_LIMITS.text);
    if (text) item[field] = text; else delete item[field];
  }
  // A thing from the library: its description is read from there (item-links.js).
  if (fields.libraryId !== undefined) {
    const libraryId = String(fields.libraryId ?? '').slice(0, 120);
    if (libraryId) item.libraryId = libraryId; else delete item.libraryId;
  }
  if (fields.importance != null) item.importance = ITEM_IMPORTANCE.includes(fields.importance) ? fields.importance : 'normal';
  if (fields.secret != null) {
    if (fields.secret) item.secret = true; else delete item.secret;
  }
  if (fields.knownByIds != null) {
    const ids = [...new Set((Array.isArray(fields.knownByIds) ? fields.knownByIds : []).map(String))].filter(id => next.entities[id]).sort();
    if (ids.length) item.knownByIds = ids; else delete item.knownByIds;
  }
  if (fields.locked != null) {
    if (fields.locked) item.locked = true; else delete item.locked;
  }
  if (fields.off != null) {
    if (fields.off) item.off = true; else delete item.off;
  }
  if (fields.shade != null) {
    if (fields.shade) item.shade = true; else delete item.shade;
  }
  if (fields.activeSince !== undefined) {
    const index = Math.round(Number(fields.activeSince));
    if (fields.activeSince != null && Number.isFinite(index) && index >= 0) item.activeSince = index; else delete item.activeSince;
  }
}

/**
 * Apply a world operation to a mutable state copy.
 * Returns false for operation types it does not own.
 */
export function applyWorldMutation(next, operation) {
  if (!WORLD_OPERATION_TYPES.includes(operation.type)) return false;
  const payload = operation.payload;
  const world = worldOf(next);
  if (applyQuestMutation(next, world, operation)) return true;
  switch (operation.type) {
    case 'clock.set': {
      const clock = world.clock;
      if (payload.label != null) clock.label = cleanText(payload.label, WORLD_LIMITS.label);
      const addDays = days => {
        const count = Math.max(0, Math.min(WORLD_LIMITS.maxDays, Math.round(Number(days)) || 0));
        if (count) clock.day = dayNumber((clock.day || 1) + count);
      };
      if (payload.day != null) clock.day = dayNumber(payload.day);
      else if (payload.advanceDays != null) addDays(payload.advanceDays);
      let timeChanged = false;
      if (payload.time != null) {
        const minutes = parseTime(payload.time);
        clock.time = minutes == null ? '' : formatTime(minutes);
        timeChanged = true;
      } else if (payload.advanceMinutes != null) {
        // "Two hours later": past midnight is the next day. Without a known time only whole days count.
        const minutes = Math.max(0, Math.min(WORLD_LIMITS.maxDays * MINUTES_PER_DAY, Math.round(Number(payload.advanceMinutes)) || 0));
        const now = parseTime(clock.time);
        if (now == null) addDays(Math.floor(minutes / MINUTES_PER_DAY));
        else if (minutes) {
          addDays(Math.floor((now + minutes) / MINUTES_PER_DAY));
          clock.time = formatTime(now + minutes);
          timeChanged = true;
        }
      }
      if (payload.part != null) clock.part = DAY_PARTS.includes(payload.part) ? payload.part : '';
      else if (timeChanged && clock.time) clock.part = dayPartOf(parseTime(clock.time));
      if (payload.flashback != null) {
        if (payload.flashback) clock.flashback = true; else delete clock.flashback;
      }
      if (payload.mode != null) {
        if (payload.mode !== 'calm' && SCENE_MODES.includes(payload.mode)) clock.mode = payload.mode; else delete clock.mode;
      }
      // Time passes for whoever is on stage: they were seen on this day too.
      markOnStage(next);
      break;
    }
    case 'weather.set': {
      // { clear: true } removes it; otherwise kind (+ temp, text, lock) replaces it, stamped with today's story day.
      if (payload.clear) { delete world.weather; break; }
      const clean = cleanWeather(payload, world.clock.day);
      if (clean) world.weather = clean;
      break;
    }
    case 'heat.set': {
      // { value } sets, { delta } shifts, { clear } removes; why = a few Russian words; lock = the chronicler leaves it alone.
      const heat = nextHeat(world.heat, payload, world.clock.day);
      if (heat) world.heat = heat; else delete world.heat;
      break;
    }
    case 'intimacy.set': {
      // { stage } sets, { delta: ±1 } steps, { lock } holds the ladder, { clear } ends the scene (core/intimacy-stage.js).
      const intimacy = nextStage(world.intimacy, payload);
      if (intimacy) world.intimacy = intimacy; else delete world.intimacy;
      break;
    }
    case 'location.add': {
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('location needs an ID');
      if (world.locations.some(location => location.id === id)) break;
      if (world.locations.length >= WORLD_LIMITS.locations) throw new RangeError('Location limit reached');
      const location = { id, name: '', traits: [], notes: [] };
      applyLocationFields(world, location, { name: item.name ?? '', ...item });
      world.locations.push(location);
      break;
    }
    case 'location.update': {
      const location = world.locations.find(candidate => candidate.id === payload.locationId);
      if (!location) break;
      applyLocationFields(world, location, payload.changes ?? {});
      break;
    }
    case 'location.remove': {
      const id = payload.locationId;
      if (!world.locations.some(location => location.id === id)) break;
      world.locations = world.locations.filter(location => location.id !== id);
      for (const location of world.locations) if (location.parentId === id) delete location.parentId;
      const scene = next.knowledge?.scene;
      if (scene?.locationId === id) delete scene.locationId;
      break;
    }
    case 'wardrobe.set': {
      const entityId = String(payload.entityId ?? '');
      if (!next.entities[entityId]) break;
      const entry = wardrobeOf(world, entityId);
      if (payload.outfit != null) {
        entry.outfit = cleanText(payload.outfit, WORLD_LIMITS.outfit);
        // What they wear now is known: no more "may have changed", and the outfit
        // dates from today (even when it was written while they were off stage).
        delete entry.awayDays;
        if (world.clock.day && !world.clock.flashback) entry.seenDay = world.clock.day;
      }
      // Cards from the wardrobe they wear. An outfit told in words without cards means
      // they changed into something else: the old cards come off.
      if (payload.cardIds !== undefined) {
        const ids = [...new Set((Array.isArray(payload.cardIds) ? payload.cardIds : []).map(String).filter(Boolean))].slice(0, 40);
        if (ids.length) entry.cardIds = ids; else delete entry.cardIds;
      } else if (payload.outfit != null) {
        delete entry.cardIds;
      }
      if (payload.locked != null) {
        if (payload.locked) entry.locked = true; else delete entry.locked;
      }
      break;
    }
    case 'condition.add': {
      const entityId = String(payload.entityId ?? '');
      if (!next.entities[entityId]) break;
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('condition needs an ID');
      const text = cleanText(item.text, WORLD_LIMITS.text);
      if (!text) throw new TypeError('condition needs text');
      const entry = wardrobeOf(world, entityId);
      if (entry.conditions.some(condition => condition.id === id)) break;
      const same = entry.conditions.find(condition => condition.text.toLocaleLowerCase('ru-RU') === text.toLocaleLowerCase('ru-RU'));
      if (same) break;
      const condition = { id, text };
      const sinceDay = dayNumber(item.sinceDay ?? world.clock.day);
      if (sinceDay) condition.sinceDay = sinceDay;
      const days = Math.round(Number(item.days));
      if (Number.isFinite(days) && days > 0) condition.days = Math.min(days, WORLD_LIMITS.maxDays);
      entry.conditions.push(condition);
      // The oldest condition makes room: a scratch from long ago matters least.
      if (entry.conditions.length > WORLD_LIMITS.conditions) entry.conditions.shift();
      break;
    }
    case 'condition.update': {
      // Fixing a slip of the chronicler: new text or a new term; a removed condition makes it a no-op.
      const condition = world.wardrobe[payload.entityId]?.conditions?.find(candidate => candidate.id === payload.conditionId);
      if (!condition) break;
      const changes = payload.changes ?? {};
      if (changes.text != null) {
        const text = cleanText(changes.text, WORLD_LIMITS.text);
        if (!text) throw new TypeError('condition needs text');
        condition.text = text;
      }
      if (changes.days !== undefined) {
        const days = Math.round(Number(changes.days));
        if (Number.isFinite(days) && days > 0) condition.days = Math.min(days, WORLD_LIMITS.maxDays); else delete condition.days;
      }
      if (changes.sinceDay !== undefined) {
        const sinceDay = dayNumber(changes.sinceDay);
        if (sinceDay) condition.sinceDay = sinceDay; else delete condition.sinceDay;
      }
      break;
    }
    case 'condition.remove': {
      const entry = world.wardrobe[payload.entityId];
      if (!entry) break;
      entry.conditions = (entry.conditions ?? []).filter(condition => condition.id !== payload.conditionId);
      break;
    }
    case 'feature.add': {
      const entityId = String(payload.entityId ?? '');
      if (!next.entities[entityId]) break;
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('feature needs an ID');
      const text = String(item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, WORLD_LIMITS.featureText);
      if (!text) throw new TypeError('feature needs text');
      const entry = wardrobeOf(world, entityId);
      entry.features ??= [];
      if (entry.features.some(feature => feature.id === id)) break;
      // Full: the oldest unlocked one makes room (a character rarely has thirty scars).
      if (entry.features.length >= WORLD_LIMITS.features) {
        const oldest = entry.features.findIndex(feature => !feature.locked);
        if (oldest < 0) break;
        entry.features.splice(oldest, 1);
      }
      const day = dayNumber(item.sinceDay ?? world.clock.day);
      entry.features.push({
        id, text, kind: FEATURE_KINDS.includes(item.kind) ? item.kind : 'other',
        ...(day ? { sinceDay: day } : {}), ...(item.locked ? { locked: true } : {}),
      });
      break;
    }
    case 'feature.update': {
      const feature = world.wardrobe[payload.entityId]?.features?.find(candidate => candidate.id === payload.featureId);
      if (!feature) break;
      const changes = payload.changes ?? {};
      if (changes.text != null) {
        const text = String(changes.text).replace(/\s+/g, ' ').trim().slice(0, WORLD_LIMITS.featureText);
        if (text) feature.text = text;
      }
      if (changes.kind != null && FEATURE_KINDS.includes(changes.kind)) feature.kind = changes.kind;
      if (changes.locked != null) { if (changes.locked) feature.locked = true; else delete feature.locked; }
      break;
    }
    case 'feature.remove': {
      const entry = world.wardrobe[payload.entityId];
      if (entry?.features) entry.features = entry.features.filter(feature => feature.id !== payload.featureId);
      break;
    }
    case 'item.add': {
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('item needs an ID');
      if (world.items.some(candidate => candidate.id === id)) break;
      if (world.items.length >= WORLD_LIMITS.items) throw new RangeError('Item limit reached');
      const created = { id, name: '', importance: 'normal' };
      applyItemFields(next, created, { name: item.name ?? '', ...item });
      world.items.push(created);
      break;
    }
    case 'item.update': {
      const item = world.items.find(candidate => candidate.id === payload.itemId);
      if (!item) break;
      applyItemFields(next, item, payload.changes ?? {});
      break;
    }
    case 'item.remove': {
      world.items = world.items.filter(item => item.id !== payload.itemId);
      break;
    }
    default:
      return false;
  }
  return true;
}

/**
 * Note who is on stage on the current story day. Called after every scene change
 * and clock change. Whenever story days passed since a present character was last
 * seen — they just came back, or the story jumped ahead with them on stage — those
 * days are kept as `awayDays` until their outfit is confirmed (wardrobe.set): the
 * prompt uses it to allow a change of clothes. On the same day nothing changes.
 */
export function markOnStage(next) {
  const world = worldOf(next);
  if (world.clock.flashback) return;
  const day = world.clock.day;
  if (!day) return;
  for (const id of next.knowledge?.scene?.presentIds ?? []) {
    if (!next.entities[id]) continue;
    const entry = wardrobeOf(world, id);
    if (entry.seenDay && day > entry.seenDay) entry.awayDays = Math.max(entry.awayDays ?? 0, day - entry.seenDay);
    entry.seenDay = day;
  }
}

/** Drop a removed character from the world: their wardrobe goes, their things lose an owner. */
export function forgetWorldEntity(next, entityId) {
  if (!next.world) return;
  const world = worldOf(next);
  delete world.wardrobe[entityId];
  forgetQuestEntity(world, entityId);
  for (const item of world.items) {
    if (item.ownerId === entityId) delete item.ownerId;
    if (item.knownByIds) {
      item.knownByIds = item.knownByIds.filter(id => id !== entityId);
      if (!item.knownByIds.length) delete item.knownByIds;
    }
  }
}

/** Shape errors of state.world (empty array when valid). */
export function validateWorld(world, entityIds, scene) {
  const errors = [];
  if (world == null) return errors;
  if (typeof world !== 'object' || Array.isArray(world)) return ['world must be an object'];
  const clock = world.clock;
  if (!clock || typeof clock !== 'object' || typeof clock.label !== 'string' || !Number.isInteger(clock.day) || clock.day < 0
    || (clock.part !== '' && !DAY_PARTS.includes(clock.part))
    || (clock.time != null && clock.time !== '' && parseTime(clock.time) == null)
    || (clock.mode != null && !SCENE_MODES.includes(clock.mode))) errors.push('world.clock is malformed');
  const locationIds = new Set();
  if (!Array.isArray(world.locations)) errors.push('world.locations must be an array');
  else {
    for (const location of world.locations) {
      if (!location || typeof location.id !== 'string' || !location.id) { errors.push('location needs an ID'); continue; }
      if (locationIds.has(location.id)) errors.push(`duplicate location ${location.id}`);
      locationIds.add(location.id);
      if (typeof location.name !== 'string' || !location.name.trim()) errors.push(`location ${location.id} needs a name`);
      if (!Array.isArray(location.traits) || !Array.isArray(location.notes)) errors.push(`location ${location.id} lists must be arrays`);
    }
    for (const location of world.locations) {
      if (location?.parentId != null && !locationIds.has(location.parentId)) errors.push(`location ${location.id} has an unknown parent`);
    }
  }
  if (scene?.locationId != null && !locationIds.has(scene.locationId)) errors.push('knowledge.scene.locationId points at an unknown location');
  if (!world.wardrobe || typeof world.wardrobe !== 'object' || Array.isArray(world.wardrobe)) errors.push('world.wardrobe must be an object');
  else {
    for (const [id, entry] of Object.entries(world.wardrobe)) {
      if (!entityIds.has(id)) errors.push(`wardrobe of unknown character ${id}`);
      if (!entry || typeof entry.outfit !== 'string' || !Array.isArray(entry.conditions)) errors.push(`wardrobe ${id} is malformed`);
      else if (entry.conditions.some(condition => !condition?.id || typeof condition.text !== 'string' || !condition.text)) errors.push(`wardrobe ${id} has a malformed condition`);
      else if (entry.features != null && (!Array.isArray(entry.features) || entry.features.some(feature => !feature?.id || typeof feature.text !== 'string' || !feature.text))) errors.push(`wardrobe ${id} has a malformed feature`);
    }
  }
  errors.push(...validateQuests(world));
  if (!Array.isArray(world.items)) errors.push('world.items must be an array');
  else {
    const ids = new Set();
    for (const item of world.items) {
      if (!item || typeof item.id !== 'string' || !item.id) { errors.push('item needs an ID'); continue; }
      if (ids.has(item.id)) errors.push(`duplicate item ${item.id}`);
      ids.add(item.id);
      if (typeof item.name !== 'string' || !item.name.trim()) errors.push(`item ${item.id} needs a name`);
      if (!ITEM_IMPORTANCE.includes(item.importance)) errors.push(`item ${item.id} has an unknown importance`);
      if (item.ownerId != null && !entityIds.has(item.ownerId)) errors.push(`item ${item.id} has an unknown owner`);
      if (item.knownByIds != null && (!Array.isArray(item.knownByIds) || item.knownByIds.some(id => !entityIds.has(id)))) errors.push(`item ${item.id} has unknown knownByIds`);
    }
  }
  return errors;
}

// ---- Queries -------------------------------------------------------------

/** The place the scene is in: the library-linked location if set, else null. */
export function currentLocation(state) {
  const id = state.knowledge?.scene?.locationId;
  return id ? (state.world?.locations ?? []).find(location => location.id === id) ?? null : null;
}

/** Names from the outermost place to this one: ['Токио', 'Сибуя', 'бар «Хаос»']. */
export function locationPath(state, locationId) {
  const locations = state.world?.locations ?? [];
  const path = [];
  const visited = new Set();
  let current = locations.find(location => location.id === locationId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? locations.find(location => location.id === current.parentId) : null;
  }
  return path;
}

/** Conditions still in force on the current story day (unknown day keeps everything). */
export function activeConditions(state, entityId) {
  const day = state.world?.clock?.day ?? 0;
  return (state.world?.wardrobe?.[entityId]?.conditions ?? [])
    .filter(condition => !condition.days || !condition.sinceDay || !day || day < condition.sinceDay + condition.days);
}

/**
 * What a character wears now: { outfit, conditions, awayDays } or null when nothing is known.
 * awayDays > 0: they were off stage that many story days — a change of clothes is plausible.
 */
export function outfitOf(state, entityId) {
  const entry = state.world?.wardrobe?.[entityId];
  if (!entry) return null;
  const conditions = activeConditions(state, entityId);
  if (!entry.outfit && !conditions.length) return null;
  return { outfit: entry.outfit, conditions, awayDays: entry.awayDays ?? 0 };
}

/** Things a character holds (active items with this owner). */
export function itemsOf(state, entityId) {
  return (state.world?.items ?? []).filter(item => item.ownerId === entityId);
}

/** Whether a character knows about an item: owners and the listed always do; a non-secret item is common knowledge. */
export function knowsItem(item, entityId) {
  if (!item.secret) return true;
  return item.ownerId === entityId || (item.knownByIds ?? []).includes(entityId);
}

/** Two records of one character become one: `fromId`'s clothes, looks and things go to `intoId`. */
export function mergeWorldEntity(next, fromId, intoId) {
  if (!next.world) return;
  const world = worldOf(next);
  mergeQuestEntity(world, fromId, intoId);
  const from = world.wardrobe[fromId];
  if (from) {
    const into = world.wardrobe[intoId];
    if (!into) {
      world.wardrobe[intoId] = from;
    } else {
      const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase();
      if (!into.outfit && from.outfit) { into.outfit = from.outfit; if (from.cardIds) into.cardIds = from.cardIds; }
      into.conditions = [...(into.conditions ?? []), ...(from.conditions ?? []).filter(item => !(into.conditions ?? []).some(have => same(have.text, item.text)))].slice(-WORLD_LIMITS.conditions);
      const features = [...(into.features ?? []), ...(from.features ?? []).filter(item => !(into.features ?? []).some(have => same(have.text, item.text)))];
      if (features.length) into.features = features.slice(-WORLD_LIMITS.features);
      if (!into.seenDay && from.seenDay) into.seenDay = from.seenDay;
    }
    delete world.wardrobe[fromId];
  }
  for (const item of world.items) {
    if (item.ownerId === fromId) item.ownerId = intoId;
    if (item.knownByIds) item.knownByIds = [...new Set(item.knownByIds.map(id => (id === fromId ? intoId : id)))].sort();
  }
}

/** Lasting looks of a character (scars, tattoos, dyed hair…), oldest first. */
export function featuresOf(state, entityId) {
  return state.world?.wardrobe?.[entityId]?.features ?? [];
}
