import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, createEntity } from '../src/core/index.js';
import { NAME_LIMITS, addName, buildNamesPrompt, emptyNames, normalizeNames, removeName, selectNames, updateName, wordsToFill } from '../src/core/name-library.js';
import { fillNameForms, parseNameForms } from '../src/integration/name-forms.js';
import { describeBlocks, readable } from '../src/integration/prompt-overview.js';

function stageWith(...names) {
  let state = createDefaultState();
  const ids = [];
  for (const name of names) {
    const entity = createEntity(name);
    state = { ...state, entities: { ...state.entities, [entity.id]: entity } };
    ids.push(entity.id);
  }
  return { state, ids };
}
const names = list => list.map(entry => entry.name);

test('a name keeps one card per spelling and splits into words that decline apart', () => {
  let { library, entry } = addName(emptyNames(), { name: 'Манджиро Сано', aliases: ['Майки', 'манджиро'] });
  assert.deepEqual(entry.words.map(word => word.word), ['Манджиро', 'Сано', 'Майки']);
  assert.equal(addName(library, { name: 'манджиро сано' }).added, false);
  assert.throws(() => addName(library, { name: '  ' }), /имя/i);
  library = updateName(library, entry.id, { words: [{ word: 'Сано', same: true }, { word: 'Майки', same: true }] });
  assert.deepEqual(wordsToFill(library.entries[0]).map(word => word.word), ['Манджиро']);
  // Renaming keeps the forms of the words that stay.
  library = updateName(library, entry.id, { aliases: ['Майки', 'Манджи'] });
  assert.equal(library.entries[0].words.find(word => word.word === 'Сано').same, true);
  assert.ok(library.entries[0].words.some(word => word.word === 'Манджи'));
  assert.equal(removeName(library, entry.id).entries.length, 0);
});

test('a broken library becomes an empty one, forms are trimmed and limited', () => {
  assert.deepEqual(normalizeNames(null), emptyNames());
  const lib = normalizeNames({ enabled: false, entries: [{ name: '' }, { id: 'a', name: 'Рён', words: [{ word: 'Рён', gen: `  Рёна${'я'.repeat(200)}` }] }] });
  assert.equal(lib.enabled, false);
  assert.equal(lib.entries.length, 1);
  assert.equal(lib.entries[0].words[0].gen.length, NAME_LIMITS.form);
});

test('only the people on stage and the names said in the last posts go to the model', () => {
  const { state, ids } = stageWith('Рён');
  let library = addName(emptyNames(), { name: 'Рён Хайтани' }).library;
  library = addName(library, { name: 'Санзу' }).library;
  library = addName(library, { name: 'Кокономи' }).library;
  assert.deepEqual(names(selectNames(library, state, { presentIds: [], text: '' })), []);
  // «Рён» on stage is not «Рён Хайтани»: the whole name has to match.
  assert.deepEqual(names(selectNames(library, state, { presentIds: [ids[0]], text: '' })), []);
  assert.deepEqual(names(selectNames(library, state, { presentIds: [], text: 'Он поглядел на Санзу и Кокономи.' })), ['Санзу', 'Кокономи']);
  assert.deepEqual(names(selectNames(library, state, { presentIds: [], text: 'Хайтани-сан сказал' })), ['Рён Хайтани']);
});

test('a name on stage matches by sound too, and the stage goes first', () => {
  const { state, ids } = stageWith('Санзу');
  let library = addName(emptyNames(), { name: 'Кокономи' }).library;
  library = addName(library, { name: 'Сандзу' }).library;
  assert.deepEqual(names(selectNames(library, state, { presentIds: ids, text: 'Кокономи вошёл' })), ['Сандзу', 'Кокономи']);
});

test('the block shows forms and «не склоняется», is empty with nobody, and respects the switches', () => {
  const { state, ids } = stageWith('Рён');
  let { library, entry } = addName(emptyNames(), { name: 'Рён Хайтани', aliases: ['Рён'] });
  library = updateName(library, entry.id, { words: [
    { word: 'Рён', gen: 'Рёна', dat: 'Рёну', acc: 'Рёна', ins: 'Рёном', pre: 'Рёне' },
    { word: 'Хайтани', same: true },
  ] });
  assert.equal(buildNamesPrompt(library, state, { presentIds: [], text: '' }), '');
  const shown = buildNamesPrompt(library, state, { presentIds: ids, text: '' });
  assert.match(shown, /^\[NAMES\]\nРён Хайтани \(Рён\): Рён — род\. Рёна, дат\. Рёну, вин\. Рёна, тв\. Рёном, пр\. Рёне; Хайтани — не склоняется\nRules:/);
  assert.match(shown, /\[\/NAMES\]$/);
  assert.equal(buildNamesPrompt({ ...library, enabled: false }, state, { presentIds: ids }), '');
  assert.equal(buildNamesPrompt(updateName(library, entry.id, { off: true }), state, { presentIds: ids }), '');
  // A name with no forms yet still fixes the spelling.
  const plain = addName(emptyNames(), { name: 'Рён' }).library;
  assert.match(buildNamesPrompt(plain, state, { presentIds: ids }), /Рён: пишется именно так/);
});

test('the model answer is read tolerantly and only for the words that were asked', () => {
  const requested = new Map([['n1', new Set(['Рён', 'Хайтани'])]]);
  const answer = parseNameForms({ entries: [
    { id: 'n1', words: [{ word: 'Рён', same: false, gen: 'Рёна', dat: 'Рёну', acc: 'Рёна', ins: 'Рёном', pre: 'Рёне' }, { word: 'Хайтани', same: true, gen: 'х' }, { word: 'Чужой', gen: 'а' }] },
    { id: 'zzz', words: [{ word: 'Рён', gen: 'а' }] },
  ] }, requested);
  assert.deepEqual(Object.keys(answer), ['n1']);
  assert.deepEqual(answer.n1.Хайтани, { same: true, gen: '', dat: '', acc: '', ins: '', pre: '' });
  assert.equal(answer.n1.Рён.ins, 'Рёном');
  assert.equal(answer.n1.Чужой, undefined);
  // «declines» with no forms says nothing.
  assert.deepEqual(parseNameForms({ entries: [{ id: 'n1', words: [{ word: 'Рён', same: false }] }] }, requested), {});
});

test('fillNameForms asks only for empty words and survives a failed batch', async () => {
  const { library } = addName(emptyNames(), { name: 'Рён Хайтани' });
  const entry = library.entries[0];
  let calls = 0;
  const good = { generateRaw: async () => { calls += 1; return JSON.stringify({ entries: [{ id: entry.id, words: [{ word: 'Рён', gen: 'Рёна', dat: 'Рёну', acc: 'Рёна', ins: 'Рёном', pre: 'Рёне' }, { word: 'Хайтани', same: true }] }] }); } };
  const result = await fillNameForms(good, [entry]);
  assert.equal(result.asked, 1);
  assert.equal(result.patches[0].words.length, 2);
  assert.equal(calls, 1);
  const done = updateName(library, entry.id, { words: [{ word: 'Рён', same: true }, { word: 'Хайтани', same: true }] }).entries[0];
  assert.deepEqual(await fillNameForms(good, [done]), { patches: [], asked: 0, failed: 0 });
  assert.equal(calls, 1, 'nothing to fill: no request');
  const bad = { generateRaw: async () => 'не json' };
  const failed = await fillNameForms(bad, [entry]);
  assert.deepEqual([failed.patches.length, failed.failed], [0, 1]);
});

test('the block appears on the «what the model gets» list in its own place', () => {
  const text = '[NAMES]\nРён: Рён — род. Рёна\nRules:\n- Write these names exactly.\n[/NAMES]';
  const blocks = describeBlocks({ parts: { names: text }, tokens: { names: 30 }, enabled: { names: true } });
  const block = blocks.find(item => item.id === 'names');
  assert.equal(block.state, 'on');
  assert.deepEqual(block.tab, ['names', 'Имена']);
  const view = readable('names', text);
  assert.equal(view.sections[0].items[0].head, 'Рён');
  assert.match(view.rules, /Write these names/);
  const ids = blocks.map(item => item.id);
  assert.ok(ids.indexOf('names') < ids.indexOf('relationships'));
});

test('folders: make, rename, switch off with all their names, delete keeping the names', async () => {
  const { addNameFolder, updateNameFolder, removeNameFolder, changeNames, isSending } = await import('../src/core/name-library.js');
  let library = addNameFolder(emptyNames(), ' Токийские мстители ').library;
  const folder = library.folders[0];
  assert.equal(addNameFolder(library, 'токийские мстители').added, false, 'the same folder is not made twice');
  assert.throws(() => addNameFolder(library, ' '), /папку/i);
  library = addName(library, { name: 'Санзу', folderId: folder.id }).library;
  library = addName(library, { name: 'Майки', folderId: 'нет такой' }).library;
  assert.deepEqual(library.entries.map(entry => entry.folderId), [folder.id, ''], 'an unknown folder means no folder');
  const { state } = stageWith();
  const said = 'Санзу и Майки';
  assert.deepEqual(names(selectNames(library, state, { text: said })), ['Санзу', 'Майки']);
  library = updateNameFolder(library, folder.id, { off: true });
  assert.deepEqual(names(selectNames(library, state, { text: said })), ['Майки'], 'the folder is off: its names are not sent');
  assert.equal(isSending(library, library.entries[0]), false);
  library = updateNameFolder(library, folder.id, { name: 'ТМ', off: false });
  assert.equal(library.folders[0].name, 'ТМ');
  assert.throws(() => updateNameFolder(addNameFolder(library, 'Другая').library, folder.id, { name: 'другая' }), /уже есть/);
  // Several names at once: switch, move.
  const ids = library.entries.map(entry => entry.id);
  library = changeNames(library, ids, { off: true });
  assert.deepEqual(library.entries.map(entry => entry.off), [true, true]);
  library = changeNames(library, [ids[1]], { off: false, folderId: folder.id });
  assert.deepEqual(library.entries.map(entry => [entry.off, entry.folderId]), [[true, folder.id], [false, folder.id]]);
  library = changeNames(library, ids, { folderId: '' });
  assert.deepEqual(library.entries.map(entry => entry.folderId), ['', '']);
  // Deleting a folder keeps the names.
  library = changeNames(library, ids, { folderId: folder.id });
  library = removeNameFolder(library, folder.id);
  assert.equal(library.folders.some(item => item.id === folder.id), false);
  assert.deepEqual(library.entries.map(entry => entry.folderId), ['', '']);
  // A broken stored library: unknown folder ids are dropped.
  assert.equal(normalizeNames({ entries: [{ id: 'a', name: 'Рён', folderId: 'gone' }], folders: [{ id: 'f', name: 'F' }, { id: 'f', name: 'dup' }, { name: 'no id' }] }).entries[0].folderId, '');
});
