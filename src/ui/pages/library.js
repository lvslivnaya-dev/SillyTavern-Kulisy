import { button, characterId, characterName, downloadJson, element } from '../helpers.js';
import { icon } from '../icons.js';
import { CARD_SECTION_KINDS, CARD_WHEN, KEY_REGEX_MODES, WARDROBE_CATEGORIES, cardLabel, folderPath, personalPieces, folderWithDescendants, keyFromRegex, keyToRegex, makeSection, searchLibraryCharacters, searchLibraryItems, searchLocations, splitKeys } from '../../core/index.js';
import { GATE_SECTIONS, GATE_WHEN } from '../../integration/lore-gate.js';
import { fileToDataUrl, imageUrl } from '../../integration/wardrobe-images.js';
import { access, canRememberFolder, pickFolder, readNotes, recallFolder, rememberFolder } from '../notes-folder.js';

/**
 * The library as a gallery, like the wardrobe: folders on the left, pictures on the
 * right, a card over the window for editing (with «Описать по картинке» — the same
 * picture model as the wardrobe). Two shelves share the folders: places and things;
 * each shelf remembers its open folder, search and card. A third shelf, the character cards, shares the same
 * folders; its card over the window is a sheet of sections (see renderCardEditor).
 */
export function createLibraryPages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const act = (...args) => ctx.act(...args);

  const snapshot = () => ctx.snapshot;
  const library = () => snapshot().locationLibrary ?? { folders: [], locations: [], items: [], characters: [] };
  const IMPORTANCE_RU = { normal: 'обычная', important: 'важная', key: 'ключевая' };
  const KINDS = {
    places: { add: '+ Локация', one: 'локация', many: 'Локации', placeholder: 'Новая локация', icon: 'pin' },
    items: { add: '+ Вещь', one: 'вещь', many: 'Вещи', placeholder: 'Новая вещь', icon: 'bag' },
    characters: { add: '+ Карточка', one: 'карточка', many: 'Карточки', placeholder: 'Новый персонаж', icon: 'card' },
  };
  const ROOT_LIMIT = 120;

  const fresh = () => ({ creating: false, newName: '', newFolder: '', newFolderName: '', focusedId: '', folderId: '', query: '', openId: '', importMode: '', lorebook: { book: '', entries: [], picked: new Set() }, renaming: false, draft: null, askReplace: false, showAll: false, selecting: false, picked: new Set(), moveTo: '' });
  const shelves = { places: fresh(), items: fresh(), characters: fresh() };
  let kind = 'places';
  let s = shelves.places;
  let describeOnUpload = false;

  const things = () => kind === 'items';
  const cards = () => kind === 'characters';
  /** What the link callbacks need to know about the shelf: places are the default, the others say who they are. */
  const shelfArg = () => (kind === 'places' ? {} : { kind });
  const entriesOf = () => (cards() ? library().characters ?? [] : things() ? library().items ?? [] : library().locations);
  const linkedSet = () => new Set((cards() ? snapshot().linkedCharacterIds : things() ? snapshot().linkedItemIds : snapshot().linkedLocationIds) ?? []);
  const pathText = id => folderPath(library(), id).map(step => step.name).join(' › ');

  /** Run an action; a synchronous error lands in the status line too. */
  async function attempt(work, done) {
    try {
      const result = await work();
      if (done) setStatus(typeof done === 'function' ? done(result) : done);
      return result;
    } catch (error) {
      setStatus(error?.message || String(error), true);
      return undefined;
    } finally {
      render();
    }
  }

  function toggle(checked, label, onChange) {
    const input = element('input', { type: 'checkbox', className: 'ku-switch', checked: Boolean(checked), 'aria-label': label, title: label });
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function iconButton(name, label, onClick) {
    const node = element('button', { type: 'button', className: 'ku-ib', 'aria-label': label, title: label }, [icon(name)]);
    node.addEventListener('click', onClick);
    return node;
  }

  /** A button that opens a hidden file input (a styled «Выбрать файлы» that always reacts). */
  function filePicker(label, { accept = 'image/*', multiple = true, directory = false, className = 'btn small', disabled = false, title = '', onFiles }) {
    const input = element('input', { type: 'file', accept, multiple, hidden: true, 'aria-label': label });
    if (directory) input.setAttribute('webkitdirectory', '');
    input.addEventListener('change', () => { const files = [...(input.files ?? [])]; input.value = ''; if (files.length) onFiles(files); });
    const trigger = button(label, className, () => input.click());
    if (title) trigger.title = title;
    trigger.disabled = disabled;
    return element('span', { className: 'ku-filepick' }, [trigger, input]);
  }

  /** New entries from pictures, in the open folder. */
  async function addPictures(files) {
    if (!s.folderId) { setStatus('Сначала откройте папку слева: туда лягут картинки.', true); return; }
    const images = files.filter(file => /^image\//.test(file.type)).slice(0, 30);
    if (!images.length) { setStatus('Это не картинки.', true); return; }
    let added = 0;
    for (const file of images) {
      try {
        const imageDataUrl = await fileToDataUrl(file);
        setStatus(`Сохраняю картинку ${added + 1} из ${images.length}…`);
        await invoke('onLibraryAddFromImage', { kind, folderId: s.folderId, imageDataUrl, describe: describeOnUpload });
        added += 1;
      } catch (error) {
        setStatus(error?.message || 'Картинка не добавилась', true);
      }
    }
    if (added) setStatus(`Добавлено: ${added}${describeOnUpload ? '' : '. Описание — в карточке, кнопкой «Описать по картинке»'}`);
    render();
  }

  // ---- The page ------------------------------------------------------------------

  /** The library of `shelf` ('places' | 'items'). */
  function renderLibrary(shelf = 'places') {
    kind = shelf === 'items' ? 'items' : shelf === 'characters' ? 'characters' : 'places';
    s = shelves[kind];
    const lib = library();
    if (s.folderId && !lib.folders.some(folder => folder.id === s.folderId)) { s.folderId = ''; s.renaming = false; }
    if (s.openId && !entriesOf().some(entry => entry.id === s.openId)) { s.openId = ''; s.draft = null; }
    const view = element('div', { className: 'ku-library ku-lib' });

    const search = element('input', { type: 'search', value: s.query, placeholder: 'Поиск', 'aria-label': cards() ? 'Поиск карточки' : things() ? 'Поиск вещи' : 'Поиск локации', className: 'ku-search' });
    search.addEventListener('change', () => { s.query = search.value; render(); });
    const needFolder = s.folderId ? '' : 'Сначала откройте папку слева';
    // A card is made on a small form: its name and its folder (an existing one or a new one), so it works with no folder open too.
    const addEmpty = cards() ? button(KINDS[kind].add, 'btn primary small', () => { s.creating = !s.creating; render(); }, 'Ввести карточку вручную: имя, папка, потом разделы') : button(KINDS[kind].add, 'btn small', () => attempt(async () => {
      const entry = cards()
        ? await invoke('onLibraryAddCharacter', { folderId: s.folderId, name: KINDS[kind].placeholder })
        : things()
          ? await invoke('onLibraryAddItem', { folderId: s.folderId, name: KINDS[kind].placeholder })
          : await invoke('onLibraryAddLocation', { folderId: s.folderId, name: KINDS[kind].placeholder });
      if (entry) { s.openId = entry.id; s.draft = null; }
    }));
    if (!cards()) {
      addEmpty.title = needFolder || 'Без картинки: описание можно написать самой';
      addEmpty.disabled = !s.folderId;
    }
    const importMenu = element('select', { 'aria-label': 'Импорт' }, [
      element('option', { value: '', text: 'Импорт…' }),
      element('option', { value: 'lorebook', text: cards() ? 'Из лорбука (анкеты «[ Имя ] - Раздел»)' : 'Из лорбука' }),
      element('option', { value: 'markdown', text: cards() ? 'Из папки анкет (Obsidian / Markdown)' : 'Из папки заметок (Obsidian / Markdown)' }),
      element('option', { value: 'json', text: 'Из файла Кулис (.json)' }),
    ]);
    importMenu.value = s.importMode;
    importMenu.addEventListener('change', () => { s.importMode = importMenu.value; render(); });
    const exportButton = button('Экспорт', 'btn small', () => {
      try {
        const text = invoke('onLibraryExport', { folderId: s.folderId });
        downloadJson(JSON.parse(text), s.folderId ? `kulisy-library-${folderPath(lib, s.folderId).at(-1)?.name ?? 'folder'}.json` : 'kulisy-library.json');
      } catch (error) { setStatus(error?.message || 'Не удалось выгрузить', true); }
    }, s.folderId ? 'Выгрузить эту папку (локации, вещи и карточки)' : 'Выгрузить всю библиотеку (локации, вещи и карточки)');
    const auto = element('input', { type: 'checkbox', className: 'ku-switch', checked: describeOnUpload, 'aria-label': 'Описывать картинки сразу' });
    auto.addEventListener('change', () => { describeOnUpload = auto.checked; });
    view.append(element('div', { className: 'ku-row ku-wtools' }, [
      search,
      filePicker('+ Картинки', { className: 'btn primary small', disabled: !s.folderId, title: needFolder || (cards() ? 'Каждая картинка — новая карточка с этим портретом' : ''), onFiles: addPictures }),
      addEmpty,
      button(s.selecting ? 'Готово' : 'Выбрать', s.selecting ? 'btn primary small' : 'btn small', () => { s.selecting = !s.selecting; s.picked.clear(); render(); }, `Отметить несколько: ${cards() ? 'карточки' : things() ? 'вещи' : 'локации'}, чтобы перенести их в другую папку, перевести на английский или удалить`),
      importMenu,
      exportButton,
      ...(cards() ? [] : [element('label', { className: 'ku-inline ku-small', title: 'Сразу просить модель описать новые картинки (тратит запрос на каждую)' }, [auto, 'описывать сразу'])]),
    ]));
    if (cards() && s.creating) view.append(renderNewCard());
    if (s.importMode) view.append(renderImport());

    const body = element('div', { className: 'ku-wbody' });
    body.append(renderFolders(), renderGallery());
    view.append(body);
    const opened = entriesOf().find(entry => entry.id === s.openId);
    if (opened) view.append(renderEditor(opened));
    else s.focusedId = '';
    return view;
  }

  /** The form of a new card: a name and a folder. The card opens at once to be filled in. */
  function renderNewCard() {
    const lib = library();
    const box = element('div', { className: 'card ku-import ku-newcard' });
    if (!s.newFolder) s.newFolder = s.folderId || (lib.folders[0]?.id ?? '__new');
    const name = element('input', { type: 'text', value: s.newName, 'aria-label': 'Имя персонажа', placeholder: 'Как зовут: Сано Манджиро' });
    name.addEventListener('input', () => { s.newName = name.value; });
    const folder = element('select', { 'aria-label': 'Папка новой карточки' }, [
      ...lib.folders.map(item => element('option', { value: item.id, text: pathText(item.id), selected: item.id === s.newFolder })),
      element('option', { value: '__new', text: '＋ Новая папка…', selected: s.newFolder === '__new' }),
    ]);
    folder.addEventListener('change', () => { s.newFolder = folder.value; render(); });
    const folderName = element('input', { type: 'text', value: s.newFolderName, 'aria-label': 'Название новой папки', placeholder: 'Например, фандом: Токийские мстители' });
    folderName.addEventListener('input', () => { s.newFolderName = folderName.value; });
    const create = () => attempt(async () => {
      let folderId = s.newFolder;
      if (folderId === '__new') {
        const made = await invoke('onLibraryAddFolder', { name: s.newFolderName, parentId: '' });
        folderId = made.id;
      }
      const entry = await invoke('onLibraryAddCharacter', { folderId, name: s.newName });
      s.folderId = folderId;
      s.creating = false; s.newName = ''; s.newFolderName = '';
      if (entry) { s.openId = entry.id; s.draft = null; s.selSection = ''; }
    });
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); create(); } });
    box.append(
      element('h3', { text: 'Новая карточка' }),
      element('p', { className: 'muted ku-small', text: 'Карточка получит разделы анкеты (основа, внешность, голос…), заполнишь их в следующем окне. В одной папке два персонажа с одним именем не помещаются, в разных папках можно.' }),
      element('div', { className: 'field' }, [element('label', { text: 'Имя' }), name]),
      element('div', { className: 'field' }, [element('label', { text: 'Папка' }), folder]),
      ...(s.newFolder === '__new' ? [element('div', { className: 'field' }, [element('label', { text: 'Название новой папки' }), folderName])] : []),
      element('div', { className: 'ku-row' }, [button('Создать и открыть', 'btn primary small', create), button('Отмена', 'btn small', () => { s.creating = false; render(); })]),
    );
    if (!s.newName) setTimeout(() => { if (name.isConnected) name.focus({ preventScroll: true }); }, 0);
    return box;
  }

  /** Folders as a tree on the left; the new-folder field goes into the open one. */
  function renderFolders() {
    const lib = library();
    const nav = element('nav', { className: 'ku-wsec ku-lsec', 'aria-label': 'Папки' });
    const all = entriesOf();
    const count = folderId => { const ids = folderWithDescendants(lib, folderId); return all.filter(entry => ids.has(entry.folderId)).length; };
    const root = element('button', { type: 'button', className: `ku-wsb ku-lroot${!s.folderId ? ' on' : ''}`, 'aria-current': !s.folderId ? 'true' : null }, [element('span', { text: 'Вся библиотека' }), element('i', { text: String(all.length) })]);
    root.addEventListener('click', () => { s.folderId = ''; s.renaming = false; render(); });
    nav.append(root);
    const walk = (parentId, depth) => {
      for (const folder of lib.folders.filter(item => (item.parentId ?? '') === parentId)) {
        const on = s.folderId === folder.id;
        const node = element('button', { type: 'button', className: `ku-wsb ku-folder${on ? ' on' : ''}`, 'aria-current': on ? 'true' : null, style: { paddingLeft: `${10 + depth * 14}px` } },
          [element('span', { className: 'ku-fname' }, [icon('folder'), element('span', { text: folder.name })]), element('i', { text: String(count(folder.id)) })]);
        node.addEventListener('click', () => { s.folderId = folder.id; s.renaming = false; s.query = ''; render(); });
        nav.append(node);
        if (depth < 6) walk(folder.id, depth + 1);
      }
    };
    walk('', 0);
    const name = element('input', { type: 'text', placeholder: s.folderId ? 'Подпапка…' : 'Новая папка…', 'aria-label': 'Название новой папки' });
    const add = () => attempt(async () => {
      const folder = await invoke('onLibraryAddFolder', { name: name.value, parentId: s.folderId });
      if (folder?.id) s.folderId = folder.id;
    }, 'Папка создана');
    name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); add(); } });
    nav.append(element('div', { className: 'ku-lnew' }, [name, button('+ Папка', 'btn small', add, s.folderId ? 'Создать внутри открытой папки' : 'Создать папку верхнего уровня')]));
    return nav;
  }

  /** The bar of the choosing mode: how many cards are ticked, what to do with them. `list` is what the gallery shows now. */
  function renderPickBar(list) {
    const lib = library();
    const ids = new Set(entriesOf().map(entry => entry.id));
    for (const id of [...s.picked]) if (!ids.has(id)) s.picked.delete(id);
    const folder = element('select', { 'aria-label': 'Папка, куда перенести' }, [
      element('option', { value: '', text: 'Перенести в папку…' }),
      ...lib.folders.map(item => element('option', { value: item.id, text: pathText(item.id), selected: item.id === s.moveTo })),
    ]);
    folder.addEventListener('change', () => { s.moveTo = folder.value; render(); });
    const move = Object.assign(button('Перенести', 'btn small', () => attempt(async () => {
      const result = await invoke('onLibraryMoveEntries', { kind, ids: [...s.picked], folderId: s.moveTo });
      if (!result.skipped.length) s.picked.clear();
      else { s.picked = new Set(result.skipped.map(item => item.id)); throw new Error(`Перенесено: ${result.moved.length}. Остались на месте (имя занято в той папке): ${result.skipped.map(item => item.name).join(', ')}`); }
      return result;
    }, result => `Перенесено: ${result?.moved?.length ?? 0}`)), { disabled: !s.picked.size || !s.moveTo });
    const remove = Object.assign(button('Удалить', 'btn small danger', () => attempt(async () => {
      const removed = await invoke('onLibraryRemoveEntries', { kind, ids: [...s.picked] });
      if (removed) s.picked.clear();
      return removed;
    }, removed => (removed ? `Удалено: ${removed}` : ''))), { disabled: !s.picked.size });
    const translate = Object.assign(button('Перевести на английский', 'btn small', () => attempt(async () => {
      const result = await invoke('onLibraryTranslateEntries', { kind, ids: [...s.picked] });
      if (result?.done?.length) s.picked.clear();
      return result;
    }, result => (result?.done?.length ? `Переведено: ${result.done.length}` : 'Переводить нечего: уже на английском или нет текста'))), { disabled: !s.picked.size });
    translate.title = 'Каждую отмеченную переведёт модель: описание и черты (у карточек разделы); русский текст заменится переводом';
    return element('div', { className: 'ku-pickbar' }, [
      element('strong', { className: 'ku-small', text: `Выбрано: ${s.picked.size}` }),
      button('Все в списке', 'btn small', () => { for (const entry of list) s.picked.add(entry.id); render(); }, 'Отметить все карточки, которые сейчас на экране (открытая папка с подпапками или результат поиска)'),
      button('Снять всё', 'btn small', () => { s.picked.clear(); render(); }),
      element('span', { className: 'ku-push' }),
      translate, folder, move, remove,
    ]);
  }

  function renderGallery() {
    const lib = library();
    const gallery = element('div', { className: 'ku-wgal' });
    const linked = linkedSet();
    const query = s.query.trim();
    let list;
    if (query) {
      list = cards() ? searchLibraryCharacters(lib, query) : things() ? searchLibraryItems(lib, query) : searchLocations(lib, query);
      gallery.append(element('div', { className: 'ku-row' }, [
        element('h3', { className: 'ku-ltitle', text: `Найдено · ${list.length}` }),
        button('Сбросить поиск', 'btn small', () => { s.query = ''; render(); }),
      ]));
    } else if (s.folderId) {
      const ids = folderWithDescendants(lib, s.folderId);
      list = entriesOf().filter(entry => ids.has(entry.folderId));
      const on = list.filter(entry => linked.has(entry.id)).length;
      gallery.append(element('div', { className: 'ku-row ku-lhead' }, [
        ...renderFolderTitle(),
        element('span', { className: 'muted ku-small', text: `${on} из ${list.length} в этом чате` }),
        element('span', { className: 'ku-push' }),
        button('Включить все', 'btn small', () => attempt(() => act('onLibraryLink', { folderId: s.folderId, on: true, kind }, 'library-link'), result => `Включено: ${result ?? 0}`)),
        button('Выключить все', 'btn small', () => attempt(() => act('onLibraryLink', { folderId: s.folderId, on: false, kind }, 'library-link'))),
      ]));
    } else {
      list = entriesOf();
      gallery.append(element('div', { className: 'ku-row ku-lhead' }, [
        element('h3', { className: 'ku-ltitle', text: 'Вся библиотека' }),
        element('span', { className: 'muted ku-small', text: lib.folders.length ? 'Откройте папку слева — туда лягут новые картинки и записи.' : '' }),
      ]));
    }
    const shown = !query && !s.folderId && !s.showAll ? list.slice(0, ROOT_LIMIT) : list;
    const grid = element('div', { className: `ku-tiles ku-ltiles ${kind}` }, shown.map(entry => tile(entry, linked)));
    if (s.folderId && !query) {
      grid.append(filePicker('Перетащите картинки сюда или нажмите', { className: 'ku-tile ku-drop', onFiles: addPictures }));
      grid.addEventListener('dragover', event => { event.preventDefault(); grid.classList.add('over'); });
      grid.addEventListener('dragleave', () => grid.classList.remove('over'));
      grid.addEventListener('drop', event => { event.preventDefault(); grid.classList.remove('over'); addPictures([...(event.dataTransfer?.files ?? [])]); });
    }
    if (s.selecting) gallery.append(renderPickBar(list));
    gallery.append(grid);
    if (shown.length < list.length) gallery.append(button(`Показать все (${list.length})`, 'btn small', () => { s.showAll = true; render(); }));
    if (!list.length && !s.folderId && !query) {
      gallery.append(element('div', { className: 'empty', text: lib.folders.length
        ? `${KINDS[kind].many} пока нет. Откройте папку слева и добавьте картинки или «${KINDS[kind].add}».`
        : `Библиотека пуста. Создайте папку слева (например, по фандому), потом добавьте в неё картинки — или импортируйте. Папки общие у локаций, вещей и карточек.` }));
    } else if (!list.length && query) {
      gallery.append(element('div', { className: 'empty', text: 'Ничего не найдено.' }));
    }
    return gallery;
  }

  /** The open folder's name with rename / delete. */
  function renderFolderTitle() {
    const folder = library().folders.find(item => item.id === s.folderId);
    if (!folder) return [];
    if (s.renaming) {
      const input = element('input', { type: 'text', value: folder.name, 'aria-label': 'Новое название папки' });
      const save = () => { s.renaming = false; attempt(() => invoke('onLibraryUpdateFolder', { folderId: s.folderId, changes: { name: input.value } }), 'Папка переименована'); };
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); save(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); s.renaming = false; render(); }
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
      return [element('span', { className: 'ku-rename' }, [input, button('Сохранить', 'btn primary small', save), button('Отмена', 'btn small', () => { s.renaming = false; render(); })])];
    }
    return [
      element('h3', { className: 'ku-ltitle', text: pathText(folder.id) }),
      iconButton('edit', 'Переименовать папку', () => { s.renaming = true; render(); }),
      iconButton('close', 'Удалить папку', async () => {
        const removed = await attempt(() => invoke('onLibraryRemoveFolder', { folderId: s.folderId }));
        if (removed) { s.folderId = folder.parentId ?? ''; render(); }
      }),
    ];
  }

  function cover(entry) {
    return element('span', { className: 'ku-pic ku-nopic', 'aria-hidden': 'true' }, [icon(KINDS[kind].icon), element('span', { className: 'ku-letter', text: entry.name.slice(0, 1) })]);
  }

  function picture(entry) {
    if (!entry.image) return cover(entry);
    const img = element('img', { className: 'ku-pic', src: imageUrl(entry.image), alt: '', loading: 'lazy', draggable: false });
    // A picture from another computer's library (an imported file) is not on this server.
    img.addEventListener('error', () => img.replaceWith(cover(entry)), { once: true });
    return img;
  }

  function tile(entry, linked) {
    const on = linked.has(entry.id);
    const card = element('div', { className: `ku-place-card ku-ltile${s.openId === entry.id ? ' on' : ''}` });
    const sub = cards()
      ? `${(entry.sections ?? []).filter(section => section.text.trim()).length} из ${(entry.sections ?? []).length} разделов заполнено${entry.lang === 'en' ? ' · English' : ''}`
      : things()
        ? (entry.ownerName ? `обычно у: ${entry.ownerName}` : 'без хозяина')
        : (entry.parentId ? `в ${library().locations.find(item => item.id === entry.parentId)?.name ?? '…'}` : (entry.traits[0] ?? 'без места выше'));
    const open = element('button', { type: 'button', className: 'ku-place-open', 'aria-label': `${entry.name} — открыть` }, [
      picture(entry),
      element('span', { className: 'ku-ltext' }, [
        element('strong', { text: entry.name }),
        element('span', { className: 'muted ku-small', text: sub }),
        ...(things() && entry.importance !== 'normal' ? [element('span', { className: 'ku-chip told', text: IMPORTANCE_RU[entry.importance] })] : []),
        ...(cards() && entry.source?.stale ? [element('span', { className: 'ku-chip ku-stale', text: 'изменилась в Obsidian' })] : []),
        ...(!cards() && entry.lang === 'en' ? [element('span', { className: 'ku-chip told', text: 'English' })] : []),
      ]),
    ]);
    if (on) open.append(element('span', { className: 'ku-worn', text: 'в чате' }));
    if (s.selecting) {
      const mark = element('input', { type: 'checkbox', className: 'ku-pickbox', checked: s.picked.has(entry.id), 'aria-label': `Выбрать ${entry.name}`, tabindex: '-1' });
      open.prepend(mark);
      card.classList.toggle('picked', s.picked.has(entry.id));
      open.addEventListener('click', () => { if (s.picked.has(entry.id)) s.picked.delete(entry.id); else s.picked.add(entry.id); render(); });
    } else open.addEventListener('click', () => { s.openId = entry.id; s.draft = null; s.askReplace = false; render(); });
    card.append(open, element('label', { className: 'ku-inline ku-small' }, [
      toggle(on, `${entry.name} в этом чате`, value => attempt(() => act('onLibraryLink', { libraryIds: [entry.id], on: value, ...shelfArg() }, 'library-link'))),
      on ? 'в этом чате' : 'выключена',
    ]));
    return card;
  }

  // ---- The card over the window ------------------------------------------------

  function renderEditor(entry) {
    if (cards()) return renderCardEditor(entry);
    const lib = library();
    const isThing = things();
    const layer = element('div', { className: 'ku-wlayer' });
    const close = () => { s.openId = ''; s.draft = null; s.askReplace = false; render(); };
    layer.addEventListener('click', event => { if (event.target === layer) close(); });
    const dialog = element('section', { className: 'ku-wcard', role: 'dialog', 'aria-modal': 'true', 'aria-label': entry.name });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
    // Neighbours in the same folder, for ‹ ›.
    const siblings = entriesOf().filter(item => item.folderId === entry.folderId);
    const index = siblings.findIndex(item => item.id === entry.id);
    const go = step => { const next = siblings[index + step]; if (next) { s.openId = next.id; s.draft = null; s.askReplace = false; render(); } };

    const view = element('div', { className: `ku-wview ${kind}` }, [
      entry.image ? element('img', { src: imageUrl(entry.image), alt: entry.name }) : element('span', { className: 'ku-nopic big', 'aria-hidden': 'true' }, [icon(KINDS[kind].icon), element('span', { text: 'Нет картинки' })]),
      element('div', { className: 'ku-wview-tools' }, [
        filePicker(entry.image ? 'Заменить' : 'Добавить картинку', { multiple: false, onFiles: async files => {
          await attempt(async () => invoke('onLibrarySetImage', { kind, id: entry.id, imageDataUrl: await fileToDataUrl(files[0]) }), 'Картинка сохранена');
        } }),
        ...(entry.image ? [button('Убрать картинку', 'btn small', () => attempt(() => invoke('onLibraryRemoveImage', { kind, id: entry.id }), 'Картинка убрана'))] : []),
        element('span', { className: 'ku-push' }),
        Object.assign(button('‹', 'btn small', () => go(-1), 'Предыдущая'), { disabled: index <= 0 }),
        Object.assign(button('›', 'btn small', () => go(1), 'Следующая'), { disabled: index < 0 || index >= siblings.length - 1 }),
      ]),
    ]);

    // What the user typed survives any redraw until it is saved or the card is closed.
    const draft = s.draft?.id === entry.id ? s.draft.fields : {};
    const value = (key, fallback) => (draft[key] ?? fallback);
    const controls = {
      name: element('input', { type: 'text', value: value('name', entry.name), 'aria-label': 'Название' }),
      folderId: element('select', { 'aria-label': 'Папка' }, lib.folders.map(item => element('option', { value: item.id, text: pathText(item.id), selected: item.id === value('folderId', entry.folderId) }))),
      aliases: element('input', { type: 'text', value: value('aliases', entry.aliases.join(', ')), 'aria-label': 'Другие названия', placeholder: isThing ? 'через запятую: так летописец её узнает' : 'через запятую' }),
      description: element('textarea', { rows: 6, value: value('description', entry.description), 'aria-label': 'Описание', placeholder: isThing ? 'как выглядит, чем особенная — уходит рассказчику, когда вещь в сцене' : 'как выглядит место: можно написать самой или попросить модель по картинке' }),
    };
    if (isThing) {
      controls.ownerName = element('input', { type: 'text', value: value('ownerName', entry.ownerName ?? ''), 'aria-label': 'Обычно у кого', placeholder: 'имя персонажа: в чате вещь сразу окажется у него' });
      controls.importance = element('select', { 'aria-label': 'Важность' }, Object.entries(IMPORTANCE_RU).map(([key, text]) => element('option', { value: key, text, selected: value('importance', entry.importance) === key })));
    } else {
      controls.parentId = element('select', { 'aria-label': 'Находится в' }, [
        element('option', { value: '', text: '— нигде (отдельное место) —' }),
        ...lib.locations.filter(item => item.id !== entry.id).map(item => element('option', { value: item.id, text: item.name, selected: item.id === value('parentId', entry.parentId ?? '') })),
      ]);
      controls.traits = element('textarea', { rows: 3, value: value('traits', entry.traits.join('\n')), 'aria-label': 'Черты', placeholder: 'по одной на строку: камин, скрипучая лестница…' });
    }
    const read = () => Object.fromEntries(Object.entries(controls).map(([key, node]) => [key, node.value]));
    for (const node of Object.values(controls)) {
      node.addEventListener('input', () => { s.draft = { id: entry.id, fields: read() }; });
      node.addEventListener('change', () => { s.draft = { id: entry.id, fields: read() }; });
    }
    const changes = () => {
      const fields = read();
      const common = { name: fields.name, folderId: fields.folderId, aliases: fields.aliases.split(','), description: fields.description };
      return isThing
        ? { ...common, ownerName: fields.ownerName, importance: fields.importance }
        : { ...common, parentId: fields.parentId, traits: fields.traits.split('\n') };
    };
    const save = async () => {
      await (isThing
        ? invoke('onLibraryUpdateItem', { itemId: entry.id, changes: changes() })
        : invoke('onLibraryUpdateLocation', { locationId: entry.id, changes: changes() }));
      s.draft = null;
    };
    // «Сохранить» closes the card; a failed save keeps it open with what was typed.
    const saveAndClose = async () => { await save(); s.openId = ''; s.askReplace = false; };
    const describe = () => attempt(async () => {
      await save(); // what was typed (a name too) is kept, the model only adds
      s.askReplace = false;
      return invoke('onLibraryDescribe', { kind, id: entry.id });
    }, 'Описание готово — проверьте и поправьте, если нужно');
    const describeButton = button('Описать по картинке', 'btn small', () => {
      if (controls.description.value.trim()) { s.askReplace = true; render(); return; }
      describe();
    });
    describeButton.title = entry.image ? 'Попросить модель описать картинку (та же модель, что у гардероба)' : 'Сначала добавьте картинку';
    describeButton.disabled = !entry.image;
    const replaceRow = s.askReplace ? element('div', { className: 'ku-row ku-ask' }, [
      element('span', { className: 'ku-small', text: 'Описание уже есть. Заменить его новым?' }),
      button('Заменить описание', 'btn primary small', describe),
      button('Оставить', 'btn small', () => { s.askReplace = false; render(); }),
    ]) : null;

    const linked = linkedSet().has(entry.id);
    const field = (label, control) => element('div', { className: 'field' }, [element('label', { text: label }), control]);
    const labeled = (label, control, hint) => element('div', { className: 'field ku-wsel' }, [element('label', { text: label }), control, ...(hint ? [element('p', { className: 'ku-hint', text: hint })] : [])]);
    const form = element('div', { className: 'ku-wform' }, [
      element('div', { className: 'ku-row' }, [
        element('span', { className: 'muted ku-small', text: `${KINDS[kind].many} · ${pathText(entry.folderId)}` }),
        element('span', { className: 'ku-push' }),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': 'Закрыть', title: 'Закрыть' }, [icon('close')]), { onclick: close }),
      ]),
      field('Название', controls.name),
      ...(isThing
        ? [element('div', { className: 'ku-row ku-wselects' }, [labeled('Важность', controls.importance, 'Насколько вещь важна для сюжета: важные летописец держит в уме дольше'), labeled('Папка в библиотеке', controls.folderId)]), field('Обычно у кого', controls.ownerName)]
        : [element('div', { className: 'ku-row ku-wselects' }, [labeled('Находится в', controls.parentId, 'Внутри какого места это место: комната внутри дома, дом внутри района. Без этого оно самостоятельное.'), labeled('Папка в библиотеке', controls.folderId, 'Только для порядка в библиотеке; на сюжет не влияет.')])]),
      field('Другие названия', controls.aliases),
      ...(isThing ? [] : [field('Черты', controls.traits)]),
      element('div', { className: 'field' }, [element('div', { className: 'ku-row' }, [element('label', { text: 'Описание' }), element('span', { className: 'ku-push' }), describeButton]), controls.description]),
      replaceRow,
      element('label', { className: 'ku-inline ku-wear' }, [
        toggle(linked, `${entry.name} в этом чате`, on => attempt(() => act('onLibraryLink', { libraryIds: [entry.id], on, ...shelfArg() }, 'library-link'))),
        element('span', {}, [element('strong', { className: 'ku-small', text: linked ? 'Включена в этом чате' : 'Выключена в этом чате' }),
          element('span', { className: 'muted ku-small', text: isThing ? ' — летописец и рассказчик знают о ней' : ' — летописец и рассказчик знают это место' })]),
      ]),
      element('div', { className: 'ku-row ku-wfoot' }, [
        button('Удалить', 'btn small danger', () => attempt(async () => {
          const removed = await (isThing ? invoke('onLibraryRemoveItem', { itemId: entry.id }) : invoke('onLibraryRemoveLocation', { locationId: entry.id }));
          if (removed) { s.openId = ''; s.draft = null; }
        })),
        ...(isThing ? [] : [button('Копия', 'btn small', () => attempt(async () => {
          const copy = await invoke('onLibraryDuplicateLocation', { locationId: entry.id });
          if (copy?.id) { s.openId = copy.id; s.draft = null; }
        }, 'Копия создана'))]),
        entry.lang === 'en'
          ? element('span', { className: 'ku-chip told', title: 'Описание' + (isThing ? '' : ' и черты') + ' переведены на английский', text: 'English' })
          : button('Перевести на английский', 'btn small', () => attempt(async () => {
            setStatus('Перевожу…');
            await save();
            await invoke('onLibraryTranslateEntry', { kind, id: entry.id });
          }, 'Переведено на английский'), 'Модель переведёт описание' + (isThing ? '' : ' и черты') + ' один к одному; русский текст в библиотеке заменится переводом'),
        element('span', { className: 'ku-push' }),
        button('Сохранить', 'btn primary small', () => attempt(saveAndClose, isThing ? 'Вещь сохранена' : 'Локация сохранена')),
      ]),
    ]);
    dialog.append(view, form);
    layer.append(dialog);
    // Focus the name once, when the card opens — not after every redraw (it looked like an error).
    if (s.focusedId !== entry.id) {
      s.focusedId = entry.id;
      setTimeout(() => { if (dialog.isConnected && !dialog.contains(ctx.shadow?.activeElement)) controls.name.focus({ preventScroll: true }); }, 0);
    }
    return layer;
  }

  // ---- The card of a character ---------------------------------------------------

  /** Where each section stands for the coming reply (card-prompt.js report), by section id. */
  function promptStatus(cardId) {
    const person = (snapshot().cardsReport?.people ?? []).find(item => item.cardId === cardId);
    if (!person) return null;
    return new Map(person.parts.map(part => [part.sectionId, part]));
  }

  const WHEN_LABELS = { ...GATE_WHEN };
  /** The id the list of sections uses for the closet (it is not a section). */
  const CLOSET = '__closet';

  /**
   * The sheet of a card, laid out as: who (a strip on top), the sections (a list on the left), one section at a time (on the right).
   * What was typed lives in `s.draft` until «Сохранить» or the card is closed, so any redraw keeps it.
   */
  function renderCardEditor(entry) {
    const lib = library();
    const layer = element('div', { className: 'ku-wlayer' });
    const forget = () => { s.draft = null; s.selSection = ''; };
    const close = () => { s.openId = ''; forget(); render(); };
    layer.addEventListener('click', event => { if (event.target === layer) close(); });
    const dialog = element('section', { className: 'ku-wcard ku-ccard', role: 'dialog', 'aria-modal': 'true', 'aria-label': entry.name });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } });
    const siblings = entriesOf().filter(item => item.folderId === entry.folderId);
    const index = siblings.findIndex(item => item.id === entry.id);
    const go = step => { const next = siblings[index + step]; if (next) { s.openId = next.id; forget(); render(); } };

    // The draft: what the user changed and has not saved yet. Sections are a list of plain objects edited in place.
    if (s.draft?.id !== entry.id) {
      s.draft = { id: entry.id, fields: {
        name: entry.name, folderId: entry.folderId, aliases: entry.aliases.join(', '),
        sections: entry.sections.map(section => ({ ...section, keys: [...(section.keys ?? [])] })),
        closet: { cardIds: [...(entry.closet?.cardIds ?? [])], lookIds: [...(entry.closet?.lookIds ?? [])], ownIds: [...(entry.closet?.ownIds ?? [])] },
      } };
      s.selSection = '';
    }
    const draft = s.draft.fields;
    if (s.selSection !== CLOSET && !draft.sections.some(section => section.id === s.selSection)) s.selSection = draft.sections[0]?.id ?? '';
    const status = promptStatus(entry.id);

    // ---- The strip on top: portrait, name, other names, folder
    const portrait = entry.image
      ? element('img', { className: 'ku-cport', src: imageUrl(entry.image), alt: entry.name })
      : element('span', { className: 'ku-cport ku-cnoport', 'aria-hidden': 'true', text: (draft.name || entry.name).slice(0, 1).toUpperCase() });
    const nameInput = element('input', { type: 'text', value: draft.name, 'aria-label': 'Имя персонажа', className: 'ku-cname' });
    nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
    const aliasInput = element('input', { type: 'text', value: draft.aliases, 'aria-label': 'Другие имена', placeholder: 'Манджиро, Mikey' });
    aliasInput.addEventListener('input', () => { draft.aliases = aliasInput.value; });
    const folderSelect = element('select', { 'aria-label': 'Папка' }, lib.folders.map(item => element('option', { value: item.id, text: pathText(item.id), selected: item.id === draft.folderId })));
    folderSelect.addEventListener('change', () => { draft.folderId = folderSelect.value; });
    // The entry of «Мир → Имена» the card shares its names with (several cards of one character may share one).
    const nameEntries = snapshot().names?.entries ?? [];
    const linkedEntry = nameEntries.find(item => item.id === entry.nameId);
    const alsoThere = linkedEntry ? (lib.characters ?? []).filter(card => card.nameId === linkedEntry.id && card.id !== entry.id).map(card => `«${card.name}»`) : [];
    const nameLink = element('select', { 'aria-label': 'Запись в Именах' }, [
      element('option', { value: '', text: 'Не связана с «Именами»', selected: !linkedEntry }),
      ...nameEntries.map(item => element('option', { value: item.id, text: `Имена: ${item.name}`, selected: item.id === linkedEntry?.id })),
      element('option', { value: '__new', text: `＋ Создать запись «${entry.name}» в «Именах»` }),
    ]);
    nameLink.addEventListener('change', () => attempt(async () => {
      await persist();
      await invoke('onLibraryLinkName', { cardId: entry.id, nameId: nameLink.value });
      forget();
    }));
    const top = element('header', { className: 'ku-ctop' }, [
      element('div', { className: 'ku-cport-box' }, [
        portrait,
        element('div', { className: 'ku-cport-tools' }, [
          filePicker(entry.image ? 'Заменить' : 'Картинка', { multiple: false, className: 'btn small', onFiles: async files => {
            await attempt(async () => invoke('onLibrarySetImage', { kind, id: entry.id, imageDataUrl: await fileToDataUrl(files[0]) }), 'Картинка сохранена');
          } }),
          ...(entry.image ? [button('Убрать', 'btn small', () => attempt(() => invoke('onLibraryRemoveImage', { kind, id: entry.id }), 'Картинка убрана'))] : []),
        ]),
      ]),
      element('div', { className: 'ku-ctop-main' }, [
        element('div', { className: 'ku-cfields' }, [nameInput, aliasInput, folderSelect, nameLink]),
        element('p', { className: 'ku-hint', text: 'Имя и «другие имена» — как героя зовут в постах (прозвища, имя латиницей). Через запятую. Карточка отдаёт их персонажу в чате, чтобы его узнавали. В одной папке имена не повторяются, в разных можно. Последний список — запись во вкладке «Имена»: имя и прозвища с карточки попадут туда (один раз, без повторов), а склонения оттуда помогут узнавать героя в постах. К одной записи можно привязать несколько карточек: один герой в разных АУ.' + (alsoThere.length ? ` Та же запись у карточек: ${alsoThere.join(', ')}.` : '') }),
      ]),
      element('div', { className: 'ku-ctop-tools' }, [
        Object.assign(button('‹', 'btn small', () => go(-1), 'Предыдущая карточка'), { disabled: index <= 0 }),
        Object.assign(button('›', 'btn small', () => go(1), 'Следующая карточка'), { disabled: index < 0 || index >= siblings.length - 1 }),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': 'Закрыть', title: 'Закрыть' }, [icon('close')]), { onclick: close }),
      ]),
    ]);

    // ---- The list of sections (left)
    const filled = draft.sections.filter(section => section.text.trim()).length;
    const nav = element('nav', { className: 'ku-cnavbox', 'aria-label': 'Разделы карточки' }, [
      element('p', { className: 'ku-hint ku-cnavhead', text: `Разделы · ${filled} из ${draft.sections.length}` }),
      ...draft.sections.map(section => {
        const length = section.text.trim().length;
        const row = element('button', { type: 'button', className: `ku-cnav${section.id === s.selSection ? ' on' : ''}`, 'aria-current': section.id === s.selSection ? 'true' : null }, [
          element('span', { className: `ku-cdot${length ? '' : ' empty'}`, 'aria-hidden': 'true' }),
          element('span', { className: 'ku-cnav-title', text: section.title || CARD_SECTION_KINDS[section.kind] }),
          element('span', { className: 'ku-hint', text: length ? String(length) : 'пусто' }),
        ]);
        row.addEventListener('click', () => { s.selSection = section.id; render(); });
        return row;
      }),
      element('span', { className: 'ku-push' }),
      (() => {
        const row = element('button', { type: 'button', className: `ku-cnav${s.selSection === CLOSET ? ' on' : ''}`, 'aria-current': s.selSection === CLOSET ? 'true' : null }, [
          element('span', { className: 'ku-cnav-title', text: 'Шкаф' }),
          element('span', { className: 'ku-hint', text: draft.closet.cardIds.length + draft.closet.lookIds.length ? `${draft.closet.lookIds.length} компл. · ${draft.closet.cardIds.length} вещ.` : 'пусто' }),
        ]);
        row.addEventListener('click', () => { s.selSection = CLOSET; render(); });
        return row;
      })(),
      button('+ Свой раздел', 'btn small', () => {
        const created = makeSection({ kind: 'other', title: 'Новый раздел', text: '' });
        draft.sections.push(created);
        s.selSection = created.id;
        render();
      }, 'Раздел с любым названием; отправляется по ключевым словам'),
      button('Копия карточки', 'btn small', () => attempt(async () => {
        const copy = await invoke('onLibraryDuplicateCharacter', { cardId: entry.id });
        if (copy?.id) { s.openId = copy.id; forget(); }
      }, 'Копия создана')),
      button('Удалить карточку', 'btn small danger', () => attempt(async () => {
        const removed = await invoke('onLibraryRemoveCharacter', { cardId: entry.id });
        if (removed) { s.openId = ''; forget(); }
      })),
    ]);

    // ---- One section (right)
    const position = draft.sections.findIndex(section => section.id === s.selSection);
    const pane = s.selSection === CLOSET ? renderClosetPane(entry, draft.closet) : position < 0
      ? element('div', { className: 'ku-cpane' }, [element('p', { className: 'ku-hint', text: 'В карточке нет разделов. Добавьте свой слева внизу.' })])
      : renderSectionPane(draft.sections[position], position, status);

    // ---- The footer
    const persist = async () => {
      await invoke('onLibraryUpdateCharacter', { cardId: entry.id, changes: {
        name: draft.name, folderId: draft.folderId, aliases: draft.aliases.split(','), sections: draft.sections, closet: draft.closet,
      } });
      forget();
    };
    const linked = linkedSet().has(entry.id);
    const owner = Object.entries(snapshot().cardByEntity ?? {}).find(([, card]) => card.id === entry.id)?.[0];
    const ownerName = owner ? characterName((snapshot().characters ?? []).find(character => characterId(character) === owner), '') : '';
    const foot = element('footer', { className: 'ku-cfoot' }, [
      element('label', { className: 'ku-inline ku-wear' }, [
        toggle(linked, `${entry.name} в этом чате`, on => attempt(() => act('onLibraryLink', { libraryIds: [entry.id], on, kind }, 'library-link'), on ? 'Карточка включена' : 'Карточка выключена')),
        element('span', {}, [
          element('strong', { className: 'ku-small', text: linked ? 'Включена в этом чате' : 'Выключена в этом чате' }),
          element('span', { className: 'muted ku-small', text: linked
            ? ` — рассказчик читает её про ${ownerName || 'этого персонажа'}, когда он в сцене`
            : ' — включите: персонаж с таким именем подключится к карточке, а если его в чате нет, он появится' }),
        ]),
      ]),
      element('span', { className: 'ku-push' }),
      button('Сохранить', 'btn primary', () => attempt(async () => { await persist(); s.openId = ''; }, 'Карточка сохранена')),
    ]);

    // ---- Language and the note the card came from
    const note = entry.source;
    const english = entry.lang === 'en';
    const strip = element('div', { className: `ku-cstrip${note?.stale ? ' stale' : ''}` }, [
      element('span', { className: `ku-chip${english ? ' told' : ''}`, text: english ? 'Текст на английском' : 'Текст на русском' }),
      ...(english ? [] : [button('Перевести на английский', 'btn small', () => attempt(async () => {
        setStatus('Перевожу карточку по разделам, это может занять минуту…');
        await persist();
        await invoke('onLibraryTranslateCard', { cardId: entry.id });
        forget();
      }, 'Карточка переведена на английский'), 'Каждый раздел переводится моделью один к одному, без добавлений и пропусков')]),
      element('span', { className: 'ku-hint ku-cstrip-note', text: english
        ? (note ? 'Русский оригинал остался в Obsidian. Чтобы перевести заново, загрузите русский текст кнопкой справа.' : 'Это рабочий текст карточки: рассказчик получает его как есть.')
        : (note ? 'Рассказчик читает английский лучше: переведите — русский оригинал останется в Obsidian.' : 'Русский текст в карточке заменится английским, оригинала нигде не останется: сделайте «Копию карточки», если он нужен.') }),
      element('span', { className: 'ku-push' }),
      ...(note ? [
        element('span', { className: note.stale ? 'ku-chip ku-stale' : 'ku-hint', title: note.path, text: note.stale ? 'Анкета в Obsidian изменилась' : `Анкета: ${note.path}` }),
        button(note.stale ? 'Обновить из Obsidian' : 'Загрузить заново', note.stale ? 'btn primary small' : 'btn small', () => refreshFromNotes([entry.id], forget),
          'Русский текст из заметки заменит разделы карточки; свои правила «когда» и ключи сохранятся. После обновления карточку нужно перевести заново.'),
      ] : []),
    ]);

    dialog.append(top, strip, element('div', { className: 'ku-cbodybox' }, [nav, pane]), foot);
    layer.append(dialog);
    if (s.focusedId !== entry.id) {
      s.focusedId = entry.id;
      setTimeout(() => { if (dialog.isConnected && !dialog.contains(ctx.shadow?.activeElement)) nameInput.focus({ preventScroll: true }); }, 0);
    }
    return layer;
  }

  /**
   * The closet of a card: the things (wardrobe cards) and sets (saved looks) that belong to this character. The chronicler picks a change of
   * clothes from them; here they can also be put on by hand. `closet` is the draft's { cardIds, lookIds }.
   */
  function renderClosetPane(entry, closet) {
    const wardrobe = snapshot().wardrobe ?? { cards: [], looks: [] };
    const owner = Object.entries(snapshot().cardByEntity ?? {}).find(([, card]) => card.id === entry.id)?.[0] ?? '';
    const tie = (list, id, on) => { const at = list.indexOf(id); if (on && at < 0) list.push(id); if (!on && at >= 0) list.splice(at, 1); };
    // A piece that is personal to ANOTHER character is not offered here (and neither is a set that holds one).
    const taken = personalPieces(library());
    const another = id => taken.has(id) && taken.get(id) !== entry.id;
    const wear = (cardIds, mode, done) => attempt(() => act('onWear', { entityId: owner, cardIds, mode }, 'wardrobe-wear'), done);
    const needChat = owner ? '' : 'Включите карточку в этом чате (переключатель внизу): тогда героя можно одеть';
    const order = new Map(WARDROBE_CATEGORIES.map(([id], index) => [id, index]));
    const categoryName = id => WARDROBE_CATEGORIES.find(([key]) => key === id)?.[1] ?? '';

    // Sets
    const looks = (wardrobe.looks ?? []).filter(look => look.shelf === 'characters' && !look.cardIds.some(another));
    const sortedLooks = [...looks].sort((left, right) => Number(closet.lookIds.includes(right.id)) - Number(closet.lookIds.includes(left.id)));
    const lookRows = sortedLooks.map(look => {
      const on = closet.lookIds.includes(look.id);
      const box = element('input', { type: 'checkbox', checked: on, 'aria-label': `Комплект «${look.name}» у героя` });
      box.addEventListener('change', () => { tie(closet.lookIds, look.id, box.checked); render(); });
      return element('div', { className: `ku-closet-row${on ? ' on' : ''}` }, [
        box,
        element('span', { className: 'ku-closet-name' }, [element('strong', { text: look.name }), element('span', { className: 'muted ku-small', text: ` · вещей: ${look.cardIds.length}` })]),
        ...(on ? [Object.assign(button('Надеть', 'btn small', () => wear(look.cardIds, 'replace', `Надет комплект «${look.name}»`), needChat || 'Надеть весь комплект вместо того, что надето'), { disabled: !owner })] : []),
      ]);
    });

    // Things: tied ones first, a search and a section to narrow the rest down.
    const query = (s.closetQuery ?? '').trim().toLocaleLowerCase('ru-RU');
    const category = s.closetCategory ?? '';
    const everything = (wardrobe.cards ?? []).filter(card => card.shelf === 'characters');
    const hidden = everything.filter(card => another(card.id)).length;
    const all = everything.filter(card => !another(card.id));
    const found = all.filter(card => (!category || card.category === category)
      && (!query || `${cardLabel(card)} ${card.description ?? ''}`.toLocaleLowerCase('ru-RU').includes(query)));
    found.sort((left, right) => Number(closet.cardIds.includes(right.id)) - Number(closet.cardIds.includes(left.id))
      || (order.get(left.category) ?? 99) - (order.get(right.category) ?? 99));
    const LIMIT = 60;
    const search = element('input', { type: 'search', value: s.closetQuery ?? '', placeholder: 'Найти вещь', 'aria-label': 'Поиск вещи в гардеробе', className: 'ku-search' });
    search.addEventListener('change', () => { s.closetQuery = search.value; render(); });
    const section = element('select', { 'aria-label': 'Раздел гардероба' }, [
      element('option', { value: '', text: 'Все разделы' }),
      ...WARDROBE_CATEGORIES.map(([id, label]) => element('option', { value: id, text: label, selected: id === category })),
    ]);
    section.addEventListener('change', () => { s.closetCategory = section.value; render(); });
    const tiles = element('div', { className: 'ku-closet-grid' }, found.slice(0, LIMIT).map(card => {
      const on = closet.cardIds.includes(card.id);
      const tile = element('button', { type: 'button', className: `ku-closet-tile${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${cardLabel(card)} — ${on ? 'убрать из шкафа' : 'в шкаф'}`, title: categoryName(card.category) }, [
        card.image ? element('img', { src: imageUrl(card.image), alt: '', loading: 'lazy', draggable: false }) : element('span', { className: 'ku-closet-noimg', text: cardLabel(card).slice(0, 1) }),
        element('span', { className: 'ku-closet-cap', text: cardLabel(card) }),
      ]);
      tile.addEventListener('click', () => { tie(closet.cardIds, card.id, !on); if (on) tie(closet.ownIds, card.id, false); render(); });
      if (on && closet.ownIds.includes(card.id)) tile.append(element('span', { className: 'ku-closet-own', text: 'личная' }));
      return tile;
    }));
    const tiedCards = all.filter(card => closet.cardIds.includes(card.id));
    // The things in the closet, each with a tick «only this character»: nobody else may have it.
    const own = tiedCards.map(card => {
      const box = element('input', { type: 'checkbox', checked: closet.ownIds.includes(card.id), 'aria-label': `${cardLabel(card)}: только у этого героя` });
      box.addEventListener('change', () => { tie(closet.ownIds, card.id, box.checked); render(); });
      return element('label', { className: 'ku-closet-row' }, [box, element('span', { className: 'ku-closet-name' }, [element('strong', { text: cardLabel(card) }), element('span', { className: 'muted ku-small', text: ` · ${categoryName(card.category)}` })])]);
    });
    const wearAll = Object.assign(button(`Надеть отмеченные вещи (${tiedCards.length})`, 'btn small', () => wear(tiedCards.map(card => card.id), 'add', 'Вещи надеты'), needChat || 'Надеть все вещи шкафа поверх того, что надето'), { disabled: !owner || !tiedCards.length });

    return element('div', { className: 'ku-cpane' }, [
      element('div', { className: 'ku-ctitlerow' }, [element('h3', { className: 'ku-ctitle', text: 'Шкаф' }), element('span', { className: 'ku-chip', text: `комплектов ${closet.lookIds.length} · вещей ${closet.cardIds.length}` })]),
      element('p', { className: 'ku-hint', text: 'Что есть у этого героя из «Гардероба». Когда он переодевается в истории, летописец выбирает комплект или вещи отсюда (если подходящего нет, опишет одежду словами). Сами вы тоже можете надеть: кнопки «Надеть». Изменения шкафа сохраняются кнопкой «Сохранить».' }),
      element('div', { className: 'ku-fld' }, [element('label', { className: 'ku-clabel', text: 'Комплекты' }), ...(lookRows.length ? lookRows : [element('p', { className: 'ku-hint', text: 'Комплектов для персонажей пока нет: соберите их в «Гардероб» → образ.' })])]),
      element('div', { className: 'ku-fld' }, [
        element('div', { className: 'ku-row' }, [element('label', { className: 'ku-clabel', text: 'Вещи' }), element('span', { className: 'ku-push' }), wearAll]),
        ...(own.length ? [element('details', { className: 'ku-cmore' }, [element('summary', { text: `Личные вещи: отметьте, что принадлежит только этому герою (${closet.ownIds.length} из ${own.length})` }), ...own, element('p', { className: 'ku-hint', text: 'Личную вещь не увидят в шкафах других героев, и летописец не наденет её на других. Метка снимается тем же флажком.' })])] : []),
        element('div', { className: 'ku-row' }, [search, section]),
        found.length ? tiles : element('p', { className: 'ku-hint', text: all.length ? 'Ничего не найдено.' : 'В гардеробе (полка «Персонажи») пока нет вещей.' }),
        ...(hidden ? [element('p', { className: 'ku-hint', text: `Скрыто вещей, которые личные у других героев: ${hidden}.` })] : []),
        ...(found.length > LIMIT ? [element('p', { className: 'ku-hint', text: `Показано ${LIMIT} из ${found.length}: уточните поиск или раздел.` })] : []),
      ]),
    ]);
  }

  /** The open section: its text, when the narrator gets it, and (folded) its name and kind. */
  function renderSectionPane(section, position, status) {
    const draft = s.draft.fields;
    const own = status?.get(section.id);
    const kindLabel = key => (key === 'other' ? 'Прочее (по ключевым словам)' : CARD_SECTION_KINDS[key]);
    const chip = !own ? null : own.action === 'force'
      ? element('span', { className: 'ku-chip told', text: 'сейчас уходит в запрос' })
      : element('span', { className: 'ku-chip', text: own.action === 'trim' ? 'не влезло в объём' : `сейчас придержан${own.why ? `: ${own.why}` : ''}` });

    const count = element('p', { className: 'ku-hint' });
    const showCount = () => { count.textContent = `Что рассказчик должен знать об этом: факты, привычки, как говорит. Пустой раздел в запрос не уходит. Сейчас ${section.text.trim().length} зн.`; };
    showCount();
    const text = element('textarea', { rows: 9, value: section.text, id: 'ku-card-text', 'aria-label': `Текст раздела ${section.title}` });
    text.addEventListener('input', () => { section.text = text.value; showCount(); });

    // «When»: two plain choices; the second opens the list of own rules.
    const own_when = Boolean(section.when);
    const radio = (value, checked) => {
      const input = element('input', { type: 'radio', name: 'ku-card-when', checked });
      input.addEventListener('change', () => { if (!input.checked) return; if (value === 'default') delete section.when; else section.when = section.when || 'always'; render(); });
      return input;
    };
    const whenSelect = element('select', { 'aria-label': 'Своё правило отправки', disabled: !own_when },
      CARD_WHEN.map(key => element('option', { value: key, text: WHEN_LABELS[key] ?? key, selected: section.when === key })));
    whenSelect.addEventListener('change', () => { section.when = whenSelect.value; render(); });
    const whenBox = element('div', { className: 'ku-copts' }, [
      element('div', { className: 'ku-clabel', text: 'Когда рассказчик получает этот раздел' }),
      element('label', { className: `ku-copt${own_when ? '' : ' on'}` }, [radio('default', !own_when), element('span', {}, [
        element('strong', { text: 'Как у всех разделов этого вида' }),
        element('span', { className: 'ku-hint', text: `Для «${kindLabel(section.kind)}» это правило из «Настройки → Суфлёр лорбуков». Менять его сразу для всех карточек можно там.` }),
      ])]),
      element('label', { className: `ku-copt${own_when ? ' on' : ''}` }, [radio('own', own_when), element('span', {}, [
        element('strong', { text: 'Своё правило для этого раздела' }),
        element('span', { className: 'ku-hint', text: '«Никогда» выключает раздел, не стирая текст; «по ключевым словам» отправляет, только если слово есть в посте.' }),
        whenSelect,
      ])]),
    ]);

    const byKeys = section.when === 'keys' || (!section.when && section.kind === 'other');
    // A field that grows with its text, one key to a line: a regex is long and must be seen whole, not scrolled with the arrow keys.
    const keys = element('textarea', { rows: 2, value: (section.keys ?? []).join('\n'), id: 'ku-card-keys', 'aria-label': 'Ключевые слова раздела', placeholder: 'бабу\nбайк', disabled: !byKeys, className: 'ku-keys' });
    const fitKeys = () => { keys.style.height = 'auto'; keys.style.height = `${Math.min(400, Math.max(48, keys.scrollHeight + 2))}px`; };
    setTimeout(fitKeys, 0);
    const saveKeys = list => { if (list.length) section.keys = list; else delete section.keys; };
    keys.addEventListener('input', () => { saveKeys(splitKeys(keys.value)); fitKeys(); });
    // «Put on a regex»: the words typed become regular expressions of the chosen kind (the form lorebook keys have); «take off» turns them back.
    const regexMode = element('select', { 'aria-label': 'Какой регекс надеть', disabled: !byKeys }, Object.entries(KEY_REGEX_MODES).map(([id, text]) => element('option', { value: id, text, selected: id === (s.regexMode ?? 'endings') })));
    regexMode.addEventListener('change', () => { s.regexMode = regexMode.value; });
    const rewriteKeys = convert => { const list = splitKeys(keys.value).map(convert); saveKeys(list); keys.value = list.join('\n'); fitKeys(); };
    const regexRow = element('div', { className: 'ku-row' }, [
      regexMode,
      Object.assign(button('Надеть регекс', 'btn small', () => rewriteKeys(word => keyToRegex(word, regexMode.value)), 'Каждое слово из поля станет регулярным выражением выбранного вида'), { disabled: !byKeys }),
      Object.assign(button('Снять регекс', 'btn small', () => rewriteKeys(keyFromRegex), 'Вернуть обычные слова там, где регекс надела кнопка'), { disabled: !byKeys }),
    ]);

    // Name and kind, folded away: they rarely need a touch.
    const title = element('input', { type: 'text', value: section.title, 'aria-label': 'Название раздела' });
    title.addEventListener('input', () => { section.title = title.value; });
    title.addEventListener('change', () => render());
    const kindSelect = element('select', { 'aria-label': 'Вид раздела' }, Object.keys(CARD_SECTION_KINDS).map(key => element('option', { value: key, text: kindLabel(key), selected: key === section.kind })));
    kindSelect.addEventListener('change', () => { section.kind = kindSelect.value; render(); });
    const more = element('details', { className: 'ku-cmore' });
    more.open = Boolean(s.moreOpen);
    more.addEventListener('toggle', () => { s.moreOpen = more.open; });
    more.append(
      element('summary', { text: 'Ещё: название и вид раздела' }),
      element('div', { className: 'ku-fld' }, [element('label', { className: 'ku-clabel', text: 'Название раздела' }), title, element('p', { className: 'ku-hint', text: 'Просто подпись на карточке и в запросе. Можно писать как угодно.' })]),
      element('div', { className: 'ku-fld' }, [element('label', { className: 'ku-clabel', text: 'Вид раздела' }), kindSelect, element('p', { className: 'ku-hint', text: 'Нужен только суфлёру: по виду он знает, когда отправлять раздел (Voice — всегда, Skills — только в бою, NSFW — только в близости). Для своих разделов оставьте «Прочее».' })]),
    );

    const tools = element('div', { className: 'ku-ctools' }, [
      Object.assign(button('↑', 'btn small', () => { if (position > 0) { [draft.sections[position - 1], draft.sections[position]] = [draft.sections[position], draft.sections[position - 1]]; render(); } }, 'Раздел выше'), { disabled: position === 0 }),
      Object.assign(button('↓', 'btn small', () => { if (position < draft.sections.length - 1) { [draft.sections[position + 1], draft.sections[position]] = [draft.sections[position], draft.sections[position + 1]]; render(); } }, 'Раздел ниже'), { disabled: position >= draft.sections.length - 1 }),
      button('Убрать раздел', 'btn small danger', () => { draft.sections.splice(position, 1); render(); }),
    ]);

    return element('div', { className: 'ku-cpane' }, [
      element('div', { className: 'ku-ctitlerow' }, [element('h3', { className: 'ku-ctitle', text: section.title || CARD_SECTION_KINDS[section.kind] }), ...(chip ? [chip] : [])]),
      element('div', { className: 'ku-fld' }, [element('label', { className: 'ku-clabel', htmlFor: 'ku-card-text', text: 'Текст раздела' }), text, count]),
      whenBox,
      element('div', { className: 'ku-fld' }, [element('label', { className: 'ku-clabel', htmlFor: 'ku-card-keys', text: 'Ключевые слова' }), keys, regexRow, element('p', { className: 'ku-hint', text: byKeys ? 'Раздел попадёт в запрос, только если одно из этих слов встретится в вашем последнем посте или в предыдущем ответе. Каждое слово с новой строки (или через запятую). Без слов такой раздел не уйдёт никогда. Обычное слово находится и внутри других слов («байк» найдёт и «байкер»); «Надеть регекс» делает поиск точнее: только слово с окончаниями, только целиком или любое начинающееся так. Свой регекс можно писать вручную: /байк(а|у)?/i.' : 'Поле работает, когда правило раздела — «по ключевым словам». Сейчас у раздела другое правило, слова не нужны: выберите «Своё правило» → «по ключевым словам» выше.' })]),
      more,
      tools,
    ]);
  }

  // ---- Notes (Obsidian) ----------------------------------------------------------

  /** The notes of the remembered folder; asks the browser (and, with nothing remembered, the user) when `ask` is set. null = not available. */
  async function notesFromFolder(ask) {
    if (!canRememberFolder()) return null;
    let handle = await recallFolder();
    if (!handle) {
      if (!ask) return null;
      handle = await pickFolder();
      if (!handle) return null;
      await rememberFolder(handle);
    }
    if (!(await access(handle, ask))) return null;
    return readNotes(handle);
  }

  /** Files of a folder picked with a plain input (browsers without the folder API): [{ path, text }]. */
  async function notesFromPicked(picked) {
    const files = [];
    for (const file of picked) {
      if (!/\.(md|markdown)$/i.test(file.name) || file.size > 1_000_000) continue;
      try { files.push({ path: file.webkitRelativePath || file.name, text: await file.text() }); }
      catch (error) { console.warn('[Kulisy] A note could not be read.', error); }
    }
    return files;
  }

  const NO_FOLDER = 'Папка с анкетами не выбрана или браузер не дал доступ.';
  const afterCheck = result => (result.changed.length ? `В Obsidian изменились анкеты: ${result.changed.length}. Они подсвечены в списке.` : `Изменений нет: сверено ${result.same}${result.missing.length ? `, заметки не найдены: ${result.missing.length}` : ''}.`);

  /** Compare the cards with their notes; `files` are given when the folder was picked just now. */
  async function checkNotes(files) {
    await attempt(async () => {
      const notes = files ?? await notesFromFolder(true);
      if (!notes) throw new Error(NO_FOLDER);
      return invoke('onLibraryCheckNotes', { files: notes });
    }, afterCheck);
  }

  /** Load cards again from their notes (all marked changed when ids are not given). */
  async function refreshFromNotes(cardIds, after, files) {
    await attempt(async () => {
      const notes = files ?? await notesFromFolder(true);
      if (!notes) throw new Error(NO_FOLDER);
      const result = await invoke('onLibraryRefreshCards', { files: notes, cardIds });
      after?.();
      return result;
    }, result => `Обновлено карточек: ${result?.updated?.length ?? 0}${result?.skipped?.length ? `, заметки не найдены: ${result.skipped.length}` : ''}. Теперь они на русском — переведите.`);
  }

  /** A quiet look at the notes when the page opens, if the browser still lets the remembered folder be read. */
  async function lookAtNotesQuietly() {
    try {
      const handle = await recallFolder();
      if (!handle || !(await access(handle, false))) return;
      const result = await invoke('onLibraryCheckNotes', { files: await readNotes(handle) });
      if (result?.changed?.length) { setStatus(afterCheck(result)); render(); }
    } catch (error) { console.warn('[Kulisy] The notes could not be checked.', error); }
  }

  /** The row above the cards: check the notes, load the changed ones again, translate. */
  function notesBar() {
    const withNote = (library().characters ?? []).filter(card => card.source);
    const stale = withNote.filter(card => card.source.stale);
    const russian = (library().characters ?? []).filter(card => card.lang !== 'en' && card.sections.some(section => section.text.trim()));
    if (!shelves.characters.looked) { shelves.characters.looked = true; if (withNote.length) lookAtNotesQuietly(); }
    const check = canRememberFolder()
      ? button('Проверить Obsidian', 'btn small', () => checkNotes(), 'Сверить анкеты в библиотеке с заметками в выбранной папке: изменённые будут подсвечены')
      : filePicker('Проверить Obsidian', { accept: '', directory: true, onFiles: async picked => checkNotes(await notesFromPicked(picked)), title: 'Выбрать папку с анкетами: изменённые будут подсвечены' });
    return element('div', { className: `ku-notesbar${stale.length ? ' stale' : ''}` }, [
      element('span', { className: 'ku-small', text: stale.length ? `В Obsidian изменились анкеты: ${stale.length}` : withNote.length ? `Карточек из Obsidian: ${withNote.length}, изменений не найдено` : 'Карточки из папки анкет Obsidian можно обновлять и сверять' }),
      element('span', { className: 'ku-push' }),
      check,
      ...(stale.length ? [canRememberFolder()
        ? button(`Обновить изменённые (${stale.length})`, 'btn primary small', () => refreshFromNotes(null), 'Загрузить русский текст изменённых анкет заново')
        : filePicker(`Обновить изменённые (${stale.length})`, { accept: '', directory: true, className: 'btn primary small', onFiles: async picked => refreshFromNotes(null, null, await notesFromPicked(picked)) })] : []),
      ...(russian.length ? [button(`Перевести русские (${russian.length})`, 'btn small', () => attempt(() => invoke('onLibraryTranslateCards', { cardIds: russian.map(card => card.id) }), result => `Переведено карточек: ${result?.done?.length ?? 0}${result?.failed?.length ? `, не удалось: ${result.failed.length}` : ''}`), 'Перевести на английский все карточки, которые ещё на русском')] : []),
    ]);
  }

  /** The page «Мир → Карточки»: the gallery of character cards and a line about what they add to the request now. */
  function renderCards() {
    const view = element('div', { className: 'records-view' });
    const report = snapshot().cardsReport;
    const tokens = Number(snapshot().cardsTokens) || 0;
    const attached = (snapshot().linkedCharacterIds ?? []).length;
    const line = report?.sent
      ? `В запросе сейчас: разделов ${report.sent}, ${report.characters} зн. (≈${tokens} ток.)${report.trimmed ? `, не влезло: ${report.trimmed}` : ''}.`
      : attached ? 'Карточки включены, но сейчас в запрос ничего не уходит: нужные герои не в сцене или их разделы придержаны правилами.' : 'Включите карточку переключателем — она подключится к персонажу чата.';
    view.append(
      element('p', { className: 'muted ku-small', text: 'Персонаж, записанный один раз: разделы анкеты хранятся вне чатов, а в чате рассказчик получает только нужные — по правилам «Суфлёра» (Настройки → «Суфлёр лорбуков»).' }),
      element('p', { className: 'ku-small ku-cline', text: line }),
      notesBar(),
      renderLibrary('characters'),
    );
    return view;
  }

  // ---- Import --------------------------------------------------------------------

  /** The list of anketas of a picked folder with a tick for each: what to load. */
  function renderNotesChooser(importFiles) {
    const { files, list, picked } = s.notes;
    const wanted = s.notes.query.trim().toLocaleLowerCase('ru-RU');
    const shown = list.filter(item => !wanted || `${item.name} ${item.folder}`.toLocaleLowerCase('ru-RU').includes(wanted));
    const search = element('input', { type: 'search', value: s.notes.query, placeholder: 'Найти анкету', 'aria-label': 'Поиск анкеты', className: 'ku-search' });
    search.addEventListener('change', () => { s.notes.query = search.value; render(); });
    const rows = element('div', { className: 'ku-import-list' }, shown.map(item => {
      const box = element('input', { type: 'checkbox', checked: picked.has(item.path) });
      box.addEventListener('change', () => { if (box.checked) picked.add(item.path); else picked.delete(item.path); render(); });
      return element('label', { className: 'roster-item' }, [box, element('span', {}, [
        element('strong', { text: item.name }),
        element('span', { className: 'muted ku-small', text: ` ${item.folder ? `${item.folder} · ` : ''}разделов: ${item.sections}${item.exists ? ' · уже есть в библиотеке' : ''}` }),
      ])]);
    }));
    const go = button(`Загрузить отмеченные (${picked.size})`, 'btn primary small', async () => {
      const chosen = files.filter(file => picked.has(file.path));
      s.notes = null;
      await importFiles(chosen);
    });
    go.disabled = !picked.size;
    const all = button('Отметить все', 'btn small', () => { for (const item of shown) picked.add(item.path); render(); });
    const none = button('Снять все', 'btn small', () => { for (const item of shown) picked.delete(item.path); render(); });
    return element('div', { className: 'ku-notechoose' }, [
      element('p', { className: 'muted ku-small', text: `Анкет в папке: ${list.length}. Новые уже отмечены; те, что есть в библиотеке, нет: отметьте, если нужна ещё одна копия (в другой папке библиотеки) — в той же папке имя повторить нельзя.` }),
      element('div', { className: 'ku-row' }, [search, all, none]), rows, element('div', { className: 'ku-row' }, [go]),
    ]);
  }

  function renderImport() {
    const box = element('div', { className: 'card ku-import' });
    const folderName = s.folderId ? folderPath(library(), s.folderId).at(-1)?.name : '';
    const where = text => element('p', { className: 'muted ku-small', text: s.folderId ? `Импорт в папку «${folderName}»${things() ? ' — как вещи' : ''}.` : text });
    const close = button('Закрыть', 'btn small', () => { s.importMode = ''; s.notes = null; render(); });
    if (s.importMode === 'lorebook') {
      const books = invoke('onLibraryLorebooks', {}) ?? [];
      const select = element('select', { 'aria-label': 'Лорбук' }, [element('option', { value: '', text: 'Выберите лорбук' }), ...books.map(book => element('option', { value: book, text: book, selected: book === s.lorebook.book }))]);
      select.addEventListener('change', async () => {
        s.lorebook = { book: select.value, entries: [], picked: new Set() };
        if (select.value) {
          try { s.lorebook.entries = await invoke('onLibraryLorebookEntries', { book: select.value, kind }); }
          catch (error) { setStatus(error?.message || 'Лорбук не прочитан', true); }
        }
        render();
      });
      const list = element('div', { className: 'ku-import-list' });
      for (const entry of s.lorebook.entries) {
        const box2 = element('input', { type: 'checkbox', checked: s.lorebook.picked.has(entry.uid) });
        box2.addEventListener('change', () => { if (box2.checked) s.lorebook.picked.add(entry.uid); else s.lorebook.picked.delete(entry.uid); });
        list.append(element('label', { className: 'roster-item' }, [box2, element('span', {}, [element('strong', { text: entry.name }), element('span', { className: 'muted ku-small', text: ` ${entry.preview}` })])]));
      }
      const go = button(cards() ? 'Импортировать отмеченных (никого — всех)' : 'Импортировать отмеченные', 'btn primary small', () => attempt(() => invoke('onLibraryImportLorebook', { book: s.lorebook.book, uids: [...s.lorebook.picked], folderId: s.folderId, kind }), result => `Добавлено: ${result?.added?.length ?? 0}`));
      go.disabled = !s.lorebook.book;
      box.append(element('h3', { text: 'Из лорбука' }), where('Папка не открыта — будет папка с названием лорбука.'),
        ...(cards() ? [element('p', { className: 'muted ku-small', text: 'Берутся записи с названием «[ Имя ] - Раздел» (так их пишет lorebook_builder): одна карточка на имя, разделы — по названиям записей. Слова записи (ключи) станут другими именами.' })] : []),
        select, list, element('div', { className: 'ku-row' }, [go, close]));
    } else if (s.importMode === 'markdown') {
      const importFiles = files => attempt(() => invoke('onLibraryImportMarkdown', { files, folderId: s.folderId, kind }), result => `Добавлено: ${result?.added?.length ?? 0}, пропущено: ${result?.skipped?.length ?? 0}`);
      // Cards: the folder is read first, then the user ticks the anketas to load (new ones are ticked, the ones already here are not).
      const offer = files => {
        const list = invoke('onLibraryPreviewNotes', { files });
        if (!list.length) { setStatus('В выбранной папке нет анкет: нужны заметки .md с разделами «### …».', true); return; }
        s.notes = { files, list, picked: new Set(list.filter(item => !item.exists).map(item => item.path)), query: '' };
        render();
      };
      // Cards remember the folder (where the browser can), so a changed note is noticed later.
      const pick = cards() && canRememberFolder()
        ? button('Выбрать папку заметок', 'btn primary small', async () => {
          try {
            const handle = await pickFolder();
            if (!handle) return;
            await rememberFolder(handle);
            offer(await readNotes(handle));
          } catch (error) { setStatus(error?.message || 'Папка не прочитана', true); }
        })
        : filePicker('Выбрать папку заметок', { accept: '', directory: true, className: 'btn primary small', onFiles: async picked => (cards() ? offer(await notesFromPicked(picked)) : importFiles(await notesFromPicked(picked))) });
      const chooser = cards() && s.notes ? renderNotesChooser(importFiles) : null;
      box.append(element('h3', { text: cards() ? 'Из папки анкет' : 'Из папки заметок' }), where('Папка библиотеки не открыта — будет папка с названием выбранной папки заметок.'),
        element('p', { className: 'muted ku-small', text: cards()
          ? 'Каждая заметка .md — одна карточка, подпапки — папки. Загружается русский текст: разделы — заголовки «### …» (Basic Info, Voice…); подсказки %% … %%, пустые вопросы и английская часть «# Translate» не попадут. Имена берутся из aliases, name_en и keys шапки. Перевод на английский делается потом, кнопкой на карточке. Папку Кулисы запомнят и подскажут, если заметка изменилась.'
          : things()
          ? 'Каждая заметка .md — одна вещь, подпапки — папки. В шапке можно указать aliases, «владелец» и «важность» (важная / ключевая).'
          : 'Каждая заметка .md — одна локация, подпапки — папки. В шапке можно указать aliases, traits и «находится в».' }),
        ...(chooser ? [chooser] : []),
        element('div', { className: 'ku-row' }, [pick, close]));
    } else {
      const pick = filePicker('Выбрать файл .json', { accept: 'application/json,.json', multiple: false, className: 'btn primary small', onFiles: async ([file]) => {
        if (file.size > 5_000_000) { setStatus('Файл больше 5 МБ.', true); return; }
        const text = await file.text();
        await attempt(() => invoke('onLibraryImportJson', { text, folderId: s.folderId }), result => `Добавлено: ${result?.added?.length ?? 0}`);
      } });
      box.append(element('h3', { text: 'Из файла Кулис' }), element('p', { className: 'muted ku-small', text: `${s.folderId ? `Папки файла лягут в «${folderName}».` : 'Папки файла лягут в корень библиотеки.'} Из файла берутся локации, вещи и карточки.` }), element('div', { className: 'ku-row' }, [pick, close]));
    }
    return box;
  }

  // ---- Ctrl+V of a picture while the library is open -----------------------------

  function onPaste(event) {
    try {
      if (!ctx.shadow?.host?.isConnected || !ctx.shadow.querySelector('.ku-lib') || !s.folderId) return;
      const target = event.composedPath?.()[0];
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && target.type !== 'file') return;
      const files = [...(event.clipboardData?.files ?? [])].filter(file => /^image\//.test(file.type));
      if (!files.length) return;
      event.preventDefault();
      // An open card takes the picture as its own; otherwise it is a new entry.
      if (s.openId) {
        const id = s.openId;
        attempt(async () => invoke('onLibrarySetImage', { kind, id, imageDataUrl: await fileToDataUrl(files[0]) }), 'Картинка сохранена');
      } else addPictures(files);
    } catch (error) {
      console.error('[Kulisy] Paste into the library failed.', error);
    }
  }
  document.addEventListener('paste', onPaste);

  return { renderLibrary, renderCards, destroyLibrary: () => document.removeEventListener('paste', onPaste) };
}

/** Styles of the library gallery (the card over the window reuses the wardrobe's). */
export const LIBRARY_STYLE = `
.ku-lib{display:flex;flex-direction:column;gap:12px;container-type:inline-size}
.ku-lib .ku-wsec{width:210px}
.ku-lsec .ku-folder{border:0;border-radius:8px;padding-top:0;padding-bottom:0;background:transparent;color:var(--k-muted)}
.ku-lsec .ku-folder:hover{color:var(--k-text);background:var(--k-inset)}
.ku-lsec .ku-folder.on{background:var(--k-accent-soft);color:var(--k-accent)}
.ku-fname{display:inline-flex;align-items:center;gap:7px;min-width:0}
.ku-fname span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-fname .ku-ico{flex:0 0 auto;width:15px;height:15px}
.ku-lnew{display:flex;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--k-line)}
.ku-lnew input{flex:1 1 auto;min-width:0}
.ku-lhead{gap:8px}
.ku-ltitle{margin:0;font-size:15px}
.ku-ltiles{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.ku-ltile{position:relative;border-radius:13px}
.ku-ltile .ku-place-open{padding:0;gap:0;align-items:stretch;position:relative}
.ku-ltiles.places .ku-pic{aspect-ratio:4/3}
.ku-ltiles.items .ku-pic{aspect-ratio:1/1}
.ku-ltile .ku-nopic{color:var(--k-accent);background:var(--k-accent-soft)}
.ku-letter{font-size:22px;font-weight:800}
.ku-ltext{display:flex;flex-direction:column;gap:2px;padding:7px 10px 8px;min-width:0}
.ku-ltext strong{font-size:12.5px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-ltext .muted{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-ltext .ku-chip{align-self:flex-start;margin-top:2px}
.ku-ltile .ku-inline{padding:7px 10px}
.ku-ltiles .ku-drop{min-height:150px}
.ku-wview.places img{object-fit:cover}
.ku-import{display:flex;flex-direction:column;gap:8px}
.ku-import h3{margin:0}
.ku-ltiles.characters .ku-pic{aspect-ratio:3/4}
.ku-wview.characters img{object-fit:cover}
.ku-cline{margin:0}
.ku-ccard{flex-direction:column;width:min(1000px,100%);height:min(820px,100%)}
.ku-ctop{display:flex;gap:18px;align-items:flex-start;padding:20px 24px;border-bottom:1px solid var(--k-line)}
.ku-cport-box{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;align-items:stretch;width:86px}
.ku-cport{width:86px;height:86px;border-radius:14px;object-fit:cover;display:block;background:var(--k-inset)}
.ku-cnoport{display:grid;place-items:center;font-size:36px;font-weight:700;color:var(--k-accent)}
.ku-cport-tools{display:flex;flex-direction:column;gap:4px}
.ku-ctop-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}
.ku-cfields{display:flex;gap:10px;flex-wrap:wrap}
.ku-cfields input,.ku-cfields select{flex:1 1 200px;min-width:0;min-height:42px}
.ku-cname{font-size:18px;font-weight:700}
.ku-ctop-tools{display:flex;gap:6px;align-items:center}
.ku-cbodybox{flex:1 1 auto;min-height:0;display:flex}
.ku-cnavbox{flex:0 0 260px;box-sizing:border-box;padding:16px 14px;border-right:1px solid var(--k-line);display:flex;flex-direction:column;gap:4px;overflow:auto}
.ku-cnavhead{padding:0 8px 8px}
.ku-cnav{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;min-height:44px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--k-text);font-size:13.5px;text-align:left;cursor:pointer}
.ku-cnav:hover{background:var(--k-inset)}
.ku-cnav.on{background:var(--k-accent-soft);color:var(--k-accent);font-weight:600;box-shadow:inset 3px 0 0 var(--k-accent)}
.ku-keys{width:100%;box-sizing:border-box;resize:vertical;min-height:48px;font-family:inherit;line-height:1.4;overflow-wrap:anywhere;white-space:pre-wrap}
.ku-wsel{flex:1 1 200px;min-width:0}
.ku-wsel select{width:100%}
.ku-closet-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--k-line);border-radius:8px;margin-bottom:6px}
.ku-closet-row.on{border-color:var(--k-accent)}
.ku-closet-name{flex:1 1 auto;min-width:0}
.ku-closet-own{position:absolute;top:6px;left:6px;padding:1px 7px;border-radius:20px;background:var(--k-accent);color:var(--k-bg);font-size:10.5px}
.ku-closet-tile{position:relative}
.ku-closet-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin-top:8px}
.ku-closet-tile{display:flex;flex-direction:column;gap:4px;padding:4px;border:2px solid transparent;border-radius:10px;background:var(--k-inset);color:var(--k-text);cursor:pointer;text-align:center;font:inherit}
.ku-closet-tile.on{border-color:var(--k-accent)}
.ku-closet-tile img,.ku-closet-noimg{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--k-track)}
.ku-closet-cap{font-size:11.5px;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ku-pickbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;margin:6px 0;border:1px solid var(--k-accent);border-radius:10px;background:var(--k-inset)}
.ku-pickbox{margin:0 8px 0 0;flex:0 0 auto;pointer-events:none}
.ku-place-card.picked{outline:2px solid var(--k-accent)}
.ku-cstrip{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:8px 14px;border-bottom:1px solid var(--k-line);background:var(--k-inset)}
.ku-cstrip.stale{background:color-mix(in srgb,var(--k-accent) 16%,transparent)}
.ku-cstrip-note{flex:1 1 220px;min-width:0}
.ku-stale{background:color-mix(in srgb,var(--k-accent) 28%,transparent);color:var(--k-text)}
.ku-notesbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;margin:6px 0;border:1px solid var(--k-line);border-radius:10px}
.ku-notesbar.stale{border-color:var(--k-accent)}
.ku-cnav-title{flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-cdot{flex:0 0 auto;width:9px;height:9px;border-radius:50%;background:var(--k-accent)}
.ku-cdot.empty{background:transparent;border:2px solid var(--k-muted);box-sizing:border-box}
.ku-cnavbox .ku-push{flex:1 1 auto;min-height:10px}
.ku-cnavbox .btn{margin-top:6px;min-height:40px}
.ku-cpane{flex:1 1 auto;min-width:0;box-sizing:border-box;padding:22px 28px;display:flex;flex-direction:column;gap:22px;overflow:auto}
.ku-ctitlerow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ku-ctitle{margin:0;font-size:22px}
.ku-fld{display:flex;flex-direction:column;gap:6px}
.ku-clabel{font-size:13px;font-weight:700}
.ku-hint{margin:0;font-size:12.5px;line-height:1.5;color:var(--k-muted)}
.ku-cpane textarea{min-height:170px;line-height:1.6;resize:vertical;padding:12px 14px}
.ku-cpane input[type=text],.ku-cpane select{min-height:42px}
.ku-copts{display:flex;flex-direction:column;gap:10px}
.ku-copt{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--k-line);border-radius:12px;cursor:pointer}
.ku-copt.on{border-color:var(--k-accent);background:var(--k-accent-soft)}
.ku-copt input[type=radio]{margin-top:3px;flex:0 0 auto;width:18px;height:18px;accent-color:var(--k-accent)}
.ku-copt>span{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 auto}
.ku-cmore summary{cursor:pointer;font-size:13.5px;font-weight:600;padding:6px 0}
.ku-cmore .ku-fld{margin-top:12px}
.ku-ctools{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:14px;border-top:1px solid var(--k-line)}
.ku-cfoot{display:flex;gap:12px;align-items:center;padding:14px 24px;border-top:1px solid var(--k-line)}
@media (max-width:760px){.ku-ctop{flex-wrap:wrap}.ku-cbodybox{flex-direction:column;overflow:auto}.ku-cnavbox{flex-basis:auto;border-right:0;border-bottom:1px solid var(--k-line)}}
@container (max-width:700px){.ku-lib .ku-wsec{width:100%}.ku-lnew{flex:1 1 100%}}
`;
