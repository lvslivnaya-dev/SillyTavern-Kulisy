import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDrafts, addFolder, addLocation, applyOperations, createDefaultState, createEntity, createOperation, currentLocation,
  emptyLibrary, exportLibrary, folderContents, importLibrary, rollbackMessage, updateLocation,
} from '../src/core/index.js';
import { draftFromMarkdown, draftsFromLorebook, listLorebookEntries, markdownToText, readFrontMatter } from '../src/integration/location-import.js';
import { effectiveLocation, linkOperations, linkedCards, syncOperations, unlinkOperations } from '../src/integration/location-links.js';
import { createLibraryCallbacks, createLocationLibraryStore } from '../src/integration/location-library-actions.js';
import { buildWorldBlock, parseWorld } from '../src/integration/world-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const ran = createEntity('Ран');

/** Library: «Токийские мстители» → Роппонги (in it: Бар «Хаос»). */
function shelf() {
  const tr = addFolder(emptyLibrary(), { name: 'Токийские мстители' });
  const roppongi = addLocation(tr.library, { folderId: tr.folder.id, name: 'Роппонги', description: 'Район клубов.' });
  const bar = addLocation(roppongi.library, { folderId: tr.folder.id, name: 'Бар «Хаос»', aliases: ['Хаос'], traits: ['камин'], parentId: roppongi.location.id });
  return { library: bar.library, folder: tr.folder, roppongi: roppongi.location, bar: bar.location };
}

function chat() {
  return applyOperations(createDefaultState(), [createOperation('entity.upsert', ran)]);
}

test('export of a folder becomes a top-level folder; import into another library merges by names', () => {
  const { library, folder } = shelf();
  const file = exportLibrary(library, folder.id);
  assert.equal(file.kind, 'kulisy-locations');
  assert.equal(file.folders[0].parentId, undefined);
  let other = addFolder(emptyLibrary(), { name: 'Чужое' });
  const result = importLibrary(other.library, JSON.parse(JSON.stringify(file)), other.folder.id);
  assert.equal(result.added.length, 2);
  const imported = result.library.locations.find(location => location.name === 'Бар «Хаос»');
  assert.equal(result.library.locations.find(location => location.id === imported.parentId).name, 'Роппонги', 'geography survives with new IDs');
  const again = importLibrary(result.library, file, other.folder.id);
  assert.deepEqual([again.added.length, again.skipped.length], [0, 2], 'importing twice changes nothing');
  assert.throws(() => importLibrary(emptyLibrary(), { kind: 'something-else' }), /не файл библиотеки/);
});

test('drafts need a folder: either the target or their own path', () => {
  const { library, folder } = shelf();
  const result = addDrafts(library, [{ name: 'Гараж', folderPath: ['Сибуя'] }, { name: 'Роппонги' }], folder.id);
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.skipped, ['Роппонги']);
  const shibuya = result.library.folders.find(item => item.name === 'Сибуя');
  assert.equal(shibuya.parentId, folder.id);
  assert.deepEqual(addDrafts(emptyLibrary(), [{ name: 'Без папки' }]).skipped, ['Без папки']);
});

test('Markdown: front matter, Obsidian links, marks and comments; subfolders become folders', () => {
  const note = `---
aliases: [Хаос, "Бар Рана"]
traits:
  - камин
  - скрипучая лестница
находится в: "[[Роппонги]]"
---
# Бар «Хаос»
Тесный ==бар== в [[Роппонги|районе Роппонги]]. %%черновик%%
![[фото.png]]
> [!note] Владелец — [[Ран]].`;
  const draft = draftFromMarkdown('Локации/Токио/Бар «Хаос».md', note);
  assert.deepEqual(draft.folderPath, ['Токио'], 'the picked folder itself is dropped');
  assert.equal(draft.name, 'Бар «Хаос»');
  assert.deepEqual(draft.aliases, ['Хаос', 'Бар Рана']);
  assert.deepEqual(draft.traits, ['камин', 'скрипучая лестница']);
  assert.equal(draft.parentName, 'Роппонги');
  assert.equal(draft.description, 'Бар «Хаос»\nТесный бар в районе Роппонги.\n\nВладелец — Ран.');
  assert.equal(draftFromMarkdown('Локации/картинка.png', 'x'), null);
  assert.equal(draftFromMarkdown('Локации/пусто.md', '---\na: b\n---\n'), null);
  assert.deepEqual(readFrontMatter('без шапки').data, {});
  assert.equal(markdownToText('**жирный** и __тоже__'), 'жирный и тоже');
});

test('lorebook entries become drafts: comment as name, other keys as aliases', () => {
  const book = { entries: {
    0: { uid: 0, comment: 'Бар «Хаос»', key: ['хаос', 'бар «хаос»'], content: 'Тесный бар.' },
    1: { uid: 1, comment: '', key: ['Гараж Тосвы'], content: 'Гараж.', disable: true },
    2: { uid: 2, comment: 'Пустая', key: [], content: '' },
  } };
  assert.deepEqual(listLorebookEntries(book).map(entry => entry.name), ['Бар «Хаос»', 'Гараж Тосвы']);
  assert.deepEqual(draftsFromLorebook(book), [{ name: 'Бар «Хаос»', aliases: ['хаос'], description: 'Тесный бар.' }], 'disabled entries only when picked');
  assert.equal(draftsFromLorebook(book, ['1'])[0].name, 'Гараж Тосвы');
});

test('switching a place on brings the places it sits in; off removes only it', () => {
  const { library, roppongi, bar } = shelf();
  let state = applyOperations(chat(), linkOperations(chat(), library, [bar.id]));
  const cards = linkedCards(state);
  assert.deepEqual([...cards.keys()].sort(), [bar.id, roppongi.id].sort());
  assert.equal(cards.get(bar.id).parentId, cards.get(roppongi.id).id);
  assert.deepEqual(linkOperations(state, library, [bar.id]), [], 'already on');
  state = applyOperations(state, unlinkOperations(state, [bar.id]));
  assert.deepEqual([...linkedCards(state).keys()], [roppongi.id]);
});

test('a chat card reads name, description and features from the library and adds its own', () => {
  const { library, bar } = shelf();
  let state = applyOperations(chat(), linkOperations(chat(), library, [bar.id]));
  const card = linkedCards(state).get(bar.id);
  state = applyOperations(state, [createOperation('location.update', { locationId: card.id, changes: { traits: ['Камин', 'дартс'], notes: ['разбито окно'] } })]);
  const view = effectiveLocation(linkedCards(state).get(bar.id), library);
  assert.deepEqual(view.traits, ['камин', 'дартс']);
  assert.deepEqual(view.aliases, ['Хаос']);
  assert.deepEqual(view.notes, ['разбито окно']);
  assert.match(buildWorldBlock(state, '', library), /Бар «Хаос» \| Роппонги \| камин; дартс \| разбито окно/);
});

test('library edits reach the chat: rename, move; a removed place stays as a chat card with its features', () => {
  const { library, bar } = shelf();
  let state = applyOperations(chat(), linkOperations(chat(), library, [bar.id]));
  const renamed = updateLocation(library, bar.id, { name: 'Бар «Порядок»', parentId: '' });
  state = applyOperations(state, syncOperations(state, renamed));
  const card = linkedCards(state).get(bar.id);
  assert.equal(card.name, 'Бар «Порядок»');
  assert.equal(card.parentId, undefined);
  assert.deepEqual(syncOperations(state, renamed), [], 'in sync: nothing to do');
  const gone = { ...renamed, locations: renamed.locations.filter(location => location.id !== bar.id) };
  state = applyOperations(state, syncOperations(state, gone, { keepTraits: new Map([[bar.id, ['камин']]]) }));
  const orphan = state.world.locations.find(location => location.id === card.id);
  assert.equal(orphan.libraryId, undefined);
  assert.deepEqual(orphan.traits, ['камин']);
});

test('the chronicler names a library place this chat has not switched on: it is switched on, a swipe undoes it', () => {
  const { library, bar } = shelf();
  const result = { operations: [], world: parseWorld({ place: { new: { name: 'хаос' } } }), knowledge: null };
  let state = applyAnalysisResult(chat(), result, { messageId: '5', messageIndex: 5, transactionId: 'message:5' }, [], { library }).state;
  assert.equal(currentLocation(state).libraryId, bar.id);
  assert.equal(linkedCards(state).size, 2, 'with Roppongi around it');
  state = rollbackMessage(state, '5');
  assert.equal(linkedCards(state).size, 0);
});

test('callbacks: folder first, save a chat card, switch a folder, import and remove with a confirmation', async () => {
  const settings = {};
  let saved = 0;
  const store = createLocationLibraryStore({ settings: () => settings, save: () => { saved += 1; } });
  let state = chat();
  const asked = [];
  const callbacks = createLibraryCallbacks({
    library: store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    confirm: async title => { asked.push(title); return true; },
    listBooks: () => ['Мир'],
    loadBook: async () => ({ entries: { 0: { uid: 0, comment: 'Склад', key: ['склад'], content: 'Пыльный склад.' } } }),
  });
  assert.throws(() => callbacks.onLibraryAddLocation({ name: 'Бар' }), /Сначала выберите папку/);
  const folder = callbacks.onLibraryAddFolder({ name: 'Мстители' });
  callbacks.onLibraryAddLocation({ folderId: folder.id, name: 'Бар' });
  assert.equal(settings.locationLibrary.locations.length, 1, 'kept in extension settings');
  assert.ok(saved >= 2);

  state = applyOperations(state, [createOperation('location.add', { item: { id: 'roof', name: 'Крыша', traits: ['ржавая лестница'] } })]);
  await assert.rejects(() => callbacks.onLibrarySaveCard({ locationId: 'roof' }), /Сначала выберите папку/);
  const roof = await callbacks.onLibrarySaveCard({ locationId: 'roof', folderId: folder.id });
  assert.deepEqual(roof.traits, ['ржавая лестница']);
  assert.equal(state.world.locations[0].libraryId, roof.id);
  assert.deepEqual(state.world.locations[0].traits, [], 'the features moved into the library');

  await callbacks.onLibraryImportLorebook({ book: 'Мир', folderId: folder.id });
  assert.equal(await callbacks.onLibraryLink({ folderId: folder.id }), 2, 'Бар and Склад switched on; Крыша already was');
  assert.equal(callbacks.onLibraryGet().linkedIds.length, 3);

  assert.equal(await callbacks.onLibraryRemoveFolder({ folderId: folder.id }), true);
  assert.deepEqual(asked, ['Удалить папку']);
  assert.deepEqual(folderContents(store.get()).folders, []);
  assert.equal(state.world.locations.length, 3, 'chat cards stay');
  assert.ok(state.world.locations.every(location => !location.libraryId));
  assert.deepEqual(state.world.locations.find(location => location.id === 'roof').traits, ['ржавая лестница'], 'nothing lost in this chat');
});

test('a broken library in settings is repaired on read', () => {
  const store = createLocationLibraryStore({ settings: () => ({ locationLibrary: { locations: [{ id: 'x', name: 'Сирота', folderId: 'nope' }] } }), save() {} });
  assert.equal(store.get().folders[0].name, 'Восстановленные');
});
