import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESCUE_FOLDER_NAME, addFolder, addLocation, duplicateLocation, emptyLibrary, folderContents, folderPath,
  normalizeLibrary, removeFolder, removeLocation, searchLocations, updateFolder, updateLocation,
} from '../src/core/index.js';

function shelf() {
  let library = emptyLibrary();
  const tr = addFolder(library, { name: 'Токийские мстители' });
  const city = addFolder(tr.library, { name: 'Роппонги', parentId: tr.folder.id });
  const bar = addLocation(city.library, { folderId: city.folder.id, name: 'Бар «Хаос»', traits: ['камин', 'камин', 'скрипучая лестница'], description: 'Тесный бар.\n\n\n\nНа втором этаже — офис.' });
  library = bar.library;
  return { library, tr: tr.folder, city: city.folder, bar: bar.location };
}

test('a place cannot exist in the library without a folder', () => {
  assert.throws(() => addLocation(emptyLibrary(), { name: 'Бар' }), /Сначала выберите папку/);
  assert.throws(() => addLocation(emptyLibrary(), { name: 'Бар', folderId: 'nope' }), /Сначала выберите папку/);
  const { library, bar } = shelf();
  assert.throws(() => updateLocation(library, bar.id, { folderId: '' }), /Сначала выберите папку/);
});

test('folders nest like a gallery and show their own contents', () => {
  const { library, tr, city, bar } = shelf();
  assert.deepEqual(folderContents(library).folders.map(folder => folder.id), [tr.id]);
  assert.deepEqual(folderContents(library).locations, [], 'nothing lies loose at the top');
  assert.deepEqual(folderContents(library, city.id).locations.map(location => location.id), [bar.id]);
  assert.deepEqual(folderPath(library, city.id).map(step => step.name), ['Токийские мстители', 'Роппонги']);
  assert.throws(() => updateFolder(library, tr.id, { parentId: city.id }), /внутрь неё самой/);
  assert.equal(updateFolder(library, city.id, { name: 'Сибуя' }).folders.find(folder => folder.id === city.id).name, 'Сибуя');
});

test('places are edited, duplicated, moved and removed; inputs are never mutated', () => {
  const { library, tr, bar } = shelf();
  const before = JSON.stringify(library);
  assert.deepEqual(bar.traits, ['камин', 'скрипучая лестница']);
  assert.equal(bar.description, 'Тесный бар.\n\nНа втором этаже — офис.');
  const copy = duplicateLocation(library, bar.id);
  assert.equal(copy.location.name, 'Бар «Хаос» (копия)');
  let next = updateLocation(copy.library, copy.location.id, { name: 'Офис над баром', parentId: bar.id, folderId: tr.id });
  assert.throws(() => updateLocation(next, bar.id, { parentId: copy.location.id }), /внутри самого себя/);
  next = removeLocation(next, bar.id);
  assert.equal(next.locations[0].parentId, undefined, 'the office loses its parent with the bar');
  assert.equal(JSON.stringify(library), before);
});

test('a folder with something inside is removed only on purpose, and reports what went', () => {
  const { library, tr, bar } = shelf();
  assert.throws(() => removeFolder(library, tr.id), /не пуста/);
  const { library: next, removedLocationIds } = removeFolder(library, tr.id, { withContents: true });
  assert.deepEqual(removedLocationIds, [bar.id]);
  assert.deepEqual(next, emptyLibrary());
});

test('search looks at names, aliases, descriptions and traits', () => {
  const { library, bar } = shelf();
  const withAlias = updateLocation(library, bar.id, { aliases: ['Хаос'] });
  assert.deepEqual(searchLocations(withAlias, 'ЛЕСТНИЦ').map(location => location.id), [bar.id]);
  assert.deepEqual(searchLocations(withAlias, 'офис').map(location => location.id), [bar.id]);
  assert.deepEqual(searchLocations(withAlias, '   '), []);
});

test('a broken library is repaired: orphans are rescued into a folder, loops are broken', () => {
  const repaired = normalizeLibrary({
    folders: [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }, { id: 'x', name: '' }],
    locations: [
      { id: 'p1', folderId: 'gone', name: 'Сирота' },
      { id: 'p2', folderId: 'a', name: 'Петля', parentId: 'p3' },
      { id: 'p3', folderId: 'a', name: 'Петля 2', parentId: 'p2' },
      { id: 'p2', folderId: 'a', name: 'Дубль' },
      { folderId: 'a', name: 'Без ID' },
    ],
  });
  assert.equal(repaired.folders.filter(folder => folder.parentId).length, 1, 'one link of the loop is kept, one is cut');
  const rescue = repaired.folders.find(folder => folder.name === RESCUE_FOLDER_NAME);
  assert.ok(rescue);
  assert.equal(repaired.locations.find(location => location.id === 'p1').folderId, rescue.id);
  assert.equal(repaired.locations.length, 3);
  assert.equal(repaired.locations.filter(location => location.parentId).length, 1);
  assert.deepEqual(normalizeLibrary(null), emptyLibrary());
});
