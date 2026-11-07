/**
 * Pictures of wardrobe cards live on the SillyTavern server as files
 * (user/images/kulisy-wardrobe/…), never inside the settings — a hundred photos
 * in settings.json would slow every save. Only the path is kept on the card.
 *
 * Endpoints (SillyTavern src/endpoints/images.js): POST /api/images/upload
 * { image: base64 without the data: prefix, format, ch_name, filename } → { path };
 * POST /api/images/delete { path } (only under the user's images folder).
 * The folder storage takes the same body at /api/plugins/kulisy-images/upload.
 */

export const WARDROBE_IMAGE_FOLDER = 'kulisy-wardrobe';
/** Pictures of the library's places and things. */
export const LIBRARY_IMAGE_FOLDER = 'kulisy-library';
/** The longest side a stored picture keeps; enough for a card and for a model to look at. */
export const STORED_MAX_SIDE = 1280;
/** What a model gets: smaller, so a request stays well under provider limits. */
export const VISION_MAX_SIDE = 1024;

const FORMATS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** A File (from a picker, a drop or a paste) as a data: URL. */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) { reject(new TypeError('Это не картинка.')); return; }
    if (file.size > 25_000_000) { reject(new RangeError('Картинка больше 25 МБ.')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Картинка не прочиталась.'));
    reader.readAsDataURL(file);
  });
}

/** Scale a picture down so its longest side is at most `maxSide` (never up). JPEG unless it has transparency. */
export async function shrinkDataUrl(dataUrl, maxSide) {
  const image = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error('Картинку не удалось открыть.'));
    node.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const keepAlpha = /^data:image\/(png|webp|gif)/.test(dataUrl);
  if (scale === 1 && /^data:image\/(png|jpeg|webp)/.test(dataUrl)) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Where new pictures go: 'server' (user/images, as always) or 'folder' — a folder on
 * this computer, kept by the server plugin «kulisy-images» (server-plugin/kulisy-images).
 * A card remembers its own path, so pictures of both kinds live side by side.
 */
export const IMAGE_STORAGES = Object.freeze(['server', 'folder']);
export const FOLDER_PLUGIN_BASE = '/api/plugins/kulisy-images';
const FOLDER_PREFIX = 'api/plugins/kulisy-images/';
/** Wardrobe pictures in the folder live in the tree «Гардероб/<полка>/<пол>/<раздел>/». */
export const TREE_PREFIX = 'api/plugins/kulisy-images/wardrobe/';

/** Is this a picture kept in the folder (by the plugin), not in user/images? */
export function isFolderImage(path) {
  return String(path ?? '').replace(/^\/+/, '').startsWith(FOLDER_PREFIX);
}

/** Is this a picture of the wardrobe tree (it lies where the user sees it in Explorer)? */
export function isTreeImage(path) {
  return String(path ?? '').replace(/^\/+/, '').startsWith(TREE_PREFIX);
}

/** 'api/plugins/kulisy-images/wardrobe/Персона/Женское/Платья/a.jpg' → 'Персона/Женское/Платья'. */
export function treeDirOf(path) {
  const relative = String(path ?? '').replace(/^\/+/, '').slice(TREE_PREFIX.length);
  return relative.split('/').slice(0, -1).join('/');
}

/** Which storage a stored path belongs to. */
export function storageOf(path) {
  return isFolderImage(path) ? 'folder' : 'server';
}

async function postJson(context, url, body) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify(body ?? {}) });
  } catch (error) {
    throw new Error(`Нет связи с сервером SillyTavern: ${error?.message ?? error}`);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data };
}

/** base64 (no data: prefix) → stored path, in the chosen storage. */
async function sendImage(context, storage, base64, format, fileName, folder) {
  const url = storage === 'folder' ? `${FOLDER_PLUGIN_BASE}/upload` : '/api/images/upload';
  const { response, data } = await postJson(context, url, { image: base64, format, ch_name: folder, filename: String(fileName).replace(/[^\w-]/g, '_') });
  if (storage === 'folder' && response.status === 404 && !data?.error) throw new Error('Плагин «kulisy-images» не отвечает: он не установлен или выключены серверные плагины. Переключите хранение на «Сервер таверны» или поставьте плагин.');
  if (!response.ok || !data?.path) throw new Error(`Картинка не сохранилась${data?.error ? `: ${data.error}` : ` (HTTP ${response.status})`}.`);
  return String(data.path).replace(/\\/g, '/');
}

/** Store a picture for a card (or, with `folder`, for the library); returns the stored path. */
export async function uploadWardrobeImage(context, dataUrl, fileName, folder = WARDROBE_IMAGE_FOLDER, storage = 'server') {
  const small = await shrinkDataUrl(dataUrl, STORED_MAX_SIDE);
  const mime = small.slice(5, small.indexOf(';'));
  const format = FORMATS[mime];
  if (!format) throw new TypeError('Этот формат картинки не поддерживается: нужен PNG, JPEG, WebP или GIF.');
  return sendImage(context, storage === 'folder' ? 'folder' : 'server', small.slice(small.indexOf(',') + 1), format, fileName, folder);
}

/** Save a wardrobe picture into a folder of the tree ('Персона/Женское/Платья'); returns its path. */
export async function uploadToTree(context, dataUrl, dir, fileName) {
  const small = await shrinkDataUrl(dataUrl, STORED_MAX_SIDE);
  const format = FORMATS[small.slice(5, small.indexOf(';'))];
  if (!format) throw new TypeError('Этот формат картинки не поддерживается: нужен PNG, JPEG, WebP или GIF.');
  return sendTree(context, small.slice(small.indexOf(',') + 1), format, dir, fileName);
}

async function sendTree(context, base64, format, dir, fileName) {
  const { response, data } = await postJson(context, `${FOLDER_PLUGIN_BASE}/tree/upload`, { image: base64, format, dir, filename: String(fileName ?? '') });
  if (response.status === 404 && !data?.error) throw new Error('Плагин «kulisy-images» не отвечает или устарел: скопируйте server-plugin/kulisy-images в SillyTavern/plugins заново и перезапустите таверну.');
  if (!response.ok || !data?.path) throw new Error(`Картинка не сохранилась в папку${data?.error ? `: ${data.error}` : ` (HTTP ${response.status})`}.`);
  return String(data.path);
}

/** The card changed section: its picture moves to that folder of the tree. Returns the new path. */
export async function moveTreeImage(context, path, dir) {
  const { response, data } = await postJson(context, `${FOLDER_PLUGIN_BASE}/tree/move`, { path: String(path).replace(/^\//, ''), dir });
  if (!response.ok || !data?.path) throw new Error(`Картинка не переложилась в папку «${dir}»${data?.error ? `: ${data.error}` : ` (HTTP ${response.status})`}.`);
  return String(data.path);
}

/** Delete a stored picture, wherever it lives. A missing file is fine (already gone). */
export async function deleteWardrobeImage(context, path) {
  if (!path) return;
  const url = isTreeImage(path) ? `${FOLDER_PLUGIN_BASE}/tree/delete` : isFolderImage(path) ? `${FOLDER_PLUGIN_BASE}/delete` : '/api/images/delete';
  const response = await fetch(url, { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ path: String(path).replace(/^\//, '') }) });
  if (!response.ok && response.status !== 404) throw new Error(`Картинка не удалилась (HTTP ${response.status}).`);
}

/** What the plugin says: { installed, folder, ready, error, canBrowse, admin, version }. Never throws. */
export async function folderStorageStatus() {
  try {
    const response = await fetch(`${FOLDER_PLUGIN_BASE}/status`, { cache: 'no-store' });
    if (!response.ok) return { installed: false };
    const data = await response.json();
    return { installed: Boolean(data?.ok), folder: String(data?.folder ?? ''), ready: Boolean(data?.ready), error: data?.error ? String(data.error) : '', canBrowse: Boolean(data?.canBrowse), admin: Boolean(data?.admin), version: String(data?.version ?? '') };
  } catch {
    return { installed: false };
  }
}

/** Remember a folder in the plugin ('' forgets it). Returns the folder as the plugin resolved it. */
export async function setImageFolder(context, folder) {
  const { response, data } = await postJson(context, `${FOLDER_PLUGIN_BASE}/folder`, { folder: String(folder ?? '').trim() });
  if (!response.ok) throw new Error(data?.error || `Папка не сохранилась (HTTP ${response.status}).`);
  return String(data?.folder ?? '');
}

/** The Windows folder window (on the computer SillyTavern runs on). '' when cancelled. */
export async function browseImageFolder(context) {
  const { response, data } = await postJson(context, `${FOLDER_PLUGIN_BASE}/browse`, {});
  if (!response.ok) throw new Error(data?.error || `Окно выбора папки не открылось (HTTP ${response.status}).`);
  return data?.cancelled ? '' : String(data?.folder ?? '');
}

// ---- The tree «Гардероб» in the folder (wardrobe-inbox.js) --------------------

/** Create the tree's folders (relative to «Гардероб»). */
export async function prepareInbox(context, dirs) {
  const { response, data } = await postJson(context, `${FOLDER_PLUGIN_BASE}/tree/prepare`, { dirs });
  if (!response.ok) throw new Error(data?.error || `Папки гардероба не создались (HTTP ${response.status}).`);
  return data;
}

/** Every picture of «Гардероб»: [{ path, public, size, modified }]. */
export async function listInbox() {
  const response = await fetch(`${FOLDER_PLUGIN_BASE}/tree/list`, { cache: 'no-store' });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `Папку «Гардероб» не удалось прочитать (HTTP ${response.status}).`);
  return Array.isArray(data?.files) ? data.files : [];
}

const EXTENSION_FORMAT = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', gif: 'gif' };

/**
 * Copy one stored picture into the other storage, byte for byte; returns its new path. The old file stays.
 * `tree` ({ dir, name }) puts a wardrobe picture into its folder of «Гардероб», named after the card.
 */
export async function copyImageTo(context, path, storage, tree = null) {
  const clean = String(path ?? '').replace(/^\/+/, '');
  const parts = clean.split('/');
  const fileName = parts.at(-1) ?? '';
  const folder = parts.at(-2) || WARDROBE_IMAGE_FOLDER;
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const format = EXTENSION_FORMAT[fileName.slice(dot + 1).toLowerCase()];
  const response = await fetch(imageUrl(clean));
  if (!response.ok) throw new Error(`Картинка ${fileName} не найдена (HTTP ${response.status}).`);
  const blob = await response.blob();
  const dataUrl = await fileToDataUrl(new File([blob], fileName, { type: blob.type || 'image/png' }));
  if (storage === 'folder' && tree?.dir) {
    if (!format) return uploadToTree(context, dataUrl, tree.dir, tree.name || base);
    return sendTree(context, dataUrl.slice(dataUrl.indexOf(',') + 1), format, tree.dir, tree.name || base);
  }
  // A format the storage cannot take as it is (bmp, avif) goes through the usual shrink and re-encode.
  if (!format) return uploadWardrobeImage(context, dataUrl, base, folder, storage);
  return sendImage(context, storage, dataUrl.slice(dataUrl.indexOf(',') + 1), format, base, folder);
}

/** The URL a page shows a stored picture by. Tree paths keep Cyrillic, spaces and # as they are: encode them. */
export function imageUrl(path) {
  if (!path) return '';
  const clean = String(path).replace(/^\/+/, '');
  if (clean.startsWith(TREE_PREFIX)) return `/${TREE_PREFIX}${clean.slice(TREE_PREFIX.length).split('/').map(encodeURIComponent).join('/')}`;
  return `/${clean}`;
}

/** A stored picture as a small data: URL for a model. */
export async function storedImageForModel(path) {
  const response = await fetch(imageUrl(path));
  if (!response.ok) throw new Error('Картинка карточки не найдена на сервере.');
  const blob = await response.blob();
  const dataUrl = await fileToDataUrl(new File([blob], 'card', { type: blob.type || 'image/png' }));
  return shrinkDataUrl(dataUrl, VISION_MAX_SIDE);
}
