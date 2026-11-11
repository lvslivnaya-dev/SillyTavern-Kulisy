/**
 * Who knows what, who is on stage, who has met whom.
 *
 * state.knowledge = {
 *   events:        [{ id, text, witnessIds[], location?, secret?, disabled?, createdAt?, lore?, own?, detail? }]
 *                  (lore: { book, uid } of a lorebook secret, detail: its text — see lore-secrets.js;
 *                   own: a secret the user made by hand, with its own detail; witnessIds = who knows it)
 *   learned:       [{ id, eventId, entityId, source: 'told'|'rumor', fromId?, disabled? }]
 *   acquaintances: { 'a|b': 'known' | 'seen' | 'strangers' }   (sorted pair key; absent = default)
 *   scene:         { presentIds[], location, locationId?, lore? }   (locationId: a card in state.world.locations;
 *                  lore: titles of lorebook entries the chronicler picked for the next reply — [] = none needed,
 *                  absent = it has not been asked, so nothing is held back)
 *   deaths:        { entityId: { note } }   (dead: off stage, their own lines frozen; note = how and when)
 * }
 *
 * Everything changes through journaled operations, so a swipe or a deleted
 * message rolls knowledge back exactly like relationship changes. Witnesses know
 * an event because they saw it; `learned` records everyone who heard about it later.
 *
 * Replay must never fail on history: an operation pointing at an event or a
 * character that a rollback removed is a no-op, and unknown character IDs are
 * dropped from lists. Callers (the analyzer, the UI) validate before writing.
 */

import { cleanSecretText } from './lore-secrets.js';

export const KNOWLEDGE_OPERATION_TYPES = Object.freeze([
  'event.add', 'event.update', 'event.remove',
  'learned.add', 'learned.remove', 'knowledge.toggle',
  'acquaintance.set', 'scene.set', 'death.set',
]);

/** How a character knows an event. `seen` is implied by being a witness. */
export const KNOWLEDGE_SOURCES = Object.freeze(['seen', 'told', 'rumor']);
const LEARNED_SOURCES = new Set(['told', 'rumor']);

/** known: introduced; seen: met, name unknown; strangers: never met. */
export const ACQUAINTANCE_STATUSES = Object.freeze(['known', 'seen', 'strangers']);

export const KNOWLEDGE_LIMITS = Object.freeze({ events: 3000, learned: 10000, text: 500, location: 120, present: 50, book: 200, deathNote: 300 });

export function emptyKnowledge() {
  return { events: [], learned: [], acquaintances: {}, scene: { presentIds: [], location: '' } };
}

/** Mutual pair key, the same shape as strangers and headcanons use: sorted "a|b". */
export function pairKey(firstId, secondId) {
  return [String(firstId), String(secondId)].sort().join('|');
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** { book, uid } of a lorebook secret, or null. */
function loreRef(value) {
  if (!value || typeof value !== 'object') return null;
  const book = String(value.book ?? '').trim().slice(0, KNOWLEDGE_LIMITS.book);
  const uid = String(value.uid ?? '').trim();
  return book && uid ? { book, uid } : null;
}

/** Titles of lorebook entries: trimmed, unique, at most a dozen; anything but a list is «not asked» (undefined). */
export function loreTitles(value) {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.map(title => cleanText(title, 120)).filter(Boolean))].slice(0, 12);
}

function knownIds(next, ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(String))].filter(id => next.entities[id]).sort();
}

function knowledgeOf(next) {
  next.knowledge ??= emptyKnowledge();
  const knowledge = next.knowledge;
  knowledge.events ??= [];
  knowledge.learned ??= [];
  knowledge.acquaintances ??= {};
  knowledge.scene ??= { presentIds: [], location: '' };
  knowledge.deaths ??= {};
  return knowledge;
}

/**
 * Apply a knowledge operation to a mutable state copy.
 * Returns false for operation types it does not own.
 */
export function applyKnowledgeMutation(next, operation) {
  if (!KNOWLEDGE_OPERATION_TYPES.includes(operation.type)) return false;
  const payload = operation.payload;
  const knowledge = knowledgeOf(next);
  switch (operation.type) {
    case 'event.add': {
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('event needs an ID');
      const text = cleanText(item.text, KNOWLEDGE_LIMITS.text);
      if (!text) throw new TypeError('event needs text');
      if (knowledge.events.some(event => event.id === id)) break;
      const lore = loreRef(item.lore);
      // One event per lorebook entry: a second import of it is a no-op.
      if (lore && knowledge.events.some(event => event.lore?.book === lore.book && event.lore?.uid === lore.uid)) break;
      if (knowledge.events.length >= KNOWLEDGE_LIMITS.events) throw new RangeError('Event limit reached');
      const event = { id, text, witnessIds: knownIds(next, item.witnessIds) };
      const location = cleanText(item.location, KNOWLEDGE_LIMITS.location);
      if (location) event.location = location;
      if (item.secret) event.secret = true;
      if (item.createdAt) event.createdAt = String(item.createdAt);
      if (lore) event.lore = lore;
      if (item.own && !lore) { event.own = true; event.secret = true; }
      if (event.lore || event.own) {
        const detail = cleanSecretText(item.detail);
        if (detail) event.detail = detail;
      }
      knowledge.events.push(event);
      break;
    }
    case 'event.update': {
      // An event removed by a rolled-back message makes its later edit a no-op.
      const event = knowledge.events.find(candidate => candidate.id === payload.eventId);
      if (!event) break;
      const changes = payload.changes ?? {};
      if (changes.text != null) {
        const text = cleanText(changes.text, KNOWLEDGE_LIMITS.text);
        if (!text) throw new TypeError('event needs text');
        event.text = text;
      }
      if (changes.witnessIds != null) {
        event.witnessIds = knownIds(next, changes.witnessIds);
        // Someone who saw it no longer needs to have been told.
        const witnesses = new Set(event.witnessIds);
        knowledge.learned = knowledge.learned.filter(item => item.eventId !== event.id || !witnesses.has(item.entityId));
      }
      if (changes.location != null) {
        const location = cleanText(changes.location, KNOWLEDGE_LIMITS.location);
        if (location) event.location = location; else delete event.location;
      }
      if (changes.secret != null) {
        if (changes.secret) event.secret = true; else delete event.secret;
      }
      // A secret made by hand: an ordinary event becomes one (with a text for those who know) or stops being one.
      if (changes.own != null && !event.lore) {
        if (changes.own) { event.own = true; event.secret = true; } else { delete event.own; delete event.detail; }
      }
      if (changes.detail != null && (event.lore || event.own)) {
        const detail = cleanSecretText(changes.detail);
        if (detail) event.detail = detail; else delete event.detail;
      }
      break;
    }
    case 'event.remove': {
      knowledge.events = knowledge.events.filter(event => event.id !== payload.eventId);
      knowledge.learned = knowledge.learned.filter(item => item.eventId !== payload.eventId);
      break;
    }
    case 'learned.add': {
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('learned entry needs an ID');
      if (knowledge.learned.some(entry => entry.id === id)) break;
      const event = knowledge.events.find(candidate => candidate.id === item.eventId);
      const entityId = String(item.entityId ?? '');
      if (!event || !next.entities[entityId]) break;
      // A witness already knows; the first way someone learned an event is kept.
      if (event.witnessIds.includes(entityId)) break;
      if (knowledge.learned.some(entry => entry.eventId === event.id && entry.entityId === entityId)) break;
      if (knowledge.learned.length >= KNOWLEDGE_LIMITS.learned) throw new RangeError('Knowledge limit reached');
      const entry = { id, eventId: event.id, entityId, source: LEARNED_SOURCES.has(item.source) ? item.source : 'told' };
      const fromId = String(item.fromId ?? '');
      if (fromId && fromId !== entityId && next.entities[fromId]) entry.fromId = fromId;
      knowledge.learned.push(entry);
      break;
    }
    case 'learned.remove': {
      knowledge.learned = knowledge.learned.filter(entry => entry.id !== payload.learnedId);
      break;
    }
    case 'knowledge.toggle': {
      const list = payload.kind === 'learned' ? knowledge.learned : knowledge.events;
      const item = list.find(candidate => candidate.id === payload.itemId);
      if (!item) break;
      if (payload.disabled) item.disabled = true; else delete item.disabled;
      break;
    }
    case 'acquaintance.set': {
      const firstId = String(payload.firstId ?? '');
      const secondId = String(payload.secondId ?? '');
      if (!firstId || !secondId || firstId === secondId) throw new TypeError('acquaintance needs two different characters');
      if (!next.entities[firstId] || !next.entities[secondId]) break;
      const key = pairKey(firstId, secondId);
      if (payload.status == null) delete knowledge.acquaintances[key];
      else if (ACQUAINTANCE_STATUSES.includes(payload.status)) knowledge.acquaintances[key] = payload.status;
      else throw new RangeError(`Unknown acquaintance status: ${payload.status}`);
      break;
    }
    case 'death.set': {
      // dead: false brings them back (a resurrection, a mistake, an AU).
      const entityId = String(payload.entityId ?? '');
      if (!next.entities[entityId]) break;
      if (payload.dead === false) { delete knowledge.deaths[entityId]; break; }
      const note = cleanText(payload.note, KNOWLEDGE_LIMITS.deathNote);
      knowledge.deaths[entityId] = note ? { note } : {};
      knowledge.scene.presentIds = knowledge.scene.presentIds.filter(id => id !== entityId);
      break;
    }
    case 'scene.set': {
      // The dead do not walk back on stage, whoever lists them.
      const presentIds = knownIds(next, payload.presentIds).filter(id => !knowledge.deaths[id]).slice(0, KNOWLEDGE_LIMITS.present);
      const previous = knowledge.scene ?? {};
      // Toggling who is present (the chips) keeps the place as it was.
      let location = Object.hasOwn(payload, 'location') ? cleanText(payload.location, KNOWLEDGE_LIMITS.location) : previous.location ?? '';
      let locationId = previous.locationId ?? '';
      const places = next.world?.locations ?? [];
      if (Object.hasOwn(payload, 'locationId')) {
        const place = places.find(candidate => candidate.id === payload.locationId);
        locationId = place ? place.id : '';
        if (place && !Object.hasOwn(payload, 'location')) location = place.name;
      } else if (Object.hasOwn(payload, 'location') && locationId) {
        // A new place named without its card: the old card no longer applies, unless it is the same name.
        const place = places.find(candidate => candidate.id === locationId);
        if (!place || place.name.toLocaleLowerCase('ru-RU') !== location.toLocaleLowerCase('ru-RU')) locationId = '';
      }
      const lore = Object.hasOwn(payload, 'lore') ? loreTitles(payload.lore) : previous.lore;
      knowledge.scene = { presentIds, location, ...(locationId ? { locationId } : {}), ...(Array.isArray(lore) ? { lore } : {}) };
      break;
    }
    default:
      return false;
  }
  return true;
}

/** Drop a removed character from every knowledge list. Events stay: others may still know them. */
export function forgetEntity(next, entityId) {
  if (!next.knowledge) return;
  const knowledge = knowledgeOf(next);
  for (const event of knowledge.events) event.witnessIds = event.witnessIds.filter(id => id !== entityId);
  knowledge.learned = knowledge.learned
    .filter(entry => entry.entityId !== entityId)
    .map(entry => (entry.fromId === entityId ? (({ fromId, ...rest }) => rest)(entry) : entry));
  for (const key of Object.keys(knowledge.acquaintances)) {
    if (key.split('|').includes(entityId)) delete knowledge.acquaintances[key];
  }
  knowledge.scene.presentIds = knowledge.scene.presentIds.filter(id => id !== entityId);
  delete knowledge.deaths[entityId];
}

/** Two records of one character become one: `fromId`'s knowledge goes to `intoId`. */
export function mergeKnowledgeEntity(next, fromId, intoId) {
  if (!next.knowledge) return;
  const knowledge = knowledgeOf(next);
  const swap = id => (id === fromId ? intoId : id);
  for (const event of knowledge.events) event.witnessIds = [...new Set(event.witnessIds.map(swap))];
  const seen = new Set();
  knowledge.learned = knowledge.learned
    .map(entry => {
      const moved = { ...entry, entityId: swap(entry.entityId) };
      if (moved.fromId) moved.fromId = swap(moved.fromId);
      if (moved.fromId === moved.entityId) delete moved.fromId;
      return moved;
    })
    .filter(entry => { const key = `${entry.entityId}|${entry.eventId}`; if (seen.has(key)) return false; seen.add(key); return true; });
  for (const [key, value] of Object.entries(knowledge.acquaintances)) {
    if (!key.split('|').includes(fromId)) continue;
    delete knowledge.acquaintances[key];
    const [first, second] = key.split('|').map(swap);
    if (first === second) continue;
    const merged = pairKey(first, second);
    // The record of the one we keep wins.
    if (!knowledge.acquaintances[merged]) knowledge.acquaintances[merged] = value;
  }
  knowledge.scene.presentIds = [...new Set(knowledge.scene.presentIds.map(swap))];
  if (knowledge.deaths[fromId]) {
    // The record we keep wins.
    knowledge.deaths[intoId] ??= knowledge.deaths[fromId];
    delete knowledge.deaths[fromId];
  }
}

/** Shape errors of state.knowledge (empty array when valid). */
export function validateKnowledge(knowledge, entityIds) {
  const errors = [];
  if (knowledge == null) return errors;
  if (typeof knowledge !== 'object' || Array.isArray(knowledge)) return ['knowledge must be an object'];
  const known = id => entityIds.has(id);
  if (!Array.isArray(knowledge.events)) errors.push('knowledge.events must be an array');
  else {
    const ids = new Set();
    for (const event of knowledge.events) {
      if (!event || typeof event.id !== 'string' || !event.id) { errors.push('knowledge event needs an ID'); continue; }
      if (ids.has(event.id)) errors.push(`duplicate knowledge event ${event.id}`);
      ids.add(event.id);
      if (typeof event.text !== 'string' || !event.text.trim()) errors.push(`knowledge event ${event.id} needs text`);
      if (!Array.isArray(event.witnessIds) || event.witnessIds.some(id => !known(id))) errors.push(`knowledge event ${event.id} has unknown witnesses`);
      if (event.lore != null && !loreRef(event.lore)) errors.push(`knowledge event ${event.id} has a broken lorebook link`);
    }
    if (!Array.isArray(knowledge.learned)) errors.push('knowledge.learned must be an array');
    else for (const entry of knowledge.learned) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) { errors.push('learned entry needs an ID'); continue; }
      if (!ids.has(entry.eventId)) errors.push(`learned entry ${entry.id} points at an unknown event`);
      if (!known(entry.entityId)) errors.push(`learned entry ${entry.id} has an unknown character`);
      if (!LEARNED_SOURCES.has(entry.source)) errors.push(`learned entry ${entry.id} has an unknown source`);
      if (entry.fromId != null && !known(entry.fromId)) errors.push(`learned entry ${entry.id} has an unknown teller`);
    }
  }
  if (!knowledge.acquaintances || typeof knowledge.acquaintances !== 'object' || Array.isArray(knowledge.acquaintances)) {
    errors.push('knowledge.acquaintances must be an object');
  } else {
    for (const [key, status] of Object.entries(knowledge.acquaintances)) {
      const [first, second] = key.split('|');
      if (!known(first) || !known(second) || first === second) errors.push(`acquaintance ${key} has unknown characters`);
      if (!ACQUAINTANCE_STATUSES.includes(status)) errors.push(`acquaintance ${key} has an unknown status`);
    }
  }
  if (knowledge.deaths != null) {
    if (typeof knowledge.deaths !== 'object' || Array.isArray(knowledge.deaths)) errors.push('knowledge.deaths must be an object');
    else for (const id of Object.keys(knowledge.deaths)) if (!known(id)) errors.push(`death of an unknown character ${id}`);
  }
  const scene = knowledge.scene;
  if (!scene || typeof scene !== 'object' || !Array.isArray(scene.presentIds) || scene.presentIds.some(id => !known(id))) {
    errors.push('knowledge.scene must list known characters');
  } else if (typeof scene.location !== 'string') errors.push('knowledge.scene.location must be a string');
  return errors;
}

// ---- Queries -------------------------------------------------------------

function activeEvents(state) {
  return (state.knowledge?.events ?? []).filter(event => !event.disabled);
}

/** How a character knows an event, or null: { source: 'seen'|'told'|'rumor', fromId? }. */
export function howKnows(state, entityId, event) {
  if (event.witnessIds.includes(entityId)) return { source: 'seen' };
  const entry = (state.knowledge?.learned ?? []).find(item => item.eventId === event.id && item.entityId === entityId && !item.disabled);
  return entry ? { source: entry.source, ...(entry.fromId ? { fromId: entry.fromId } : {}), learnedId: entry.id } : null;
}

/**
 * A character's dossier: what they know (and how) and what they do not.
 * A disabled event is left out entirely; a disabled "learned" entry counts as
 * not learned — switching it off means "they don't actually know this".
 */
export function dossier(state, entityId) {
  const knows = [];
  const doesNotKnow = [];
  for (const event of activeEvents(state)) {
    const how = howKnows(state, entityId, event);
    if (how) knows.push({ event, ...how });
    else doesNotKnow.push(event);
  }
  return { knows, doesNotKnow };
}

/** Everyone who knows an event: Map(entityId → { source, fromId? }). */
export function whoKnows(state, eventId) {
  const event = (state.knowledge?.events ?? []).find(candidate => candidate.id === eventId);
  const result = new Map();
  if (!event) return result;
  for (const id of event.witnessIds) result.set(id, { source: 'seen' });
  for (const entry of state.knowledge.learned ?? []) {
    if (entry.eventId === eventId && !entry.disabled && !result.has(entry.entityId)) {
      result.set(entry.entityId, { source: entry.source, ...(entry.fromId ? { fromId: entry.fromId } : {}) });
    }
  }
  return result;
}

/**
 * Whether two characters have met.
 * Explicit value first; then the engine's old manual "strangers" flag; then the
 * persona rule: nobody knows the user's persona until it is said otherwise.
 * null = nothing known, the story/canon decides (no rule is sent).
 */
export function acquaintanceOf(state, firstId, secondId) {
  if (!firstId || !secondId || firstId === secondId) return null;
  const key = pairKey(firstId, secondId);
  const explicit = state.knowledge?.acquaintances?.[key];
  if (explicit) return explicit;
  if ((state.ui?.strangerPairs ?? []).includes(key)) return 'strangers';
  const personaId = state.ui?.personaId;
  if (personaId && (firstId === personaId || secondId === personaId)) return 'strangers';
  return null;
}

/** { note } when the character is dead, else null. */
export function deathOf(state, entityId) {
  return state?.knowledge?.deaths?.[entityId] ?? null;
}

export function isDead(state, entityId) {
  return Boolean(deathOf(state, entityId));
}

/** Characters currently on stage (IDs that still exist, and alive). */
export function presentIds(state) {
  return (state.knowledge?.scene?.presentIds ?? []).filter(id => state.entities?.[id] && !isDead(state, id));
}
