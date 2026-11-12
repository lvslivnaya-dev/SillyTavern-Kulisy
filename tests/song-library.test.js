/** The song library: noticing a song by a few quoted lines, by its name, pinning it in a chat, and the block for the narrator. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSong, addSongFolder, emptySongs, exportSongs, findSongs, importSongs, lyricsHit, muteSong, normalizeSongState, normalizeSongs, pinSong, planSongs,
  recentText, removeSongFolder, removeSongs, songWords, textGrams, unmuteSong, unpinSong, updateSong, updateSongFolder,
} from '../src/core/song-library.js';

const LYRICS = `[Куплет 1]
Ласточка моя, улетай за море
Там, где нет зимы, там, где нет печали

[Припев]
Ты не плачь, не плачь, моя ласточка
Ветер унесёт нас обеих домой`;

function library(extra = {}) {
  let lib = emptySongs();
  lib = addSong(lib, { title: 'Ласточка', artist: 'Кино', mood: 'Светлая грусть, как расставание на вокзале.', sound: 'Медленная гитара, тихий мужской голос.', lyrics: LYRICS, ...extra }).library;
  return lib;
}

test('words are compared without case, punctuation, «ё» and stretched letters', () => {
  assert.deepEqual(songWords('Ветер унесёт — нас, ОБЕИХ!'), ['ветер', 'унесет', 'нас', 'обеих']);
  assert.equal(songWords('Лаааасточка').join(' '), songWords('Ласточка').join(' '));
});

test('a few quoted lines are enough, and the last quoted line is known', () => {
  const lib = library();
  const text = 'Она тихо запела: «Там, где нет зимы, там, где нет печали...» и замолчала.';
  const found = findSongs(lib, text);
  assert.equal(found.length, 1);
  assert.equal(found[0].why, 'lyrics');
  assert.equal(found[0].hit.line, 1);
  assert.equal(found[0].hit.lines, 4);
  assert.match(found[0].hit.text, /Там, где нет зимы/);
});

test('words of a song far apart do not make a quote; fewer than minWords in a row do not either', () => {
  const lib = library();
  assert.equal(findSongs(lib, 'Ветер дул, но там уже не было печали и зимы.').length, 0);
  assert.equal(findSongs(lib, 'Ты не плачь.').length, 0);
  assert.equal(findSongs(lib, 'Ты не плачь', { minWords: 3 }).length, 1);
});

test('a chorus that stands twice goes on from the place before', () => {
  const lib = library({ lyrics: 'А я иду по крыше дома\nА ты стоишь внизу один\nА я иду по крыше дома\nА ты уже ушёл совсем' });
  const song = lib.songs[0];
  const grams = textGrams(songWords('А я иду по крыше дома А ты стоишь внизу один А я иду по крыше дома'), 4);
  assert.equal(lyricsHit(song, grams, 4).line, 2);
});

test('the title: two words as they stand, one word only in quotes or between ♪', () => {
  const lib = library({ title: 'Лунная ласточка', aliases: ['Ласточка'], lyrics: '' });
  assert.equal(findSongs(lib, 'играла лунная ласточка, потом другая').length, 1);
  assert.equal(findSongs(lib, 'в окно залетела ласточка').length, 0);
  assert.equal(findSongs(lib, 'она спела «Ласточка» до конца').length, 1);
  assert.equal(findSongs(lib, '♪ ласточка ♪').length, 1);
});

test('her own key words find the song as they stand', () => {
  const lib = library({ keys: 'песня про вокзал', lyrics: '' });
  assert.equal(findSongs(lib, 'Он напел песню про вокзал.').length, 0);
  assert.equal(findSongs(lib, 'Он напел песня про вокзал.').length, 1);
});

test('a switched-off song or folder is not noticed', () => {
  let lib = library();
  const text = 'Там, где нет зимы, там, где нет печали';
  assert.equal(findSongs(lib, text).length, 1);
  assert.equal(findSongs(updateSong(lib, lib.songs[0].id, { off: true }), text).length, 0);
  const folder = addSongFolder(lib, 'Любимое');
  lib = updateSong(folder.library, lib.songs[0].id, { folderId: folder.folder.id });
  assert.equal(findSongs(lib, text).length, 1);
  assert.equal(findSongs(updateSongFolder(lib, folder.folder.id, { off: true }), text).length, 0);
  assert.equal(removeSongFolder(lib, folder.folder.id).songs[0].folderId, '');
});

test('the same title by the same artist is not added twice, a cover by someone else is', () => {
  const lib = library();
  assert.throws(() => addSong(lib, { title: 'ласточка', artist: 'кино' }), /уже есть/);
  assert.equal(addSong(lib, { title: 'Ласточка', artist: 'Другая' }).library.songs.length, 2);
  assert.throws(() => addSong(lib, { title: '  ' }), /название/);
});

test('the chat pins a song and mutes false alarms', () => {
  const lib = library();
  const id = lib.songs[0].id;
  let state = pinSong({}, id, { mode: 'sung', singerId: 'anna' });
  assert.deepEqual(state.playing, [{ songId: id, mode: 'sung', singerId: 'anna' }]);
  state = pinSong(state, id, { mode: 'sound' });
  assert.deepEqual(state.playing, [{ songId: id, mode: 'sound', singerId: '' }]);
  state = muteSong(state, id);
  assert.deepEqual(state, { playing: [], muted: [id] });
  assert.deepEqual(unmuteSong(state, id).muted, []);
  assert.deepEqual(unpinSong(pinSong({}, id), id).playing, []);
  // Gone songs and gone people drop out.
  assert.deepEqual(normalizeSongState({ playing: [{ songId: 'x', mode: 'sound' }, { songId: id, mode: 'sung', singerId: 'ghost' }] }, { songIds: [id], entityIds: ['anna'] }).playing, [{ songId: id, mode: 'sung', singerId: '' }]);
});

test('the block: atmosphere, sound, the exact words and where the singing stopped', () => {
  const lib = library();
  const { block, report } = planSongs({ library: lib, text: 'Анна запела: Там, где нет зимы, там, где нет печали' });
  assert.match(block, /^\[SONGS — MUSIC IN THE SCENE\]/);
  assert.match(block, /## «Ласточка» — Кино/);
  assert.match(block, /Atmosphere: Светлая грусть/);
  assert.match(block, /Sound: Медленная гитара/);
  assert.match(block, /Ветер унесёт нас обеих домой/);
  assert.match(block, /Quoted so far: up to line 2 of 4, «Там, где нет зимы, там, где нет печали»/);
  assert.equal(report.sent, 1);
  assert.equal(report.entries[0].quoted, 2);
});

test('a pinned song goes out without a quote, with the name of the singer', () => {
  const lib = library();
  const id = lib.songs[0].id;
  const sung = planSongs({ library: lib, text: 'ничего', songState: pinSong({}, id, { mode: 'sung', singerId: 'anna' }), nameOf: item => (item === 'anna' ? 'Анна' : '') });
  assert.match(sung.block, /Now: Анна is singing this song\./);
  assert.doesNotMatch(sung.block, /Quoted so far/);
  const sound = planSongs({ library: lib, text: '', songState: pinSong({}, id) });
  assert.match(sound.block, /playing in the scene/);
});

test('a muted song is told about but not sent; nothing is sent when the library is off or empty', () => {
  const lib = library();
  const id = lib.songs[0].id;
  const text = 'Там, где нет зимы, там, где нет печали';
  const muted = planSongs({ library: lib, text, songState: muteSong({}, id) });
  assert.equal(muted.block, '');
  assert.deepEqual(muted.report.found, [{ songId: id, title: 'Ласточка', why: 'lyrics', muted: true }]);
  assert.equal(planSongs({ library: { ...lib, enabled: false }, text }).block, '');
  assert.equal(planSongs({ library: emptySongs(), text }).block, '');
});

test('a long text is cut to what fits and begins near the quoted line', () => {
  const stanza = i => `строка номер ${i} про дождь и снег и ветер`;
  const lyrics = Array.from({ length: 60 }, (_, i) => stanza(i)).join('\n');
  const lib = library({ lyrics });
  const { block, report } = planSongs({ library: lib, text: `${stanza(40)}\n${stanza(41)}`, maxCharacters: 700 });
  assert.ok(report.entries[0].characters <= 700);
  assert.match(block, /строка номер 41/);
  assert.doesNotMatch(block, /строка номер 3 /);
  assert.equal(report.entries[0].trimmed, true);
});

test('only the last posts are looked at', () => {
  const chat = [{ mes: 'первый' }, { mes: 'системный', is_system: true }, { mes: 'второй' }, { mes: 'третий' }];
  assert.equal(recentText(chat, 2), 'второй\n\nтретий');
});

test('settings are kept inside their limits, junk is dropped, the library survives export and import', () => {
  const lib = normalizeSongs({ minWords: 99, lookback: 0, maxCharacters: 'many', songs: [{ title: 'Песня', lyrics: 'раз два три четыре' }, { title: '' }, null] });
  assert.equal(lib.minWords, 8);
  assert.equal(lib.lookback, 1);
  assert.equal(lib.maxCharacters, 5000);
  assert.equal(lib.songs.length, 1);
  const folder = addSongFolder(library(), 'Мои');
  const filled = updateSong(folder.library, folder.library.songs[0].id, { folderId: folder.folder.id });
  const copy = importSongs(emptySongs(), JSON.parse(JSON.stringify(exportSongs(filled))));
  assert.equal(copy.added, 1);
  assert.equal(copy.library.folders[0].name, 'Мои');
  assert.equal(copy.library.songs[0].folderId, copy.library.folders[0].id);
  assert.equal(importSongs(copy.library, exportSongs(filled)).skipped, 1);
  assert.throws(() => importSongs(emptySongs(), { kind: 'other' }), /не файл песен/);
  assert.equal(removeSongs(filled, [filled.songs[0].id]).songs.length, 0);
});
