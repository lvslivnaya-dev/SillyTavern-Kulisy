/**
 * The folder of questionnaires (an Obsidian folder) the cards were loaded from, remembered so that Kulisy can look at it again and
 * notice a changed note. Only browsers with the File System Access API (Chrome, Edge) can do that; elsewhere the folder is picked
 * again each time (see library.js, a plain «webkitdirectory» picker).
 *
 * The folder handle is kept in the browser's IndexedDB. The browser asks for permission to read it again from time to time:
 * `access(handle, true)` asks (needs a click), `access(handle, false)` only looks.
 */
const DB_NAME = 'kulisy-notes';
const STORE = 'folders';
const KEY = 'cards';
const MAX_NOTES = 3000;
const MAX_SIZE = 1_000_000;

export const canRememberFolder = () => typeof globalThis.showDirectoryPicker === 'function' && typeof globalThis.indexedDB !== 'undefined';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

/** The remembered folder handle, or null. */
export async function recallFolder() {
  try { return (await run('readonly', store => store.get(KEY))) ?? null; } catch { return null; }
}

export async function rememberFolder(handle) {
  try { await run('readwrite', store => store.put(handle, KEY)); } catch (error) { console.warn('[Kulisy] The notes folder could not be remembered.', error); }
}

export async function forgetFolder() {
  try { await run('readwrite', store => store.delete(KEY)); } catch { /* nothing to forget */ }
}

/** Let the user pick the folder; → handle (null when they cancel). Must be called from a click. */
export async function pickFolder() {
  try { return await globalThis.showDirectoryPicker({ mode: 'read', id: 'kulisy-notes' }); }
  catch (error) { if (error?.name === 'AbortError') return null; throw error; }
}

/** Is the folder readable now? ask = true shows the browser's question (needs a click). */
export async function access(handle, ask = false) {
  if (!handle) return false;
  try {
    if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true;
    return ask ? (await handle.requestPermission({ mode: 'read' })) === 'granted' : false;
  } catch { return false; }
}

/** Every note .md of the folder as { path, text }; the path starts with the folder's name, like a picker's webkitRelativePath. */
export async function readNotes(handle) {
  const files = [];
  async function walk(directory, prefix) {
    for await (const [name, entry] of directory.entries()) {
      if (files.length >= MAX_NOTES) return;
      if (name.startsWith('.')) continue;
      if (entry.kind === 'directory') { await walk(entry, `${prefix}${name}/`); continue; }
      if (!/\.(md|markdown)$/i.test(name)) continue;
      try {
        const file = await entry.getFile();
        if (file.size <= MAX_SIZE) files.push({ path: `${prefix}${name}`, text: await file.text() });
      } catch (error) { console.warn('[Kulisy] A note could not be read.', error); }
    }
  }
  await walk(handle, `${handle.name}/`);
  return files;
}
