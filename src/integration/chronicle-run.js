/**
 * Writing the chronicle: which messages are due, the model requests that summarize
 * and merge them, the scene markers on messages, and hiding summarized messages
 * from the model (in the generate interceptor, on SillyTavern's prompt copy only —
 * the chat itself is never changed apart from the markers).
 */
import {
  CHRONICLE_KEEP, CHRONICLE_MARKER, addScene, levelLabel, looksRefused, mergeCandidates, mergeSummaries, uniqueId,
} from '../core/index.js';
import { withBusy } from './busy.js';

const SUMMARY_SYSTEM = 'You keep the running chronicle of a roleplay. Write in Russian. Output ONLY the summary text: no title, no list, no markdown, no reasoning.';

/** FNV-1a of the texts a scene covers: a later edit of those messages makes the scene stale. */
export function fingerprintTexts(texts) {
  let hash = 2166136261;
  for (const char of texts.join('\u0000')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const countsAsStory = message => message && !message.is_system && String(message.mes ?? '').trim();

/**
 * The next messages to summarize: the oldest `sceneEvery` story messages not yet
 * covered, never touching the newest `keepRecent`. Returns indices, or null.
 * A message already covered (or kept by hand) ends a run: scenes never overlap.
 */
export function pendingChunk(chat, config) {
  const limit = (chat?.length ?? 0) - config.keepRecent;
  let run = [];
  for (let index = 0; index < limit; index += 1) {
    const message = chat[index];
    if (message?.extra?.[CHRONICLE_MARKER]) { run = []; continue; }
    if (!countsAsStory(message)) continue;
    run.push(index);
    if (run.length === config.sceneEvery) return run;
  }
  return null;
}

/** How many story messages are still waiting (for the ladder). */
export function pendingCount(chat, config) {
  const limit = Math.max(0, (chat?.length ?? 0) - config.keepRecent);
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (countsAsStory(chat[index]) && !chat[index].extra?.[CHRONICLE_MARKER]) count += 1;
  }
  return count;
}

export function transcript(chat, indices, maxCharacters = 24000) {
  const lines = indices.map(index => {
    const message = chat[index];
    const speaker = message.is_user ? (message.name || 'Пользователь') : (message.name || 'Narrator');
    return `[#${index}] ${speaker}: ${String(message.mes).trim()}`;
  });
  return lines.join('\n\n').slice(-maxCharacters);
}

export function buildSceneRequest(chatText, { previous = '', persona = '' } = {}) {
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    {
      role: 'user',
      content: `${previous ? `Previous summary (context only, do not repeat it):\n${previous}\n\n` : ''}${persona ? `The user's character is ${persona}.\n` : ''}Messages to summarize:\n---\n${chatText}\n---\nWrite ONE dense paragraph of 60–180 words: who was there, where and when, what happened and why, decisions, promises and threats, secrets revealed (and to whom), changes in how characters treat each other, important objects. Keep names, places, numbers and dates exact. Narrator/Game Master labels are not characters. Past tense, no commentary.`,
    },
  ];
}

export function buildMergeRequest(level, texts) {
  const what = level === 0 ? 'scenes' : 'chapters';
  return [
    { role: 'system', content: SUMMARY_SYSTEM },
    {
      role: 'user',
      content: `Consecutive ${what} of the story, oldest first:\n---\n${texts.map((text, index) => `${index + 1}. ${text}`).join('\n')}\n---\nMerge them into ONE higher-level summary, a single paragraph of 120–260 words. Do not glue sentences together: keep the cause-and-effect line, drop repeats and minor detail. Always keep promises, unresolved threads, secrets and who knows them, important objects, and turning points in relationships. Keep names exact.`,
    },
  ];
}

/** The model's text, cleaned; empty → null. */
export function parseSummaryText(raw) {
  const text = String(typeof raw === 'string' ? raw : raw?.text ?? raw?.message ?? '')
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*|\s*```$/gi, '')
    .replace(/^\s*(сводка|summary)\s*:\s*/i, '')
    .trim();
  // A refusal or an API error is not a summary: it must never be saved in its place.
  return text.length >= 20 && !looksRefused(text) ? text : null;
}

/** The model's answer was a refusal (a filter), not an empty one. */
export class RefusedError extends Error {
  constructor(quote) {
    super(`Модель отказалась писать сводку (похоже на фильтр): «${String(quote).replace(/\s+/g, ' ').slice(0, 140)}». Сводка не записана. Можно выбрать для хроники другую модель: «Настройки → Модели и API → Вспомогательный API → Анализ ответов и истории».`);
    this.name = 'RefusedError';
  }
}

async function ask(context, prompt, label) {
  let refusal = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await withBusy(label, () => context.generateRaw({ prompt, trimNames: false }));
    const text = parseSummaryText(raw);
    if (text) return text;
    const said = String(typeof raw === 'string' ? raw : raw?.text ?? raw?.message ?? '').replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').trim();
    if (looksRefused(said)) refusal = said;
  }
  if (refusal) throw new RefusedError(refusal);
  throw new Error('Модель дважды вернула пустую сводку');
}

/**
 * Write what is due: up to `maxScenes` new scenes, then every merge that became due
 * (scenes → chapters → arcs). Arcs are not merged further automatically.
 *
 * api: { context (for generateRaw), chat(), chronicle(), save(chronicle) — persists the
 *        state, saveChat(), isStale() → true when the chat changed meanwhile, persona }
 * Returns { scenes, merges }.
 */
export async function runChronicle(api, config, { maxScenes = 3, onProgress = () => {} } = {}) {
  let scenes = 0;
  let merges = 0;
  for (let round = 0; round < maxScenes; round += 1) {
    const chat = api.chat();
    const indices = pendingChunk(chat, config);
    if (!indices) break;
    onProgress(`Хроника: сцена из сообщений #${indices[0]}–#${indices.at(-1)}…`);
    const previous = api.chronicle().summaries.filter(item => !item.parentId).at(-1)?.text ?? '';
    const text = await ask(api.context, buildSceneRequest(transcript(chat, indices), { previous, persona: api.persona }), 'хроника: сводка сцены…');
    if (api.isStale()) return { scenes, merges };
    const id = uniqueId('scene');
    const live = api.chat();
    for (const index of indices) {
      live[index].extra ??= {};
      live[index].extra[CHRONICLE_MARKER] = id;
    }
    await api.saveChat();
    await api.save(addScene(api.chronicle(), { id, text, messageCount: indices.length, fingerprint: fingerprintTexts(indices.map(index => String(live[index].mes))) }));
    scenes += 1;
  }
  for (const [level, count] of [[0, config.chapterOf], [1, config.arcOf]]) {
    for (;;) {
      const ids = mergeCandidates(api.chronicle(), level, count);
      if (!ids.length) break;
      const texts = ids.map(id => api.chronicle().summaries.find(item => item.id === id).text);
      onProgress(`Хроника: ${level === 0 ? 'глава' : 'арка'} из ${ids.length}…`);
      const text = await ask(api.context, buildMergeRequest(level, texts), `хроника: ${level === 0 ? 'глава' : 'арка'}…`);
      if (api.isStale()) return { scenes, merges };
      await api.save(mergeSummaries(api.chronicle(), ids, { id: uniqueId(level === 0 ? 'chapter' : 'arc'), text }));
      merges += 1;
    }
  }
  return { scenes, merges };
}

/** Merge chosen summaries by hand (same level, at least two, all visible). */
export async function compressSelected(api, ids) {
  const chronicle = api.chronicle();
  const items = ids.map(id => chronicle.summaries.find(item => item.id === id));
  if (items.length < 2 || items.some(item => !item || item.parentId)) throw new Error('Выберите две или больше видимые сводки');
  if (items.some(item => item.level !== items[0].level)) throw new Error('Сжимать можно только сводки одного уровня');
  const ordered = [...items].sort((left, right) => left.seq - right.seq);
  const text = await ask(api.context, buildMergeRequest(Math.min(1, ordered[0].level), ordered.map(item => item.text)), `хроника: ${levelLabel({ level: Math.min(2, ordered[0].level + 1) }).toLowerCase()}…`);
  if (api.isStale()) return null;
  const next = mergeSummaries(chronicle, ordered.map(item => item.id), { id: uniqueId(ordered[0].level === 0 ? 'chapter' : 'arc'), text });
  await api.save(next);
  return next;
}

/**
 * In the generate interceptor: take summarized messages out of SillyTavern's prompt
 * copy (`coreChat`). Only messages of scenes that still exist are hidden; "keep"
 * marks and markers of removed scenes leave the message in. Returns how many went.
 */
export function hideSummarized(coreChat, chronicle) {
  const scenes = new Set((chronicle?.summaries ?? []).filter(item => item.level === 0 && !item.childIds).map(item => item.id));
  let removed = 0;
  for (let index = coreChat.length - 1; index >= 0; index -= 1) {
    const marker = coreChat[index]?.extra?.[CHRONICLE_MARKER];
    if (marker && marker !== CHRONICLE_KEEP && scenes.has(marker)) {
      coreChat.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

/**
 * Which chat messages hideSummarized takes out of the prompt, for the mark on them:
 * [{ messageIndex, number }] with the scene's number in story order (1-based).
 * The same rule as hideSummarized, so the mark never lies about what the model gets.
 */
export function summarizedMarks(chat, chronicle) {
  const scenes = (chronicle?.summaries ?? []).filter(item => item.level === 0 && !item.childIds)
    .sort((left, right) => left.seq - right.seq);
  const numbers = new Map(scenes.map((scene, position) => [scene.id, position + 1]));
  const marks = [];
  (chat ?? []).forEach((message, messageIndex) => {
    const marker = message?.extra?.[CHRONICLE_MARKER];
    if (marker && marker !== CHRONICLE_KEEP && numbers.has(marker)) marks.push({ messageIndex, number: numbers.get(marker) });
  });
  return marks;
}

/** Messages of a scene, in chat order. */
export function sceneMessages(chat, sceneId) {
  const indices = [];
  (chat ?? []).forEach((message, index) => { if (message?.extra?.[CHRONICLE_MARKER] === sceneId) indices.push(index); });
  return indices;
}

/** After an edit: is the scene of this message out of date? Returns its ID or ''. */
export function staleSceneOf(chat, chronicle, messageIndex) {
  const sceneId = chat?.[messageIndex]?.extra?.[CHRONICLE_MARKER];
  const scene = sceneId ? chronicle.summaries.find(item => item.id === sceneId) : null;
  if (!scene?.fingerprint) return '';
  const now = fingerprintTexts(sceneMessages(chat, sceneId).map(index => String(chat[index].mes)));
  return now === scene.fingerprint ? '' : scene.id;
}

/** Give a scene's messages back to the prompt: they are marked "keep" and never summarized again. */
export function releaseScene(chat, sceneId) {
  const indices = sceneMessages(chat, sceneId);
  for (const index of indices) chat[index].extra[CHRONICLE_MARKER] = CHRONICLE_KEEP;
  return indices.length;
}

/** How many chat messages stand behind these scenes. */
export function messagesOfScenes(chat, sceneIds) {
  return sceneIds.reduce((sum, id) => sum + sceneMessages(chat, id).length, 0);
}
