/** The library as a gallery: pictures of places and things, «Описать по картинке», imports with no folder open, typed text that survives a redraw. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addFolder, addLocation, applyOperations, createDefaultState, emptyLibrary, normalizeLibrary, updateLocation } from '../src/core/index.js';
import { createLibraryCallbacks, createLocationLibraryStore } from '../src/integration/location-library-actions.js';
import { createWardrobeCallbacks, createWardrobeStore } from '../src/integration/wardrobe-actions.js';

function harness(answer) {
  const settings = {};
  let changes = 0;
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {}, onChange: () => { changes += 1; } });
  let state = createDefaultState();
  const removed = [];
  const prompts = [];
  const callbacks = createLibraryCallbacks({
    library: store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    confirm: async () => true,
    listBooks: () => ['Сибуя'],
    loadBook: async () => ({ entries: { 0: { uid: 0, comment: 'Бар «Ворон»', key: ['Ворон'], content: 'Бар в подвале.' } } }),
    upload: async (dataUrl, name) => `/user/images/kulisy-library/${name}.png`,
    removeImage: async path => { removed.push(path); },
    imageForModel: async () => 'data:image/png;base64,AAAA',
    ask: async (dataUrl, prompt) => { prompts.push(prompt); return answer; },
  });
  return { settings, store, callbacks, removed, prompts, changes: () => changes };
}

test('a place from a picture: stored on the server, described (name, traits), redraws the Studio', async () => {
  const { store, callbacks, prompts, changes } = harness('{"name":"Подвальный бар","traits":["неоновая вывеска","липкая стойка"],"description":"Тесный бар в подвале."}');
  const folder = callbacks.onLibraryAddFolder({ name: 'Сибуя' });
  const before = changes();
  const place = await callbacks.onLibraryAddFromImage({ kind: 'places', folderId: folder.id, imageDataUrl: 'data:image/png;base64,AAAA', describe: true });
  assert.ok(changes() > before, 'the Studio is told about the change');
  assert.match(place.image, /^\/user\/images\/kulisy-library\//);
  assert.deepEqual([place.name, place.traits, place.description, place.autoName], ['Подвальный бар', ['неоновая вывеска', 'липкая стойка'], 'Тесный бар в подвале.', true]);
  assert.match(prompts[0], /PLACE only/);
  assert.equal(store.get().locations[0].image, place.image, 'kept in the library');
});

test('describing again never replaces a name typed by hand; the model may rename its own', async () => {
  const { callbacks } = harness('{"name":"Другое имя","description":"Новое описание."}');
  const folder = callbacks.onLibraryAddFolder({ name: 'ТР' });
  const thing = await callbacks.onLibraryAddFromImage({ kind: 'items', folderId: folder.id, imageDataUrl: 'data:image/png;base64,AAAA' });
  assert.equal(thing.name, 'Новая вещь');
  const named = await callbacks.onLibraryDescribe({ kind: 'items', id: thing.id });
  assert.equal(named.name, 'Другое имя', 'a placeholder is replaced');
  await callbacks.onLibraryUpdateItem({ itemId: thing.id, changes: { name: 'Байк Майки' } });
  const again = await callbacks.onLibraryDescribe({ kind: 'items', id: thing.id });
  assert.deepEqual([again.name, again.description, again.autoName], ['Байк Майки', 'Новое описание.', undefined]);
});

test('a picture shared by a copy is not deleted with the original; the last one is', async () => {
  const { callbacks, removed } = harness('{}');
  const folder = callbacks.onLibraryAddFolder({ name: 'Сибуя' });
  const place = await callbacks.onLibraryAddFromImage({ kind: 'places', folderId: folder.id, imageDataUrl: 'data:image/png;base64,AAAA' });
  const copy = callbacks.onLibraryDuplicateLocation({ locationId: place.id });
  assert.equal(copy.image, place.image);
  await callbacks.onLibraryRemoveLocation({ locationId: place.id });
  assert.deepEqual(removed, [], 'the copy still shows it');
  await callbacks.onLibraryRemoveFolder({ folderId: folder.id });
  assert.deepEqual(removed, [place.image]);
});

test('imports with no folder open go into a folder named after the notes or the lorebook', async () => {
  const { store, callbacks } = harness('{}');
  const notes = await callbacks.onLibraryImportMarkdown({ files: [{ path: 'Локации ТР/Сибуя/Гараж.md', text: 'Гараж Тосвы.' }], folderId: '' });
  assert.equal(notes.added.length, 1);
  assert.ok(store.get().folders.some(folder => folder.name === 'Локации ТР' && !folder.parentId));
  await callbacks.onLibraryImportLorebook({ book: 'Сибуя', folderId: '', kind: 'places' });
  assert.ok(store.get().folders.some(folder => folder.name === 'Сибуя' && !folder.parentId));
  await assert.rejects(() => Promise.resolve().then(() => callbacks.onLibraryImportMarkdown({ files: [], folderId: '' })), /нет заметок/);
});

test('library entries keep only server pictures; autoName is dropped by a hand-typed name', () => {
  const tr = addFolder(emptyLibrary(), { name: 'ТР' });
  const { library, location } = addLocation(tr.library, { folderId: tr.folder.id, name: 'Бар', image: 'https://evil.example/x.png' });
  assert.equal(location.image, undefined);
  const named = updateLocation(library, location.id, { name: 'Бар', autoName: true, image: '/user/images/kulisy-library/a.png' });
  assert.equal(normalizeLibrary(named).locations[0].autoName, true);
  assert.equal(updateLocation(named, location.id, { name: 'Ворон' }).locations[0].autoName, undefined);
});

test('wardrobe: the model renames only a card it named itself', async () => {
  const settings = {};
  const store = createWardrobeStore({ settings: () => settings, save: () => {} });
  const callbacks = createWardrobeCallbacks({
    store, getState: () => createDefaultState(), commitOperations: async () => {}, confirm: async () => true,
    upload: async (dataUrl, name) => `/user/images/kulisy-wardrobe/${name}.png`, removeImage: async () => {}, imageForModel: async () => 'data:image/png;base64,AAAA',
    ask: async () => '{"name":"Красная толстовка","description":"Толстовка."}',
  });
  const card = await callbacks.onWardrobeAddCard({ category: 'top', imageDataUrl: 'data:image/png;base64,AAAA', describe: true });
  assert.equal(card.name, 'Красная толстовка');
  await callbacks.onWardrobeUpdateCard({ cardId: card.id, changes: { name: 'Худи Хины' } });
  const again = await callbacks.onWardrobeDescribe({ cardId: card.id, overwrite: true });
  assert.equal(again.name, 'Худи Хины', 'the name typed after the first description stays');
});

// ---- The page ---------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (/^[A-Z]/.test(name) && typeof dom.window[name] === 'function') { try { globalThis[name] = dom.window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { createRelationshipStudio } = await import('../src/ui/studio.js');

test('«Локации»: folders on the left, pictures in the gallery, a card over the window keeps what was typed', async () => {
  const tr = addFolder(emptyLibrary(), { name: 'Сибуя' });
  const { library, location } = addLocation(tr.library, { folderId: tr.folder.id, name: 'Бар', image: '/user/images/kulisy-library/bar.png', traits: ['неон'], description: 'Тесный бар.' });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); return name === 'onLibraryLorebooks' ? [] : undefined; } : undefined) });
  const snapshot = () => ({ ...createDefaultState(), pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, locationLibrary: library, linkedLocationIds: [], linkedItemIds: [] });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'places' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  try {
    assert.equal(byText('+ Картинки').disabled, true, 'pictures need an open folder');
    shadow.querySelector('.ku-lsec .ku-folder').click();
    assert.equal(byText('+ Картинки').disabled, false);
    assert.ok(shadow.querySelector('.ku-ltile img[src="/user/images/kulisy-library/bar.png"]'), 'the picture is in the gallery');
    shadow.querySelector('.ku-ltile .ku-place-open').click();
    const name = shadow.querySelector('.ku-wcard input[aria-label="Название"]');
    name.value = 'Бар «Ворон»';
    name.dispatchEvent(new dom.window.Event('input'));
    studio.update(snapshot()); // any redraw (a chat event, the model finishing)
    assert.equal(shadow.querySelector('.ku-wcard input[aria-label="Название"]').value, 'Бар «Ворон»', 'typed text survives');
    byText('Сохранить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.find(([handler]) => handler === 'onLibraryUpdateLocation')?.[1].changes.name, 'Бар «Ворон»');
    assert.equal(shadow.querySelector('.ku-wcard'), null, '«Сохранить» closes the card');
    shadow.querySelector('.ku-ltile .ku-place-open').click();
    byText('Описать по картинке').click();
    assert.match(shadow.querySelector('.ku-ask').textContent, /Заменить его новым/, 'there is a description: asks first');
    // The notes import: a real button, enabled with no folder open.
    shadow.querySelector('.ku-wcard button[aria-label="Закрыть"]').click();
    shadow.querySelector('.ku-lroot').click();
    const menu = shadow.querySelector('select[aria-label="Импорт"]');
    menu.value = 'markdown';
    menu.dispatchEvent(new dom.window.Event('change'));
    assert.equal(byText('Выбрать папку заметок').disabled, false);
    assert.ok(shadow.querySelector('input[type="file"][webkitdirectory]'));
  } finally { studio.destroy(); }
  assert.equal(location.name, 'Бар');
});

test('wardrobe: «Унисекс» sits between «Женское» and «Мужское»', async () => {
  const { WARDROBE_GENDERS, addCard, cardsOf, emptyWardrobe } = await import('../src/core/index.js');
  const { parseDescription } = await import('../src/integration/vision.js');
  assert.deepEqual(Object.values(WARDROBE_GENDERS), ['Женское', 'Унисекс', 'Мужское']);
  const { wardrobe } = addCard(emptyWardrobe(), { name: 'Худи', gender: 'unisex' });
  assert.equal(cardsOf(wardrobe, { gender: 'unisex' }).length, 1);
  assert.equal(parseDescription('{"name":"Худи","gender":"unisex","description":"x"}').gender, 'unisex');
});

test('wardrobe: «Сохранить» saves what was typed and closes the card', async () => {
  const { addCard, emptyWardrobe } = await import('../src/core/index.js');
  const { wardrobe, card } = addCard(emptyWardrobe(), { name: 'Худи', category: 'top' });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  const snapshot = () => ({ ...createDefaultState(), pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, wardrobe });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'wardrobe' }, callbacks });
  const shadow = studio.element.shadowRoot;
  try {
    shadow.querySelector('.ku-tile:not(.ku-drop)').click();
    const name = shadow.querySelector('.ku-wcard input[aria-label="Название"]');
    name.value = 'Худи Хины';
    name.dispatchEvent(new dom.window.Event('input'));
    [...shadow.querySelectorAll('.ku-wcard button')].find(node => node.textContent === 'Сохранить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.find(([handler]) => handler === 'onWardrobeUpdateCard')?.[1], { cardId: card.id, changes: { name: 'Худи Хины', shelf: 'characters', gender: 'female', category: 'top', description: '', placement: '' } });
    assert.equal(shadow.querySelector('.ku-wcard'), null);
  } finally { studio.destroy(); }
});

test('scene: whether worn descriptions reach the narrator — whole, only the start, or no room', async () => {
  const { addCard, emptyWardrobe, createEntity, createOperation } = await import('../src/core/index.js');
  const { looksFit } = await import('../src/integration/world-prompt.js');
  const hina = createEntity('Хина');
  const ran = createEntity('Ран');
  let wardrobe = emptyWardrobe();
  const short = addCard(wardrobe, { name: 'Худи', category: 'top', description: 'Красное худи.' }); wardrobe = short.wardrobe;
  const long = addCard(wardrobe, { name: 'Пальто', category: 'outerwear', description: 'Длинное пальто. '.repeat(20) }); wardrobe = long.wardrobe;
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', hina), createOperation('entity.upsert', ran),
    createOperation('scene.set', { presentIds: [hina.id] }),
    createOperation('wardrobe.set', { entityId: hina.id, outfit: 'худи', cardIds: [short.card.id] }),
    createOperation('wardrobe.set', { entityId: ran.id, outfit: 'пальто', cardIds: [long.card.id] }),
  ]);
  const { parts, ...statuses } = looksFit(state, { wardrobe });
  assert.deepEqual(statuses, { [hina.id]: 'full', [ran.id]: 'offstage' });
  assert.ok(parts[hina.id].every(part => part.sent === part.total), 'per card: the whole description is sent');
  const both = applyOperations(state, [createOperation('scene.set', { presentIds: [hina.id, ran.id] })]);
  assert.equal(looksFit(both, { wardrobe })[ran.id], 'cut');
  const tight = applyOperations(both, [createOperation('wardrobe.set', { entityId: hina.id, outfit: 'очень длинная строка одежды '.repeat(10), cardIds: [short.card.id] })]);
  assert.equal(looksFit(tight, { wardrobe, maxCharacters: 300 })[hina.id], 'dropped');
  const fit = looksFit(tight, { wardrobe, maxCharacters: 300 });
  assert.ok(fit.need > 300 && fit.need <= 6000, 'how much is enough');
  assert.equal(looksFit(tight, { wardrobe, maxCharacters: fit.need })[hina.id] !== 'dropped', true, 'and it is enough');
  assert.equal(looksFit(tight, { wardrobe, maxCharacters: fit.need - 100 })[hina.id], 'dropped', 'and the smallest such');
});

test('«Поднять объём сцены» opens «Знания и сцена» on that field', async () => {
  const { addCard, emptyWardrobe, createEntity, createOperation } = await import('../src/core/index.js');
  const hina = createEntity('Хина');
  const { wardrobe, card } = addCard(emptyWardrobe(), { name: 'Худи', category: 'top', description: 'Красное худи с капюшоном.' });
  const state = applyOperations(createDefaultState(), [createOperation('entity.upsert', hina), createOperation('scene.set', { presentIds: [hina.id] }),
    createOperation('wardrobe.set', { entityId: hina.id, outfit: 'худи', cardIds: [card.id] })]);
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? () => undefined : undefined) });
  const snapshot = () => ({ ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, wardrobe, looksFit: { [hina.id]: 'dropped' } });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'wardrobe' }, callbacks });
  const shadow = studio.element.shadowRoot;
  try {
    shadow.querySelector('.ku-tile:not(.ku-drop)').click();
    assert.match(shadow.querySelector('.ku-count').textContent, /из 300/, 'the default per-card limit');
    assert.match(shadow.querySelector('.ku-fit.dropped').textContent, /не влезли/);
    [...shadow.querySelectorAll('button')].find(node => node.textContent === 'Поднять объём сцены').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    const field = shadow.querySelector('input[aria-label="Объём сцены"]');
    assert.ok(field, 'the settings section with the field is open');
    assert.ok(field.closest('.ku-flash'), 'and it is lit up');
  } finally { studio.destroy(); }
});

test('the warning: once when descriptions stop fitting, again only after they fitted', async () => {
  const { newlyDropped } = await import('../src/integration/world-prompt.js');
  let seen = new Set();
  const step = fit => { const { dropped, fresh } = newlyDropped(seen, fit); seen = dropped; return fresh; };
  assert.deepEqual(step({ hina: 'full' }), []);
  assert.deepEqual(step({ hina: 'dropped', need: 2300 }), ['hina'], 'stopped fitting: warn');
  assert.deepEqual(step({ hina: 'dropped', need: 2300 }), [], 'still not: no second warning');
  assert.deepEqual(step({ hina: 'full' }), []);
  assert.deepEqual(step({ hina: 'dropped' }), ['hina'], 'fitted, then not again: warn again');
});

test('wardrobe: «Татуировки» is a section for every gender, described as tattoos only', async () => {
  const { WARDROBE_CATEGORIES, addCard, cardsOf, emptyWardrobe } = await import('../src/core/index.js');
  const { describePrompt } = await import('../src/integration/vision.js');
  assert.ok(WARDROBE_CATEGORIES.some(([id, label]) => id === 'tattoos' && label === 'Татуировки'));
  for (const gender of ['female', 'unisex', 'male']) {
    const { wardrobe } = addCard(emptyWardrobe(), { name: 'Карп', gender, category: 'tattoos' });
    assert.equal(cardsOf(wardrobe, { gender, category: 'tattoos' }).length, 1);
  }
  assert.match(describePrompt('tattoos'), /TATTOOS only[\s\S]*placement/);
  assert.match(describePrompt('makeup'), /tattoos/, 'make-up leaves the tattoos out');
});

test('the docked panel hides on ✕ (its display rule no longer beats [hidden])', () => {
  const studio = createRelationshipStudio({ store: { getSnapshot: () => ({ ...createDefaultState(), pairs: [], settings: {} }) }, open: true, layout: { mode: 'dock', tab: 'overview' }, callbacks: {} });
  try {
    const style = studio.element.shadowRoot.querySelector('style').textContent;
    const docked = style.indexOf('.backdrop.docked{');
    const hidden = style.indexOf('.backdrop.docked[hidden]{display:none}');
    assert.ok(docked >= 0 && hidden > docked, 'a later, equally specific rule hides it');
  } finally { studio.destroy(); }
});

test('wardrobe: «Маникюр» for every gender; make-up and jewellery leave the nails out', async () => {
  const { WARDROBE_CATEGORIES, addCard, cardsOf, emptyWardrobe } = await import('../src/core/index.js');
  const { describePrompt } = await import('../src/integration/vision.js');
  assert.ok(WARDROBE_CATEGORIES.some(([id, label]) => id === 'nails' && label === 'Маникюр'));
  for (const gender of ['female', 'unisex', 'male']) assert.equal(cardsOf(addCard(emptyWardrobe(), { name: 'Френч', gender, category: 'nails' }).wardrobe, { gender, category: 'nails' }).length, 1);
  assert.match(describePrompt('nails'), /MANICURE only/);
  assert.match(describePrompt('makeup'), /Leave out the nails/);
  assert.doesNotMatch(describePrompt('makeup'), /nail polish/);
});

test('tattoos: «Где находится» goes into the prompt for the picture and to the narrator', async () => {
  const { addCard, emptyWardrobe, composeOutfit, updateCard } = await import('../src/core/index.js');
  const { describePrompt } = await import('../src/integration/vision.js');
  let { wardrobe, card } = addCard(emptyWardrobe(), { name: 'Карп', category: 'tattoos', placement: 'левое предплечье' });
  assert.equal(card.placement, 'левое предплечье');
  assert.equal(composeOutfit(wardrobe, [card.id]), 'Карп (левое предплечье)');
  assert.match(describePrompt('tattoos', { placement: 'левое предплечье' }), /tattoo is on: "левое предплечье"[\s\S]*do not guess/);
  assert.doesNotMatch(describePrompt('top', { placement: 'левое предплечье' }), /левое/, 'only tattoos have a placement');
  wardrobe = updateCard(wardrobe, card.id, { placement: '' });
  assert.equal(wardrobe.cards[0].placement, undefined);
  const asked = [];
  const settings = {};
  const store = createWardrobeStore({ settings: () => settings, save: () => {} });
  const callbacks = createWardrobeCallbacks({
    store, getState: () => createDefaultState(), commitOperations: async () => {}, confirm: async () => true,
    upload: async (dataUrl, name) => `/user/images/kulisy-wardrobe/${name}.png`, removeImage: async () => {}, imageForModel: async () => 'data:image/png;base64,AAAA',
    ask: async (dataUrl, prompt) => { asked.push(prompt); return '{"name":"Карп","description":"Карп на левом предплечье."}'; },
  });
  const added = await callbacks.onWardrobeAddCard({ category: 'tattoos', placement: 'левое предплечье', imageDataUrl: 'data:image/png;base64,AAAA' });
  await callbacks.onWardrobeDescribe({ cardId: added.id });
  assert.match(asked[0], /левое предплечье/);
});

test('a hidden shadow host stays hidden: :host{all:initial} must not beat [hidden]', async () => {
  const { hostThemeCss } = await import('../src/ui/theme.js');
  assert.match(hostThemeCss(), /:host\(\[hidden\]\)\{display:none!important\}/);
});

test('a bare "all" list in the model JSON reads as not given', async () => {
  const { parseModelObject } = await import('../src/integration/analyzer.js');
  assert.deepEqual(parseModelObject('{"memories":[{"knownBy":[all],"text":"a"},{"knownBy":[all 9],"text":"b"},{"knownBy":["x", all],"text":"c"}],"operations":[]}'),
    { memories: [{ knownBy: null, text: 'a' }, { knownBy: null, text: 'b' }, { knownBy: null, text: 'c' }], operations: [] });
  assert.deepEqual(parseModelObject('{"text":"[all] в тексте не трогаем"}'), { text: '[all] в тексте не трогаем' });
  assert.throws(() => parseModelObject('{"a":[1,}'));
});

test('chronicle: how many messages until the next scene, and wardrobe prompts ask for catalogue style', async () => {
  const { waiting, nextSceneText } = await import('../src/integration/chronicle-actions.js');
  const stats = waiting(9, { sceneEvery: 15, keepRecent: 20 });
  assert.equal(stats.untilNext, 6);
  assert.match(nextSceneText(stats), /через 6 сообщ\..*по 15.*последние 20/);
  assert.equal(waiting(15, { sceneEvery: 15, keepRecent: 20 }).untilNext, 0);
  const { describePrompt } = await import('../src/integration/vision.js');
  for (const prompt of [describePrompt('top'), describePrompt(null)]) assert.match(prompt, /shop catalogue[\s\S]*No metaphors[\s\S]*at most 300 characters/);
});

test('«Переписать описания»: every card with a picture gets a new description, nothing else changes', async () => {
  const settings = {};
  const store = createWardrobeStore({ settings: () => settings, save: () => {} });
  const callbacks = createWardrobeCallbacks({
    store, getState: () => createDefaultState(), commitOperations: async () => {}, confirm: async () => true,
    upload: async (dataUrl, name) => `/user/images/kulisy-wardrobe/${name}.png`, removeImage: async () => {}, imageForModel: async () => 'data:image/png;base64,AAAA',
    ask: async () => '{"name":"Другое имя","category":"bottom","gender":"male","description":"Белая хлопковая рубашка."}',
  });
  const a = await callbacks.onWardrobeAddCard({ name: 'Моя рубашка', category: 'top', gender: 'female', description: 'Старое.', imageDataUrl: 'data:image/png;base64,AAAA' });
  const b = await callbacks.onWardrobeAddCard({ name: 'Без картинки', category: 'top', description: 'Как было.' });
  const progress = [];
  const result = await callbacks.onWardrobeRedescribe({ cardIds: [a.id, b.id], onProgress: (done, total) => progress.push(`${done}/${total}`) });
  assert.deepEqual(result, { done: 1, failed: 0, skipped: 1 });
  assert.deepEqual(progress, ['1/1']);
  const cards = store.get().cards;
  const first = cards.find(card => card.id === a.id);
  assert.equal(first.description, 'Белая хлопковая рубашка.');
  assert.equal(first.name, 'Моя рубашка');
  assert.equal(first.category, 'top');
  assert.equal(first.gender, 'female');
  assert.equal(cards.find(card => card.id === b.id).description, 'Как было.');
});
