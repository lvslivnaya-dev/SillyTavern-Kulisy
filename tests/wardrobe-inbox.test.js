/** The folder «Гардероб»: pictures dropped there by hand become cards of the folder they lie in, and stay where they are. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandlers, parseInboxPath, treeParts, INBOX } from '../server-plugin/kulisy-images/index.mjs';
import { inboxDirectories, nameFromFile, newTreeFiles, placeFromPath, treeDirFor } from '../src/integration/wardrobe-inbox.js';
import { createWardrobeCallbacks, createWardrobeStore } from '../src/integration/wardrobe-actions.js';
import { imageUrl, isTreeImage, treeDirOf } from '../src/integration/wardrobe-images.js';
import { cleanImagePath } from '../src/core/index.js';
import { moveImages } from '../src/integration/image-move.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const TREE = 'api/plugins/kulisy-images/wardrobe/';
const tempDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const request = (root, { admin = true, body, path: urlPath, method = 'GET' } = {}) => ({ user: { directories: { root }, profile: { admin } }, body, path: urlPath, method });

function response() {
  const res = { statusCode: 200, body: undefined, file: null };
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { res.body = body; return res; };
  res.sendStatus = code => { res.statusCode = code; return res; };
  res.sendFile = (name, options) => { res.file = path.join(options.root, name); return res; };
  return res;
}
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

async function setUp() {
  const user = tempDir('kulisy-user-');
  const pictures = tempDir('kulisy-pics-');
  const handlers = createHandlers({ platform: 'linux' });
  await call(handlers.folder, request(user, { body: { folder: pictures } }));
  await call(handlers.treePrepare, request(user, { body: { dirs: inboxDirectories() } }));
  return { user, pictures, handlers, tree: path.join(pictures, INBOX) };
}

test('plugin: the tree is created once; nothing outside it is made', async () => {
  const user = tempDir('kulisy-user-');
  const pictures = tempDir('kulisy-pics-');
  const handlers = createHandlers({ platform: 'linux' });
  assert.equal((await call(handlers.treeList, request(user))).statusCode, 409, 'no folder yet');
  await call(handlers.folder, request(user, { body: { folder: pictures } }));
  const prepared = await call(handlers.treePrepare, request(user, { body: { dirs: [...inboxDirectories(), '../evil', 'a/../../b', 'Персона/./x'] } }));
  assert.equal(prepared.body.created, inboxDirectories().length);
  assert.ok(fs.existsSync(path.join(pictures, INBOX, 'Персона', 'Женское', 'Верх')));
  assert.ok(fs.existsSync(path.join(pictures, INBOX, 'Персонажи', 'Мужское', 'Татуировки')));
  assert.equal(fs.existsSync(path.join(pictures, 'evil')), false);
  assert.equal((await call(handlers.treePrepare, request(user, { body: { dirs: inboxDirectories() } }))).body.created, 0);
});

test('plugin: list, serve, save, move and delete pictures of the tree — the file stays in the folder', async () => {
  const { user, handlers, tree } = await setUp();
  const dresses = path.join(tree, 'Персона', 'Женское', 'Платья');
  fs.writeFileSync(path.join(dresses, 'розовое платье #1.JPG'), PNG);
  fs.writeFileSync(path.join(dresses, 'notes.txt'), 'no');
  const listed = (await call(handlers.treeList, request(user))).body.files;
  assert.deepEqual(listed.map(file => file.public), [`${TREE}Персона/Женское/Платья/розовое платье #1.JPG`]);
  assert.equal(cleanImagePath(listed[0].public), listed[0].public, 'a card may keep this path');

  const url = imageUrl(listed[0].public);
  assert.equal(url, '/api/plugins/kulisy-images/wardrobe/%D0%9F%D0%B5%D1%80%D1%81%D0%BE%D0%BD%D0%B0/%D0%96%D0%B5%D0%BD%D1%81%D0%BA%D0%BE%D0%B5/%D0%9F%D0%BB%D0%B0%D1%82%D1%8C%D1%8F/%D1%80%D0%BE%D0%B7%D0%BE%D0%B2%D0%BE%D0%B5%20%D0%BF%D0%BB%D0%B0%D1%82%D1%8C%D0%B5%20%231.JPG');
  const served = await call(handlers.treeFile, request(user, { path: url.slice('/api/plugins/kulisy-images/wardrobe'.length) }));
  assert.equal(served.file, path.join(dresses, 'розовое платье #1.JPG'));

  const saved = await call(handlers.treeUpload, request(user, { body: { image: PNG.toString('base64'), format: 'png', dir: 'Персона/Женское/Платья', filename: 'Розовое: платье?' } }));
  assert.equal(saved.body.path, `${TREE}Персона/Женское/Платья/Розовое платье.png`, 'Cyrillic kept, forbidden signs dropped');
  const again = await call(handlers.treeUpload, request(user, { body: { image: PNG.toString('base64'), format: 'png', dir: 'Персона/Женское/Платья', filename: 'Розовое платье' } }));
  assert.equal(again.body.path, `${TREE}Персона/Женское/Платья/Розовое платье (2).png`, 'never overwrites');

  const moved = await call(handlers.treeMove, request(user, { body: { path: `/${again.body.path}`, dir: 'Персона/Женское/Юбки' } }));
  assert.equal(moved.body.path, `${TREE}Персона/Женское/Юбки/Розовое платье (2).png`);
  assert.ok(fs.existsSync(path.join(tree, 'Персона', 'Женское', 'Юбки', 'Розовое платье (2).png')));
  assert.equal(fs.existsSync(path.join(dresses, 'Розовое платье (2).png')), false);

  assert.equal((await call(handlers.treeDelete, request(user, { body: { path: moved.body.path } }))).statusCode, 200);
  assert.equal(fs.existsSync(path.join(tree, 'Персона', 'Женское', 'Юбки', 'Розовое платье (2).png')), false);
  assert.ok(fs.existsSync(path.join(dresses, 'notes.txt')), 'other files are never touched');
});

test('plugin: nothing outside the tree is read, written, moved or deleted', async () => {
  const { user, handlers } = await setUp();
  for (const bad of ['../kulisy-images.json', 'Персона/../../x.png', '/etc/x.png', 'C:/x.png', 'C:\\x.png', 'Персона/Женское/Платья/notes.txt']) {
    // '/etc/x.png' is read as «Гардероб/etc/x.png» (a card path starts with /): still inside, simply not there.
    assert.ok([400, 404].includes((await call(handlers.treeDelete, request(user, { body: { path: bad } }))).statusCode), bad);
    assert.ok([400, 404].includes((await call(handlers.treeMove, request(user, { body: { path: bad, dir: 'Персона' } }))).statusCode), bad);
  }
  assert.equal((await call(handlers.treeFile, request(user, { path: '/%2E%2E/x.png' }))).statusCode, 404);
  assert.equal((await call(handlers.treeFile, request(user, { path: '/%E0%A4%A' }))).statusCode, 404, 'broken encoding');
  assert.equal((await call(handlers.treeFile, request(user, { path: '/a.png', method: 'POST' }))).statusCode, 405);
  assert.equal((await call(handlers.treeMove, request(user, { body: { path: `${TREE}Персона/a.png`, dir: '../x' } }))).statusCode, 400);
  assert.equal((await call(handlers.treeUpload, request(user, { body: { image: PNG.toString('base64'), format: 'png', dir: '..', filename: 'x' } }))).statusCode, 400);
  assert.equal(parseInboxPath('a/b/c/d/e.png'), null, 'no deeper than полка/пол/раздел');
  assert.equal(treeParts('/user/images/kulisy-wardrobe/a.png'), null);
  assert.equal(cleanImagePath(`${TREE}../x.png`), '');
  assert.equal(cleanImagePath(`${TREE}a/b/c/d/e.png`), '');
});

test('paths: the folder gives shelf, gender and section; a file name becomes the card name only when it is a name', () => {
  assert.deepEqual(placeFromPath('Персона/Женское/Платья/розовое платье.jpg'), { shelf: 'persona', gender: 'female', category: 'dresses', name: 'розовое платье', problem: '' });
  assert.deepEqual(placeFromPath('Персонажи/Мужское/Верхняя одежда/IMG_2034.jpg'), { shelf: 'characters', gender: 'male', category: 'outerwear', name: '', problem: '' });
  assert.deepEqual(placeFromPath('персонаж/УНИ/x.png'), { shelf: 'characters', gender: 'unisex', category: '', name: 'x', problem: '' });
  assert.match(placeFromPath('Персона/Женское/Носки/x.png').problem, /Носки/);
  assert.match(placeFromPath('Котики/x.png').problem, /Котики/);
  assert.equal(nameFromFile('Нижнее_бельё_кружевное.webp'), 'Нижнее бельё кружевное');
  assert.equal(nameFromFile('0c3bc6be015aba5da46e766166bc1b54.jpg'), '');
  assert.equal(nameFromFile('Screenshot 2026-11-07 101010.png'), '');
  assert.equal(treeDirFor({ shelf: 'persona', gender: 'unisex', category: 'nails' }), 'Персона/Унисекс/Маникюр');
  assert.equal(treeDirOf(`${TREE}Персона/Унисекс/Маникюр/a.png`), 'Персона/Унисекс/Маникюр');
  assert.equal(isTreeImage(`/${TREE}x.png`), true);
  assert.equal(new Set(inboxDirectories()).size, 2 * 3 * 16);
  assert.deepEqual(newTreeFiles([{ public: `${TREE}a.png` }, { public: `${TREE}b.png` }], [{ image: `/${TREE}a.png` }]).map(file => file.public), [`${TREE}b.png`]);
});

function wardrobe(files, { ask, relocate } = {}) {
  const settings = { wardrobe: { version: 1, cards: [], looks: [] } };
  const store = createWardrobeStore({ settings: () => settings, save() {} });
  const moves = [];
  const callbacks = createWardrobeCallbacks({
    store, getState: () => ({ entities: {}, world: {} }), commitOperations: async () => {}, confirm: async () => true,
    upload: async () => { throw new Error('import never uploads'); },
    removeImage: async () => { throw new Error('import never deletes'); },
    imageForModel: async () => 'data:image/png;base64,AA',
    ask: ask ?? (async () => JSON.stringify({ name: 'Куртка', description: 'Чёрная кожаная куртка.', category: 'outerwear', gender: 'female' })),
    relocate: relocate ?? (async (from, dir) => { moves.push([from, dir]); return `${TREE}${dir}/${from.split('/').at(-1)}`; }),
    isTreeImage, treeDirOf,
    inbox: { list: async () => files },
  });
  return { store, callbacks, moves };
}

const treeFile = relative => ({ path: relative, public: `${TREE}${relative}` });

test('import: cards point at the files where they lie; the model fills only what the folder left out, and then the file follows the card', async () => {
  const files = [treeFile('Персона/Женское/Платья/розовое платье.jpg'), treeFile('Персонажи/Мужское/IMG_1.png'), treeFile('Котики/кот.png')];
  const { store, callbacks, moves } = wardrobe(files);
  const progress = [];
  const result = await callbacks.onWardrobeImportInbox({ describe: true, onProgress: (done, total, stage) => progress.push(`${stage}:${done}/${total}`) });
  assert.deepEqual({ ...result, skipped: result.skipped.length }, { added: 2, described: 2, failed: 0, undescribed: 0, skipped: 1 });
  const [dress, jacket] = store.get().cards;
  assert.equal(dress.image, `${TREE}Персона/Женское/Платья/розовое платье.jpg`, 'no copy: the card shows the file from its folder');
  assert.equal(dress.shelf, 'persona'); assert.equal(dress.category, 'dresses'); assert.equal(dress.gender, 'female');
  assert.equal(dress.name, 'розовое платье', 'a real file name stays the name');
  assert.equal(jacket.category, 'outerwear', 'no section folder: the model chose it');
  assert.equal(jacket.gender, 'male', 'the gender folder wins over the model');
  assert.deepEqual(moves, [[`${TREE}Персонажи/Мужское/IMG_1.png`, 'Персонажи/Мужское/Верхняя одежда']], 'the file went into the section the model chose');
  assert.equal(jacket.image, `${TREE}Персонажи/Мужское/Верхняя одежда/IMG_1.png`);
  assert.deepEqual(progress, ['add:1/2', 'add:2/2', 'describe:1/2', 'describe:2/2'], 'all cards first, describing after');
  assert.equal(newTreeFiles(files.slice(0, 1), store.get().cards).length, 0, 'a taken picture is not new any more');
});

test('import: a model that fails or hangs does not stop the rest — the cards are there, just not described', async () => {
  let calls = 0;
  const files = [treeFile('Персона/Женское/Верх/a.png'), treeFile('Персона/Женское/Верх/b.png'), treeFile('Персона/Женское/Верх/c.png')];
  const { store, callbacks } = wardrobe(files, { ask: async () => { calls += 1; if (calls === 1) throw new Error('timeout'); return JSON.stringify({ description: 'Белая футболка.' }); } });
  const result = await callbacks.onWardrobeImportInbox({ describe: true });
  assert.equal(result.added, 3);
  assert.equal(result.described, 2);
  assert.equal(result.undescribed, 1);
  assert.equal(store.get().cards.length, 3);
});

test('import: declined → nothing changes', async () => {
  const { store, callbacks } = wardrobe([treeFile('Персона/Женское/Верх/a.png')]);
  const declined = createWardrobeCallbacks({ store, getState: () => ({}), commitOperations: async () => {}, confirm: async () => false, inbox: { list: async () => [treeFile('Персона/Женское/Верх/a.png')] } });
  assert.equal(await declined.onWardrobeImportInbox({}), null);
  assert.equal(store.get().cards.length, 0);
  assert.ok(callbacks);
});

test('a card that changes section takes its picture to that folder; server pictures stay put', async () => {
  const { store, callbacks, moves } = wardrobe([treeFile('Персона/Женское/Верх/a.png')]);
  await callbacks.onWardrobeImportInbox({});
  const card = store.get().cards[0];
  await callbacks.onWardrobeUpdateCard({ cardId: card.id, changes: { category: 'skirts' } });
  assert.deepEqual(moves, [[`${TREE}Персона/Женское/Верх/a.png`, 'Персона/Женское/Юбки']]);
  assert.equal(store.get().cards[0].image, `${TREE}Персона/Женское/Юбки/a.png`);
  await callbacks.onWardrobeUpdateCard({ cardId: card.id, changes: { name: 'Юбка' } });
  assert.equal(moves.length, 1, 'same section: nothing moves');
});

test('moving to the folder: wardrobe pictures go into their section folders, named after the card', async () => {
  let cards = { cards: [{ id: 'c1', shelf: 'persona', gender: 'female', category: 'dresses', name: 'Белое платье', image: '/user/images/kulisy-wardrobe/wear_1.jpg' }] };
  let library = { locations: [{ id: 'l1', image: '/user/images/kulisy-library/p.jpg' }], items: [] };
  const copies = [];
  const result = await moveImages('folder', {
    getWardrobe: () => cards, setWardrobe: next => { cards = next; }, getLibrary: () => library, setLibrary: next => { library = next; },
    copy: async (from, storage, tree) => { copies.push([from, tree]); return tree ? `${TREE}${tree.dir}/${tree.name}.jpg` : 'api/plugins/kulisy-images/file/kulisy-library/p.jpg'; },
    remove: async () => {},
  });
  assert.equal(result.moved, 2);
  assert.deepEqual(copies[0], ['/user/images/kulisy-wardrobe/wear_1.jpg', { dir: 'Персона/Женское/Платья', name: 'Белое платье' }]);
  assert.equal(copies[1][1], null, 'library pictures are not part of the wardrobe tree');
  assert.equal(cards.cards[0].image, `${TREE}Персона/Женское/Платья/Белое платье.jpg`);
});
