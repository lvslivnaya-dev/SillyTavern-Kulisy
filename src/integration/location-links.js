/**
 * The location library meets a chat.
 *
 * Switching a library place on for a chat puts a card for it into the chat's world
 * (state.world.locations, journaled like everything in the chat) with `libraryId`
 * pointing back. The card holds only what belongs to THIS chat: changes ("разбито
 * окно") and features the chronicler found here. Name, description, aliases and the
 * library's features stay in the library and are read from there (effectiveLocation),
 * so editing a place in the library shows up in every chat that uses it.
 *
 * Switching it off removes the chat card. Deleting a place from the library turns
 * its card in the open chat into an ordinary chat card that keeps everything; other
 * chats keep their own findings for it.
 */
import { createOperation, uniqueId } from '../core/index.js';

function meta(reason) {
  return { transactionId: uniqueId('library'), reason, timestamp: new Date().toISOString() };
}

function sameText(left, right) {
  return String(left).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е') === String(right).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

/** libraryId → chat card for every library place switched on in this chat. */
export function linkedCards(state) {
  const map = new Map();
  for (const location of state.world?.locations ?? []) if (location.libraryId) map.set(location.libraryId, location);
  return map;
}

/** What a chat card means with its library entry: { name, aliases, description, traits, notes, ... }. */
export function effectiveLocation(location, library) {
  const entry = location?.libraryId ? library?.locations?.find(item => item.id === location.libraryId) : null;
  if (!entry) return { ...location, aliases: [], description: '', fromLibrary: false };
  const traits = [...entry.traits];
  for (const trait of location.traits ?? []) if (!traits.some(item => sameText(item, trait))) traits.push(trait);
  return { ...location, name: entry.name, aliases: entry.aliases, description: entry.description, traits, fromLibrary: true };
}

/**
 * Payloads of `location.add` that switch library places on in this chat, parents
 * first. The places they sit in (Roppongi for the bar) come along, so the model
 * always gets the whole path.
 */
export function linkPayloads(state, library, libraryIds) {
  const cards = linkedCards(state);
  const byId = new Map((library?.locations ?? []).map(location => [location.id, location]));
  const order = [];
  const queued = new Set();
  const visit = (id, trail = new Set()) => {
    const entry = byId.get(id);
    if (!entry || queued.has(id) || cards.has(id) || trail.has(id)) return;
    trail.add(id);
    if (entry.parentId) visit(entry.parentId, trail);
    queued.add(id);
    order.push(entry);
  };
  for (const id of libraryIds ?? []) visit(id);
  const chatIdOf = new Map([...cards].map(([libraryId, card]) => [libraryId, card.id]));
  for (const entry of order) chatIdOf.set(entry.id, uniqueId('location'));
  return order.map(entry => ({
    item: {
      id: chatIdOf.get(entry.id), name: entry.name, libraryId: entry.id, traits: [],
      ...(entry.parentId && chatIdOf.has(entry.parentId) ? { parentId: chatIdOf.get(entry.parentId) } : {}),
    },
  }));
}

/** Operations that switch library places on in this chat (a manual change, its own transaction). */
export function linkOperations(state, library, libraryIds) {
  const payloads = linkPayloads(state, library, libraryIds);
  if (!payloads.length) return [];
  const metadata = meta(`Подключены локации: ${payloads.map(payload => payload.item.name).join(', ')}`);
  return payloads.map(payload => createOperation('location.add', payload, metadata));
}

/** A library place the text names (by name or another name), or null. */
export function findInLibrary(library, name) {
  return (library?.locations ?? []).find(location => [location.name, ...(location.aliases ?? [])].some(candidate => sameText(candidate, name))) ?? null;
}

/** Operations that switch library places off in this chat (their chat cards go). */
export function unlinkOperations(state, libraryIds) {
  const cards = linkedCards(state);
  const gone = [...new Set(libraryIds ?? [])].map(id => cards.get(id)).filter(Boolean);
  if (!gone.length) return [];
  const metadata = meta(`Отключены локации: ${gone.map(card => card.name).join(', ')}`);
  return gone.map(card => createOperation('location.remove', { locationId: card.id }, metadata));
}

/**
 * Bring the chat cards in line with the library: names and geography follow it.
 * A card whose place left the library becomes a chat card of its own (`keepTraits`:
 * the library features to keep on it, when the caller still has them).
 */
export function syncOperations(state, library, { keepTraits = new Map() } = {}) {
  const operations = [];
  const cards = linkedCards(state);
  const byId = new Map((library?.locations ?? []).map(location => [location.id, location]));
  const metadata = meta('Локации обновлены по библиотеке');
  for (const [libraryId, card] of cards) {
    const entry = byId.get(libraryId);
    if (!entry) {
      const kept = keepTraits.get(libraryId) ?? [];
      const traits = [...kept];
      for (const trait of card.traits) if (!traits.some(item => sameText(item, trait))) traits.push(trait);
      operations.push(createOperation('location.update', { locationId: card.id, changes: { libraryId: '', traits } }, metadata));
      continue;
    }
    const changes = {};
    if (entry.name !== card.name) changes.name = entry.name;
    const parentCard = entry.parentId ? cards.get(entry.parentId) : null;
    const parentId = parentCard?.id ?? '';
    if ((card.parentId ?? '') !== parentId && (parentId || !entry.parentId)) changes.parentId = parentId;
    if (Object.keys(changes).length) operations.push(createOperation('location.update', { locationId: card.id, changes }, metadata));
  }
  return operations;
}

/**
 * Saving a chat card into the library: the library entry gets the card's name and
 * features; the card then points at it and keeps only its chat changes.
 * Returns { draft, operations(libraryId) } — the caller adds the draft, then journals.
 */
export function saveCardDraft(state, locationId) {
  const card = (state.world?.locations ?? []).find(location => location.id === locationId);
  if (!card) throw new RangeError('Такой локации в чате нет');
  if (card.libraryId) throw new RangeError('Эта локация уже в библиотеке');
  return {
    draft: { name: card.name, traits: card.traits, aliases: [], description: '' },
    operations: libraryId => [createOperation('location.update', { locationId: card.id, changes: { libraryId, traits: [] } }, meta(`Сохранено в библиотеку: ${card.name}`))],
  };
}
