import test from 'node:test';
import assert from 'node:assert/strict';
import { addFolder, addLocation, applyOperations, createDefaultState, createEntity, createOperation, emptyLibrary } from '../src/core/index.js';
import { buildScenePrompt, sceneLines } from '../src/integration/world-prompt.js';
import { linkOperations, linkedCards } from '../src/integration/location-links.js';
import { parseWorld } from '../src/integration/world-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';

const mikey = createEntity('Майки');
const ran = createEntity('Ран');
const rindo = createEntity('Риндо');

function library() {
  const folder = addFolder(emptyLibrary(), { name: 'ТР' });
  const district = addLocation(folder.library, { folderId: folder.folder.id, name: 'Роппонги' });
  return addLocation(district.library, {
    folderId: folder.folder.id, name: 'Бар «Хаос»', parentId: district.location.id, traits: ['камин'], description: 'Тесный бар в подвале. '.repeat(40),
  });
}

function scene() {
  const { library: shelf, location: bar } = library();
  let state = applyOperations(createDefaultState(), [mikey, ran, rindo].map(entity => createOperation('entity.upsert', entity)));
  state = applyOperations(state, linkOperations(state, shelf, [bar.id]));
  const card = linkedCards(state).get(bar.id);
  const reply = (type, payload) => createOperation(type, payload, { messageId: '1', messageIndex: 1 });
  state = applyOperations(state, [
    reply('clock.set', { day: 4, time: '23:30', label: 'Суббота' }),
    reply('scene.set', { presentIds: [mikey.id, ran.id], locationId: card.id }),
    reply('location.update', { locationId: card.id, changes: { notes: ['разбито окно'] } }),
    reply('wardrobe.set', { entityId: mikey.id, outfit: 'чёрная форма Тосвы, белый шарф' }),
    reply('wardrobe.set', { entityId: rindo.id, outfit: 'белый костюм' }),
    reply('condition.add', { entityId: mikey.id, item: { id: 'b', text: 'синяк на скуле', days: 5 } }),
    reply('item.add', { item: { id: 'gun', name: 'пистолет', ownerId: mikey.id, place: 'за поясом', importance: 'key', secret: true, knownByIds: [ran.id] } }),
    reply('item.add', { item: { id: 'gum', name: 'жвачка', ownerId: mikey.id } }),
    reply('item.add', { item: { id: 'letter', name: 'письмо', place: 'в камине', importance: 'important' } }),
    reply('item.add', { item: { id: 'phone', name: 'телефон', ownerId: rindo.id, importance: 'key' } }),
  ]);
  return { state, shelf };
}

test('the block: time, path, outfits and things of those on stage only, library features merged', () => {
  const { state, shelf } = scene();
  const block = buildScenePrompt(state, { library: shelf, maxCharacters: 6000 });
  assert.match(block, /time: day 4, 23:30, \(night\), "Суббота"/);
  assert.match(block, /place: Роппонги › Бар «Хаос»/);
  assert.match(block, /wears\[Майки\]: чёрная форма Тосвы, белый шарф/);
  assert.match(block, /holds\[Майки\]: пистолет \(за поясом; SECRET — known only to Майки, Ран\)/);
  assert.match(block, /state\[Майки\]: синяк на скуле/);
  assert.match(block, /also-has\[Майки\]: жвачка/);
  assert.match(block, /lying-around: письмо \(в камине\)/);
  assert.match(block, /place-features: камин/);
  assert.match(block, /place-now: разбито окно/);
  assert.doesNotMatch(block, /Риндо|белый костюм|телефон/, 'Rindo is off stage: nothing of his is sent');
});

test('over the budget the description and small things go first; time and outfits stay', () => {
  const { state, shelf } = scene();
  const block = buildScenePrompt(state, { library: shelf, maxCharacters: 900 });
  assert.ok(block.length <= 1000);
  assert.doesNotMatch(block, /place-about/);
  assert.match(block, /time:/);
  assert.match(block, /wears\[Майки\]/);
  const priorities = sceneLines(state, { library: shelf }).map(line => line.priority);
  assert.deepEqual(priorities.slice(0, 2), [1, 2]);
});

test('nothing known, nothing sent; someone back after days may have changed', () => {
  assert.equal(buildScenePrompt(createDefaultState()), '');
  let { state } = scene();
  state = applyOperations(state, [
    createOperation('clock.set', { advanceDays: 2 }),
    createOperation('scene.set', { presentIds: [mikey.id, rindo.id] }),
  ]);
  assert.match(buildScenePrompt(state, { maxCharacters: 6000 }), /wears\[Риндо\]: белый костюм \(2 day\(s\) since last seen: may have changed\)/);
});

test('slips: kept when the outfit really contradicts, dropped when the character may have changed or changed on page', () => {
  const { state } = scene();
  const meta = { messageId: '2', messageIndex: 2, transactionId: 'message:2' };
  const run = (base, world) => applyAnalysisResult(base, { operations: [], world: parseWorld(world), knowledge: null }, meta);
  const slip = { kind: 'outfit', entityId: 'Майки', quote: 'Майки поправил галстук', note: 'был в форме, без галстука' };
  const kept = run(state, { slips: [slip, { ...slip }, { kind: 'weather', quote: 'дождь' }] });
  assert.deepEqual(kept.slips, [{ kind: 'outfit', entityId: mikey.id, quote: 'Майки поправил галстук', note: 'был в форме, без галстука' }]);
  const changed = run(state, { outfits: [{ entityId: mikey.id, outfit: 'костюм с галстуком' }], slips: [slip] });
  assert.deepEqual(changed.slips, [], 'the same reply changed his clothes: not a slip');
  const away = applyOperations(state, [createOperation('clock.set', { advanceDays: 1 })]);
  assert.deepEqual(run(away, { slips: [slip] }).slips, [], 'a day passed: he may have changed');
  assert.deepEqual(run(state, { slips: [{ kind: 'time', quote: 'полдень' }] }).slips, [{ kind: 'time', quote: 'полдень' }]);
});
