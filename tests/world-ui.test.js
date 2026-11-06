/** Scene UI: hand edits, the four slip answers, reminders, and the world pages in jsdom. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addFolder, addLocation, applyOperations, createDefaultState, createEntity, createOperation, dossier, emptyLibrary } from '../src/core/index.js';
import { createReminders, createWorldCallbacks } from '../src/integration/world-actions.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^[A-Z]/.test(name) && typeof window[name] === 'function') { try { globalThis[name] = window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { createRelationshipStudio } = await import('../src/ui/studio.js');

const mikey = createEntity('Майки');
const ran = createEntity('Ран');

function base() {
  return applyOperations(createDefaultState(), [
    ...[mikey, ran].map(entity => createOperation('entity.upsert', entity)),
    createOperation('clock.set', { day: 2, time: '23:30' }),
    createOperation('scene.set', { presentIds: [mikey.id], location: 'бар' }),
    createOperation('wardrobe.set', { entityId: mikey.id, outfit: 'форма Тосвы' }),
    createOperation('item.add', { item: { id: 'gun', name: 'пистолет', ownerId: mikey.id, importance: 'key' } }),
  ]);
}

function harness({ inputValue = 'костюм с галстуком' } = {}) {
  let state = base();
  const chat = [{ mes: 'a' }, { mes: 'Майки поправил галстук', extra: { k: { slips: [
    { kind: 'outfit', entityId: mikey.id, quote: 'поправил галстук', note: 'был без галстука' },
    { kind: 'item', entityId: mikey.id, quote: 'достал нож' },
  ] } } }];
  const opened = [];
  const reminders = createReminders();
  const callbacks = createWorldCallbacks({
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    chat: () => chat, saveChat: async () => {}, markerKey: 'k',
    input: async () => inputValue,
    swipe: async () => {}, editMessage: () => {}, reminders,
    openStudio: (tab, options) => opened.push([tab, options]), refresh() {},
  });
  return { callbacks, chat, reminders, opened, state: () => state };
}

test('hand edits: a wrong time is refused, an outfit can be locked, items are edited', async () => {
  const { callbacks, state } = harness();
  assert.throws(() => callbacks.onSetClock({ time: '25:61' }), /ЧЧ:ММ/);
  await callbacks.onSetClock({ time: '7:05', day: '3' });
  assert.deepEqual([state().world.clock.day, state().world.clock.time], [3, '07:05']);
  await callbacks.onSetOutfit({ entityId: mikey.id, locked: true });
  assert.equal(state().world.wardrobe[mikey.id].locked, true);
  assert.equal(state().world.wardrobe[mikey.id].outfit, 'форма Тосвы', 'locking keeps the outfit');
  await callbacks.onUpdateItem({ itemId: 'gun', changes: { ownerId: ran.id, place: 'в бардачке' } });
  assert.deepEqual([state().world.items[0].ownerId, state().world.items[0].place], [ran.id, 'в бардачке']);
  assert.throws(() => callbacks.onSetOutfit({ entityId: 'ghost', outfit: 'x' }), /не найден/);
  assert.equal(state().operations.at(-1).transactionId.startsWith('manual'), true);
});

test('«Так и есть» rewrites the outfit from the answer and drops the slip; for an item it opens the things page', async () => {
  const { callbacks, chat, state, opened } = harness();
  assert.equal(await callbacks.onSlipAccept({ messageIndex: 1, slipIndex: 0 }), 'outfit');
  assert.equal(state().world.wardrobe[mikey.id].outfit, 'костюм с галстуком');
  assert.equal(chat[1].extra.k.slips.length, 1);
  assert.equal(await callbacks.onSlipAccept({ messageIndex: 1, slipIndex: 0 }), 'items');
  assert.deepEqual(opened, [['items', { entityId: mikey.id }]]);
  assert.equal(chat[1].extra.k.slips, undefined);
});

test('«Так и есть» cancelled keeps everything; «Не ляп» only drops the mark', async () => {
  const { callbacks, chat, state } = harness({ inputValue: null });
  assert.equal(await callbacks.onSlipAccept({ messageIndex: 1, slipIndex: 0 }), null);
  assert.equal(chat[1].extra.k.slips.length, 2);
  await callbacks.onSlipDismiss({ messageIndex: 1, slipIndex: 0 });
  assert.equal(chat[1].extra.k.slips.length, 1);
  assert.equal(state().world.wardrobe[mikey.id].outfit, 'форма Тосвы');
});

test('«Напомнить рассказчику» puts a correction into the next scene block only', async () => {
  const { callbacks, reminders, state } = harness();
  await callbacks.onSlipRemind({ messageIndex: 1, slipIndex: 0 });
  assert.equal(reminders.list().length, 1);
  const block = buildScenePrompt(state(), { reminders: reminders.list(), maxCharacters: 400 });
  assert.match(block, /correction of the last reply \("поправил галстук"\): Майки is still wearing: форма Тосвы/);
  reminders.clear();
  assert.doesNotMatch(buildScenePrompt(state(), { reminders: reminders.list() }), /correction/);
});

function snapshotOf() {
  let state = base();
  state = applyOperations(state, [createOperation('condition.add', { entityId: mikey.id, item: { id: 'b', text: 'синяк', days: 3 } }, { messageId: '5', messageIndex: 5, reason: 'Майки: синяк' })]);
  const shelf = addFolder(emptyLibrary(), { name: 'ТР' });
  const lib = addLocation(shelf.library, { folderId: shelf.folder.id, name: 'Гараж Тосвы', traits: ['байки'] }).library;
  return {
    ...state,
    pairs: [],
    dossiers: Object.fromEntries(Object.keys(state.entities).map(id => [id, dossier(state, id)])),
    leaks: [],
    slips: [{ kind: 'outfit', entityId: mikey.id, quote: 'поправил галстук', note: '', messageIndex: 7, slipIndex: 0, label: 'одежда', name: 'Майки', canSwipe: false }],
    locationLibrary: lib, linkedLocationIds: [],
    settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    folderId: shelf.folder.id,
  };
}

function open(tab) {
  const calls = [];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const callbacks = new Proxy({
    onChronicleGet: () => ({
      config: { enabled: true, preset: 'balanced' }, stats: { messages: 40, scenes: 1, chapters: 0, arcs: 0, pending: 0 }, running: false,
      chronicle: { summaries: [{ id: 's1', level: 0, seq: 0, text: 'Судзу пришла в гараж.', messageCount: 15, stale: true }] },
    }),
  }, { get: (target, name) => target[name] ?? (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  let studio;
  try {
    studio = createRelationshipStudio({ store: { getSnapshot: snapshotOf }, open: true, layout: { mode: 'window', tab }, callbacks });
  } finally { console.error = original; }
  return { studio, shadow: studio.element.shadowRoot, calls, errors };
}

const buttonByText = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('«Сейчас» shows clothes, conditions, things and what the last reply changed; a card opens the wardrobe', async () => {
  const { studio, shadow, errors } = open('scene');
  try {
    assert.deepEqual(errors, []);
    assert.match(shadow.querySelector('.ku-clock').textContent, /23:30.*день 2/);
    const actor = shadow.querySelector('.ku-actor');
    assert.match(actor.textContent, /форма Тосвы/);
    assert.match(actor.textContent, /синяк/);
    assert.match(shadow.querySelector('.ku-things').textContent, /пистолет/);
    assert.match(shadow.querySelector('.ku-feed').textContent, /Последний ответ · #5[\s\S]*Майки: синяк/);
    actor.click();
    assert.ok(shadow.querySelector('textarea[aria-label="Одежда"]'), 'the dossier opened on «Гардероб»');
  } finally { studio.destroy(); }
});

test('«Проверка» lists slips with the four answers', () => {
  const { studio, shadow, calls, errors } = open('leaks');
  try {
    assert.deepEqual(errors, []);
    assert.equal(shadow.querySelector('.nav .badge')?.textContent, '1');
    const payload = { messageIndex: 7, slipIndex: 0 };
    for (const [label, handler] of [['Править', 'onSlipEdit'], ['Так и есть', 'onSlipAccept'], ['Не ляп', 'onSlipDismiss'], ['Напомнить рассказчику', 'onSlipRemind']]) {
      buttonByText(shadow, label).click();
      assert.deepEqual(calls.at(-1), [handler, payload]);
    }
  } finally { studio.destroy(); }
});

test('places: no place without a folder; inside a folder a place is switched on for the chat', async () => {
  const { studio, shadow, calls, errors } = open('places');
  try {
    assert.deepEqual(errors, []);
    assert.equal(buttonByText(shadow, '+ Локация').disabled, true, 'the top of the library has no loose places');
    shadow.querySelector('.ku-folder').click();
    assert.equal(buttonByText(shadow, '+ Локация').disabled, false);
    const card = shadow.querySelector('.ku-place-card');
    assert.match(card.textContent, /Гараж Тосвы/);
    const sw = card.querySelector('.ku-switch');
    sw.checked = true;
    sw.dispatchEvent(new window.Event('change'));
    await flush();
    assert.equal(calls.at(-1)[0], 'onLibraryLink');
    assert.equal(calls.at(-1)[1].on, true);
  } finally { studio.destroy(); }
});

test('things and chronicle pages render with their controls', async () => {
  const items = open('items');
  try {
    assert.deepEqual(items.errors, []);
    assert.match(items.shadow.textContent, /пистолет/);
    items.shadow.querySelector('button[aria-label="Удалить"]').click();
    await flush();
    assert.deepEqual(items.calls.at(-1), ['onRemoveItem', { itemId: 'gun' }]);
  } finally { items.studio.destroy(); }
  const chronicle = open('chronicle');
  try {
    assert.deepEqual(chronicle.errors, []);
    assert.match(chronicle.shadow.querySelector('.ku-summary').textContent, /устарела[\s\S]*Судзу пришла в гараж/);
    buttonByText(chronicle.shadow, 'Пересобрать').click();
    await flush();
    assert.deepEqual(chronicle.calls.at(-1), ['onChronicleRebuild', { id: 's1' }]);
  } finally { chronicle.studio.destroy(); }
});

test('a row of the last reply can be undone alone; a hand edit cannot be undone that way', async () => {
  const { callbacks, state } = harness();
  let replaced = null;
  const withReplace = createWorldCallbacks({ getState: state, commitOperations: async () => {}, replaceState: async next => { replaced = next; }, chat: () => [], saveChat: async () => {}, markerKey: 'k', reminders: createReminders(), refresh() {} });
  const reply = applyOperations(state(), [createOperation('wardrobe.set', { entityId: mikey.id, outfit: 'пижама' }, { messageId: '9', messageIndex: 9, reason: 'Майки одет: пижама' })]);
  const own = createWorldCallbacks({ getState: () => reply, commitOperations: async () => {}, replaceState: async next => { replaced = next; }, chat: () => [], saveChat: async () => {}, markerKey: 'k', reminders: createReminders(), refresh() {} });
  await own.onUndoOperation({ operationId: reply.operations.at(-1).id });
  assert.equal(replaced.world.wardrobe[mikey.id].outfit, 'форма Тосвы', 'back to what it was before the reply');
  await callbacks.onSetOutfit({ entityId: mikey.id, outfit: 'куртка' });
  assert.throws(() => withReplace.onUndoOperation({ operationId: state().operations.at(-1).id }), /ручная правка/);
  assert.throws(() => withReplace.onUndoOperation({ operationId: 'ghost' }), /уже нет/);
});

test('«Сейчас»: a feed row has its own undo button', async () => {
  const { studio, shadow, calls } = open('scene');
  try {
    const undo = shadow.querySelector('.ku-feed button[aria-label^="Отменить"]');
    assert.ok(undo);
    undo.click();
    await flush();
    assert.equal(calls.at(-1)[0], 'onUndoOperation');
    assert.ok(calls.at(-1)[1].operationId);
  } finally { studio.destroy(); }
});

test('«Сейчас»: the numbers on a card say what they count, and open their own tab', () => {
  const { studio, shadow } = open('scene');
  try {
    const stats = shadow.querySelector('.ku-actor .ku-stats');
    assert.match(stats.textContent, /0 событий знает/);
    assert.match(stats.textContent, /1 вещь/);
    assert.ok([...stats.querySelectorAll('.ku-stat')].every(node => node.title), 'each one explains itself on hover');
    stats.querySelector('[data-tab="items"]').click();
    assert.equal(shadow.querySelector('.ku-tabs [aria-selected="true"]')?.textContent, 'Вещи');
  } finally { studio.destroy(); }
});
