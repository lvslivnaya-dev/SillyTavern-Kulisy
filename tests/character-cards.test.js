/** Character cards of the library: the library side, the chat side, the narrator's sheets, the imports, the page. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  CARD_SECTION_KINDS, addCharacterDrafts, checkCardSources, refreshLibraryCharacter, addFolder, addLibraryCharacter, applyOperations, cardPlainText, createDefaultState, createOperation, duplicateLibraryCharacter,
  emptyLibrary, exportLibrary, folderContents, importLibrary, importState, normalizeLibrary, removeFolder, removeLibraryCharacter, searchLibraryCharacters, templateSections, updateLibraryCharacter,
} from '../src/core/index.js';
import { GATE_SECTIONS, splitGateTitle } from '../src/integration/lore-gate.js';
import { cardLinks, cardsByEntity, entityForCard, linkCards, syncCardLinks, unlinkCards } from '../src/integration/card-links.js';
import { cardDigest, cardedSheetTest, digestFor, planCards, planSheetDrops } from '../src/integration/card-prompt.js';
import { matchLoreEntries } from '../src/integration/lorebooks.js';
import { draftFromQuestionnaire, draftsFromLorebookCharacters, listLorebookCharacters } from '../src/integration/character-import.js';
import { createLibraryCallbacks, createLocationLibraryStore, syncChatCards } from '../src/integration/location-library-actions.js';
import { BLOCK_ORDER, describeBlocks, readable } from '../src/integration/prompt-overview.js';

const rx = word => `/(?<![\\p{L}\\p{M}\\p{N}_-])${word}(?![\\p{L}\\p{M}\\p{N}_-])/iu`;

/** The chat: the persona Иоко, Майки and Санзу (aliases like a real chat), the scene as given. */
function chat(present = ['mikey']) {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'me', name: 'Иоко' }),
    createOperation('entity.upsert', { id: 'mikey', name: 'Майки', aliases: ['Сано Манджиро'] }),
    createOperation('entity.upsert', { id: 'sanzu', name: 'Санзу', aliases: ['Харучиё'] }),
    createOperation('scene.set', { presentIds: present }),
  ]);
  state.ui = { ...state.ui, personaId: 'me' };
  return state;
}

const TEXT = {
  basic: 'Лидер Бонтена. Невысокий, но все его слушают.',
  voice: 'Говорит лениво, тихо, растягивая слова.',
  visual: 'Светлые волосы, тёмные глаза, серьга Тосвы.',
  skills: 'Лучший боец района: удар ногой с разворота.',
  relationships: 'Санзу — его преданный пёс. Какучо держит порядок.',
  nsfw: 'Любит, когда его трогают за шею.',
  publicInfo: 'Известен как Бессмертный Майки. Бабу — его байк.',
};

/** One folder, the card of Майки with filled sections (the template's order), a way to get the sections by title. */
function shelf() {
  const tr = addFolder(emptyLibrary(), { name: 'Токийские мстители' });
  const added = addLibraryCharacter(tr.library, { folderId: tr.folder.id, name: 'Майки', aliases: ['Манджиро', 'Mikey'] });
  const card = added.character;
  const by = title => card.sections.find(section => section.title === title);
  by('Basic Info').text = TEXT.basic;
  by('Voice').text = TEXT.voice;
  by('Visual').text = TEXT.visual;
  by('Skills').text = TEXT.skills;
  by('Relationships').text = TEXT.relationships;
  by('NSFW module').text = TEXT.nsfw;
  by('Public Info').text = TEXT.publicInfo;
  by('Public Info').keys = ['бабу'];
  const library = updateLibraryCharacter(added.library, card.id, { sections: card.sections });
  return { library, folder: tr.folder, card: library.characters[0] };
}

const verdicts = report => Object.fromEntries(report.people[0].parts.map(part => [part.title, part.action]));
const attach = (state, library, card) => linkCards(state, library, [card.id]).state;

test('the sections of a card are the ones the lorebook prompter knows', () => {
  assert.deepEqual(Object.keys(CARD_SECTION_KINDS).sort(), Object.keys(GATE_SECTIONS).sort());
  assert.deepEqual(splitGateTitle('[ Manjiro Sano ] - Public Info'), { name: 'Manjiro Sano', tail: 'Public Info', section: 'other' });
});

test('a new card starts with the questionnaire sections, empty; the library keeps cards in folders only', () => {
  assert.throws(() => addLibraryCharacter(emptyLibrary(), { name: 'Майки' }), /Сначала выберите папку/);
  const { library, folder, card } = shelf();
  assert.deepEqual(templateSections().map(section => section.title), ['Basic Info', 'Visual', 'Voice', 'Public Info', 'Skills', 'Relationships', 'Biography', 'Character and psychology', 'NSFW module']);
  assert.equal(card.sections.length, 9);
  assert.equal(folderContents(library, folder.id).characters[0].id, card.id);
  assert.deepEqual(searchLibraryCharacters(library, 'бессмертный').map(item => item.id), [card.id], 'searches the text of the sections too');
  assert.deepEqual(searchLibraryCharacters(library, 'mikey').map(item => item.id), [card.id]);
  assert.match(cardPlainText(card), /## Майки \/ Манджиро \/ Mikey[\s\S]*### Voice\nГоворит лениво/);
  assert.doesNotMatch(cardPlainText(card), /Biography/, 'an empty section is not text');
});

test('a section is repaired when loaded: unknown kind, a duplicate id, a wrong rule, keys as a string', () => {
  const library = normalizeLibrary({
    folders: [{ id: 'f', name: 'Папка' }],
    characters: [{ id: 'c1', folderId: 'f', name: 'Ран', sections: [
      { id: 's', kind: 'weird', title: '  Любимое  ', text: ' тихо\r\n\r\n\r\nтихо ', when: 'sometimes', keys: 'чай, кофе, чай' },
      { id: 's', kind: 'voice', title: '', text: 'x' },
      'junk',
    ] }],
  });
  const [first, second] = library.characters[0].sections;
  assert.deepEqual([first.kind, first.title, first.text, first.when, first.keys], ['other', 'Любимое', 'тихо\n\nтихо', undefined, ['чай', 'кофе']]);
  assert.notEqual(first.id, second.id, 'ids stay unique');
  assert.equal(second.title, 'Voice', 'an empty title is the name of its kind');
});

test('copy, remove, folder removal, export and import carry the cards (no picture on a copy)', () => {
  const { library, folder, card } = shelf();
  const copy = duplicateLibraryCharacter(library, card.id);
  assert.equal(copy.character.name, 'Майки (копия)');
  assert.equal(copy.character.sections.find(section => section.title === 'Voice').text, TEXT.voice);
  assert.notEqual(copy.character.sections[0].id, card.sections[0].id, 'sections get their own ids');
  assert.deepEqual(removeLibraryCharacter(copy.library, copy.character.id).characters.map(item => item.id), [card.id]);
  assert.throws(() => removeFolder(library, folder.id), /не пуста/);
  assert.deepEqual(removeFolder(library, folder.id, { withContents: true }).removedCharacterIds, [card.id]);
  const file = JSON.parse(JSON.stringify(exportLibrary(library, folder.id)));
  assert.equal(file.characters.length, 1);
  const other = importLibrary(emptyLibrary(), file);
  assert.equal(other.library.characters[0].name, 'Майки');
  assert.equal(other.library.characters[0].sections.find(section => section.title === 'Public Info').keys[0], 'бабу', 'rule and keys survive the file');
  assert.deepEqual(importLibrary(other.library, file).added, [], 'importing twice changes nothing');
  assert.equal(addCharacterDrafts(library, [{ name: 'Майки' }], folder.id).skipped.length, 1);
});

test('one name per folder: the same name is fine in another folder, never twice in one', () => {
  const { library, folder, card } = shelf();
  assert.throws(() => addLibraryCharacter(library, { folderId: folder.id, name: ' майки ' }), /В папке «Токийские мстители» уже есть карточка «Майки»/);
  const other = addFolder(library, { name: 'Университет' });
  const twin = addLibraryCharacter(other.library, { folderId: other.folder.id, name: 'Майки' });
  assert.equal(twin.library.characters.length, 2, 'another folder: allowed');
  // Moving or renaming into a clash is refused too; the card itself does not clash with itself.
  assert.throws(() => updateLibraryCharacter(twin.library, twin.character.id, { folderId: folder.id }), /уже есть карточка/);
  assert.doesNotThrow(() => updateLibraryCharacter(library, card.id, { name: 'Майки', aliases: ['Mikey'] }));
  // A copy numbers itself instead of clashing.
  const first = duplicateLibraryCharacter(library, card.id);
  const second = duplicateLibraryCharacter(first.library, card.id);
  assert.deepEqual(second.library.characters.map(item => item.name).sort(), ['Майки', 'Майки (копия 2)', 'Майки (копия)']);
});

test('switching a card on: the character of that name or alias, else a new one; never the persona; one card per character', () => {
  const { library, card } = shelf();
  const state = chat();
  assert.equal(entityForCard(state, card), 'mikey', 'found by a name of the card that is an alias of the character');
  const result = linkCards(state, library, [card.id]);
  assert.deepEqual(result.linked, [{ cardId: card.id, entityId: 'mikey', created: false }]);
  assert.ok(result.state.entities.mikey.aliases.includes('Mikey'), 'the card gives its names to the character');
  assert.equal(cardsByEntity(result.state, library).get('mikey').id, card.id);
  assert.doesNotThrow(() => importState(result.state), 'the journal still replays');

  // A card of someone who is not in the chat yet brings them.
  const stranger = addLibraryCharacter(library, { folderId: card.folderId, name: 'Какучо' });
  const brought = linkCards(result.state, stranger.library, [stranger.character.id]);
  assert.equal(brought.linked[0].created, true);
  assert.equal(brought.state.entities[brought.linked[0].entityId].name, 'Какучо');
  assert.doesNotThrow(() => importState(brought.state));

  // The persona keeps her own page.
  const persona = addLibraryCharacter(library, { folderId: card.folderId, name: 'Иоко' });
  const refused = linkCards(state, persona.library, [persona.character.id]);
  assert.equal(refused.skipped.length, 1);
  assert.equal(refused.state, state);

  // A second card for the same character takes the place of the first.
  const twin = addLibraryCharacter(library, { folderId: card.folderId, name: 'Майки (АУ)', aliases: ['Майки'] });
  const swapped = linkCards(result.state, twin.library, [twin.character.id]);
  assert.deepEqual([...cardLinks(swapped.state).keys()], [twin.character.id]);

  // Switching off only lets go; the character stays with everything they have.
  const off = unlinkCards(result.state, [card.id]);
  assert.equal(cardLinks(off).size, 0);
  assert.ok(off.entities.mikey);
  assert.equal(unlinkCards(off, [card.id]), off, 'nothing to do, nothing changed');
});

test('a card that left the library or a character that left the chat is let go on opening the chat', () => {
  const { library, card } = shelf();
  const attached = attach(chat(), library, card);
  assert.equal(syncCardLinks(attached, library), attached, 'nothing missing: the same state');
  const gone = syncCardLinks(attached, removeLibraryCharacter(library, card.id));
  assert.deepEqual(gone.ui.cards, {});
  const without = { ...attached, entities: Object.fromEntries(Object.entries(attached.entities).filter(([id]) => id !== 'mikey')) };
  assert.equal(cardLinks(without).size, 0);
  assert.deepEqual(syncCardLinks(without, library).ui.cards, {});
});

test('the narrator gets the sections its rules allow: always / entrance / pair / fight / intimacy / by keys', () => {
  const { library, card } = shelf();
  const state = attach(chat(['mikey']), library, card);
  const tracker = new Map();
  const base = { state, library, presentIds: ['mikey'], tracker, turn: 3, namedText: 'Привет.', replyText: '' };
  const calm = planCards(base);
  assert.deepEqual(verdicts(calm.report), {
    'Basic Info': 'force', Visual: 'force', Voice: 'force', 'Public Info': 'drop', Skills: 'drop', Relationships: 'drop', 'NSFW module': 'drop',
  });
  assert.match(calm.block, /^\[CHARACTER SHEETS/);
  assert.match(calm.block, /## Майки \/ Манджиро \/ Mikey\n### Basic Info\nЛидер Бонтена[\s\S]*### Voice\nГоворит лениво/);
  assert.doesNotMatch(calm.block, /Лучший боец|за шею|Санзу/, 'what is not allowed is not sent');
  assert.equal(calm.report.sent, 3);

  // «Entrance»: the look goes at once, again on the same turn (a swipe), then waits, then comes back.
  assert.equal(verdicts(planCards({ ...base, tracker }).report).Visual, 'force', 'a swipe of the same reply sends it again');
  const wait = planCards({ ...base, tracker, turn: 4 });
  assert.equal(verdicts(wait.report).Visual, 'drop');
  assert.match(wait.report.people[0].parts.find(part => part.title === 'Visual').why, /ход\. назад/);
  assert.equal(verdicts(planCards({ ...base, tracker, turn: 9 }).report).Visual, 'force');

  // Words of the section bring it in; the fight and the intimacy bring theirs.
  assert.equal(verdicts(planCards({ ...base, namedText: 'Бабу ревёт у входа.' }).report)['Public Info'], 'force');
  assert.equal(verdicts(planCards({ ...base, mode: 'fight' }).report).Skills, 'force');
  const intim = planCards({ ...base, mode: 'intim' });
  assert.equal(verdicts(intim.report)['NSFW module'], 'force');
  assert.equal(verdicts(intim.report).Skills, 'drop');

  // «Pair»: the relationships go when the other one is in play.
  const two = planCards({ ...base, state: attach(chat(['mikey', 'sanzu']), library, card), presentIds: ['mikey', 'sanzu'] });
  assert.equal(verdicts(two.report).Relationships, 'force');
});

test('a section can have its own rule, and the settings\' rule is the default', () => {
  const { library, card } = shelf();
  const own = updateLibraryCharacter(library, card.id, { sections: card.sections.map(section => (section.title === 'Voice' ? { ...section, when: 'never' } : section.title === 'Skills' ? { ...section, when: 'always' } : section)) });
  const state = attach(chat(), own, own.characters[0]);
  const result = planCards({ state, library: own, presentIds: ['mikey'], turn: 1 });
  assert.equal(verdicts(result.report).Voice, 'drop');
  assert.equal(verdicts(result.report).Skills, 'force');
  // The gate's settings change the rule for everyone.
  const strict = planCards({ state, library, presentIds: ['mikey'], turn: 1, config: { sections: { basic: { when: 'never' } } } });
  assert.equal(verdicts(strict.report)['Basic Info'], 'drop');
});

test('someone not in the scene: nothing, unless the posts name them; then only the main sections', () => {
  const { library, card } = shelf();
  const state = attach(chat(['sanzu']), library, card);
  const away = planCards({ state, library, presentIds: ['sanzu'], turn: 1, namedText: 'Пойдём.' });
  assert.equal(away.block, '');
  assert.ok(away.report.people[0].parts.every(part => part.action === 'drop'));
  const named = planCards({ state, library, presentIds: ['sanzu'], turn: 1, namedText: 'Майки, ты где?' });
  assert.deepEqual(Object.entries(verdicts(named.report)).filter(([, action]) => action === 'force').map(([title]) => title).sort(), ['Basic Info', 'Voice']);
  assert.equal(named.report.people[0].named, true);
});

test('the block keeps to its size: the sections that do not fit are held back and say so', () => {
  const { library, card } = shelf();
  const big = updateLibraryCharacter(library, card.id, { sections: card.sections.map(section => (section.title === 'Basic Info' || section.title === 'Voice' ? { ...section, text: 'ж'.repeat(380) } : section)) });
  const state = attach(chat(), big, big.characters[0]);
  const result = planCards({ state, library: big, presentIds: ['mikey'], turn: 1, maxCharacters: 500 });
  const parts = result.report.people[0].parts;
  assert.equal(parts.find(part => part.title === 'Basic Info').action, 'force');
  assert.equal(parts.find(part => part.title === 'Voice').action, 'trim');
  assert.ok(result.report.trimmed >= 1);
  assert.equal((result.block.match(/ж{380}/g) ?? []).length, 1, 'only one of the two long sections went out');
});

test('a character with a card does not also get their lorebook sheet; other entries stay', () => {
  const { library, card } = shelf();
  const state = attach(chat(), library, card);
  let uid = 0;
  const entry = (comment, key) => ({ uid: uid += 1, comment, key: [rx(key)], content: 'text' });
  const sheet = [entry('[ Manjiro Sano ] - Basic Info', 'майки'), entry('[ Manjiro Sano ] - Voice', 'майки')];
  const others = [entry('[ Haruchiyo Sanzu ] - Basic Info', 'санзу'), entry('Пентхаус Бонтен - Кухня', 'кухня')];
  const decisions = planSheetDrops({ lists: { characterLore: [...sheet, ...others] }, state, library });
  assert.deepEqual([...decisions.values()], ['drop', 'drop']);
  assert.ok(sheet.every(item => decisions.get(item) === 'drop') && others.every(item => !decisions.has(item)));
  assert.equal(planSheetDrops({ lists: { characterLore: sheet }, state: chat(), library }).size, 0, 'no card in the chat: the sheet stays');
});

test('a digest for models that think about the character: the main sections first, never the NSFW one', () => {
  const { library, card } = shelf();
  const state = attach(chat(), library, card);
  const digest = cardDigest(card, 3000);
  assert.match(digest, /### Basic Info[\s\S]*### Voice/);
  assert.doesNotMatch(digest, /за шею/);
  assert.match(cardDigest(card, 300), /Basic Info/, 'a small room still holds the first section');
  assert.doesNotMatch(cardDigest(card, 300), /Visual/);
  assert.equal(digestFor(state, library, ['sanzu', 'mikey']).startsWith('## Майки'), true);
  assert.equal(digestFor(chat(), library, ['mikey']), '', 'a card that is not switched on says nothing');
});

test('«What the model gets» knows the block and reads it in words', () => {
  const { library, card } = shelf();
  const state = attach(chat(), library, card);
  const { block } = planCards({ state, library, presentIds: ['mikey'], turn: 1 });
  assert.ok(BLOCK_ORDER.includes('cards'));
  assert.ok(BLOCK_ORDER.indexOf('cards') < BLOCK_ORDER.indexOf('relationships'));
  const entry = describeBlocks({ parts: { cards: block }, tokens: { cards: 120 }, enabled: { cards: true } }).find(item => item.id === 'cards');
  assert.equal(entry.state, 'on');
  assert.match(entry.off, /Карточки в промпт/);
  const { sections, rules } = readable('cards', block);
  assert.equal(sections[0].title, 'Майки / Манджиро / Mikey');
  assert.deepEqual(sections[0].items.map(item => item.head), ['Basic Info', 'Visual', 'Voice']);
  assert.match(sections[0].items[0].text, /Лидер Бонтена/);
  assert.match(rules, /never give their traits/);
});

// ---- Imports ----------------------------------------------------------------------

const book = () => ({
  entries: {
    0: { uid: 0, comment: '[ Manjiro Sano ] - Basic Info', key: [rx('майки'), 'Манджиро'], content: 'Лидер Бонтена.' },
    1: { uid: 1, comment: '[ Manjiro Sano ] - Voice', key: [rx('майки')], content: 'Говорит лениво.' },
    2: { uid: 2, comment: '[ Manjiro Sano ] - Public Info', key: [rx('майки')], content: 'Бессмертный Майки.' },
    3: { uid: 3, comment: '[ Haruchiyo Sanzu ] - Basic Info', key: [rx('санзу')], content: 'Правая рука.' },
    4: { uid: 4, comment: 'Пентхаус Бонтен - Кухня', key: ['кухня'], content: 'Кухня.' },
    5: { uid: 5, comment: '[ Hitto Kakucho ] - Visual', key: ['какучо'], content: 'Скрыто.', disable: true },
  },
});

test('a lorebook becomes cards: one per «[ Name ]», the sections named like the entries, the key words are other names', () => {
  assert.deepEqual(listLorebookCharacters(book()).map(item => item.name), ['Manjiro Sano', 'Haruchiyo Sanzu']);
  const drafts = draftsFromLorebookCharacters(book());
  assert.equal(drafts.length, 2);
  const mikey = drafts.find(draft => draft.name === 'Manjiro Sano');
  assert.deepEqual(mikey.sections.map(section => [section.kind, section.title]), [['basic', 'Basic Info'], ['voice', 'Voice'], ['other', 'Public Info']]);
  assert.ok(mikey.aliases.includes('Майки') && mikey.aliases.includes('Манджиро'));
  assert.deepEqual(draftsFromLorebookCharacters(book(), ['Haruchiyo Sanzu']).map(draft => draft.name), ['Haruchiyo Sanzu']);
  const tr = addFolder(emptyLibrary(), { name: 'Бонтен' });
  const result = addCharacterDrafts(tr.library, drafts, tr.folder.id);
  assert.equal(result.added.length, 2);
  assert.equal(result.library.characters.find(item => item.name === 'Manjiro Sano').sections[1].text, 'Говорит лениво.');
  assert.equal(addCharacterDrafts(result.library, drafts, tr.folder.id).skipped.length, 2, 'the second import changes nothing');
});

test('a questionnaire note becomes a card: sections from ### headings, hints and unanswered questions left out', () => {
  const note = [
    '---', 'Fandom: "Токийские мстители"', 'name_en: Manjiro Sano', 'keys:', '  - Майки', '  - Манджиро', '---',
    '%% КАК ЗАПОЛНЯТЬ: это не попадёт никуда %%', '',
    '### Basic Info', '', '- **Имя, фамилия, псевдоним:** Сано Манджиро, Майки', '\t%% подсказка %%', '- **Возраст:** ', '- **Роль:** лидер Бонтена', '', '---', '',
    '### Voice', '', 'Говорит ==лениво==.', '',
    '### Skills', '', '- **Бой:** ', '',
  ].join('\n');
  const draft = draftFromQuestionnaire('Анкеты/Бонтен/Сано Манджиро (Бонтен).md', note);
  assert.deepEqual(draft.folderPath, ['Бонтен']);
  assert.equal(draft.name, 'Сано Манджиро (Бонтен)');
  assert.deepEqual(draft.aliases, ['Manjiro Sano', 'Майки', 'Манджиро', 'Сано Манджиро']);
  assert.deepEqual(draft.sections.map(section => [section.kind, section.title]), [['basic', 'Basic Info'], ['voice', 'Voice']], 'a section with no answer is not a section');
  assert.match(draft.sections[0].text, /Имя, фамилия, псевдоним: Сано Манджиро, Майки/);
  assert.match(draft.sections[0].text, /Роль: лидер Бонтена/);
  assert.doesNotMatch(draft.sections[0].text, /Возраст|подсказка/);
  assert.equal(draft.sections[1].text, 'Говорит лениво.');
  assert.equal(draftFromQuestionnaire('x/Файл.txt', note), null);
  assert.equal(draftFromQuestionnaire('x/Пусто.md', '# Просто заметка'), null);
});

const NOTE = [
  '---', 'name_en: Satoru Gojo', 'keys:', '  - Годжо', '---', '',
  '### Basic Info', '', '- **Имя:** Сатору Годжо, сильнейший.', '', '---', '',
  '### Voice', '', 'Говорит легко и насмешливо.', '', '---', '',
  '### Skills', '', '- **Бой:** ', '', '---',
  '# Translate', '',
  '[ Satoru Gojo ] - Basic Info', '', '- **Name:** Satoru Gojo, the strongest.', '',
  '[ Satoru Gojo ] - Voice', '', 'Speaks lightly and mockingly.', '',
].join('\n');

test('a questionnaire note is loaded in Russian only: the «# Translate» part stays in Obsidian, the card remembers where it came from', () => {
  const draft = draftFromQuestionnaire('Анкеты/МБ/Годжо Сатору (АУ куб).md', NOTE);
  assert.deepEqual(draft.sections.map(section => [section.title, section.text]), [
    ['Basic Info', '- Имя: Сатору Годжо, сильнейший.'],
    ['Voice', 'Говорит легко и насмешливо.'],
  ]);
  assert.ok(draft.aliases.includes('Satoru Gojo') && draft.aliases.includes('Годжо'), 'the English name still helps to find the character');
  assert.deepEqual(draft.folderPath, ['МБ']);
  assert.equal(draft.source.path, 'МБ/Годжо Сатору (АУ куб).md', 'the path inside the picked folder');
  assert.equal(draft.source.hash, draftFromQuestionnaire('Другая/МБ/Годжо Сатору (АУ куб).md', NOTE.replace('# Translate', '# Translate\n\nещё').concat('\nправка перевода')).source.hash, 'a change in the English part is not a change of the note');
  assert.notEqual(draft.source.hash, draftFromQuestionnaire('Анкеты/МБ/Годжо Сатору (АУ куб).md', NOTE.replace('легко', 'тихо')).source.hash);
  const tr = addFolder(emptyLibrary(), { name: 'МБ' });
  const added = addCharacterDrafts(tr.library, [draft], tr.folder.id);
  const card = added.library.characters[0];
  assert.equal(card.sections.every(section => section.textEn === undefined), true, 'one text per section');
  assert.equal(card.source.path, draft.source.path);
  assert.equal(card.lang, undefined);
});

test('a card notices that its note has changed (by what was read, not by the date), and is loaded again in Russian with its own rules kept', () => {
  const tr = addFolder(emptyLibrary(), { name: 'МБ' });
  const draft = draftFromQuestionnaire('Анкеты/МБ/Годжо.md', NOTE);
  let library = addCharacterDrafts(tr.library, [draft], tr.folder.id).library;
  const id = library.characters[0].id;
  // The user gave a section its own rule and translated the card.
  library = updateLibraryCharacter(library, id, { lang: 'en', sections: library.characters[0].sections.map(section => ({ ...section, text: `EN ${section.text}`, ...(section.title === 'Voice' ? { when: 'always', keys: ['голос'] } : {}) })) });
  const voiceId = library.characters[0].sections.find(section => section.title === 'Voice').id;

  const same = checkCardSources(library, [draftFromQuestionnaire('Весь/Анкеты/МБ/Годжо.md', NOTE)]);
  assert.deepEqual([same.changed, same.same, same.missing], [[], 1, []], 'the picked folder may be higher: the same file name is found');
  const edited = NOTE.replace('легко и насмешливо', 'тихо и устало');
  const checked = checkCardSources(library, [draftFromQuestionnaire('Анкеты/МБ/Годжо.md', edited)]);
  assert.deepEqual(checked.changed, [id]);
  assert.equal(checked.library.characters[0].source.stale, true);
  assert.equal(library.characters[0].source.stale, undefined, 'the library given is not touched');
  assert.deepEqual(checkCardSources(library, []).missing, [id], 'no such note any more');
  assert.deepEqual(checkCardSources(checked.library, [draft]).changed, [], 'back to what it was: the mark goes');
  assert.equal(checkCardSources(checked.library, [draft]).library.characters[0].source.stale, undefined);

  const fresh = refreshLibraryCharacter(checked.library, id, draftFromQuestionnaire('Анкеты/МБ/Годжо.md', edited));
  const card = fresh.characters[0];
  assert.equal(card.lang, undefined, 'the card is Russian again, to be translated as a separate step');
  assert.equal(card.source.stale, undefined);
  assert.equal(card.sections.find(section => section.title === 'Voice').text, 'Говорит тихо и устало.');
  const voice = card.sections.find(section => section.title === 'Voice');
  assert.equal(voice.id, voiceId);
  assert.equal(voice.when, 'always');
  assert.deepEqual(voice.keys, ['голос']);
  assert.equal(card.name, 'Годжо');
  assert.equal(duplicateLibraryCharacter(fresh, id).character.source, undefined, 'a copy is not tied to the note');
});

test('translation: a card goes into English section by section, the language is marked, the narrator reads one text', async () => {
  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  let state = chat();
  const told = [];
  const sent = [];
  const callbacks = createLibraryCallbacks({
    library: store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    replaceState: async next => { state = importState(next); },
    confirm: async () => true,
    notify: text => told.push(text),
    translateSections: async sections => { sent.push(sections.map(section => section.title)); return sections.map(section => ({ id: section.id, text: `EN: ${section.text}` })); },
  });
  const folder = callbacks.onLibraryAddFolder({ name: 'МБ' });
  const imported = callbacks.onLibraryImportMarkdown({ files: [{ path: `Анкеты/МБ/Годжо.md`, text: NOTE }], folderId: folder.id, kind: 'characters' });
  const card = store.get().characters.find(item => item.id === imported.added[0]);
  assert.equal(card.lang, undefined);
  const other = NOTE.replace('Сатору Годжо', 'Нанами');
  const offered = callbacks.onLibraryPreviewNotes({ files: [{ path: 'Анкеты/МБ/Годжо.md', text: NOTE }, { path: 'Анкеты/МБ/Нанами.md', text: other }, { path: 'Анкеты/Пусто.md', text: '# заметка' }] });
  assert.deepEqual(offered.map(item => [item.path, item.name, item.exists, item.sections]), [['Анкеты/МБ/Годжо.md', 'Годжо', true, 2], ['Анкеты/МБ/Нанами.md', 'Нанами', false, 2]], 'what is loaded already is marked, a note that is no anketa is not offered');

  const result = await callbacks.onLibraryTranslateCard({ cardId: card.id });
  assert.equal(result.translated, 2, 'only sections with text are sent');
  assert.deepEqual(sent, [['Basic Info', 'Voice']]);
  const done = store.get().characters[0];
  assert.equal(done.lang, 'en');
  assert.deepEqual(done.sections.filter(section => section.text).map(section => section.text), ['EN: - Имя: Сатору Годжо, сильнейший.', 'EN: Говорит легко и насмешливо.']);
  assert.equal(done.source.path, 'МБ/Годжо.md');
  await assert.rejects(() => callbacks.onLibraryTranslateCard({ cardId: card.id }), /уже на английском/);

  // The note changes: the card is marked, then loaded again — Russian, to be translated once more.
  const edited = NOTE.replace('легко и насмешливо', 'тихо и устало');
  const files = [{ path: 'Анкеты/МБ/Годжо.md', text: edited }];
  assert.deepEqual(callbacks.onLibraryCheckNotes({ files }), { changed: [card.id], same: 0, missing: [] });
  assert.equal(store.get().characters[0].source.stale, true);
  assert.deepEqual((await callbacks.onLibraryRefreshCards({ files, cardIds: [] })).updated, [card.id], 'with no ids, the marked ones');
  const again = store.get().characters[0];
  assert.equal(again.lang, undefined);
  assert.equal(again.sections.find(section => section.title === 'Voice').text, 'Говорит тихо и устало.');
  assert.deepEqual((await callbacks.onLibraryRefreshCards({ files, cardIds: [] })).updated, [], 'nothing is marked now: nothing to load');
  await callbacks.onLibraryTranslateCards({ cardIds: [card.id] });
  assert.equal(store.get().characters[0].lang, 'en');

  // A failure stops the card where it is: nothing is half-translated.
  const broken = createLibraryCallbacks({
    library: store, getState: () => state, commitOperations: async () => {}, replaceState: async () => {}, confirm: async () => true,
    translateSections: async () => { throw new Error('Раздел «Voice» не переведён: модель молчит'); },
  });
  await callbacks.onLibraryRefreshCards({ files: [{ path: 'Анкеты/МБ/Годжо.md', text: NOTE }], cardIds: [card.id] });
  const before = JSON.stringify(store.get().characters[0]);
  await assert.rejects(() => broken.onLibraryTranslateCard({ cardId: card.id }), /модель молчит/);
  assert.equal(JSON.stringify(store.get().characters[0]), before);
});

test('the narrator gets the card as it is: one text per section', () => {
  const { library, card } = shelf();
  const english = updateLibraryCharacter(library, card.id, { lang: 'en', sections: card.sections.map(section => (section.title === 'Voice' ? { ...section, text: 'Speaks slowly and softly.' } : section)) });
  const state = attach(chat(), english, english.characters[0]);
  const planned = planCards({ state, library: english, presentIds: ['mikey'], turn: 1 });
  assert.match(planned.block, /### Voice\nSpeaks slowly and softly\./);
  assert.doesNotMatch(planned.block, /Говорит лениво/);
  assert.equal(planned.report.people[0].parts.find(part => part.title === 'Voice').characters, 'Speaks slowly and softly.'.length);
});

test('one source per character: the lorebook entries about a carded character are skipped everywhere, not only in the prompt', () => {
  const { library, card } = shelf();
  const state = attach(chat(), library, card);
  const isSheet = cardedSheetTest(state, library);
  assert.equal(cardedSheetTest(chat(), library), null, 'no card in the chat: nothing is skipped');
  const entry = comment => ({ comment, key: ['x'], content: 'text' });
  assert.equal(isSheet(entry('[ Mikey ] - Voice')), true, 'by the title «[ Name ] - Section»');
  assert.equal(isSheet(entry('Майки (Бонтен)')), true, 'by a title that is the name alone');
  assert.equal(isSheet(entry('Манджиро — анкета')), true, 'by an other name of the card');
  assert.equal(isSheet(entry('[Секрет: Санзу] Майки болен')), false, 'a secret is knowledge, not a sheet');
  assert.equal(isSheet(entry('Пентхаус Бонтен - Кухня')), false);
  assert.equal(isSheet(entry('[ Санзу ] - Voice')), false, 'someone else');
  // The analyzer and the generators read lorebooks through the same test.
  const book = { entries: { 0: { uid: 0, comment: 'Майки (Бонтен)', key: ['Майки'], content: 'анкета Майки' }, 1: { uid: 1, comment: 'Пентхаус', key: ['Майки'], content: 'где Майки живёт' } } };
  assert.deepEqual(matchLoreEntries(book, state.entities, 'книга').map(item => item.title), ['Майки (Бонтен)', 'Пентхаус']);
  assert.deepEqual(matchLoreEntries(book, state.entities, 'книга', isSheet).map(item => item.title), ['Пентхаус']);
});

// ---- Callbacks --------------------------------------------------------------------

test('callbacks: a card is made, switched on by folder, follows the library, goes with its folder', async () => {
  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  let state = chat();
  const asked = [];
  const told = [];
  const callbacks = createLibraryCallbacks({
    library: store,
    getState: () => state,
    commitOperations: async operations => { state = applyOperations(state, operations); },
    replaceState: async next => { state = importState(next); },
    confirm: async title => { asked.push(title); return true; },
    notify: text => told.push(text),
    listBooks: () => ['Бонтен'],
    loadBook: async () => book(),
  });
  const folder = callbacks.onLibraryAddFolder({ name: 'Бонтен' });
  assert.throws(() => callbacks.onLibraryAddCharacter({ name: 'Майки' }), /Сначала выберите папку/);
  const mikey = callbacks.onLibraryAddCharacter({ folderId: folder.id, name: 'Майки' });
  callbacks.onLibraryAddCharacter({ folderId: folder.id, name: 'Иоко' });
  assert.equal(mikey.sections.length, 9);
  assert.equal(await callbacks.onLibraryLink({ folderId: folder.id, kind: 'characters' }), 1, 'the persona is not switched on');
  assert.ok(told.some(text => /Иоко[\s\S]*персона/.test(text)));
  assert.deepEqual(callbacks.onLibraryGet().linkedCharacterIds, [mikey.id]);
  assert.equal(state.ui.cards[mikey.id], 'mikey');

  await callbacks.onLibraryUpdateCharacter({ cardId: mikey.id, changes: { sections: mikey.sections.map(section => (section.title === 'Voice' ? { ...section, text: 'Тихо.' } : section)) } });
  assert.equal(store.get().characters.find(card => card.id === mikey.id).sections.find(section => section.title === 'Voice').text, 'Тихо.');

  // Lorebook import offers characters, not entries.
  assert.deepEqual((await callbacks.onLibraryLorebookEntries({ book: 'Бонтен', kind: 'characters' })).map(item => item.name), ['Manjiro Sano', 'Haruchiyo Sanzu']);
  const imported = await callbacks.onLibraryImportLorebook({ book: 'Бонтен', kind: 'characters', folderId: folder.id, uids: [] });
  assert.equal(imported.added.length, 2);
  assert.equal(settings.locationLibrary.locations.length, 0);

  assert.equal(await callbacks.onLibraryLink({ libraryIds: [mikey.id], on: false, kind: 'characters' }), 1);
  assert.deepEqual(callbacks.onLibraryGet().linkedCharacterIds, []);
  assert.ok(state.entities.mikey, 'the character stays');

  await callbacks.onLibraryLink({ libraryIds: [mikey.id], on: true, kind: 'characters' });
  assert.equal(await callbacks.onLibraryRemoveCharacter({ cardId: mikey.id }), true);
  assert.deepEqual(state.ui.cards, {}, 'a deleted card is let go of its character');
  assert.ok(state.entities.mikey);
  assert.equal(await callbacks.onLibraryRemoveFolder({ folderId: folder.id }), true);
  assert.deepEqual(store.get().characters, []);
  assert.deepEqual(asked, ['Удалить карточку', 'Удалить папку']);
  assert.equal(syncChatCards(state, store), state);
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

test('«Мир → Карточки»: a gallery with a switch per card; the sheet opens with its sections, what is typed is saved, the prompt status shows', async () => {
  const { library, folder, card } = shelf();
  const state = attach(chat(), library, card);
  const planned = planCards({ state, library, presentIds: ['mikey'], turn: 1 });
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); return name === 'onLibraryAddFolder' ? { id: 'f-new' } : undefined; } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name })),
    locationLibrary: library, linkedLocationIds: [], linkedItemIds: [], linkedCharacterIds: [card.id],
    cardByEntity: { mikey: { id: card.id, name: card.name } }, cardsReport: planned.report, cardsTokens: 90,
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'cards' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    assert.match(shadow.querySelector('main').textContent, /В запросе сейчас: разделов 3/);
    // By hand: a form with a name and a folder, which works with no folder open (the open one is offered).
    byText('+ Карточка').click();
    const nameField = shadow.querySelector('input[aria-label="Имя персонажа"]');
    assert.ok(nameField, 'the form of a new card');
    nameField.value = 'Ран';
    nameField.dispatchEvent(new dom.window.Event('input'));
    shadow.querySelector('select[aria-label="Папка новой карточки"]').value = '__new';
    shadow.querySelector('select[aria-label="Папка новой карточки"]').dispatchEvent(new dom.window.Event('change'));
    const folderField = shadow.querySelector('input[aria-label="Название новой папки"]');
    folderField.value = 'Бонтен';
    folderField.dispatchEvent(new dom.window.Event('input'));
    byText('Создать и открыть').click();
    await flush();
    assert.deepEqual(calls.slice(-2).map(([name]) => name), ['onLibraryAddFolder', 'onLibraryAddCharacter']);
    assert.equal(calls.at(-1)[1].name, 'Ран');
    shadow.querySelector('.ku-folder').click();
    const tile = shadow.querySelector('.ku-place-card');
    assert.match(tile.textContent, /Майки[\s\S]*7 из 9 разделов заполнено/);
    const sw = tile.querySelector('.ku-switch');
    assert.equal(sw.checked, true);
    sw.checked = false;
    sw.dispatchEvent(new dom.window.Event('change'));
    await flush();
    assert.deepEqual(calls.at(-1), ['onLibraryLink', { libraryIds: [card.id], on: false, kind: 'characters' }]);

    tile.querySelector('.ku-place-open').click();
    // The sheet: a list of sections on the left, one section on the right.
    const navs = () => [...shadow.querySelectorAll('.ku-cnav')];
    const nav = title => navs().find(node => node.querySelector('.ku-cnav-title').textContent === title);
    assert.equal(navs().length, 10); // nine sections and the closet
    assert.equal(shadow.querySelector('.ku-cnav.on .ku-cnav-title').textContent, 'Basic Info', 'the first section is open');
    assert.match(shadow.querySelector('.ku-ctitlerow').textContent, /Basic Info[\s\S]*сейчас уходит в запрос/);
    nav('Skills').click();
    assert.match(shadow.querySelector('.ku-ctitlerow').textContent, /сейчас придержан: не бой/);
    nav('Voice').click();
    const voice = shadow.querySelector('textarea');
    assert.equal(voice.value, TEXT.voice);
    voice.value = 'Говорит тихо и коротко.';
    voice.dispatchEvent(new dom.window.Event('input'));
    // Going to another section and back keeps what is typed.
    nav('Visual').click();
    nav('Voice').click();
    assert.equal(shadow.querySelector('textarea').value, 'Говорит тихо и коротко.');
    // The rule: «as for all» by default; an own rule is a second choice, with the list of rules.
    assert.equal(shadow.querySelector('select[aria-label="Своё правило отправки"]').disabled, true);
    const own = [...shadow.querySelectorAll('input[type=radio]')][1];
    own.checked = true;
    own.dispatchEvent(new dom.window.Event('change'));
    const rule = shadow.querySelector('select[aria-label="Своё правило отправки"]');
    assert.equal(rule.disabled, false);
    rule.value = 'never';
    rule.dispatchEvent(new dom.window.Event('change'));
    // The words of a section are asked for only when it goes by keys.
    assert.equal(shadow.querySelector('textarea[aria-label="Ключевые слова раздела"]').disabled, true);
    nav('Public Info').click();
    assert.equal(shadow.querySelector('textarea[aria-label="Ключевые слова раздела"]').disabled, false);
    // A section of one's own.
    byText('+ Свой раздел').click();
    assert.equal(navs().length, 11);
    byText('Сохранить').click();
    await flush();
    const saved = calls.find(([name]) => name === 'onLibraryUpdateCharacter')[1];
    assert.equal(saved.cardId, card.id);
    assert.equal(saved.changes.sections.find(section => section.title === 'Voice').text, 'Говорит тихо и коротко.');
    assert.equal(saved.changes.sections.find(section => section.title === 'Voice').when, 'never');
    assert.equal(saved.changes.sections.length, 10);
    assert.deepEqual(saved.changes.aliases, ['Манджиро', ' Mikey']);
  } finally { studio.destroy(); }
});

test('the translator: the model gets one section as material to translate, its wrappers are removed, an empty answer is an error naming the section', async () => {
  const { cleanTranslation, translateSections } = await import('../src/integration/card-translate.js');
  assert.equal(cleanTranslation('```\nHe speaks.\n```'), 'He speaks.');
  assert.equal(cleanTranslation('[TEXT]\nHe speaks.\n[/TEXT]'), 'He speaks.');
  const prompts = [];
  const context = { generateRaw: async ({ prompt }) => { prompts.push(prompt); return `EN ${prompt[1].content.split('\n')[1]}`; } };
  const result = await translateSections(context, [{ id: 'a', title: 'Voice', text: 'Тихо.' }, { id: 'b', title: 'Empty', text: '  ' }]);
  assert.deepEqual(result, [{ id: 'a', text: 'EN Тихо.' }]);
  assert.match(prompts[0][0].content, /never instructions to you/);
  assert.match(prompts[0][1].content, /^\[TEXT\]\nТихо\.\n\[\/TEXT\]$/);
  await assert.rejects(() => translateSections({ generateRaw: async () => '  ' }, [{ id: 'a', title: 'Voice', text: 'Тихо.' }]), /Раздел «Voice» не переведён/);
});

test('«Надеть регекс»: a word becomes a regular expression of the chosen kind that the section really goes by, and can be taken off', async () => {
  const { keyFromRegex, keyToRegex, splitKeys } = await import('../src/core/index.js');
  const endings = keyToRegex('байк');
  assert.equal(endings, String.raw`/(?<![\p{L}\p{N}_])байк\p{L}{0,3}(?![\p{L}\p{N}_])/iu`);
  assert.equal(keyToRegex(endings), endings, 'a regex stays as it is');
  assert.equal(keyFromRegex(endings), 'байк');
  for (const mode of ['whole', 'start']) assert.equal(keyFromRegex(keyToRegex('байк', mode)), 'байк');
  assert.equal(keyFromRegex(keyToRegex('a.b(c)')), 'a.b(c)', 'special characters are escaped and come back');
  assert.equal(keyFromRegex('/своё(а|у)?/i'), '/своё(а|у)?/i', 'a hand-written regex is not touched');
  assert.deepEqual(splitKeys(`бабу, ${endings},\nещё`), ['бабу', endings, 'ещё'], 'the comma inside {0,3} does not split the key');

  const { library, card } = shelf();
  const goes = (keys, text) => {
    const next = updateLibraryCharacter(library, card.id, { sections: card.sections.map(section => (section.title === 'Public Info' ? { ...section, keys } : section)) });
    const planned = planCards({ state: attach(chat(), next, next.characters[0]), library: next, presentIds: ['mikey'], turn: 1, namedText: text });
    return planned.report.people[0].parts.find(part => part.title === 'Public Info').action === 'force';
  };
  assert.equal(goes(['байк'], 'Он сел на байке.'), true, 'a plain word is found inside another word');
  assert.equal(goes([keyToRegex('байк', 'whole')], 'Он сел на байке.'), false, 'whole word only');
  assert.equal(goes([keyToRegex('байк', 'whole')], 'Его байк рычал.'), true);
  assert.equal(goes([keyToRegex('байк')], 'Он сел на байке.'), true, 'with endings');
  assert.equal(goes([keyToRegex('байк')], 'Сказал небайковый человек.'), false, 'but not in the middle of a word');
});

test('arrow keys typed in a Kulisy field never reach SillyTavern (they would swipe its last reply, as the shadow root hides the focused field)', async () => {
  const { shieldKeys } = await import('../src/ui/key-shield.js');
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const field = document.createElement('textarea');
  const button = document.createElement('button');
  shadow.append(field, button);
  document.body.append(host);
  const seen = [];
  const spy = event => seen.push(event.key);
  document.addEventListener('keydown', spy);
  const stop = shieldKeys(shadow);
  const press = (node, key, init = {}) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init }));
  press(field, 'ArrowRight');
  press(field, 'ArrowLeft');
  press(field, 'Enter', { ctrlKey: true });
  assert.deepEqual(seen, [], 'nothing from a field leaves the window');
  press(field, 'Escape');
  press(field, 'Tab');
  press(button, 'ArrowRight');
  press(button, 'ArrowLeft');
  press(button, 'x');
  assert.deepEqual(seen, ['Escape', 'Tab', 'x'], 'Escape and Tab pass; the arrows are stopped even on a button, other keys on a button are not typing');
  stop();
  document.removeEventListener('keydown', spy);
  host.remove();
});

test('several cards at once: moved to another folder (a taken name stays), or deleted after one question', async () => {
  const { moveLibraryCharacters } = await import('../src/core/index.js');
  let library = emptyLibrary();
  const a = addFolder(library, { name: 'А' });
  const b = addFolder(a.library, { name: 'Б' });
  library = b.library;
  const make = (folder, name) => { const made = addLibraryCharacter(library, { folderId: folder.id, name }); library = made.library; return made.character.id; };
  const mikey = make(a.folder, 'Майки');
  const ran = make(a.folder, 'Ран');
  const taken = make(b.folder, 'Ран');
  const moved = moveLibraryCharacters(library, [mikey, ran, mikey], b.folder.id);
  assert.deepEqual(moved.moved, [mikey]);
  assert.deepEqual(moved.skipped.map(item => item.name), ['Ран'], 'the name is taken in the target folder');
  assert.equal(moved.library.characters.find(card => card.id === ran).folderId, a.folder.id);
  assert.equal(moved.library.characters.find(card => card.id === mikey).folderId, b.folder.id);
  assert.throws(() => moveLibraryCharacters(library, [mikey], 'nope'), /выберите папку/);

  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  store.set(library);
  const asked = [];
  const callbacks = createLibraryCallbacks({
    library: store, getState: () => chat(), commitOperations: async () => {}, replaceState: async () => {}, confirm: async title => { asked.push(title); return true; }, notify: () => {},
  });
  const result = callbacks.onLibraryMoveCards({ cardIds: [mikey, ran], folderId: b.folder.id });
  assert.deepEqual([result.moved.length, result.skipped.length], [1, 1]);
  assert.equal(await callbacks.onLibraryRemoveCards({ cardIds: [mikey, taken] }), 2);
  assert.deepEqual(asked, ['Удалить карточки'], 'one question for all');
  assert.deepEqual(store.get().characters.map(card => card.name), ['Ран']);
  assert.equal(await callbacks.onLibraryRemoveCards({ cardIds: [] }), 0);
});

test('«Выбрать» on the cards page: tiles get ticks, the bar moves or deletes the ticked ones', async () => {
  const { library, folder } = shelf();
  const second = addFolder(library, { name: 'Другая' });
  const more = addLibraryCharacter(second.library, { folderId: folder.id, name: 'Ран' });
  const lib = more.library;
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); return name === 'onLibraryMoveEntries' ? { moved: payload.ids, skipped: [] } : name === 'onLibraryRemoveEntries' ? payload.ids.length : undefined; } : undefined) });
  const state = chat();
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: [], locationLibrary: lib, linkedLocationIds: [], linkedItemIds: [], linkedCharacterIds: [], cardByEntity: {}, cardsReport: { people: [] }, cardsTokens: 0,
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'cards' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    assert.equal(shadow.querySelector('.ku-pickbar'), null);
    byText('Выбрать').click();
    assert.ok(shadow.querySelector('.ku-pickbar'));
    assert.equal(byText('Удалить').disabled, true, 'nothing ticked: nothing to do');
    byText('Все в списке').click();
    assert.match(shadow.querySelector('.ku-pickbar').textContent, /Выбрано: 2/);
    assert.equal(shadow.querySelectorAll('.ku-pickbox:checked').length, 2);
    assert.equal(byText('Перенести').disabled, true, 'no target folder yet');
    const target = shadow.querySelector('select[aria-label="Папка, куда перенести"]');
    target.value = second.folder.id;
    target.dispatchEvent(new dom.window.Event('change'));
    byText('Перенести').click();
    await flush();
    assert.deepEqual(calls.find(call => call[0] === 'onLibraryMoveEntries')[1].folderId, second.folder.id);
    assert.equal(calls.find(call => call[0] === 'onLibraryMoveEntries')[1].ids.length, 2);
    assert.equal(calls.find(call => call[0] === 'onLibraryMoveEntries')[1].kind, 'characters');
    byText('Все в списке').click();
    byText('Удалить').click();
    await flush();
    assert.equal(calls.filter(call => call[0] === 'onLibraryRemoveEntries').length, 1);
    assert.equal(calls.some(call => call[0] === 'onLibraryRemoveCharacter'), false);
    byText('Готово').click();
    assert.equal(shadow.querySelector('.ku-pickbar'), null);
  } finally { studio.destroy?.(); }
});

test('a note that was loaded once is not loaded again after its card was moved to another folder; refresh finds the card wherever it lies', () => {
  const draft = draftFromQuestionnaire('Анкеты/МБ/Годжо.md', NOTE);
  const tr = addFolder(emptyLibrary(), { name: 'МБ' });
  const other = addFolder(tr.library, { name: 'Мои любимые' });
  const first = addCharacterDrafts(other.library, [draft], tr.folder.id);
  const id = first.added[0];
  const moved = updateLibraryCharacter(first.library, id, { folderId: other.folder.id });
  const again = addCharacterDrafts(moved, [draft], tr.folder.id);
  assert.deepEqual([again.added, again.skipped], [[], ['Годжо']], 'not a second copy in the folder of the note');
  const edited = draftFromQuestionnaire('Анкеты/МБ/Годжо.md', NOTE.replace('легко', 'тихо'));
  assert.deepEqual(checkCardSources(moved, [edited]).changed, [id]);
  const fresh = refreshLibraryCharacter(moved, id, edited);
  assert.equal(fresh.characters[0].folderId, other.folder.id, 'the card stays in its folder');
});

test('cards and the name library: several cards (one character in different AUs) share one entry, their names go there once, its cases help to notice the character', async () => {
  const { addName, normalizeNames, recognitionForms, updateName } = await import('../src/core/index.js');
  const { cardNameForms } = await import('../src/integration/card-links.js');
  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  let names = normalizeNames(null);
  let state = chat();
  const callbacks = createLibraryCallbacks({
    library: store, getState: () => state, commitOperations: async operations => { state = applyOperations(state, operations); }, replaceState: async next => { state = importState(next); },
    confirm: async () => true, notify: () => {},
    names: { get: () => names, change: fn => { names = fn(names); } },
  });
  const folder = callbacks.onLibraryAddFolder({ name: 'МБ' });
  const canon = callbacks.onLibraryAddCharacter({ folderId: folder.id, name: 'Манджиро Сано', aliases: ['Майки'] });
  const au = callbacks.onLibraryAddCharacter({ folderId: folder.id, name: 'Майки (АУ куб)', aliases: ['Mikey', 'Майки'] });

  // The first card makes the entry, the second one joins it: one entry, the names of both, nothing twice.
  const id = callbacks.onLibraryLinkName({ cardId: canon.id, nameId: '__new' });
  assert.equal(names.entries.length, 1);
  assert.equal(names.entries[0].name, 'Манджиро Сано');
  assert.deepEqual(names.entries[0].aliases, ['Майки']);
  assert.equal(callbacks.onLibraryLinkName({ cardId: au.id, nameId: id }), id);
  assert.deepEqual(names.entries[0].aliases, ['Майки', 'Майки (АУ куб)', 'Mikey']);
  assert.equal(names.entries.length, 1, 'no second tab for the same character');
  assert.equal(store.get().characters.every(card => card.nameId === id), true);
  // Making an entry from a card whose name is already there takes that entry.
  assert.equal(callbacks.onLibraryLinkName({ cardId: canon.id, nameId: '__new' }), id);
  assert.throws(() => callbacks.onLibraryLinkName({ cardId: canon.id, nameId: 'nope' }), /нет/);
  // A new alias typed on a card reaches the entry on save.
  await callbacks.onLibraryUpdateCharacter({ cardId: au.id, changes: { aliases: ['Mikey', 'Бессмертный'] } });
  assert.ok(names.entries[0].aliases.includes('Бессмертный'));
  assert.ok(names.entries[0].aliases.includes('Майки'), 'what other cards use is not taken away');
  // Untie.
  assert.equal(callbacks.onLibraryLinkName({ cardId: au.id, nameId: '' }), '');
  assert.equal(store.get().characters.find(card => card.id === au.id).nameId, undefined);

  // Cases: «Манджиро Сано» is noticed in «с Манджиро Сано» only because the entry knows how it declines.
  names = updateName(names, id, { words: [{ word: 'Манджиро', same: true }, { word: 'Сано', same: true }] });
  const forms = recognitionForms(names.entries[0]);
  assert.ok(forms.includes('Сано Манджиро'));
  const library = store.get();
  const card = library.characters.find(item => item.id === canon.id);
  let attached = applyOperations(chat(), [createOperation('entity.upsert', { id: 'kaku', name: 'Какучо' })]);
  attached = linkCards(attached, library, [card.id]).state;
  const extra = cardNameForms(attached, library, names, recognitionForms);
  assert.equal(extra.size, 1, 'a character whose card is tied to an entry');
  assert.deepEqual(cardNameForms(attached, library, { entries: [] }, recognitionForms).size, 0);
});

test('the cases of a name help a card notice its character in the posts', async () => {
  const { updateName, normalizeNames, recognitionForms, addName } = await import('../src/core/index.js');
  const { cardNameForms } = await import('../src/integration/card-links.js');
  const { library, card } = shelf();
  let names = addName(normalizeNames(null), { name: 'Рэн Хайтани', aliases: [] }).library;
  names = updateName(names, names.entries[0].id, { words: [
    { word: 'Рэн', gen: 'Рэна', dat: 'Рэну', acc: 'Рэна', ins: 'Рэном', pre: 'Рэне' },
    { word: 'Хайтани', same: true },
  ] });
  const forms = recognitionForms(names.entries[0]);
  assert.ok(forms.includes('Рэна Хайтани') && forms.includes('Хайтани Рэном'), 'each word in the same case, both orders');
  assert.equal(forms.includes('Рэн Хайтани'), false, 'the name itself is not repeated');

  // The character is named «Рэн Хайтани» in the chat; the card is tied to the entry; the post says «Рэну Хайтани».
  const tied = { ...library, characters: library.characters.map(item => ({ ...item, name: 'Рэн Хайтани', aliases: [], nameId: names.entries[0].id })) };
  let state = applyOperations(createDefaultState(), [createOperation('entity.upsert', { id: 'ren', name: 'Рэн Хайтани' }), createOperation('entity.upsert', { id: 'me', name: 'Иоко' })]);
  state.ui = { ...state.ui, personaId: 'me' };
  state = linkCards(state, tied, [tied.characters[0].id]).state;
  const plain = planCards({ state, library: tied, presentIds: [], turn: 1, namedText: 'Иоко кивнула Рэну Хайтани.' });
  const withCases = planCards({ state, library: tied, presentIds: [], turn: 1, namedText: 'Иоко кивнула Рэну Хайтани.', extraNames: cardNameForms(state, tied, names, recognitionForms) });
  assert.equal(plain.report.people[0].named, false, 'the two-word name in a case is not found as it is');
  assert.equal(withCases.report.people[0].named, true);
});

test('places and things in bulk: moved, deleted after one question, translated into English (description and traits)', async () => {
  const settings = {};
  const store = createLocationLibraryStore({ settings: () => settings, save: () => {} });
  const asked = [];
  const sent = [];
  const callbacks = createLibraryCallbacks({
    library: store, getState: () => chat(), commitOperations: async () => {}, replaceState: async () => {}, notify: () => {},
    confirm: async title => { asked.push(title); return true; },
    translateSections: async sections => { sent.push(sections.map(section => section.id)); return sections.map(section => ({ id: section.id, text: section.id === 'traits' ? sections.find(item => item.id === 'traits').text.split('\n').map(line => `EN ${line}`).join('\n') : `EN ${section.text}` })); },
  });
  const a = callbacks.onLibraryAddFolder({ name: 'А' });
  const b = callbacks.onLibraryAddFolder({ name: 'Б' });
  const bar = callbacks.onLibraryAddLocation({ folderId: a.id, name: 'Бар' });
  const hall = callbacks.onLibraryAddLocation({ folderId: a.id, name: 'Зал' });
  const taken = callbacks.onLibraryAddLocation({ folderId: b.id, name: 'Зал' });
  await callbacks.onLibraryUpdateLocation({ locationId: bar.id, changes: { description: 'Тёмный бар.', traits: ['камин', 'скрипучая лестница'] } });
  const key = callbacks.onLibraryAddItem({ folderId: a.id, name: 'Ключ' });
  await callbacks.onLibraryUpdateItem({ itemId: key.id, changes: { description: 'Ржавый ключ.' } });

  const moved = callbacks.onLibraryMoveEntries({ kind: 'places', ids: [bar.id, hall.id], folderId: b.id });
  assert.deepEqual([moved.moved, moved.skipped], [[bar.id, hall.id], []], 'places may share a name; only cards may not');
  assert.equal(callbacks.onLibraryMoveEntries({ kind: 'items', ids: [key.id], folderId: b.id }).moved.length, 1);
  assert.equal(store.get().items[0].folderId, b.id);

  const done = await callbacks.onLibraryTranslateEntries({ kind: 'places', ids: [bar.id, hall.id] });
  assert.deepEqual(done.done, [bar.id], 'a place with no text has nothing to translate');
  const place = store.get().locations.find(item => item.id === bar.id);
  assert.deepEqual([place.lang, place.description, place.traits], ['en', 'EN Тёмный бар.', ['EN камин', 'EN скрипучая лестница']]);
  assert.deepEqual(sent, [['description', 'traits']]);
  await assert.rejects(() => callbacks.onLibraryTranslateEntry({ kind: 'places', id: bar.id }), /уже на английском/);
  await callbacks.onLibraryTranslateEntry({ kind: 'items', id: key.id });
  assert.deepEqual([store.get().items[0].lang, store.get().items[0].description], ['en', 'EN Ржавый ключ.']);
  await assert.rejects(() => callbacks.onLibraryTranslateEntry({ kind: 'places', id: hall.id }), /нечего переводить/);

  assert.equal(await callbacks.onLibraryRemoveEntries({ kind: 'places', ids: [bar.id, taken.id, 'nope'] }), 2);
  assert.equal(await callbacks.onLibraryRemoveEntries({ kind: 'items', ids: [key.id] }), 1);
  assert.deepEqual(asked.filter(title => /Удалить/.test(title)), ['Удалить локации', 'Удалить вещи']);
  assert.deepEqual(store.get().locations.map(item => item.name), ['Зал']);
  assert.equal(store.get().items.length, 0);
});

test('the closet of a card: sets and things of the wardrobe are ticked, saved with the card, and put on the character by hand', async () => {
  const { addCard, addLook, emptyWardrobe } = await import('../src/core/index.js');
  const { library, card } = shelf();
  let wardrobe = emptyWardrobe();
  const jacket = addCard(wardrobe, { shelf: 'characters', gender: 'male', category: 'outerwear', name: 'Китель' }); wardrobe = jacket.wardrobe;
  const pants = addCard(wardrobe, { shelf: 'characters', gender: 'male', category: 'pants', name: 'Штаны' }); wardrobe = pants.wardrobe;
  const set = addLook(wardrobe, { shelf: 'characters', name: 'Форма', cardIds: [jacket.card.id, pants.card.id] }); wardrobe = set.wardrobe;
  const state = attach(chat(), library, card);
  const calls = [];
  const callbacks = new Proxy({}, { get: (target, name) => (typeof name === 'string' && name.startsWith('on') ? payload => { calls.push([name, payload]); return undefined; } : undefined) });
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name })), wardrobe,
    locationLibrary: library, linkedLocationIds: [], linkedItemIds: [], linkedCharacterIds: [card.id],
    cardByEntity: { mikey: { id: card.id, name: card.name } }, cardsReport: { people: [] }, cardsTokens: 0,
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'cards' }, callbacks });
  const shadow = studio.element.shadowRoot;
  const byText = text => [...shadow.querySelectorAll('button')].find(node => node.textContent === text);
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    shadow.querySelector('.ku-place-open').click();
    assert.ok(shadow.querySelector('.ku-cnav').textContent.startsWith('Шкаф'), 'the closet is the first row of the list: it must not hide below the sections');
    [...shadow.querySelectorAll('.ku-cnav')].find(node => node.textContent.startsWith('Шкаф')).click();
    assert.match(shadow.querySelector('.ku-cpane').textContent, /Комплекты[\s\S]*Форма[\s\S]*Вещи/);
    shadow.querySelector('input[aria-label="Комплект «Форма» у героя"]').click();
    assert.ok(byText('Надеть'), 'a tied set can be put on at once');
    byText('Надеть').click();
    await flush();
    assert.deepEqual(calls.find(call => call[0] === 'onWear')[1], { entityId: 'mikey', cardIds: set.look.cardIds, mode: 'replace' });
    // Ticking a thing does not move it: the order is the one of the moment the closet was opened.
    const caps = () => [...shadow.querySelectorAll('.ku-closet-tile .ku-closet-cap')].map(node => node.textContent);
    const before = caps();
    [...shadow.querySelectorAll('.ku-closet-tile')][1].click();
    assert.deepEqual(caps(), before, 'the tiles stay where they were');
    assert.equal(shadow.querySelectorAll('.ku-closet-tile.on').length, 1);
    [...shadow.querySelectorAll('.ku-closet-tile')][1].click();
    shadow.querySelector('.ku-closet-tile').click();
    byText('Сохранить').click();
    await flush();
    const saved = calls.find(call => call[0] === 'onLibraryUpdateCharacter')[1].changes.closet;
    assert.deepEqual(saved.lookIds, [set.look.id]);
    assert.equal(saved.cardIds.length, 1);
  } finally { studio.destroy?.(); }
});

test('the wardrobe is ordered by what is worn, by character (whose closet it is in), or newest first', async () => {
  const { addCard, emptyWardrobe, updateLibraryCharacter } = await import('../src/core/index.js');
  let wardrobe = emptyWardrobe();
  const make = (name, category) => { const made = addCard(wardrobe, { shelf: 'characters', gender: 'female', category, name }); wardrobe = made.wardrobe; return made.card; };
  const coat = make('Пальто', 'outerwear');
  const top = make('Топ', 'top');
  const boots = make('Ботинки', 'shoes');
  const hat = make('Шапка', 'headwear');
  const { library, card } = shelf();
  const withCloset = updateLibraryCharacter(library, card.id, { closet: { cardIds: [coat.id, boots.id], lookIds: [] } });
  let state = attach(chat(), withCloset, withCloset.characters[0]);
  state = applyOperations(state, [createOperation('wardrobe.set', { entityId: 'sanzu', outfit: 'шапка', cardIds: [hat.id] })]);
  const snapshot = () => ({
    ...state, pairs: [], dossiers: {}, leaks: [], slips: [], settings: {}, lorebooks: { available: [], selected: [], cardWorlds: [] },
    characters: Object.values(state.entities).map(entity => ({ id: entity.id, name: entity.name })), wardrobe,
    locationLibrary: withCloset, linkedLocationIds: [], linkedItemIds: [], linkedCharacterIds: [card.id],
    cardByEntity: { mikey: { id: card.id, name: card.name } }, cardsReport: { people: [] }, cardsTokens: 0,
  });
  const studio = createRelationshipStudio({ store: { getSnapshot: snapshot }, open: true, layout: { mode: 'window', tab: 'wardrobe' }, callbacks: new Proxy({}, { get: () => () => undefined }) });
  const shadow = studio.element.shadowRoot;
  const order = () => [...shadow.querySelectorAll('.ku-tiles .ku-tile .ku-cap')].map(node => node.textContent);
  const pickSort = value => { const select = shadow.querySelector('select[aria-label="Сортировка"]'); select.value = value; select.dispatchEvent(new dom.window.Event('change')); };
  try {
    assert.deepEqual(order(), ['Топ', 'Пальто', 'Ботинки', 'Шапка'], 'by section by default (top, outerwear, shoes, headwear)');
    pickSort('new');
    assert.deepEqual(order(), ['Шапка', 'Ботинки', 'Топ', 'Пальто'], 'the last added first');
    pickSort('worn');
    assert.equal(order()[0], 'Шапка', 'what Санзу has on comes first');
    pickSort('character');
    assert.equal(order().length, 4);
    assert.deepEqual(order().slice(0, 3).sort(), ['Ботинки', 'Пальто', 'Шапка'], 'things with an owner come first, the top of nobody last');
    assert.equal(order()[3], 'Топ');
    const who = shadow.querySelector('select[aria-label="Чьи вещи"]');
    assert.ok(who);
    who.value = 'e:mikey';
    who.dispatchEvent(new dom.window.Event('change'));
    assert.deepEqual(order().sort(), ['Ботинки', 'Пальто'], 'only what is in Майки\'s closet');
  } finally { studio.destroy?.(); }
});
