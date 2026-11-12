/** The wardrobe: cards and looks, wearing them in a chat, the chronicler, the scene block, describing pictures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCard, addLook, applyOperations, cardsOf, composeOutfit, createDefaultState, createEntity, createOperation, emptyWardrobe,
  normalizeWardrobe, removeCard, rollbackMessage, updateCard,
} from '../src/core/index.js';
import { createWardrobeCallbacks, createWardrobeStore } from '../src/integration/wardrobe-actions.js';
import { askAboutImage, parseDescription, visionSettings } from '../src/integration/vision.js';
import { buildWorldBlock, parseWorld } from '../src/integration/world-analysis.js';
import { applyAnalysisResult } from '../src/integration/analysis-operations.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';

const mikey = createEntity('Майки');
const IMAGE = '/user/images/kulisy-wardrobe/wear_1.png';

/** Тосва: куртка, штаны, повязка — и образ из них. */
function closet() {
  let wardrobe = emptyWardrobe();
  const add = fields => { const result = addCard(wardrobe, fields); wardrobe = result.wardrobe; return result.card; };
  const jacket = add({ shelf: 'characters', gender: 'male', category: 'outerwear', name: 'Токкофуку Тосвы', description: 'Чёрный длинный китель с вышивкой.', image: IMAGE });
  const pants = add({ shelf: 'characters', gender: 'male', category: 'pants', name: 'Широкие штаны' });
  const band = add({ shelf: 'characters', gender: 'male', category: 'accessories', name: 'Повязка на руку' });
  const { wardrobe: withLook, look } = addLook(wardrobe, { shelf: 'characters', name: 'Форма Тосвы', cardIds: [jacket.id, pants.id, band.id] });
  return { wardrobe: withLook, jacket, pants, band, look };
}

function chat() {
  return applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey), createOperation('scene.set', { presentIds: [mikey.id] })]);
}

test('cards: a picture, a name or a description is enough; sections keep their order; a removed card leaves the looks', () => {
  assert.throws(() => addCard(emptyWardrobe(), { category: 'top' }), /картинка, название или описание/);
  const { wardrobe, jacket, pants, look } = closet();
  assert.deepEqual(cardsOf(wardrobe, { shelf: 'characters' }).map(card => card.category), ['pants', 'outerwear', 'accessories']);
  assert.equal(composeOutfit(wardrobe, look.cardIds), 'Широкие штаны; Токкофуку Тосвы; Повязка на руку', 'cards add up, never replace');
  assert.equal(updateCard(wardrobe, pants.id, { image: 'https://evil.example/x.png' }).cards.find(card => card.id === pants.id).image, undefined, 'only pictures of this server');
  const removed = removeCard(wardrobe, jacket.id);
  assert.equal(removed.image, IMAGE);
  assert.equal(removed.wardrobe.looks[0].cardIds.includes(jacket.id), false);
  const repaired = normalizeWardrobe({ cards: [{ id: 'x', category: 'nonsense', gender: '?', name: 'Серьги' }, { id: 'y' }], looks: [{ id: 'l', name: 'Пусто', cardIds: ['ghost'] }] });
  assert.deepEqual([repaired.cards.length, repaired.cards[0].category, repaired.cards[0].gender], [1, 'top', 'female']);
  assert.deepEqual(repaired.looks[0].cardIds, []);
});

test('in a chat: cards worn are kept with the outfit; an outfit told in words takes them off; a swipe undoes it', () => {
  const { wardrobe, jacket, look } = closet();
  let state = applyOperations(chat(), [createOperation('wardrobe.set', { entityId: mikey.id, outfit: composeOutfit(wardrobe, look.cardIds), cardIds: look.cardIds })]);
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, look.cardIds);
  state = applyOperations(state, [createOperation('wardrobe.set', { entityId: mikey.id, locked: true })]);
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, look.cardIds, 'locking keeps the cards');
  state = applyOperations(state, [createOperation('wardrobe.set', { entityId: mikey.id, outfit: 'пижама' }, { messageId: '7', messageIndex: 7 })]);
  assert.equal(state.world.wardrobe[mikey.id].cardIds, undefined);
  state = rollbackMessage(state, '7');
  assert.ok(state.world.wardrobe[mikey.id].cardIds.includes(jacket.id));
});

test('the chronicler sees the cards and the looks; «надел форму» puts the whole look on; a jacket taken off leaves the rest', () => {
  const { wardrobe, jacket, pants, band, look } = closet();
  let state = chat();
  const block = buildWorldBlock(applyOperations(state, [createOperation('wardrobe.set', { entityId: mikey.id, outfit: 'x', cardIds: [jacket.id] })]), 'Майки', null, wardrobe);
  assert.match(block, new RegExp(`wardrobe cards on: ${jacket.id}: Токкофуку Тосвы`));
  assert.match(block, new RegExp(`Saved looks \\(ID: name\\): ${look.id}: Форма Тосвы`));
  const put = { operations: [], world: parseWorld({ outfits: [{ entityId: mikey.id, lookId: look.id }] }), knowledge: null };
  state = applyAnalysisResult(state, put, { messageId: '5', messageIndex: 5, transactionId: 'message:5' }, [], { trackWorld: true, wardrobe }).state;
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, look.cardIds);
  assert.match(state.world.wardrobe[mikey.id].outfit, /Токкофуку/);
  const off = { operations: [], world: parseWorld({ outfits: [{ entityId: mikey.id, outfit: 'широкие штаны и повязка, без кителя', cardIds: [pants.id, band.id, 'ghost'] }] }), knowledge: null };
  state = applyAnalysisResult(state, off, { messageId: '6', messageIndex: 6, transactionId: 'message:6' }, [], { trackWorld: true, wardrobe }).state;
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, [pants.id, band.id], 'unknown IDs dropped');
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'широкие штаны и повязка, без кителя');
});

test('the scene block gets what the worn cards look like, below the outfit itself', () => {
  const { wardrobe, look } = closet();
  const state = applyOperations(chat(), [createOperation('wardrobe.set', { entityId: mikey.id, outfit: composeOutfit(wardrobe, look.cardIds), cardIds: look.cardIds })]);
  assert.match(buildScenePrompt(state, { wardrobe }), /looks\[Майки\]: Токкофуку Тосвы — Чёрный длинный китель/);
  assert.doesNotMatch(buildScenePrompt(state, {}), /looks\[/);
});

test('callbacks: a picture is stored, described into the empty fields, a card is put on and taken off', async () => {
  const settings = {};
  const store = createWardrobeStore({ settings: () => settings, save: () => {} });
  let state = chat();
  const removed = [];
  const callbacks = createWardrobeCallbacks({
    store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    confirm: async () => true,
    upload: async (dataUrl, name) => `/user/images/kulisy-wardrobe/${name}.png`,
    removeImage: async path => { removed.push(path); },
    imageForModel: async () => 'data:image/png;base64,AAAA',
    ask: async () => '```json\n{"name":"Красная толстовка","category":"top","gender":"female","description":"Свободная красная толстовка с капюшоном."}\n```',
  });
  const card = await callbacks.onWardrobeAddCard({ shelf: 'persona', gender: 'male', category: 'outerwear', imageDataUrl: 'data:image/png;base64,AAAA', describe: true, adoptSection: true });
  assert.deepEqual([card.name, card.category, card.gender], ['Красная толстовка', 'top', 'female'], 'the model picked the section of a picture-only card');
  assert.equal(settings.wardrobe.cards.length, 1, 'kept in extension settings');
  await callbacks.onWardrobeUpdateCard({ cardId: card.id, changes: { name: 'Худи', image: 'ignored' } });
  assert.equal(store.get().cards[0].image, card.image, 'a picture changes only through its own action');
  const kept = await callbacks.onWardrobeDescribe({ cardId: card.id, overwrite: false });
  assert.equal(kept.name, 'Худи', 'a name written by hand stays');
  const second = await callbacks.onWardrobeAddCard({ shelf: 'persona', category: 'shoes', name: 'Кеды' });
  await callbacks.onWear({ entityId: mikey.id, cardIds: [card.id] });
  await callbacks.onWear({ entityId: mikey.id, cardIds: [second.id], mode: 'add' });
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, [card.id, second.id]);
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'Худи; Кеды');
  await callbacks.onTakeOff({ entityId: mikey.id, cardId: card.id });
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'Кеды');
  await callbacks.onWardrobeSetImage({ cardId: second.id, imageDataUrl: 'data:image/png;base64,BBBB' });
  assert.equal(await callbacks.onWardrobeRemoveCard({ cardId: second.id }), true);
  assert.deepEqual(state.world.wardrobe[mikey.id].cardIds, undefined, 'taken off whoever wore it');
  assert.equal(state.world.wardrobe[mikey.id].outfit, 'Кеды', 'the words stay');
  assert.equal(removed.length, 1, 'its picture deleted from the server');
  await assert.rejects(() => callbacks.onWear({ entityId: 'ghost', cardIds: [card.id] }), /не найден/);
});

test('describing: «как у таверны» sends the picture to the chat model; a text-completion API is refused; a plain answer is kept', async () => {
  const sent = [];
  const context = {
    mainApi: 'openai',
    chatCompletionSettings: { chat_completion_source: 'claude' },
    getChatCompletionModel: () => 'claude-x',
    ChatCompletionService: { processRequest: async data => { sent.push(data); return { content: 'red' }; } },
  };
  assert.equal(await askAboutImage(context, { mode: 'main' }, 'data:image/png;base64,AAAA', 'colour?'), 'red');
  assert.equal(sent[0].model, 'claude-x');
  assert.equal(sent[0].messages[0].content[1].type, 'image_url');
  await assert.rejects(() => askAboutImage({ ...context, mainApi: 'textgenerationwebui' }, { mode: 'main' }, 'data:image/png;base64,AAAA'), /только с Chat Completion/);
  await assert.rejects(() => askAboutImage(context, { mode: 'profile' }, 'data:image/png;base64,AAAA'), /профиль|профилей/i);
  await assert.rejects(() => askAboutImage(context, { mode: 'main' }, 'not a picture'), /картинка/);
  assert.equal(visionSettings({ mode: 'weird', maxTokens: 1 }).mode, 'main');
  assert.equal(parseDescription('Просто чёрная кожанка.').description, 'Просто чёрная кожанка.');
  assert.equal(parseDescription('{"category":"nope","description":"x"}').category, '');
});

test('a hairstyle card is described without the hair colour; other sections keep colours', async () => {
  const { describePrompt } = await import('../src/integration/vision.js');
  const hair = describePrompt('hair');
  assert.match(hair, /NEVER name the colour of the hair itself/);
  assert.match(hair, /never the hair colour/);
  assert.doesNotMatch(hair, /what it is, colour, material/);
  const top = describePrompt('top');
  assert.match(top, /what it is, colour, material/);
  assert.doesNotMatch(top, /hair colour/);
});

test('a thinking model: the reasoning is dropped, the last JSON answer is taken', () => {
  const reasoning = '**My Approach**\n\nOkay, the JSON structure is: `{"name":"...", "gender":"...", "description":"..."}`\n\nNow the answer:\n';
  const answer = parseDescription(`${reasoning}\`\`\`json\n{\n "name": "Худи",\n "gender": "unisex",\n "description": "Бордовое худи."\n}\n\`\`\``);
  assert.deepEqual([answer.name, answer.gender, answer.description], ['Худи', 'unisex', 'Бордовое худи.']);
  const think = parseDescription('<think>let me look {at it}</think>{"name":"Кеды","description":"Белые кеды."}');
  assert.equal(think.description, 'Белые кеды.');
  // A proxy that broke lines inside keys and values.
  const broken = parseDescription('{"name\n":"Костюм","gender":"female","description\n":"Бежевый костюм с\n принтом."}');
  assert.deepEqual([broken.name, broken.description], ['Костюм', 'Бежевый костюм с  принтом.']);
  // Reasoning cut by the token limit: an error, never the reasoning as a description.
  assert.throws(() => parseDescription('**Thinking**\nThe JSON is `{"name":"..."` and then {"name":"Ху'), /размышления/);
});

test('the JSON template quoted in the reasoning ("...") is not taken as the answer', () => {
  assert.throws(() => parseDescription('The JSON: `{"name":"...", "gender":"...", "description":"..."}`. Now: {"name":"Ху'), /размышления/);
});

test('a closet tied to a character: the chronicler sees what they own and may put those pieces on; nothing outside the closet is put on', () => {
  const { wardrobe, jacket, pants, band, look } = closet();
  const tied = { ...wardrobe, closets: { [mikey.id]: { cardIds: [pants.id, band.id], lookIds: [look.id] } } };
  const state = chat();
  const block = buildWorldBlock(state, 'Майки', null, tied);
  assert.ok(block.includes(`: looks [${look.id}: Форма Тосвы] | pieces [${pants.id}: Широкие штаны; ${band.id}: Повязка на руку]`));
  assert.match(block, /Closets \(what each/);
  assert.equal(block.includes(`pieces [${jacket.id}`) || block.split('pieces [')[1].includes(jacket.id), false, 'a piece that is not tied is not in the closet');
  assert.doesNotMatch(buildWorldBlock(state, 'Майки', null, wardrobe), /Closets/, 'no closet: no block');

  // Pieces from the closet are put on, with no words about the outfit at all.
  const dress = (ids, withCloset) => applyAnalysisResult(state, { operations: [], world: parseWorld({ outfits: [{ entityId: mikey.id, cardIds: ids }] }), knowledge: null },
    { messageId: '5', messageIndex: 5, transactionId: 'message:5' }, [], { trackWorld: true, wardrobe: withCloset ? tied : wardrobe }).state;
  const worn = dress([pants.id, band.id, jacket.id], true).world.wardrobe[mikey.id];
  assert.deepEqual(worn.cardIds, [pants.id, band.id], 'the jacket is not in the closet and was not worn');
  assert.match(worn.outfit, /Широкие штаны/);
  assert.equal(dress([pants.id], false).world.wardrobe?.[mikey.id]?.cardIds, undefined, 'without a closet the same answer changes nothing');
});

test('a library card keeps its closet (wardrobe cards and looks), cleaned and without repeats; an empty closet is no closet', async () => {
  const { addFolder, addLibraryCharacter, emptyLibrary, updateLibraryCharacter } = await import('../src/core/index.js');
  const tr = addFolder(emptyLibrary(), { name: 'МБ' });
  const added = addLibraryCharacter(tr.library, { folderId: tr.folder.id, name: 'Майки', closet: { cardIds: ['a', 'b', 'a', ''], lookIds: ['l1'] } });
  assert.deepEqual(added.character.closet, { cardIds: ['a', 'b'], lookIds: ['l1'] });
  const emptied = updateLibraryCharacter(added.library, added.character.id, { closet: { cardIds: [], lookIds: [] } });
  assert.equal(emptied.characters[0].closet, undefined);
});

test('the weather reaches the chronicler and the narrator, so nobody goes out in a T-shirt in frost', async () => {
  const { WORLD_INSTRUCTIONS } = await import('../src/integration/world-analysis.js');
  const { buildScenePrompt } = await import('../src/integration/world-prompt.js');
  const { wardrobe } = closet();
  const state = chat();
  const cold = buildWorldBlock(state, 'Майки', null, wardrobe, null, { kind: 'snow', temp: -10, text: 'метёт' });
  assert.ok(cold.includes('Outdoor weather: snow, about -10°C — метёт.'));
  assert.equal(buildWorldBlock(state, 'Майки', null, wardrobe, null, null).includes('Outdoor weather'), false, 'no weather known: no line');
  assert.match(WORLD_INSTRUCTIONS, /weather and clothes:[^\n]*never a T-shirt in the cold/);
  assert.match(WORLD_INSTRUCTIONS, /never correct them for the weather|never correct[^\n]*weather/);
  const scene = buildScenePrompt(state, { weather: { kind: 'snow', temp: -10, text: '' } });
  assert.match(scene, /Dress for it:[^\n]*frost/);
});

test('a personal piece («только у него»): only its owner has it in their closet, for the chronicler too; a set that holds it is hidden from the others', async () => {
  const { addFolder, addLibraryCharacter, emptyLibrary, personalPieces, updateLibraryCharacter } = await import('../src/core/index.js');
  const { closetsByEntity, linkCards } = await import('../src/integration/card-links.js');
  const { wardrobe, jacket, pants, band, look } = closet();
  const tr = addFolder(emptyLibrary(), { name: 'МБ' });
  let library = tr.library;
  const make = (name, closetFields) => { const made = addLibraryCharacter(library, { folderId: tr.folder.id, name, closet: closetFields }); library = made.library; return made.character; };
  const mikeyCard = make('Майки', { cardIds: [jacket.id, pants.id], lookIds: [look.id], ownIds: [jacket.id, 'not-in-closet'] });
  const ranCard = make('Ран', { cardIds: [jacket.id, band.id], lookIds: [look.id] });
  assert.deepEqual(library.characters[0].closet.ownIds, [jacket.id], 'personal ones are a subset of the closet');
  assert.equal(personalPieces(library).get(jacket.id), mikeyCard.id);

  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', mikey), createOperation('entity.upsert', { id: 'ran', name: 'Ран' })]);
  state = linkCards(state, library, [mikeyCard.id, ranCard.id]).state;
  const closets = closetsByEntity(state, library, wardrobe, personalPieces);
  assert.deepEqual(closets[mikey.id].cardIds, [jacket.id, pants.id], 'the owner keeps it');
  assert.deepEqual(closets[mikey.id].lookIds, [look.id]);
  assert.deepEqual(closets.ran.cardIds, [band.id], 'the other one does not see it');
  assert.deepEqual(closets.ran.lookIds, [], 'nor the set that holds it');

  // Two cards claiming one piece: the first one in the library keeps it.
  const both = updateLibraryCharacter(library, ranCard.id, { closet: { cardIds: [jacket.id, band.id], lookIds: [], ownIds: [jacket.id] } });
  assert.equal(personalPieces(both).get(jacket.id), mikeyCard.id);
  // The chronicler is shown the closets without the foreign piece.
  const block = buildWorldBlock(applyOperations(state, [createOperation('scene.set', { presentIds: [mikey.id, 'ran'] })]), 'Майки и Ран', null, { ...wardrobe, closets });
  const ranLine = block.split('\n').find(line => line.startsWith('- Ран') && line.includes('pieces ['));
  assert.ok(ranLine && !ranLine.includes(jacket.id) && ranLine.includes(band.id));
});
