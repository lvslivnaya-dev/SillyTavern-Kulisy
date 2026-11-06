/**
 * Library things meet a chat — the same idea as location-links.js.
 *
 * Switching a library thing on for a chat puts an item into the chat's world
 * (state.world.items, journaled) with `libraryId` pointing back. Who holds it, where
 * it lies, whether it is secret — that is the chat's. The name follows the library;
 * the description is read from there (effectiveItem), so editing the thing in the
 * library shows up in every chat that uses it.
 *
 * Switching it off removes the chat item. Deleting the thing from the library turns
 * the open chat's item into an ordinary one (its description kept as a note).
 */
import { createOperation, normalizeAlias, uniqueId } from '../core/index.js';

const NOTE_MAX = 300;

function meta(reason) {
  return { transactionId: uniqueId('library'), reason, timestamp: new Date().toISOString() };
}

function sameText(left, right) {
  return String(left).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === String(right).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** libraryId → chat item for every library thing switched on in this chat. */
export function linkedItems(state) {
  const map = new Map();
  for (const item of state.world?.items ?? []) if (item.libraryId) map.set(item.libraryId, item);
  return map;
}

/** A chat item with its library entry: { ...item, aliases, description, fromLibrary }. */
export function effectiveItem(item, library) {
  const entry = item?.libraryId ? (library?.items ?? []).find(candidate => candidate.id === item.libraryId) : null;
  if (!entry) return { ...item, aliases: [], description: '', fromLibrary: false };
  return { ...item, name: entry.name, aliases: entry.aliases, description: entry.description, fromLibrary: true };
}

/** The character a library thing usually belongs to, by name or alias, or ''. */
export function ownerByName(state, ownerName) {
  const wanted = normalizeAlias(ownerName ?? '');
  if (!wanted) return '';
  const found = Object.values(state.entities ?? {}).find(entity => [entity.name, ...(entity.aliases ?? [])].some(name => normalizeAlias(name) === wanted));
  return found?.id ?? '';
}

/** The chat item a library thing becomes (not yet journaled). */
export function itemFromLibrary(state, entry) {
  const ownerId = ownerByName(state, entry.ownerName);
  return {
    id: uniqueId('item'), name: entry.name, libraryId: entry.id, importance: entry.importance ?? 'normal',
    ...(ownerId ? { ownerId } : {}),
  };
}

/** Operations that switch library things on in this chat. */
export function itemLinkOperations(state, library, libraryIds) {
  const linked = linkedItems(state);
  const byId = new Map((library?.items ?? []).map(item => [item.id, item]));
  const entries = [...new Set(libraryIds ?? [])].filter(id => !linked.has(id)).map(id => byId.get(id)).filter(Boolean);
  if (!entries.length) return [];
  const metadata = meta(`Подключены вещи: ${entries.map(entry => entry.name).join(', ')}`);
  return entries.map(entry => createOperation('item.add', { item: itemFromLibrary(state, entry) }, metadata));
}

/** Operations that switch library things off in this chat (their chat items go). */
export function itemUnlinkOperations(state, libraryIds) {
  const linked = linkedItems(state);
  const gone = [...new Set(libraryIds ?? [])].map(id => linked.get(id)).filter(Boolean);
  if (!gone.length) return [];
  const metadata = meta(`Отключены вещи: ${gone.map(item => item.name).join(', ')}`);
  return gone.map(item => createOperation('item.remove', { itemId: item.id }, metadata));
}

/** A library thing the text names (by name or another name), or null. */
export function findItemInLibrary(library, name) {
  return (library?.items ?? []).find(item => [item.name, ...(item.aliases ?? [])].some(candidate => sameText(candidate, name))) ?? null;
}

/**
 * Bring chat items in line with the library: names follow it. An item whose thing
 * left the library becomes the chat's own (`keepDescriptions`: libraryId → the
 * description to keep as its note, when the caller still has it).
 */
export function syncItemOperations(state, library, { keepDescriptions = new Map() } = {}) {
  const operations = [];
  const byId = new Map((library?.items ?? []).map(item => [item.id, item]));
  const metadata = meta('Вещи обновлены по библиотеке');
  for (const [libraryId, item] of linkedItems(state)) {
    const entry = byId.get(libraryId);
    if (!entry) {
      const kept = keepDescriptions.get(libraryId);
      operations.push(createOperation('item.update', { itemId: item.id, changes: { libraryId: '', ...(kept && !item.note ? { note: clip(kept, NOTE_MAX) } : {}) } }, metadata));
      continue;
    }
    if (entry.name !== item.name) operations.push(createOperation('item.update', { itemId: item.id, changes: { name: entry.name } }, metadata));
  }
  return operations;
}

/**
 * Saving a chat item into the library: the entry gets its name, importance and the
 * name of who holds it now (as the usual owner). The chat item then points at it.
 * Returns { draft, operations(libraryId) }.
 */
export function saveItemDraft(state, itemId) {
  const item = (state.world?.items ?? []).find(candidate => candidate.id === itemId);
  if (!item) throw new RangeError('Такой вещи в чате нет');
  if (item.libraryId) throw new RangeError('Эта вещь уже в библиотеке');
  const ownerName = item.ownerId ? (state.entities?.[item.ownerId]?.name ?? '') : '';
  return {
    draft: { name: item.name, importance: item.importance, description: '', aliases: [], ...(ownerName ? { ownerName } : {}) },
    operations: libraryId => [createOperation('item.update', { itemId: item.id, changes: { libraryId } }, meta(`Сохранено в библиотеку: ${item.name}`))],
  };
}
