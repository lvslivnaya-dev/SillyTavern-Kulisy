/**
 * The location library as the Studio uses it: kept in SillyTavern's extension
 * settings (so it outlives every chat), edited through the core functions, and
 * connected to the open chat through location-links.js.
 *
 * Every change to a place re-syncs the open chat right away; other chats catch up
 * when they are opened (see syncChat).
 */
import {
  addDrafts, addFolder, addItemDrafts, addLibraryItem, addLocation, duplicateLocation, emptyLibrary, exportLibrary, folderWithDescendants,
  importLibrary, normalizeLibrary, removeFolder, removeLibraryItem, removeLocation, uniqueId, updateFolder, updateLibraryItem, updateLocation,
} from '../core/index.js';
import { draftsFromLorebook, draftsFromMarkdownFiles, listLorebookEntries } from './location-import.js';
import { linkOperations, linkedCards, saveCardDraft, syncOperations, unlinkOperations } from './location-links.js';
import { itemLinkOperations, itemUnlinkOperations, linkedItems, saveItemDraft, syncItemOperations } from './item-links.js';
import { PLACE_PROMPT, THING_PROMPT, parseDescription } from './vision.js';

/** Names a new entry gets before the model (or the user) names it. */
const PLACEHOLDERS = { places: 'Новая локация', items: 'Новая вещь' };

/** settings.locationLibrary, repaired once per session and cached. */
export function createLocationLibraryStore({ settings, save, onChange }) {
  let cache = null;
  return {
    get() {
      if (!cache) {
        try { cache = normalizeLibrary(settings().locationLibrary); }
        catch (error) { console.error('[Kulisy] Location library could not be read; starting empty.', error); cache = emptyLibrary(); }
      }
      return cache;
    },
    set(next) {
      cache = normalizeLibrary(next);
      settings().locationLibrary = cache;
      save();
      try { onChange?.(); } catch (error) { console.error('[Kulisy] Library change listener failed.', error); }
      return cache;
    },
  };
}

function summary(result) {
  const parts = [`добавлено: ${result.added.length}`];
  if (result.skipped.length) parts.push(`пропущено (уже есть): ${result.skipped.length}`);
  return parts.join(', ');
}

/**
 * Studio callbacks.
 * deps: { library (store), getState(), commitOperations(ops), confirm(title, html) → boolean,
 *         listBooks() → names, loadBook(name) → book, notify(text),
 *         pictures: upload(dataUrl, name) → path, removeImage(path), imageForModel(path) → dataUrl,
 *         ask(dataUrl, prompt) → text (the same model as the wardrobe), log(level, text, error) }
 */
export function createLibraryCallbacks(deps) {
  const { library, getState, commitOperations, confirm } = deps;

  /** Re-sync the open chat after a library change. `keepTraits` / `keepDescriptions`: what removed entries leave behind. */
  async function syncOpenChat(keepTraits, keepDescriptions) {
    const operations = [
      ...syncOperations(getState(), library.get(), { keepTraits }),
      ...syncItemOperations(getState(), library.get(), { keepDescriptions }),
    ];
    if (operations.length) await commitOperations(operations);
  }

  function descriptionsOf(ids) {
    const map = new Map();
    for (const item of library.get().items ?? []) if (ids.has(item.id) && item.description) map.set(item.id, item.description);
    return map;
  }

  /** Import into a folder: places or things, from the same kinds of drafts. */
  function addDraftsOf(kind, drafts, folderId) {
    return kind === 'items' ? addItemDrafts(library.get(), drafts, folderId) : addDrafts(library.get(), drafts, folderId);
  }

  const entriesOf = kind => (kind === 'items' ? library.get().items ?? [] : library.get().locations);
  const entryOf = (kind, id) => {
    const entry = entriesOf(kind).find(candidate => candidate.id === id);
    if (!entry) throw new Error(kind === 'items' ? 'Такой вещи уже нет.' : 'Такой локации уже нет.');
    return entry;
  };
  /** Change one entry of either kind, then bring the open chat in line. */
  async function change(kind, id, changes) {
    library.set(kind === 'items' ? updateLibraryItem(library.get(), id, changes) : updateLocation(library.get(), id, changes));
    await syncOpenChat();
    return entryOf(kind, id);
  }

  /** Delete pictures from the server that no entry uses any more (a copy of a place shares its picture). */
  async function forgetImages(paths) {
    const used = new Set([...library.get().locations, ...(library.get().items ?? [])].map(entry => entry.image).filter(Boolean));
    for (const path of new Set(paths.filter(Boolean))) {
      if (used.has(path) || !deps.removeImage) continue;
      try { await deps.removeImage(path); } catch (error) { deps.log?.('warn', 'Старая картинка библиотеки не удалилась с сервера', error); }
    }
  }

  /** Ask the picture model about an entry's picture: description (and traits for a place); the name only if it is a placeholder or the model's own. */
  async function describe(kind, id) {
    const entry = entryOf(kind, id);
    if (!entry.image) throw new Error('Сначала добавьте картинку.');
    if (!deps.ask) throw new Error('Модель для картинок не настроена.');
    const answer = parseDescription(await deps.ask(await deps.imageForModel(entry.image), kind === 'items' ? THING_PROMPT : PLACE_PROMPT));
    if (!answer.description && !answer.name) throw new Error('Модель ничего не описала. Видит ли она картинки?');
    const fresh = entryOf(kind, id);
    const changes = {};
    if (answer.description) changes.description = answer.description;
    if (answer.name && (fresh.autoName || fresh.name === PLACEHOLDERS[kind])) { changes.name = answer.name; changes.autoName = true; }
    if (kind !== 'items' && answer.traits?.length) changes.traits = [...fresh.traits, ...answer.traits];
    return change(kind, id, changes);
  }

  /** The folder for an import with none open: a top folder of this name (reused if there is one). */
  function folderFor(folderId, name) {
    if (folderId) return folderId;
    const wanted = String(name || 'Импорт').trim().slice(0, 120) || 'Импорт';
    const existing = library.get().folders.find(folder => !folder.parentId && folder.name.toLocaleLowerCase('ru-RU') === wanted.toLocaleLowerCase('ru-RU'));
    if (existing) return existing.id;
    const { library: next, folder } = addFolder(library.get(), { name: wanted });
    library.set(next);
    return folder.id;
  }

  function traitsOf(ids) {
    const map = new Map();
    for (const location of library.get().locations) if (ids.has(location.id)) map.set(location.id, location.traits);
    return map;
  }

  return {
    onLibraryGet: () => ({ library: library.get(), linkedIds: [...linkedCards(getState()).keys()], linkedItemIds: [...linkedItems(getState()).keys()] }),

    onLibraryAddFolder: ({ name, parentId = '' }) => {
      const { library: next, folder } = addFolder(library.get(), { name, parentId });
      library.set(next);
      return folder;
    },
    onLibraryUpdateFolder: ({ folderId, changes }) => { library.set(updateFolder(library.get(), folderId, changes)); },
    onLibraryRemoveFolder: async ({ folderId }) => {
      const current = library.get();
      const ids = folderWithDescendants(current, folderId);
      const inside = current.locations.filter(location => ids.has(location.folderId));
      const things = (current.items ?? []).filter(item => ids.has(item.folderId));
      const folder = current.folders.find(item => item.id === folderId);
      if (!folder) return false;
      if (inside.length || things.length || ids.size > 1) {
        const ok = await confirm('Удалить папку', `Папка «${folder.name}» и всё внутри (локаций: ${inside.length}, вещей: ${things.length}, папок: ${ids.size - 1}) будут удалены из библиотеки. В открытом чате они останутся как обычные места и вещи чата. Продолжить?`);
        if (!ok) return false;
      }
      const keep = traitsOf(new Set(inside.map(location => location.id)));
      const keepDescriptions = descriptionsOf(new Set(things.map(item => item.id)));
      library.set(removeFolder(current, folderId, { withContents: true }).library);
      await syncOpenChat(keep, keepDescriptions);
      await forgetImages([...inside, ...things].map(entry => entry.image));
      return true;
    },

    onLibraryAddLocation: fields => {
      const { library: next, location } = addLocation(library.get(), fields);
      library.set(next);
      return location;
    },
    onLibraryUpdateLocation: async ({ locationId, changes }) => {
      library.set(updateLocation(library.get(), locationId, changes));
      await syncOpenChat();
    },
    onLibraryDuplicateLocation: ({ locationId, folderId }) => {
      const { library: next, location } = duplicateLocation(library.get(), locationId, { folderId });
      library.set(next);
      return location;
    },
    onLibraryRemoveLocation: async ({ locationId }) => {
      const location = library.get().locations.find(item => item.id === locationId);
      if (!location) return false;
      const ok = await confirm('Удалить локацию', `«${location.name}» будет удалена из библиотеки. В открытом чате её находки останутся как обычная локация чата. Продолжить?`);
      if (!ok) return false;
      const keep = traitsOf(new Set([locationId]));
      library.set(removeLocation(library.get(), locationId));
      await syncOpenChat(keep);
      await forgetImages([location.image]);
      return true;
    },

    /**
     * Switch places (or, with kind 'items', things) on/off for the open chat.
     * `folderId` switches a whole folder (with subfolders).
     */
    onLibraryLink: async ({ libraryIds = [], folderId = '', on = true, kind = 'places' }) => {
      const things = kind === 'items';
      let ids = [...libraryIds];
      if (folderId) {
        const folders = folderWithDescendants(library.get(), folderId);
        ids = (things ? library.get().items ?? [] : library.get().locations).filter(entry => folders.has(entry.folderId)).map(entry => entry.id);
      }
      const operations = things
        ? (on ? itemLinkOperations(getState(), library.get(), ids) : itemUnlinkOperations(getState(), ids))
        : (on ? linkOperations(getState(), library.get(), ids) : unlinkOperations(getState(), ids));
      if (operations.length) await commitOperations(operations);
      return operations.length;
    },

    /** Keep a place found in this chat: it goes into a folder of the library (a folder is required). */
    onLibrarySaveCard: async ({ locationId, folderId }) => {
      if (!folderId) throw new Error('Сначала выберите папку');
      const { draft, operations } = saveCardDraft(getState(), locationId);
      const { library: next, location } = addLocation(library.get(), { ...draft, folderId });
      library.set(next);
      await commitOperations(operations(location.id));
      return location;
    },

    onLibraryAddItem: fields => {
      const { library: next, item } = addLibraryItem(library.get(), fields);
      library.set(next);
      return item;
    },
    onLibraryUpdateItem: async ({ itemId, changes }) => {
      library.set(updateLibraryItem(library.get(), itemId, changes));
      await syncOpenChat();
    },
    onLibraryRemoveItem: async ({ itemId }) => {
      const item = (library.get().items ?? []).find(candidate => candidate.id === itemId);
      if (!item) return false;
      const ok = await confirm('Удалить вещь', `«${item.name}» будет удалена из библиотеки. В открытом чате она останется как обычная вещь чата. Продолжить?`);
      if (!ok) return false;
      const keepDescriptions = descriptionsOf(new Set([itemId]));
      library.set(removeLibraryItem(library.get(), itemId));
      await syncOpenChat(undefined, keepDescriptions);
      await forgetImages([item.image]);
      return true;
    },
    /** Keep a thing of this chat: it goes into a folder of the library. */
    onLibrarySaveItem: async ({ itemId, folderId }) => {
      if (!folderId) throw new Error('Сначала выберите папку');
      const { draft, operations } = saveItemDraft(getState(), itemId);
      const { library: next, item } = addLibraryItem(library.get(), { ...draft, folderId });
      library.set(next);
      await commitOperations(operations(item.id));
      return item;
    },

    /** A new place or thing from a picture, in `folderId`; `describe`: ask the model right away. */
    onLibraryAddFromImage: async ({ kind = 'places', folderId, imageDataUrl, describe: describeNow = false }) => {
      if (!folderId) throw new Error('Сначала откройте папку.');
      const image = await deps.upload(imageDataUrl, uniqueId(kind === 'items' ? 'thing' : 'place'));
      let entry;
      try {
        const fields = { folderId, name: PLACEHOLDERS[kind], image };
        const result = kind === 'items' ? addLibraryItem(library.get(), fields) : addLocation(library.get(), fields);
        library.set(result.library);
        entry = result.item ?? result.location;
      } catch (error) {
        await forgetImages([image]);
        throw error;
      }
      if (describeNow) {
        try { return await describe(kind, entry.id); }
        catch (error) { throw new Error(`Добавлено, но описать картинку не вышло: ${error.message}`); }
      }
      return entry;
    },
    onLibrarySetImage: async ({ kind = 'places', id, imageDataUrl }) => {
      const old = entryOf(kind, id).image ?? '';
      const image = await deps.upload(imageDataUrl, uniqueId(kind === 'items' ? 'thing' : 'place'));
      const entry = await change(kind, id, { image });
      await forgetImages([old]);
      return entry;
    },
    onLibraryRemoveImage: async ({ kind = 'places', id }) => {
      const old = entryOf(kind, id).image ?? '';
      const entry = await change(kind, id, { image: '' });
      await forgetImages([old]);
      return entry;
    },
    onLibraryDescribe: ({ kind = 'places', id }) => describe(kind, id),

    onLibraryExport: ({ folderId = '' } = {}) => JSON.stringify(exportLibrary(library.get(), folderId), null, 2),
    onLibraryImportJson: ({ text, folderId = '' }) => {
      let data;
      try { data = JSON.parse(String(text ?? '')); }
      catch { throw new Error('Файл не читается как JSON'); }
      const result = importLibrary(library.get(), data, folderId);
      library.set(result.library);
      deps.notify?.(`Импорт библиотеки: ${summary(result)}`);
      return result;
    },

    onLibraryLorebooks: () => deps.listBooks(),
    onLibraryLorebookEntries: async ({ book }) => listLorebookEntries(await deps.loadBook(book)),
    onLibraryImportLorebook: async ({ book, uids, folderId, kind = 'places' }) => {
      // No folder open: a folder named after the lorebook.
      const drafts = draftsFromLorebook(await deps.loadBook(book), uids ?? null);
      const result = addDraftsOf(kind, drafts, folderFor(folderId, book));
      library.set(result.library);
      deps.notify?.(`${kind === 'items' ? 'Вещи' : 'Локации'} из лорбука «${book}»: ${summary(result)}`);
      return result;
    },
    /** files: [{ path: webkitRelativePath, text }] from a picked folder; subfolders become folders. */
    onLibraryImportMarkdown: ({ files, folderId, kind = 'places' }) => {
      // No folder open: a folder named after the picked folder of notes.
      const drafts = draftsFromMarkdownFiles(files);
      if (!drafts.length) throw new Error('В выбранной папке нет заметок .md.');
      const result = addDraftsOf(kind, drafts, folderFor(folderId, String(files?.[0]?.path ?? '').split(/[\\/]/)[0]));
      library.set(result.library);
      deps.notify?.(`${kind === 'items' ? 'Вещи' : 'Локации'} из заметок: ${summary(result)}`);
      return result;
    },
  };
}

/** Operations that bring a just-opened chat in line with the library (names, geography, removed entries). */
export function syncChat(state, store) {
  return [...syncOperations(state, store.get()), ...syncItemOperations(state, store.get())];
}
