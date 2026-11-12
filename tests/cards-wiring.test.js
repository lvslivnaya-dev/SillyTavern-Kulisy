/** The cards inside the whole extension (a stub SillyTavern): the narrator gets the sheet, the lorebook's copy of it does not go out. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings"></div><div id="extensions_settings2"></div><div id="top-settings-holder"><div id="persona-management-button"></div></div><div id="chat"></div><div id="form_sheld"><div id="send_form"></div></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
for (const name of Object.getOwnPropertyNames(dom.window)) { if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch {} } }
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { addFolder, addLibraryCharacter, applyOperations, createDefaultState, createOperation, emptyLibrary, updateLibraryCharacter } = await import('../src/core/index.js');
const { linkCards } = await import('../src/integration/card-links.js');

// The library with one card, the chat with it switched on and the character on stage.
const folder = addFolder(emptyLibrary(), { name: 'Бонтен' });
const made = addLibraryCharacter(folder.library, { folderId: folder.folder.id, name: 'Майки', aliases: ['Manjiro Sano'] });
const library = updateLibraryCharacter(made.library, made.character.id, {
  sections: made.character.sections.map(section => (section.title === 'Voice' ? { ...section, text: 'Говорит лениво и тихо.' } : section.title === 'Basic Info' ? { ...section, text: 'Лидер Бонтена.' } : section)),
});
let state = applyOperations(createDefaultState(), [
  createOperation('entity.upsert', { id: 'me', name: 'Иоко' }),
  createOperation('entity.upsert', { id: 'mikey', name: 'Майки' }),
  createOperation('scene.set', { presentIds: ['mikey'] }),
]);
state.ui = { ...state.ui, personaId: 'me' };
state = linkCards(state, library, [library.characters[0].id]).state;

const prompts = new Map();
const handlers = new Map();
const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => undefined });
const base = {
  extensionSettings: { disabledExtensions: [], kulisy: { locationLibrary: library } },
  chat: [], chatMetadata: { 'kulisy.v1': state }, characters: [], groups: [], name1: 'User', name2: 'Bot',
  eventSource: { on(name, handler) { handlers.set(name, handler); }, once() {}, removeListener() {}, makeLast() {}, makeFirst() {} },
  eventTypes: new Proxy({}, { get: (t, k) => String(k) }),
  getCurrentChatId: () => 'chat1', saveSettingsDebounced() {}, getRequestHeaders: () => ({}),
  setExtensionPrompt(key, value) { prompts.set(key, value); },
  mainApi: 'openai', getTokenCountAsync: async () => 0, getWorldInfoNames: () => [], powerUserSettings: { personas: {} },
  extensionPrompts: {}, saveChat: async () => {}, saveMetadata: async () => {},
};
const context = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
globalThis.SillyTavern = { getContext: () => context };

test('the sheet of an attached card goes to the narrator, and the lorebook\'s own sheet of the same person does not', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.map(item => item?.stack || String(item)).join(' ')); };
  try {
    const module = await import('../index.js');
    const controller = await module.init();
    assert.ok(controller);
    const sent = prompts.get('kulisy-cards') ?? '';
    assert.match(sent, /\[CHARACTER SHEETS/);
    assert.match(sent, /## Майки \/ Manjiro Sano\n### Basic Info\nЛидер Бонтена\.[\s\S]*### Voice\nГоворит лениво и тихо\./);
    assert.deepEqual(controller.getState().ui.cards, { [library.characters[0].id]: 'mikey' });

    // SillyTavern is about to scan the lorebooks: the card's character loses their sheet there, the rest stays.
    const entry = (comment, key) => ({ uid: comment, comment, key: [key], content: 'text' });
    const lists = { characterLore: [entry('[ Майки ] - Voice', 'майки'), entry('[ Санзу ] - Voice', 'санзу'), entry('Бонтен - Пентхаус', 'пентхаус')] };
    handlers.get('WORLDINFO_ENTRIES_LOADED')(lists);
    assert.deepEqual(lists.characterLore.map(item => item.comment), ['[ Санзу ] - Voice', 'Бонтен - Пентхаус']);
    controller.destroy();
    assert.equal(prompts.get('kulisy-cards'), '', 'switched off with the extension');
  } finally { console.error = original; }
  assert.deepEqual(errors, [], errors.join(' | '));
});
