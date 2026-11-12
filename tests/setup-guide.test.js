/** The setup guide of a chat: the steps and their state, the page, the reminder above the message box. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SETUP_STEPS, setupProgress, setupReminderDue, setupSteps } from '../src/core/index.js';
import { NAV_TABS } from '../src/ui/layout.js';

const states = steps => Object.fromEntries(steps.map(step => [step.id, step.done]));

test('the steps follow the facts of the chat: two are required, the rest are for the better', () => {
  const fresh = setupSteps({ enabled: true, personaId: '', characters: 0, libraryCards: 0, cardsOn: 0, lorebooks: 0, hasPlace: false, auxMode: 'off' });
  assert.deepEqual(SETUP_STEPS.filter(step => step.required).map(step => step.id), ['persona', 'characters']);
  assert.deepEqual(states(fresh), { persona: false, characters: false, cards: false, lorebooks: false, place: false, analysis: false, prompt: null });
  const progress = setupProgress(fresh);
  assert.deepEqual([progress.done, progress.total, progress.missing], [0, 2, ['persona', 'characters']]);
  assert.equal(progress.optionalTotal, 4, 'the last step has nothing to tick, so it is not counted');

  const set = setupSteps({ enabled: true, personaId: 'me', characters: 3, libraryCards: 12, cardsOn: 2, lorebooks: 1, hasPlace: true, auxMode: 'profile' });
  assert.deepEqual(states(set), { persona: true, characters: true, cards: true, lorebooks: true, place: true, analysis: true, prompt: null });
  assert.deepEqual(setupProgress(set).missing, []);
  assert.match(set.find(step => step.id === 'cards').note, /В библиотеке карточек: 12, подключено здесь: 2/);
  assert.match(fresh.find(step => step.id === 'cards').note, /пока нет карточек/);
  for (const step of set) assert.ok(step.how.length >= 2 && step.what && step.title && step.tab, `${step.id} tells what to do`);
  assert.ok(set.every(step => NAV_TABS.some(([id]) => id === step.tab)), 'every «Открыть» leads to a page of the menu');
});

test('the reminder is due only while Kulisy is on, the setting is on, this chat did not switch it off and a required step is open', () => {
  const open = setupProgress(setupSteps({ personaId: '', characters: 0 }));
  const closed = setupProgress(setupSteps({ personaId: 'me', characters: 1 }));
  assert.equal(setupReminderDue({ enabled: true, remind: true, off: false }, open), true);
  assert.equal(setupReminderDue({ enabled: true, remind: true, off: false }, closed), false, 'all required steps are done');
  assert.equal(setupReminderDue({ enabled: false, remind: true, off: false }, open), false, 'Kulisy is switched off');
  assert.equal(setupReminderDue({ enabled: true, remind: false, off: false }, open), false, 'the setting');
  assert.equal(setupReminderDue({ enabled: true, remind: true, off: true }, open), false, 'switched off in this chat');
});

const dom = new JSDOM('<!doctype html><html><body><div id="form_sheld"><div id="send_form"><textarea id="send_textarea"></textarea></div></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { mountChatOverlay } = await import('../src/integration/chat-overlay.js');
const { createRelationshipStudio } = await import('../src/ui/studio.js');

test('the banner above the message box: a link to the guide, «Позже» hides it for now, «Не напоминать здесь» asks to switch it off', () => {
  const calls = [];
  const overlay = mountChatOverlay({ onOpenStudio: tab => calls.push(['studio', tab]), onSetupOff: () => calls.push(['off']), onTogglePresent: () => {}, onLeak: () => {} });
  const view = setup => ({ chips: false, cast: [], leaks: [], setup });
  try {
    overlay.render(view({ due: false, done: 2, total: 2, chat: 'a' }));
    assert.equal(document.getElementById('ku-setup-banner'), null, 'a chat that is set up gets nothing');
    overlay.render(view({ due: true, done: 1, total: 2, chat: 'a' }));
    const banner = document.getElementById('ku-setup-banner');
    assert.ok(banner, 'it shows even when nobody is on the stage yet');
    assert.equal(banner.nextElementSibling.id, 'send_form', 'right above the message box');
    assert.match(banner.textContent, /ещё не настроен \(обязательных шагов 1 из 2\)/);
    const press = text => [...banner.querySelectorAll('button')].find(node => node.textContent === text).click();
    press('Пошаговая инструкция');
    assert.deepEqual(calls, [['studio', 'setup']]);
    press('Не напоминать здесь');
    assert.deepEqual(calls.at(-1), ['off']);
    press('Позже');
    assert.equal(document.getElementById('ku-setup-banner'), null, 'put off');
    overlay.render(view({ due: true, done: 1, total: 2, chat: 'a' }));
    assert.equal(document.getElementById('ku-setup-banner'), null, 'it stays put off for this chat');
    overlay.render(view({ due: true, done: 1, total: 2, chat: 'b' }));
    assert.ok(document.getElementById('ku-setup-banner'), 'another chat is reminded');
    overlay.render(view({ due: false, done: 2, total: 2, chat: 'b' }));
    assert.equal(document.getElementById('ku-setup-banner'), null, 'it goes away when the steps are done');
  } finally { overlay.destroy?.(); document.getElementById('ku-setup-banner')?.remove(); }
});

test('the page «Настройка чата»: progress, every step with what to press, «Открыть страницу» goes to its page', async () => {
  const steps = setupSteps({ enabled: true, personaId: 'me', characters: 0, libraryCards: 3, cardsOn: 0, lorebooks: 0, hasPlace: false, auxMode: 'off' });
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? () => undefined : undefined) });
  const snapshot = () => ({
    entities: {}, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, characters: [],
    setup: { steps, progress: setupProgress(steps), off: false, remind: true, enabled: true },
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'setup' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const main = shadow.querySelector('main');
    assert.match(main.textContent, /Настроим Кулисы для этого чата/);
    assert.match(main.textContent, /Обязательные шаги: 1 из 2/);
    assert.equal(main.querySelectorAll('.ku-setup-step').length, steps.length);
    assert.match(main.textContent, /Выберите свою персону/);
    assert.equal(main.querySelectorAll('.ku-setup-step.done').length, 1, 'only the persona is done');
    [...main.querySelectorAll('.ku-setup-step')][1].querySelector('button').click();
    await flush();
    assert.match(shadow.querySelector('main').textContent, /Персонажи/, 'the page of the characters opens');
  } finally { studio.destroy?.(); }
});
