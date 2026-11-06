/**
 * The library: places and things the user keeps across chats, sorted into folders
 * like a gallery (one folder — say, a fandom — holds both its places and its things). It lives in the extension settings, not in a chat, so it is not
 * journaled and never rolls back with a swipe.
 *
 * library = {
 *   version: 1,
 *   folders:   [{ id, name, parentId? }]                      folders may nest
 *   locations: [{ id, folderId, name, aliases[], description, traits[], parentId?, image?, autoName? }]
 *   items:     [{ id, folderId, name, aliases[], description, importance, ownerName?, image?, autoName? }]
 *
 * `image` is a picture on the SillyTavern server (user/images/…), like a wardrobe card's;
 * `autoName`: the name came from the model, so describing the picture again may rename it.
 * }
 *
 * A library thing is a template: switched on in a chat it becomes that chat's item
 * (who holds it, where it lies — those belong to the chat). `ownerName` is who it
 * usually belongs to: the chat item goes to the character of that name, if there is one.
 *
 * Rule: a location or a thing in the library always sits in a folder — first a folder, then a
 * place. (A place the chronicler found in one chat stays in that chat until it is
 * saved into a folder.) `parentId` is geography (the bar is in Roppongi), folders are
 * just shelves (a fandom, a city, a story).
 *
 * Every function returns a new library and never mutates its input.
 */
import { uniqueId } from './ids.js';
import { ITEM_IMPORTANCE } from './world.js';
import { cleanImagePath } from './wardrobe.js';

export const LIBRARY_VERSION = 1;
export const LIBRARY_LIMITS = Object.freeze({
  folders: 300, locations: 2000, items: 3000, name: 120, alias: 60, aliases: 12, description: 8000, itemDescription: 2000, traits: 20, trait: 300,
});
/** Where locations whose folder went missing (a broken import, a hand-edited file) are rescued to. */
export const RESCUE_FOLDER_NAME = 'Восстановленные';

export function emptyLibrary() {
  return { version: LIBRARY_VERSION, folders: [], locations: [], items: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Description keeps its line breaks: it is prose the user wrote. */
function cleanProse(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function cleanList(values, max, itemMax) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value, itemMax);
    const key = text.toLocaleLowerCase('ru-RU');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function requireName(value) {
  const name = cleanText(value, LIBRARY_LIMITS.name);
  if (!name) throw new TypeError('Нужно название');
  return name;
}

/** Walking up from `startId` never reaches `forbiddenId` (no folder inside itself, no place inside itself). */
function noLoop(list, startId, forbiddenId) {
  const visited = new Set();
  let current = startId;
  while (current) {
    if (current === forbiddenId || visited.has(current)) return false;
    visited.add(current);
    current = list.find(item => item.id === current)?.parentId ?? '';
  }
  return true;
}

/** Repair whatever was loaded from settings or a file: drops junk, rescues orphans, breaks loops. */
export function normalizeLibrary(input) {
  const library = emptyLibrary();
  if (!input || typeof input !== 'object') return library;
  const folderIds = new Set();
  for (const raw of Array.isArray(input.folders) ? input.folders : []) {
    const id = String(raw?.id ?? '');
    const name = cleanText(raw?.name, LIBRARY_LIMITS.name);
    if (!id || !name || folderIds.has(id) || library.folders.length >= LIBRARY_LIMITS.folders) continue;
    folderIds.add(id);
    library.folders.push({ id, name, ...(raw.parentId ? { parentId: String(raw.parentId) } : {}) });
  }
  for (const folder of library.folders) {
    if (folder.parentId && (!folderIds.has(folder.parentId) || !noLoop(library.folders, folder.parentId, folder.id))) delete folder.parentId;
  }
  const locationIds = new Set();
  let rescueId = '';
  /** The folder of an entry, or the rescue folder when its own is gone. */
  const shelfOf = raw => {
    const folderId = String(raw?.folderId ?? '');
    if (folderIds.has(folderId)) return folderId;
    if (!rescueId) {
      rescueId = library.folders.find(folder => folder.name === RESCUE_FOLDER_NAME && !folder.parentId)?.id ?? '';
      if (!rescueId) {
        rescueId = uniqueId('folder');
        library.folders.push({ id: rescueId, name: RESCUE_FOLDER_NAME });
        folderIds.add(rescueId);
      }
    }
    return rescueId;
  };
  for (const raw of Array.isArray(input.locations) ? input.locations : []) {
    const id = String(raw?.id ?? '');
    const name = cleanText(raw?.name, LIBRARY_LIMITS.name);
    if (!id || !name || locationIds.has(id) || library.locations.length >= LIBRARY_LIMITS.locations) continue;
    const folderId = shelfOf(raw);
    locationIds.add(id);
    library.locations.push({
      id, folderId, name,
      aliases: cleanList(raw.aliases, LIBRARY_LIMITS.aliases, LIBRARY_LIMITS.alias),
      description: cleanProse(raw.description, LIBRARY_LIMITS.description),
      traits: cleanList(raw.traits, LIBRARY_LIMITS.traits, LIBRARY_LIMITS.trait),
      ...(raw.parentId ? { parentId: String(raw.parentId) } : {}),
      ...picture(raw),
    });
  }
  for (const location of library.locations) {
    if (location.parentId && (!locationIds.has(location.parentId) || !noLoop(library.locations, location.parentId, location.id))) delete location.parentId;
  }
  const itemIds = new Set();
  for (const raw of Array.isArray(input.items) ? input.items : []) {
    const id = String(raw?.id ?? '');
    const name = cleanText(raw?.name, LIBRARY_LIMITS.name);
    if (!id || !name || itemIds.has(id) || library.items.length >= LIBRARY_LIMITS.items) continue;
    itemIds.add(id);
    library.items.push(itemEntry(id, shelfOf(raw), name, raw));
  }
  return library;
}

/** The picture fields of an entry: { image?, autoName? }. */
function picture(raw) {
  const image = cleanImagePath(raw?.image);
  return { ...(image ? { image } : {}), ...(raw?.autoName ? { autoName: true } : {}) };
}

/** image / autoName changes: a name typed by hand drops autoName. */
function applyPicture(entry, fields, oldName) {
  if (fields.image !== undefined) {
    const image = cleanImagePath(fields.image);
    if (image) entry.image = image; else delete entry.image;
  }
  if (fields.autoName) entry.autoName = true;
  else if (fields.autoName === false || (fields.name != null && entry.name !== oldName)) delete entry.autoName;
}

/** A clean library thing from loose fields. */
function itemEntry(id, folderId, name, raw) {
  const ownerName = cleanText(raw?.ownerName, LIBRARY_LIMITS.name);
  return {
    id, folderId, name,
    aliases: cleanList(raw?.aliases, LIBRARY_LIMITS.aliases, LIBRARY_LIMITS.alias),
    description: cleanProse(raw?.description, LIBRARY_LIMITS.itemDescription),
    importance: ITEM_IMPORTANCE.includes(raw?.importance) ? raw.importance : 'normal',
    ...(ownerName ? { ownerName } : {}),
    ...picture(raw),
  };
}

// ---- Folders --------------------------------------------------------------

export function addFolder(library, { name, parentId = '' } = {}) {
  const next = clone(library);
  if (next.folders.length >= LIBRARY_LIMITS.folders) throw new RangeError('Слишком много папок');
  if (parentId && !next.folders.some(folder => folder.id === parentId)) throw new RangeError('Такой папки нет');
  const folder = { id: uniqueId('folder'), name: requireName(name), ...(parentId ? { parentId } : {}) };
  next.folders.push(folder);
  return { library: next, folder };
}

export function updateFolder(library, folderId, changes = {}) {
  const next = clone(library);
  const folder = next.folders.find(candidate => candidate.id === folderId);
  if (!folder) throw new RangeError('Такой папки нет');
  if (changes.name != null) folder.name = requireName(changes.name);
  if (changes.parentId !== undefined) {
    const parentId = String(changes.parentId ?? '');
    if (parentId && !next.folders.some(candidate => candidate.id === parentId)) throw new RangeError('Такой папки нет');
    if (parentId && !noLoop(next.folders, parentId, folder.id)) throw new RangeError('Папку нельзя положить внутрь неё самой');
    if (parentId) folder.parentId = parentId; else delete folder.parentId;
  }
  return next;
}

/** IDs of a folder and every folder inside it. */
export function folderWithDescendants(library, folderId) {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of library.folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); grew = true; }
    }
  }
  return ids;
}

/**
 * Remove a folder. A folder with places, things or folders inside is removed only
 * with `withContents: true` (the UI asks first) — then everything inside goes too.
 * Returns { library, removedLocationIds, removedItemIds } so chats linked to them can be told.
 */
export function removeFolder(library, folderId, { withContents = false } = {}) {
  if (!library.folders.some(folder => folder.id === folderId)) throw new RangeError('Такой папки нет');
  const ids = folderWithDescendants(library, folderId);
  const inside = library.locations.filter(location => ids.has(location.folderId));
  const things = (library.items ?? []).filter(item => ids.has(item.folderId));
  if (!withContents && (inside.length || things.length || ids.size > 1)) throw new RangeError('Папка не пуста');
  const removed = new Set(inside.map(location => location.id));
  const next = clone(library);
  next.folders = next.folders.filter(folder => !ids.has(folder.id));
  next.locations = next.locations.filter(location => !removed.has(location.id));
  next.items = (next.items ?? []).filter(item => !ids.has(item.folderId));
  for (const location of next.locations) if (removed.has(location.parentId)) delete location.parentId;
  return { library: next, removedLocationIds: [...removed], removedItemIds: things.map(item => item.id) };
}

// ---- Locations ------------------------------------------------------------

function applyLocationFields(next, location, fields) {
  const oldName = location.name;
  if (fields.name != null) location.name = requireName(fields.name);
  if (fields.folderId != null) {
    if (!next.folders.some(folder => folder.id === fields.folderId)) throw new RangeError('Сначала выберите папку');
    location.folderId = fields.folderId;
  }
  if (fields.aliases != null) location.aliases = cleanList(fields.aliases, LIBRARY_LIMITS.aliases, LIBRARY_LIMITS.alias);
  if (fields.description != null) location.description = cleanProse(fields.description, LIBRARY_LIMITS.description);
  if (fields.traits != null) location.traits = cleanList(fields.traits, LIBRARY_LIMITS.traits, LIBRARY_LIMITS.trait);
  if (fields.parentId !== undefined) {
    const parentId = String(fields.parentId ?? '');
    if (parentId && !next.locations.some(candidate => candidate.id === parentId)) throw new RangeError('Такой локации нет');
    if (parentId && !noLoop(next.locations, parentId, location.id)) throw new RangeError('Место не может находиться внутри самого себя');
    if (parentId) location.parentId = parentId; else delete location.parentId;
  }
  applyPicture(location, fields, oldName);
}

/** Add a place. It must name an existing folder: there are no loose places in the library. */
export function addLocation(library, fields = {}) {
  const next = clone(library);
  if (next.locations.length >= LIBRARY_LIMITS.locations) throw new RangeError('Слишком много локаций');
  if (!fields.folderId) throw new RangeError('Сначала выберите папку');
  const location = { id: uniqueId('place'), folderId: '', name: '', aliases: [], description: '', traits: [] };
  applyLocationFields(next, location, { name: fields.name ?? '', ...fields });
  next.locations.push(location);
  return { library: next, location };
}

export function updateLocation(library, locationId, changes = {}) {
  const next = clone(library);
  const location = next.locations.find(candidate => candidate.id === locationId);
  if (!location) throw new RangeError('Такой локации нет');
  applyLocationFields(next, location, changes);
  return next;
}

/** Copy a place into the same folder (or another): a quick way to make "the same bar, but the upstairs". */
export function duplicateLocation(library, locationId, { folderId } = {}) {
  const source = library.locations.find(candidate => candidate.id === locationId);
  if (!source) throw new RangeError('Такой локации нет');
  const { id, ...fields } = clone(source);
  return addLocation(library, { ...fields, name: `${source.name} (копия)`.slice(0, LIBRARY_LIMITS.name), folderId: folderId ?? source.folderId });
}

export function removeLocation(library, locationId) {
  const next = clone(library);
  next.locations = next.locations.filter(location => location.id !== locationId);
  for (const location of next.locations) if (location.parentId === locationId) delete location.parentId;
  return next;
}

// ---- Things -----------------------------------------------------------------

function applyItemFields(next, item, fields) {
  const oldName = item.name;
  if (fields.name != null) item.name = requireName(fields.name);
  if (fields.folderId != null) {
    if (!next.folders.some(folder => folder.id === fields.folderId)) throw new RangeError('Сначала выберите папку');
    item.folderId = fields.folderId;
  }
  if (fields.aliases != null) item.aliases = cleanList(fields.aliases, LIBRARY_LIMITS.aliases, LIBRARY_LIMITS.alias);
  if (fields.description != null) item.description = cleanProse(fields.description, LIBRARY_LIMITS.itemDescription);
  if (fields.importance != null) item.importance = ITEM_IMPORTANCE.includes(fields.importance) ? fields.importance : 'normal';
  if (fields.ownerName !== undefined) {
    const ownerName = cleanText(fields.ownerName, LIBRARY_LIMITS.name);
    if (ownerName) item.ownerName = ownerName; else delete item.ownerName;
  }
  applyPicture(item, fields, oldName);
}

/** Add a thing. Like a place, it must sit in an existing folder. */
export function addLibraryItem(library, fields = {}) {
  const next = clone(library);
  next.items ??= [];
  if (next.items.length >= LIBRARY_LIMITS.items) throw new RangeError('Слишком много вещей');
  if (!fields.folderId) throw new RangeError('Сначала выберите папку');
  const item = { id: uniqueId('thing'), folderId: '', name: '', aliases: [], description: '', importance: 'normal' };
  applyItemFields(next, item, { name: fields.name ?? '', ...fields });
  next.items.push(item);
  return { library: next, item };
}

export function updateLibraryItem(library, itemId, changes = {}) {
  const next = clone(library);
  const item = (next.items ?? []).find(candidate => candidate.id === itemId);
  if (!item) throw new RangeError('Такой вещи нет');
  applyItemFields(next, item, changes);
  return next;
}

export function removeLibraryItem(library, itemId) {
  const next = clone(library);
  next.items = (next.items ?? []).filter(item => item.id !== itemId);
  return next;
}

/** Things whose name, alias, description or usual owner contains the query. */
export function searchLibraryItems(library, query) {
  const wanted = cleanText(query, 200).toLocaleLowerCase('ru-RU');
  if (!wanted) return [];
  return (library.items ?? []).filter(item => [item.name, ...item.aliases, item.description, item.ownerName ?? '']
    .some(text => text.toLocaleLowerCase('ru-RU').includes(wanted)));
}

// ---- Queries ---------------------------------------------------------------

/** What a gallery page shows: the folders, places and things directly inside `folderId` ('' = the top). */
export function folderContents(library, folderId = '') {
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  return {
    folders: library.folders.filter(folder => (folder.parentId ?? '') === folderId).sort(byName),
    locations: folderId ? library.locations.filter(location => location.folderId === folderId).sort(byName) : [],
    items: folderId ? (library.items ?? []).filter(item => item.folderId === folderId).sort(byName) : [],
  };
}

/** Breadcrumbs of a folder from the top: [{ id, name }, ...]. */
export function folderPath(library, folderId) {
  const path = [];
  const visited = new Set();
  let current = library.folders.find(folder => folder.id === folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? library.folders.find(folder => folder.id === current.parentId) : null;
  }
  return path;
}

/** Places whose name, alias, description or trait contains the query (case-insensitive). */
export function searchLocations(library, query) {
  const wanted = cleanText(query, 200).toLocaleLowerCase('ru-RU');
  if (!wanted) return [];
  return library.locations.filter(location => [location.name, ...location.aliases, location.description, ...location.traits]
    .some(text => text.toLocaleLowerCase('ru-RU').includes(wanted)));
}

// ---- Export, import, drafts --------------------------------------------------

export const LIBRARY_EXPORT_KIND = 'kulisy-locations';

/** The whole library, or one folder with everything inside it, as a shareable object. */
export function exportLibrary(library, folderId = '') {
  if (!folderId) return { kind: LIBRARY_EXPORT_KIND, version: LIBRARY_VERSION, ...clone(library) };
  if (!library.folders.some(folder => folder.id === folderId)) throw new RangeError('Такой папки нет');
  const ids = folderWithDescendants(library, folderId);
  const folders = clone(library.folders.filter(folder => ids.has(folder.id)));
  // The exported folder becomes a top-level one in the file.
  for (const folder of folders) if (folder.id === folderId) delete folder.parentId;
  const locations = clone(library.locations.filter(location => ids.has(location.folderId)));
  const kept = new Set(locations.map(location => location.id));
  for (const location of locations) if (location.parentId && !kept.has(location.parentId)) delete location.parentId;
  const items = clone((library.items ?? []).filter(item => ids.has(item.folderId)));
  return { kind: LIBRARY_EXPORT_KIND, version: LIBRARY_VERSION, folders, locations, items };
}

function sameName(left, right) {
  return String(left).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === String(right).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** The folder named `name` directly inside `parentId` ('' = top), created when missing. */
function ensureFolder(next, name, parentId) {
  const existing = next.folders.find(folder => (folder.parentId ?? '') === parentId && sameName(folder.name, name));
  if (existing) return existing.id;
  if (next.folders.length >= LIBRARY_LIMITS.folders) throw new RangeError('Слишком много папок');
  const folder = { id: uniqueId('folder'), name: requireName(name), ...(parentId ? { parentId } : {}) };
  next.folders.push(folder);
  return folder.id;
}

/**
 * Add drafts — { folderPath: ['Сибуя'], name, aliases, description, traits, parentName? } —
 * into `targetFolderId` ('' only if every draft has a folderPath). Folders on the path are
 * reused by name or created. A place whose name already exists in its folder is skipped,
 * so importing the same thing twice changes nothing.
 * Returns { library, added: [ids], skipped: [names] }.
 */
export function addDrafts(library, drafts, targetFolderId = '') {
  if (targetFolderId && !library.folders.some(folder => folder.id === targetFolderId)) throw new RangeError('Такой папки нет');
  const next = clone(library);
  const added = [];
  const skipped = [];
  const placed = [];
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const name = cleanText(draft?.name, LIBRARY_LIMITS.name);
    if (!name) continue;
    let folderId = targetFolderId;
    for (const step of Array.isArray(draft.folderPath) ? draft.folderPath : []) {
      const stepName = cleanText(step, LIBRARY_LIMITS.name);
      if (stepName) folderId = ensureFolder(next, stepName, folderId);
    }
    if (!folderId) { skipped.push(name); continue; }
    if (next.locations.some(location => location.folderId === folderId && sameName(location.name, name))) { skipped.push(name); continue; }
    if (next.locations.length >= LIBRARY_LIMITS.locations) { skipped.push(name); continue; }
    const location = {
      id: uniqueId('place'), folderId, name,
      aliases: cleanList(draft.aliases, LIBRARY_LIMITS.aliases, LIBRARY_LIMITS.alias),
      description: cleanProse(draft.description, LIBRARY_LIMITS.description),
      traits: cleanList(draft.traits, LIBRARY_LIMITS.traits, LIBRARY_LIMITS.trait),
    };
    next.locations.push(location);
    added.push(location.id);
    placed.push({ location, parentName: cleanText(draft.parentName, LIBRARY_LIMITS.name) });
  }
  // Geography by name, once everything is in: "inside Роппонги" finds the Roppongi card.
  for (const { location, parentName } of placed) {
    if (!parentName) continue;
    const parent = next.locations.find(candidate => candidate.id !== location.id && sameName(candidate.name, parentName));
    if (parent && noLoop(next.locations, parent.id, location.id)) location.parentId = parent.id;
  }
  return { library: next, added, skipped };
}

/**
 * Thing drafts — { folderPath, name, aliases, description, importance?, ownerName? } —
 * the same way as addDrafts: a folder is required, a name already in its folder is skipped.
 */
export function addItemDrafts(library, drafts, targetFolderId = '') {
  if (targetFolderId && !library.folders.some(folder => folder.id === targetFolderId)) throw new RangeError('Такой папки нет');
  const next = clone(library);
  next.items ??= [];
  const added = [];
  const skipped = [];
  for (const draft of Array.isArray(drafts) ? drafts : []) {
    const name = cleanText(draft?.name, LIBRARY_LIMITS.name);
    if (!name) continue;
    let folderId = targetFolderId;
    for (const step of Array.isArray(draft.folderPath) ? draft.folderPath : []) {
      const stepName = cleanText(step, LIBRARY_LIMITS.name);
      if (stepName) folderId = ensureFolder(next, stepName, folderId);
    }
    if (!folderId || next.items.length >= LIBRARY_LIMITS.items
      || next.items.some(item => item.folderId === folderId && sameName(item.name, name))) { skipped.push(name); continue; }
    const item = itemEntry(uniqueId('thing'), folderId, name, draft);
    next.items.push(item);
    added.push(item.id);
  }
  return { library: next, added, skipped };
}

/**
 * Merge an exported file into the library under `targetFolderId` ('' = keep its top
 * folders at the top). Folders are matched by name at each level; places that already
 * exist by name in their folder are skipped. IDs from the file are never trusted.
 */
export function importLibrary(library, data, targetFolderId = '') {
  if (!data || typeof data !== 'object' || (data.kind != null && data.kind !== LIBRARY_EXPORT_KIND)) throw new TypeError('Это не файл библиотеки Кулис');
  const incoming = normalizeLibrary(data);
  const pathOf = folderId => folderPath(incoming, folderId).map(step => step.name);
  const nameById = new Map(incoming.locations.map(location => [location.id, location.name]));
  const drafts = incoming.locations.map(location => ({
    folderPath: pathOf(location.folderId), name: location.name, aliases: location.aliases,
    description: location.description, traits: location.traits, parentName: nameById.get(location.parentId) ?? '',
  }));
  const placed = addDrafts(library, drafts, targetFolderId);
  const things = addItemDrafts(placed.library, incoming.items.map(item => ({ ...item, folderPath: pathOf(item.folderId) })), targetFolderId);
  const result = { library: things.library, added: [...placed.added, ...things.added], skipped: [...placed.skipped, ...things.skipped] };
  // Empty folders of the file are kept too: someone shared a structure to fill.
  for (const folder of incoming.folders) {
    let parentId = targetFolderId;
    for (const step of pathOf(folder.id)) parentId = ensureFolder(result.library, step, parentId);
  }
  return result;
}
