import { namesMaybeAlike, namesSoundAlike, phoneticWords } from './phonetic.js';

const counters = new Map();

const ALIAS_CACHE = new Map();

/** Normalize a user-facing name for alias matching (remembered: name matching asks about the same names thousands of times). */
export function normalizeAlias(value) {
  if (typeof value !== 'string') throw new TypeError('Alias must be a string');
  const known = ALIAS_CACHE.get(value);
  if (known !== undefined) return known;
  const result = value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  if (ALIAS_CACHE.size > 20000) ALIAS_CACHE.clear();
  ALIAS_CACHE.set(value, result);
  return result;
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

/** Build a deterministic, URL-safe identifier from a stable source value. */
export function stableId(value, prefix = 'id') {
  const normalized = normalizeAlias(String(value));
  if (!normalized) throw new TypeError('ID source cannot be empty');
  const slug = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'item';
  return `${prefix}:${slug}:${hash(normalized)}`;
}

/** Build the stable identifier for a directed edge. Direction is significant. */
export function relationshipId(from, to) {
  if (!from || !to) throw new TypeError('Both relationship endpoints are required');
  return stableId(`${from}\u0000${to}`, 'rel');
}

/** Create a process-unique operation, transaction, or snapshot identifier. */
export function uniqueId(prefix = 'op') {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  const next = (counters.get(prefix) || 0) + 1;
  counters.set(prefix, next);
  return `${prefix}:${Date.now().toString(36)}:${next.toString(36)}`;
}

/** The words of a name: «Хайтани Ран», «Ран-сан» → хайтани, ран, ран-сан. */
function nameWords(value) {
  return normalizeAlias(String(value ?? '')).replace(/ё/g, 'е').split(/[\s,.()«»"']+/).filter(word => word.length > 1);
}

/**
 * A full name of two or more words whose every word is among another entity's names
 * and other names: «Манджиро Сано» is Manjiro Sano with other names «Манджиро», «Сано».
 * Returns the one entity that fits, or null (none, or more than one — then it is a guess).
 */
export function findByNameParts(state, reference, { exceptId = '' } = {}) {
  const words = nameWords(reference);
  if (words.length < 2) return null;
  const fits = Object.values(state?.entities || {}).filter(entity => {
    if (entity.id === exceptId) return false;
    const known = new Set([entity.name, ...(entity.aliases || [])].flatMap(nameWords));
    return words.every(word => known.has(word));
  });
  return fits.length === 1 ? fits[0].id : null;
}

/**
 * Who a name means, in steps from certain to doubtful:
 *   1. the same name or other name;
 *   2. a full name made of their other names («Манджиро Сано»);
 *   3. the same sound in any script and word order («Ран Хайтани» = Ran Haitani);
 *   4. the same sound by words of their names («Сандзу Харучиё» from «Haruchiyo», «Sanzu»).
 * Each of 1–4 counts only when exactly one character fits: { id, sure: true }.
 * Otherwise 5: names one letter off («Какуче» / Kakucho) — { ids, sure: false }, to ask.
 * `skip(id)` leaves out characters already known to be someone else.
 */
export function matchEntity(state, reference, { exceptId = '', skip = () => false } = {}) {
  const entities = Object.values(state?.entities || {}).filter(entity => entity.id !== exceptId && !skip(entity.id));
  const one = list => (list.length === 1 ? { id: list[0].id, sure: true } : null);
  let wanted;
  try { wanted = normalizeAlias(String(reference ?? '')); } catch { return null; }
  if (!wanted) return null;
  const namesOf = entity => [entity.name, ...(entity.aliases || [])];
  const exact = entities.filter(entity => namesOf(entity).some(name => normalizeAlias(name) === wanted));
  if (exact.length) return one(exact);
  const words = nameWords(reference);
  if (words.length >= 2) {
    const parts = entities.filter(entity => { const known = new Set(namesOf(entity).flatMap(nameWords)); return words.every(word => known.has(word)); });
    if (parts.length) return one(parts);
  }
  const sounds = phoneticWords(reference);
  // One short word by sound alone is too little (Ран / Рин would be a coin toss).
  if (!sounds.length || (sounds.length === 1 && sounds[0].length < 3)) return null;
  const alike = entities.filter(entity => namesOf(entity).some(name => namesSoundAlike(name, reference)));
  if (alike.length) return one(alike);
  if (sounds.length >= 2) {
    const byWords = entities.filter(entity => { const known = new Set(namesOf(entity).flatMap(phoneticWords)); return sounds.every(word => known.has(word)); });
    if (byWords.length) return one(byWords);
  }
  const maybe = entities.filter(entity => namesOf(entity).some(name => namesMaybeAlike(name, reference)));
  return maybe.length ? { ids: maybe.map(entity => entity.id), sure: false } : null;
}

/** Resolve a name, alias, or exact ID to an entity ID (certain matches only). */
export function resolveEntityId(state, reference) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  if (state.entities?.[reference]) return reference;
  const match = matchEntity(state, reference);
  return match?.sure ? match.id : null;
}

/** The key of a pair the user said are two different people. */
export function distinctKey(firstId, secondId) {
  return [String(firstId), String(secondId)].sort().join('|');
}

/**
 * Pairs that look like one character recorded twice: [{ fromId, intoId, sure }]. Sure ones
 * (steps 1–4 of matchEntity) and «maybe» ones (one letter off, to ask). A pair the user
 * marked as two people (state.ui.distinctPairs) is never offered again. The one whose
 * names hold the other's is kept; for a sound match, the one with more lines and names.
 */
export function duplicateCandidates(state) {
  const distinct = new Set(state?.ui?.distinctPairs ?? []);
  const weight = entity => Object.values(state.relationships || {}).filter(relation => relation.from === entity.id || relation.to === entity.id).length * 10 + (entity.aliases?.length ?? 0);
  // On a tie the older record is the original: the one the journal met first.
  const born = new Map();
  (state.operations || []).forEach((operation, index) => {
    if (operation.type === 'entity.upsert' && operation.payload?.id && !born.has(operation.payload.id)) born.set(operation.payload.id, index);
  });
  const older = (a, b) => (born.get(a.id) ?? Infinity) <= (born.get(b.id) ?? Infinity);
  const pairs = [];
  const seen = new Set();
  for (const entity of Object.values(state?.entities || {})) {
    const skip = id => distinct.has(distinctKey(entity.id, id));
    const parts = findByNameParts(state, entity.name, { exceptId: entity.id });
    const match = parts && !skip(parts) ? { id: parts, sure: true, byParts: true } : matchEntity(state, entity.name, { exceptId: entity.id, skip });
    if (!match) continue;
    for (const otherId of match.sure ? [match.id] : match.ids) {
      const key = distinctKey(entity.id, otherId);
      if (seen.has(key)) continue;
      seen.add(key);
      const other = state.entities[otherId];
      // The original holds the twin's name among its other names; else the one with more history.
      const keepOther = match.byParts || findByNameParts(state, entity.name, { exceptId: entity.id }) === otherId
        || (findByNameParts(state, other.name, { exceptId: other.id }) !== entity.id
          && (weight(other) > weight(entity) || (weight(other) === weight(entity) && older(other, entity))));
      pairs.push({ fromId: keepOther ? entity.id : otherId, intoId: keepOther ? otherId : entity.id, sure: Boolean(match.sure) });
    }
  }
  return pairs;
}
