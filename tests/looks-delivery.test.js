/** 0.1.1: how much of each worn card's description reaches the narrator, and where it is shown. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { addCard, applyOperations, composeOutfit, createDefaultState, createEntity, createOperation, emptyWardrobe, outfitLabel } from '../src/core/index.js';
import { buildScenePrompt, looksFit, looksIssues, normalizeLooksLimits } from '../src/integration/world-prompt.js';
import { createWorldCallbacks } from '../src/integration/world-actions.js';

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

const hina = createEntity('Хина');

/** Hina on stage in three cards: hair (named by its section), a 400-character dress, shoes. */
function dressed() {
  let wardrobe = emptyWardrobe();
  const added = [];
  for (const fields of [
    { name: 'Волосы', category: 'hair', description: 'Длинные розовые волосы с чёлкой. Заколка-бант.' },
    { name: 'Платье с кружевом', category: 'dresses', description: 'Платье. '.repeat(50).trim() },
    { name: 'Обувь', category: 'shoes', description: 'Белые кеды на толстой подошве.' },
  ]) {
    const result = addCard(wardrobe, fields);
    wardrobe = result.wardrobe;
    added.push(result.card);
  }
  const cardIds = added.map(card => card.id);
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', hina),
    createOperation('scene.set', { presentIds: [hina.id] }),
    createOperation('wardrobe.set', { entityId: hina.id, outfit: composeOutfit(wardrobe, cardIds), cardIds }),
  ]);
  return { state, wardrobe, cards: added };
}

test('limits come from the settings, clamped, and never below one card', () => {
  assert.deepEqual(normalizeLooksLimits({}), { card: 300, character: 1200 });
  assert.deepEqual(normalizeLooksLimits({ card: 5, character: 99999 }), { card: 80, character: 4000 });
  assert.deepEqual(normalizeLooksLimits({ card: 900, character: 300 }), { card: 900, character: 900 });
});

test('per card: how much of the description reaches the narrator', () => {
  const { state, wardrobe, cards } = dressed();
  const fit = looksFit(state, { wardrobe, maxCharacters: 6000 });
  assert.equal(fit[hina.id], 'cut', 'the long dress is cut at 300');
  const [hair, dress, shoes] = fit.parts[hina.id];
  assert.equal(hair.cardId, cards[0].id);
  assert.equal(hair.sent, hair.total, 'hair whole');
  assert.equal(dress.sent, 299, 'the dress: 300 minus the "…"');
  assert.ok(dress.total > 300);
  assert.equal(shoes.sent, shoes.total, 'shoes whole');
});

test('the per-character limit drops the last pieces entirely; raising the limits fixes it', () => {
  const { state, wardrobe } = dressed();
  const tight = looksFit(state, { wardrobe, maxCharacters: 6000, looksLimits: { card: 300, character: 330 } });
  const shoes = tight.parts[hina.id][2];
  assert.equal(shoes.sent, 0, 'shoes do not reach the narrator at all');
  const roomy = looksFit(state, { wardrobe, maxCharacters: 6000, looksLimits: { card: 1000, character: 4000 } });
  assert.equal(roomy[hina.id], 'full');
});

test('no room in the scene: every card reads as not sent', () => {
  const { state, wardrobe } = dressed();
  const fit = looksFit(state, { wardrobe, maxCharacters: 300 });
  assert.equal(fit[hina.id], 'dropped');
  assert.ok(fit.parts[hina.id].every(part => part.sent === 0));
});

test('"Проверка" lists only characters on stage whose descriptions are cut or lost', () => {
  assert.deepEqual(looksIssues({ a: 'full', b: 'offstage', c: 'cut', d: 'dropped', parts: { c: [{ sent: 1, total: 2 }] } }).map(issue => issue.entityId), ['c', 'd']);
  assert.deepEqual(looksIssues({ off: true }), []);
  assert.deepEqual(looksIssues(undefined), []);
});

test('the outfit line tells a section-named card by the start of its description', () => {
  const { wardrobe, cards } = dressed();
  assert.equal(outfitLabel(cards[0]), 'Волосы: Длинные розовые волосы с чёлкой');
  assert.equal(outfitLabel(cards[1]), 'Платье с кружевом', 'a real name stays');
  assert.equal(composeOutfit(wardrobe, cards.map(card => card.id)), 'Волосы: Длинные розовые волосы с чёлкой; Платье с кружевом; Обувь: Белые кеды на толстой подошве');
  const { card: tattoo } = addCard(emptyWardrobe(), { name: 'Татуировки', category: 'tattoos', placement: 'палец', description: 'Красные бабочки.' });
  assert.equal(outfitLabel(tattoo), 'Татуировки: Красные бабочки (палец)');
});

test('saving the outfit words keeps the wardrobe cards; "change by words" takes them off', async () => {
  const { state } = dressed();
  const committed = [];
  const callbacks = createWorldCallbacks({ getState: () => state, commitOperations: operations => { committed.push(...operations); } });
  await callbacks.onSetOutfit({ entityId: hina.id, outfit: 'то же самое', keepCards: true });
  assert.deepEqual(committed[0].payload.cardIds, state.world.wardrobe[hina.id].cardIds);
  await callbacks.onSetOutfit({ entityId: hina.id, outfit: 'пижама' });
  assert.equal(committed[1].payload.cardIds, undefined, 'words alone: the cards come off');
  const after = applyOperations(state, [committed[1]]);
  assert.equal(after.world.wardrobe[hina.id].cardIds, undefined);
});

test('UI: the "Одежда" section in Проверка and the menu count', () => {
  const { state, wardrobe } = dressed();
  const fit = looksFit(state, { wardrobe, maxCharacters: 6000, looksLimits: { card: 300, character: 330 } });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  const snapshot = () => ({ ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, wardrobe, looksFit: fit });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'leaks' }, callbacks });
  const shadow = studio.element.shadowRoot;
  try {
    const text = shadow.querySelector('.content').textContent;
    assert.match(text, /Одежда · 1/);
    assert.match(text, /Платье с кружевом — доходит/);
    assert.match(text, /Обувь — не доходит совсем/);
    assert.equal(shadow.querySelector('.nav .badge')?.textContent, '1', 'counted with leaks and slips');
    assert.ok([...shadow.querySelectorAll('button')].some(node => node.textContent === 'Поднять лимит описаний'));
  } finally { studio.destroy(); }
});

test('UI: in the dossier each worn card says how much reaches the model; Save keeps the cards', () => {
  const { state, wardrobe } = dressed();
  const fit = looksFit(state, { wardrobe, maxCharacters: 6000, looksLimits: { card: 300, character: 330 } });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  const snapshot = () => ({ ...state, characters: Object.values(state.entities), pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, wardrobe, looksFit: fit });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'characters' }, callbacks });
  const shadow = studio.element.shadowRoot;
  try {
    [...shadow.querySelectorAll('.ku-person')].find(card => card.textContent.includes('Хина')).click();
    [...shadow.querySelectorAll('.ku-dossier button')].find(node => node.textContent === 'Гардероб').click();
    const notes = [...shadow.querySelectorAll('.ku-delivery')].map(node => node.textContent);
    assert.ok(notes.some(text => /модели доходит \d+ из \d+ символов/.test(text)), notes.join(' | '));
    assert.ok(notes.includes('описание до модели не доходит'), notes.join(' | '));
    const buttons = [...shadow.querySelectorAll('.ku-dossier button')].map(node => node.textContent);
    assert.ok(buttons.includes('Собрать из карточек') && buttons.includes('Переодеть словами'), buttons.join(' | '));
    [...shadow.querySelectorAll('.ku-dossier button')].find(node => node.textContent === 'Сохранить').click();
    assert.deepEqual(calls.filter(([name]) => name === 'onSetOutfit').at(-1)?.[1]?.keepCards, true);
  } finally { studio.destroy(); }
});

test('when something is cut: the values that send it all; setting them makes everything whole', () => {
  const { state, wardrobe } = dressed();
  const fit = looksFit(state, { wardrobe, maxCharacters: 1500 });
  assert.equal(fit[hina.id], 'cut');
  const need = fit.needLooks;
  assert.equal(need.card, Math.max(...fit.parts[hina.id].map(part => part.total)), 'exactly the longest description');
  assert.ok(need.character >= need.card);
  assert.ok(need.scene >= 1500);
  const after = looksFit(state, { wardrobe, maxCharacters: need.scene, looksLimits: { card: need.card, character: need.character } });
  assert.equal(after[hina.id], 'full', 'the proposed values are enough');
  assert.equal(after.needLooks, undefined, 'and nothing is left to fix');
  assert.ok(after.parts[hina.id].every(part => part.sent === part.total));
});

test('a card over 1000 characters is named: it can never go whole', () => {
  let { wardrobe } = dressed();
  const { wardrobe: next, card } = addCard(wardrobe, { name: 'Пальто', category: 'outerwear', description: 'Длинное пальто. '.repeat(80).trim() });
  wardrobe = next;
  const base = dressed().state;
  const cardIds = [...base.world.wardrobe[hina.id].cardIds, card.id];
  const state = applyOperations(base, [createOperation('wardrobe.set', { entityId: hina.id, outfit: 'x', cardIds })]);
  const need = looksFit(state, { wardrobe, maxCharacters: 6000 }).needLooks;
  assert.equal(need.card, 1000);
  assert.deepEqual(need.tooLong.map(item => item.label), ['Пальто']);
});

test('UI: the advice shows the exact values and its button sets them; all whole shows a green line', () => {
  const { state, wardrobe } = dressed();
  const cut = looksFit(state, { wardrobe, maxCharacters: 1500 });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  let fit = cut;
  const snapshot = () => ({ ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] }, wardrobe, looksFit: fit });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'leaks' }, callbacks });
  const shadow = studio.element.shadowRoot;
  try {
    const advice = shadow.querySelector('.ku-looks-advice').textContent;
    assert.ok(advice.includes(`«Описание одной вещи» — ${cut.needLooks.card} (сейчас 300)`), advice);
    [...shadow.querySelectorAll('button')].find(node => node.textContent === 'Поставить нужные значения').click();
    const patch = calls.find(([name]) => name === 'onSettingsChange')?.[1]?.settings;
    assert.equal(patch.looksCardCharacters, cut.needLooks.card);
    fit = looksFit(state, { wardrobe, maxCharacters: cut.needLooks.scene, looksLimits: { card: cut.needLooks.card, character: cut.needLooks.character } });
    studio.update(snapshot());
    assert.match(shadow.querySelector('.content').textContent, /доходят до модели целиком/);
    assert.match(shadow.querySelector('.content').textContent, /Одежда · 0/);
  } finally { studio.destroy(); }
});

test('hair colour: the rule joins the scene only while a hairstyle card is worn', () => {
  const { state, wardrobe } = dressed();
  assert.match(buildScenePrompt(state, { wardrobe, maxCharacters: 6000 }), /Never take the hair colour from a hairstyle card/);
  const cardIds = state.world.wardrobe[hina.id].cardIds.filter(id => wardrobe.cards.find(card => card.id === id)?.category !== 'hair');
  const bare = applyOperations(state, [createOperation('wardrobe.set', { entityId: hina.id, outfit: 'x', cardIds })]);
  assert.doesNotMatch(buildScenePrompt(bare, { wardrobe, maxCharacters: 6000 }), /hair colour/);
});
