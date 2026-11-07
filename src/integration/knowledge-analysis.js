/**
 * The chronicler: the knowledge part of reply analysis.
 *
 * It rides in the same analyzer request as relationships (or, if the user
 * chooses, in its own request) and reports, for one reply:
 *   scene   — who is physically present at its end, and where;
 *   events  — new happenings that others may or may not know about;
 *   learned — information reaching a character ON PAGE (told, overheard, rumour);
 *   met     — introductions;
 *   leaks   — a character acting on an event they cannot know.
 *
 * The model only proposes. Everything is resolved to registered characters and
 * checked against the current dossiers here before it becomes journal operations.
 */
import { acquaintanceOf, howKnows, pairKey, presentIds, uniqueId } from '../core/index.js';
import { mentionedEntities } from './headcanon-retrieval.js';
import { WORLD_INSTRUCTIONS, buildWorldBlock, parseWorld } from './world-analysis.js';

export const CHRONICLE_LIMITS = Object.freeze({
  candidates: 15, events: 3, learned: 8, met: 6, leaks: 4, text: 300, quote: 160, location: 120,
});

const LEARN_SOURCES = new Set(['told', 'rumor']);
const MEET_RANK = { strangers: 0, seen: 1, known: 2 };

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalized(value) {
  return clip(value, 1000).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** Characters the reply concerns: on stage before it, plus everyone it mentions (and the persona). */
export function chronicleCast(state, text) {
  return new Set([...presentIds(state), ...mentionedEntities(state, text)]);
}

/**
 * Events worth showing the analyzer: active ones that at least one character of
 * the reply's cast does not know. Ranked by meaning when `similarity`
 * (Map eventId → score) is given; otherwise secrets first, then newest.
 */
export function selectKnowledgeCandidates(state, text, { limit = CHRONICLE_LIMITS.candidates, similarity = null } = {}) {
  const cast = [...chronicleCast(state, text)];
  const items = [];
  (state.knowledge?.events ?? []).forEach((event, order) => {
    if (event.disabled) return;
    const unknownTo = cast.filter(id => !howKnows(state, id, event));
    if (unknownTo.length) items.push({ event, unknownTo, order });
  });
  const score = item => similarity?.get(item.event.id) ?? -Infinity;
  items.sort(similarity
    ? (left, right) => score(right) - score(left) || right.order - left.order
    : (left, right) => Number(Boolean(right.event.secret)) - Number(Boolean(left.event.secret)) || right.order - left.order);
  return items.slice(0, Math.max(0, limit));
}

/** Pairs of the cast that have not been introduced: the analyzer reports when they meet. */
function unmetPairs(state, cast) {
  const ids = [...cast];
  const pairs = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const status = acquaintanceOf(state, ids[i], ids[j]);
      if (status === 'strangers' || status === 'seen') pairs.push({ ids: [ids[i], ids[j]], status });
    }
  }
  return pairs;
}

/** The KNOWLEDGE block of the analyzer's user prompt. */
export function buildKnowledgeBlock(state, text, candidates) {
  const name = id => state.entities?.[id]?.name ?? id;
  const tag = id => `${name(id)} (${id})`;
  const scene = state.knowledge?.scene ?? { presentIds: [], location: '' };
  const present = presentIds(state);
  const lines = [
    'KNOWLEDGE TRACKING',
    `Scene before this reply: present = ${present.length ? present.map(tag).join(', ') : '(unknown)'}; location = ${scene.location ? `"${scene.location}"` : '(unknown)'}.`,
  ];
  if (candidates.length) {
    lines.push('Known events that some of these characters do NOT know (event ID: text | witnessed by | unknown to):');
    for (const { event, unknownTo } of candidates) {
      lines.push(`- ${event.id}: ${clip(event.text, 200)} | saw: ${event.witnessIds.map(name).join(', ') || '—'}${event.secret ? ' | SECRET' : ''} | unknown to: ${unknownTo.map(tag).join(', ')}`);
    }
  } else {
    lines.push('No tracked event is unknown to the characters of this reply.');
  }
  const unmet = unmetPairs(state, chronicleCast(state, text));
  if (unmet.length) {
    lines.push('Pairs not introduced yet (strangers = never met; seen = met, names unknown):');
    for (const pair of unmet) lines.push(`- ${pair.ids.map(tag).join(' & ')}: ${pair.status}`);
  }
  return `\n${lines.join('\n').slice(0, 9000)}\nEND KNOWLEDGE TRACKING\n`;
}

/** Instructions appended to the analyzer's system prompt. */
export const KNOWLEDGE_INSTRUCTIONS = ` Also return "knowledge": {"scene":{"presentIds":["a"],"location":"short place"},"events":[{"key":"n1","text":"short Russian description","witnessIds":["a","b"],"secret":false}],"learned":[{"eventId":"event ID or new key","entityId":"c","source":"told","fromId":"a"}],"met":[{"ids":["a","c"],"status":"known"}],"leaks":[{"entityId":"c","eventId":"event ID","quote":"words from the reply"}]}.
KNOWLEDGE RULES:
- scene.presentIds: registered characters physically present at the END of this reply (include the user persona when present). location: where they are, a few Russian words; repeat the previous place if it did not change.
- events: at most ${CHRONICLE_LIMITS.events} NEW concrete happenings of this reply that other characters could later know or not know — a private conversation, a confession, a fight, a revealed secret, a discovery. Not feelings, not routine actions, not repeats of listed events. witnessIds: everyone who saw or heard it happen, as quoted IDs (never a word like all). secret: true when the participants clearly keep it from others.
- learned: ONLY when this reply SHOWS information reaching a character who did not have it: someone tells them, they overhear, read or are shown it. source "told" for direct transmission (fromId = who told; omit fromId when overheard or read), "rumor" for second-hand hearsay. eventId is a listed event ID or the key of a new event. Never for witnesses, never because someone "could have heard".
- met: introductions in this reply — "known" when they learn each other's names, "seen" when they meet face to face without names. Only listed not-introduced pairs and pairs with the user persona.
- leaks: a character speaks or acts on a listed event that is unknown to them while this reply shows NO way they learned it. quote: the exact words that show it, at most 120 characters. This is the most important check: an empty array is the normal answer, a leak is never a guess.
Use registered IDs. Empty arrays are correct and frequent.`;

const SYSTEM_ALONE = 'You track who knows what in narrator-driven roleplay: who is present, what happens, how information reaches characters, who meets whom, and when a character knows something they cannot know. The Narrator is a controller, never a character. Output ONLY valid JSON, without reasoning or markdown.';
const SYSTEM_WORLD_ALONE = 'You keep the continuity log of narrator-driven roleplay: story time, places, what characters wear and the objects they hold. The Narrator is a controller, never a character. Output ONLY valid JSON, without reasoning or markdown.';

/**
 * Prompt of the separate-request mode: the chroniclers alone.
 * options.knowledge (default true): who knows what; options.world (true or { library }): time, place, clothes, things.
 */
export function buildKnowledgeRequest(state, text, candidates, { knowledge = true, world = false } = {}) {
  const roster = Object.values(state.entities ?? {}).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases ?? [] }));
  const personaId = state.ui?.personaId || '';
  const system = knowledge ? `${SYSTEM_ALONE}${KNOWLEDGE_INSTRUCTIONS}${world ? WORLD_INSTRUCTIONS : ''}` : `${SYSTEM_WORLD_ALONE}${WORLD_INSTRUCTIONS}`;
  const keys = [knowledge ? '"knowledge":{…}' : '', world ? '"world":{…}' : ''].filter(Boolean).join(',');
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Known character registry:
${JSON.stringify(roster)}
${personaId ? `The user persona is ${personaId}.
` : ''}${knowledge ? buildKnowledgeBlock(state, text, candidates) : ''}${world ? buildWorldBlock(state, text, world.library ?? null, world.wardrobe ?? null, world.skipItemIds ?? null) : ''}
Scene (the reply to check):
---
${text}
---
Return JSON only: {${keys}}.`,
    },
  ];
}

const ID = value => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);
const IDS = (value, max = 20) => (Array.isArray(value) ? [...new Set(value.map(ID).filter(Boolean))].slice(0, max) : []);

/** Strict, tolerant parse of the "knowledge" object: bad items are dropped, a missing part is empty. */
export function parseKnowledge(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const scene = source.scene && typeof source.scene === 'object' && Array.isArray(source.scene.presentIds)
    ? { presentIds: IDS(source.scene.presentIds, 50), location: clip(source.scene.location, CHRONICLE_LIMITS.location) }
    : null;
  const events = (Array.isArray(source.events) ? source.events : [])
    .filter(item => item && clip(item.text, CHRONICLE_LIMITS.text))
    .slice(0, CHRONICLE_LIMITS.events)
    .map((item, index) => ({
      key: ID(item.key) ?? `n${index + 1}`,
      text: clip(item.text, CHRONICLE_LIMITS.text),
      witnessIds: IDS(item.witnessIds),
      secret: item.secret === true,
    }));
  const learned = (Array.isArray(source.learned) ? source.learned : [])
    .filter(item => item && ID(item.eventId) && ID(item.entityId))
    .slice(0, CHRONICLE_LIMITS.learned)
    .map(item => ({
      eventId: ID(item.eventId), entityId: ID(item.entityId),
      source: LEARN_SOURCES.has(item.source) ? item.source : 'told',
      ...(ID(item.fromId) ? { fromId: ID(item.fromId) } : {}),
    }));
  const met = (Array.isArray(source.met) ? source.met : [])
    .filter(item => item && IDS(item.ids).length === 2 && (item.status === 'known' || item.status === 'seen'))
    .slice(0, CHRONICLE_LIMITS.met)
    .map(item => ({ ids: IDS(item.ids), status: item.status }));
  const leaks = (Array.isArray(source.leaks) ? source.leaks : [])
    .filter(item => item && ID(item.entityId) && ID(item.eventId))
    .slice(0, CHRONICLE_LIMITS.leaks)
    .map(item => ({ entityId: ID(item.entityId), eventId: ID(item.eventId), quote: clip(item.quote, CHRONICLE_LIMITS.quote) }));
  return { scene, events, learned, met, leaks };
}

/** Parser of the separate-request mode: { knowledge, world } (each null when it was not asked). */
export function parseKnowledgeResponse(data, { knowledge = true, world = false } = {}) {
  return {
    knowledge: knowledge ? parseKnowledge(data?.knowledge ?? (world ? null : data)) : null,
    world: world ? parseWorld(data?.world) : null,
  };
}

/**
 * Turn a parsed chronicle into journal operations.
 * api.state()           — the current state (changes as operations are added);
 * api.add(type, payload, reason) — journal one operation with the reply's metadata;
 * api.resolveId(ref)    — registered ID for an ID, name or alias, or null.
 * Returns { leaks }: confirmed leaks for the message marker (not journaled).
 */
export function materializeKnowledge(chronicle, api) {
  if (!chronicle) return { leaks: [] };
  const { add, resolveId } = api;
  const resolveAll = refs => [...new Set((refs ?? []).map(resolveId).filter(Boolean))].sort();
  const now = new Date().toISOString();

  // 1. Scene — only when it actually changed, to keep the journal quiet.
  // api.locationId: the place card the scene chronicler chose; its name wins over free text.
  let present = presentIds(api.state());
  let location = api.state().knowledge?.scene?.location ?? '';
  const card = api.locationId ? (api.state().world?.locations ?? []).find(item => item.id === api.locationId) : null;
  const cardChanged = Boolean(card) && api.state().knowledge?.scene?.locationId !== card.id;
  if (chronicle.scene || cardChanged) {
    const nextPresent = chronicle.scene ? resolveAll(chronicle.scene.presentIds) : present;
    const nextLocation = card ? card.name : (chronicle.scene.location || location);
    if (JSON.stringify(nextPresent) !== JSON.stringify(present) || nextLocation !== location || cardChanged) {
      add('scene.set', {
        presentIds: nextPresent,
        ...(card ? { locationId: card.id } : nextLocation !== location ? { location: nextLocation } : {}),
      }, `Сцена: ${nextLocation || 'место не указано'}`);
      present = nextPresent;
      location = nextLocation;
    }
  }

  // 2. New events. A key that repeats an existing event's text maps onto that event.
  const keyToId = new Map();
  for (const item of chronicle.events) {
    const existing = (api.state().knowledge?.events ?? []).find(event => normalized(event.text) === normalized(item.text));
    if (existing) { keyToId.set(item.key, existing.id); continue; }
    const witnessIds = item.witnessIds.length ? resolveAll(item.witnessIds) : present;
    const id = uniqueId('event');
    add('event.add', {
      item: { id, text: item.text, witnessIds, ...(location ? { location } : {}), ...(item.secret ? { secret: true } : {}), createdAt: now },
    }, `Событие: ${item.text}`);
    keyToId.set(item.key, id);
  }
  const eventFor = reference => {
    const id = keyToId.get(reference) ?? reference;
    return (api.state().knowledge?.events ?? []).find(event => event.id === id) ?? null;
  };

  // 3. Learned on page. Skip anyone who already knows (a witness, or told before).
  for (const item of chronicle.learned) {
    const event = eventFor(item.eventId);
    const entityId = resolveId(item.entityId);
    if (!event || !entityId || howKnows(api.state(), entityId, event)) continue;
    const fromId = item.fromId ? resolveId(item.fromId) : null;
    add('learned.add', {
      item: { id: uniqueId('learned'), eventId: event.id, entityId, source: item.source, ...(fromId && fromId !== entityId ? { fromId } : {}) },
    }, `${api.state().entities[entityId]?.name ?? entityId} узнаёт: ${event.text}`);
  }

  // 4. Introductions only ever move forward: strangers → seen → known.
  for (const item of chronicle.met) {
    const [firstId, secondId] = resolveAll(item.ids);
    if (!firstId || !secondId || firstId === secondId) continue;
    const current = acquaintanceOf(api.state(), firstId, secondId);
    // null = canon decides; a meeting there tells us nothing new.
    if (current == null || MEET_RANK[item.status] <= MEET_RANK[current]) continue;
    add('acquaintance.set', { firstId, secondId, status: item.status },
      `${item.status === 'known' ? 'Знакомятся' : 'Встречаются'}: ${[firstId, secondId].map(id => api.state().entities[id]?.name ?? id).join(' и ')}`);
  }

  // 5. Leaks: kept only if, after this reply's own learning, the character still cannot know.
  const leaks = [];
  const seen = new Set();
  for (const item of chronicle.leaks) {
    const event = eventFor(item.eventId);
    const entityId = resolveId(item.entityId);
    if (!event || !entityId || howKnows(api.state(), entityId, event)) continue;
    const key = pairKey(entityId, event.id);
    if (seen.has(key)) continue;
    seen.add(key);
    leaks.push({ entityId, eventId: event.id, quote: item.quote });
  }
  return { leaks };
}
