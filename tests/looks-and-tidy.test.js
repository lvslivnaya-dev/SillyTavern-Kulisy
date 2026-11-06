/** Lasting looks (scars, tattoos, dyed hair) and keeping things from piling up. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyOperations, createDefaultState, createEntity, createOperation, featuresOf, rollbackMessage } from '../src/core/index.js';
import { buildWorldBlock, parseWorld, WORLD_INSTRUCTIONS } from '../src/integration/world-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';
import { createReminders, createWorldCallbacks } from '../src/integration/world-actions.js';
import { dormantItemIds } from '../src/integration/item-tidy.js';

const suzu = createEntity('Судзу');
const ran = createEntity('Ран');
const meta = index => ({ messageId: String(index), messageIndex: index, transactionId: `message:${index}` });

function chat() {
  return applyOperations(createDefaultState(), [
    ...[suzu, ran].map(entity => createOperation('entity.upsert', entity)),
    createOperation('clock.set', { day: 3 }),
    createOperation('scene.set', { presentIds: [suzu.id, ran.id] }),
    createOperation('condition.add', { entityId: suzu.id, item: { id: 'cut', text: 'порез на щеке', days: 5 } }),
  ]);
}

const analyse = (state, world, index) => applyAnalysisResult(state, { operations: [], world: parseWorld(world), knowledge: null }, meta(index), [], { trackWorld: true }).state;

test('a cut that heals into a scar moves from conditions to lasting looks; a swipe undoes it', () => {
  let state = analyse(chat(), { features: [{ entityId: suzu.id, text: 'тонкий шрам на левой щеке', kind: 'scar' }], conditionsGone: [{ entityId: suzu.id, conditionId: 'cut' }] }, 5);
  assert.deepEqual(featuresOf(state, suzu.id).map(feature => [feature.text, feature.kind, feature.sinceDay]), [['тонкий шрам на левой щеке', 'scar', 3]]);
  assert.equal(state.world.wardrobe[suzu.id].conditions.length, 0);
  state = analyse(state, { features: [{ entityId: suzu.id, text: 'тонкий шрам на левой щеке' }] }, 6);
  assert.equal(featuresOf(state, suzu.id).length, 1, 'never a twin');
  state = rollbackMessage(rollbackMessage(state, '6'), '5');
  assert.equal(featuresOf(state, suzu.id).length, 0);
  assert.equal(state.world.wardrobe[suzu.id].conditions.length, 1);
});

test('a revealed detail rewrites the look; a locked look stays; the chronicler sees them with IDs', () => {
  let state = analyse(chat(), { features: [{ entityId: ran.id, text: 'волосы перекрашены в рыжий', kind: 'hair' }] }, 5);
  const [hair] = featuresOf(state, ran.id);
  assert.match(buildWorldBlock(state, 'Ран', null), new RegExp(`lasting looks: ${hair.id}: волосы перекрашены в рыжий`));
  assert.match(WORLD_INSTRUCTIONS, /featuresChanged/);
  state = analyse(state, { featuresChanged: [{ entityId: ran.id, featureId: hair.id, text: 'волосы перекрашены в рыжий, у корней отросли чёрные' }] }, 6);
  assert.match(featuresOf(state, ran.id)[0].text, /отросли чёрные/);
  state = applyOperations(state, [createOperation('feature.update', { entityId: ran.id, featureId: hair.id, changes: { locked: true } })]);
  state = analyse(state, { featuresGone: [{ entityId: ran.id, featureId: hair.id }] }, 7);
  assert.equal(featuresOf(state, ran.id).length, 1, 'locked by hand');
});

test('the narrator gets lasting looks with the clothes, above the card, and they are never the first to go', () => {
  let state = applyOperations(chat(), [
    createOperation('wardrobe.set', { entityId: suzu.id, outfit: 'худи' }),
    createOperation('feature.add', { entityId: suzu.id, item: { id: 'f1', text: 'тату ворона на запястье', kind: 'tattoo' } }),
    ...Array.from({ length: 12 }, (_, index) => createOperation('item.add', { item: { id: `i${index}`, name: `мелочь номер ${index} с длинным названием`, ownerId: suzu.id, importance: 'normal' } })),
  ]);
  const block = buildScenePrompt(state, { maxCharacters: 400 });
  assert.match(block, /body\[Судзу\]: тату ворона на запястье/);
  assert.match(block, /override the character card, the persona description/);
  assert.doesNotMatch(block, /мелочь номер 11/, 'small things went first');
  state = applyOperations(state, [createOperation('item.update', { itemId: 'i0', changes: { off: true } })]);
  assert.doesNotMatch(buildScenePrompt(state, { maxCharacters: 4000 }), /мелочь номер 0 /, 'a switched-off thing is not sent');
});

test('a «looks» slip needs something recorded; «Так и есть» writes the look, «Напомнить» tells the narrator', async () => {
  let state = applyOperations(chat(), [createOperation('feature.add', { entityId: ran.id, item: { id: 'h', text: 'рыжие волосы', kind: 'hair' } })]);
  const applied = applyAnalysisResult(state, { operations: [], world: parseWorld({ slips: [
    { kind: 'looks', entityId: ran.id, quote: 'провёл рукой по чёрным волосам' },
    { kind: 'looks', entityId: suzu.id, quote: 'без шрамов' },
  ] }), knowledge: null }, meta(8), [], { trackWorld: true });
  assert.deepEqual(applied.slips.map(slip => slip.entityId), [ran.id], 'Судзу has nothing recorded: not a slip');
  const chatLog = [{}, {}, {}, {}, {}, {}, {}, {}, { extra: { k: { slips: [{ kind: 'looks', entityId: ran.id, quote: 'чёрные волосы' }, { kind: 'looks', entityId: ran.id, quote: 'чёрные волосы' }] } } }];
  const reminders = createReminders();
  const callbacks = createWorldCallbacks({
    getState: () => state, commitOperations: async operations => { state = applyOperations(state, operations); },
    chat: () => chatLog, saveChat: async () => {}, markerKey: 'k', input: async () => 'волосы снова чёрные, смыл краску', reminders, refresh() {},
  });
  await callbacks.onSlipRemind({ messageIndex: 8, slipIndex: 0 });
  assert.match(reminders.list()[0], /Ран's lasting looks are: рыжие волосы/);
  await callbacks.onSlipAccept({ messageIndex: 8, slipIndex: 0 });
  assert.ok(featuresOf(state, ran.id).some(feature => /смыл краску/.test(feature.text)));
});

test('things in the shade: ordinary, untouched for long and not named; a hand-added or important one never', () => {
  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', ran)]);
  state = applyOperations(state, [
    createOperation('item.add', { item: { id: 'cup', name: 'чашка', importance: 'normal' } }, meta(2)),
    createOperation('item.add', { item: { id: 'wallet', name: 'кожаный кошелёк', importance: 'normal' } }, meta(3)),
    createOperation('item.add', { item: { id: 'gun', name: 'пистолет', importance: 'key' } }, meta(3)),
    createOperation('item.add', { item: { id: 'pen', name: 'ручка', importance: 'normal' } }),
  ]);
  const log = Array.from({ length: 60 }, (_, index) => ({ mes: index === 55 ? 'Он достал кошелёк.' : 'текст' }));
  assert.deepEqual(dormantItemIds(state, log, { after: 40 }), ['cup']);
  assert.deepEqual(dormantItemIds(state, log, { after: 0 }), [], '0 = never');
  assert.deepEqual(dormantItemIds(state, log.slice(0, 30), { after: 40 }), [], 'a short chat has no shade');
  const block = buildWorldBlock(state, 'Ран', null, null, ['cup']);
  assert.doesNotMatch(block, /чашка/);
  // Named again by the chronicler: found by name, switched on again.
  state = applyOperations(state, [createOperation('item.update', { itemId: 'cup', changes: { off: true } })]);
  state = applyAnalysisResult(state, { operations: [], world: parseWorld({ items: [{ name: 'Чашка', place: 'на столе' }] }), knowledge: null }, meta(61), [], { trackWorld: true }).state;
  assert.equal(state.world.items.filter(item => item.name.toLowerCase() === 'чашка').length, 1);
  assert.equal(state.world.items.find(item => item.id === 'cup').off, undefined);
});

// ---- The pages ---------------------------------------------------------------

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
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('«Вещи»: tabs «В ходу» / «В тени» / «Отключённые», several at once, delete all switched off', async () => {
  const state = applyOperations(chat(), [
    createOperation('item.add', { item: { id: 'a', name: 'нож', ownerId: ran.id, importance: 'normal' } }),
    createOperation('item.add', { item: { id: 'b', name: 'чашка', importance: 'normal' } }),
    createOperation('item.add', { item: { id: 'c', name: 'зонт', importance: 'normal', off: true } }),
    createOperation('feature.add', { entityId: ran.id, item: { id: 'f', text: 'шрам на руке', kind: 'scar' } }),
  ]);
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? async payload => { calls.push([name, payload]); } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: { itemsDormantAfter: 40 }, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: [{ id: suzu.id, name: 'Судзу' }, { id: ran.id, name: 'Ран' }], dormantItemIds: ['b'],
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'items' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  try {
    const tabs = () => [...shadow.querySelectorAll('.ku-subtabs button')];
    assert.deepEqual(tabs().map(node => node.textContent), ['В ходу · 1', 'В тени · 1', 'Отключённые · 1']);
    assert.deepEqual([...shadow.querySelectorAll('.card h3')].map(node => node.textContent), ['Ран · на сцене'], 'only what is in use');
    assert.equal(shadow.querySelector('button[aria-label^="В ход —"]'), null, 'in use: no «в ход»');
    shadow.querySelector('button[aria-label^="В тень —"]').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onItemsBulk', { itemIds: ['a'], action: 'shade' }]);
    shadow.querySelector('button[aria-label^="Отключить"]').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onItemsBulk', { itemIds: ['a'], action: 'off' }]);
    tabs()[1].click();
    assert.match(shadow.querySelector('.ku-facts').textContent, /чашка/);
    assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
    byText('Выбрать несколько').click();
    byText('Выбрать все').click();
    assert.equal(byText('В тень (1)').hidden, true, 'already there');
    byText('Отключить (1)').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onItemsBulk', { itemIds: ['b'], action: 'off' }]);
    byText('Готово').click();
    tabs()[2].click();
    assert.match(shadow.querySelector('.ku-facts').textContent, /зонт/);
    shadow.querySelector('button[aria-label^="В тень —"]').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onItemsBulk', { itemIds: ['c'], action: 'shade' }], 'from switched off straight into the shade');
    byText('Удалить все отключённые').click();
    await flush();
    assert.deepEqual(calls.at(-1), ['onItemsBulk', { itemIds: ['c'], action: 'remove' }]);
  } finally { studio.destroy(); }
});

test('moving by hand: into the shade (any thing, until it is named again), back in use (the count starts anew)', async () => {
  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', ran)]);
  state = applyOperations(state, [
    createOperation('item.add', { item: { id: 'gun', name: 'пистолет', importance: 'key' } }, meta(2)),
    createOperation('item.add', { item: { id: 'cup', name: 'чашка', importance: 'normal' } }, meta(2)),
  ]);
  const log = Array.from({ length: 60 }, () => ({ mes: 'текст' }));
  const callbacks = createWorldCallbacks({
    getState: () => state, commitOperations: async operations => { state = applyOperations(state, operations); },
    chat: () => log, saveChat: async () => {}, markerKey: 'k', reminders: createReminders(), refresh() {},
  });
  assert.deepEqual(dormantItemIds(state, log, { after: 40 }), ['cup']);
  await callbacks.onItemsBulk({ itemIds: ['gun'], action: 'shade' });
  assert.deepEqual(dormantItemIds(state, log, { after: 40 }).sort(), ['cup', 'gun'], 'even a key thing, when put there by hand');
  await callbacks.onItemsBulk({ itemIds: ['cup', 'gun'], action: 'on' });
  assert.deepEqual(dormantItemIds(state, log, { after: 40 }), [], 'back in use from now');
  assert.deepEqual(dormantItemIds(state, [...log, ...Array.from({ length: 41 }, () => ({ mes: 'x' }))], { after: 40 }), ['cup'], '…until forgotten again');
  await callbacks.onItemsBulk({ itemIds: ['cup'], action: 'off' });
  await callbacks.onItemsBulk({ itemIds: ['cup'], action: 'shade' });
  assert.equal(state.world.items.find(item => item.id === 'cup').off, undefined, 'from switched off into the shade');
  state = applyAnalysisResult(state, { operations: [], world: parseWorld({ items: [{ name: 'чашка', place: 'на подоконнике' }] }), knowledge: null }, meta(70), [], { trackWorld: true }).state;
  assert.equal(state.world.items.find(item => item.id === 'cup').shade, undefined, 'named again: back in use');
});
