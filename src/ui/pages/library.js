import { button, downloadJson, element } from '../helpers.js';
import { icon } from '../icons.js';
import { folderPath, folderWithDescendants, searchLibraryItems, searchLocations } from '../../core/index.js';
import { fileToDataUrl, imageUrl } from '../../integration/wardrobe-images.js';

/**
 * The library as a gallery, like the wardrobe: folders on the left, pictures on the
 * right, a card over the window for editing (with «Описать по картинке» — the same
 * picture model as the wardrobe). Two shelves share the folders: places and things;
 * each shelf remembers its open folder, search and card.
 */
export function createLibraryPages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const act = (...args) => ctx.act(...args);

  const snapshot = () => ctx.snapshot;
  const library = () => snapshot().locationLibrary ?? { folders: [], locations: [], items: [] };
  const IMPORTANCE_RU = { normal: 'обычная', important: 'важная', key: 'ключевая' };
  const KINDS = {
    places: { add: '+ Локация', one: 'локация', many: 'Локации', placeholder: 'Новая локация', icon: 'pin' },
    items: { add: '+ Вещь', one: 'вещь', many: 'Вещи', placeholder: 'Новая вещь', icon: 'bag' },
  };
  const ROOT_LIMIT = 120;

  const fresh = () => ({ focusedId: '', folderId: '', query: '', openId: '', importMode: '', lorebook: { book: '', entries: [], picked: new Set() }, renaming: false, draft: null, askReplace: false, showAll: false });
  const shelves = { places: fresh(), items: fresh() };
  let kind = 'places';
  let s = shelves.places;
  let describeOnUpload = false;

  const things = () => kind === 'items';
  const entriesOf = () => (things() ? library().items ?? [] : library().locations);
  const linkedSet = () => new Set((things() ? snapshot().linkedItemIds : snapshot().linkedLocationIds) ?? []);
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
    kind = shelf === 'items' ? 'items' : 'places';
    s = shelves[kind];
    const lib = library();
    if (s.folderId && !lib.folders.some(folder => folder.id === s.folderId)) { s.folderId = ''; s.renaming = false; }
    if (s.openId && !entriesOf().some(entry => entry.id === s.openId)) { s.openId = ''; s.draft = null; }
    const view = element('div', { className: 'ku-library ku-lib' });

    const search = element('input', { type: 'search', value: s.query, placeholder: 'Поиск', 'aria-label': things() ? 'Поиск вещи' : 'Поиск локации', className: 'ku-search' });
    search.addEventListener('change', () => { s.query = search.value; render(); });
    const needFolder = s.folderId ? '' : 'Сначала откройте папку слева';
    const addEmpty = button(KINDS[kind].add, 'btn small', () => attempt(async () => {
      const entry = things()
        ? await invoke('onLibraryAddItem', { folderId: s.folderId, name: KINDS[kind].placeholder })
        : await invoke('onLibraryAddLocation', { folderId: s.folderId, name: KINDS[kind].placeholder });
      if (entry) { s.openId = entry.id; s.draft = null; }
    }));
    addEmpty.title = needFolder || 'Без картинки: описание можно написать самой';
    addEmpty.disabled = !s.folderId;
    const importMenu = element('select', { 'aria-label': 'Импорт' }, [
      element('option', { value: '', text: 'Импорт…' }),
      element('option', { value: 'lorebook', text: 'Из лорбука' }),
      element('option', { value: 'markdown', text: 'Из папки заметок (Obsidian / Markdown)' }),
      element('option', { value: 'json', text: 'Из файла Кулис (.json)' }),
    ]);
    importMenu.value = s.importMode;
    importMenu.addEventListener('change', () => { s.importMode = importMenu.value; render(); });
    const exportButton = button('Экспорт', 'btn small', () => {
      try {
        const text = invoke('onLibraryExport', { folderId: s.folderId });
        downloadJson(JSON.parse(text), s.folderId ? `kulisy-library-${folderPath(lib, s.folderId).at(-1)?.name ?? 'folder'}.json` : 'kulisy-library.json');
      } catch (error) { setStatus(error?.message || 'Не удалось выгрузить', true); }
    }, s.folderId ? 'Выгрузить эту папку (локации и вещи)' : 'Выгрузить всю библиотеку (локации и вещи)');
    const auto = element('input', { type: 'checkbox', className: 'ku-switch', checked: describeOnUpload, 'aria-label': 'Описывать картинки сразу' });
    auto.addEventListener('change', () => { describeOnUpload = auto.checked; });
    view.append(element('div', { className: 'ku-row ku-wtools' }, [
      search,
      filePicker('+ Картинки', { className: 'btn primary small', disabled: !s.folderId, title: needFolder, onFiles: addPictures }),
      addEmpty,
      importMenu,
      exportButton,
      element('label', { className: 'ku-inline ku-small', title: 'Сразу просить модель описать новые картинки (тратит запрос на каждую)' }, [auto, 'описывать сразу']),
    ]));
    if (s.importMode) view.append(renderImport());

    const body = element('div', { className: 'ku-wbody' });
    body.append(renderFolders(), renderGallery());
    view.append(body);
    const opened = entriesOf().find(entry => entry.id === s.openId);
    if (opened) view.append(renderEditor(opened));
    else s.focusedId = '';
    return view;
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

  function renderGallery() {
    const lib = library();
    const gallery = element('div', { className: 'ku-wgal' });
    const linked = linkedSet();
    const query = s.query.trim();
    let list;
    if (query) {
      list = things() ? searchLibraryItems(lib, query) : searchLocations(lib, query);
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
    gallery.append(grid);
    if (shown.length < list.length) gallery.append(button(`Показать все (${list.length})`, 'btn small', () => { s.showAll = true; render(); }));
    if (!list.length && !s.folderId && !query) {
      gallery.append(element('div', { className: 'empty', text: lib.folders.length
        ? `${KINDS[kind].many} пока нет. Откройте папку слева и добавьте картинки или «${KINDS[kind].add}».`
        : `Библиотека пуста. Создайте папку слева (например, по фандому), потом добавьте в неё картинки — или импортируйте. Папки общие у локаций и вещей.` }));
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
    const sub = things()
      ? (entry.ownerName ? `обычно у: ${entry.ownerName}` : 'без хозяина')
      : (entry.parentId ? `в ${library().locations.find(item => item.id === entry.parentId)?.name ?? '…'}` : (entry.traits[0] ?? 'без места выше'));
    const open = element('button', { type: 'button', className: 'ku-place-open', 'aria-label': `${entry.name} — открыть` }, [
      picture(entry),
      element('span', { className: 'ku-ltext' }, [
        element('strong', { text: entry.name }),
        element('span', { className: 'muted ku-small', text: sub }),
        ...(things() && entry.importance !== 'normal' ? [element('span', { className: 'ku-chip told', text: IMPORTANCE_RU[entry.importance] })] : []),
      ]),
    ]);
    if (on) open.append(element('span', { className: 'ku-worn', text: 'в чате' }));
    open.addEventListener('click', () => { s.openId = entry.id; s.draft = null; s.askReplace = false; render(); });
    card.append(open, element('label', { className: 'ku-inline ku-small' }, [
      toggle(on, `${entry.name} в этом чате`, value => attempt(() => act('onLibraryLink', { libraryIds: [entry.id], on: value, ...(things() ? { kind: 'items' } : {}) }, 'library-link'))),
      on ? 'в этом чате' : 'выключена',
    ]));
    return card;
  }

  // ---- The card over the window ------------------------------------------------

  function renderEditor(entry) {
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
        element('option', { value: '', text: '— нигде —' }),
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
    const form = element('div', { className: 'ku-wform' }, [
      element('div', { className: 'ku-row' }, [
        element('span', { className: 'muted ku-small', text: `${KINDS[kind].many} · ${pathText(entry.folderId)}` }),
        element('span', { className: 'ku-push' }),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': 'Закрыть', title: 'Закрыть' }, [icon('close')]), { onclick: close }),
      ]),
      field('Название', controls.name),
      ...(isThing
        ? [element('div', { className: 'ku-row ku-wselects' }, [controls.importance, controls.folderId]), field('Обычно у кого', controls.ownerName)]
        : [element('div', { className: 'ku-row ku-wselects' }, [controls.parentId, controls.folderId])]),
      field('Другие названия', controls.aliases),
      ...(isThing ? [] : [field('Черты', controls.traits)]),
      element('div', { className: 'field' }, [element('div', { className: 'ku-row' }, [element('label', { text: 'Описание' }), element('span', { className: 'ku-push' }), describeButton]), controls.description]),
      replaceRow,
      element('label', { className: 'ku-inline ku-wear' }, [
        toggle(linked, `${entry.name} в этом чате`, on => attempt(() => act('onLibraryLink', { libraryIds: [entry.id], on, ...(isThing ? { kind: 'items' } : {}) }, 'library-link'))),
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

  // ---- Import --------------------------------------------------------------------

  function renderImport() {
    const box = element('div', { className: 'card ku-import' });
    const folderName = s.folderId ? folderPath(library(), s.folderId).at(-1)?.name : '';
    const where = text => element('p', { className: 'muted ku-small', text: s.folderId ? `Импорт в папку «${folderName}»${things() ? ' — как вещи' : ''}.` : text });
    const close = button('Закрыть', 'btn small', () => { s.importMode = ''; render(); });
    if (s.importMode === 'lorebook') {
      const books = invoke('onLibraryLorebooks', {}) ?? [];
      const select = element('select', { 'aria-label': 'Лорбук' }, [element('option', { value: '', text: 'Выберите лорбук' }), ...books.map(book => element('option', { value: book, text: book, selected: book === s.lorebook.book }))]);
      select.addEventListener('change', async () => {
        s.lorebook = { book: select.value, entries: [], picked: new Set() };
        if (select.value) {
          try { s.lorebook.entries = await invoke('onLibraryLorebookEntries', { book: select.value }); }
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
      const go = button('Импортировать отмеченные', 'btn primary small', () => attempt(() => invoke('onLibraryImportLorebook', { book: s.lorebook.book, uids: [...s.lorebook.picked], folderId: s.folderId, kind }), result => `Добавлено: ${result?.added?.length ?? 0}`));
      go.disabled = !s.lorebook.book;
      box.append(element('h3', { text: 'Из лорбука' }), where('Папка не открыта — будет папка с названием лорбука.'), select, list, element('div', { className: 'ku-row' }, [go, close]));
    } else if (s.importMode === 'markdown') {
      const pick = filePicker('Выбрать папку заметок', { accept: '', directory: true, className: 'btn primary small', onFiles: async picked => {
        const files = [];
        for (const file of picked) {
          if (!/\.(md|markdown)$/i.test(file.name) || file.size > 1_000_000) continue;
          try { files.push({ path: file.webkitRelativePath || file.name, text: await file.text() }); }
          catch (error) { console.warn('[Kulisy] A note could not be read.', error); }
        }
        await attempt(() => invoke('onLibraryImportMarkdown', { files, folderId: s.folderId, kind }), result => `Добавлено: ${result?.added?.length ?? 0}, пропущено: ${result?.skipped?.length ?? 0}`);
      } });
      box.append(element('h3', { text: 'Из папки заметок' }), where('Папка библиотеки не открыта — будет папка с названием выбранной папки заметок.'),
        element('p', { className: 'muted ku-small', text: things()
          ? 'Каждая заметка .md — одна вещь, подпапки — папки. В шапке можно указать aliases, «владелец» и «важность» (важная / ключевая).'
          : 'Каждая заметка .md — одна локация, подпапки — папки. В шапке можно указать aliases, traits и «находится в».' }),
        element('div', { className: 'ku-row' }, [pick, close]));
    } else {
      const pick = filePicker('Выбрать файл .json', { accept: 'application/json,.json', multiple: false, className: 'btn primary small', onFiles: async ([file]) => {
        if (file.size > 5_000_000) { setStatus('Файл больше 5 МБ.', true); return; }
        const text = await file.text();
        await attempt(() => invoke('onLibraryImportJson', { text, folderId: s.folderId }), result => `Добавлено: ${result?.added?.length ?? 0}`);
      } });
      box.append(element('h3', { text: 'Из файла Кулис' }), element('p', { className: 'muted ku-small', text: `${s.folderId ? `Папки файла лягут в «${folderName}».` : 'Папки файла лягут в корень библиотеки.'} Из файла берутся и локации, и вещи.` }), element('div', { className: 'ku-row' }, [pick, close]));
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

  return { renderLibrary, destroyLibrary: () => document.removeEventListener('paste', onPaste) };
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
@container (max-width:700px){.ku-lib .ku-wsec{width:100%}.ku-lnew{flex:1 1 100%}}
`;
