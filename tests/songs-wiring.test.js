/** Songs inside the whole extension (a stub SillyTavern): a quoted song and a pinned one reach the narrator, switched off with the extension. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings"></div><div id="extensions_settings2"></div><div id="top-settings-holder"><div id="persona-management-button"></div></div><div id="chat"></div></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
for (const name of Object.getOwnPropertyNames(dom.window)) { if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch {} } }
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);

const { addSong, applyOperations, createDefaultState, createOperation, emptySongs } = await import('../src/core/index.js');

let songs = addSong(emptySongs(), {
  title: 'Ласточка', artist: 'Кино', mood: 'Светлая грусть.', sound: 'Медленная гитара, тихий голос.',
  lyrics: 'Ласточка моя, улетай за море\nТам, где нет зимы, там, где нет печали\nВетер унесёт нас обеих домой',
});
const lastSwallow = songs.song;
songs = addSong(songs.library, { title: 'Дождь', artist: 'Сплин', mood: 'Серо и уютно.', lyrics: 'Дождь стучит по крыше\nИ никто не слышит' });
const rain = songs.song;
const library = songs.library;

let state = applyOperations(createDefaultState(), [
  createOperation('entity.upsert', { id: 'me', name: 'Иоко' }),
  createOperation('entity.upsert', { id: 'anna', name: 'Анна' }),
  createOperation('scene.set', { presentIds: ['anna'] }),
]);
state.ui = { ...state.ui, personaId: 'me', songs: { playing: [{ songId: rain.id, mode: 'sung', singerId: 'anna' }], muted: [] } };

const prompts = new Map();
const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => undefined });
const base = {
  extensionSettings: { disabledExtensions: [], kulisy: { songLibrary: library } },
  chat: [
    { mes: 'Вечер.', is_user: false },
    { mes: 'Анна тихо пропела: «Там, где нет зимы, там, где нет печали…»', is_user: true },
  ],
  chatMetadata: { 'kulisy.v1': state }, characters: [], groups: [], name1: 'User', name2: 'Bot',
  eventSource: { on() {}, once() {}, removeListener() {}, makeLast() {}, makeFirst() {} },
  eventTypes: new Proxy({}, { get: (t, k) => String(k) }),
  getCurrentChatId: () => 'chat1', saveSettingsDebounced() {}, getRequestHeaders: () => ({}),
  setExtensionPrompt(key, value) { prompts.set(key, value); },
  mainApi: 'openai', getTokenCountAsync: async () => 0, getWorldInfoNames: () => [], powerUserSettings: { personas: {} },
  extensionPrompts: {}, saveChat: async () => {}, saveMetadata: async () => {},
};
const context = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
globalThis.SillyTavern = { getContext: () => context };

test('a quoted song and a pinned one reach the narrator, with the exact words and the singer', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.map(item => item?.stack || String(item)).join(' ')); };
  try {
    const module = await import('../index.js');
    const controller = await module.init();
    assert.ok(controller);
    const sent = prompts.get('kulisy-songs') ?? '';
    assert.match(sent, /\[SONGS — MUSIC IN THE SCENE\]/);
    // Quoted by her post: its sound, its words, the line where she stopped.
    assert.match(sent, /## «Ласточка» — Кино/);
    assert.match(sent, /Atmosphere: Светлая грусть\./);
    assert.match(sent, /Ветер унесёт нас обеих домой/);
    assert.match(sent, /Quoted so far: up to line 2 of 3/);
    // Pinned in the chat: nobody quoted it, but Анна sings it.
    assert.match(sent, /## «Дождь» — Сплин/);
    assert.match(sent, /Now: Анна is singing this song\./);
    assert.equal(lastSwallow.title, 'Ласточка');
    controller.destroy();
    assert.equal(prompts.get('kulisy-songs'), '', 'switched off with the extension');
  } finally { console.error = original; }
  assert.deepEqual(errors, [], errors.join(' | '));
});
