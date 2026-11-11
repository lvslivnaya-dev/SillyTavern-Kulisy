/**
 * The chronicle: summaries of the story so far, in levels.
 *
 *   level 0 — a scene: a summary of N consecutive messages;
 *   level 1 — a chapter: several scenes merged;
 *   level 2 — an arc: several chapters merged (arcs may merge into a bigger arc).
 *
 * chronicle = { version: 1, seq, summaries: [{ id, level, seq, text, parentId?, childIds?,
 *               messageCount?, fingerprint?, pinned?, edited?, stale?, createdAt }] }
 *
 * A summary with a parent is folded into it and not sent on its own; the active
 * summaries (no parent) are what the model gets, oldest first. Merging never deletes
 * the children, so "unfold" brings them straight back. A pinned summary is never
 * merged: an important scene stays detailed.
 *
 * Which messages a scene covers is written on the messages themselves
 * (message.extra.kulisyChronicle = scene ID), so deleting or inserting messages
 * cannot shift a range. The chronicle lives in state.ui: it is not journaled and a
 * swipe does not undo it (swipes only touch the newest messages, which are never
 * summarized: `keepRecent`).
 *
 * Every function returns a new chronicle and never mutates its input.
 */

export const CHRONICLE_MARKER = 'kulisyChronicle';
/** Marker of messages whose scene was unfolded by hand: they stay as they are. */
export const CHRONICLE_KEEP = 'keep';
export const CHRONICLE_LEVELS = Object.freeze(['scene', 'chapter', 'arc']);
export const MAX_LEVEL = 2;
export const CHRONICLE_TEXT_LIMIT = 3000;

/** sceneEvery: messages per scene; chapterOf: scenes per chapter; arcOf: chapters per arc. */
export const CHRONICLE_PRESETS = Object.freeze({
  detailed: Object.freeze({ sceneEvery: 10, chapterOf: 6, arcOf: 6 }),
  balanced: Object.freeze({ sceneEvery: 15, chapterOf: 4, arcOf: 4 }),
  economy: Object.freeze({ sceneEvery: 25, chapterOf: 3, arcOf: 3 }),
});

const LIMITS = Object.freeze({ sceneEvery: [4, 100], chapterOf: [2, 12], arcOf: [2, 12], keepRecent: [2, 200], maxPromptCharacters: [500, 30000] });

function bounded(value, [min, max], fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/** The effective numbers: a preset's, or the user's own with 'custom'. */
export function chronicleConfig(raw = {}) {
  const preset = CHRONICLE_PRESETS[raw.preset] ? raw.preset : (raw.preset === 'custom' ? 'custom' : 'balanced');
  const base = preset === 'custom' ? CHRONICLE_PRESETS.balanced : CHRONICLE_PRESETS[preset];
  const own = key => (preset === 'custom' ? bounded(raw[key], LIMITS[key], base[key]) : base[key]);
  return {
    enabled: raw.enabled === true,
    preset,
    sceneEvery: own('sceneEvery'),
    chapterOf: own('chapterOf'),
    arcOf: own('arcOf'),
    keepRecent: bounded(raw.keepRecent, LIMITS.keepRecent, 20),
    hideSummarized: raw.hideSummarized !== false,
    maxPromptCharacters: bounded(raw.maxPromptCharacters, LIMITS.maxPromptCharacters, 6000),
  };
}

export function emptyChronicle() {
  return { version: 1, seq: 0, summaries: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, CHRONICLE_TEXT_LIMIT);
}

/** Repair whatever was stored: unknown parents and children are dropped, order is kept. */
export function normalizeChronicle(input) {
  const chronicle = emptyChronicle();
  if (!input || typeof input !== 'object' || !Array.isArray(input.summaries)) return chronicle;
  const seen = new Set();
  for (const raw of input.summaries) {
    const id = String(raw?.id ?? '');
    const text = cleanText(raw?.text);
    const level = Math.round(Number(raw?.level));
    if (!id || !text || seen.has(id) || !(level >= 0 && level <= MAX_LEVEL)) continue;
    seen.add(id);
    chronicle.summaries.push({
      id, level, text,
      seq: Number.isFinite(Number(raw.seq)) ? Number(raw.seq) : chronicle.summaries.length,
      ...(raw.parentId ? { parentId: String(raw.parentId) } : {}),
      ...(Array.isArray(raw.childIds) ? { childIds: raw.childIds.map(String) } : {}),
      ...(Number.isFinite(Number(raw.messageCount)) ? { messageCount: Number(raw.messageCount) } : {}),
      ...(raw.fingerprint ? { fingerprint: String(raw.fingerprint) } : {}),
      ...(raw.pinned ? { pinned: true } : {}),
      ...(raw.edited ? { edited: true } : {}),
      ...(raw.stale ? { stale: true } : {}),
      createdAt: String(raw.createdAt ?? ''),
    });
  }
  const ids = new Set(chronicle.summaries.map(item => item.id));
  for (const item of chronicle.summaries) {
    if (item.parentId && !ids.has(item.parentId)) delete item.parentId;
    if (item.childIds) item.childIds = item.childIds.filter(id => ids.has(id));
  }
  chronicle.seq = Math.max(Number(input.seq) || 0, ...chronicle.summaries.map(item => item.seq + 1), 0);
  return chronicle;
}

const bySeq = (left, right) => left.seq - right.seq;

/** What the model gets, oldest first. */
export function activeSummaries(chronicle) {
  return (chronicle?.summaries ?? []).filter(item => !item.parentId).sort(bySeq);
}

function find(chronicle, id) {
  return chronicle.summaries.find(item => item.id === id) ?? null;
}

/** A new scene summary (level 0) for `messageCount` messages; `fingerprint` of their text. */
export function addScene(chronicle, { id, text, messageCount, fingerprint = '', createdAt = new Date().toISOString() }) {
  const value = cleanText(text);
  if (!id || !value) throw new TypeError('Сводка сцены пуста');
  const next = clone(chronicle);
  next.summaries.push({ id, level: 0, seq: next.seq, text: value, messageCount: Math.max(1, Number(messageCount) || 1), ...(fingerprint ? { fingerprint } : {}), createdAt });
  next.seq += 1;
  return next;
}

/**
 * The oldest run of active, unpinned summaries of one level that is long enough to
 * merge (`count`), or [] when there is none. A pinned summary breaks the run: a
 * chapter never jumps over a scene kept on its own.
 */
export function mergeCandidates(chronicle, level, count) {
  if (level < 0 || level >= MAX_LEVEL + 1) return [];
  let run = [];
  for (const item of activeSummaries(chronicle)) {
    if (item.level === level && !item.pinned && !item.stale) {
      run.push(item);
      if (run.length === count) return run.map(summary => summary.id);
    } else {
      run = [];
    }
  }
  return [];
}

/**
 * Fold `childIds` (active summaries of one level, in order) into one summary a
 * level up (arcs stay arcs). The parent takes the place of its first child.
 */
export function mergeSummaries(chronicle, childIds, { id, text, createdAt = new Date().toISOString() }) {
  const value = cleanText(text);
  if (!id || !value) throw new TypeError('Сводка пуста');
  const next = clone(chronicle);
  const children = childIds.map(childId => find(next, childId));
  if (children.length < 2 || children.some(child => !child || child.parentId)) throw new RangeError('Сжимать можно только две и больше видимые сводки');
  const level = children[0].level;
  if (children.some(child => child.level !== level)) throw new RangeError('Сжимать можно только сводки одного уровня');
  for (const child of children) child.parentId = id;
  next.summaries.push({ id, level: Math.min(MAX_LEVEL, level + 1), seq: Math.min(...children.map(child => child.seq)), text: value, childIds: [...childIds], createdAt });
  return next;
}

/**
 * Unfold a chapter or arc: it goes, its children come back.
 * A scene cannot be unfolded here — its messages are on the chat (see removeScene).
 */
export function unfoldSummary(chronicle, id) {
  const next = clone(chronicle);
  const item = find(next, id);
  if (!item) throw new RangeError('Такой сводки нет');
  if (item.level === 0 && !item.childIds) throw new RangeError('Сцену разворачивают вместе с сообщениями');
  for (const child of next.summaries) if (child.parentId === id) delete child.parentId;
  next.summaries = next.summaries.filter(summary => summary.id !== id);
  if (item.parentId) {
    // Unfolding something inside a bigger summary: its children join that parent.
    const parent = find(next, item.parentId);
    for (const child of next.summaries) if ((item.childIds ?? []).includes(child.id)) child.parentId = parent.id;
    parent.childIds = parent.childIds.flatMap(childId => (childId === id ? item.childIds ?? [] : [childId]));
  }
  return next;
}

/**
 * Remove a scene (its messages go back into the prompt; the caller marks them "keep").
 * Its chapter keeps its text but no longer lists it; a chapter left with one child
 * unfolds into that child.
 */
export function removeScene(chronicle, id) {
  let next = clone(chronicle);
  const scene = find(next, id);
  if (!scene || scene.level !== 0 || scene.childIds) throw new RangeError('Такой сцены нет');
  next.summaries = next.summaries.filter(item => item.id !== id);
  let parentId = scene.parentId;
  while (parentId) {
    const parent = find(next, parentId);
    if (!parent) break;
    parent.childIds = (parent.childIds ?? []).filter(childId => childId !== id && find(next, childId));
    const up = parent.parentId;
    if (parent.childIds.length <= 1) next = unfoldSummary(next, parent.id);
    parentId = up;
  }
  return next;
}

/**
 * Remove a summary of any level together with everything folded under it.
 * Returns { chronicle, sceneIds }: the scenes that went with it, whose messages the caller gives back
 * to the prompt. A chapter or arc left with one part unfolds into it, like removeScene.
 */
export function removeSummary(chronicle, id) {
  let next = clone(chronicle);
  const item = find(next, id);
  if (!item) throw new RangeError('Такой сводки нет');
  const doomed = new Set([id]);
  for (const queue = [id]; queue.length;) {
    const current = queue.pop();
    for (const summary of next.summaries) {
      if (summary.parentId === current && !doomed.has(summary.id)) { doomed.add(summary.id); queue.push(summary.id); }
    }
  }
  const sceneIds = next.summaries.filter(summary => doomed.has(summary.id) && summary.level === 0 && !summary.childIds).map(summary => summary.id);
  next.summaries = next.summaries.filter(summary => !doomed.has(summary.id));
  let parentId = item.parentId;
  while (parentId) {
    const parent = find(next, parentId);
    if (!parent) break;
    parent.childIds = (parent.childIds ?? []).filter(childId => !doomed.has(childId) && find(next, childId));
    const up = parent.parentId;
    if (parent.childIds.length <= 1) next = unfoldSummary(next, parent.id);
    parentId = up;
  }
  return { chronicle: next, sceneIds };
}

/**
 * Whether a «summary» is really the API's refusal or an error message that was saved in its place
 * («The prompt could not be submitted… sensitive words», «I'm sorry, but I can't…», «Извините, я не могу…»).
 * A real summary is a few hundred characters of story, so only short texts are suspected.
 */
export function looksRefused(text) {
  const value = String(text ?? '').trim();
  if (!value || value.length > 600) return false;
  // Words of an API/filter message can sit anywhere in it.
  if (/could not be submitted|sensitive words|violates? (?:the |our |google'?s? )?(?:usage |content |safety )?(?:polic|terms|guideline)|content (?:polic|filter)|safety (?:filter|setting|system)|prompt[_ ]feedback|PROHIBITED_CONTENT|blocked (?:by|due)/i.test(value)) return true;
  // A model's own refusal opens the answer; the same words deep inside a story are a quote.
  const opening = value.slice(0, 110);
  return /^[\s"'«»(\[*_>-]*(?:i(?:'m| am) sorry|sorry|i (?:cannot|can't|can not|won't|will not|am unable|'m unable)|as an ai|unfortunately)/i.test(opening)
    || /^[\s"'«»(\[*_>-]*(?:извин|к сожалению|я не могу|не могу (?:помочь|выполнить|продолжить|написать)|мне жаль)/i.test(opening);
}

/** IDs of summaries (any level) whose text is a refusal; newest last. */
export function refusedSummaries(chronicle) {
  return (chronicle?.summaries ?? []).filter(item => looksRefused(item.text)).sort(bySeq).map(item => item.id);
}

export function editSummary(chronicle, id, text) {
  const value = cleanText(text);
  if (!value) throw new TypeError('Сводка не может быть пустой');
  const next = clone(chronicle);
  const item = find(next, id);
  if (!item) throw new RangeError('Такой сводки нет');
  item.text = value;
  item.edited = true;
  delete item.stale;
  return next;
}

export function pinSummary(chronicle, id, pinned = true) {
  const next = clone(chronicle);
  const item = find(next, id);
  if (!item) throw new RangeError('Такой сводки нет');
  if (pinned) item.pinned = true; else delete item.pinned;
  return next;
}

/** A scene whose messages were edited after it was written: shown for a rebuild, never merged. */
export function markStale(chronicle, id, stale = true) {
  const next = clone(chronicle);
  const item = find(next, id);
  if (!item) return chronicle;
  if (stale) item.stale = true; else delete item.stale;
  return next;
}

/** Replace a stale scene's text with a fresh one. */
export function rebuildScene(chronicle, id, { text, fingerprint = '' }) {
  const next = editSummary(chronicle, id, text);
  const item = find(next, id);
  delete item.edited;
  if (fingerprint) item.fingerprint = fingerprint;
  return next;
}

/** The scene IDs a summary stands for (itself for a scene, all scenes below for a chapter or arc). */
export function scenesOf(chronicle, id) {
  const item = find(chronicle, id);
  if (!item) return [];
  if (item.level === 0 && !item.childIds) return [item.id];
  return (item.childIds ?? []).flatMap(childId => scenesOf(chronicle, childId));
}

/** Labels for the user and the model. */
export function levelLabel(item) {
  if (item.level === 0) return 'Сцена';
  return item.level === 1 ? 'Глава' : 'Арка';
}

/**
 * The prompt block: active summaries, oldest first. Over the budget, the oldest go
 * first (they are the most compressed and the least urgent).
 */
export function buildChroniclePrompt(chronicle, { maxCharacters = 6000 } = {}) {
  const active = activeSummaries(chronicle);
  if (!active.length) return '';
  const counters = { 0: 0, 1: 0, 2: 0 };
  const lines = active.map(item => {
    counters[item.level] += 1;
    return `${levelLabel(item)} ${counters[item.level]}: ${item.text}`;
  });
  const head = '[STORY SO FAR — CHRONICLE]\nWhat happened before the messages below, oldest first. Treat it as established past: keep names, facts, promises and secrets consistent with it; do not retell it.';
  const tail = '[/STORY SO FAR]';
  const budget = Math.max(200, maxCharacters - head.length - tail.length - 4);
  const kept = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (used + lines[index].length + 1 > budget && kept.length) break;
    kept.unshift(lines[index].slice(0, budget));
    used += lines[index].length + 1;
  }
  return `${head}\n${kept.join('\n')}\n${tail}`;
}

/** Numbers for the ladder: messages, active scenes, chapters, arcs, and characters sent. */
export function chronicleStats(chronicle, messageCount = 0) {
  const active = activeSummaries(chronicle);
  return {
    messages: messageCount,
    scenes: active.filter(item => item.level === 0).length,
    chapters: active.filter(item => item.level === 1).length,
    arcs: active.filter(item => item.level === 2).length,
    characters: active.reduce((sum, item) => sum + item.text.length, 0),
  };
}
