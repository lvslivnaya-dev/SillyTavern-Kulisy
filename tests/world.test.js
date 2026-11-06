import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeConditions, applyOperation, applyOperations, createDefaultState, createEntity, createOperation, createSnapshot,
  currentLocation, exportState, importState, itemsOf, knowsItem, locationPath, outfitOf, restoreSnapshot, rollbackMessage, validateState,
} from '../src/core/index.js';

const ran = createEntity('Ран');
const rindo = createEntity('Риндо');
const mikey = createEntity('Майки');

function cast() {
  return applyOperations(createDefaultState(), [ran, rindo, mikey].map(entity => createOperation('entity.upsert', entity)));
}

function fromMessage(index, type, payload) {
  return createOperation(type, payload, { messageId: String(index), messageIndex: index, transactionId: `message:${index}` });
}

function manual(type, payload) {
  return createOperation(type, payload, { transactionId: 'manual' });
}

const places = [
  manual('location.add', { item: { id: 'tokyo', name: 'Токио' } }),
  manual('location.add', { item: { id: 'roppongi', name: 'Роппонги', parentId: 'tokyo' } }),
  manual('location.add', { item: { id: 'bar', name: 'Бар «Хаос»', parentId: 'roppongi', traits: ['камин', 'скрипучая лестница', 'камин'] } }),
];

test('a new state carries an empty world in the state and in the baseline', () => {
  const state = createDefaultState();
  assert.deepEqual(state.world, { clock: { label: '', day: 0, time: '', part: '' }, locations: [], wardrobe: {}, items: [] });
  assert.deepEqual(state.baseline.world, state.world);
});

test('locations nest, keep unique traits and never loop', () => {
  let state = applyOperations(cast(), places);
  assert.deepEqual(locationPath(state, 'bar'), ['Токио', 'Роппонги', 'Бар «Хаос»']);
  assert.deepEqual(state.world.locations.find(location => location.id === 'bar').traits, ['камин', 'скрипучая лестница']);
  state = applyOperation(state, manual('location.update', { locationId: 'tokyo', changes: { parentId: 'bar' } }));
  assert.equal(state.world.locations.find(location => location.id === 'tokyo').parentId, undefined, 'Tokyo cannot sit inside its own bar');
});

test('the scene points at a location card; naming another place drops the card', () => {
  let state = applyOperations(cast(), [...places, fromMessage(10, 'scene.set', { presentIds: [ran.id], locationId: 'bar' })]);
  assert.equal(state.knowledge.scene.location, 'Бар «Хаос»');
  assert.equal(currentLocation(state).id, 'bar');
  state = applyOperation(state, fromMessage(11, 'scene.set', { presentIds: [ran.id], location: 'бар «хаос»' }));
  assert.equal(currentLocation(state)?.id, 'bar', 'same name, same card');
  state = applyOperation(state, fromMessage(12, 'scene.set', { presentIds: [ran.id], location: 'улица' }));
  assert.equal(currentLocation(state), null);
  assert.equal(state.knowledge.scene.location, 'улица');
});

test('removing a location unlinks its children and the scene', () => {
  let state = applyOperations(cast(), [...places, fromMessage(10, 'scene.set', { presentIds: [], locationId: 'roppongi' })]);
  state = applyOperation(state, manual('location.remove', { locationId: 'roppongi' }));
  assert.equal(state.world.locations.find(location => location.id === 'bar').parentId, undefined);
  assert.equal(state.knowledge.scene.locationId, undefined);
  assert.equal(validateState(state).valid, true);
});

test('the clock moves by absolute days or by a jump, and a flashback does not move it', () => {
  let state = applyOperation(cast(), fromMessage(1, 'clock.set', { label: 'Суббота, вечер', day: 3, part: 'evening' }));
  assert.deepEqual(state.world.clock, { label: 'Суббота, вечер', day: 3, time: '', part: 'evening' });
  state = applyOperation(state, fromMessage(2, 'clock.set', { label: 'Три дня спустя', advanceDays: 3, part: 'morning' }));
  assert.equal(state.world.clock.day, 6);
  state = applyOperation(state, fromMessage(3, 'clock.set', { label: 'Детство Рана', flashback: true }));
  assert.equal(state.world.clock.day, 6);
  assert.equal(state.world.clock.flashback, true);
  state = applyOperation(state, fromMessage(4, 'clock.set', { part: 'brunch' }));
  assert.equal(state.world.clock.part, '', 'unknown parts of the day are dropped');
});

test('an off-stage outfit is kept; coming back the same day means the same clothes', () => {
  const state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 1 }),
    fromMessage(1, 'scene.set', { presentIds: [ran.id, rindo.id] }),
    fromMessage(1, 'wardrobe.set', { entityId: rindo.id, outfit: 'белый костюм, очки' }),
    fromMessage(2, 'scene.set', { presentIds: [ran.id] }),
    fromMessage(3, 'scene.set', { presentIds: [ran.id, rindo.id] }),
  ]);
  assert.deepEqual(outfitOf(state, rindo.id), { outfit: 'белый костюм, очки', conditions: [], awayDays: 0 });
});

test('coming back days later allows a change until the new outfit is known', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 1 }),
    fromMessage(1, 'scene.set', { presentIds: [ran.id, rindo.id] }),
    fromMessage(1, 'wardrobe.set', { entityId: rindo.id, outfit: 'белый костюм' }),
    fromMessage(2, 'scene.set', { presentIds: [ran.id] }),
    fromMessage(3, 'clock.set', { advanceDays: 2 }),
    fromMessage(4, 'scene.set', { presentIds: [ran.id, rindo.id] }),
  ]);
  assert.equal(outfitOf(state, rindo.id).awayDays, 2);
  assert.equal(outfitOf(state, ran.id), null, 'Ran was there all along and nothing is known of his clothes');
  state = applyOperation(state, fromMessage(4, 'wardrobe.set', { entityId: rindo.id, outfit: 'чёрная куртка' }));
  assert.equal(outfitOf(state, rindo.id).awayDays, 0);
  state = rollbackMessage(state, '4');
  assert.equal(outfitOf(state, rindo.id).awayDays, 0, 'swiping the return takes the absence back too');
  assert.deepEqual(state.knowledge.scene.presentIds, [ran.id]);
  assert.equal(outfitOf(state, rindo.id).outfit, 'белый костюм');
});

test('conditions expire by story days; unknown day keeps them', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 5 }),
    fromMessage(1, 'condition.add', { entityId: ran.id, item: { id: 'wet', text: 'промок под дождём', days: 1 } }),
    fromMessage(1, 'condition.add', { entityId: ran.id, item: { id: 'bruise', text: 'синяк на скуле', days: 5 } }),
    fromMessage(1, 'condition.add', { entityId: ran.id, item: { id: 'dup', text: 'Промок под дождём' } }),
  ]);
  assert.deepEqual(activeConditions(state, ran.id).map(condition => condition.id), ['wet', 'bruise']);
  state = applyOperation(state, fromMessage(2, 'clock.set', { advanceDays: 1 }));
  assert.deepEqual(activeConditions(state, ran.id).map(condition => condition.id), ['bruise']);
  state = applyOperation(state, fromMessage(3, 'condition.remove', { entityId: ran.id, conditionId: 'bruise' }));
  assert.deepEqual(activeConditions(state, ran.id), []);
});

test('items have owners, places, importance and secrecy', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'item.add', { item: { id: 'gun', name: 'пистолет', ownerId: ran.id, place: 'во внутреннем кармане', importance: 'key', secret: true } }),
    fromMessage(1, 'item.add', { item: { id: 'lighter', name: 'зажигалка', ownerId: ran.id, importance: 'whatever' } }),
  ]);
  assert.deepEqual(itemsOf(state, ran.id).map(item => item.id), ['gun', 'lighter']);
  const gun = state.world.items[0];
  assert.equal(state.world.items[1].importance, 'normal');
  assert.equal(knowsItem(gun, ran.id), true);
  assert.equal(knowsItem(gun, mikey.id), false);
  state = applyOperation(state, fromMessage(2, 'item.update', { itemId: 'gun', changes: { ownerId: rindo.id, knownByIds: [ran.id, 'ghost'] } }));
  assert.equal(state.world.items[0].ownerId, rindo.id);
  assert.deepEqual(state.world.items[0].knownByIds, [ran.id]);
  assert.equal(knowsItem(state.world.items[0], ran.id), true, 'the old owner still knows');
  state = rollbackMessage(state, '1');
  assert.deepEqual(state.world.items, [], 'the later handover of a gone item is a no-op');
});

test('a removed character leaves the wardrobe and their things lose an owner', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'wardrobe.set', { entityId: rindo.id, outfit: 'костюм' }),
    fromMessage(1, 'item.add', { item: { id: 'gun', name: 'пистолет', ownerId: rindo.id, secret: true, knownByIds: [rindo.id] } }),
  ]);
  state = applyOperation(state, manual('entity.remove', { entityId: rindo.id }));
  assert.equal(state.world.wardrobe[rindo.id], undefined);
  assert.equal(state.world.items[0].ownerId, undefined);
  assert.equal(state.world.items[0].knownByIds, undefined);
  assert.equal(validateState(state).valid, true);
});

test('locks are stored on places, outfits and items', () => {
  const state = applyOperations(cast(), [
    ...places,
    manual('location.update', { locationId: 'bar', changes: { locked: true } }),
    manual('wardrobe.set', { entityId: ran.id, outfit: 'кимоно', locked: true }),
    manual('item.add', { item: { id: 'ring', name: 'кольцо', locked: true } }),
  ]);
  assert.equal(state.world.locations.find(location => location.id === 'bar').locked, true);
  assert.equal(state.world.wardrobe[ran.id].locked, true);
  assert.equal(state.world.items[0].locked, true);
});

test('export, import, snapshots and validation carry the world', () => {
  const state = applyOperations(cast(), [
    ...places,
    fromMessage(1, 'clock.set', { day: 2, label: 'Утро' }),
    fromMessage(1, 'scene.set', { presentIds: [ran.id], locationId: 'bar' }),
    fromMessage(1, 'wardrobe.set', { entityId: ran.id, outfit: 'кимоно' }),
    fromMessage(1, 'item.add', { item: { id: 'gun', name: 'пистолет', ownerId: ran.id } }),
  ]);
  const back = importState(exportState(state));
  assert.deepEqual(back.world, state.world);
  const { state: withSnapshot, snapshot } = createSnapshot(state);
  assert.deepEqual(restoreSnapshot(withSnapshot, snapshot.id).world, state.world);
  const broken = structuredClone(state);
  broken.world.items[0].ownerId = 'ghost';
  assert.match(validateState(broken).errors.join(';'), /unknown owner/);
});

test('a state saved before the scene module imports with an empty world', () => {
  const old = cast();
  delete old.world;
  delete old.baseline.world;
  const imported = importState(JSON.stringify(old));
  assert.deepEqual(imported.world.items, []);
  assert.deepEqual(imported.baseline.world.locations, []);
});

test('time is kept in 24 h, sets the part of the day and rolls over midnight', () => {
  let state = applyOperation(cast(), fromMessage(1, 'clock.set', { day: 2, time: '7:05' }));
  assert.equal(state.world.clock.time, '07:05');
  assert.equal(state.world.clock.part, 'morning');
  state = applyOperation(state, fromMessage(2, 'clock.set', { time: '22:40' }));
  assert.equal(state.world.clock.part, 'evening');
  state = applyOperation(state, fromMessage(3, 'clock.set', { advanceMinutes: 150 }));
  assert.deepEqual([state.world.clock.day, state.world.clock.time, state.world.clock.part], [3, '01:10', 'night']);
  state = applyOperation(state, fromMessage(4, 'clock.set', { time: '25:00' }));
  assert.equal(state.world.clock.time, '', 'impossible time = unknown');
  state = applyOperation(state, fromMessage(5, 'clock.set', { advanceMinutes: 3 * 24 * 60 + 30 }));
  assert.equal(state.world.clock.day, 6, 'without a known time only whole days count');
  state = applyOperation(state, fromMessage(6, 'clock.set', { time: '12.30', part: 'evening' }));
  assert.equal(state.world.clock.part, 'evening', 'an explicit part wins');
  assert.equal(validateState(state).valid, true);
});

test('a condition can be corrected by hand', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 1 }),
    fromMessage(1, 'condition.add', { entityId: ran.id, item: { id: 'cut', text: 'порез на ладони', days: 2 } }),
  ]);
  state = applyOperation(state, manual('condition.update', { entityId: ran.id, conditionId: 'cut', changes: { text: 'порез на левой ладони', days: null } }));
  assert.deepEqual(state.world.wardrobe[ran.id].conditions, [{ id: 'cut', text: 'порез на левой ладони', sinceDay: 1 }]);
  assert.throws(() => applyOperation(state, manual('condition.update', { entityId: ran.id, conditionId: 'cut', changes: { text: '  ' } })), /needs text/);
});

test('a time jump with a character on stage also lets them change clothes', () => {
  let state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 1, time: '20:00' }),
    fromMessage(1, 'scene.set', { presentIds: [ran.id] }),
    fromMessage(1, 'wardrobe.set', { entityId: ran.id, outfit: 'пиджак' }),
    fromMessage(2, 'clock.set', { advanceMinutes: 90 }),
  ]);
  assert.equal(outfitOf(state, ran.id).awayDays, 0, 'the same evening: same clothes');
  state = applyOperation(state, fromMessage(3, 'clock.set', { advanceDays: 3 }));
  assert.equal(outfitOf(state, ran.id).awayDays, 3);
});

test('an outfit written while the character is off stage dates from that day', () => {
  const state = applyOperations(cast(), [
    fromMessage(1, 'clock.set', { day: 4 }),
    fromMessage(1, 'wardrobe.set', { entityId: rindo.id, outfit: 'белый костюм' }),
    fromMessage(2, 'clock.set', { advanceDays: 2 }),
    fromMessage(2, 'scene.set', { presentIds: [rindo.id] }),
  ]);
  assert.equal(outfitOf(state, rindo.id).awayDays, 2);
});
