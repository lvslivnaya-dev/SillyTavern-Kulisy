/**
 * Pictures of wardrobe cards live on the SillyTavern server as files
 * (user/images/kulisy-wardrobe/…), never inside the settings — a hundred photos
 * in settings.json would slow every save. Only the path is kept on the card.
 *
 * Endpoints (SillyTavern src/endpoints/images.js): POST /api/images/upload
 * { image: base64 without the data: prefix, format, ch_name, filename } → { path };
 * POST /api/images/delete { path } (only under the user's images folder).
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

/** Store a picture for a card (or, with `folder`, for the library); returns the server path. */
export async function uploadWardrobeImage(context, dataUrl, fileName, folder = WARDROBE_IMAGE_FOLDER) {
  const small = await shrinkDataUrl(dataUrl, STORED_MAX_SIDE);
  const mime = small.slice(5, small.indexOf(';'));
  const format = FORMATS[mime];
  if (!format) throw new TypeError('Этот формат картинки не поддерживается: нужен PNG, JPEG, WebP или GIF.');
  let response;
  try {
    response = await fetch('/api/images/upload', {
      method: 'POST',
      headers: context.getRequestHeaders(),
      body: JSON.stringify({ image: small.slice(small.indexOf(',') + 1), format, ch_name: folder, filename: String(fileName).replace(/[^\w-]/g, '_') }),
    });
  } catch (error) {
    throw new Error(`Нет связи с сервером SillyTavern: ${error?.message ?? error}`);
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || !data?.path) throw new Error(`Картинка не сохранилась${data?.error ? `: ${data.error}` : ` (HTTP ${response.status})`}.`);
  return String(data.path).replace(/\\/g, '/');
}

/** Delete a stored picture. A missing file is fine (already gone). */
export async function deleteWardrobeImage(context, path) {
  if (!path) return;
  const response = await fetch('/api/images/delete', { method: 'POST', headers: context.getRequestHeaders(), body: JSON.stringify({ path: String(path).replace(/^\//, '') }) });
  if (!response.ok && response.status !== 404) throw new Error(`Картинка не удалилась (HTTP ${response.status}).`);
}

/** The URL a page shows a stored picture by. */
export function imageUrl(path) {
  return path ? `/${String(path).replace(/^\/+/, '')}` : '';
}

/** A stored picture as a small data: URL for a model. */
export async function storedImageForModel(path) {
  const response = await fetch(imageUrl(path));
  if (!response.ok) throw new Error('Картинка карточки не найдена на сервере.');
  const blob = await response.blob();
  const dataUrl = await fileToDataUrl(new File([blob], 'card', { type: blob.type || 'image/png' }));
  return shrinkDataUrl(dataUrl, VISION_MAX_SIDE);
}
