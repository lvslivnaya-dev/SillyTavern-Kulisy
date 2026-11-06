/** «Гардероб» in jsdom: pictures, the card over the window, a ready outfit as one card, the look composer, scoped prompts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addCard, addLook, applyOperations, createDefaultState, createEntity, createOperation, emptyWardrobe } from '../src/core/index.js';
import { describePrompt } from '../src/integration/vision.js';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^[A-Z]/.test(name) && typeof window[name] === 'function') { try { globalThis[name] = window[name]; } catch { /* read-only */ } }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
const { createRelationshipStudio } = await import('../src/ui/studio.js');

const mikey = createEntity('Майки');
const suzu = createEntity('Судзу');
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

function closet() {
  let wardrobe = emptyWardrobe();
  const add = fields => { const result = addCard(wardrobe, fields); wardrobe = result.wardrobe; return result.card; };
  const jacket = add({ shelf: 'characters', gender: 'male', category: 'outerwear', name: 'Токкофуку', description: 'Чёрный китель.', image: '/user/images/kulisy-wardrobe/a.png' });
  const pants = add({ shelf: 'characters', gender: 'male', category: 'pants', name: 'Штаны' });
  add({ shelf: 'persona', gender: 'female', category: 'hair', name: 'Пучок' });
  wardrobe = addLook(wardrobe, { shelf: 'characters', name: 'Форма', cardIds: [jacket.id, pants.id] }).wardrobe;
  return { wardrobe, jacket, pants };
}

function open() {
  const { wardrobe, jacket, pants } = closet();
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', mikey), createOperation('entity.upsert', suzu),
    createOperation('wardrobe.set', { entityId: mikey.id, outfit: 'Токкофуку', cardIds: [jacket.id] }),
  ]);
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? async payload => { calls.push([name, payload]); return { id: 'new' }; } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: [{ id: mikey.id, name: 'Майки' }, { id: suzu.id, name: 'Судзу' }], personaId: suzu.id, wardrobe,
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'wardrobe' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  return { studio, shadow, calls, byText, jacket, pants };
}

test('the gallery shows pictures, who wears what, and the sections; a card opens over the window and closes on Esc', async () => {
  const { studio, shadow, byText, calls, jacket } = open();
  try {
    byText('Мужское').click();
    const tiles = [...shadow.querySelectorAll('.ku-tile:not(.ku-drop)')];
    assert.equal(tiles.length, 2, 'the persona shelf is not mixed in');
    assert.equal(tiles[1].querySelector('img').getAttribute('src'), '/user/images/kulisy-wardrobe/a.png');
    assert.match(tiles[1].querySelector('.ku-worn').textContent, /Майки/);
    assert.equal(shadow.querySelector('.ku-wsb.on').textContent, 'Всё2');
    tiles[1].click();
    const dialog = shadow.querySelector('.ku-wcard');
    assert.ok(dialog, 'the card opened');
    assert.equal(dialog.querySelector('textarea[aria-label="Описание"]').value, 'Чёрный китель.', 'the description is only in the card');
    byText('Описать по картинке').click();
    assert.match(shadow.querySelector('.ku-ask').textContent, /Заменить его/, 'asks before replacing a description');
    byText('Заменить описание').click();
    await flush();
    assert.ok(calls.some(([name, payload]) => name === 'onWardrobeDescribe' && payload.cardId === jacket.id));
    const people = [...shadow.querySelectorAll('.ku-who')].map(node => node.textContent);
    assert.deepEqual(people, ['Майки'], 'the persona is not dressed from the characters shelf');
    shadow.querySelector('.ku-who').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onTakeOff', { entityId: mikey.id, cardId: jacket.id }]);
    shadow.querySelector('.ku-wcard').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(shadow.querySelector('.ku-wcard'), null);
    assert.ok(studio.element.shadowRoot.querySelector('.ku-wardrobe'), 'the Studio itself stays open');
  } finally { studio.destroy(); }
});

test('a ready outfit picture becomes ONE card in «Комплекты»', async () => {
  const { studio, shadow, calls } = open();
  try {
    const input = [...shadow.querySelectorAll('input[type=file]')].find(node => node.getAttribute('aria-label') === '+ Готовый образ');
    const file = new window.File([new Uint8Array([137, 80, 78, 71])], 'look.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new window.Event('change'));
    await flush();
    await flush();
    const add = calls.find(([name]) => name === 'onWardrobeAddCard');
    assert.ok(add, 'a card was added');
    assert.equal(add[1].category, 'sets');
    assert.match(add[1].imageDataUrl, /^data:image\/png;base64,/);
    assert.equal(add[1].adoptSection, false, 'the section stays «Комплекты»');
  } finally { studio.destroy(); }
});

test('the composer: picked cards add up, a look is saved and put on instead of or over the clothes', async () => {
  const { studio, shadow, byText, calls, jacket, pants } = open();
  try {
    byText('Мужское').click();
    shadow.querySelector('.ku-look').click();
    assert.equal(shadow.querySelectorAll('.ku-wside .ku-part').length, 2, 'the look opened in the composer');
    assert.match(shadow.querySelector('.ku-line').textContent, /Штаны; Токкофуку/);
    byText('Поверх').click();
    byText('Надеть').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onWear', { entityId: mikey.id, cardIds: [jacket.id, pants.id], mode: 'add' }]);
    byText('Сохранить изменения').click();
    await flush();
    assert.equal(calls.at(-1)[0], 'onWardrobeUpdateLook');
  } finally { studio.destroy(); }
});

test('describing stays inside the section: a hairstyle keeps hair clips but not the necklace; clothes never get hair or skin', () => {
  const hair = describePrompt('hair');
  assert.match(hair, /anything worn IN the hair \(clips, pins/);
  assert.match(hair, /Leave out .*neck jewellery/);
  assert.match(describePrompt('top'), /Leave out .*hair, skin/);
  assert.match(describePrompt('sets'), /WHOLE OUTFIT[\s\S]*Leave out the hair, make-up, skin/);
  assert.match(describePrompt('jewelry'), /hair accessories \(they belong to the hairstyle\)/);
  assert.match(describePrompt(null), /First decide which ONE section/);
  assert.match(describePrompt(null), /- makeup: /);
});
