/** Things kept across chats: the library side, the chat side, the chronicler, the scene block, the page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addFolder, addItemDrafts, addLibraryItem, applyOperations, createDefaultState, createEntity, createOperation, emptyLibrary,
  exportLibrary, folderContents, importLibrary, normalizeLibrary, removeFolder, rollbackMessage, searchLibraryItems, updateLibraryItem,
} from '../src/core/index.js';
import { effectiveItem, itemLinkOperations, itemUnlinkOperations, linkedItems, saveItemDraft, syncItemOperations } from '../src/integration/item-links.js';
import { createLibraryCallbacks, createLocationLibraryStore } from '../src/integration/location-library-actions.js';
import { parseWorld } from '../src/integration/world-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';
import { draftFromMarkdown } from '../src/integration/location-import.js';

const mikey = createEntity('Майки', { aliases: ['Манджиро'] });

/** «Токийские мстители» with Майки's bike in it. */
function shelf() {
  const tr = addFolder(emptyLibrary(), { name: 'Токийские мстители' });
  const bike = addLibraryItem(tr.library, {
    folderId: tr.folder.id, name: 'Байк CB250T', aliases: ['Бабу'], ownerName: 'Манджиро', importance: 'key', description: 'Чёрный Honda CB250T, Майки зовёт его «Бабу».',
  });
  return { library: bike.library, folder: tr.folder, bike: bike.item };
}

function chat() {
  return applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey), createOperation('scene.set', { presentIds: [mikey.id] })]);
}

test('library things: a folder first, search, export and import with places in one file', () => {
  assert.throws(() => addLibraryItem(emptyLibrary(), { name: 'Нож' }), /Сначала выберите папку/);
  const { library, folder, bike } = shelf();
  assert.equal(folderContents(library, folder.id).items[0].id, bike.id);
  assert.deepEqual(searchLibraryItems(library, 'бабу').map(item => item.id), [bike.id]);
  assert.equal(updateLibraryItem(library, bike.id, { ownerName: '' }).items[0].ownerName, undefined);
  const file = exportLibrary(library, folder.id);
  assert.equal(file.items.length, 1);
  const other = importLibrary(emptyLibrary(), JSON.parse(JSON.stringify(file)));
  assert.equal(other.library.items[0].name, 'Байк CB250T');
  assert.equal(other.library.items[0].importance, 'key');
  assert.deepEqual(importLibrary(other.library, file).added, [], 'importing twice changes nothing');
  assert.equal(addItemDrafts(library, [{ name: 'Байк CB250T' }], folder.id).skipped.length, 1);
});

test('repair rescues a thing without a folder; removing a folder takes its things', () => {
  const repaired = normalizeLibrary({ folders: [], locations: [], items: [{ id: 't1', name: 'Письмо', folderId: 'gone', importance: 'odd' }] });
  assert.equal(repaired.folders[0].name, 'Восстановленные');
  assert.equal(repaired.items[0].importance, 'normal');
  const { library, folder, bike } = shelf();
  assert.throws(() => removeFolder(library, folder.id), /не пуста/);
  const result = removeFolder(library, folder.id, { withContents: true });
  assert.deepEqual(result.removedItemIds, [bike.id]);
  assert.deepEqual(result.library.items, []);
});

test('switched on in a chat, the thing goes to its usual owner; the chat keeps where it is, the library its description', () => {
  const { library, bike } = shelf();
  let state = applyOperations(chat(), itemLinkOperations(chat(), library, [bike.id]));
  const item = linkedItems(state).get(bike.id);
  assert.equal(item.ownerId, mikey.id, 'found by the alias Манджиро');
  assert.equal(item.importance, 'key');
  assert.match(effectiveItem(item, library).description, /Бабу/);
  assert.deepEqual(itemLinkOperations(state, library, [bike.id]), [], 'already on');
  state = applyOperations(state, [createOperation('item.update', { itemId: item.id, changes: { place: 'у гаража' } })]);
  const renamed = updateLibraryItem(library, bike.id, { name: 'Бабу' });
  state = applyOperations(state, syncItemOperations(state, renamed));
  assert.equal(state.world.items[0].name, 'Бабу');
  assert.equal(state.world.items[0].place, 'у гаража', 'chat facts stay');
  const gone = { ...renamed, items: [] };
  state = applyOperations(state, syncItemOperations(state, gone, { keepDescriptions: new Map([[bike.id, bike.description]]) }));
  assert.equal(state.world.items[0].libraryId, undefined);
  assert.match(state.world.items[0].note, /Honda/, 'the description stays as a note');
  const back = applyOperations(chat(), itemLinkOperations(chat(), library, [bike.id]));
  assert.equal(applyOperations(back, itemUnlinkOperations(back, [bike.id])).world.items.length, 0);
});

test('a chat item saved into the library remembers who holds it as the usual owner', () => {
  const state = applyOperations(chat(), [createOperation('item.add', { item: { id: 'ring', name: 'Кольцо', ownerId: mikey.id, importance: 'important' } })]);
  const { draft } = saveItemDraft(state, 'ring');
  assert.deepEqual([draft.name, draft.ownerName, draft.importance], ['Кольцо', 'Майки', 'important']);
});

test('the chronicler names a library thing by another name: it is switched on (a swipe undoes it), not a twin', () => {
  const { library, bike } = shelf();
  const result = { operations: [], world: parseWorld({ items: [{ name: 'бабу', place: 'у бара' }] }), knowledge: null };
  let state = applyAnalysisResult(chat(), result, { messageId: '5', messageIndex: 5, transactionId: 'message:5' }, [], { library, trackWorld: true }).state;
  const item = linkedItems(state).get(bike.id);
  assert.ok(item, 'linked');
  assert.deepEqual([item.name, item.ownerId, item.place], ['Байк CB250T', mikey.id, 'у бара']);
  const again = { operations: [], world: parseWorld({ items: [{ name: 'Бабу', ownerId: null, place: 'угнан' }] }), knowledge: null };
  state = applyAnalysisResult(state, again, { messageId: '6', messageIndex: 6, transactionId: 'message:6' }, [], { library, trackWorld: true }).state;
  assert.equal(state.world.items.length, 1, 'the same bike');
  assert.equal(state.world.items[0].name, 'Байк CB250T', 'an alias does not rename it');
  assert.equal(state.world.items[0].ownerId, undefined);
  state = rollbackMessage(rollbackMessage(state, '6'), '5');
  assert.equal(state.world.items.length, 0);
});

test('the scene block tells what a library thing in play is', () => {
  const { library, bike } = shelf();
  const state = applyOperations(chat(), itemLinkOperations(chat(), library, [bike.id]));
  assert.match(buildScenePrompt(state, { library }), /about\[Байк CB250T\]: Чёрный Honda/);
  assert.doesNotMatch(buildScenePrompt(state, { library: null }), /about\[/);
});

test('Markdown notes of things: owner and importance from the front matter', () => {
  const draft = draftFromMarkdown('Вещи/ТР/Серьга.md', '---\nвладелец: "[[Дракен]]"\nважность: ключевая\n---\nСерьга с иероглифом.');
  assert.deepEqual([draft.name, draft.ownerName, draft.importance], ['Серьга', 'Дракен', 'key']);
});

test('callbacks: things in folders, switched on by folder, saved from the chat, removed with a confirmation', async () => {
  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  let state = chat();
  const asked = [];
  const callbacks = createLibraryCallbacks({
    library: store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    confirm: async title => { asked.push(title); return true; },
    listBooks: () => ['Мир'],
    loadBook: async () => ({ entries: { 0: { uid: 0, comment: 'Кастет', key: ['кастет'], content: 'Латунный кастет.' } } }),
  });
  const folder = callbacks.onLibraryAddFolder({ name: 'ТР' });
  assert.throws(() => callbacks.onLibraryAddItem({ name: 'Нож' }), /Сначала выберите папку/);
  callbacks.onLibraryAddItem({ folderId: folder.id, name: 'Плащ Тосвы', ownerName: 'Майки' });
  await callbacks.onLibraryImportLorebook({ book: 'Мир', folderId: folder.id, kind: 'items' });
  assert.equal(settings.locationLibrary.items.length, 2);
  assert.equal(settings.locationLibrary.locations.length, 0, 'imported as things, not places');
  assert.equal(await callbacks.onLibraryLink({ folderId: folder.id, kind: 'items' }), 2);
  assert.equal(callbacks.onLibraryGet().linkedItemIds.length, 2);
  state = applyOperations(state, [createOperation('item.add', { item: { id: 'note', name: 'Записка', importance: 'normal' } })]);
  const saved = await callbacks.onLibrarySaveItem({ itemId: 'note', folderId: folder.id });
  assert.equal(state.world.items.find(item => item.id === 'note').libraryId, saved.id);
  const cloak = store.get().items.find(item => item.name === 'Плащ Тосвы');
  await callbacks.onLibraryUpdateItem({ itemId: cloak.id, changes: { name: 'Токкофуку' } });
  assert.ok(state.world.items.some(item => item.name === 'Токкофуку'), 'the open chat follows');
  assert.equal(await callbacks.onLibraryRemoveFolder({ folderId: folder.id }), true);
  assert.deepEqual(asked, ['Удалить папку']);
  assert.equal(state.world.items.length, 3, 'chat items stay');
  assert.ok(state.world.items.every(item => !item.libraryId));
});

// ---- The page ------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { createRelationshipStudio } = await import('../src/ui/studio.js');

test('«Вещи» → «Библиотека»: no thing outside a folder, a switch per thing, a chat thing goes into a folder', async () => {
  const { library, folder, bike } = shelf();
  const state = applyOperations(chat(), [createOperation('item.add', { item: { id: 'ring', name: 'Кольцо', ownerId: mikey.id, importance: 'normal' } })]);
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    locationLibrary: library, linkedLocationIds: [], linkedItemIds: [],
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'items' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    const picker = shadow.querySelector('select[aria-label="Сохранить в папку библиотеки"]');
    picker.value = folder.id;
    picker.dispatchEvent(new dom.window.Event('change'));
    await flush();
    assert.deepEqual(calls.at(-1), ['onLibrarySaveItem', { itemId: 'ring', folderId: folder.id }]);
    byText('Библиотека').click();
    assert.equal(byText('+ Вещь').disabled, true);
    shadow.querySelector('.ku-folder').click();
    assert.equal(byText('+ Вещь').disabled, false);
    const card = shadow.querySelector('.ku-place-card');
    assert.match(card.textContent, /Байк CB250T[\s\S]*обычно у: Манджиро/);
    const sw = card.querySelector('.ku-switch');
    sw.checked = true;
    sw.dispatchEvent(new dom.window.Event('change'));
    await flush();
    assert.deepEqual(calls.at(-1)[1], { libraryIds: [bike.id], on: true, kind: 'items' });
    card.querySelector('.ku-place-open').click();
    assert.ok(shadow.querySelector('input[aria-label="Обычно у кого"]'), 'the editor opened');
  } finally { studio.destroy(); }
});
