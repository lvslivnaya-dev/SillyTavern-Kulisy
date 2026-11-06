/** One character recorded twice («Manjiro Sano» and «Манджиро Сано»): finding the twins and merging them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyOperations, createDefaultState, createEntity, createOperation, duplicateCandidates, findByNameParts, importState,
  relationshipId, resolveEntityId, rollbackTransaction,
} from '../src/core/index.js';

const mikey = createEntity('Manjiro Sano', { aliases: ['Майки', 'Манджиро', 'Сано'] });
const twin = createEntity('Манджиро Сано');
const hina = createEntity('Акаши Хина', { aliases: ['Хина'] });
const takeomi = createEntity('Takeomi Akashi', { aliases: ['Акаши Такеоми'] });
const ran = createEntity('Ran Haitani', { aliases: ['Хайтани Ран'] });

function chat() {
  let state = applyOperations(createDefaultState(), [
    ...[mikey, twin, hina, takeomi, ran].map(entity => createOperation('entity.upsert', entity)),
    createOperation('relationship.upsert', { from: mikey.id, to: hina.id }),
    createOperation('scale.set', { from: mikey.id, to: hina.id, scaleId: 'trust', value: 40 }),
    createOperation('scale.set', { from: twin.id, to: hina.id, scaleId: 'trust', value: 5 }),
    createOperation('memory.add', { from: twin.id, to: hina.id, item: { id: 'm1', text: 'Он принёс ей худи.' } }),
    createOperation('scale.set', { from: twin.id, to: ran.id, scaleId: 'respect', value: 30 }),
    createOperation('event.add', { item: { id: 'e1', text: 'Драка в баре', witnessIds: [twin.id, ran.id] } }),
    createOperation('acquaintance.set', { firstId: twin.id, secondId: hina.id, status: 'known' }),
    createOperation('scene.set', { presentIds: [twin.id, mikey.id, hina.id] }),
    createOperation('wardrobe.set', { entityId: twin.id, outfit: 'чёрная футболка' }),
    createOperation('feature.add', { entityId: twin.id, item: { id: 'f1', text: 'шрам на виске', kind: 'scar' } }),
    createOperation('item.add', { item: { id: 'i1', name: 'ключи от байка', ownerId: twin.id, importance: 'normal' } }),
  ]);
  state = { ...state, ui: { ...state.ui, personaId: hina.id, headcanons: { [[twin.id, hina.id].sort().join('|')]: { items: [] } } } };
  return state;
}

test('a full name told in parts is found; one word, or two people who fit, is not a match', () => {
  const state = chat();
  assert.equal(findByNameParts(state, 'Манджиро Сано', { exceptId: twin.id }), mikey.id);
  assert.equal(resolveEntityId({ entities: { [mikey.id]: mikey } }, 'Сано Манджиро'), mikey.id, 'any order');
  assert.equal(findByNameParts(state, 'Сано'), null, 'one word is too little');
  assert.equal(findByNameParts(state, 'Акаши Хина', { exceptId: hina.id }), null, 'Takeomi is an Akashi too, but not a Hina');
  const pairs = duplicateCandidates(state);
  assert.deepEqual(pairs, [{ fromId: twin.id, intoId: mikey.id, sure: true }], 'the one whose other names hold the twin name is kept');
});

test('merging moves lines (the kept one wins), records, knowledge, clothes, looks, things; the name becomes another name', () => {
  const state = applyOperations(chat(), [createOperation('entity.merge', { fromId: twin.id, intoId: mikey.id }, { transactionId: 'manual:merge' })]);
  assert.equal(state.entities[twin.id], undefined);
  assert.ok(state.entities[mikey.id].aliases.includes('Манджиро Сано'));
  const line = state.relationships[relationshipId(mikey.id, hina.id)];
  assert.equal(line.scales.trust, 40, 'the kept line wins');
  assert.deepEqual(line.memories.map(item => item.text), ['Он принёс ей худи.'], 'and gets the records');
  assert.equal(state.relationships[relationshipId(mikey.id, ran.id)].scales.respect, 30, 'a line only the twin had moves over');
  assert.ok(Object.values(state.relationships).every(relation => relation.from !== twin.id && relation.to !== twin.id));
  assert.deepEqual([...state.knowledge.events[0].witnessIds].sort(), [mikey.id, ran.id].sort());
  assert.deepEqual([...state.knowledge.scene.presentIds].sort(), [mikey.id, hina.id].sort(), 'present once');
  assert.ok(Object.keys(state.knowledge.acquaintances).some(key => key.includes(mikey.id) && key.includes(hina.id)));
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'чёрная футболка');
  assert.equal(state.world.wardrobe[mikey.id].features[0].text, 'шрам на виске');
  assert.equal(state.world.items[0].ownerId, mikey.id);
  assert.ok(Object.keys(state.ui.headcanons).every(key => !key.includes(twin.id)));
  assert.doesNotThrow(() => importState(JSON.parse(JSON.stringify(state))), 'the merged state is valid');
  const undone = rollbackTransaction(state, 'manual:merge');
  assert.ok(undone.entities[twin.id], 'undone from the history');
});

test('the persona can be the one merged away', () => {
  const persona = createEntity('Хина Акаши');
  let state = applyOperations(createDefaultState(), [hina, persona].map(entity => createOperation('entity.upsert', entity)));
  state = { ...state, ui: { ...state.ui, personaId: persona.id } };
  state = applyOperations(state, [createOperation('entity.merge', { fromId: persona.id, intoId: hina.id })]);
  assert.equal(state.ui.personaId, hina.id);
});

// ---- The page --------------------------------------------------------------------

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

test('«Персонажи» shows the twins with «Объединить» / «Наоборот»; the dossier merges with any other', async () => {
  const state = chat();
  const calls = [];
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    duplicates: [{ fromId: twin.id, intoId: mikey.id, fromName: 'Манджиро Сано', intoName: 'Manjiro Sano' }],
  });
  const callbacks = { onMergeCharacters: async payload => { calls.push(payload); return true; } };
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'characters' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  try {
    assert.match(shadow.querySelector('.ku-twins').textContent, /Похоже, записаны дважды · 1[\s\S]*Манджиро Сано → войдёт в → Manjiro Sano/);
    byText('Объединить').click();
    byText('Наоборот').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls, [{ pairs: [{ fromId: twin.id, intoId: mikey.id }] }, { pairs: [{ fromId: mikey.id, intoId: twin.id }] }]);
    shadow.querySelector('.ku-person').click();
    const select = shadow.querySelector('select[aria-label="Объединить с другим персонажем"]');
    assert.ok(select, 'the dossier has «Объединить с…»');
  } finally { studio.destroy(); }
});
