/** Pictures in a folder on the computer: the server plugin kulisy-images, the paths a card may keep, moving pictures between storages. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandlers, parsePublic, CONFIG_NAME } from '../server-plugin/kulisy-images/index.mjs';
import { cleanImagePath } from '../src/core/index.js';
import { moveImages, countImages } from '../src/integration/image-move.js';
import { deleteWardrobeImage, folderStorageStatus, isFolderImage, storageOf } from '../src/integration/wardrobe-images.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(userRoot, { admin = true, body, params } = {}) {
  return { user: { directories: { root: userRoot }, profile: { admin } }, body, params };
}

function response() {
  const res = { statusCode: 200, body: undefined, file: null };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.body = body; return res; };
  res.sendStatus = code => { res.statusCode = code; return res; };
  res.sendFile = (name, options) => { res.file = path.join(options.root, name); return res; };
  return res;
}

async function call(handler, req) {
  const res = response();
  await handler(req, res);
  return res;
}

test('plugin: no folder yet → status says so, uploads are refused', async () => {
  const user = tempDir('kulisy-user-');
  const handlers = createHandlers({ platform: 'linux' });
  const status = await call(handlers.status, request(user));
  assert.equal(status.body.ok, true);
  assert.equal(status.body.ready, false);
  assert.equal(status.body.canBrowse, false);
  const upload = await call(handlers.upload, request(user, { body: { image: PNG.toString('base64'), format: 'png', ch_name: 'kulisy-wardrobe', filename: 'a' } }));
  assert.equal(upload.statusCode, 409);
});

test('plugin: only an admin picks the folder; a bad path is explained, a good one gets its subfolders', async () => {
  const user = tempDir('kulisy-user-');
  const pictures = tempDir('kulisy-pics-');
  const handlers = createHandlers({ platform: 'linux' });
  assert.equal((await call(handlers.folder, request(user, { admin: false, body: { folder: pictures } }))).statusCode, 403);
  assert.equal((await call(handlers.folder, request(user, { body: { folder: 'relative/dir' } }))).statusCode, 400);
  assert.equal((await call(handlers.folder, request(user, { body: { folder: path.join(pictures, 'nope') } }))).statusCode, 400);
  const saved = await call(handlers.folder, request(user, { body: { folder: pictures } }));
  assert.equal(saved.statusCode, 200);
  assert.ok(fs.existsSync(path.join(pictures, 'kulisy-wardrobe')));
  assert.ok(fs.existsSync(path.join(pictures, 'kulisy-library')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(user, CONFIG_NAME), 'utf8')).folder, path.resolve(pictures));
  assert.deepEqual(fs.readdirSync(pictures).sort(), ['kulisy-library', 'kulisy-wardrobe'], 'the write probe is cleaned up');
  const status = await call(handlers.status, request(user));
  assert.equal(status.body.ready, true);
});

test('plugin: upload, serve and delete a picture; the path is one a card may keep', async () => {
  const user = tempDir('kulisy-user-');
  const pictures = tempDir('kulisy-pics-');
  const handlers = createHandlers({ platform: 'linux' });
  await call(handlers.folder, request(user, { body: { folder: pictures } }));
  const upload = await call(handlers.upload, request(user, { body: { image: PNG.toString('base64'), format: 'png', ch_name: 'kulisy-wardrobe', filename: 'wear_1' } }));
  assert.equal(upload.body.path, 'api/plugins/kulisy-images/file/kulisy-wardrobe/wear_1.png');
  assert.equal(cleanImagePath(upload.body.path), upload.body.path);
  assert.equal(cleanImagePath(`/${upload.body.path}`), `/${upload.body.path}`);
  assert.deepEqual(fs.readFileSync(path.join(pictures, 'kulisy-wardrobe', 'wear_1.png')), PNG);
  const served = await call(handlers.file, request(user, { params: { sub: 'kulisy-wardrobe', name: 'wear_1.png' } }));
  assert.equal(served.file, path.join(pictures, 'kulisy-wardrobe', 'wear_1.png'));
  const removed = await call(handlers.remove, request(user, { body: { path: upload.body.path } }));
  assert.equal(removed.statusCode, 200);
  assert.equal(fs.existsSync(path.join(pictures, 'kulisy-wardrobe', 'wear_1.png')), false);
  assert.equal((await call(handlers.remove, request(user, { body: { path: upload.body.path } }))).statusCode, 404, 'already gone');
});

test('plugin: nothing outside the folder is ever written, read or deleted', async () => {
  const user = tempDir('kulisy-user-');
  const pictures = tempDir('kulisy-pics-');
  const handlers = createHandlers({ platform: 'linux' });
  await call(handlers.folder, request(user, { body: { folder: pictures } }));
  const image = PNG.toString('base64');
  assert.equal((await call(handlers.upload, request(user, { body: { image, format: 'png', ch_name: '../evil', filename: 'x' } }))).statusCode, 400);
  assert.equal((await call(handlers.upload, request(user, { body: { image, format: 'exe', ch_name: 'kulisy-wardrobe', filename: 'x' } }))).statusCode, 400);
  const sneaky = await call(handlers.upload, request(user, { body: { image, format: 'png', ch_name: 'kulisy-library', filename: '../../escape' } }));
  assert.equal(sneaky.body.path, 'api/plugins/kulisy-images/file/kulisy-library/______escape.png', 'slashes and dots become _');
  assert.equal((await call(handlers.file, request(user, { params: { sub: '..', name: CONFIG_NAME } }))).statusCode, 404);
  assert.equal((await call(handlers.file, request(user, { params: { sub: 'kulisy-wardrobe', name: '..%2F..%2Fx.png' } }))).statusCode, 404);
  assert.equal((await call(handlers.remove, request(user, { body: { path: 'api/plugins/kulisy-images/file/kulisy-wardrobe/../../x.png' } }))).statusCode, 400);
  assert.equal(parsePublic('/user/images/kulisy-wardrobe/a.png'), null);
});

test('plugin: the folder window is Windows-only and admin-only', async () => {
  const user = tempDir('kulisy-user-');
  assert.equal((await call(createHandlers({ platform: 'linux' }).browse, request(user))).statusCode, 400);
  assert.equal((await call(createHandlers({ platform: 'win32', browse: async () => 'C:\\x' }).browse, request(user, { admin: false }))).statusCode, 403);
  assert.deepEqual((await call(createHandlers({ platform: 'win32', browse: async () => 'C:\\Pics' }).browse, request(user))).body, { folder: 'C:\\Pics' });
  assert.deepEqual((await call(createHandlers({ platform: 'win32', browse: async () => '' }).browse, request(user))).body, { cancelled: true });
});

test('card paths: folder pictures are accepted, anything else of that shape is not', () => {
  assert.equal(cleanImagePath('api/plugins/kulisy-images/file/kulisy-library/place_1.jpg'), 'api/plugins/kulisy-images/file/kulisy-library/place_1.jpg');
  assert.equal(cleanImagePath('api/plugins/kulisy-images/file/other/place_1.jpg'), '');
  assert.equal(cleanImagePath('api/plugins/kulisy-images/status'), '');
  assert.equal(cleanImagePath('api/plugins/other/file/kulisy-library/a.png'), '');
  assert.equal(cleanImagePath('https://evil.example/api/plugins/kulisy-images/file/kulisy-library/a.png'), '');
  assert.equal(isFolderImage('/api/plugins/kulisy-images/file/kulisy-wardrobe/a.png'), true);
  assert.equal(storageOf('user/images/kulisy-wardrobe/a.png'), 'server');
});

test('moving pictures: copy, save the new paths, then delete the old files; a failure leaves the card as it was', async () => {
  let wardrobe = { cards: [{ id: 'c1', image: 'user/images/kulisy-wardrobe/a.png' }, { id: 'c2', image: 'user/images/kulisy-wardrobe/b.png' }, { id: 'c3' }] };
  let library = { locations: [{ id: 'l1', image: 'user/images/kulisy-library/p.jpg' }], items: [{ id: 'i1', image: 'api/plugins/kulisy-images/file/kulisy-library/t.png' }] };
  assert.deepEqual(countImages(wardrobe, library), { server: 3, folder: 1 });
  const removed = [];
  const order = [];
  const result = await moveImages('folder', {
    getWardrobe: () => wardrobe, setWardrobe: next => { order.push('save'); wardrobe = next; },
    getLibrary: () => library, setLibrary: next => { library = next; },
    copy: async (from, storage) => {
      assert.equal(storage, 'folder');
      if (from.endsWith('b.png')) throw new Error('broken');
      const [sub, name] = from.split('/').slice(-2);
      return `api/plugins/kulisy-images/file/${sub}/${name}`;
    },
    remove: async old => { order.push('remove'); removed.push(old); },
  });
  assert.deepEqual(result, { moved: 2, failed: 1, leftovers: 0 });
  assert.equal(wardrobe.cards[0].image, 'api/plugins/kulisy-images/file/kulisy-wardrobe/a.png');
  assert.equal(wardrobe.cards[1].image, 'user/images/kulisy-wardrobe/b.png', 'a picture that did not copy keeps its old path');
  assert.equal(library.locations[0].image, 'api/plugins/kulisy-images/file/kulisy-library/p.jpg');
  assert.deepEqual(removed.sort(), ['user/images/kulisy-library/p.jpg', 'user/images/kulisy-wardrobe/a.png']);
  assert.equal(order[0], 'save', 'old files go only after the new paths are saved');
});

test('client: deleting picks the right endpoint; a missing plugin is reported as not installed', async () => {
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, body: options?.body }); return { ok: url !== '/api/plugins/kulisy-images/status', status: 404, json: async () => ({}) }; };
    const context = { getRequestHeaders: () => ({}) };
    await deleteWardrobeImage(context, '/api/plugins/kulisy-images/file/kulisy-wardrobe/a.png');
    await deleteWardrobeImage(context, 'user/images/kulisy-wardrobe/a.png');
    assert.equal(calls[0].url, '/api/plugins/kulisy-images/delete');
    assert.equal(JSON.parse(calls[0].body).path, 'api/plugins/kulisy-images/file/kulisy-wardrobe/a.png');
    assert.equal(calls[1].url, '/api/images/delete');
    assert.deepEqual(await folderStorageStatus(), { installed: false });
    globalThis.fetch = async () => { throw new TypeError('network'); };
    assert.deepEqual(await folderStorageStatus(), { installed: false });
  } finally { globalThis.fetch = original; }
});
