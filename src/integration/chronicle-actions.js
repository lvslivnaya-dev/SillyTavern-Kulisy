/**
 * The chronicle as the extension runs it: when to write (after a reply, one run at a
 * time, never during a generation), and the Studio's callbacks.
 */
import {
  CHRONICLE_PRESETS, chronicleConfig, chronicleStats, editSummary, looksRefused, markStale, pinSummary, rebuildScene, refusedSummaries, removeScene, removeSummary, unfoldSummary,
} from '../core/index.js';
import {
  RefusedError, buildSceneRequest, compressSelected, fingerprintTexts, messagesOfScenes, parseSummaryText, pendingCount, releaseScene, runChronicle, sceneMessages, staleSceneOf, transcript,
} from './chronicle-run.js';
import { withBusy } from './busy.js';

/**
 * Messages waiting, and how many more replies until the next scene: a scene takes
 * `sceneEvery` messages, and the newest `keepRecent` are never summarized — so the
 * first scene comes only after sceneEvery + keepRecent messages.
 */
export function waiting(pending, config) {
  return { pending, untilNext: Math.max(0, config.sceneEvery - pending), keepRecent: config.keepRecent, sceneEvery: config.sceneEvery };
}

/** «Следующая сводка — …» for the pages. */
export function nextSceneText(stats) {
  if (!stats?.sceneEvery) return '';
  if (!stats.untilNext) return 'Сводка сцены готова к записи.';
  return `Следующая сводка — через ${stats.untilNext} сообщ.: сжимается по ${stats.sceneEvery}, а последние ${stats.keepRecent} всегда идут модели целиком и не сжимаются.`;
}

const SETTING_KEYS =['enabled', 'preset', 'sceneEvery', 'chapterOf', 'arcOf', 'keepRecent', 'hideSummarized', 'maxPromptCharacters'];

/**
 * deps: { settings(), saveSettings(), chronicle(), save(next), chat(), saveChat(), context() (routed for
 *         the model), persona(), isGenerating(), waitForGeneration(), chatKey() → changes with the chat,
 *         confirm(title, text) → boolean, refresh(), notify(text), log(level, text, error) }
 */
export function createChronicleRunner(deps) {
  let running = null;
  let again = false;

  function api(chatKey) {
    return {
      context: deps.context(),
      chat: deps.chat,
      chronicle: deps.chronicle,
      save: deps.save,
      saveChat: deps.saveChat,
      persona: deps.persona(),
      isStale: () => deps.chatKey() !== chatKey,
    };
  }

  /** One run at a time; a request during a run schedules one more after it. */
  async function run({ maxScenes = 3, manual = false } = {}) {
    if (running) { again = true; return running; }
    const config = chronicleConfig(deps.settings().chronicle);
    if (!config.enabled && !manual) return { scenes: 0, merges: 0 };
    running = (async () => {
      try {
        if (deps.isGenerating()) await deps.waitForGeneration();
        const result = await runChronicle(api(deps.chatKey()), { ...config, enabled: true }, {
          maxScenes,
          onProgress: text => { if (manual) deps.notify?.(text); },
        });
        if (result.scenes || result.merges) {
          deps.log('info', `Хроника: новых сцен ${result.scenes}, сжатий ${result.merges}`);
          deps.refresh();
        }
        return result;
      } catch (error) {
        deps.log('warn', 'Хроника не записалась', error);
        if (manual) throw error;
        return { scenes: 0, merges: 0 };
      } finally {
        running = null;
        if (again) { again = false; queueMicrotask(() => run()); }
      }
    })();
    return running;
  }

  /** After an edit of a summarized message: its scene is marked for a rebuild. */
  async function onEdited(messageIndex) {
    const id = staleSceneOf(deps.chat(), deps.chronicle(), Number(messageIndex));
    if (id) {
      await deps.save(markStale(deps.chronicle(), id, true));
      deps.log('info', 'Хроника: сообщение сцены изменено, сцену стоит пересобрать');
    }
  }

  const callbacks = {
    onChronicleGet: () => {
      const config = chronicleConfig(deps.settings().chronicle);
      return {
        config,
        presets: CHRONICLE_PRESETS,
        chronicle: deps.chronicle(),
        refused: refusedSummaries(deps.chronicle()),
        stats: { ...chronicleStats(deps.chronicle(), deps.chat()?.length ?? 0), ...waiting(pendingCount(deps.chat(), config), config) },
        running: Boolean(running),
      };
    },
    /** Moving a slider switches to "custom", picking a preset fills its numbers. */
    onChronicleSettings: ({ changes = {} }) => {
      const current = deps.settings().chronicle ?? {};
      const next = { ...current };
      for (const key of SETTING_KEYS) if (Object.hasOwn(changes, key)) next[key] = changes[key];
      if (['sceneEvery', 'chapterOf', 'arcOf'].some(key => Object.hasOwn(changes, key)) && !Object.hasOwn(changes, 'preset')) next.preset = 'custom';
      if (CHRONICLE_PRESETS[changes.preset]) Object.assign(next, CHRONICLE_PRESETS[changes.preset]);
      deps.settings().chronicle = next;
      deps.saveSettings();
      deps.refresh();
      if (next.enabled && !current.enabled) run();
      return chronicleConfig(next);
    },
    /** "Сжать сейчас": everything that is due, with progress. */
    onChronicleRun: () => run({ maxScenes: 200, manual: true }),
    onChroniclePin: async ({ id, pinned = true }) => { await deps.save(pinSummary(deps.chronicle(), id, pinned)); deps.refresh(); },
    onChronicleEdit: async ({ id, text }) => { await deps.save(editSummary(deps.chronicle(), id, text)); deps.refresh(); },
    onChronicleCompress: async ({ ids }) => {
      const result = await compressSelected(api(deps.chatKey()), ids ?? []);
      deps.refresh();
      return result;
    },
    /** A chapter or arc unfolds into its parts; a scene gives its messages back to the model. */
    onChronicleUnfold: async ({ id }) => {
      const chronicle = deps.chronicle();
      const item = chronicle.summaries.find(summary => summary.id === id);
      if (!item) return false;
      if (item.level > 0 || item.childIds) {
        await deps.save(unfoldSummary(chronicle, id));
      } else {
        const count = sceneMessages(deps.chat(), id).length;
        const ok = await deps.confirm('Развернуть сцену', `Сводка удалится, и ${count} сообщений снова пойдут модели целиком. Летописец их больше не сожмёт. Продолжить?`);
        if (!ok) return false;
        releaseScene(deps.chat(), id);
        await deps.saveChat();
        await deps.save(removeScene(chronicle, id));
      }
      deps.refresh();
      return true;
    },
    /**
     * Delete a summary of any level. A scene (or everything under a chapter or arc) gives its messages back
     * to the model for good: they are marked «keep» and never summarized again.
     */
    onChronicleRemove: async ({ id }) => {
      const chronicle = deps.chronicle();
      const item = chronicle.summaries.find(summary => summary.id === id);
      if (!item) return false;
      const { chronicle: next, sceneIds } = removeSummary(chronicle, id);
      const count = messagesOfScenes(deps.chat(), sceneIds);
      const what = item.level === 0 && !item.childIds ? 'Сводка сцены' : `${item.level === 1 ? 'Глава' : 'Арка'} вместе с ${sceneIds.length} сценами`;
      const ok = await deps.confirm('Удалить сводку', `${what} удалится. ${count ? `${count} сообщений снова пойдут модели целиком и больше не сжимаются. ` : ''}Вернуть сводку можно будет только отменой в истории изменений вручную: она не восстанавливается.`);
      if (!ok) return false;
      for (const sceneId of sceneIds) releaseScene(deps.chat(), sceneId);
      await deps.saveChat();
      await deps.save(next);
      deps.refresh();
      return true;
    },
    /** All summaries whose text is a refusal or an API error, in one go. */
    onChronicleRemoveRefused: async () => {
      let chronicle = deps.chronicle();
      const ids = refusedSummaries(chronicle);
      if (!ids.length) return 0;
      const ok = await deps.confirm('Удалить отказы модели', `Сводок, в которых вместо пересказа ответ фильтра или ошибка: ${ids.length}. Они удалятся, а сообщения этих сцен снова пойдут модели целиком.`);
      if (!ok) return 0;
      let removed = 0;
      for (const id of ids) {
        if (!chronicle.summaries.some(summary => summary.id === id)) continue;
        const result = removeSummary(chronicle, id);
        for (const sceneId of result.sceneIds) releaseScene(deps.chat(), sceneId);
        chronicle = result.chronicle;
        removed += 1;
      }
      await deps.saveChat();
      await deps.save(chronicle);
      deps.refresh();
      return removed;
    },
    /** Rewrite a stale scene from its messages as they are now. */
    onChronicleRebuild: async ({ id }) => {
      const chat = deps.chat();
      const indices = sceneMessages(chat, id);
      if (!indices.length) throw new Error('Сообщения этой сцены не найдены');
      const chatKey = deps.chatKey();
      const raw = await withBusy('хроника: пересборка сцены…', () => deps.context().generateRaw({ prompt: buildSceneRequest(transcript(chat, indices), { persona: deps.persona() }), trimNames: false }));
      const text = parseSummaryText(raw);
      if (!text) {
        const said = String(typeof raw === 'string' ? raw : raw?.text ?? raw?.message ?? '').trim();
        throw looksRefused(said) ? new RefusedError(said) : new Error('Модель вернула пустую сводку');
      }
      if (deps.chatKey() !== chatKey) return false;
      await deps.save(rebuildScene(deps.chronicle(), id, { text, fingerprint: fingerprintTexts(indices.map(index => String(chat[index].mes))) }));
      deps.refresh();
      return true;
    },
  };

  return { run, onEdited, callbacks };
}
