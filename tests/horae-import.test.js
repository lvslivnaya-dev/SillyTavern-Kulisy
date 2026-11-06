/** Moving a chat from Horae: reading its records, the preview, the import, and a second import. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHRONICLE_MARKER, applyOperations, createDefaultState, createEntity, createOperation, currentLocation, emptyChronicle } from '../src/core/index.js';
import { createHoraeCallbacks, horaeDateValue, horaeSummary, readHorae } from '../src/integration/horae-import.js';
import { createLocationLibraryStore } from '../src/integration/location-library-actions.js';

const mikey = createEntity('Майки', { aliases: ['Манджиро'] });

function horaeChat() {
  return [
    { mes: 'Начало', horae_meta: {
      autoSummaries: [
        { id: 'cs1', range: [1, 4], summaryText: 'Судзу встретила Майки у храма, он отдал ей нож.', active: true },
        { id: 'cs0', range: [0, 0], summaryText: 'Старая, выключенная сводка.', active: false },
      ],
      locationMemory: { 'Токио·Храм Мусаси': { desc: 'Старый храм на холме.' }, 'Удалённое': { desc: 'x', _deleted: true } },
    } },
    { mes: 'a', horae_meta: { timestamp: { story_date: '10/1', story_time: '19:30' }, scene: { location: 'Токио·Храм Мусаси', characters_present: ['Майки', 'Хина'] },
      costumes: { 'Манджиро': 'чёрный токкофуку' }, items: { 'Нож': { holder: 'Майки', location: 'в кармане', importance: '!!' }, 'Яблоко': { holder: 'Хина' } } } },
    { mes: 'b', is_user: true },
    { mes: 'c', horae_meta: { costumes: { 'Хина': 'школьная форма' }, items: { 'Еда': { holder: 'consumed' } }, deletedItems: ['Яблоко'] } },
    { mes: 'd', horae_meta: { timestamp: { story_date: '10/3', story_time: '23:10' }, items: { 'Письмо': { holder: 'Хина', description: 'Без подписи.' } } } },
    { mes: 'e', horae_meta: { _skipHorae: true, scene: { location: 'нигде' } } },
  ];
}

test('Horae records are rebuilt like Horae does it: later wins, gone things are gone, dates become story days', () => {
  assert.equal(horaeDateValue('10/3') - horaeDateValue('10/1'), 2);
  assert.equal(horaeDateValue('2024年10月1日'), horaeDateValue('2024/10/1'));
  assert.equal(horaeDateValue('1.10.2024'), horaeDateValue('2024-10-01'));
  const horae = readHorae(horaeChat());
  assert.deepEqual([horae.date, horae.time, horae.day, horae.location], ['10/3', '23:10', 3, 'Токио·Храм Мусаси'], 'a skipped message is ignored');
  assert.deepEqual(horae.items.map(item => item.name).sort(), ['Нож', 'Письмо']);
  assert.equal(horae.items.find(item => item.name === 'Нож').importance, 'key');
  assert.deepEqual(horae.places.map(place => [place.name, place.parentName]), [['Токио·Храм Мусаси', 'Токио']]);
  assert.deepEqual(horae.summaries.map(summary => [summary.from, summary.to]), [[1, 4]], 'inactive summaries stay behind');
  assert.equal(readHorae([{ mes: 'x' }]).found, false);
});

test('the preview names who is missing in Kulisy', () => {
  const state = applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey)]);
  const summary = horaeSummary(state, readHorae(horaeChat()));
  assert.deepEqual(summary.unknown, ['Хина'], 'Манджиро is Майки by his alias');
  assert.equal(summary.summaries, 1);
});

test('import: clock, scene with its library place, clothes, things, new characters, the chronicle — and twice changes nothing new', async () => {
  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey)]);
  const chat = horaeChat();
  let chronicle = emptyChronicle();
  const settings = {};
  const library = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  let saved = 0;
  const callbacks = createHoraeCallbacks({
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    chat: () => chat, saveChat: async () => { saved += 1; },
    chronicle: () => chronicle, saveChronicle: async next => { chronicle = next; },
    library, createEntity: name => createEntity(name),
  });
  const all = { chronicle: true, scene: true, outfits: true, items: true, places: true, createCharacters: true };
  const result = await callbacks.onHoraeImport(all);
  assert.deepEqual(result.created, ['Хина']);
  const hina = Object.values(state.entities).find(entity => entity.name === 'Хина');
  assert.deepEqual([state.world.clock.day, state.world.clock.time, state.world.clock.label], [3, '23:10', '10/3']);
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'чёрный токкофуку');
  assert.equal(state.world.wardrobe[hina.id].outfit, 'школьная форма');
  const knife = state.world.items.find(item => item.name === 'Нож');
  assert.deepEqual([knife.ownerId, knife.place, knife.importance], [mikey.id, 'в кармане', 'key']);
  assert.equal(state.world.items.find(item => item.name === 'Письмо').note, 'Без подписи.');
  assert.deepEqual(state.knowledge.scene.presentIds.sort(), [mikey.id, hina.id].sort());
  assert.equal(currentLocation(state)?.libraryId, library.get().locations[0].id, 'the scene stands on the linked library place');
  assert.equal(library.get().folders[0].name, 'Из Хорае');
  assert.match(library.get().locations[0].description, /Старый храм/);
  assert.equal(chronicle.summaries.length, 1);
  assert.ok([1, 2, 3, 4].every(index => chat[index].extra[CHRONICLE_MARKER] === chronicle.summaries[0].id), 'its messages, the user ones too, are marked');
  assert.equal(chat[5].extra?.[CHRONICLE_MARKER], undefined, 'outside its range: not marked');
  assert.equal(saved, 1);
  assert.ok(state.operations.every(operation => !operation.messageId), 'a swipe never undoes the import');

  const again = await callbacks.onHoraeImport(all);
  assert.equal(again.scenes, 0);
  assert.equal(again.skippedScenes, 1);
  assert.equal(state.world.items.length, 2, 'things are not doubled');
  assert.equal(again.places, 0);
  assert.deepEqual(again.created, []);
});

/** A chat like most Horae chats: no summaries, only the timeline, and old messages hidden by Horae. */
function timelineChat(length = 40) {
  const chat = [{ mes: 'Начало', horae_meta: {} }];
  for (let index = 1; index < length; index += 1) {
    const meta = index % 2 ? {
      timestamp: { story_date: index < 20 ? '1524/05/14' : '1524/5/15 (四)', story_time: '' },
      scene: { location: 'Санни', characters_present: index < 10 ? ['Майки'] : ['Майки', 'Хина'] },
      events: [{ level: index === 5 ? '关键' : '重要', summary: `Событие ${index}.` }],
    } : {};
    if (index < 17) meta._autoBufferHidden = true;
    chat.push({ mes: `m${index}`, is_user: !(index % 2), is_system: index < 17, horae_meta: meta });
  }
  return chat;
}

test('the timeline becomes chronicle scenes (newest messages left alone), feed events with witnesses, and hidden messages come back', async () => {
  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey)]);
  const chat = timelineChat();
  let chronicle = emptyChronicle();
  const shown = [];
  const callbacks = createHoraeCallbacks({
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    chat: () => chat, saveChat: async () => {},
    chronicle: () => chronicle, saveChronicle: async next => { chronicle = next; },
    chronicleConfig: () => ({ sceneEvery: 10, keepRecent: 20 }),
    library: createLocationLibraryStore({ settings: () => ({}), save: () => {} }),
    createEntity: name => createEntity(name),
    markShown: index => shown.push(index),
  });
  const scan = callbacks.onHoraeScan();
  assert.deepEqual([scan.events, scan.hidden, scan.summaries], [20, 16, 0]);
  const result = await callbacks.onHoraeImport({ chronicle: true, events: true, unhide: true, createCharacters: true });
  assert.equal(result.scenes, 2, 'messages 0–19 in two scenes of ten; the last 20 stay');
  assert.match(chronicle.summaries[0].text, /^\[1524\/05\/14\] Событие 1\. Событие 3\./);
  assert.ok(chat.slice(0, 20).every(message => message.extra?.[CHRONICLE_MARKER]), 'hidden messages count as story');
  assert.ok(chat.slice(20).every(message => !message.extra?.[CHRONICLE_MARKER]));
  assert.equal(result.unhidden, 16);
  assert.ok(chat.every(message => !message.is_system));
  assert.equal(shown.length, 16);
  const events = state.knowledge.events;
  assert.equal(events.length, 20);
  const hina = Object.values(state.entities).find(entity => entity.name === 'Хина');
  assert.deepEqual(events[0].witnessIds, [mikey.id], 'Хина was not there yet');
  assert.ok(events.at(-1).witnessIds.includes(hina.id));
  assert.equal(events[0].location, 'Санни');
  const again = await callbacks.onHoraeImport({ chronicle: true, events: true, unhide: true });
  assert.deepEqual([again.scenes, state.knowledge.events.length], [0, 20], 'nothing doubled');
});
