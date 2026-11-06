/** The knowledge pages in jsdom with real data: every control reaches its handler. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyOperations, createDefaultState, createEntity, createOperation, dossier } from '../src/core/index.js';

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

const ran = createEntity('Ран');
const suzu = createEntity('Судзу');
const mikey = createEntity('Майки');

function snapshotOf() {
  let state = applyOperations(createDefaultState(), [
    ...[ran, suzu, mikey].map(entity => createOperation('entity.upsert', entity)),
    createOperation('event.add', { item: { id: 'alley', text: 'Разговор в подворотне', witnessIds: [ran.id, suzu.id], secret: true } }),
    createOperation('scene.set', { presentIds: [mikey.id, suzu.id], location: 'гараж' }),
  ]);
  state = { ...state, ui: { ...state.ui, personaId: suzu.id } };
  return {
    ...state,
    personaId: suzu.id,
    pairs: [],
    dossiers: Object.fromEntries(Object.keys(state.entities).map(id => [id, dossier(state, id)])),
    leaks: [{ messageIndex: 4, entityId: mikey.id, eventId: 'alley', quote: 'Ты же была в подворотне', name: 'Майки', eventText: 'Разговор в подворотне', canSwipe: true }],
    knowledgePreview: '[KULISY]\nscene: present=Майки, Судзу\n\nRules:\n- …',
    knowledgeTokens: 12,
    settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
  };
}

function open(tab, handlers = {}) {
  const calls = [];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  const proxy = new Proxy(handlers, { get: (target, name) => target[name] ?? (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); } : undefined) });
  let studio;
  try {
    studio = createRelationshipStudio({ store: { getSnapshot: snapshotOf }, open: true, layout: { mode: 'window', tab }, callbacks: proxy });
  } finally { console.error = original; }
  return { studio, shadow: studio.element.shadowRoot, calls, errors };
}

const buttonByText = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent === text);

test('«Сейчас»: someone backstage comes on, the place and the clock are edited in place', () => {
  const { studio, shadow, calls, errors } = open('scene');
  try {
    assert.deepEqual(errors, []);
    assert.equal(shadow.querySelectorAll('.ku-actor').length, 2, 'Mikey and Suzu are on stage');
    assert.match(shadow.querySelector('.ku-backstage-head').textContent, /За кулисами · 1/);
    const ranChip = [...shadow.querySelectorAll('.ku-off')].find(node => node.textContent.includes('Ран'));
    ranChip.click();
    assert.deepEqual(calls.at(-1), ['onTogglePresent', { characterId: ran.id, present: true }]);
    shadow.querySelector('button.ku-place').click();
    const place = shadow.querySelector('input[aria-label="Место словами"]');
    assert.equal(place.value, 'гараж');
    place.value = 'мост';
    buttonByText(shadow, 'Сохранить').click();
    assert.deepEqual(calls.at(-1), ['onSetSceneLocation', { location: 'мост' }]);
    shadow.querySelector('button.ku-clock').click();
    shadow.querySelector('input[aria-label="Время"]').value = '23:30';
    buttonByText(shadow, 'Сохранить').click();
    assert.deepEqual(calls.at(-1), ['onSetClock', { day: '', time: '23:30', label: '', flashback: false }]);
  } finally { studio.destroy(); }
});

test('characters: a card opens the dossier; "knows" and acquaintance changes reach their handlers', () => {
  const { studio, shadow, calls, errors } = open('characters');
  try {
    assert.deepEqual(errors, []);
    const cards = [...shadow.querySelectorAll('.ku-person')];
    assert.equal(cards.length, 3);
    cards.find(card => card.textContent.includes('Майки')).click();
    const dossierCard = shadow.querySelector('.ku-dossier');
    assert.ok(dossierCard, 'dossier is open');
    assert.match(dossierCard.textContent, /Не знает[\s\S]*Разговор в подворотне/);
    buttonByText(dossierCard, 'Знает').click();
    assert.deepEqual(calls.at(-1), ['onAddLearned', { eventId: 'alley', entityId: mikey.id, source: 'told' }]);
    buttonByText(dossierCard, 'Знакомства').click();
    const select = shadow.querySelector('.ku-dossier select[aria-label="Знакомство: Судзу"]');
    assert.ok(select, 'the persona is in the list');
    assert.ok(shadow.querySelector('.ku-dossier').textContent.includes('не знакомы (персона)'), 'default stranger to the persona is shown');
    select.value = 'known';
    select.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.at(-1), ['onSetAcquaintance', { firstId: mikey.id, secondId: suzu.id, status: 'known' }]);
  } finally { studio.destroy(); }
});

test('events: the log shows witnesses and a new event is sent with them', async () => {
  const added = [];
  const { studio, shadow, errors } = open('events', { onAddEvent: payload => { added.push(payload); } });
  try {
    assert.deepEqual(errors, []);
    assert.match(shadow.querySelector('.record-list').textContent, /Разговор в подворотне[\s\S]*видели:[\s\S]*Ран[\s\S]*Судзу/);
    const text = shadow.querySelector('textarea[aria-label="Новое событие"]');
    text.value = 'Майки нашёл записку';
    text.dispatchEvent(new window.Event('input'));
    const mikeyBox = [...shadow.querySelectorAll('.card .roster-item')].find(label => label.textContent === 'Майки').querySelector('input');
    mikeyBox.checked = true;
    mikeyBox.dispatchEvent(new window.Event('change'));
    buttonByText(shadow, 'Добавить событие').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(added[0], { text: 'Майки нашёл записку', witnessIds: [mikey.id], secret: false, location: 'гараж' });
  } finally { studio.destroy(); }
});

test('leaks: the menu shows the count; swipe, "he knows" and dismiss reach their handlers', () => {
  const { studio, shadow, calls, errors } = open('leaks');
  try {
    assert.deepEqual(errors, []);
    assert.equal(shadow.querySelector('.nav .badge')?.textContent, '1');
    assert.match(shadow.querySelector('.ku-quote').textContent, /Ты же была в подворотне/);
    const payload = { messageIndex: 4, entityId: mikey.id, eventId: 'alley' };
    buttonByText(shadow, 'Свайп').click();
    assert.deepEqual(calls.at(-1), ['onLeakSwipe', payload]);
    buttonByText(shadow, 'Он знает').click();
    assert.deepEqual(calls.at(-1), ['onLeakKnows', payload]);
    buttonByText(shadow, 'Не утечка').click();
    assert.deepEqual(calls.at(-1), ['onLeakDismiss', payload]);
  } finally { studio.destroy(); }
});

test('«За кулисами»: a tidy grid, the first eight, «показать всех» for the rest', () => {
  const crowd = Array.from({ length: 11 }, (_, index) => createEntity(`Очень длинное имя персонажа ${index}`));
  let state = applyOperations(createDefaultState(), [...[mikey, ...crowd].map(entity => createOperation('entity.upsert', entity)), createOperation('scene.set', { presentIds: [mikey.id] })]);
  state = { ...state, pairs: [], dossiers: {}, leaks: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] } };
  const studio = createRelationshipStudio({ store: { getSnapshot: () => state }, open: true, layout: { mode: 'window', tab: 'scene' }, callbacks: {} });
  const shadow = studio.element.shadowRoot;
  try {
    assert.match(shadow.querySelector('.ku-backstage-head').textContent, /За кулисами · 11/);
    assert.equal(shadow.querySelectorAll('.ku-off').length, 8);
    assert.match(shadow.querySelector('.ku-off .muted').textContent, /одежда не записана/);
    buttonByText(shadow, 'Показать всех · ещё 3').click();
    assert.equal(shadow.querySelectorAll('.ku-off').length, 11);
    buttonByText(shadow, 'Свернуть').click();
    assert.equal(shadow.querySelectorAll('.ku-off').length, 8);
  } finally { studio.destroy(); }
});
