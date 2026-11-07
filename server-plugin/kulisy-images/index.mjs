/**
 * «Кулисы: картинки» — a SillyTavern server plugin that keeps the extension's pictures
 * in a folder on this computer instead of user/images.
 *
 * Routes (SillyTavern mounts them under /api/plugins/kulisy-images, behind its login and CSRF checks):
 *   GET  /status            → { ok, version, folder, ready, error?, canBrowse, admin }
 *   POST /folder { folder } → set the folder ('' = forget it); admins only
 *   POST /browse            → the Windows "choose a folder" window; admins only
 *   POST /upload { image (base64), format, ch_name, filename } → { path }
 *   POST /delete { path }
 *   GET  /file/<subfolder>/<name>  → the picture
 *
 * The wardrobe tree «Гардероб/<Персона|Персонажи>/<пол>/<раздел>/картинка.jpg» is where
 * wardrobe pictures live in the folder: a card points at its file, the file stays put.
 *   POST /tree/prepare { dirs }            → create the tree's folders
 *   GET  /tree/list                        → every picture in the tree (the extension finds the new ones)
 *   GET  /wardrobe/<path in the tree>      → a picture
 *   POST /tree/upload { image, format, dir, filename } → { path }
 *   POST /tree/move { path, dir }          → { path } (the card moved to another section)
 *   POST /tree/delete { path }
 *
 * The chosen folder is remembered per SillyTavern user in <user data>/kulisy-images.json,
 * so updating the plugin never loses it. Only pictures inside the chosen folder are
 * ever read or written: the two known subfolders and the tree «Гардероб».
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const PLUGIN_ID = 'kulisy-images';
export const VERSION = '0.3.0';
export const SUBFOLDERS = Object.freeze(['kulisy-wardrobe', 'kulisy-library']);
export const FORMATS = Object.freeze(['png', 'jpg', 'webp', 'gif']);
export const CONFIG_NAME = 'kulisy-images.json';
/** ~30 MB of picture as base64; the extension sends at most 1280 px, so this is generous. */
export const MAX_BASE64 = 40_000_000;
const NAME_PATTERN = /^[\w-]{1,120}\.(png|jpg|webp|gif)$/;

export const info = {
  id: PLUGIN_ID,
  name: 'Кулисы: картинки',
  description: 'Хранит картинки расширения «Кулисы» в папке на компьютере.',
};

/** A file name the plugin accepts: letters, digits, _ and -, plus a picture extension. */
export function cleanName(value, format) {
  const base = String(value ?? '').replace(/[^\w-]/g, '_').slice(0, 100) || 'picture';
  return `${base}.${format}`;
}

/** 'kulisy-wardrobe/abc.jpg' → { sub, name } or null. */
export function parseRelative(value) {
  const parts = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  if (parts.length !== 2) return null;
  const [sub, name] = parts;
  if (!SUBFOLDERS.includes(sub) || !NAME_PATTERN.test(name)) return null;
  return { sub, name };
}

/** The path the extension stores on a card: served back by GET /file/…. */
export function publicPath(sub, name) {
  return `api/plugins/${PLUGIN_ID}/file/${sub}/${name}`;
}

/** 'api/plugins/kulisy-images/file/kulisy-wardrobe/a.jpg' (with or without the leading /) → { sub, name } or null. */
export function parsePublic(value) {
  const prefix = `api/plugins/${PLUGIN_ID}/file/`;
  const text = String(value ?? '').replace(/^\/+/, '');
  return text.startsWith(prefix) ? parseRelative(text.slice(prefix.length)) : null;
}

/** Is `child` inside `parent` (after resolving)? */
export function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Can this folder hold pictures? Writes and removes a tiny probe file. */
export async function checkFolder(folder) {
  const text = String(folder ?? '').trim();
  if (!text) return { ready: false, error: 'Папка не выбрана.' };
  if (!path.isAbsolute(text)) return { ready: false, error: 'Нужен полный путь, например D:\\Картинки\\Кулисы.' };
  try {
    const stat = await fsp.stat(text);
    if (!stat.isDirectory()) return { ready: false, error: 'По этому пути лежит файл, а не папка.' };
  } catch {
    return { ready: false, error: 'Такой папки нет.' };
  }
  const probe = path.join(text, `.kulisy-probe-${process.pid}-${Date.now()}`);
  try {
    await fsp.writeFile(probe, 'ok');
    await fsp.rm(probe, { force: true });
  } catch (error) {
    return { ready: false, error: `В папку нельзя писать: ${error?.code ?? error?.message ?? error}` };
  }
  return { ready: true };
}

/** The per-user settings file. */
function configFile(request) {
  const root = request?.user?.directories?.root;
  if (!root) throw new Error('Не удалось определить пользователя SillyTavern.');
  return path.join(root, CONFIG_NAME);
}

export async function readConfig(request) {
  try {
    const data = JSON.parse(await fsp.readFile(configFile(request), 'utf8'));
    return { folder: typeof data?.folder === 'string' ? data.folder : '' };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[${PLUGIN_ID}] settings could not be read:`, error?.message ?? error);
    return { folder: '' };
  }
}

async function writeConfig(request, config) {
  await fsp.writeFile(configFile(request), JSON.stringify({ folder: config.folder }, null, 2), 'utf8');
}

const isAdmin = request => request?.user?.profile?.admin === true;

/** The Windows folder dialog. Resolves to the chosen path, or '' when cancelled. */
export function browseWindows(initial = '', { timeoutMs = 300_000, run = spawn } = {}) {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Кулисы: папка для картинок'",
    '$dialog.ShowNewFolderButton = $true',
    'if ($env:KULISY_INITIAL -and (Test-Path -LiteralPath $env:KULISY_INITIAL)) { $dialog.SelectedPath = $env:KULISY_INITIAL }',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    '$owner.ShowInTaskbar = $false',
    "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    let child;
    try {
      child = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true, env: { ...process.env, KULISY_INITIAL: String(initial ?? '') },
      });
    } catch (error) { reject(error); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } reject(new Error('Окно выбора папки не ответило за 5 минут.')); }, timeoutMs);
    child.stdout?.on('data', chunk => { output += chunk.toString('utf8'); });
    child.stderr?.on('data', chunk => { errors += chunk.toString('utf8'); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(errors.trim() || `PowerShell завершился с кодом ${code}`)); return; }
      resolve(output.trim());
    });
  });
}

// ---- The tree: «Гардероб/<полка>/<пол>/<раздел>/картинка.jpg» -------------------
// Pictures are dropped there by hand (or saved there by the extension); a card points
// at its file, which stays where it is and moves only when the card changes section.

export const INBOX = 'Гардероб';
export const TREE_PREFIX = `api/plugins/${PLUGIN_ID}/wardrobe/`;
export const INBOX_LIMITS = Object.freeze({ dirs: 400, depth: 3, files: 5000 });
const SEGMENT_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.()-]{0,59}$/u;
const INBOX_FILE_PATTERN = /^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.(png|jpe?g|webp|gif|bmp|avif)$/i;

/** A folder name of the tree: letters, digits, spaces, a few signs; never '.' or '..'. */
export function cleanSegment(value) {
  const text = String(value ?? '').trim();
  return SEGMENT_PATTERN.test(text) && !/^\.+$/.test(text) && !text.endsWith('.') ? text : '';
}

/** A file name for the tree: any letters (Cyrillic too), no characters Windows forbids. */
export function cleanTreeName(value, format) {
  const base = String(value ?? '').replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').slice(0, 100) || 'картинка';
  return `${base}.${format}`;
}

/** 'Персона/Женское/Верх/фото.jpg' → ['Персона', 'Женское', 'Верх', 'фото.jpg'] or null. */
export function parseInboxPath(value) {
  const text = String(value ?? '').replace(/\\/g, '/');
  if (text.startsWith('/')) return null; // always relative to «Гардероб»
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 1 || parts.length > INBOX_LIMITS.depth + 1) return null;
  const name = parts.at(-1);
  if (!INBOX_FILE_PATTERN.test(name) || name.startsWith('.') || name.trim() !== name) return null;
  if (parts.slice(0, -1).some(part => cleanSegment(part) !== part)) return null;
  return parts;
}

/** 'Персона/Женское/Верх' → parts, or null. */
export function parseTreeDir(value) {
  const parts = String(value ?? '').split('/').filter(Boolean);
  if (parts.length > INBOX_LIMITS.depth || parts.some(part => cleanSegment(part) !== part)) return null;
  return parts;
}

/** The path a card keeps for a picture of the tree (segments as they are, not URL-encoded). */
export function treePublicPath(parts) {
  return `${TREE_PREFIX}${parts.join('/')}`;
}

/** A card's path (with or without the leading /) or a tree-relative path → parts, or null. */
export function treeParts(value) {
  const text = String(value ?? '').replace(/^\/+/, '');
  // Only a card path may start with '/'; a bare tree path is always relative.
  return parseInboxPath(text.startsWith(TREE_PREFIX) ? text.slice(TREE_PREFIX.length) : String(value ?? ''));
}

async function listInboxFiles(root) {
  const files = [];
  async function walk(dir, parts) {
    if (files.length >= INBOX_LIMITS.files) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (files.length >= INBOX_LIMITS.files) return;
      const next = [...parts, entry.name];
      if (entry.isDirectory()) {
        if (parts.length < INBOX_LIMITS.depth && cleanSegment(entry.name) === entry.name) await walk(path.join(dir, entry.name), next);
      } else if (entry.isFile() && parseInboxPath(next.join('/'))) {
        try {
          const stat = await fsp.stat(path.join(dir, entry.name));
          files.push({ path: next.join('/'), public: treePublicPath(next), size: stat.size, modified: stat.mtimeMs });
        } catch { /* gone meanwhile */ }
      }
    }
  }
  await walk(root, []);
  return files.sort((a, b) => a.modified - b.modified);
}

/** «платье.jpg» taken? → «платье (2).jpg», «платье (3).jpg»… */
async function freeName(dir, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1 ? name : `${base} (${index})${ext}`;
    try { await fsp.access(path.join(dir, candidate)); }
    catch { return candidate; }
  }
  throw new Error('Слишком много файлов с таким именем.');
}

/** The route handlers, separate from Express so tests can call them. */
export function createHandlers({ platform = process.platform, browse = browseWindows } = {}) {
  const fail = (response, status, error) => response.status(status).send({ error });

  async function readyFolder(request) {
    const { folder } = await readConfig(request);
    const check = await checkFolder(folder);
    return { folder, ...check };
  }

  return {
    async status(request, response) {
      try {
        const current = await readyFolder(request);
        response.send({ ok: true, version: VERSION, folder: current.folder, ready: current.ready, error: current.ready ? undefined : current.error, canBrowse: platform === 'win32', admin: isAdmin(request) });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async folder(request, response) {
      try {
        if (!isAdmin(request)) return fail(response, 403, 'Папку может менять только администратор SillyTavern.');
        const folder = String(request.body?.folder ?? '').trim();
        if (!folder) {
          await writeConfig(request, { folder: '' });
          return response.send({ ok: true, folder: '', ready: false });
        }
        const check = await checkFolder(folder);
        if (!check.ready) return fail(response, 400, check.error);
        const resolved = path.resolve(folder);
        for (const sub of SUBFOLDERS) await fsp.mkdir(path.join(resolved, sub), { recursive: true });
        await writeConfig(request, { folder: resolved });
        response.send({ ok: true, folder: resolved, ready: true });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async browse(request, response) {
      try {
        if (!isAdmin(request)) return fail(response, 403, 'Папку может менять только администратор SillyTavern.');
        if (platform !== 'win32') return fail(response, 400, 'Окно выбора папки есть только на Windows — впишите путь вручную.');
        const { folder } = await readConfig(request);
        const chosen = await browse(folder);
        response.send(chosen ? { folder: chosen } : { cancelled: true });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async upload(request, response) {
      try {
        const { image, format, ch_name: sub, filename } = request.body ?? {};
        if (!SUBFOLDERS.includes(sub)) return fail(response, 400, 'Неизвестная подпапка.');
        if (!FORMATS.includes(format)) return fail(response, 400, 'Нужен PNG, JPEG, WebP или GIF.');
        if (typeof image !== 'string' || !image || image.length > MAX_BASE64) return fail(response, 400, 'Картинки нет или она слишком большая.');
        const current = await readyFolder(request);
        if (!current.ready) return fail(response, 409, current.error);
        const name = cleanName(filename, format);
        const target = path.join(current.folder, sub, name);
        if (!isInside(current.folder, target)) return fail(response, 400, 'Недопустимое имя файла.');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, Buffer.from(image, 'base64'));
        response.send({ path: publicPath(sub, name) });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async remove(request, response) {
      try {
        const parsed = parsePublic(request.body?.path) ?? parseRelative(request.body?.path);
        if (!parsed) return fail(response, 400, 'Недопустимый путь.');
        const { folder } = await readConfig(request);
        if (!folder) return fail(response, 404, 'Папка не выбрана.');
        const target = path.join(folder, parsed.sub, parsed.name);
        if (!isInside(folder, target)) return fail(response, 400, 'Недопустимый путь.');
        try { await fsp.unlink(target); }
        catch (error) { if (error?.code === 'ENOENT') return fail(response, 404, 'Файла уже нет.'); throw error; }
        response.send({ ok: true });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    /** Create the tree: { dirs: ['Персона/Женское/Верх', …] } relative to «Гардероб». */
    async treePrepare(request, response) {
      try {
        const current = await readyFolder(request);
        if (!current.ready) return fail(response, 409, current.error);
        const dirs = Array.isArray(request.body?.dirs) ? request.body.dirs.slice(0, INBOX_LIMITS.dirs) : [];
        const root = path.join(current.folder, INBOX);
        await fsp.mkdir(root, { recursive: true });
        let created = 0;
        for (const dir of dirs) {
          const parts = parseTreeDir(dir);
          if (!parts?.length) continue;
          const target = path.join(root, ...parts);
          if (!isInside(root, target)) continue;
          if (!fs.existsSync(target)) { await fsp.mkdir(target, { recursive: true }); created += 1; }
        }
        response.send({ ok: true, created, root });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    /** Every picture of the tree, oldest first: { files: [{ path, public, size, modified }] }. */
    async treeList(request, response) {
      try {
        const current = await readyFolder(request);
        if (!current.ready) return fail(response, 409, current.error);
        response.send({ files: await listInboxFiles(path.join(current.folder, INBOX)) });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    /** GET /wardrobe/<segments, URL-encoded> → the picture. */
    async treeFile(request, response) {
      try {
        if (request.method !== 'GET' && request.method !== 'HEAD') return response.sendStatus(405);
        let relative;
        try { relative = String(request.path ?? '').split('/').filter(Boolean).map(decodeURIComponent).join('/'); }
        catch { return response.sendStatus(404); }
        const parts = parseInboxPath(relative);
        if (!parts) return response.sendStatus(404);
        const { folder } = await readConfig(request);
        if (!folder) return response.sendStatus(404);
        const root = path.join(folder, INBOX);
        const target = path.join(root, ...parts);
        if (!isInside(root, target) || !fs.existsSync(target)) return response.sendStatus(404);
        response.sendFile(parts.at(-1), { root: path.dirname(target), dotfiles: 'deny', headers: { 'Cache-Control': 'private, max-age=3600' } });
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] tree picture could not be sent:`, error?.message ?? error);
        if (!response.headersSent) response.sendStatus(500);
      }
    },

    /** Save a picture into a folder of the tree: { image (base64), format, dir, filename } → { path }. */
    async treeUpload(request, response) {
      try {
        const { image, format, dir, filename } = request.body ?? {};
        const parts = parseTreeDir(dir);
        if (!parts) return fail(response, 400, 'Недопустимая папка гардероба.');
        if (!FORMATS.includes(format)) return fail(response, 400, 'Нужен PNG, JPEG, WebP или GIF.');
        if (typeof image !== 'string' || !image || image.length > MAX_BASE64) return fail(response, 400, 'Картинки нет или она слишком большая.');
        const current = await readyFolder(request);
        if (!current.ready) return fail(response, 409, current.error);
        const root = path.join(current.folder, INBOX);
        const targetDir = path.join(root, ...parts);
        if (!isInside(root, path.join(targetDir, 'x'))) return fail(response, 400, 'Недопустимая папка гардероба.');
        await fsp.mkdir(targetDir, { recursive: true });
        const name = await freeName(targetDir, cleanTreeName(filename, format));
        await fsp.writeFile(path.join(targetDir, name), Buffer.from(image, 'base64'));
        response.send({ path: treePublicPath([...parts, name]) });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    /** Move a picture to another folder of the tree, keeping its name: { path, dir } → { path }. */
    async treeMove(request, response) {
      try {
        const parts = treeParts(request.body?.path);
        const dirParts = parseTreeDir(request.body?.dir);
        if (!parts || !dirParts) return fail(response, 400, 'Недопустимый путь.');
        const { folder } = await readConfig(request);
        if (!folder) return fail(response, 404, 'Папка не выбрана.');
        const root = path.join(folder, INBOX);
        const from = path.join(root, ...parts);
        const targetDir = path.join(root, ...dirParts);
        if (!isInside(root, from) || !isInside(root, path.join(targetDir, 'x'))) return fail(response, 400, 'Недопустимый путь.');
        if (!fs.existsSync(from)) return fail(response, 404, 'Файла уже нет.');
        if (path.dirname(from) === targetDir) return response.send({ path: treePublicPath(parts) });
        await fsp.mkdir(targetDir, { recursive: true });
        const name = await freeName(targetDir, parts.at(-1));
        await fsp.rename(from, path.join(targetDir, name));
        response.send({ path: treePublicPath([...dirParts, name]) });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async treeDelete(request, response) {
      try {
        const parts = treeParts(request.body?.path);
        if (!parts) return fail(response, 400, 'Недопустимый путь.');
        const { folder } = await readConfig(request);
        if (!folder) return fail(response, 404, 'Папка не выбрана.');
        const root = path.join(folder, INBOX);
        const target = path.join(root, ...parts);
        if (!isInside(root, target)) return fail(response, 400, 'Недопустимый путь.');
        try { await fsp.unlink(target); }
        catch (error) { if (error?.code === 'ENOENT') return fail(response, 404, 'Файла уже нет.'); throw error; }
        response.send({ ok: true });
      } catch (error) {
        fail(response, 500, error?.message ?? String(error));
      }
    },

    async file(request, response) {
      try {
        const parsed = parseRelative(`${request.params?.sub}/${request.params?.name}`);
        if (!parsed) return response.sendStatus(404);
        const { folder } = await readConfig(request);
        if (!folder) return response.sendStatus(404);
        const target = path.join(folder, parsed.sub, parsed.name);
        if (!isInside(folder, target) || !fs.existsSync(target)) return response.sendStatus(404);
        response.sendFile(parsed.name, { root: path.join(folder, parsed.sub), dotfiles: 'deny', headers: { 'Cache-Control': 'private, max-age=86400' } });
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] picture could not be sent:`, error?.message ?? error);
        if (!response.headersSent) response.sendStatus(500);
      }
    },
  };
}

/** SillyTavern calls this once at start with an Express router. */
export async function init(router) {
  const handlers = createHandlers();
  router.get('/status', handlers.status);
  router.post('/folder', handlers.folder);
  router.post('/browse', handlers.browse);
  router.post('/upload', handlers.upload);
  router.post('/delete', handlers.remove);
  router.get('/file/:sub/:name', handlers.file);
  router.post('/tree/prepare', handlers.treePrepare);
  router.get('/tree/list', handlers.treeList);
  router.post('/tree/upload', handlers.treeUpload);
  router.post('/tree/move', handlers.treeMove);
  router.post('/tree/delete', handlers.treeDelete);
  router.use('/wardrobe', handlers.treeFile);
  console.log(`[${PLUGIN_ID}] ${VERSION}: pictures of «Кулисы» can be kept in a folder on this computer.`);
}

export async function exit() { /* nothing to close */ }

export default { info, init, exit };
