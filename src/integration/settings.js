export const MODULE_ID = 'kulisy';
const LEGACY_MODULE_ID = 'relationshipEngine';
export const METADATA_KEY = 'kulisy.v1';
/** Relationship Engine's chat key: read once as a starting point, never written. */
export const LEGACY_METADATA_KEY = 'relationshipEngine.v1';
export const PROMPT_KEY = 'kulisy-runtime';
/** The "who knows what" block has its own key: separate from feelings, separately switchable. */
export const KNOWLEDGE_PROMPT_KEY = 'kulisy-knowledge';
/** The chronicle (story so far) goes before the chat history, with its own key. */
export const CHRONICLE_PROMPT_KEY = 'kulisy-chronicle';
/** The scene block (time, place, clothes, things), next to the knowledge block. */
export const SCENE_PROMPT_KEY = 'kulisy-scene';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoAnalyze: false,
  injectPrompt: true,
  confirmLargeChanges: true,
  largeChangeThreshold: 12,
  linkedScales: true,
  autoCharacterLines: true,
  confirmPersonaLines: true,
  sendMemories: true,
  sendTensions: true,
  sendFactors: true,
  sendHeadcanons: true,
  autoHeadcanons: false,
  headcanonLimit: 8,
  maxPromptCharacters: 4000,
  analysisMaxCharacters: 12000,
  // The chronicler (knowledge-analysis.js): who is present, what happens, who learns what.
  trackKnowledge: true,
  // The scene chronicler (world-analysis.js): story time, places, clothes, things.
  trackWorld: true,
  // Send the narrator the scene block (world-prompt.js) and how big it may be.
  sendScene: true,
  scenePromptCharacters: 1500,
  // How much of each wardrobe card's description, and of all a character wears, goes into the scene.
  looksCardCharacters: 300,
  looksCharacterCharacters: 1200,
  // Weak models can stumble over one big JSON: then the chroniclers get its own request.
  knowledgeSeparateRequest: false,
  // How many not-yet-known events the chronicler is shown per reply.
  knowledgeCandidates: 15,
  // Send the model who is present, who does not know what, who has not met whom.
  sendKnowledge: true,
  knowledgePromptCharacters: 2000,
  // Places kept across chats, in folders (location-library.js). Not chat data.
  locationLibrary: { version: 1, folders: [], locations: [], items: [] },
  // Ordinary things nobody mentioned in this many messages go into the shade (item-tidy.js); 0 = never.
  itemsDormantAfter: 40,
  // Wardrobe cards and looks (core/wardrobe.js), kept across chats; pictures are files on the server.
  wardrobe: { version: 1, cards: [], looks: [] },
  // Where new pictures go: 'server' (user/images) or 'folder' (a folder on the computer, via the server plugin kulisy-images).
  imageStorage: 'server',
  // Which model describes wardrobe pictures (vision.js): main | profile | custom.
  wardrobeVision: { mode: 'main', profileId: '', url: '', key: '', model: '', maxTokens: 700 },
  // The chronicle (chronicle.js): summaries of scenes, chapters, arcs. Off until switched on.
  chronicle: {
    enabled: false,
    preset: 'balanced',
    sceneEvery: 15,
    chapterOf: 4,
    arcOf: 4,
    keepRecent: 20,
    hideSummarized: true,
    maxPromptCharacters: 6000,
  },
  // Chips above the message box: who is on stage.
  sceneChips: true,
  // Auxiliary model for the extension's own requests (see llm.js). The key of the
  // 'custom' mode is stored here, in SillyTavern's extension settings.
  aux: {
    mode: 'off',
    profileId: '',
    url: '',
    key: '',
    model: '',
    maxTokens: 4096,
    fallbackToMain: false,
    purposes: { analysis: true, discovery: true, generation: true },
  },
  // Semantic choice of headcanons (see embeddings.js); off = pick by mentions.
  embeddings: {
    mode: 'off',
    localModel: 'Xenova/multilingual-e5-small',
    dtype: 'q8',
    format: 'openai',
    url: '',
    key: '',
    model: '',
    threshold: 0,
  },
  // Studio window: 'window' (over the chat) or 'dock' (beside it), the last tab
  // and the docked panel's width in px.
  studio: {
    mode: 'window',
    tab: 'overview',
    width: 520,
    // Open when the page went away; only the docked panel reopens after a reload.
    open: false,
  },
  widget: {
    visible: true,
    expanded: false,
    x: null,
    y: 96,
    opacity: 0.96,
    showNumbers: true,
  },
});

export function getSettings(context) {
  const settingsRoot = context.extensionSettings;
  if (!settingsRoot[MODULE_ID]) {
    // First run: start from Relationship Engine's preferences (aux API, embeddings,
    // limits) when they exist, so moving over needs no re-setup. The engine's own
    // entry is copied, never changed.
    const legacy = settingsRoot[LEGACY_MODULE_ID];
    let start = structuredClone(DEFAULT_SETTINGS);
    if (isPlainObject(legacy)) {
      try { start = structuredClone(legacy); }
      catch (error) { console.warn('[Kulisy] Relationship Engine settings could not be copied.', error); }
    }
    settingsRoot[MODULE_ID] = start;
  }
  const settings = settingsRoot[MODULE_ID];
  mergeMissing(settings, DEFAULT_SETTINGS);
  // 2400 was the old built-in limit and was never editable, so it is never a user's choice.
  if (settings.maxPromptCharacters === 2400) settings.maxPromptCharacters = DEFAULT_SETTINGS.maxPromptCharacters;
  return settings;
}

export function mergeMissing(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = structuredClone(value);
    } else if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeMissing(target[key], value);
    }
  }
  return target;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
