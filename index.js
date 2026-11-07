import {
  applyOperation,
  applyOperations,
  createDefaultState,
  createEntity,
  createOperation,
  distinctKey,
  duplicateCandidates,
  importState,
  matchEntity,
  mergeClashes,
  resolveEntityId,
  relationshipId,
  replayBase,
  rollbackMessage,
  addHeadcanons,
  dropAutoHeadcanons,
  headcanonKey,
  headcanonPairIds,
  isAutoHeadcanons,
  listHeadcanonPairs,
  remapAutoHeadcanons,
  selectHeadcanons,
  updateHeadcanons,
  selectRuntimePrompt,
  buildKnowledgePrompt,
  cleanSecretText,
  loreSecretEvent,
  secretEntriesOf,
  stripSecretEntries,
  presentIds,
  howKnows,
  isDead,
  dossier,
  pairKey,
  uniqueId,
  buildChroniclePrompt,
  chronicleConfig,
  normalizeChronicle,
} from './src/core/index.js';
import { analyzeHistoryBatch, analyzeKnowledge, analyzeMessage, discoverHistoryCharacters } from './src/integration/analyzer.js';
import { selectKnowledgeCandidates } from './src/integration/knowledge-analysis.js';
import { detectConflicts } from './src/integration/conflicts.js';
import { clearRelationshipPrompt, updateChroniclePrompt, updateKnowledgePrompt, updateRelationshipPrompt, updateScenePrompt } from './src/integration/prompt.js';
import { buildScenePrompt, looksFit, newlyDropped } from './src/integration/world-prompt.js';
import { createReminders, createWorldCallbacks } from './src/integration/world-actions.js';
import { linkedCards } from './src/integration/location-links.js';
import { linkedItems } from './src/integration/item-links.js';
import { dormantItemIds } from './src/integration/item-tidy.js';
import { aliasOperations, aliasesFromBooks } from './src/integration/name-sources.js';
import { createWardrobeCallbacks, createWardrobeStore } from './src/integration/wardrobe-actions.js';
import { createHoraeCallbacks } from './src/integration/horae-import.js';
import {
  LIBRARY_IMAGE_FOLDER, browseImageFolder, copyImageTo, deleteWardrobeImage, folderStorageStatus, isTreeImage, listInbox, moveTreeImage, prepareInbox,
  setImageFolder, storedImageForModel, treeDirOf, uploadToTree, uploadWardrobeImage,
} from './src/integration/wardrobe-images.js';
import { inboxDirectories, newTreeFiles, treeDirFor } from './src/integration/wardrobe-inbox.js';
import { countImages, moveImages } from './src/integration/image-move.js';
import { TEST_IMAGE, TEST_PROMPT, askAboutImage, listVisionChoices, visionSettings } from './src/integration/vision.js';
import { hideSummarized } from './src/integration/chronicle-run.js';
import { createChronicleRunner } from './src/integration/chronicle-actions.js';
import { getSettings } from './src/integration/settings.js';
import { createHistoryBatches, rebuildWithoutAutomaticHistory, historyFingerprint, sampleHistory } from './src/integration/history.js';
import { applyAnalysisResult, describeProposedChanges } from './src/integration/analysis-operations.js';
import { loadLinkedLore, loadGroupLore, generationBooks, analyzeLorebookCharacters, canonKeys, namesMatch } from './src/integration/lorebooks.js';
import { generateGrowthFactors, generatePairGoal, directionPresets, generateTriangleFactors, generateTriangleGoal, generateHeadcanons, matchingKeys } from './src/integration/growth.js';
import { pairTropeFactors, pairTropePace, pairTropes, triangleTropeFactors, triangleTropes, tropeLabel } from './src/integration/tropes.js';
import { getAnalysisTokenUsage } from './src/integration/analyzer.js';
import { onChangeBusy, getBusy, resetBusy, withBusy } from './src/integration/busy.js';
import { clearLog, formatLog, logEvent } from './src/integration/diagnostics.js';
import { AUX_PURPOSES, auxGenerate, fetchAuxModels, listAuxProfiles, routedContext } from './src/integration/llm.js';
import { triangleEdges } from './src/core/records.js';
import { mountExtensionShell, mountTopBarButton } from './src/integration/shell.js';
import { normalizeLayout, reopenOnLoad } from './src/ui/layout.js';
import { mountMessageButtons } from './src/integration/message-buttons.js';
import { mountChatOverlay } from './src/integration/chat-overlay.js';
import { scanAcquaintances } from './src/integration/acquaintance-scan.js';
import { scanLoreSecrets } from './src/integration/secret-scan.js';
import { mentionScorer, mentionedEntities, recentSceneText, semanticScorer } from './src/integration/headcanon-retrieval.js';
import { DEFAULT_LOCAL_MODEL, LOCAL_MODELS, cosine, embedTexts } from './src/integration/embeddings.js';
import { createChatStorage } from './src/integration/storage.js';
import { createLibraryCallbacks, createLocationLibraryStore, syncChat } from './src/integration/location-library-actions.js';
import { createRelationshipStudio } from './src/ui/studio.js';
import { createRelationshipWidget } from './src/ui/widget.js';

const MESSAGE_EXTRA_KEY = 'kulisyV1';
// Chats analysed by Relationship Engine keep its markers; the migrated state's
// operations point at them, so reconciliation must read them (never write them).
const LEGACY_MESSAGE_EXTRA_KEY = 'relationshipEngineV1';
function messageMarker(message) {
  return message?.extra?.[MESSAGE_EXTRA_KEY] ?? message?.extra?.[LEGACY_MESSAGE_EXTRA_KEY];
}
/** Plain on/off preferences edited as checkboxes in the Studio settings. */
const TOGGLE_SETTINGS = ['linkedScales', 'autoCharacterLines', 'confirmPersonaLines', 'sendMemories', 'sendTensions', 'sendFactors', 'sendHeadcanons', 'autoHeadcanons', 'trackKnowledge', 'trackWorld', 'sendScene', 'injectPrompt', 'confirmLargeChanges', 'knowledgeSeparateRequest', 'sendKnowledge', 'sceneChips'];
let controller = null;

function normalizeEmbeddings(config) {
  return {
    mode: ['off', 'local', 'api'].includes(config?.mode) ? config.mode : 'off',
    localModel: LOCAL_MODELS[config?.localModel] ? config.localModel : DEFAULT_LOCAL_MODEL,
    // q4 is gone: its files were bigger than q8, so old "q4" settings become q8.
    dtype: 'q8',
    format: config?.format === 'gemini' ? 'gemini' : 'openai',
    url: String(config?.url ?? '').trim().slice(0, 500),
    key: String(config?.key ?? '').trim().slice(0, 500),
    model: String(config?.model ?? '').trim().slice(0, 200),
    threshold: Math.max(0, Math.min(0.95, Number(config?.threshold) || 0)),
  };
}

function normalizeAux(aux) {
  const mode = ['off', 'profile', 'custom'].includes(aux?.mode) ? aux.mode : 'off';
  return {
    mode,
    profileId: String(aux?.profileId ?? '').slice(0, 200),
    url: String(aux?.url ?? '').trim().slice(0, 500),
    key: String(aux?.key ?? '').trim().slice(0, 500),
    model: String(aux?.model ?? '').trim().slice(0, 200),
    maxTokens: Math.max(256, Math.min(32000, Math.round(Number(aux?.maxTokens)) || 4096)),
    fallbackToMain: Boolean(aux?.fallbackToMain),
    purposes: Object.fromEntries(Object.keys(AUX_PURPOSES).map(key => [key, aux?.purposes?.[key] !== false])),
  };
}

/** SillyTavern popups render their text as HTML. */
const SLIP_LABELS = Object.freeze({ outfit: 'одежда', item: 'предмет', time: 'время', place: 'место', looks: 'внешность' });

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export async function init() {
  if (controller) return controller;
  const context = SillyTavern.getContext();
  const settings = getSettings(context);
  // State of the folder «Гардероб» (see refreshInbox); declared early: the snapshot reads it.
  let inboxInfo = { available: false, count: 0, reason: '' };
  let inboxPrepared = false;
  let inboxChecking = null;
  // Places kept across chats (folders like a gallery); see location-library-actions.js.
  // A change to the library or the wardrobe redraws the Studio once (after the current step),
  // so a saved card or place shows as saved, not as it was.
  let redrawSoon = false;
  const storeChanged = () => {
    if (redrawSoon) return;
    redrawSoon = true;
    queueMicrotask(() => { redrawSoon = false; try { notify(); } catch (error) { console.error('[Kulisy] Redraw after a store change failed.', error); } });
  };
  const locationLibrary = createLocationLibraryStore({ settings: () => settings, save: () => context.saveSettingsDebounced(), onChange: storeChanged });
  const wardrobeStore = createWardrobeStore({ settings: () => settings, save: () => context.saveSettingsDebounced(), onChange: storeChanged });
  // Corrections after a slip, sent with the next reply only.
  const reminders = createReminders();
  const storage = createChatStorage(() => SillyTavern.getContext(), createDefaultState, importState);
  const listeners = [];
  const subscribers = new Set();
  let state = storage.load();
  let studio;
  let widget;
  let unmountShell = () => {};
  let analysisQueue = Promise.resolve();
  let chatEpoch = 0;
  let historyQueued = false;
  const busy = getBusy();
  // How many answers in a row came back without the chronicler's part (see noteChronicler).
  // Declared up here: uiState() reads it, and the Studio asks for uiState() while init runs.
  const chroniclerHealth = { silent: 0, lastError: '', warned: false };
  const unsubscribeBusy = onChangeBusy(next => {
    Object.assign(busy, next);
    notify();
  });
  Object.assign(busy, getBusy());

  function uiState() {
    const persona = state.ui?.personaId && state.entities[state.ui.personaId] ? state.ui.personaId : '';
    const tavernList = tavernPersonas();
    const chatAvatar = personaAvatarForChat();
    const personaEntity = persona ? state.entities[persona] : null;
    const boundPersonaName = personaEntity?.name ?? '';
    const chatPersona = chatAvatar ? (tavernList.find(item => item.avatarId === chatAvatar)?.name ?? '') : '';
    return {
      ...state,
      headcanonPairs: listHeadcanonPairs(state),
      sceneHeadcanons: [...sceneHeadcanons],
      headcanonInfo: { ...headcanonInfo },
      pairs: Object.values(state.relationships).filter(relation => relation.from !== persona),
      widgetPairs: Object.values(state.relationships)
        .filter(relation => relation.from !== persona)
        .filter(relation => !(state.ui?.hiddenRelationshipIds ?? []).includes(relation.id)),
      personaId: persona,
      tavernPersonas: tavernList,
      chatPersonaName: chatPersona,
      personaBoundName: boundPersonaName,
      personaMismatch: Boolean(persona && chatPersona && boundPersonaName
        && boundPersonaName.toLocaleLowerCase('ru-RU') !== chatPersona.toLocaleLowerCase('ru-RU')),
      lorebooks: { available: SillyTavern.getContext().getWorldInfoNames?.() ?? [], selected: state.ui?.linkedLorebooks ?? [], cardWorlds: cardWorldNames(), status: 'Книги подключаются только к анализатору этого чата. Исходные файлы не изменяются.' },
      settings: {
        autoTrack: settings.autoAnalyze, widgetEnabled: settings.widget.visible,
        maxPromptCharacters: settings.maxPromptCharacters,
        headcanonLimit: settings.headcanonLimit,
        knowledgeCandidates: settings.knowledgeCandidates,
        knowledgePromptCharacters: settings.knowledgePromptCharacters,
        scenePromptCharacters: settings.scenePromptCharacters,
        looksCardCharacters: settings.looksCardCharacters,
        looksCharacterCharacters: settings.looksCharacterCharacters,
        itemsDormantAfter: settings.itemsDormantAfter ?? 40,
        imageStorage: settings.imageStorage === 'folder' ? 'folder' : 'server',
        largeChangeThreshold: settings.largeChangeThreshold,
        chronicle: structuredClone(settings.chronicle ?? {}),
        aux: structuredClone(settings.aux),
        embeddings: structuredClone(settings.embeddings),
        ...Object.fromEntries(TOGGLE_SETTINGS.map(key => [key, settings[key] !== false])),
      },
      widget: {
        expanded: settings.widget.expanded,
        position: { x: settings.widget.x, y: settings.widget.y },
      },
      promptPreview: buildInjectionText(state, persona) || 'Пока пусто: нет связей с ненулевыми показателями.',
      promptTokens,
      knowledgePreview: buildKnowledgeText(state) || '',
      leaks: openLeaks(),
      slips: openSlips(),
      dossiers: Object.fromEntries(Object.keys(state.entities).map(id => [id, dossier(state, id)])),
      knowledgeTokens,
      chronicleTokens,
      sceneTokens,
      scenePreview: buildSceneText(state) || '',
      locationLibrary: locationLibrary.get(),
      linkedLocationIds: [...linkedCards(state).keys()],
      linkedItemIds: [...linkedItems(state).keys()],
      chatKey: String(SillyTavern.getContext().getCurrentChatId?.() ?? ''),
      wardrobe: wardrobeStore.get(),
      inbox: { ...inboxInfo },
      looksFit: looksStatus(state),
      dormantItemIds: shadeItems(state),
      duplicates: duplicateCandidates(state).map(pair => ({ ...pair, fromName: state.entities[pair.fromId]?.name ?? '', intoName: state.entities[pair.intoId]?.name ?? '' })),
      scaleLabels: Object.fromEntries((state.config?.scales ?? []).map(scale => [scale.id, scale.label])),
      visionChoices: listVisionChoices(SillyTavern.getContext(), settings.wardrobeVision),
      analysisTokens: getAnalysisTokenUsage(),
      chroniclerSilent: chroniclerHealth.silent >= 2 ? { count: chroniclerHealth.silent, reason: chroniclerHealth.lastError } : null,
      modelBusy: busy.busy,
      modelBusyLabel: busy.label,
    };
  }

  function buildPromptPreview(persona) {
    if (!settings.enabled || !settings.injectPrompt) return 'Инъекция отключена настройками.';
    const text = buildInjectionText(state, persona);
    return text || 'Пока пусто: нет связей с ненулевыми показателями.';
  }

  const store = {
    getState: uiState,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
  };

  // Set once the chat overlay is mounted (end of init); a no-op before that.
  let refreshChatOverlay = () => {};

  function notify() {
    for (const subscriber of subscribers) {
      try { subscriber(uiState()); } catch (error) { console.error('[Kulisy] UI subscriber failed.', error); }
    }
    refreshChatOverlay();
    warnLooksRoom();
  }

  /**
   * A toast when wardrobe descriptions of someone on stage stop fitting the scene:
   * once, and again only after they fitted in between. Per chat; off in the settings.
   */
  let looksRoom = { chat: null, dropped: new Set() };
  function warnLooksRoom() {
    try {
      const chat = String(SillyTavern.getContext().getCurrentChatId?.() ?? '');
      if (looksRoom.chat !== chat) looksRoom = { chat, dropped: new Set() };
      const fit = looksStatus(state);
      const { dropped, fresh } = newlyDropped(looksRoom.dropped, fit);
      looksRoom.dropped = dropped;
      if (!fresh.length || settings.looksWarning === false) return;
      const names = fresh.map(id => state.entities[id]?.name ?? id).join(', ');
      const now = Number(settings.scenePromptCharacters) || 1500;
      const enough = fit.need ? `Хватит объёма сцены ${fit.need} (сейчас ${now}).` : `Даже 6000 мало (сейчас ${now}): сократите описания.`;
      globalThis.toastr?.warning?.(`Описания одежды не влезли в сцену: ${names}. Модель знает только, во что одеты. ${enough} Нажмите, чтобы поднять объём сцены.`, 'Кулисы', {
        timeOut: 12000,
        extendedTimeOut: 6000,
        onclick: () => { try { studio?.openSettings('scene', { focus: 'Объём сцены' }); } catch (error) { console.error('[Kulisy] Could not open the scene settings.', error); } },
      });
    } catch (error) {
      console.warn('[Kulisy] The scene-room check failed.', error);
    }
  }

  async function commit(next, immediate = true) {
    state = importState(next);
    try {
      await storage.save(state);
    } catch (error) {
      logEvent('error', 'Не удалось сохранить отношения в чат', error);
      throw error;
    }
    refreshPrompt();
    notify();
    return state;
  }

  let promptTokens = 0;
  let knowledgeTokens = 0;
  let chronicleTokens = 0;
  let sceneTokens = 0;

  function countTokens(text) {
    try {
      const ctx = SillyTavern.getContext();
      const tokenizer = ctx.getTokenCountAsync ? null : null;
      return ctx.getTokenCount?.(text) ?? Math.ceil(String(text).length / 3.5);
    } catch {
      return Math.ceil(String(text).length / 3.5);
    }
  }

  function buildInjectionText(targetState, persona) {
    if (!settings.enabled || !settings.injectPrompt) return '';
    // The budget is applied per section inside selectRuntimePrompt; slicing the finished
    // text used to drop every memory, tension and stranger rule at the end.
    return selectRuntimePrompt({ ...targetState, ui: { ...targetState.ui, personaId: persona } }, {
      memoryLimit: 2,
      tensionLimit: 2,
      includeMemories: settings.sendMemories !== false,
      includeTensions: settings.sendTensions !== false,
      includeFactors: settings.sendFactors !== false,
      maxCharacters: Number(settings.maxPromptCharacters) || 4000,
    }) + (settings.sendHeadcanons !== false && sceneHeadcanons.length ? `\n${sceneHeadcanons.join('\n')}` : '');
  }

  /**
   * Who knows what, for the coming reply: on stage, plus anyone the last two
   * messages mention (they are about to come on stage, or are talked about).
   */
  function buildKnowledgeText(targetState, chat = SillyTavern.getContext().chat) {
    if (!settings.enabled || settings.sendKnowledge === false) return '';
    const castIds = [...presentIds(targetState), ...mentionedEntities(targetState, recentSceneText(chat, 2, 3000))];
    return buildKnowledgePrompt(targetState, {
      castIds,
      maxCharacters: Math.max(300, Math.min(8000, Number(settings.knowledgePromptCharacters) || 2000)),
    });
  }

  function assertHeadcanonPair(key) {
    const ids = headcanonPairIds(key);
    if (ids.length < 2 || ids.some(id => !state.entities[id])) throw new Error('Персонаж не найден.');
  }

  function isAutoHeadcanonsFor(key) {
    return isAutoHeadcanons(state, key);
  }

  async function commitHeadcanons(headcanons) {
    const next = structuredClone(state);
    next.ui ??= {};
    next.ui.headcanons = headcanons;
    await commit(next, true);
    await prepareHeadcanons();
    refreshPrompt();
  }

  // Headcanons picked for the current scene; refreshed before every generation
  // (generate interceptor) and when the chat or the headcanons change.
  let sceneHeadcanons = [];
  // Why the preview shows what it shows: how many are on, how many fit the scene, how they were picked.
  let headcanonInfo = { enabled: 0, picked: 0, method: 'mentions', disabled: false };

  async function prepareHeadcanons(chat = SillyTavern.getContext().chat) {
    const enabled = listHeadcanonPairs(state).reduce((sum, pair) => sum + pair.enabledCount, 0);
    try {
      if (settings.sendHeadcanons === false || !enabled) {
        sceneHeadcanons = [];
        headcanonInfo = { enabled, picked: 0, method: 'mentions', disabled: settings.sendHeadcanons === false };
        return;
      }
      const sceneText = recentSceneText(chat);
      const { score, method, note } = await headcanonScorer(sceneText);
      sceneHeadcanons = selectHeadcanons(state, {
        score,
        limit: Math.max(1, Math.min(30, Number(settings.headcanonLimit) || 8)),
        maxCharacters: 1500,
      });
      headcanonInfo = { enabled, picked: sceneHeadcanons.length, method, disabled: false, ...(note ? { note } : {}) };
    } catch (error) {
      logEvent('error', 'Не удалось отобрать хедканоны для сцены', error);
      sceneHeadcanons = [];
      headcanonInfo = { enabled, picked: 0, method: 'mentions', disabled: false, error: error?.message ?? String(error) };
    }
  }

  const EMBEDDING_WAIT_MS = 8000;

  /**
   * Semantic ranking when embeddings are on; mentions otherwise. A slow first
   * model download must not hold the generation: after EMBEDDING_WAIT_MS this
   * generation falls back to mentions while the vectors keep loading.
   */
  async function headcanonScorer(sceneText) {
    const config = settings.embeddings ?? {};
    if (config.mode !== 'local' && config.mode !== 'api') return { score: mentionScorer(state, sceneText), method: 'mentions' };
    const items = listHeadcanonPairs(state).flatMap(pair => pair.items.filter(item => item.enabled !== false));
    const work = (async () => {
      const [sceneVector] = await embedTexts(config, [sceneText.slice(-1500) || ' '], 'query');
      const vectors = await embedTexts(config, items.map(item => item.text), 'passage');
      const byId = new Map(items.map((item, index) => [item.id, vectors[index]]));
      return item => (byId.has(item.id) ? cosine(sceneVector, byId.get(item.id)) : null);
    })();
    work.catch(error => logEvent('warn', 'Смысловой поиск хедканонов не сработал', error));
    try {
      const similarity = await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), EMBEDDING_WAIT_MS))]);
      return { score: semanticScorer(state, sceneText, similarity, Number(config.threshold) || 0), method: 'semantic' };
    } catch (error) {
      const note = error?.message === 'timeout'
        ? 'Модель эмбеддингов ещё загружается — на эту генерацию отбор по упоминаниям.'
        : `Смысловой поиск недоступен (${error?.message ?? error}) — отбор по упоминаниям.`;
      return { score: mentionScorer(state, sceneText), method: 'mentions', note };
    }
  }

  /**
   * Events the chronicler is shown for one reply. When there are more than fit,
   * embeddings (if on) rank them by meaning against the reply; otherwise secrets
   * first, then the newest. The model still decides who learned what — similar
   * words say nothing about whether a secret was told or kept.
   */
  async function knowledgeCandidates(sourceState, text) {
    const limit = Math.max(1, Math.min(40, Math.round(Number(settings.knowledgeCandidates)) || 15));
    const config = settings.embeddings ?? {};
    const events = (sourceState.knowledge?.events ?? []).filter(event => !event.disabled);
    let similarity = null;
    if ((config.mode === 'local' || config.mode === 'api') && events.length > limit) {
      const work = (async () => {
        const [query] = await embedTexts(config, [String(text).slice(-1500) || ' '], 'query');
        const vectors = await embedTexts(config, events.map(event => event.text), 'passage');
        return new Map(events.map((event, index) => [event.id, cosine(query, vectors[index])]));
      })();
      work.catch(error => logEvent('warn', 'Смысловой отбор событий для летописца не сработал', error));
      try {
        similarity = await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), EMBEDDING_WAIT_MS))]);
      } catch {
        similarity = null; // fall back to secrets-then-newest for this reply
      }
    }
    return selectKnowledgeCandidates(sourceState, text, { limit, similarity });
  }

  /** Time, place, and what the characters on stage wear, feel and hold, for the coming reply. */
  /** Ordinary things nobody mentioned for a while (item-tidy.js): kept, not sent. */
  function shadeItems(targetState) {
    try { return dormantItemIds(targetState, SillyTavern.getContext().chat, { after: settings.itemsDormantAfter ?? 40 }); }
    catch (error) { logEvent('warn', 'Не удалось отобрать давно забытые вещи', error); return []; }
  }

  function sceneOptions(targetState) {
    return {
      library: locationLibrary.get(),
      wardrobe: wardrobeStore.get(),
      skipItemIds: shadeItems(targetState),
      reminders: reminders.list(),
      maxCharacters: Math.max(300, Math.min(6000, Number(settings.scenePromptCharacters) || 1500)),
      looksLimits: { card: settings.looksCardCharacters, character: settings.looksCharacterCharacters },
    };
  }

  function buildSceneText(targetState) {
    if (!settings.enabled || settings.sendScene === false || settings.trackWorld === false) return '';
    return buildScenePrompt(targetState, sceneOptions(targetState));
  }

  /** Whether worn cards' descriptions reach the narrator (for the wardrobe and the dossier). */
  function looksStatus(targetState) {
    try {
      if (!settings.enabled || settings.sendScene === false || settings.trackWorld === false) return { off: true };
      return looksFit(targetState, sceneOptions(targetState));
    } catch (error) {
      logEvent('warn', 'Не удалось проверить, влезают ли описания одежды', error);
      return {};
    }
  }

  function chronicleState() {
    return normalizeChronicle(state.ui?.chronicle);
  }

  async function saveChronicle(next) {
    await commit({ ...state, ui: { ...state.ui, chronicle: next } }, true);
    return chronicleState();
  }

  function refreshPrompt() {
    const ctx = SillyTavern.getContext();
    // The chronicle has its own switch and its own place (before the chat history).
    const chronicleSettings = chronicleConfig(settings.chronicle);
    const chronicleBlock = settings.enabled && chronicleSettings.enabled
      ? buildChroniclePrompt(chronicleState(), { maxCharacters: chronicleSettings.maxPromptCharacters }) : '';
    chronicleTokens = chronicleBlock ? countTokens(chronicleBlock) : 0;
    updateChroniclePrompt(ctx, chronicleBlock);
    const sceneBlock = buildSceneText(state);
    sceneTokens = sceneBlock ? countTokens(sceneBlock) : 0;
    updateScenePrompt(ctx, sceneBlock);
    // Knowledge has its own switch, so it is sent even with the relationship block off.
    const knowledge = buildKnowledgeText(state);
    knowledgeTokens = knowledge ? countTokens(knowledge) : 0;
    updateKnowledgePrompt(ctx, knowledge);
    if (!settings.enabled || !settings.injectPrompt) {
      promptTokens = 0;
      updateRelationshipPrompt(ctx, '', false);
      notify();
      return;
    }
    const persona = state.ui?.personaId && state.entities[state.ui.personaId] ? state.ui.personaId : '';
    const text = buildInjectionText(state, persona);
    promptTokens = text ? countTokens(`[RELATIONSHIP ENGINE]\n${text}\n[/RELATIONSHIP ENGINE]`) : 0;
    updateRelationshipPrompt(ctx, text, Boolean(text));
    notify();
  }

  async function ensurePair(sourceId, targetId) {
    const id = relationshipId(sourceId, targetId);
    let next = state;
    if (!next.relationships[id]) {
      next = applyOperation(next, createOperation('relationship.upsert', { from: sourceId, to: targetId }, { id: uniqueId('relationship') }));
    }
    next = structuredClone(next);
    next.ui ??= {};
    next.ui.activeRelationshipId = id;
    await commit(next, true);
    studio?.selectPair(id);
    widget?.selectPair(id);
    return id;
  }

  async function addCharacter({ name, aliases = [] }) {
    const candidate = createEntity(name, { aliases });
    const existing = state.entities[candidate.id];
    const entity = createEntity(name, {
      id: candidate.id,
      aliases: [...(existing?.aliases ?? []), ...aliases],
      avatar: existing?.avatar,
      sourceId: existing?.sourceId,
    });
    await commit(applyOperation(state, createOperation('entity.upsert', entity, { id: uniqueId('entity-update') })), true);
  }

  /** Replace a character's aliases, keeping its ID, name, avatar and source. */
  async function setAliases({ characterId: id, aliases }) {
    const existing = state.entities[id];
    if (!existing) throw new Error('Персонаж не найден.');
    const entity = createEntity(existing.name, {
      id, aliases: (aliases ?? []).map(String).map(alias => alias.trim()).filter(alias => alias && alias.length <= 100).slice(0, 30),
      avatar: existing.avatar, sourceId: existing.sourceId,
    });
    await commit(applyOperation(state, createOperation('entity.upsert', entity, {
      id: uniqueId('entity-update'), reason: 'Псевдонимы персонажа', timestamp: new Date().toISOString(),
    })), true);
    await prepareHeadcanons();
    refreshPrompt();
  }

  function findTriangle(id) {
    const triangle = (state.ui?.triangles ?? []).find(item => item.id === id);
    if (!triangle) throw new Error('Треугольник не найден.');
    return triangle;
  }

  /** The triangle's tracked directed lines: both directions of its three edges, minus the persona's own. */
  function triangleLines(triangle) {
    const personaId = state.ui?.personaId || '';
    const name = id => state.entities[id]?.name ?? id;
    return triangleEdges(triangle.centerId, triangle.firstId, triangle.secondId)
      .flatMap(([a, b]) => [[a, b], [b, a]])
      .filter(([from]) => from !== personaId)
      .map(([from, to]) => ({ from, to, relationshipId: relationshipId(from, to), label: `${name(from)} → ${name(to)}` }));
  }

  function withLineIds(factors) {
    return factors.map(factor => ({ ...factor, relationshipId: relationshipId(factor.from, factor.to) }));
  }

  async function selectPair({ sourceId, targetId }) {
    if (!state.entities[sourceId] || !state.entities[targetId] || sourceId === targetId) return;
    await ensurePair(sourceId, targetId);
  }

  async function changeMetric({ sourceId, targetId, metric, value }) {
    const id = await ensurePair(sourceId, targetId);
    if (!state.config.scales.some(scale => scale.id === metric)) {
      throw new Error(`Неизвестная шкала: ${metric}`);
    }
    const next = applyOperation(state, createOperation('scale.set', {
      relationshipId: id, scaleId: metric, value: Number(value),
    }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение', timestamp: new Date().toISOString() }));
    await commit(next, true);
    return next;
  }

  async function addCollection(kind, payload) {
    if (Array.isArray(payload.participantIds)) {
      const knownBy = (payload.knownBy ?? payload.participantIds).filter(id => state.entities[id]);
      for (const id of payload.participantIds) if (!knownBy.includes(id)) knownBy.push(id);
      await commit(applyOperation(state, createOperation(kind === 'memory' ? 'memory.add' : 'tension.add', {
        shared: true, item: { id: uniqueId(kind), text: payload.text, participantIds: payload.participantIds, knownBy: [...new Set(knownBy)].sort(), intensity: payload.intensity, createdAt: new Date().toISOString() },
      }, { transactionId: uniqueId('manual'), reason: 'Ручная запись', timestamp: new Date().toISOString() })), true);
      return;
    }
    const id = await ensurePair(payload.sourceId, payload.targetId);
    const type = kind === 'memory' ? 'memory.add' : 'tension.add';
    await commit(applyOperation(state, createOperation(type, {
      relationshipId: id,
      item: { id: uniqueId(kind), text: payload.text, intensity: payload.intensity, createdAt: new Date().toISOString() },
    }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение', timestamp: new Date().toISOString() })), true);
  }

  async function importFromStudio({ data }) {
    const imported = importState(data?.state ?? data);
    const ctx = SillyTavern.getContext();
    const accepted = await ctx.Popup.show.confirm(
      'Импорт отношений',
      `<p>В файле персонажей: ${Object.keys(imported.entities ?? {}).length}, линий: ${Object.keys(imported.relationships ?? {}).length}.</p><p>Текущие отношения этого чата будут заменены. Продолжить?</p>`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return false;
    await commit(imported, true);
    return true;
  }

  function exportForStudio() {
    return { kind: 'sillytavern-kulisy', exportedAt: new Date().toISOString(), state };
  }

  async function changeSettings({ settings: patch }) {
    if (Object.hasOwn(patch, 'autoTrack')) settings.autoAnalyze = Boolean(patch.autoTrack);
    if (Object.hasOwn(patch, 'widgetEnabled')) settings.widget.visible = Boolean(patch.widgetEnabled);
    for (const key of TOGGLE_SETTINGS) if (Object.hasOwn(patch, key)) settings[key] = Boolean(patch[key]);
    if (Object.hasOwn(patch, 'maxPromptCharacters')) {
      const limit = Math.round(Number(patch.maxPromptCharacters));
      if (Number.isFinite(limit)) settings.maxPromptCharacters = Math.max(800, Math.min(20000, limit));
    }
    if (Object.hasOwn(patch, 'knowledgePromptCharacters')) {
      const limit = Math.round(Number(patch.knowledgePromptCharacters));
      if (Number.isFinite(limit)) settings.knowledgePromptCharacters = Math.max(300, Math.min(8000, limit));
    }
    if (Object.hasOwn(patch, 'knowledgeCandidates')) {
      const limit = Math.round(Number(patch.knowledgeCandidates));
      if (Number.isFinite(limit)) settings.knowledgeCandidates = Math.max(1, Math.min(40, limit));
    }
    if (Object.hasOwn(patch, 'headcanonLimit')) {
      const limit = Math.round(Number(patch.headcanonLimit));
      if (Number.isFinite(limit)) settings.headcanonLimit = Math.max(1, Math.min(30, limit));
    }
    for (const [key, min, max] of [['scenePromptCharacters', 300, 6000], ['largeChangeThreshold', 4, 25], ['itemsDormantAfter', 0, 500], ['looksCardCharacters', 80, 1000], ['looksCharacterCharacters', 200, 4000]]) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = Math.round(Number(patch[key]));
      if (Number.isFinite(value)) settings[key] = Math.max(min, Math.min(max, value));
    }
    if (Object.hasOwn(patch, 'imageStorage')) settings.imageStorage = patch.imageStorage === 'folder' ? 'folder' : 'server';
    if (patch.aux && typeof patch.aux === 'object') settings.aux = normalizeAux({ ...settings.aux, ...patch.aux });
    if (patch.wardrobeVision && typeof patch.wardrobeVision === 'object') settings.wardrobeVision = visionSettings({ ...settings.wardrobeVision, ...patch.wardrobeVision });
    if (patch.embeddings && typeof patch.embeddings === 'object') {
      settings.embeddings = normalizeEmbeddings({ ...settings.embeddings, ...patch.embeddings });
      prepareHeadcanons().then(refreshPrompt);
    }
    context.saveSettingsDebounced();
    widget.element.hidden = !settings.widget.visible;
    refreshPrompt();
    notify();
  }

  /** Lorebooks bound to the current card(s) in SillyTavern (card's "world"). */
  /** Lore about these characters from every book of the chat, for generation (factors, end points, headcanons). */
  function loreAbout(ids) {
    const ctx = SillyTavern.getContext();
    return loadGroupLore(ctx, state, ids, { books: generationBooks(ctx, state, cardWorldNames()), matchKeys: matchingKeys });
  }

  /** The persona's own lorebook (Persona Management → lorebook), or ''. */
  function personaBookName() {
    const ctx = SillyTavern.getContext();
    const name = ctx.powerUserSettings?.persona_description_lorebook;
    return name && (ctx.getWorldInfoNames?.() ?? []).includes(name) ? name : '';
  }

  /** Books a secret may come from: the chat's books plus the persona's. */
  function secretBooks() {
    const ctx = SillyTavern.getContext();
    const persona = personaBookName();
    return [...new Set([...generationBooks(ctx, state, cardWorldNames()), ...(persona ? [persona] : [])])];
  }

  /** Secret entries of the chat's books: { fresh: not in the journal yet, changed: [{ event, entry }] }. */
  async function loreSecrets(books = secretBooks()) {
    const ctx = SillyTavern.getContext();
    const fresh = [];
    const changed = [];
    for (const name of books) {
      let book;
      try { book = await ctx.loadWorldInfo(name); }
      catch (error) { console.warn(`[Kulisy] Lorebook «${name}» could not be read.`, error); continue; }
      for (const entry of secretEntriesOf(book, name)) {
        const event = loreSecretEvent(state, entry.book, entry.uid);
        if (!event) fresh.push(entry);
        else if ((event.detail ?? '') !== cleanSecretText(entry.content)) changed.push({ event, entry });
      }
    }
    return { fresh, changed };
  }

  /** New lorebook secrets → confirmed knowledge events; edited ones get their new text. */
  async function importLoreSecrets({ books } = {}) {
    if (isGenerationActive()) await waitForGenerationEnd();
    const ctx = SillyTavern.getContext();
    const { fresh, changed } = await loreSecrets(books);
    let next = state;
    const stamp = reason => ({ transactionId: uniqueId('manual'), reason, timestamp: new Date().toISOString() });
    for (const { event, entry } of changed) {
      next = applyOperation(next, createOperation('event.update', { eventId: event.id, changes: { detail: entry.content } }, stamp(`Секрет обновлён по лорбуку: ${event.text}`)));
    }
    let applied = 0;
    if (fresh.length) {
      const proposals = await scanLoreSecrets(routedContext(ctx, settings, 'discovery'), state, fresh, { personaBook: personaBookName() });
      const nameOf = id => escapeHtml(state.entities[id]?.name ?? id);
      const rows = proposals.map(item => `<li style="margin:6px 0"><b>${escapeHtml(item.label)}</b> <small>(«${escapeHtml(item.entry.title)}», ${escapeHtml(item.entry.book)})</small><br>Знают: ${item.knowIds.length ? item.knowIds.map(nameOf).join(', ') : 'никто'}${item.guessed ? ' <small>(по тексту записи)</small>' : ''}${item.missing.length ? `<br><small><b>Нет в списке персонажей:</b> ${item.missing.map(escapeHtml).join(', ')}</small>` : ''}${item.evidence ? `<br><small>«${escapeHtml(item.evidence)}»</small>` : ''}</li>`).join('');
      const accepted = await ctx.Popup.show.confirm('Секреты из лорбука',
        `<p>Найдено новых: ${proposals.length}. Записать? Пока секрет знает только тот, кто в списке, остальным модель его не покажет. Кто знает, потом можно поправить в «Знаниях».</p><ul style="text-align:left">${rows}</ul>`);
      if (accepted === ctx.POPUP_RESULT.AFFIRMATIVE) {
        for (const item of proposals) {
          next = applyOperation(next, createOperation('event.add', {
            item: {
              id: uniqueId('event'), text: item.label, witnessIds: item.knowIds, secret: true,
              lore: { book: item.entry.book, uid: item.entry.uid }, detail: item.entry.content, createdAt: new Date().toISOString(),
            },
          }, stamp(`Секрет из лорбука: ${item.label}`)));
          applied += 1;
        }
      }
    }
    if (next !== state) { await commit(next, true); refreshPrompt(); }
    return { applied, updated: changed.length, found: fresh.length };
  }

  /** On opening a chat: only tell about new secrets, never ask the model by itself. */
  async function remindLoreSecrets() {
    if (!settings.enabled || settings.trackKnowledge === false) return;
    const { fresh, changed } = await loreSecrets();
    if (changed.length) await importLoreSecrets().catch(error => logEvent('warn', 'Секреты из лорбука не обновились', error));
    if (fresh.length) {
      globalThis.toastr?.info?.(`Новых секретов в лорбуках: ${fresh.length}. Кулисы → Персонажи → «Секреты из лорбука».`, 'Кулисы', { timeOut: 10000 });
    }
  }

  function cardWorldNames() {
    const ctx = SillyTavern.getContext();
    let cards = [];
    if (ctx.groupId) {
      const group = (ctx.groups ?? []).find(item => String(item.id) === String(ctx.groupId));
      cards = (group?.members ?? []).map(avatar => (ctx.characters ?? []).find(character => character?.avatar === avatar)).filter(Boolean);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null && ctx.characters?.[ctx.characterId]) {
      cards = [ctx.characters[ctx.characterId]];
    }
    const available = new Set(ctx.getWorldInfoNames?.() ?? []);
    return [...new Set(cards.map(card => card?.data?.extensions?.world).filter(name => name && available.has(name)))];
  }

  /** Character card(s) of the current chat (or every group member) plus the user persona. */
  function cardContext(ctx, maxCharacters = 9000) {
    const substitute = value => {
      const text = String(value ?? '').trim();
      if (!text) return '';
      try { return typeof ctx.substituteParams === 'function' ? ctx.substituteParams(text) : text; }
      catch { return text; }
    };
    let cards = [];
    if (ctx.groupId) {
      const group = (ctx.groups ?? []).find(item => String(item.id) === String(ctx.groupId));
      cards = (group?.members ?? []).map(avatar => (ctx.characters ?? []).find(character => character?.avatar === avatar)).filter(Boolean);
    } else if (ctx.characterId !== undefined && ctx.characterId !== null) {
      const card = ctx.characters?.[ctx.characterId];
      if (card) cards = [card];
    }
    const parts = [];
    const perCard = cards.length ? Math.floor((maxCharacters - 1200) / cards.length) : 0;
    for (const card of cards) {
      const fields = [card.description ?? card.data?.description, card.personality ?? card.data?.personality, card.scenario ?? card.data?.scenario, card.first_mes ?? card.data?.first_mes]
        .map(substitute).filter(Boolean).join('\n');
      if (!fields) continue;
      parts.push(`### Карточка «${card.name}»\n${fields.length > perCard ? `${fields.slice(0, perCard)}…` : fields}`);
    }
    const personaName = String(ctx.name1 ?? '').trim();
    const personaDescription = substitute(ctx.powerUserSettings?.persona_description).slice(0, 1000);
    if (personaName) parts.push(`### Персона пользователя «${personaName}»\n${personaDescription || '(без описания)'}`);
    return parts.join('\n\n');
  }

  /** Find characters inside linked lorebooks, deduplicate against the registry, ask, add. */
  async function analyzeLorebooksForCharacters({ names } = {}) {
    if (isGenerationActive()) await waitForGenerationEnd();
    const ctx = SillyTavern.getContext();
    const books = names ?? (state.ui?.linkedLorebooks ?? []);
    if (!books.length) throw new Error('Нет подключённых лорбуков. Сначала подключите книгу на вкладке «Лорбуки».');
    const registryKeys = new Set();
    for (const entity of Object.values(state.entities)) {
      for (const value of [entity.name, ...(entity.aliases ?? [])]) {
        for (const key of canonKeys(value)) registryKeys.add(key);
      }
    }
    const found = [];
    const aliasUpdates = [];
    const seen = new Set();
    const knownEntities = Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases ?? [] }));
    for (const bookName of books) {
      const book = await ctx.loadWorldInfo(bookName);
      if (!book?.entries) throw new Error(`Не удалось прочитать лорбук «${bookName}».`);
      const { characters, knownAliases } = await analyzeLorebookCharacters(routedContext(ctx, settings, 'discovery'), book, bookName, knownEntities);
      for (const update of knownAliases) {
        const entity = state.entities[update.id];
        if (!entity) continue;
        const fresh = update.aliases.filter(alias => !namesMatch(alias, entity.name) && !(entity.aliases ?? []).some(existing => namesMatch(alias, existing)));
        if (!fresh.length) continue;
        const existingEntry = aliasUpdates.find(item => item.id === update.id);
        if (existingEntry) existingEntry.aliases = [...new Set([...existingEntry.aliases, ...fresh])];
        else aliasUpdates.push({ id: update.id, name: entity.name, aliases: [...fresh] });
      }
      for (const character of characters) {
        const candidateKeys = [...canonKeys(character.name), ...character.aliases.flatMap(alias => [...canonKeys(alias)])];
        if (candidateKeys.some(key => registryKeys.has(key))) continue;
        if (candidateKeys.some(key => seen.has(key))) continue;
        for (const key of candidateKeys) seen.add(key);
        found.push({ ...character, book: bookName });
      }
    }
    if (!found.length && !aliasUpdates.length) {
      globalThis.toastr?.info?.('Новые персонажи в лорбуках не найдены.', 'Кулисы');
      return { found: [], aliasUpdates: [] };
    }
    const newLines = found.map(character =>
      `• ${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}${character.note ? ` — ${character.note}` : ''}\n  из «${character.book}»`).join('\n');
    const aliasLines = aliasUpdates.map(update =>
      `• ${update.name} — распознан как уже существующий; будут добавлены псевдонимы: ${update.aliases.join(', ')}`).join('\n');
    const accepted = await ctx.Popup.show.confirm(
      'Персонажи в лорбуках',
      `${found.length ? `Новые персонажи:\n${newLines}\n\n` : ''}${aliasUpdates.length ? `Уже известные (добавятся псевдонимы для сцепки с лором):\n${aliasLines}\n\n` : ''}Применить?`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return { found: [], aliasUpdates: [] };
    let next = state;
    for (const character of found) {
      const entity = createEntity(character.name, { aliases: character.aliases });
      next = applyOperation(next, createOperation('entity.upsert', entity, {
        id: uniqueId('lore-character'), reason: `Персонаж из лорбука «${character.book}»`, timestamp: new Date().toISOString(),
      }));
    }
    for (const update of aliasUpdates) {
      const entity = next.entities[update.id];
      if (!entity) continue;
      const merged = createEntity(entity.name, {
        id: entity.id, aliases: [...new Set([...(entity.aliases ?? []), ...update.aliases])],
        avatar: entity.avatar, sourceId: entity.sourceId,
      });
      next = applyOperation(next, createOperation('entity.upsert', merged, {
        id: uniqueId('lore-alias'), reason: 'Псевдонимы из лорбука', timestamp: new Date().toISOString(),
      }));
    }
    await commit(next, true);
    globalThis.toastr?.success?.(`Добавлено персонажей: ${found.length}; обновлено псевдонимов: ${aliasUpdates.length}`, 'Кулисы');
    return { found, aliasUpdates };
  }

  async function analyzeWholeHistory({ onProgress = () => {} } = {}) {    const ctx = SillyTavern.getContext();
    const expectedChatId = ctx.getCurrentChatId();
    const expectedEpoch = chatEpoch;
    const messages = structuredClone(ctx.chat ?? []);
    const originalState = state;
    const originalFingerprint = historyFingerprint(messages);
    function assertCurrent() {
      const current = SillyTavern.getContext();
      if (expectedEpoch !== chatEpoch || current.getCurrentChatId() !== expectedChatId
        || state !== originalState || historyFingerprint(current.chat ?? []) !== originalFingerprint) {
        throw new Error('Чат или настройки отношений изменились во время анализа. Результат не сохранён; повторите запуск.');
      }
    }
    if (!messages.some(message => message?.mes?.trim())) throw new Error('В этом чате пока нет сообщений для анализа.');
    const batches = createHistoryBatches(messages, settings.analysisMaxCharacters);
    const maxBatches = 40;
    if (batches.length > maxBatches) throw new Error(`Чат слишком большой для безопасного анализа за один запуск: ${batches.length} пакетов. Максимум — ${maxBatches}.`);
    if (!batches.length) throw new Error('В чате нет сюжетных сообщений.');
    onProgress('Ищу персонажей в истории…');
    const knownEntities = Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases ?? [] }));
    const { characters: discovered, knownAliases } = await discoverHistoryCharacters(routedContext(ctx, settings, 'discovery'), sampleHistory(messages, settings.analysisMaxCharacters * 2), settings, knownEntities, cardContext(ctx));
    assertCurrent();
    // Registry-aware dedup: never re-add persons the model or transliteration already knows.
    const registryKeys = new Set();
    for (const entity of Object.values(state.entities)) {
      for (const value of [entity.name, ...(entity.aliases ?? [])]) {
        for (const key of canonKeys(value)) registryKeys.add(key);
      }
    }
    const freshCharacters = discovered.filter(character => {
      const candidateKeys = [...canonKeys(character.name), ...character.aliases.flatMap(alias => [...canonKeys(alias)])];
      return !candidateKeys.some(key => registryKeys.has(key));
    });
    const aliasUpdates = [];
    for (const update of knownAliases) {
      const entity = state.entities[update.id];
      if (!entity) continue;
      const fresh = update.aliases.filter(alias => !namesMatch(alias, entity.name) && !(entity.aliases ?? []).some(existing => namesMatch(alias, existing)));
      if (!fresh.length) continue;
      const existingEntry = aliasUpdates.find(item => item.id === update.id);
      if (existingEntry) existingEntry.aliases = [...new Set([...existingEntry.aliases, ...fresh])];
      else aliasUpdates.push({ id: update.id, name: entity.name, aliases: [...fresh] });
    }
    const newNames = freshCharacters.length
      ? freshCharacters.map(character => `• ${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}`).join('\n')
      : '';
    const aliasLines = aliasUpdates.length
      ? aliasUpdates.map(update => `• ${update.name} — уже в реестре; добавятся псевдонимы из чата: ${update.aliases.join(', ')}`).join('\n')
      : '';
    const names = newNames || aliasLines || 'Новых персонажей не найдено; будут использованы уже добавленные.';
    const accepted = await ctx.Popup.show.confirm(
      'Анализ истории чата',
      `${newNames ? `Новые персонажи в истории:\n${escapePopupText(newNames)}\n\n` : ''}${aliasLines ? `Уже известные (добавятся псевдонимы из чата):\n${escapePopupText(aliasLines)}\n\n` : ''}${!newNames && !aliasLines ? `${names}\n\n` : ''}Narrator добавлен не будет. Для истории потребуется ${batches.length} пакетных запросов к текущей модели. Прежние автоматические оценки будут заменены. Продолжить?`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) throw new Error('Анализ истории отменён пользователем.');
    assertCurrent();

    let next = rebuildWithoutAutomaticHistory(state);
    for (const update of aliasUpdates) {
      const entity = next.entities[update.id];
      if (!entity) continue;
      const merged = createEntity(entity.name, {
        id: entity.id, aliases: [...new Set([...(entity.aliases ?? []), ...update.aliases])],
        avatar: entity.avatar, sourceId: entity.sourceId,
      });
      next = applyOperation(next, createOperation('entity.upsert', merged, {
        id: uniqueId('history-alias'), reason: 'Псевдонимы из истории чата', timestamp: new Date().toISOString(),
      }));
    }
    for (const character of freshCharacters) {
      const entity = createEntity(character.name, { aliases: character.aliases });
      if (next.entities[entity.id]) continue;
      next = applyOperation(next, createOperation('entity.upsert', entity, {
        id: uniqueId('history-character'), reason: 'Персонаж найден в истории чата', timestamp: new Date().toISOString(),
      }));
    }
    if (Object.keys(next.entities).length < 2) throw new Error('Нужно как минимум два подтверждённых персонажа. Добавьте их вручную и повторите анализ.');
    const personaMatch = matchPersonaEntity(next);
    if (personaMatch && !next.ui?.personaId) {
      next.ui ??= {};
      next.ui.personaId = personaMatch.id;
    }
    onProgress('Читаю подходящие записи подключённых лорбуков…');
    const loreContext = await loadLinkedLore(ctx, next);
    assertCurrent();

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      assertCurrent();
      onProgress(`Анализирую историю: пакет ${batchIndex + 1} из ${batches.length}…`);
      const result = await analyzeHistoryBatch(routedContext(ctx, settings, 'analysis'), next, batches[batchIndex], settings, loreContext);
      assertCurrent();
      // History analysis is started by the user explicitly, so persona lines are not asked one by one;
      // only the "no automatic character lines" setting applies.
      next = applyAnalysisResult(next, result, { transactionId: 'history-import' }, [], {
        linkedScales: settings.linkedScales !== false,
        allowNewPair: (subjectId, objectId) => settings.autoCharacterLines !== false || objectId === (next.ui?.personaId || ''),
      }).state;
    }
    assertCurrent();
    next.ui ??= {};
    if (!next.relationships[next.ui.activeRelationshipId]) next.ui.activeRelationshipId = Object.keys(next.relationships)[0] || '';
    next.ui.historyImport = { fingerprint: originalFingerprint, messageCount: messages.length, createdAt: new Date().toISOString() };
    onProgress('Сохраняю найденные отношения…');
    for (const message of SillyTavern.getContext().chat ?? []) {
      if (message.is_user || message.is_system) continue;
      message.extra ??= {};
      message.extra[MESSAGE_EXTRA_KEY] = { fingerprint: fingerprint(message.mes), operationIds: [], historyImported: true };
    }
    await commit(next, true);
    onProgress(`Готово: обработано ${batches.length} пакетов истории.`);
  }

  function escapePopupText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function enqueueHistory(payload) {
    if (historyQueued) return Promise.reject(new Error('Анализ истории уже запущен. Дождитесь завершения.'));
    historyQueued = true;
    const expectedEpoch = chatEpoch;
    const job = analysisQueue.then(() => {
      if (expectedEpoch !== chatEpoch) throw new Error('Чат изменился до начала анализа. Повторите запуск.');
      return analyzeWholeHistory(payload);
    }).finally(() => { historyQueued = false; });
    analysisQueue = job.catch(() => {});
    return job;
  }

  function tavernPersonas() {
    const context = SillyTavern.getContext();
    const personas = context.powerUserSettings?.personas ?? {};
    const chatPersonaAvatar = context.chatMetadata?.persona ?? '';
    return Object.entries(personas)
      .map(([avatarId, name]) => ({ avatarId, name: String(name || '').trim() || avatarId }))
      .filter(persona => persona.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru-RU'))
      .map(persona => ({ ...persona, lockedToChat: persona.avatarId === chatPersonaAvatar }));
  }

  function personaAvatarForChat() {
    const context = SillyTavern.getContext();
    const chatAvatar = context.chatMetadata?.persona ?? '';
    if (chatAvatar && context.powerUserSettings?.personas?.[chatAvatar]) return chatAvatar;
    return context.powerUserSettings?.default_persona ?? '';
  }

  function matchPersonaEntity(targetState) {
    const context = SillyTavern.getContext();
    const avatar = personaAvatarForChat();
    const personaName = String((avatar && context.powerUserSettings?.personas?.[avatar]) || context.name1 || '').trim();
    if (!personaName) return null;
    const normalized = personaName.toLocaleLowerCase('ru-RU');
    return Object.values(targetState.entities).find(entity =>
      entity.name.toLocaleLowerCase('ru-RU') === normalized
      || (entity.aliases ?? []).some(alias => alias.toLocaleLowerCase('ru-RU') === normalized)) ?? null;
  }

  async function autoBindPersona(targetState, immediate = true) {
    const current = targetState.ui?.personaId;
    if (current && targetState.entities[current]) return targetState;
    const match = matchPersonaEntity(targetState);
    if (!match) return targetState;
    const next = structuredClone(targetState);
    next.ui ??= {};
    next.ui.personaId = match.id;
    await commit(next, immediate);
    return next;
  }

  async function setTavernPersona({ avatarId }) {
    const context = SillyTavern.getContext();
    const personas = context.powerUserSettings?.personas ?? {};
    if (avatarId && !personas[avatarId]) throw new Error('Персона не найдена в списке персон SillyTavern.');
    let next = state;
    let personaName = '';
    if (avatarId) {
      personaName = String(personas[avatarId] || '').trim();
      if (!personaName) throw new Error('У этой персоны не задано имя.');
      const normalized = personaName.toLocaleLowerCase('ru-RU');
      const existing = Object.values(next.entities).find(entity =>
        entity.name.toLocaleLowerCase('ru-RU') === normalized
        || (entity.aliases ?? []).some(alias => alias.toLocaleLowerCase('ru-RU') === normalized));
      if (!existing) {
        const entity = createEntity(personaName, { sourceId: avatarId });
        next = applyOperation(next, createOperation('entity.upsert', entity, {
          id: uniqueId('persona-entity'), reason: 'Персона SillyTavern', timestamp: new Date().toISOString(),
        }));
        next.ui ??= {};
        next.ui.personaId = entity.id;
      } else {
        next = structuredClone(next);
        next.ui ??= {};
        next.ui.personaId = existing.id;
      }
    } else {
      next = structuredClone(next);
      next.ui ??= {};
      next.ui.personaId = '';
    }
    await commit(next, true);
  }

  /** A hand edit of knowledge: journaled without a message, so swipes and re-checks leave it alone. */
  async function manualKnowledge(type, payload, reason) {
    await commit(applyOperation(state, createOperation(type, payload, {
      transactionId: uniqueId('manual'), reason, timestamp: new Date().toISOString(),
    })), true);
  }

  function requireCharacter(id) {
    if (!state.entities[id]) throw new Error('Персонаж не найден.');
  }

  function requireEvent(id) {
    const event = (state.knowledge?.events ?? []).find(item => item.id === id);
    if (!event) throw new Error('Событие не найдено.');
    return event;
  }

  /**
   * Leaks the chronicler flagged on replies, still open: the character still cannot
   * know the event (nobody told them since, it was not switched off). Newest first.
   */
  function openLeaks(chat = SillyTavern.getContext().chat ?? []) {
    const leaks = [];
    const lastIndex = chat.length - 1;
    chat.forEach((message, messageIndex) => {
      for (const leak of message?.extra?.[MESSAGE_EXTRA_KEY]?.leaks ?? []) {
        const event = (state.knowledge?.events ?? []).find(item => item.id === leak.eventId);
        if (!event || event.disabled || !state.entities[leak.entityId] || howKnows(state, leak.entityId, event)) continue;
        leaks.push({
          messageIndex, entityId: leak.entityId, eventId: leak.eventId, quote: leak.quote ?? '',
          name: state.entities[leak.entityId].name, eventText: event.text, canSwipe: messageIndex === lastIndex,
        });
      }
    });
    return leaks.reverse();
  }

  /** Deaths the chronicler proposed and nobody answered yet; newest first. */
  function openDeaths(chat = SillyTavern.getContext().chat ?? []) {
    const deaths = [];
    chat.forEach((message, messageIndex) => {
      for (const death of message?.extra?.[MESSAGE_EXTRA_KEY]?.deaths ?? []) {
        if (!state.entities[death.entityId] || isDead(state, death.entityId)) continue;
        deaths.push({ messageIndex, entityId: death.entityId, name: state.entities[death.entityId].name, note: death.note ?? '', quote: death.quote ?? '' });
      }
    });
    return deaths.reverse();
  }

  async function forgetDeath(messageIndex, entityId) {
    const ctx = SillyTavern.getContext();
    const marker = ctx.chat?.[messageIndex]?.extra?.[MESSAGE_EXTRA_KEY];
    if (!marker?.deaths) return;
    marker.deaths = marker.deaths.filter(death => death.entityId !== entityId);
    if (!marker.deaths.length) delete marker.deaths;
    await ctx.saveChat();
  }

  /** Continuity slips the scene chronicler flagged, newest first (dismissed ones are gone from the marker). */
  function openSlips(chat = SillyTavern.getContext().chat ?? []) {
    const slips = [];
    const lastIndex = chat.length - 1;
    chat.forEach((message, messageIndex) => {
      (message?.extra?.[MESSAGE_EXTRA_KEY]?.slips ?? []).forEach((slip, slipIndex) => {
        slips.push({ ...slip, messageIndex, slipIndex, label: SLIP_LABELS[slip.kind] ?? slip.kind, name: slip.entityId ? state.entities[slip.entityId]?.name ?? '' : '', canSwipe: messageIndex === lastIndex });
      });
    });
    return slips.reverse();
  }

  async function forgetLeak(messageIndex, entityId, eventId) {
    const ctx = SillyTavern.getContext();
    const marker = ctx.chat?.[messageIndex]?.extra?.[MESSAGE_EXTRA_KEY];
    if (!marker?.leaks) return;
    marker.leaks = marker.leaks.filter(leak => !(leak.entityId === entityId && leak.eventId === eventId));
    if (!marker.leaks.length) delete marker.leaks;
    await ctx.saveChat();
  }

  const knowledgeCallbacks = {
    /** Who already knows whom by the lore. Proposals are confirmed; hand-set pairs are never touched. */
    onScanAcquaintances: async () => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const ctx = SillyTavern.getContext();
      const loreContext = await loreAbout(Object.keys(state.entities));
      const proposals = await scanAcquaintances(routedContext(ctx, settings, 'discovery'), state, { loreContext, cardText: cardContext(ctx) });
      const fresh = proposals.filter(item => state.entities[item.firstId] && state.entities[item.secondId]
        && !state.knowledge?.acquaintances?.[pairKey(item.firstId, item.secondId)]);
      if (!fresh.length) {
        globalThis.toastr?.info?.('Новых знакомств в лоре не найдено.', 'Кулисы');
        return { applied: 0 };
      }
      const rows = fresh.map(item => `<li style="margin:4px 0"><b>${escapeHtml(state.entities[item.firstId].name)} и ${escapeHtml(state.entities[item.secondId].name)}</b> — ${item.status === 'known' ? 'знакомы' : 'встречались, имён не знают'}${item.evidence ? `<br><small>«${escapeHtml(item.evidence)}»</small>` : ''}</li>`).join('');
      const accepted = await ctx.Popup.show.confirm('Знакомства из лорбука',
        `<p>Найдено: ${fresh.length}. Записать? Любое можно потом поправить в досье персонажа.</p><ul style="text-align:left">${rows}</ul>`);
      if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return { applied: 0 };
      let next = state;
      for (const item of fresh) {
        next = applyOperation(next, createOperation('acquaintance.set', { firstId: item.firstId, secondId: item.secondId, status: item.status }, {
          transactionId: uniqueId('manual'), reason: `Знакомство по лорбуку${item.evidence ? `: «${item.evidence}»` : ''}`, timestamp: new Date().toISOString(),
        }));
      }
      await commit(next, true);
      return { applied: fresh.length };
    },
    onScanSecrets: () => importLoreSecrets(),
    onSetScene: async ({ presentIds: ids, location }) => {
      const payload = { presentIds: ids ?? presentIds(state) };
      if (location != null) payload.location = String(location);
      await manualKnowledge('scene.set', payload, 'Сцена поправлена вручную');
    },
    onTogglePresent: async ({ characterId: id, present }) => {
      requireCharacter(id);
      const ids = new Set(presentIds(state));
      if (present) ids.add(id); else ids.delete(id);
      await manualKnowledge('scene.set', { presentIds: [...ids] }, `${state.entities[id].name} ${present ? 'в сцене' : 'уходит со сцены'}`);
    },
    onAddEvent: async ({ text, witnessIds = [], secret = false, location }) => {
      const clean = String(text ?? '').trim();
      if (!clean) throw new Error('Опишите событие.');
      await manualKnowledge('event.add', {
        item: { id: uniqueId('event'), text: clean, witnessIds, ...(secret ? { secret: true } : {}), ...(location ? { location } : {}), createdAt: new Date().toISOString() },
      }, `Событие вручную: ${clean}`);
    },
    onUpdateEvent: async ({ eventId, changes }) => {
      requireEvent(eventId);
      await manualKnowledge('event.update', { eventId, changes }, 'Событие поправлено вручную');
    },
    onRemoveEvent: async ({ eventId }) => {
      const event = requireEvent(eventId);
      await manualKnowledge('event.remove', { eventId }, `Событие удалено: ${event.text}`);
    },
    onToggleKnowledge: async ({ kind, itemId, disabled }) => {
      await manualKnowledge('knowledge.toggle', { kind: kind === 'learned' ? 'learned' : 'event', itemId, disabled: Boolean(disabled) },
        disabled ? 'Выключено вручную' : 'Включено вручную');
    },
    onAddLearned: async ({ eventId, entityId, source = 'told', fromId }) => {
      const event = requireEvent(eventId);
      requireCharacter(entityId);
      if (howKnows(state, entityId, event)) throw new Error(`${state.entities[entityId].name} уже знает об этом.`);
      await manualKnowledge('learned.add', {
        item: { id: uniqueId('learned'), eventId, entityId, source: source === 'rumor' ? 'rumor' : 'told', ...(fromId ? { fromId } : {}) },
      }, `${state.entities[entityId].name} знает: ${event.text}`);
    },
    onRemoveLearned: async ({ learnedId }) => {
      await manualKnowledge('learned.remove', { learnedId }, 'Знание убрано вручную');
    },
    onSetAcquaintance: async ({ firstId, secondId, status }) => {
      requireCharacter(firstId);
      requireCharacter(secondId);
      await manualKnowledge('acquaintance.set', { firstId, secondId, status: status ?? null },
        `Знакомство: ${state.entities[firstId].name} и ${state.entities[secondId].name} — ${status ?? 'по канону'}`);
    },
    /** "He knows": the leak was fine after all — record how, drop the flag. */
    onLeakKnows: async ({ messageIndex, entityId, eventId, source = 'told' }) => {
      const event = requireEvent(eventId);
      requireCharacter(entityId);
      if (!howKnows(state, entityId, event)) {
        await manualKnowledge('learned.add', { item: { id: uniqueId('learned'), eventId, entityId, source: source === 'rumor' ? 'rumor' : 'told' } },
          `${state.entities[entityId].name} знает (отмечено на утечке): ${event.text}`);
      }
      await forgetLeak(messageIndex, entityId, eventId);
      notify();
    },
    /** By hand (dossier): not bound to a message, so no swipe takes it back. dead: false = alive again. */
    onSetDeath: async ({ entityId, dead = true, note = '' }) => {
      requireCharacter(entityId);
      const name = state.entities[entityId].name;
      await manualKnowledge('death.set', { entityId, dead: Boolean(dead), note }, dead ? `${name}: умер(ла)${note ? ` — ${note}` : ''}` : `${name}: снова жив(а)`);
      refreshPrompt();
      notify();
    },
    /** From the plaque: journaled with that message, so deleting or re-checking it takes the death back. */
    onDeathConfirm: async ({ messageIndex, entityId }) => {
      requireCharacter(entityId);
      const ctx = SillyTavern.getContext();
      const marker = ctx.chat?.[messageIndex]?.extra?.[MESSAGE_EXTRA_KEY];
      const proposal = marker?.deaths?.find(death => death.entityId === entityId);
      if (!marker || !proposal) throw new Error('Отметка уже снята.');
      const operation = createOperation('death.set', { entityId, dead: true, note: proposal.note ?? '' }, {
        transactionId: marker.transactionId ?? uniqueId('death'), messageId: String(messageIndex), messageIndex,
        id: uniqueId('analysis'), reason: `${state.entities[entityId].name}: умер(ла)${proposal.note ? ` — ${proposal.note}` : ''}`, timestamp: new Date().toISOString(),
      });
      marker.operationIds = [...(marker.operationIds ?? []), operation.id];
      await commit(applyOperation(state, operation), true);
      await forgetDeath(messageIndex, entityId);
      refreshPrompt();
      notify();
    },
    onDeathDismiss: async ({ messageIndex, entityId }) => {
      await forgetDeath(messageIndex, entityId);
      notify();
    },
    onLeakDismiss: async ({ messageIndex, entityId, eventId }) => {
      await forgetLeak(messageIndex, entityId, eventId);
      notify();
    },
    /** Only the last reply can be swiped in SillyTavern. */
    onLeakSwipe: async ({ messageIndex }) => {
      const ctx = SillyTavern.getContext();
      if (messageIndex !== (ctx.chat?.length ?? 0) - 1) throw new Error('Свайпнуть можно только последний ответ.');
      if (typeof ctx.swipe?.right !== 'function') throw new Error('Эта версия SillyTavern не даёт расширениям свайпать. Свайпните ответ вручную.');
      await ctx.swipe.right(null, { message: ctx.chat[messageIndex] });
    },
  };

  /** The picture model, with a time limit: a request that never comes back must not stall a whole batch. */
  const PICTURE_TIMEOUT_MS = 120_000;
  function askPicture(dataUrl, prompt) {
    return withBusy('Описываю картинку…', () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Модель для картинок не ответила за 2 минуты. Проверьте её в «Настройки → Модели и API → Картинки».')), PICTURE_TIMEOUT_MS);
      Promise.resolve()
        .then(() => askAboutImage(SillyTavern.getContext(), settings.wardrobeVision, dataUrl, prompt))
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    }));
  }

  const libraryCallbacks = createLibraryCallbacks({
    library: locationLibrary,
    getState: () => state,
    commitOperations: operations => commit(applyOperations(state, operations), true),
    confirm: async (title, text) => {
      const ctx = SillyTavern.getContext();
      return (await ctx.Popup.show.confirm(title, escapeHtml(text))) === ctx.POPUP_RESULT.AFFIRMATIVE;
    },
    listBooks: () => SillyTavern.getContext().getWorldInfoNames?.() ?? [],
    loadBook: async name => {
      const ctx = SillyTavern.getContext();
      if (!(ctx.getWorldInfoNames?.() ?? []).includes(name)) throw new Error('Лорбук не найден. Обновите список.');
      return ctx.loadWorldInfo(name);
    },
    notify: text => globalThis.toastr?.success?.(text, 'Кулисы'),
    // Pictures of places and things: the same server folder rules and the same picture model as the wardrobe.
    upload: (dataUrl, name) => uploadWardrobeImage(SillyTavern.getContext(), dataUrl, name, LIBRARY_IMAGE_FOLDER, settings.imageStorage),
    removeImage: path => deleteWardrobeImage(SillyTavern.getContext(), path),
    imageForModel: path => storedImageForModel(path),
    ask: (dataUrl, prompt) => askPicture(dataUrl, prompt),
    log: (level, text, error) => logEvent(level, text, error),
  });

  const worldCallbacks = createWorldCallbacks({
    getState: () => state,
    commitOperations: operations => commit(applyOperations(state, operations), true),
    replaceState: next => commit(next, true),
    chat: () => SillyTavern.getContext().chat,
    saveChat: () => SillyTavern.getContext().saveChat(),
    markerKey: MESSAGE_EXTRA_KEY,
    input: (title, text, value) => SillyTavern.getContext().Popup.show.input(escapeHtml(title), escapeHtml(text), value),
    swipe: messageIndex => knowledgeCallbacks.onLeakSwipe({ messageIndex }),
    editMessage: messageIndex => {
      const edit = document.querySelector(`#chat .mes[mesid="${Number(messageIndex)}"] .mes_edit`);
      if (!edit) throw new Error('Сообщение не найдено на экране: прокрутите к нему и нажмите «Изменить».');
      edit.click();
    },
    reminders,
    openStudio: (tab, options) => studio.show(tab, options),
    refresh: () => { refreshPrompt(); notify(); },
  });

  // The folder «Гардероб» (wardrobe-inbox.js): how many pictures wait there. Checked at start,
  // when the tab comes back into focus (after dropping files in Explorer) and after an import.
  function refreshInbox() {
    if (inboxChecking) return inboxChecking;
    inboxChecking = (async () => {
      let next = { available: false, count: 0, reason: '' };
      try {
        const plugin = await folderStorageStatus();
        if (!plugin.installed) next.reason = 'no-plugin';
        else if (!plugin.ready) next.reason = 'no-folder';
        else {
          if (!inboxPrepared) { await prepareInbox(SillyTavern.getContext(), inboxDirectories()); inboxPrepared = true; }
          next = { available: true, count: newTreeFiles(await listInbox(), wardrobeStore.get().cards).length, reason: '' };
        }
      } catch (error) {
        // A plugin older than 0.3.0 has no tree: the rest of the folder storage still works.
        next = { available: false, count: 0, reason: 'error' };
        logEvent('warn', 'Папку «Гардероб» не удалось проверить', error);
      }
      const changed = next.available !== inboxInfo.available || next.count !== inboxInfo.count || next.reason !== inboxInfo.reason;
      inboxInfo = next;
      if (changed) notify();
      return inboxInfo;
    })().finally(() => { inboxChecking = null; });
    return inboxChecking;
  }
  globalThis.addEventListener?.('focus', () => { refreshInbox().catch(() => {}); });
  refreshInbox().catch(() => {});

  const wardrobeCallbacks = createWardrobeCallbacks({
    store: wardrobeStore,
    getState: () => state,
    commitOperations: operations => commit(applyOperations(state, operations), true),
    confirm: async (title, text) => {
      const ctx = SillyTavern.getContext();
      return (await ctx.Popup.show.confirm(title, escapeHtml(text))) === ctx.POPUP_RESULT.AFFIRMATIVE;
    },
    // In the folder, a wardrobe picture goes into its section folder of «Гардероб», named after the card.
    upload: (dataUrl, name, card) => (settings.imageStorage === 'folder'
      ? uploadToTree(SillyTavern.getContext(), dataUrl, treeDirFor(card), card?.name || 'картинка')
      : uploadWardrobeImage(SillyTavern.getContext(), dataUrl, name)),
    relocate: (path, dir) => moveTreeImage(SillyTavern.getContext(), path, dir),
    isTreeImage,
    treeDirOf,
    inbox: { list: () => listInbox() },
    removeImage: path => deleteWardrobeImage(SillyTavern.getContext(), path),
    imageForModel: path => storedImageForModel(path),
    ask: (dataUrl, prompt) => askPicture(dataUrl, prompt),
    log: (level, text, error) => logEvent(level, text, error),
  });

  const horaeCallbacks = createHoraeCallbacks({
    getState: () => state,
    commitOperations: operations => commit(applyOperations(state, operations), true),
    chat: () => SillyTavern.getContext().chat,
    saveChat: () => SillyTavern.getContext().saveChat(),
    chronicle: chronicleState,
    saveChronicle,
    chronicleConfig: () => chronicleConfig(settings.chronicle),
    library: locationLibrary,
    createEntity: name => createEntity(name),
    // Same as SillyTavern's /unhide does to the row: the message is shown and sent again.
    markShown: index => document.querySelector(`#chat .mes[mesid="${Number(index)}"]`)?.setAttribute('is_system', 'false'),
    log: (level, text, error) => logEvent(level, text, error),
  });

  const chronicleRunner = createChronicleRunner({
    settings: () => settings,
    saveSettings: () => context.saveSettingsDebounced(),
    chronicle: chronicleState,
    save: saveChronicle,
    chat: () => SillyTavern.getContext().chat,
    saveChat: () => SillyTavern.getContext().saveChat(),
    context: () => routedContext(SillyTavern.getContext(), settings, 'analysis'),
    persona: () => state.entities[state.ui?.personaId]?.name ?? '',
    isGenerating: () => isGenerationActive(),
    waitForGeneration: () => waitForGenerationEnd(),
    chatKey: () => `${SillyTavern.getContext().getCurrentChatId()}:${chatEpoch}`,
    confirm: async (title, text) => {
      const ctx = SillyTavern.getContext();
      return (await ctx.Popup.show.confirm(title, escapeHtml(text))) === ctx.POPUP_RESULT.AFFIRMATIVE;
    },
    refresh: () => refreshPrompt(),
    notify: text => globalThis.toastr?.info?.(text, 'Кулисы'),
    log: (level, text, error) => logEvent(level, text, error),
  });

  /** Other names from the chat's lorebooks (name-sources.js): the entries about a character list their spellings. */
  let aliasRun = null;
  function enrichAliases() {
    if (aliasRun) return aliasRun;
    const epoch = chatEpoch;
    aliasRun = (async () => {
      try {
        const ctx = SillyTavern.getContext();
        const books = [];
        for (const name of generationBooks(ctx, state, cardWorldNames())) {
          try { books.push(await ctx.loadWorldInfo(name)); } catch (error) { logEvent('warn', `Лорбук «${name}» не прочитан для других имён`, error); }
        }
        if (epoch !== chatEpoch) return 0;
        const operations = aliasOperations(state, aliasesFromBooks(state, books));
        if (!operations.length) return 0;
        await commit(applyOperations(state, operations), true);
        logEvent('info', `Другие имена из лорбука: ${operations.map(operation => operation.payload.name).join(', ')}`);
        notify();
        return operations.length;
      } catch (error) {
        logEvent('warn', 'Другие имена из лорбука не добавились', error);
        return 0;
      } finally { aliasRun = null; }
    })();
    return aliasRun;
  }

  /** The user said these two are different people: never offered as twins again. */
  async function markDistinct(firstId, secondId) {
    const next = structuredClone(state);
    next.ui ??= {};
    next.ui.distinctPairs = [...new Set([...(next.ui.distinctPairs ?? []), distinctKey(firstId, secondId)])];
    await commit(next, true);
    notify();
  }

  /** Which spelling is the main one: the old name becomes another name. */
  async function setMainName(entityId, name) {
    const entity = state.entities[entityId];
    const value = String(name ?? '').trim();
    if (!entity || !value || value === entity.name) return false;
    const aliases = [entity.name, ...(entity.aliases ?? [])].filter(alias => alias.trim().toLowerCase() !== value.toLowerCase());
    const metadata = { transactionId: `manual:name:${Date.now().toString(36)}`, reason: `Главное имя: ${entity.name} → ${value}`, timestamp: new Date().toISOString() };
    await commit(applyOperations(state, [createOperation('entity.upsert', { ...entity, name: value, aliases }, metadata)]), true);
    refreshPrompt();
    notify();
    return true;
  }

  /** One character recorded twice: `fromId` goes into `intoId` (a manual change, its own transaction). */
  async function mergeCharacters(pairs, { ask = true } = {}) {
    const valid = (pairs ?? []).filter(pair => pair && state.entities[pair.fromId] && state.entities[pair.intoId] && pair.fromId !== pair.intoId);
    if (!valid.length) throw new Error('Нечего объединять.');
    const ctx = SillyTavern.getContext();
    const list = valid.map(pair => `<li>${escapeHtml(state.entities[pair.fromId].name)} → ${escapeHtml(state.entities[pair.intoId].name)}</li>`).join('');
    const clashes = mergeClashes(state, valid);
    const clashText = clashes.length
      ? `<p>Линии были у обоих — шкалы останутся как у второго (сумм не будет, ничего не съедет):</p><ul style="text-align:left;margin:0;padding-left:18px">${clashes.map(clash => `<li>${escapeHtml(clash.line)}: ${escapeHtml(clash.kept)}${clash.dropped ? ` <span style="opacity:.7">(у двойника было: ${escapeHtml(clash.dropped)})</span>` : ''}</li>`).join('')}</ul>`
      : '';
    if (ask) {
      const ok = await ctx.Popup.show.confirm('Объединить персонажей',
        `<ul style="text-align:left;margin:0;padding-left:18px">${list}</ul><p>Первое имя станет другим именем второго. Линии, воспоминания, знания, одежда и вещи перейдут к нему. Шкалы перенесённых линий не меняются.</p>${clashText}<p>Отменить можно в «Истории».</p>`);
      if (ok !== ctx.POPUP_RESULT.AFFIRMATIVE) return false;
    }
    const metadata = { transactionId: `manual:merge:${Date.now().toString(36)}`, reason: `Объединены: ${valid.map(pair => `${state.entities[pair.fromId].name} → ${state.entities[pair.intoId].name}`).join(', ')}`, timestamp: new Date().toISOString() };
    await commit(applyOperations(state, valid.map(pair => createOperation('entity.merge', pair, metadata))), true);
    refreshPrompt();
    notify();
    return true;
  }

  const callbacks = {
    onMergeCharacters: ({ pairs }) => mergeCharacters(pairs),
    onDistinctCharacters: ({ firstId, secondId }) => markDistinct(firstId, secondId),
    onSetMainName: ({ entityId, name }) => setMainName(entityId, name),
    onAliasesFromLore: () => enrichAliases(),
    ...knowledgeCallbacks,
    ...libraryCallbacks,
    ...chronicleRunner.callbacks,
    ...worldCallbacks,
    ...wardrobeCallbacks,
    onWardrobeImportInbox: async payload => {
      try { return await wardrobeCallbacks.onWardrobeImportInbox(payload); }
      finally { refreshInbox().catch(() => {}); }
    },
    ...horaeCallbacks,
    onSetTavernPersona: setTavernPersona,
    onAddTriangle: async ({ centerId, firstId, secondId, name }) => {
      const edges = triangleEdges(centerId, firstId, secondId);
      if ([centerId, firstId, secondId].some(id => !state.entities[id])) throw new Error('Персонаж не найден.');
      let next = state;
      for (const [from, to] of edges) for (const [a, b] of [[from, to], [to, from]]) {
        const id = relationshipId(a, b);
        if (!next.relationships[id]) next = applyOperation(next, createOperation('relationship.upsert', { from: a, to: b }, { id: uniqueId('relationship') }));
      }
      next = structuredClone(next);
      next.ui ??= {};
      next.ui.triangles ??= [];
      next.ui.triangles.push({ id: uniqueId('triangle'), name: name || 'Треугольник', centerId, firstId, secondId });
      await commit(next, true);
    },
    onRemoveTriangle: async ({ id }) => {
      const next = structuredClone(state);
      next.ui.triangles = (next.ui.triangles ?? []).filter(item => item.id !== id);
      await commit(next, true);
    },
    onSetTriangleGoal: async ({ id, goal }) => {
      const next = structuredClone(state);
      const triangle = (next.ui?.triangles ?? []).find(item => item.id === id);
      if (!triangle) throw new Error('Треугольник не найден.');
      const text = String(goal ?? '').trim().slice(0, 500);
      if (text) triangle.goal = text; else delete triangle.goal;
      await commit(next, true);
    },
    onGenerateTriangleGoal: async ({ id, wish }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const triangle = findTriangle(id);
      const loreContext = await loreAbout([triangle.centerId, triangle.firstId, triangle.secondId]);
      return generateTriangleGoal(routedContext(SillyTavern.getContext(), settings, 'generation'), state, triangle, { loreContext, wish });
    },
    onTriangleLines: ({ id }) => triangleLines(findTriangle(id)),
    onGenerateTriangleFactors: async ({ id, goal }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const triangle = findTriangle(id);
      const lines = triangleLines(triangle);
      const loreContext = await loreAbout([triangle.centerId, triangle.firstId, triangle.secondId]);
      const factors = await generateTriangleFactors(routedContext(SillyTavern.getContext(), settings, 'generation'), state, triangle, lines, { goal: goal ?? triangle.goal, loreContext });
      return withLineIds(factors);
    },
    onTriangleTropes: () => triangleTropes(),
    onTriangleTropeFactors: ({ id, tropeId }) => {
      const triangle = findTriangle(id);
      const result = triangleTropeFactors(tropeId, triangle, state.config.scales.map(scale => scale.id), state.ui?.personaId || '');
      return { goal: result.goal, factors: withLineIds(result.factors).map(factor => ({ ...factor, origin: `triangle-trope:${tropeId}` })) };
    },
    /** Saves the combined editor: every tracked line of the triangle gets exactly the listed factors
     * (and, when given, the listed pace). */
    onSetTriangleFactors: async ({ id, factors, paceByLine }) => {
      const triangle = findTriangle(id);
      let next = state;
      for (const line of triangleLines(triangle)) {
        if (!next.relationships[line.relationshipId]) {
          next = applyOperation(next, createOperation('relationship.upsert', { from: line.from, to: line.to }, { id: uniqueId('relationship') }));
        }
      }
      const meta = { transactionId: uniqueId('manual'), reason: `Факторы треугольника «${triangle.name}»`, timestamp: new Date().toISOString() };
      next = applyOperations(next, triangleLines(triangle).map(line => createOperation('factors.set', {
        relationshipId: line.relationshipId,
        factors: (factors ?? []).filter(factor => factor.relationshipId === line.relationshipId && String(factor.text ?? '').trim())
          .map(({ scaleId, direction, text, origin }) => ({ scaleId, direction, text, ...(origin ? { origin } : {}) })),
        ...(paceByLine && Object.hasOwn(paceByLine, line.relationshipId) ? { pace: paceByLine[line.relationshipId] } : {}),
      }, meta)));
      await commit(next, true);
    },
    onPairTropes: () => pairTropes(),
    /** origin marks a line's own trope; the triangle editor re-labels it as a triangle trope. */
    onPairTropeFactors: ({ tropeId }) => {
      const scaleIds = state.config.scales.map(scale => scale.id);
      return {
        factors: pairTropeFactors(tropeId, scaleIds).map(factor => ({ ...factor, origin: `pair-trope:${tropeId}` })),
        pace: pairTropePace(tropeId, scaleIds),
      };
    },
    onTropeLabel: ({ origin }) => tropeLabel(origin),
    onRefreshLorebooks: () => notify(),
    onLinkLorebook: async ({ name }) => {
      if (!(SillyTavern.getContext().getWorldInfoNames?.() ?? []).includes(name)) throw new Error('Лорбук не найден. Обновите список.');
      const next = structuredClone(state);
      next.ui ??= {};
      next.ui.linkedLorebooks = [...new Set([...(next.ui.linkedLorebooks ?? []), name])];
      await commit(next, true);
      // Offer character discovery right after linking, so the roster fills without manual work.
      // Secrets go after it: their knowers are found among the characters.
      analyzeLorebooksForCharacters({ names: [name] })
        .catch(error => console.error('[Kulisy] Lorebook character discovery failed.', error))
        .then(async () => {
          const { fresh } = await loreSecrets([name]);
          if (fresh.length) await importLoreSecrets({ books: [name] });
        })
        .catch(error => globalThis.toastr?.error?.(error.message, 'Кулисы'));
    },
    onUnlinkLorebook: async ({ name }) => {
      const next = structuredClone(state);
      next.ui ??= {};
      next.ui.linkedLorebooks = (next.ui.linkedLorebooks ?? []).filter(book => book !== name);
      await commit(next, true);
    },
    onAddCharacter: addCharacter,
    onSetAliases: setAliases,
    onSelectPair: selectPair,
    onSetFactors: async ({ sourceId, targetId, factors, pace, goal }) => {
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Линия не найдена.');
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors, ...(pace !== undefined ? { pace } : {}), ...(goal !== undefined ? { goal } : {}),
      }, { transactionId: uniqueId('manual'), reason: 'Ручное изменение факторов', timestamp: new Date().toISOString() })), true);
    },
    onGeneratePairGoal: async ({ sourceId, targetId, wish }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      if (!state.relationships[relationshipId(sourceId, targetId)]) throw new Error('Сначала создайте линию.');
      const loreContext = await loreAbout([sourceId, targetId]);
      return generatePairGoal(routedContext(SillyTavern.getContext(), settings, 'generation'), state, sourceId, targetId, { loreContext, wish });
    },
    onGenerateFactors: async ({ sourceId, targetId, directionId, customDirection, replace, goal }) => {
      if (isGenerationActive()) await waitForGenerationEnd();
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) throw new Error('Сначала создайте линию.');
      const loreContext = await loreAbout([sourceId, targetId]);
      const factors = await generateGrowthFactors(routedContext(SillyTavern.getContext(), settings, 'generation'), state, sourceId, targetId, {
        directionId, customDirection, loreContext, goal: goal ?? state.relationships[id].goal ?? '',
      });
      const merged = replace ? factors : [...(state.relationships[id].factors ?? []), ...factors];
      await commit(applyOperation(state, createOperation('factors.set', {
        relationshipId: id, factors: merged, ...(goal !== undefined ? { goal } : {}),
      }, { transactionId: uniqueId('manual'), reason: `Генерация факторов (${directionId})`, timestamp: new Date().toISOString() })), true);
      return factors;
    },
    onDirectionPresets: () => directionPresets(),
    onRemoveRecord: async ({ kind, shared, relationshipId, itemId }) => {
      const type = kind === 'tension' ? 'tension.remove' : 'memory.remove';
      await commit(applyOperation(state, createOperation(type, {
        shared: Boolean(shared), relationshipId, itemId,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление записи', timestamp: new Date().toISOString() })), true);
    },
    onUpdateRecord: async ({ kind, shared, relationshipId: pairRecordOwner, itemId, changes }) => {
      const meta = { transactionId: uniqueId('manual'), reason: 'Правка записи', timestamp: new Date().toISOString() };
      const key = kind === 'tension' ? 'tensions' : 'memories';
      if (shared) {
        await commit(applyOperation(state, createOperation('record.update', { kind, shared: true, itemId, changes }, meta)), true);
        return;
      }
      const relation = state.relationships[pairRecordOwner];
      const original = relation?.[key]?.find(item => item.id === itemId);
      if (!original) throw new Error('Запись не найдена.');
      const pairParticipants = [relation.from, relation.to].sort();
      const sameParticipants = !changes.participantIds
        || JSON.stringify([...changes.participantIds].sort()) === JSON.stringify(pairParticipants);
      if (sameParticipants && !changes.knownBy) {
        await commit(applyOperation(state, createOperation('record.update', { kind, relationshipId: pairRecordOwner, itemId, changes }, meta)), true);
        return;
      }
      // Old pair-bound records have fixed participants: editing them moves the record into shared ones.
      const participantIds = [...new Set(changes.participantIds ?? pairParticipants)].sort();
      const knownBy = [...new Set([...(changes.knownBy ?? participantIds), ...participantIds])].sort();
      const moved = {
        ...original,
        id: uniqueId(kind),
        text: String(changes.text ?? original.text).trim(),
        intensity: changes.intensity ?? original.intensity,
        participantIds,
        knownBy,
      };
      await commit(applyOperations(state, [
        createOperation(kind === 'tension' ? 'tension.remove' : 'memory.remove', { relationshipId: pairRecordOwner, itemId }, meta),
        createOperation(kind === 'tension' ? 'tension.add' : 'memory.add', { shared: true, item: moved }, meta),
      ]), true);
    },
    onToggleRecord: async ({ kind, shared, relationshipId, itemId, disabled }) => {
      await commit(applyOperation(state, createOperation('record.toggle', {
        kind, shared: Boolean(shared), relationshipId, itemId, disabled: Boolean(disabled),
      }, { transactionId: uniqueId('manual'), reason: disabled ? 'Запись отключена' : 'Запись включена', timestamp: new Date().toISOString() })), true);
    },
    onToggleWidgetPair: async ({ relationshipId }) => {
      const next = structuredClone(state);
      next.ui ??= {};
      const hidden = [...new Set([...(next.ui.hiddenRelationshipIds ?? [])])];
      const index = hidden.indexOf(relationshipId);
      if (index >= 0) hidden.splice(index, 1);
      else hidden.push(relationshipId);
      next.ui.hiddenRelationshipIds = hidden;
      await commit(next, true);
    },
    onRemovePair: async ({ sourceId, targetId }) => {      if (!state.entities[sourceId] || !state.entities[targetId]) throw new Error('Персонаж не найден.');
      const id = relationshipId(sourceId, targetId);
      if (!state.relationships[id]) return;
      const confirmed = await context.Popup.show.confirm(
        'Удалить линию отношений',
        `Линия «${escapeHtml(state.entities[sourceId].name)} → ${escapeHtml(state.entities[targetId].name)}» и её шкалы, воспоминания и напряжения будут удалены. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      await commit(applyOperation(state, createOperation('relationship.remove', {
        relationshipId: id, from: sourceId, to: targetId,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление линии', timestamp: new Date().toISOString() })), true);
    },
    onRemovePairsBulk: async ({ relationshipIds }) => {
      const lines = [...new Set(relationshipIds ?? [])].map(id => state.relationships[id]).filter(Boolean);
      if (!lines.length) return false;
      const nameOf = id => escapeHtml(state.entities[id]?.name ?? id);
      const items = lines.map(relation => `<li>${nameOf(relation.from)} → ${nameOf(relation.to)}</li>`).join('');
      const confirmed = await context.Popup.show.confirm(
        `Удалить линии: ${lines.length}`,
        `<ul style="text-align:left;margin:0;padding-left:18px">${items}</ul><p>Шкалы, воспоминания и напряжения этих линий будут удалены. Продолжить?</p>`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return false;
      const meta = { transactionId: uniqueId('manual'), reason: 'Ручное удаление линий', timestamp: new Date().toISOString() };
      await commit(applyOperations(state, lines.map(relation => createOperation('relationship.remove', {
        relationshipId: relation.id, from: relation.from, to: relation.to,
      }, meta))), true);
      return true;
    },
    onRemoveCharacter: async ({ characterId: id }) => {
      const entity = state.entities[id];
      if (!entity) throw new Error('Персонаж не найден.');
      if (state.ui?.personaId === id) throw new Error('Нельзя удалить привязанную персону. Сначала отвяжите её.');
      const relations = Object.values(state.relationships).filter(relation => relation.from === id || relation.to === id);
      const confirmed = await context.Popup.show.confirm(
        'Удалить персонажа',
        `«${entity.name}» будет удалён из реестра вместе с ${relations.length} линиями и упоминаниями из общих записей. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      await commit(applyOperation(state, createOperation('entity.remove', {
        entityId: id,
      }, { transactionId: uniqueId('manual'), reason: 'Ручное удаление персонажа', timestamp: new Date().toISOString() })), true);
    },
    onRemoveCharactersBulk: async ({ characterIds }) => {
      const ids = [...new Set((characterIds ?? []).filter(id => state.entities[id] && state.ui?.personaId !== id))];
      if (!ids.length) throw new Error('Не выбраны персонажи для удаления.');
      const names = ids.map(id => state.entities[id].name);
      const relationCount = Object.values(state.relationships)
        .filter(relation => ids.includes(relation.from) || ids.includes(relation.to)).length;
      const confirmed = await context.Popup.show.confirm(
        'Удалить выбранных персонажей',
        `Будут удалены: ${names.join(', ')}\n\nВместе с ними исчезнут ${relationCount} линий и упоминания из общих записей. Продолжить?`,
      );
      if (confirmed !== context.POPUP_RESULT.AFFIRMATIVE) return;
      let next = state;
      for (const id of ids) {
        next = applyOperation(next, createOperation('entity.remove', {
          entityId: id,
        }, { transactionId: uniqueId('manual'), reason: 'Массовое удаление персонажей', timestamp: new Date().toISOString() }));
      }
      await commit(next, true);
      globalThis.toastr?.success?.(`Удалено персонажей: ${ids.length}`, 'Кулисы');
    },
    onMetricChange: changeMetric,
    onAddMemory: payload => addCollection('memory', payload),
    onAddTension: payload => addCollection('tension', payload),
    onImport: importFromStudio,
    onExport: exportForStudio,
    onSettingsChange: changeSettings,
    onHeadcanonKey: ({ ids, firstId, secondId }) => headcanonKey(ids ?? [firstId, secondId]),
    onAutoHeadcanons: ({ key }) => isAutoHeadcanonsFor(key),
    onAddHeadcanons: async ({ key, texts }) => {
      assertHeadcanonPair(key);
      const { headcanons, added } = addHeadcanons(state, key, texts ?? [], { source: 'manual' });
      await commitHeadcanons(headcanons);
      return added;
    },
    onUpdateHeadcanon: async ({ key, id, text, enabled }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => {
        const item = entry.items.find(candidate => candidate.id === id);
        if (!item) throw new Error('Хедканон не найден.');
        if (text != null) {
          const value = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
          if (!value) throw new Error('Текст хедканона пуст.');
          item.text = value;
        }
        if (enabled != null) item.enabled = Boolean(enabled);
      }));
    },
    onRemoveHeadcanon: async ({ key, id }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => { entry.items = entry.items.filter(item => item.id !== id); }));
    },
    onSetHeadcanonAuto: async ({ key, auto }) => {
      assertHeadcanonPair(key);
      await commitHeadcanons(updateHeadcanons(state, key, entry => { entry.auto = Boolean(auto); }));
    },
    onGenerateHeadcanons: async ({ key }) => {
      assertHeadcanonPair(key);
      if (isGenerationActive()) await waitForGenerationEnd();
      const ids = headcanonPairIds(key);
      const loreContext = await loreAbout(ids);
      const existing = (state.ui?.headcanons?.[key]?.items ?? []).map(item => item.text);
      const texts = await generateHeadcanons(routedContext(SillyTavern.getContext(), settings, 'generation'), state, ids, { loreContext, existing });
      const { headcanons, added } = addHeadcanons(state, key, texts, { source: 'lore' });
      await commitHeadcanons(headcanons);
      return added;
    },
    onToggleStrangers: async ({ relationshipId: id, strangers }) => {
      const relation = state.relationships[id];
      if (!relation) throw new Error('Линия не найдена.');
      const key = [relation.from, relation.to].sort().join('|');
      const next = structuredClone(state);
      next.ui ??= {};
      const pairs = new Set(next.ui.strangerPairs ?? []);
      if (strangers) pairs.add(key); else pairs.delete(key);
      next.ui.strangerPairs = [...pairs];
      await commit(next, true);
    },
    onSetHiddenScales: async ({ relationshipId: id, hiddenScales }) => {
      if (!state.relationships[id]) throw new Error('Линия не найдена.');
      await commit(applyOperation(state, createOperation('scales.hide', { relationshipId: id, hiddenScales }, {
        transactionId: uniqueId('manual'), reason: 'Видимость шкал линии', timestamp: new Date().toISOString(),
      })), true);
    },
    onGetDiagnostics: () => formatLog({
      'Кулисы': 'журнал диагностики',
      'Браузер': globalThis.navigator?.userAgent ?? '?',
      'Экран': `${globalThis.innerWidth ?? '?'}×${globalThis.innerHeight ?? '?'}`,
      'Автоанализ': settings.autoAnalyze ? 'вкл' : 'выкл',
      'Инъекция': settings.enabled && settings.injectPrompt ? 'вкл' : 'выкл',
      // Never the key or the URL: only which mode is used.
      'Вспомогательный API': settings.aux?.mode === 'profile' ? 'профиль подключения' : settings.aux?.mode === 'custom' ? 'свой URL' : 'выкл',
      'Эмбеддинги': settings.embeddings?.mode === 'local' ? `локально (${settings.embeddings.localModel})` : settings.embeddings?.mode === 'api' ? `API (${settings.embeddings.format})` : 'выкл',
      'Персонажей / линий': `${Object.keys(state.entities).length} / ${Object.keys(state.relationships).length}`,
    }),
    onClearDiagnostics: () => { clearLog(); notify(); },
    onRefreshScene: async () => { await prepareHeadcanons(); refreshPrompt(); },
    onAuxProfiles: () => listAuxProfiles(SillyTavern.getContext()),
    onLocalEmbeddingModels: () => Object.entries(LOCAL_MODELS).map(([id, model]) => ({ id, label: model.label })),
    /** Embeds two short texts with the settings being edited; the first local run downloads the model. */
    onTestEmbeddings: async ({ embeddings }) => {
      const config = normalizeEmbeddings({ ...settings.embeddings, ...embeddings });
      if (config.mode === 'off') throw new Error('Смысловой поиск выключен.');
      const started = Date.now();
      // A close and a far pair: every model has its own scale, so the user sees where the threshold belongs.
      const [scene] = await embedTexts(config, ['Они вместе идут домой под дождём'], 'query');
      const [fact, far] = await embedTexts(config, ['Он всегда провожает её до дома', 'Цены на бензин снова выросли'], 'passage');
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      const near = cosine(scene, fact);
      const away = cosine(scene, far);
      logEvent('info', `Проверка эмбеддингов: ${scene.length} измерений за ${seconds} с, близкое ${near.toFixed(2)}, далёкое ${away.toFixed(2)}`);
      return `Работает: вектор из ${scene.length} чисел за ${seconds} с. Сходство близкого по смыслу ${near.toFixed(2)}, далёкого ${away.toFixed(2)}. Порог, если нужен, ставьте между ними.`;
    },
    onAuxPurposes: () => ({ ...AUX_PURPOSES }),
    /** Where pictures go and what the folder plugin says; never throws (a missing plugin is a normal answer). */
    onWardrobeInboxRefresh: () => refreshInbox(),
    onImageStorageStatus: async () => ({
      storage: settings.imageStorage === 'folder' ? 'folder' : 'server',
      plugin: await folderStorageStatus(),
      counts: countImages(wardrobeStore.get(), locationLibrary.get()),
    }),
    onSetImageFolder: async ({ folder }) => {
      const saved = await setImageFolder(SillyTavern.getContext(), folder);
      logEvent('info', saved ? 'Папка для картинок выбрана' : 'Папка для картинок забыта');
      inboxPrepared = false;
      refreshInbox().catch(() => {});
      if (!saved && settings.imageStorage === 'folder') await changeSettings({ settings: { imageStorage: 'server' } });
      return saved;
    },
    onBrowseImageFolder: () => browseImageFolder(SillyTavern.getContext()),
    /** Moves every picture into the chosen storage: copy, save the new paths, delete the old files. */
    onMoveImages: async ({ to }) => {
      if (to === 'folder') {
        const plugin = await folderStorageStatus();
        if (!plugin.installed) throw new Error('Плагин «kulisy-images» не найден — перенос в папку невозможен.');
        if (!plugin.ready) throw new Error(plugin.error || 'Папка для картинок не выбрана.');
      }
      const result = await withBusy('Переношу картинки…', () => moveImages(to, {
        getWardrobe: () => wardrobeStore.get(),
        setWardrobe: next => wardrobeStore.set(next),
        getLibrary: () => locationLibrary.get(),
        setLibrary: next => locationLibrary.set(next),
        copy: (path, storage, tree) => copyImageTo(SillyTavern.getContext(), path, storage, tree),
        remove: path => deleteWardrobeImage(SillyTavern.getContext(), path),
        log: (level, text, error) => logEvent(level, text, error),
      }));
      logEvent('info', `Перенос картинок (${to}): перенесено ${result.moved}, не вышло ${result.failed}, старых копий осталось ${result.leftovers}`);
      return result;
    },
    /** Does the chosen model see pictures? A red square, one word back. */
    onTestVision: async ({ vision }) => {
      const answer = await withBusy('Проверяю модель для картинок…', () => askAboutImage(SillyTavern.getContext(), vision ?? settings.wardrobeVision, TEST_IMAGE, TEST_PROMPT));
      const text = String(answer).trim().slice(0, 80);
      return /red|красн/i.test(text) ? `Модель видит картинки: «${text}»` : `Модель ответила «${text}» — похоже, картинку она не видит (ждали «red»).`;
    },
    onFetchAuxModels: ({ url, key }) => fetchAuxModels(SillyTavern.getContext(), url, key),
    /** A tiny request with the settings being edited (not yet saved). */
    onTestAux: async ({ aux }) => {
      const candidate = normalizeAux({ ...settings.aux, ...aux });
      if (candidate.mode === 'off') throw new Error('Вспомогательный API выключен.');
      const started = Date.now();
      const reply = await auxGenerate(SillyTavern.getContext(), candidate, [{ role: 'user', content: 'Reply with the single word OK.' }]);
      logEvent('info', `Проверка вспомогательного API: ответ за ${Date.now() - started} мс`);
      return `Ответ получен за ${((Date.now() - started) / 1000).toFixed(1)} с: «${String(reply).trim().slice(0, 60)}»`;
    },
    onAnalyzeCurrent: () => runManualCheck(lastBotMessageIndex()),
    onAnalyzeHistory: enqueueHistory,
    onAnalyzeLorebooks: analyzeLorebooksForCharacters,
  };

  studio = createRelationshipStudio({
    store, callbacks, open: false,
    layout: settings.studio,
    // Window/dock and the last tab are a preference, not chat data: extension settings.
    onLayoutChange(value) {
      settings.studio = normalizeLayout(value);
      context.saveSettingsDebounced();
    },
    directionPresets,
  });
  widget = createRelationshipWidget({
    store,
    expanded: settings.widget.expanded,
    position: { x: settings.widget.x ?? Math.max(8, window.innerWidth - 350), y: settings.widget.y ?? 96 },
    callbacks: {
      onOpenStudio: () => studio.open(),
      onAnalyzeLatest: () => runManualCheck(lastBotMessageIndex()),
      onPositionChange: ({ position }) => {
        settings.widget.x = position.x;
        settings.widget.y = position.y;
        context.saveSettingsDebounced();
      },
      onWidgetToggle: ({ expanded }) => {
        settings.widget.expanded = expanded;
        context.saveSettingsDebounced();
      },
    },
  });
  widget.element.hidden = !settings.widget.visible;

  function mountShell() {
    unmountShell();
    const conflicts = detectConflicts(SillyTavern.getContext());
    // The settings drawer is easy to miss; a double relationship prompt is not.
    const engine = conflicts.find(item => item.id === 'relationship-engine');
    if (engine) globalThis.toastr?.warning?.(engine.message, engine.title, { timeOut: 12000 });
    unmountShell = mountExtensionShell({
      settings,
      conflicts,
      onOpenStudio: () => studio.open(),
      onSettingsChanged: () => {
        context.saveSettingsDebounced();
        widget.element.hidden = !settings.widget.visible;
        refreshPrompt();
      },
    });
  }

  function listen(type, handler) {
    if (!type) return;
    context.eventSource.on(type, handler);
    listeners.push(() => context.eventSource.removeListener(type, handler));
  }

  function fingerprint(text) {
    let hash = 2166136261;
    for (const char of String(text)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  }

  /** SillyTavern marks active generation on body; never run analysis or forced saves in parallel with it. */
  function isGenerationActive() {
    return typeof document !== 'undefined' && document.body?.dataset?.generating === 'true';
  }

  // Watch the attribute instead of polling: phone browsers freeze timers in a
  // background tab, so a polling loop could time out while the screen was off.
  async function waitForGenerationEnd(timeoutMs = 600000) {
    if (!isGenerationActive()) return;
    logEvent('info', 'Жду окончания основной генерации перед анализом');
    await new Promise(resolve => {
      let timer = null;
      const observer = new MutationObserver(() => { if (!isGenerationActive()) done(); });
      function done() { clearTimeout(timer); observer.disconnect(); resolve(); }
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-generating'] });
      timer = setTimeout(done, timeoutMs);
    });
    if (isGenerationActive()) throw new Error('Основная генерация не завершилась вовремя; анализ отменён.');
  }

  function isPageHidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  /** Phones suspend network requests of hidden tabs; start analysis only when the user is back. */
  function waitUntilVisible() {
    if (!isPageHidden()) return Promise.resolve();
    logEvent('info', 'Вкладка скрыта — анализ отложен до возвращения в таверну');
    return new Promise(resolve => {
      const onVisible = () => {
        if (isPageHidden()) return;
        document.removeEventListener('visibilitychange', onVisible);
        resolve();
      };
      document.addEventListener('visibilitychange', onVisible);
    });
  }

  /** One retry when the request died because the tab was hidden mid-flight. */
  async function analyzeWithResume(ctx, sourceState, message, loreContext, options = {}) {
    let hiddenDuringRequest = false;
    const markHidden = () => { if (isPageHidden()) hiddenDuringRequest = true; };
    document.addEventListener('visibilitychange', markHidden);
    try {
      return await analyzeMessage(routedContext(ctx, settings, 'analysis'), sourceState, message, settings, loreContext, options);
    } catch (error) {
      if (!hiddenDuringRequest) throw error;
      logEvent('warn', 'Запрос анализа прервался, пока вкладка была скрыта — повторяю', error);
      await waitUntilVisible();
      return analyzeMessage(routedContext(ctx, settings, 'analysis'), sourceState, message, settings, loreContext, options);
    } finally {
      document.removeEventListener('visibilitychange', markHidden);
    }
  }

  /** Returns the operations to apply: all, only the small ones, or null when cancelled. */
  async function confirmLargeChanges(operations) {
    const isLarge = item => Math.abs(Number(item.delta)) >= settings.largeChangeThreshold;
    if (!settings.confirmLargeChanges || !operations.some(isLarge)) return operations;
    const smallOnly = operations.filter(item => !isLarge(item));
    const rows = describeProposedChanges(state, operations, settings.largeChangeThreshold).map(change => {
      const sign = change.delta > 0 ? '+' : '';
      const line = `${escapeHtml(change.from)} → ${escapeHtml(change.to)}: ${escapeHtml(change.scale)} ${sign}${change.delta}`;
      return `<li style="margin:4px 0">${change.large ? `<b>${line}</b>` : line}${change.reason ? `<br><small>${escapeHtml(change.reason)}</small>` : ''}</li>`;
    }).join('');
    const result = await context.Popup.show.confirm(
      'Скачок в отношениях',
      `<p>Анализатор предлагает крупное изменение (порог ${settings.largeChangeThreshold}). Крупные выделены:</p><ul style="text-align:left;margin:0;padding-left:18px">${rows}</ul><p>Воспоминания и напряжения из этого ответа сохранятся при любом выборе, кроме «Отменить».</p>`,
      {
        okButton: 'Применить всё',
        cancelButton: 'Отменить',
        customButtons: [{ text: 'Только мелкие', result: context.POPUP_RESULT.CUSTOM1, tooltip: 'Отбросить крупные изменения шкал, остальное применить' }],
      },
    );
    if (result === context.POPUP_RESULT.AFFIRMATIVE) return operations;
    if (result === context.POPUP_RESULT.CUSTOM1) return smallOnly;
    return null;
  }

  /** Ask the user about unregistered scene participants. Returns [] / accepted list, or null if analysis was cancelled. */
  async function confirmNewCharacters(characters, ctx) {
    if (!characters?.length) return [];
    // Popup text is HTML: names and notes come from the model and must be escaped.
    const lines = characters.map(character =>
      `<li>${escapeHtml(character.name)}${character.aliases.length ? ` (${escapeHtml(character.aliases.join(', '))})` : ''}${character.note ? ` — ${escapeHtml(character.note)}` : ''}</li>`).join('');
    const accepted = await ctx.Popup.show.confirm(
      'Новые персонажи в сцене',
      `<p>В этом ответе участвуют незарегистрированные персонажи:</p><ul style="text-align:left;margin:0;padding-left:18px">${lines}</ul><p>Добавить их и линии отношений с ними? Ответ «Нет» сохранит анализ только по известным персонажам.</p>`,
    );
    if (accepted !== ctx.POPUP_RESULT.AFFIRMATIVE) return [];
    return characters;
  }

  async function processMessage(messageIndex, force = false, expectedChatId, expectedEpoch = chatEpoch) {
    const ctx = SillyTavern.getContext();
    const sourceChatId = ctx.getCurrentChatId();
    const label = `Сообщение #${messageIndex}`;
    const skip = reason => { logEvent('info', `${label}: анализ пропущен — ${reason}`); return { applied: 0, skipped: reason }; };
    if ((expectedChatId != null && sourceChatId !== expectedChatId) || expectedEpoch !== chatEpoch) return skip('чат сменился до начала анализа');
    if (isGenerationActive()) await waitForGenerationEnd();
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId) return skip('чат сменился во время генерации');
    const message = ctx.chat?.[messageIndex];
    if (!settings.enabled) return skip('расширение выключено');
    if (!message || message.is_user || !message.mes?.trim()) return skip('нет ответа бота с текстом');
    if (messageMarker(message)?.historyImported) {
      if (force) throw new Error('Это сообщение уже учтено в общем анализе истории. Для пересчёта используйте «Проанализировать историю».');
      return skip('уже учтено в анализе истории');
    }
    const textHash = fingerprint(message.mes);
    if (!force && messageMarker(message)?.fingerprint === textHash) return skip('этот текст уже проанализирован');
    if (!force) await waitUntilVisible();
    // Analyse against the state WITHOUT this message's earlier result. A re-check
    // (swipe back, edit, manual) told "already recorded" about the very memories and
    // events it is about to roll back would leave them out, and they would be lost.
    const sourceState = state.operations.some(operation => operation.messageId === String(messageIndex))
      ? rollbackMessage(state, String(messageIndex)) : state;
    const loreContext = await loadLinkedLore(ctx, sourceState);
    if (expectedEpoch !== chatEpoch) return skip('чат сменился');
    logEvent('info', `${label}: анализ начат${force ? ' (вручную)' : ''}`);
    const headcanonKeys = autoHeadcanonKeys(sourceState, message.mes);
    const knowledge = settings.trackKnowledge !== false
      ? { candidates: await knowledgeCandidates(sourceState, message.mes) } : null;
    // The scene chronicler (time, place, clothes, things) travels with the knowledge one.
    const trackWorld = settings.trackWorld !== false;
    const separateChronicle = Boolean((knowledge || trackWorld) && settings.knowledgeSeparateRequest);
    const result = await analyzeWithResume(ctx, sourceState, message, loreContext,
      { headcanonPairs: headcanonKeys, knowledge: separateChronicle ? null : knowledge, world: !separateChronicle && trackWorld && { library: locationLibrary.get(), wardrobe: wardrobeStore.get(), skipItemIds: shadeItems(sourceState) } });
    if (!knowledge) result.knowledge = null;
    if (!trackWorld) result.world = null;
    const chroniclerExpected = Boolean(knowledge || trackWorld);
    if (separateChronicle) {
      try {
        const chronicle = await analyzeKnowledge(routedContext(ctx, settings, 'analysis'), sourceState, message, settings,
          knowledge?.candidates ?? [], { knowledge: Boolean(knowledge), world: trackWorld && { library: locationLibrary.get(), wardrobe: wardrobeStore.get(), skipItemIds: shadeItems(sourceState) } });
        result.knowledge = chronicle?.knowledge ?? null;
        result.world = chronicle?.world ?? null;
      } catch (error) {
        // Relationships of this reply still apply; only its chronicle is missing.
        logEvent('warn', `${label}: летописец не ответил — знания и сцена этого ответа не записаны`, error);
        result.knowledge = null;
        result.world = null;
      }
    }
    // Analysis yields relative deltas, so a newer state (a moved slider, a selected
    // pair) is fine to apply them to. Only a different chat or message text is stale.
    const isStale = () => expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== sourceChatId
      || fingerprint(SillyTavern.getContext().chat?.[messageIndex]?.mes) !== textHash;
    if (isStale()) return skip('чат или текст сообщения изменились, пока модель отвечала');
    if (chroniclerExpected) {
      const answered = (knowledge && result.knowledge) || (trackWorld && result.world);
      noteChronicler(Boolean(answered), answered ? '' : 'модель не вернула часть летописца (knowledge / world)');
      if (!answered) logEvent('warn', `${label}: летописец промолчал — в ответе модели нет знаний и сцены`);
    }
    const confirmedOperations = await confirmLargeChanges(result.operations);
    if (!confirmedOperations) return skip('скачок отклонён пользователем');
    if (confirmedOperations.length !== result.operations.length) logEvent('info', `${label}: крупные изменения отброшены, применяются только мелкие`);
    result.operations = confirmedOperations;
    if (isStale()) return skip('чат или текст сообщения изменились');
    // A "new" character the registry already has (another spelling, the name in parts, the same
    // sound) is not new: the name becomes their other name. A doubtful one is asked about once.
    const aliasAdds = new Map();
    const fresh = [];
    for (const character of result.newCharacters ?? []) {
      const match = [character.name, ...(character.aliases ?? [])].map(name => matchEntity(sourceState, name)).find(Boolean);
      if (match?.sure) { aliasAdds.set(match.id, [...(aliasAdds.get(match.id) ?? []), character.name, ...(character.aliases ?? [])]); continue; }
      if (match && match.ids.length === 1 && !(state.ui?.distinctPairs ?? []).some(key => key.includes(match.ids[0]))) {
        const known = sourceState.entities[match.ids[0]];
        const same = await ctx.Popup.show.confirm('Это тот же персонаж?',
          `<p>Модель называет «${escapeHtml(character.name)}». В Кулисах есть «${escapeHtml(known.name)}». Это один и тот же персонаж?</p><p>«Да» — имя станет его другим именем. «Нет» — будет новый персонаж.</p>`);
        if (same === ctx.POPUP_RESULT.AFFIRMATIVE) { aliasAdds.set(known.id, [...(aliasAdds.get(known.id) ?? []), character.name, ...(character.aliases ?? [])]); continue; }
      }
      fresh.push(character);
    }
    result.newCharacters = fresh;
    const acceptedNewCharacters = await confirmNewCharacters(result.newCharacters, ctx);
    if (acceptedNewCharacters === null) return skip('анализ отменён');
    if (isStale()) return skip('чат или текст сообщения изменились');
    const transactionId = `message:${messageIndex}:${textHash}`;
    let next = state.operations.some(operation => operation.messageId === String(messageIndex))
      ? rollbackMessage(state, String(messageIndex)) : state;
    // Re-analysis replaces this message's automatic headcanons too.
    next = withoutAutoHeadcanons(next, String(messageIndex));
    // Names that turned out to be known people: their other names now (manual, a swipe keeps them).
    if (aliasAdds.size) {
      next = applyOperations(next, aliasOperations(next, new Map([...aliasAdds].map(([id, names]) => [id, names.filter(name => name && !resolveEntityId(next, name))]))));
      logEvent('info', `${label}: узнаны под другим написанием — ${[...aliasAdds.keys()].map(id => next.entities[id]?.name).join(', ')}`);
    }
    const allowNewPair = await confirmNewPairs(next, result, acceptedNewCharacters);
    if (!allowNewPair) return skip('анализ отменён');
    if (isStale()) return skip('чат или текст сообщения изменились');
    const applied = applyAnalysisResult(next, result, { transactionId, messageId: String(messageIndex), messageIndex }, acceptedNewCharacters,
      { linkedScales: settings.linkedScales !== false, allowNewPair, headcanonKeys, trackKnowledge: Boolean(knowledge), trackWorld, library: locationLibrary.get(), wardrobe: wardrobeStore.get() });
    next = applied.state;
    const operations = applied.operations;
    const leaks = applied.leaks ?? [];
    const deaths = applied.deaths ?? [];
    const slips = applied.slips ?? [];
    for (const death of deaths) {
      logEvent('warn', `${label}: похоже, ${next.entities[death.entityId]?.name ?? death.entityId} умирает${death.note ? ` (${death.note})` : ''}${death.quote ? `: «${death.quote}»` : ''}`);
    }
    for (const slip of slips) {
      logEvent('warn', `${label}: возможный ляп (${SLIP_LABELS[slip.kind] ?? slip.kind})${slip.entityId ? ` — ${next.entities[slip.entityId]?.name ?? slip.entityId}` : ''}: «${slip.quote}»${slip.note ? ` (${slip.note})` : ''}`);
    }
    for (const leak of leaks) {
      logEvent('warn', `${label}: возможная утечка — ${next.entities[leak.entityId]?.name ?? leak.entityId} знает о «${next.knowledge?.events?.find(event => event.id === leak.eventId)?.text ?? leak.eventId}»${leak.quote ? `: «${leak.quote}»` : ''}`);
    }
    const headcanonIds = [];
    for (const { key, text } of applied.headcanons ?? []) {
      const added = addHeadcanons(next, key, [text], { source: 'auto', messageId: messageIndex });
      next = { ...next, ui: { ...next.ui, headcanons: added.headcanons } };
      headcanonIds.push(...added.ids);
    }
    if (!operations.length && !headcanonIds.length && !leaks.length && !deaths.length && !slips.length) return skip('модель не нашла изменений');
    message.extra ??= {};
    message.extra[MESSAGE_EXTRA_KEY] = {
      fingerprint: textHash,
      transactionId,
      operationIds: operations.map(operation => operation.id),
      ...(headcanonIds.length ? { headcanonIds } : {}),
      // Leaks are not journaled: they describe this text, and the badge reads them here.
      ...(leaks.length ? { leaks } : {}),
      // A death is only proposed: the plaque under the reply asks, the answer is journaled with this message.
      ...(deaths.length ? { deaths } : {}),
      // Continuity slips (clothes, things, time, place) of this text, for the plaque under it.
      ...(slips.length ? { slips } : {}),
      analyzedAt: new Date().toISOString(),
    };
    await commit(next, true);
    if (acceptedNewCharacters.length) enrichAliases();
    if (headcanonIds.length) { await prepareHeadcanons(); refreshPrompt(); }
    logEvent('info', `${label}: применено изменений — ${operations.length}${headcanonIds.length ? `, новых хедканонов — ${headcanonIds.length}` : ''}, состояние сохранено`);
    if (isGenerationActive()) await waitForGenerationEnd();
    await SillyTavern.getContext().saveChat();
    return { applied: operations.length + headcanonIds.length };
  }

  /** Pairs whose automatic headcanons the analyzer may extend: auto on, both members in the reply. */
  function autoHeadcanonKeys(targetState, text) {
    if (!settings.autoHeadcanons) return [];
    const present = [...mentionedEntities(targetState, text)];
    const keys = [];
    for (let left = 0; left < present.length; left += 1) {
      for (let right = left + 1; right < present.length; right += 1) {
        const key = headcanonKey(present[left], present[right]);
        if (isAutoHeadcanons(targetState, key)) keys.push(key);
      }
    }
    // Groups of three or more: when every member is in the reply.
    const here = new Set(present);
    for (const key of Object.keys(targetState.ui?.headcanons ?? {})) {
      const ids = headcanonPairIds(key);
      if (ids.length > 2 && ids.every(id => here.has(id)) && isAutoHeadcanons(targetState, key)) keys.push(key);
    }
    return keys.slice(0, 12);
  }

  function withoutAutoHeadcanons(targetState, messageId) {
    const { headcanons, dropped } = dropAutoHeadcanons(targetState, id => id === messageId);
    return dropped ? { ...targetState, ui: { ...targetState.ui, headcanons } } : targetState;
  }

  /**
   * #25: new lines between two characters can be switched off, new lines toward
   * the persona are confirmed. A dry run (applyAnalysisResult is pure) tells which
   * lines the result would create. Returns a predicate, or null when cancelled.
   */
  async function confirmNewPairs(baseState, result, acceptedNewCharacters) {
    const personaId = baseState.ui?.personaId || '';
    const allowCharacterLines = settings.autoCharacterLines !== false;
    const basePolicy = (subjectId, objectId) => allowCharacterLines || (personaId && objectId === personaId);
    const dryRun = applyAnalysisResult(baseState, result, {}, acceptedNewCharacters, { linkedScales: false, allowNewPair: basePolicy }).state;
    const created = Object.values(dryRun.relationships).filter(relation => !baseState.relationships[relation.id]);
    const personaLines = settings.confirmPersonaLines === false ? [] : created.filter(relation => personaId && relation.to === personaId);
    let rejected = new Set();
    if (personaLines.length) {
      // One checkbox per line (all checked): create only the ticked ones; "Без них" creates none.
      const nameOf = id => dryRun.entities[id]?.name ?? id;
      const ctx = SillyTavern.getContext();
      const inputs = personaLines.map((relation, index) => ({
        id: `kulisy-persona-line-${index}`,
        label: `${nameOf(relation.from)} → ${nameOf(relation.to)}`,
        defaultState: true,
      }));
      const popup = new ctx.Popup(
        '<h3>Новые линии с персоной</h3><p>Анализ хочет начать отслеживать чувства к персоне. Отметьте линии, которые нужно создать; анализ применится и без остальных.</p>',
        ctx.POPUP_TYPE.CONFIRM, null,
        { okButton: 'Создать отмеченные', cancelButton: 'Без них', customInputs: inputs },
      );
      const answer = await popup.show();
      rejected = new Set(personaLines
        .filter((relation, index) => answer !== ctx.POPUP_RESULT.AFFIRMATIVE || !popup.inputResults?.get(inputs[index].id))
        .map(relation => relation.id));
      if (rejected.size) logEvent('info', `Новые линии с персоной отклонены: ${rejected.size} из ${personaLines.length}`);
    }
    return (subjectId, objectId) => basePolicy(subjectId, objectId) && !rejected.has(relationshipId(subjectId, objectId));
  }

  function lastBotMessageIndex() {
    const chat = SillyTavern.getContext().chat ?? [];
    for (let index = chat.length - 1; index >= 0; index -= 1) {
      if (!chat[index]?.is_user && !chat[index]?.is_system && chat[index]?.mes?.trim()) return index;
    }
    return -1;
  }

  /** Manual check from a message button, the widget or the Studio, with a visible outcome. */
  async function runManualCheck(index) {
    const toast = globalThis.toastr;
    if (!Number.isInteger(index) || index < 0) {
      toast?.warning?.('В чате нет ответа бота для проверки.', 'Кулисы');
      return null;
    }
    toast?.info?.(`Проверяю ответ #${index}…`, 'Кулисы', { timeOut: 2500 });
    const result = await enqueueAnalysis(index, true);
    if (!result) return null; // the failure toast is shown by enqueueAnalysis
    if (result.applied) toast?.success?.(`Применено изменений: ${result.applied}. Подробности — во вкладке «История».`, 'Кулисы');
    else toast?.info?.(`Без изменений: ${result.skipped}.`, 'Кулисы');
    return result;
  }

  function enqueueAnalysis(messageIndex, force = false) {
    const queuedContext = SillyTavern.getContext();
    const expectedChatId = queuedContext.getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(() => processMessage(Number(messageIndex), force, expectedChatId, expectedEpoch)).catch(error => {
      logEvent('error', `Сообщение #${messageIndex}: анализ не удался`, error);
      globalThis.toastr?.error?.(error.message, 'Кулисы');
      noteChronicler(false, error?.message);
    });
    return analysisQueue;
  }

  /**
   * The chronicler can go quiet without an error: a weak model drops the "world" part,
   * or the request keeps failing. Two answers in a row like that and the user is told
   * once (a toast and a line on «Сейчас»), instead of clothes and time silently freezing.
   */
  function noteChronicler(ok, reason = '') {
    if (ok) {
      const wasSilent = chroniclerHealth.silent >= 2;
      Object.assign(chroniclerHealth, { silent: 0, lastError: '', warned: false });
      if (wasSilent) notify();
      return;
    }
    chroniclerHealth.silent += 1;
    chroniclerHealth.lastError = String(reason || '').slice(0, 200);
    if (chroniclerHealth.silent >= 2 && !chroniclerHealth.warned) {
      chroniclerHealth.warned = true;
      globalThis.toastr?.warning?.('Летописец молчит уже несколько ответов подряд: время, одежда и знания не обновляются. Подробности — в «Настройки → Диагностика».', 'Кулисы', { timeOut: 12000 });
    }
    notify();
  }

  async function reconcileMessageTransactions(expectedChatId, expectedEpoch) {
    const current = SillyTavern.getContext();
    if (expectedEpoch !== chatEpoch || current.getCurrentChatId() !== expectedChatId) return;
    const chat = current.chat ?? [];
    const liveOperations = new Map();
    const liveHeadcanons = new Map();
    chat.forEach((message, index) => {
      const marker = messageMarker(message);
      for (const operationId of marker?.operationIds ?? []) liveOperations.set(operationId, index);
      for (const headcanonId of marker?.headcanonIds ?? []) liveHeadcanons.set(headcanonId, index);
    });
    // Automatic headcanons follow their message to its new index, or leave with it.
    const remapped = remapAutoHeadcanons(state, id => liveHeadcanons.get(id) ?? null);
    const kept = state.operations
      .filter(operation => !operation.messageId || liveOperations.has(operation.id))
      .map(operation => {
        if (!operation.messageId) return operation;
        const index = liveOperations.get(operation.id);
        return { ...operation, messageId: String(index), messageIndex: index };
      });
    if (kept.length === state.operations.length
      && kept.every((operation, index) => operation.messageIndex === state.operations[index].messageIndex)) {
      if (remapped.changed) await commitHeadcanons(remapped.headcanons);
      return;
    }
    const ui = { ...structuredClone(state.ui ?? { activeRelationshipId: '' }), headcanons: remapped.headcanons };
    const next = applyOperations(replayBase(state, { ui }), kept);
    if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
    await commit(next, true);
    if (remapped.changed) { await prepareHeadcanons(); refreshPrompt(); }
  }

  const events = context.eventTypes ?? context.event_types;
  listen(events.CHAT_CHANGED, () => {
    chatEpoch += 1;
    state = storage.load();
    autoBindPersona(state).catch(error => console.error('[Kulisy] Persona auto-bind failed.', error));
    // Library places edited while this chat was closed: bring its cards up to date.
    try {
      const libraryOperations = syncChat(state, locationLibrary);
      if (libraryOperations.length) commit(applyOperations(state, libraryOperations), true).catch(error => logEvent('warn', 'Локации чата не обновились по библиотеке', error));
    } catch (error) {
      logEvent('warn', 'Локации чата не обновились по библиотеке', error);
    }
    sceneHeadcanons = [];
    refreshPrompt();
    notify();
    const epoch = chatEpoch;
    prepareHeadcanons().then(() => { if (epoch === chatEpoch) refreshPrompt(); });
    enrichAliases();
    remindLoreSecrets().catch(error => logEvent('warn', 'Секреты из лорбука не проверены', error));
  });
  // Lorebook secrets never reach SillyTavern's own world info: Kulisy sends them to who knows.
  listen(events.WORLDINFO_ENTRIES_LOADED, lists => {
    if (!settings.enabled || settings.trackKnowledge === false) return;
    try {
      const removed = stripSecretEntries(lists);
      if (removed) console.debug(`[Kulisy] Lorebook secrets kept out of world info: ${removed}`);
    } catch (error) {
      console.error('[Kulisy] Lorebook secrets could not be filtered.', error);
    }
  });
  listen(events.MESSAGE_RECEIVED, messageIndex => {
    // The corrections were for this reply: they are done.
    if (reminders.list().length) { reminders.clear(); refreshPrompt(); }
    if (settings.autoAnalyze) enqueueAnalysis(messageIndex);
    // The chronicle writes in the background, after the analysis of this reply is queued.
    if (settings.enabled && chronicleConfig(settings.chronicle).enabled) analysisQueue.then(() => chronicleRunner.run()).catch(() => {});
  });
  listen(events.MESSAGE_EDITED, messageIndex => {
    chronicleRunner.onEdited(messageIndex).catch(error => console.error('[Kulisy] Chronicle edit check failed.', error));
    const expectedChatId = SillyTavern.getContext().getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(async () => {
      if (expectedEpoch !== chatEpoch || SillyTavern.getContext().getCurrentChatId() !== expectedChatId) return;
      const hasOperations = state.operations.some(operation => operation.messageId === String(messageIndex));
      const withoutHeads = withoutAutoHeadcanons(hasOperations ? rollbackMessage(state, String(messageIndex)) : state, String(messageIndex));
      if (hasOperations || withoutHeads !== state) await commit(withoutHeads, true);
      if (settings.autoAnalyze) await processMessage(Number(messageIndex), true, expectedChatId, expectedEpoch);
    }).catch(error => console.error('[Kulisy] Edited message processing failed.', error));
  });
  listen(events.MESSAGE_SWIPED, messageIndex => {
    // A swipe often starts a new generation right after this event; wait for MESSAGE_RECEIVED
    // instead of racing the main generation with a background analysis.
    if (isGenerationActive()) return;
    if (settings.autoAnalyze) enqueueAnalysis(messageIndex, true);
  });
  listen(events.MESSAGE_DELETED, () => {
    const expectedChatId = SillyTavern.getContext().getCurrentChatId();
    const expectedEpoch = chatEpoch;
    analysisQueue = analysisQueue.then(() => reconcileMessageTransactions(expectedChatId, expectedEpoch))
      .catch(error => console.error('[Kulisy] Message reconciliation failed.', error));
  });

  const messageButtons = mountMessageButtons(index => { runManualCheck(index); });

  /** Chips: everyone on stage, plus whoever the last messages mention (likely to come on). */
  function overlayView() {
    const enabled = settings.enabled && settings.trackKnowledge !== false;
    const personaId = state.ui?.personaId || '';
    const here = new Set(presentIds(state));
    const nearby = mentionedEntities(state, recentSceneText(SillyTavern.getContext().chat, 3, 4000));
    const ids = [...new Set([...here, ...nearby])].filter(id => state.entities[id] && !isDead(state, id));
    return {
      chips: enabled && settings.sceneChips !== false,
      cast: ids.map(id => ({ id, name: state.entities[id].name, present: here.has(id), persona: id === personaId })),
      location: state.knowledge?.scene?.location ?? '',
      time: settings.trackWorld !== false ? (state.world?.clock?.time ?? '') : '',
      leaks: enabled ? openLeaks() : [],
      deaths: enabled ? openDeaths() : [],
      slips: settings.enabled && settings.trackWorld !== false ? openSlips() : [],
    };
  }

  const LEAK_ACTIONS = { swipe: 'onLeakSwipe', knows: 'onLeakKnows', dismiss: 'onLeakDismiss' };
  const chatOverlay = mountChatOverlay({
    onTogglePresent: (id, present) => knowledgeCallbacks.onTogglePresent({ characterId: id, present })
      .catch(error => globalThis.toastr?.error?.(error.message, 'Кулисы')),
    onLeak: (action, payload) => knowledgeCallbacks[LEAK_ACTIONS[action]]?.(payload)
      .catch(error => globalThis.toastr?.error?.(error.message, 'Кулисы')),
    onDeath: (action, payload) => knowledgeCallbacks[action === 'confirm' ? 'onDeathConfirm' : 'onDeathDismiss'](payload)
      .catch(error => globalThis.toastr?.error?.(error.message, 'Кулисы')),
    onSlip: (action, payload) => {
      const handler = { swipe: 'onSlipSwipe', edit: 'onSlipEdit', accept: 'onSlipAccept', dismiss: 'onSlipDismiss', remind: 'onSlipRemind' }[action];
      Promise.resolve().then(() => worldCallbacks[handler]?.(payload))
        .then(() => { if (action === 'remind') globalThis.toastr?.info?.('Поправка уйдёт со следующим ответом', 'Кулисы'); })
        .catch(error => globalThis.toastr?.error?.(error.message, 'Кулисы'));
    },
    onOpenStudio: tab => (tab ? studio.show(tab) : studio.open()),
  });
  refreshChatOverlay = () => chatOverlay.render(overlayView());
  for (const type of [events.CHARACTER_MESSAGE_RENDERED, events.MORE_MESSAGES_LOADED, events.CHAT_CHANGED, events.MESSAGE_SWIPED, events.MESSAGE_UPDATED, events.MESSAGE_DELETED]) {
    // After ST has drawn the messages: the notes attach to their blocks.
    if (type) listen(type, () => setTimeout(refreshChatOverlay, 0));
  }
  for (const type of [events.CHARACTER_MESSAGE_RENDERED, events.MORE_MESSAGES_LOADED, events.CHAT_CHANGED]) {
    if (type) listen(type, () => messageButtons.refresh());
  }

  mountShell();
  const topBar = mountTopBarButton({ onToggle: () => studio.toggle() });
  // The Studio can also open from the widget or the extensions menu: keep the icon in step.
  const syncTopBar = () => topBar.setOpen(studio.isOpen());
  studio.element.addEventListener('kulisy-studio:open', syncTopBar);
  studio.element.addEventListener('kulisy-studio:close', syncTopBar);
  refreshPrompt();
  notify();
  // The docked panel was open before the reload (F5 / Ctrl+F5): open it again.
  try {
    const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;
    if (reopenOnLoad(settings.studio, phone)) studio.open();
  } catch (error) { console.error('[Kulisy] Could not reopen the docked panel.', error); }

  controller = {
    open: () => studio.open(),
    analyzeCurrent: () => runManualCheck(lastBotMessageIndex()),
    getState: () => structuredClone(state),
    destroy() {
      listeners.splice(0).forEach(remove => remove());
      messageButtons.unmount();
      chatOverlay.unmount();
      unmountShell();
      topBar.unmount();
      studio.destroy();
      widget.destroy();
      clearRelationshipPrompt(SillyTavern.getContext());
      delete globalThis.kulisyInterceptor;
      delete globalThis.Kulisy;
      controller = null;
    },
  };
  globalThis.Kulisy = controller;
  // manifest.json → generate_interceptor: runs before SillyTavern assembles the prompt,
  // so headcanons are picked for the scene that is about to be written.
  globalThis.kulisyInterceptor = async (chat, contextSize, abort, type) => {
    if (type === 'quiet' || !controller) return;
    await prepareHeadcanons(chat);
    refreshPrompt();
    // Summarized messages leave SillyTavern's prompt copy; the chronicle block stands in for them.
    const chronicleSettings = chronicleConfig(settings.chronicle);
    if (settings.enabled && chronicleSettings.enabled && chronicleSettings.hideSummarized) {
      try { hideSummarized(chat, normalizeChronicle(state.ui?.chronicle)); }
      catch (error) { console.error('[Kulisy] Hiding summarized messages failed.', error); }
    }
  };
  return controller;
}

export function getController() {
  return controller;
}
