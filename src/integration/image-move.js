/**
 * Moving pictures between the two storages (server user/images ↔ a folder on the computer).
 * In the folder, wardrobe pictures go into the tree «Гардероб/<полка>/<пол>/<раздел>/»,
 * named after the card; library pictures into kulisy-library.
 * Copy first, save the new paths, delete the old files last: if anything breaks midway,
 * every card still points at a file that exists.
 */
import { isTreeImage, storageOf } from './wardrobe-images.js';
import { treeDirFor } from './wardrobe-inbox.js';

/** How many pictures each storage holds: { server, folder }. */
export function countImages(wardrobe, library) {
  const counts = { server: 0, folder: 0 };
  for (const { path } of allImages(wardrobe, library)) counts[storageOf(path)] += 1;
  return counts;
}

/** [{ path, card? }] — a wardrobe picture knows its card (for the tree folder and the file name). */
function allImages(wardrobe, library) {
  const seen = new Map();
  for (const card of wardrobe?.cards ?? []) if (card.image && !seen.has(card.image)) seen.set(card.image, { path: card.image, card });
  for (const kind of ['locations', 'items']) for (const entry of library?.[kind] ?? []) if (entry.image && !seen.has(entry.image)) seen.set(entry.image, { path: entry.image });
  return [...seen.values()];
}

/** Does this picture still have to move? Wardrobe pictures in the folder belong in the tree. */
function needsMove({ path, card }, to) {
  if (to === 'server') return storageOf(path) === 'folder';
  return card ? !isTreeImage(path) : storageOf(path) === 'server';
}

/**
 * deps: { getWardrobe(), setWardrobe(next), getLibrary(), setLibrary(next),
 *         copy(path, storage, tree?) → new path (tree: { dir, name } for a wardrobe card going to the folder),
 *         remove(path), log?(level, text, error) }
 * Returns { moved, failed, leftovers } — leftovers are old files that could not be deleted.
 */
export async function moveImages(to, deps) {
  if (to !== 'server' && to !== 'folder') throw new TypeError('Неизвестное хранилище картинок.');
  const pending = allImages(deps.getWardrobe(), deps.getLibrary()).filter(item => needsMove(item, to));
  const renamed = new Map();
  let failed = 0;
  for (const item of pending) {
    const tree = to === 'folder' && item.card ? { dir: treeDirFor(item.card), name: item.card.name || 'картинка' } : null;
    try { renamed.set(item.path, await deps.copy(item.path, to, tree)); }
    catch (error) { failed += 1; deps.log?.('warn', `Картинка не перенеслась: ${item.path}`, error); }
  }
  if (renamed.size) {
    const wardrobe = structuredClone(deps.getWardrobe());
    for (const card of wardrobe.cards ?? []) if (renamed.has(card.image)) card.image = renamed.get(card.image);
    const library = structuredClone(deps.getLibrary());
    for (const kind of ['locations', 'items']) for (const entry of library[kind] ?? []) if (renamed.has(entry.image)) entry.image = renamed.get(entry.image);
    deps.setWardrobe(wardrobe);
    deps.setLibrary(library);
  }
  let leftovers = 0;
  for (const old of renamed.keys()) {
    try { await deps.remove(old); }
    catch (error) { leftovers += 1; deps.log?.('warn', `Старая копия картинки не удалилась: ${old}`, error); }
  }
  return { moved: renamed.size, failed, leftovers };
}
