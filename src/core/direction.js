/**
 * Direction: the user's stage cues for the coming reply («пнуть» a character).
 *
 * A cue is armed from the panel above the message box. It rides along with the
 * user's NEXT post (or a generation without one), stays in force for every swipe
 * or regeneration of that reply, and burns when the user starts the turn after.
 * A cue may wait a few turns first (⏳). Kept per chat in state.ui.direction.
 *
 * Pure: no DOM, no SillyTavern. index.js feeds it the generation type and the chat.
 */

/** Ready genres of a scene event (the «⚡ Событие» pills): the label on the button and what the narrator is told. */
export const EVENT_GENRES = Object.freeze({
  fight: { label: 'Драка', icon: '👊', en: 'a fight: the tension breaks into blows, the characters get physical' },
  conflict: { label: 'Конфликт', icon: '⚔', en: 'an open conflict flares up: a heated quarrel or a standoff that nobody can ignore' },
  drama: { label: 'Драма', icon: '🎭', en: 'an emotional drama: a painful confession, a rupture or a loss that hits the characters hard' },
  massacre: { label: 'Резня', icon: '🩸', en: 'a massacre: mass killing, brutal and graphic, with lasting consequences for the survivors' },
  rape: { label: 'Изнасилование', icon: '⛓', en: 'a rape: a sexual assault is committed against a character, written in the story\'s own tone, with its real consequences for those involved' },
  violence: { label: 'Насилие', icon: '🥀', en: 'an act of violence is committed against a character, with real physical and emotional consequences' },
  pressure: { label: 'Психологическое давление', icon: '🕸', en: 'psychological pressure: manipulation, intimidation, gaslighting or coercion aimed at a character' },
});

export const CUE_KINDS = Object.freeze(['enter', 'react', 'custom', 'factor', 'secret', 'hold', 'focus', 'call', 'leave', 'event', 'scene', 'note', 'recall', 'dice', 'quest']);
export const DIRECTION_LIMITS = Object.freeze({ cues: 20, text: 400, sceneText: 1200, place: 120, cast: 20, wait: 9, favorites: 30, favorite: 200 });
/** How much story time a new scene skips (the narrator's words; the chronicler moves the clock). */
export const SCENE_SKIPS = Object.freeze({ none: '', hour: 'an hour later', evening: 'later that evening', nextday: 'the next day', week: 'a week later' });

/** Cues that need a character; 'event', 'scene' and 'note' are about the whole reply. */
const NEEDS_ENTITY = new Set(['enter', 'react', 'custom', 'factor', 'secret', 'hold', 'focus', 'call', 'leave']);
/** One of these per character at a time: a new one replaces the old. */
const EXCLUSIVE = new Set(['enter', 'hold', 'call', 'leave']);
/** Generations that redo the same reply: the cues already in force stay. */
const SAME_TURN = new Set(['swipe', 'regenerate', 'continue']);
/** Generations that are not a story reply at all. */
const IGNORED = new Set(['quiet', 'impersonate']);

const clip = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function normalizeCue(raw, knownIds) {
  if (!raw || typeof raw !== 'object' || !CUE_KINDS.includes(raw.kind)) return null;
  const known = id => typeof id === 'string' && id && (!knownIds || knownIds.has(id));
  if (NEEDS_ENTITY.has(raw.kind) && !known(raw.entityId)) return null;
  const cue = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `cue-${Math.random().toString(36).slice(2, 10)}`,
    kind: raw.kind,
    wait: Math.max(0, Math.min(DIRECTION_LIMITS.wait, Math.round(Number(raw.wait)) || 0)),
    used: raw.used === true,
  };
  if (NEEDS_ENTITY.has(raw.kind)) cue.entityId = raw.entityId;
  if (raw.kind === 'react') {
    if (raw.targetId !== 'last' && !known(raw.targetId)) return null;
    cue.targetId = raw.targetId;
  }
  if (raw.kind === 'factor') {
    if (!known(raw.targetId)) return null;
    cue.targetId = raw.targetId;
    // 'out': the factor is from the kicked one's own line (moments that move them).
    if (raw.side === 'out') cue.side = 'out';
  }
  if (raw.kind === 'scene') {
    // A new scene: optional text, time skip, place (a chat place's id, or words) and who is in it.
    if (Object.hasOwn(SCENE_SKIPS, raw.skip) && raw.skip !== 'none') cue.skip = raw.skip;
    const place = clip(raw.place, DIRECTION_LIMITS.place);
    if (place) cue.place = place;
    if (typeof raw.placeId === 'string' && raw.placeId) cue.placeId = raw.placeId;
    const cast = Array.isArray(raw.castIds) ? [...new Set(raw.castIds.filter(known))].slice(0, DIRECTION_LIMITS.cast) : [];
    if (cast.length) cue.castIds = cast;
  }
  const text = clip(raw.text, raw.kind === 'scene' ? DIRECTION_LIMITS.sceneText : DIRECTION_LIMITS.text);
  if (['custom', 'factor', 'secret', 'note', 'recall'].includes(raw.kind) && !text) return null;
  if (text) cue.text = text;
  if (raw.label) cue.label = clip(raw.label, 120);
  if (raw.kind === 'dice' || raw.kind === 'quest') {
    // The intimacy dice (and a quest step brought in): `text` is the short Russian line, `detail` what the narrator is told.
    const detail = clip(raw.detail, 1600);
    if (!detail || !cue.text) return null;
    cue.detail = detail;
  }
  if (raw.kind === 'event' && Object.hasOwn(EVENT_GENRES, raw.genre)) {
    cue.genre = raw.genre;
    if (!cue.text) cue.text = EVENT_GENRES[raw.genre].label;
  }
  if (raw.kind === 'secret' && typeof raw.eventId === 'string') cue.eventId = raw.eventId;
  return cue;
}

/** A tidy direction state; cues about removed characters are dropped. */
export function normalizeDirection(raw, knownIds = null) {
  const ids = knownIds ? new Set(knownIds) : null;
  const cues = Array.isArray(raw?.cues) ? raw.cues.map(cue => normalizeCue(cue, ids)).filter(Boolean) : [];
  return { cues: cues.slice(-DIRECTION_LIMITS.cues) };
}

/**
 * Arm a cue. A character gets one of enter/hold/call/leave at a time, one cue of the
 * same kind toward the same target, and the reply has one focus. Throws on a bad cue.
 */
export function armCue(direction, raw, knownIds = null) {
  const cue = normalizeCue({ ...raw, used: false }, knownIds ? new Set(knownIds) : null);
  if (!cue) throw new Error('Пинок не понят: не хватает персонажа или текста.');
  const clash = old => {
    if (old.kind === 'focus' && cue.kind === 'focus') return true;
    if (old.kind === 'scene' && cue.kind === 'scene') return true; // one new scene per reply
    if (old.kind === 'dice' && cue.kind === 'dice') return true; // one roll per reply
    // The same thing to recall is armed once; different ones add up.
    if (old.kind === 'recall' && cue.kind === 'recall') return old.text === cue.text;
    if (old.kind === 'quest' && cue.kind === 'quest') return old.text === cue.text;
    if (!cue.entityId || old.entityId !== cue.entityId) return false;
    if (EXCLUSIVE.has(old.kind) && EXCLUSIVE.has(cue.kind)) return true;
    // «Молчит» and «Только он» for the same character contradict each other.
    if ((old.kind === 'hold' && cue.kind === 'focus') || (old.kind === 'focus' && cue.kind === 'hold')) return true;
    return old.kind === cue.kind && old.kind !== 'custom' && (old.targetId ?? '') === (cue.targetId ?? '') && (old.eventId ?? '') === (cue.eventId ?? '');
  };
  const cues = (direction?.cues ?? []).filter(old => !clash(old));
  return { cues: [...cues, cue].slice(-DIRECTION_LIMITS.cues) };
}

export function removeCue(direction, cueId) {
  return { cues: (direction?.cues ?? []).filter(cue => cue.id !== cueId) };
}

/**
 * A generation is about to start. A new turn burns the cues of the last one,
 * counts down the waiting ones and puts the ready ones in force; a swipe or a
 * regeneration keeps those in force and adds the freshly armed ones.
 * → { direction, changed, fired: cues put in force now }
 */
export function startGeneration(direction, type) {
  const cues = direction?.cues ?? [];
  if (IGNORED.has(type)) return { direction: { cues }, changed: false, fired: [] };
  const sameTurn = SAME_TURN.has(type);
  const next = [];
  const fired = [];
  for (const cue of cues) {
    if (!sameTurn && cue.used) continue; // the last turn's cue: done
    if (cue.wait > 0) {
      next.push(sameTurn ? cue : { ...cue, wait: cue.wait - 1 });
      continue;
    }
    if (!cue.used) fired.push(cue.id);
    next.push({ ...cue, used: true });
  }
  const changed = next.length !== cues.length || next.some((cue, index) => cue.used !== cues[index]?.used || cue.wait !== cues[index]?.wait);
  return { direction: { cues: next }, changed, fired };
}

export function activeCues(direction) {
  return (direction?.cues ?? []).filter(cue => cue.used);
}

/**
 * What a reply under these cues changes on stage: { add, remove, cast, place }.
 * cast: the new scene's people (replaces who is present), or null; place: { location, locationId? } or null.
 */
export function presenceAfterReply(direction) {
  const add = [];
  const remove = [];
  let cast = null;
  let place = null;
  for (const cue of activeCues(direction)) {
    if (cue.kind === 'call') add.push(cue.entityId);
    if (cue.kind === 'leave') remove.push(cue.entityId);
    if (cue.kind === 'scene') {
      if (cue.castIds?.length) cast = [...cue.castIds];
      if (cue.placeId || cue.place) place = { location: cue.place ?? '', ...(cue.placeId ? { locationId: cue.placeId } : {}) };
    }
  }
  return { add, remove, cast, place };
}

/** Short Russian label for the panel: «Ран вступает», «⏳2 Риндо придёт». */
export function cueLabel(cue, nameOf) {
  const name = cue.entityId ? nameOf(cue.entityId) : '';
  const target = cue.targetId === 'last' ? 'последнее' : cue.targetId ? nameOf(cue.targetId) : '';
  switch (cue.kind) {
    case 'enter': return `${name} вступает`;
    case 'react': return `${name} → ${target}`;
    case 'custom': return `${name}: ${clip(cue.text, 40)}`;
    case 'factor': return `${name} → ${target}: ${clip(cue.label || cue.text, 40)}`;
    case 'secret': return `${name} на грани: ${clip(cue.label || cue.text, 30)}`;
    case 'hold': return `${name} молчит`;
    case 'focus': return `только ${name}`;
    case 'call': return `${name} придёт`;
    case 'leave': return `${name} уходит`;
    case 'event': return cue.text ? `событие: ${clip(cue.text, 40)}` : 'событие';
    case 'scene': return `новая сцена${cue.text ? `: ${clip(cue.text, 40)}` : ''}`;
    case 'note': return `рассказчику: ${clip(cue.text, 40)}`;
    case 'recall': return `вспомнить: ${clip(cue.text, 40)}`;
    case 'dice': return `кубик: ${clip(cue.text, 60)}`;
    case 'quest': return `квест: ${clip(cue.text, 60)}`;
    default: return cue.kind;
  }
}

/** Badge shown on a character's chip for their armed or active cue. */
export function cueBadge(cue) {
  return { enter: '👟', react: '💬', custom: '✍', factor: '❤', secret: '🔒', hold: '🤐', focus: '🎯', call: '🚪', leave: '🚪', event: '⚡', scene: '🎬', note: '📝', recall: '📌', dice: '🎲', quest: '🧭' }[cue.kind] ?? '👟';
}

function cueLine(cue, nameOf, presentSet) {
  const name = cue.entityId ? nameOf(cue.entityId) : '';
  const target = cue.targetId && cue.targetId !== 'last' ? nameOf(cue.targetId) : '';
  switch (cue.kind) {
    case 'enter': return `${name} steps in: speaks or acts on their own initiative in this reply, in their own way.`;
    case 'react': return cue.targetId === 'last'
      ? `${name} openly reacts to what has just happened (the last message): words, a look or an action.`
      : `${name} reacts to ${target}: words, a look or an action aimed at ${target}.`;
    case 'custom': return `${name}: ${cue.text}`;
    case 'factor': return cue.side === 'out'
      ? `${name}'s feelings toward ${target} can be moved by moments like this: ${cue.text}. In this reply ${name} is open to such a moment: notices it, tests for it or gives it a chance, and reacts honestly if it comes; it settles nothing by itself.`
      : `${name} does something like this toward ${target} — a moment that may shift how ${target} feels about ${name}; it settles nothing by itself: ${cue.text}`;
    case 'secret':
      // A secret's text goes only to the stage its keeper is on.
      if (presentSet && !presentSet.has(cue.entityId)) return '';
      return `${name} keeps a secret: «${cue.text}». In this reply they come close to giving it away (a slip of the tongue, a look, a dodge, an odd reaction) but do NOT reveal it.`;
    case 'hold': return `${name} stays in the background: present, but has no lines and does nothing notable in this reply.`;
    case 'focus': return `This reply centres on ${name}; everyone else stays in the background.`;
    case 'call': return `${name} comes into the scene in this reply (arrives, calls, catches up, is brought in — whatever fits where they were). Show how they come in.`;
    case 'leave': return `${name} leaves the scene in this reply, for a reason that fits the moment. Show them go.`;
    case 'event': if (EVENT_GENRES[cue.genre]) {
      const genre = EVENT_GENRES[cue.genre];
      return `Something happens in this reply that changes the scene, genre: ${genre.en}. Keep to the people and the place of the scene and let the characters react in character.${cue.text && cue.text !== genre.label ? ` Details: ${cue.text}.` : ''}`;
    } else return cue.text
      ? `Something happens in this reply that changes the scene: ${cue.text}. Let the characters react.`
      : 'Something happens in this reply that shakes up the scene: pick what fits the place, time and mood (a call, a visitor, the weather, a noise, news). Let the characters react.';
    case 'scene': {
      const when = SCENE_SKIPS[cue.skip] ?? '';
      const cast = (cue.castIds ?? []).map(nameOf).filter(Boolean);
      return [
        `Start a NEW scene in this reply${when ? `, ${when}` : ''}: ${cue.text || 'a fresh scene that follows naturally from the story so far'}.`,
        cue.place ? `Place: ${cue.place}.` : '',
        cast.length ? `In the scene: ${cast.join(', ')}.` : '',
        'Open it properly — where and when, who is there and what they are doing, the mood — with a clean break from the previous scene; do not recap it.',
      ].filter(Boolean).join(' ');
    }
    case 'note': return `Note for the narrator: ${cue.text}`;
    case 'dice': return `The intimate scene in this reply takes this direction (a roll of the dice; adapt it to where the scene really is and who is in it, never announce it): ${cue.detail}. {{user}} is never the one who leads and is never written for: show only what the other characters do, say and think, and leave {{user}}'s side to the user.`;
    case 'quest': return `A quest thread comes forward in this reply: ${cue.detail}. Let it surface through the scene itself (a person, a place, an event, a clue), woven in and never announced as a task. Do not complete the step and do not decide or write anything for {{user}}.`;
    case 'recall': return `Bring this back into play in this reply: «${cue.text}». Someone who knows it recalls it, mentions it, or it visibly shapes how they act — woven into the scene, not recited. Those who do not know it must not refer to it.`;
    default: return '';
  }
}

/** The narrator's block for the coming reply; '' when no cue is in force. */
export function buildDirectionPrompt(state, direction, { presentIds = null } = {}) {
  const nameOf = id => state.entities?.[id]?.name ?? '';
  const presentSet = presentIds ? new Set(presentIds) : null;
  const lines = activeCues(direction)
    .filter(cue => !cue.entityId || nameOf(cue.entityId))
    .filter(cue => !cue.targetId || cue.targetId === 'last' || nameOf(cue.targetId))
    .map(cue => cueLine(cue, nameOf, presentSet))
    .filter(Boolean);
  if (!lines.length) return '';
  return `[KULISY — STAGE DIRECTIONS FOR THIS REPLY]\n${lines.map(line => `- ${line}`).join('\n')}\n\nRules:\n- These are the user's stage directions for this reply. Follow them.\n- Keep every character in character while doing so: their voice, feelings, relationships and what they know. A direction says what happens, never who they are.\n- Weave them into the scene naturally; never mention or quote the directions.\n- Never write {{user}}'s actions, words or thoughts because of them.\n[/KULISY]`;
}

/**
 * How many bot replies in a row (newest first) each character went without being
 * mentioned. messages: [{ isUser, text }] oldest first; mentions(text) → Set of ids.
 * Looks back at most `lookBack` bot replies.
 */
export function silenceCounts(messages, ids, mentions, lookBack = 30) {
  const counts = new Map(ids.map(id => [id, 0]));
  const open = new Set(ids);
  let seen = 0;
  for (let index = (messages?.length ?? 0) - 1; index >= 0 && open.size && seen < lookBack; index -= 1) {
    const message = messages[index];
    if (!message || message.isUser || !String(message.text ?? '').trim()) continue;
    seen += 1;
    const found = mentions(message.text);
    for (const id of [...open]) {
      if (found.has(id)) open.delete(id);
      else counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

/** Saved custom cues, shared by all chats: trimmed, unique, newest first. */
export function normalizeFavorites(raw) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const text = clip(item, DIRECTION_LIMITS.favorite);
    const key = text.toLocaleLowerCase('ru-RU');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result.slice(0, DIRECTION_LIMITS.favorites);
}
