/** The whole extension starts inside a stub SillyTavern: catches errors that only show at start-up (like a name used before it is declared). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body><div id="extensions_settings"></div><div id="extensions_settings2"></div><div id="top-settings-holder"><div id="persona-management-button"></div></div><div id="chat"></div><div id="form_sheld"><div id="send_form"></div></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document;
for (const name of Object.getOwnPropertyNames(dom.window)) { if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch {} } }
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
const noop = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : noop), apply: () => undefined });
const base = {
  extensionSettings: { disabledExtensions: [] }, chat: [], chatMetadata: {}, characters: [], groups: [], name1: 'User', name2: 'Bot',
  eventSource: { on() {}, once() {}, removeListener() {}, makeLast() {}, makeFirst() {} },
  eventTypes: new Proxy({}, { get: (t, k) => String(k) }),
  getCurrentChatId: () => 'chat1', saveSettingsDebounced() {}, setExtensionPrompt() {}, getRequestHeaders: () => ({}),
  mainApi: 'openai', getTokenCountAsync: async () => 0, getWorldInfoNames: () => [], powerUserSettings: { personas: {} },
  extensionPrompts: {}, saveChat: async () => {}, saveMetadata: async () => {},
};
const context = new Proxy(base, { get: (t, k) => (k in t ? t[k] : noop) });
globalThis.SillyTavern = { getContext: () => context };
test('init() starts without throwing and without console errors', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.map(item => item?.stack || String(item)).join(' ')); };
  try {
    const module = await import('../index.js');
    const controller = await module.init();
    assert.ok(controller, 'init returns the controller');
    assert.equal(await module.init(), controller, 'a second init reuses it');
  } finally { console.error = original; }
  assert.deepEqual(errors, [], errors.join(' | '));
});
