/**
 * The location library as the Studio uses it: kept in SillyTavern's extension
 * settings (so it outlives every chat), edited through the core functions, and
 * connected to the open chat through location-links.js.
 *
 * Every change to a place re-syncs the open chat right away; other chats catch up
 * when they are opened (see syncChat).
 */
import {
  addCharacterDrafts, addName, checkCardSources, updateName, moveLibraryCharacters, moveLibraryEntries, noteFinder, refreshLibraryCharacter, addDrafts, addFolder, addItemDrafts, addLibraryCharacter, addLibraryItem, addLocation, duplicateLibraryCharacter, duplicateLocation, emptyLibrary, exportLibrary,
  folderWithDescendants, importLibrary, normalizeLibrary, removeFolder, removeLibraryCharacter, removeLibraryItem, removeLocation, uniqueId, updateFolder, updateLibraryCharacter, updateLibraryItem, updateLocation,
} from '../core/index.js';
import { draftsFromLorebook, draftsFromMarkdownFiles, listLorebookEntries } from './location-import.js';
import { draftFromQuestionnaire, draftsFromLorebookCharacters, draftsFromQuestionnaires, listLorebookCharacters } from './character-import.js';
import { cardLinks, linkCards, syncCardLinks, unlinkCards } from './card-links.js';
import { linkOperations, linkedCards, saveCardDraft, syncOperations, unlinkOperations } from './location-links.js';
import { itemLinkOperations, itemUnlinkOperations, linkedItems, saveItemDraft, syncItemOperations } from './item-links.js';
import { PLACE_PROMPT, THING_PROMPT, parseDescription } from './vision.js';

/** Names a new entry gets before the model (or the user) names it. */
const PLACEHOLDERS = { places: 'Новая локация', items: 'Новая вещь', characters: 'Новый персонаж' };
const IDS = { places: 'place', items: 'thing', characters: 'card' };
const LABELS = { places: 'Локации', items: 'Вещи', characters: 'Карточки' };

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
 * deps: { library (store), getState(), commitOperations(ops), replaceState(state) (attaching cards is not journaled), confirm(title, html) → boolean,
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
    // Cards that left the library are let go of their characters.
    const synced = syncCardLinks(getState(), library.get());
    if (synced !== getState() && deps.replaceState) await deps.replaceState(synced);
  }

  function descriptionsOf(ids) {
    const map = new Map();
    for (const item of library.get().items ?? []) if (ids.has(item.id) && item.description) map.set(item.id, item.description);
    return map;
  }

  /** Import into a folder: places or things, from the same kinds of drafts. */
  function addDraftsOf(kind, drafts, folderId) {
    if (kind === 'characters') return addCharacterDrafts(library.get(), drafts, folderId);
    return kind === 'items' ? addItemDrafts(library.get(), drafts, folderId) : addDrafts(library.get(), drafts, folderId);
  }

  const entriesOf = kind => (kind === 'characters' ? library.get().characters ?? [] : kind === 'items' ? library.get().items ?? [] : library.get().locations);
  const entryOf = (kind, id) => {
    const entry = entriesOf(kind).find(candidate => candidate.id === id);
    if (!entry) throw new Error(kind === 'characters' ? 'Такой карточки уже нет.' : kind === 'items' ? 'Такой вещи уже нет.' : 'Такой локации уже нет.');
    return entry;
  };
  /** Change one entry of any kind, then bring the open chat in line. */
  async function change(kind, id, changes) {
    const current = library.get();
    library.set(kind === 'characters' ? updateLibraryCharacter(current, id, changes) : kind === 'items' ? updateLibraryItem(current, id, changes) : updateLocation(current, id, changes));
    await syncOpenChat();
    return entryOf(kind, id);
  }

  /** A place or a thing into English: the description, and the traits of a place, through the model. The entry is marked (lang). */
  async function translateEntry(kind, id) {
    if (!deps.translateSections) throw new Error('Перевод здесь не подключён.');
    const entry = entryOf(kind, id);
    if (entry.lang === 'en') throw new Error(`«${entry.name}» уже на английском.`);
    const parts = [{ id: 'description', title: 'Описание', text: entry.description }];
    if (kind === 'places' && entry.traits.length) parts.push({ id: 'traits', title: 'Черты', text: entry.traits.join('\n') });
    if (!parts.some(part => part.text.trim())) throw new Error(`У «${entry.name}» нечего переводить: нет описания.`);
    const done = new Map((await deps.translateSections(parts)).map(item => [item.id, item.text]));
    const now = entryOf(kind, id);
    if (now.description !== entry.description || (kind === 'places' && now.traits.join('\n') !== entry.traits.join('\n'))) throw new Error(`«${entry.name}» изменилась во время перевода — запустите перевод ещё раз.`);
    const changes = { lang: 'en' };
    if (done.has('description')) changes.description = done.get('description');
    if (done.has('traits')) {
      const lines = done.get('traits').split(/\r?\n/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
      if (lines.length !== entry.traits.length) throw new Error(`Черты «${entry.name}» вернулись в другом числе (${lines.length} вместо ${entry.traits.length}): повторите перевод.`);
      changes.traits = lines;
    }
    await change(kind, id, changes);
  }

  /** Delete pictures from the server that no entry uses any more (a copy of a place shares its picture). */
  async function forgetImages(paths) {
    const used = new Set([...library.get().locations, ...(library.get().items ?? []), ...(library.get().characters ?? [])].map(entry => entry.image).filter(Boolean));
    for (const path of new Set(paths.filter(Boolean))) {
      if (used.has(path) || !deps.removeImage) continue;
      try { await deps.removeImage(path); } catch (error) { deps.log?.('warn', 'Старая картинка библиотеки не удалилась с сервера', error); }
    }
  }

  /** Ask the picture model about an entry's picture: description (and traits for a place); the name only if it is a placeholder or the model's own. */
  async function describe(kind, id) {
    if (kind === 'characters') throw new Error('Для карточек персонажей описания по картинке пока нет.');
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

  /** «Новый персонаж», «Новый персонаж 2»…: a card name nobody in the folder has. */
  function freeCardName(folderId, base) {
    const taken = new Set((library.get().characters ?? []).filter(card => card.folderId === folderId).map(card => card.name.toLocaleLowerCase('ru-RU')));
    let name = base;
    for (let number = 2; taken.has(name.toLocaleLowerCase('ru-RU')); number += 1) name = `${base} ${number}`;
    return name;
  }

  /**
   * The names of cards tied to an entry of the name library go into that entry (added, never taken away: other cards of the same
   * character may still use them): the card's name and its other names become the entry's other names.
   */
  function shareNames(cardIds) {
    if (!deps.names) return;
    for (const id of cardIds) {
      const card = (library.get().characters ?? []).find(candidate => candidate.id === id);
      const entry = card?.nameId ? deps.names.get().entries.find(item => item.id === card.nameId) : null;
      if (!entry) continue;
      const have = new Set([entry.name, ...entry.aliases].map(name => name.toLocaleLowerCase('ru-RU')));
      const more = [card.name, ...card.aliases].filter(name => !have.has(name.toLocaleLowerCase('ru-RU')));
      if (more.length) deps.names.change(names => updateName(names, entry.id, { aliases: [...entry.aliases, ...more] }));
    }
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

  const callbacks = {
    onLibraryGet: () => ({ library: library.get(), linkedIds: [...linkedCards(getState()).keys()], linkedItemIds: [...linkedItems(getState()).keys()], linkedCharacterIds: [...cardLinks(getState()).keys()] }),

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
      const people = (current.characters ?? []).filter(card => ids.has(card.folderId));
      const folder = current.folders.find(item => item.id === folderId);
      if (!folder) return false;
      if (inside.length || things.length || people.length || ids.size > 1) {
        const ok = await confirm('Удалить папку', `Папка «${folder.name}» и всё внутри (локаций: ${inside.length}, вещей: ${things.length}, карточек: ${people.length}, папок: ${ids.size - 1}) будут удалены из библиотеки. В открытом чате места и вещи останутся обычными, а персонажи — без карточек. Продолжить?`);
        if (!ok) return false;
      }
      const keep = traitsOf(new Set(inside.map(location => location.id)));
      const keepDescriptions = descriptionsOf(new Set(things.map(item => item.id)));
      library.set(removeFolder(current, folderId, { withContents: true }).library);
      await syncOpenChat(keep, keepDescriptions);
      await forgetImages([...inside, ...things, ...people].map(entry => entry.image));
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
        ids = entriesOf(kind).filter(entry => folders.has(entry.folderId)).map(entry => entry.id);
      }
      if (kind === 'characters') {
        // Cards are attached to characters of the chat; that is not a journal record, so the state is replaced as it is.
        if (!deps.replaceState) throw new Error('Карточки здесь подключить нельзя.');
        const before = getState();
        if (on) {
          const result = linkCards(before, library.get(), ids);
          for (const skip of result.skipped) deps.notify?.(`Карточка «${skip.name}» не подключена: ${skip.why}`);
          if (result.state !== before) await deps.replaceState(result.state);
          return result.linked.length;
        }
        const attached = new Set(cardLinks(before).keys());
        const after = unlinkCards(before, ids);
        if (after !== before) await deps.replaceState(after);
        return ids.filter(cardId => attached.has(cardId)).length;
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

    /** A card of a character: new (the template's sections) in a folder, edited, copied, deleted. */
    onLibraryAddCharacter: fields => {
      const { library: next, character } = addLibraryCharacter(library.get(), fields);
      library.set(next);
      return character;
    },
    onLibraryUpdateCharacter: async ({ cardId, changes }) => {
      library.set(updateLibraryCharacter(library.get(), cardId, changes));
      shareNames([cardId]);
      await syncOpenChat();
    },
    /**
     * Tie a card to an entry of the name library, so that its names are kept there once (nameId: the entry; '' = untie; '__new' = make
     * an entry from the card, or take the one with the same name). Several cards may share one entry (one character in different AUs).
     */
    onLibraryLinkName: ({ cardId, nameId }) => {
      if (!deps.names) throw new Error('Имена здесь подключить нельзя.');
      const card = (library.get().characters ?? []).find(candidate => candidate.id === cardId);
      if (!card) throw new RangeError('Такой карточки нет');
      let target = String(nameId ?? '');
      if (target === '__new') {
        deps.names.change(names => addName(names, { name: card.name, aliases: card.aliases }).library);
        target = deps.names.get().entries.find(entry => entry.name.toLocaleLowerCase('ru-RU') === card.name.toLocaleLowerCase('ru-RU'))?.id ?? '';
      } else if (target && !deps.names.get().entries.some(entry => entry.id === target)) throw new Error('Такой записи в «Именах» нет.');
      library.set(updateLibraryCharacter(library.get(), cardId, { nameId: target }));
      shareNames([cardId]);
      deps.notify?.(target ? `Карточка «${card.name}» связана с записью в «Именах»` : `Карточка «${card.name}» больше не связана с «Именами»`);
      return target;
    },
    onLibraryDuplicateCharacter: ({ cardId, folderId }) => {
      const { library: next, character } = duplicateLibraryCharacter(library.get(), cardId, { folderId });
      library.set(next);
      return character;
    },
    /** The anketas found in a picked folder, to choose from: [{ path (of the file), name, folder, sections, exists }]. exists = the library has this note's card already. */
    onLibraryPreviewNotes: ({ files }) => {
      const have = library.get().characters ?? [];
      const lower = value => String(value).toLocaleLowerCase('ru-RU');
      return (files ?? []).map(file => ({ file, draft: draftFromQuestionnaire(file.path, file.text) })).filter(item => item.draft).map(({ file, draft }) => ({
        path: file.path, name: draft.name, folder: draft.folderPath.join(' › '), sections: draft.sections.length,
        exists: have.some(card => (card.source && lower(card.source.path) === lower(draft.source.path)) || lower(card.name) === lower(draft.name)),
      }));
    },
    /** Compare the cards that came from notes with the notes read now (files: [{ path, text }]): the changed ones are marked. */
    onLibraryCheckNotes: ({ files }) => {
      const result = checkCardSources(library.get(), draftsFromQuestionnaires(files));
      library.set(result.library);
      return { changed: result.changed, same: result.same, missing: result.missing };
    },
    /** Load cards again from their notes, in Russian as written; cardIds = which ones (empty: all that are marked changed). */
    onLibraryRefreshCards: async ({ files, cardIds }) => {
      const noteOf = noteFinder(draftsFromQuestionnaires(files));
      const wanted = cardIds?.length ? new Set(cardIds) : null;
      let next = library.get();
      const updated = [];
      const skipped = [];
      for (const card of next.characters ?? []) {
        if (!card.source || (wanted ? !wanted.has(card.id) : !card.source.stale)) continue;
        const draft = noteOf(card);
        if (!draft) { skipped.push(card.name); continue; }
        next = refreshLibraryCharacter(next, card.id, draft);
        updated.push(card.id);
      }
      if (updated.length) { library.set(next); shareNames(updated); await syncOpenChat(); }
      deps.notify?.(`Карточки из заметок: обновлено ${updated.length}${skipped.length ? `, заметки не найдены: ${skipped.length}` : ''}`);
      return { updated, skipped };
    },
    /** A card into English, section by section; the card then holds the translation (the Russian stays in the note). */
    onLibraryTranslateCard: async ({ cardId }) => {
      if (!deps.translateSections) throw new Error('Перевод здесь не подключён.');
      const card = (library.get().characters ?? []).find(candidate => candidate.id === cardId);
      if (!card) throw new RangeError('Такой карточки нет');
      if (card.lang === 'en') throw new Error('Карточка уже на английском. Чтобы получить новый перевод, сначала загрузите русский текст («Обновить из Obsidian»).');
      const sent = card.sections.map(section => ({ id: section.id, title: section.title, text: section.text }));
      const translated = new Map((await deps.translateSections(sent)).map(item => [item.id, item.text]));
      const now = (library.get().characters ?? []).find(candidate => candidate.id === cardId);
      if (!now || now.sections.some(section => sent.find(item => item.id === section.id)?.text !== section.text)) throw new Error('Карточка изменилась во время перевода — запустите перевод ещё раз.');
      library.set(updateLibraryCharacter(library.get(), cardId, { sections: now.sections.map(section => ({ ...section, text: translated.get(section.id) ?? section.text })), lang: 'en' }));
      await syncOpenChat();
      deps.notify?.(`Карточка «${card.name}» переведена на английский`);
      return { translated: translated.size };
    },
    /** Several cards into English, one after another; one that fails does not stop the rest. */
    onLibraryTranslateCards: async ({ cardIds }) => {
      const cards = (library.get().characters ?? []).filter(card => cardIds?.includes(card.id) && card.lang !== 'en');
      if (!cards.length) return { done: [], failed: [] };
      const sections = cards.reduce((sum, card) => sum + card.sections.filter(section => section.text.trim()).length, 0);
      if (!await confirm('Перевод карточек', `Перевести на английский карточек: ${cards.length}. Это около ${sections} запросов к модели, по одному на раздел; русский текст в карточках заменится переводом (оригиналы в Obsidian останутся). Продолжить?`)) return { done: [], failed: [] };
      const done = [];
      const failed = [];
      for (const card of cards) {
        try { await callbacks.onLibraryTranslateCard({ cardId: card.id }); done.push(card.id); }
        catch (error) { failed.push({ id: card.id, name: card.name, why: error?.message ?? String(error) }); deps.log?.('warn', `Карточка «${card.name}» не переведена`, error); }
      }
      if (failed.length) throw new Error(`Переведено: ${done.length}. Не удалось: ${failed.map(item => `${item.name} (${item.why})`).join('; ')}`);
      return { done, failed };
    },
    /** Places, things or cards (kind) into another folder; the ones whose name is taken there stay and are reported. */
    onLibraryMoveEntries: ({ kind = 'places', ids, folderId }) => {
      const result = moveLibraryEntries(library.get(), kind, ids, folderId);
      if (result.moved.length) library.set(result.library);
      deps.notify?.(`${LABELS[kind]}: перенесено ${result.moved.length}${result.skipped.length ? `, осталось на месте: ${result.skipped.length} (имя уже занято в той папке)` : ''}`);
      return { moved: result.moved, skipped: result.skipped };
    },
    /** Several places, things or cards at once, after one question. → how many were deleted. */
    onLibraryRemoveEntries: async ({ kind = 'places', ids }) => {
      if (kind === 'characters') return callbacks.onLibraryRemoveCards({ cardIds: ids });
      const wanted = new Set(ids ?? []);
      const doomed = entriesOf(kind).filter(entry => wanted.has(entry.id));
      if (!doomed.length) return 0;
      const names = doomed.slice(0, 8).map(entry => `«${entry.name}»`).join(', ');
      const what = kind === 'items' ? 'вещей' : 'локаций';
      if (!await confirm(kind === 'items' ? 'Удалить вещи' : 'Удалить локации', `Будет удалено ${what}: ${doomed.length} (${names}${doomed.length > 8 ? ' и другие' : ''}). В открытом чате они останутся как обычные, уже без связи с библиотекой. Продолжить?`)) return 0;
      let next = library.get();
      if (kind === 'items') {
        const keepDescriptions = descriptionsOf(wanted);
        for (const entry of doomed) next = removeLibraryItem(next, entry.id);
        library.set(next);
        await syncOpenChat(undefined, keepDescriptions);
      } else {
        const keep = traitsOf(wanted);
        for (const entry of doomed) next = removeLocation(next, entry.id);
        library.set(next);
        await syncOpenChat(keep);
      }
      await forgetImages(doomed.map(entry => entry.image));
      return doomed.length;
    },
    /** One place or thing into English. */
    onLibraryTranslateEntry: async ({ kind = 'places', id }) => {
      await translateEntry(kind, id);
      deps.notify?.('Переведено на английский');
      return true;
    },
    /** Several at once (cards go the card way); one that fails does not stop the rest. */
    onLibraryTranslateEntries: async ({ kind = 'places', ids }) => {
      if (kind === 'characters') return callbacks.onLibraryTranslateCards({ cardIds: ids });
      const wanted = new Set(ids ?? []);
      const todo = entriesOf(kind).filter(entry => wanted.has(entry.id) && entry.lang !== 'en' && (entry.description.trim() || (entry.traits ?? []).length));
      if (!todo.length) return { done: [], failed: [] };
      if (!await confirm('Перевод на английский', `Перевести на английский: ${todo.length}. Это запросы к модели (описание и черты), текст в библиотеке заменится переводом. Продолжить?`)) return { done: [], failed: [] };
      const done = [];
      const failed = [];
      for (const entry of todo) {
        try { await translateEntry(kind, entry.id); done.push(entry.id); }
        catch (error) { failed.push({ id: entry.id, name: entry.name, why: error?.message ?? String(error) }); deps.log?.('warn', `«${entry.name}» не переведена`, error); }
      }
      if (failed.length) throw new Error(`Переведено: ${done.length}. Не удалось: ${failed.map(item => `${item.name} (${item.why})`).join('; ')}`);
      return { done, failed };
    },
    /** Several cards into another folder; the ones whose name is taken there stay and are reported. */
    onLibraryMoveCards: ({ cardIds, folderId }) => {
      const result = moveLibraryCharacters(library.get(), cardIds, folderId);
      if (result.moved.length) library.set(result.library);
      deps.notify?.(`Карточек перенесено: ${result.moved.length}${result.skipped.length ? `, осталось на месте: ${result.skipped.length} (имя уже занято в той папке)` : ''}`);
      return { moved: result.moved, skipped: result.skipped };
    },
    /** Several cards at once, after one question. */
    onLibraryRemoveCards: async ({ cardIds }) => {
      const wanted = new Set(cardIds ?? []);
      const doomed = (library.get().characters ?? []).filter(card => wanted.has(card.id));
      if (!doomed.length) return 0;
      const names = doomed.slice(0, 8).map(card => `«${card.name}»`).join(', ');
      if (!await confirm('Удалить карточки', `Будет удалено карточек: ${doomed.length} (${names}${doomed.length > 8 ? ' и другие' : ''}). Персонажи в открытом чате останутся, но без карточек. Продолжить?`)) return 0;
      let next = library.get();
      for (const card of doomed) next = removeLibraryCharacter(next, card.id);
      library.set(next);
      await syncOpenChat();
      await forgetImages(doomed.map(card => card.image));
      return doomed.length;
    },
    onLibraryRemoveCharacter: async ({ cardId }) => {
      const card = (library.get().characters ?? []).find(candidate => candidate.id === cardId);
      if (!card) return false;
      const ok = await confirm('Удалить карточку', `Карточка «${card.name}» будет удалена из библиотеки. Персонаж в открытом чате останется, но без карточки. Продолжить?`);
      if (!ok) return false;
      library.set(removeLibraryCharacter(library.get(), cardId));
      await syncOpenChat();
      await forgetImages([card.image]);
      return true;
    },

    /** A new place, thing or card from a picture, in `folderId`; `describe`: ask the model right away. */
    onLibraryAddFromImage: async ({ kind = 'places', folderId, imageDataUrl, describe: describeNow = false }) => {
      if (!folderId) throw new Error('Сначала откройте папку.');
      const image = await deps.upload(imageDataUrl, uniqueId(IDS[kind] ?? 'place'));
      let entry;
      try {
        const fields = { folderId, name: kind === 'characters' ? freeCardName(folderId, PLACEHOLDERS[kind]) : PLACEHOLDERS[kind], image };
        const result = kind === 'characters' ? addLibraryCharacter(library.get(), fields) : kind === 'items' ? addLibraryItem(library.get(), fields) : addLocation(library.get(), fields);
        library.set(result.library);
        entry = result.character ?? result.item ?? result.location;
      } catch (error) {
        await forgetImages([image]);
        throw error;
      }
      if (describeNow && kind !== 'characters') {
        try { return await describe(kind, entry.id); }
        catch (error) { throw new Error(`Добавлено, но описать картинку не вышло: ${error.message}`); }
      }
      return entry;
    },
    onLibrarySetImage: async ({ kind = 'places', id, imageDataUrl }) => {
      const old = entryOf(kind, id).image ?? '';
      const image = await deps.upload(imageDataUrl, uniqueId(IDS[kind] ?? 'place'));
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
    /** The entries of a book to pick from; for cards, the characters whose sheets («[ Name ] - Section») the book holds. */
    onLibraryLorebookEntries: async ({ book, kind = 'places' }) => (kind === 'characters' ? listLorebookCharacters(await deps.loadBook(book)) : listLorebookEntries(await deps.loadBook(book))),
    onLibraryImportLorebook: async ({ book, uids, folderId, kind = 'places' }) => {
      // No folder open: a folder named after the lorebook.
      const loaded = await deps.loadBook(book);
      const drafts = kind === 'characters' ? draftsFromLorebookCharacters(loaded, uids?.length ? uids : null) : draftsFromLorebook(loaded, uids ?? null);
      const result = addDraftsOf(kind, drafts, folderFor(folderId, book));
      library.set(result.library);
      deps.notify?.(`${LABELS[kind]} из лорбука «${book}»: ${summary(result)}`);
      return result;
    },
    /** files: [{ path: webkitRelativePath, text }] from a picked folder; subfolders become folders. */
    onLibraryImportMarkdown: ({ files, folderId, kind = 'places' }) => {
      // No folder open: a folder named after the picked folder of notes.
      const drafts = kind === 'characters' ? draftsFromQuestionnaires(files) : draftsFromMarkdownFiles(files);
      if (!drafts.length) throw new Error(kind === 'characters' ? 'В выбранной папке нет анкет: нужны заметки .md с разделами «### …».' : 'В выбранной папке нет заметок .md.');
      const result = addDraftsOf(kind, drafts, folderFor(folderId, String(files?.[0]?.path ?? '').split(/[\\/]/)[0]));
      library.set(result.library);
      deps.notify?.(`${LABELS[kind]} из заметок: ${summary(result)}`);
      return result;
    },
  };
  return callbacks;
}

/** Operations that bring a just-opened chat in line with the library (names, geography, removed entries). */
export function syncChat(state, store) {
  return [...syncOperations(state, store.get()), ...syncItemOperations(state, store.get())];
}

/** The same for the cards attached to a just-opened chat: the state itself, or the very same state when nothing changed. */
export function syncChatCards(state, store) {
  return syncCardLinks(state, store.get());
}
