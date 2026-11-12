import { button, element } from '../helpers.js';
import { NAME_CASES, wordsToFill } from '../../core/name-library.js';

/**
 * «Имена» (Мир → Имена): the name library. How each name is spelled and declined; the model
 * gets only the names of people on stage and of those said in the last posts. Every change goes
 * through the handlers in index.js (namesCallbacks); text fields save on change, not on every key.
 */
export function createNamesPages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const act = (...args) => ctx.act(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const snapshot = () => ctx.snapshot;

  const open = new Set(); // ids of the cards that are unfolded
  const picked = new Set(); // ids ticked for a bulk delete
  let armed = false; // the delete button was pressed once and waits for the second press
  let busy = false;
  const collapsed = new Set(); // ids of folded folders ('' = names without a folder)
  let draft = { name: '', aliases: '', gender: '', folderId: '' };

  const library = () => ({ enabled: true, folders: [], entries: [], ...(snapshot().names ?? {}) });

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(typeof done === 'function' ? done(result) : done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }

  /** The names of the library cards tied to an entry (one character in several AUs may have several). */
  const cardsOf = entry => (snapshot().locationLibrary?.characters ?? []).filter(card => card.nameId === entry.id).map(card => card.name);

  const aliasesOf = text => String(text ?? '').split(/[,;\n]/).map(part => part.trim()).filter(Boolean);
  const hasForms = entry => entry.words.some(word => word.same || NAME_CASES.some(([key]) => word[key]));

  // ---- The top card -----------------------------------------------------------

  function renderTop() {
    const lib = library();
    const missing = lib.entries.filter(entry => !entry.off && wordsToFill(entry).length).length;
    const send = element('input', { type: 'checkbox', className: 'set-switch', checked: lib.enabled, 'aria-label': 'Отправлять имена модели' });
    send.addEventListener('change', () => attempt(() => act('onNamesEnabled', { enabled: send.checked }, 'names-enabled'), send.checked ? 'Имена отправляются модели' : 'Имена не отправляются'));
    const chat = element('input', { type: 'checkbox', className: 'set-switch', checked: Boolean(snapshot().namesChatOff), 'aria-label': 'Выключить имена в этом чате' });
    chat.addEventListener('change', () => attempt(() => act('onNamesChatOff', { off: chat.checked }, 'names-chat'), chat.checked ? 'В этом чате имена не отправляются' : 'В этом чате имена снова отправляются'));
    const tokens = snapshot().namesTokens ?? 0;
    const fill = button(busy ? 'Подбираю склонения…' : `Заполнить склонения${missing ? ` (${missing})` : ''}`, 'btn primary', () => attempt(async () => {
      busy = true; render();
      try { return await invoke('onNamesFill', {}); } finally { busy = false; render(); }
    }, result => (result.asked ? `Склонения подобраны: ${result.filled} из ${result.asked}${result.failed ? `, не получилось: ${result.failed}` : ''}. Проверьте их в карточках.` : 'Всем именам склонения уже заполнены.')));
    fill.disabled = busy || !missing;
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Имена и склонения' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: 'Как пишется и как склоняется каждое имя. Модели уходят только имена тех, кто сейчас в сцене или назван в последних постах: одна короткая строка на человека.' }),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Отправлять имена модели' }), element('small', { className: 'muted', text: 'Общий выключатель для всех чатов.' })]), send]),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Выключить в этом чате' }), element('small', { className: 'muted', text: 'Библиотека остаётся, но этот чат её не отправляет.' })]), chat]),
      element('div', { className: 'row', style: { marginTop: '10px' } }, [
        button('Добавить из персонажей чата', 'btn', () => attempt(() => invoke('onNamesImport', {}), count => (count ? `Добавлено имён: ${count}` : 'Все персонажи чата уже в библиотеке'))),
        fill,
      ]),
      element('p', { className: 'muted ku-small', style: { margin: '8px 0 0' }, text: tokens ? `Сейчас в запросе: ${tokens} ток.` : 'Сейчас в запрос ничего не уходит: никого из библиотеки нет в сцене и в последних постах.' }),
    ]);
  }

  // ---- Add -----------------------------------------------------------------------

  function renderAdd() {
    const name = element('input', { value: draft.name, placeholder: 'Как пишется: Манджиро Сано', 'aria-label': 'Имя' });
    const aliases = element('input', { value: draft.aliases, placeholder: 'Как ещё зовут (через запятую): Майки', 'aria-label': 'Другие имена' });
    const gender = element('select', { 'aria-label': 'Пол' }, [['', 'пол не указан'], ['m', 'мужчина'], ['f', 'женщина']].map(([value, label]) => element('option', { value, text: label, selected: draft.gender === value })));
    const folder = element('select', { 'aria-label': 'В какую папку' }, [element('option', { value: '', text: 'без папки', selected: !draft.folderId }),
      ...library().folders.map(item => element('option', { value: item.id, text: item.name, selected: draft.folderId === item.id }))]);
    folder.addEventListener('change', () => { draft.folderId = folder.value; });
    name.addEventListener('input', () => { draft.name = name.value; });
    aliases.addEventListener('input', () => { draft.aliases = aliases.value; });
    gender.addEventListener('change', () => { draft.gender = gender.value; });
    const add = () => attempt(async () => {
      await act('onNamesAdd', { name: draft.name, aliases: aliasesOf(draft.aliases), gender: draft.gender, folderId: draft.folderId }, 'names-add');
      draft = { name: '', aliases: '', gender: draft.gender, folderId: draft.folderId };
      render();
    }, 'Имя добавлено. Нажмите «Заполнить склонения» или впишите формы сами.');
    name.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Добавить имя' }),
      element('div', { className: 'ku-names-add' }, [name, aliases, gender]),
      element('div', { className: 'row', style: { marginTop: '6px' } }, [folder, button('Добавить', 'btn primary', add)]),
    ]);
  }

  // ---- One name -------------------------------------------------------------------

  function wordRow(entry, word) {
    const same = element('input', { type: 'checkbox', checked: word.same });
    same.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { words: [{ word: word.word, same: same.checked }] } }, 'names-word')));
    const row = element('div', { className: 'ku-names-word' }, [
      element('strong', { className: 'ku-names-w', text: word.word }),
      element('label', { className: 'ku-names-same' }, [same, element('span', { text: 'не склоняется' })]),
    ]);
    if (!word.same) {
      const inputs = element('div', { className: 'ku-names-forms' }, NAME_CASES.map(([key, label, ask]) => {
        const input = element('input', { value: word[key] ?? '', placeholder: label, title: `${label} (${ask})`, 'aria-label': `${word.word}: ${label}` });
        input.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { words: [{ word: word.word, [key]: input.value }] } }, 'names-word')));
        return input;
      }));
      row.append(inputs);
    }
    return row;
  }

  function renderEntry(entry, folderOff = false) {
    const on = element('input', { type: 'checkbox', className: 'ku-names-pick', checked: picked.has(entry.id), title: 'Выбрать для удаления', 'aria-label': `Выбрать ${entry.name}` });
    on.addEventListener('click', event => event.stopPropagation());
    on.addEventListener('change', () => { if (on.checked) picked.add(entry.id); else picked.delete(entry.id); armed = false; render(); });
    const send = element('input', { type: 'checkbox', className: 'set-switch ku-names-send', checked: !entry.off, title: 'Отправлять это имя модели', 'aria-label': `Отправлять имя ${entry.name}` });
    send.addEventListener('click', event => event.stopPropagation());
    send.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { off: !send.checked } }, 'names-off')));
    const incomplete = entry.words.some(word => !word.same && NAME_CASES.some(([key]) => !word[key]));
    const status = !hasForms(entry) ? 'без склонений' : incomplete ? 'не все падежи' : 'готово';
    const details = element('details', { className: `ku-names-card${entry.off || folderOff ? ' off' : ''}` });
    details.open = open.has(entry.id);
    details.addEventListener('toggle', () => { if (details.open) open.add(entry.id); else open.delete(entry.id); });
    details.append(element('summary', {}, [
      on,
      send,
      element('strong', { text: entry.name }),
      entry.aliases.length ? element('span', { className: 'muted ku-small', text: ` (${entry.aliases.join(', ')})` }) : null,
      ...(cardsOf(entry).length ? [element('span', { className: 'muted ku-small', title: cardsOf(entry).join(', '), text: ` · карточки: ${cardsOf(entry).length}` })] : []),
      element('span', { className: `ku-names-state${status === 'готово' ? ' ok' : ''}`, text: status }),
    ]));
    const name = element('input', { value: entry.name, 'aria-label': 'Как пишется' });
    name.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { name: name.value } }, 'names-edit')));
    const aliases = element('input', { value: entry.aliases.join(', '), placeholder: 'Другие имена через запятую', 'aria-label': 'Другие имена' });
    aliases.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { aliases: aliasesOf(aliases.value) } }, 'names-edit')));
    const gender = element('select', { 'aria-label': 'Пол' }, [['', 'пол не указан'], ['m', 'мужчина'], ['f', 'женщина']].map(([value, label]) => element('option', { value, text: label, selected: entry.gender === value })));
    gender.addEventListener('change', () => attempt(() => act('onNamesUpdate', { id: entry.id, patch: { gender: gender.value } }, 'names-edit')));
    const fill = button('Подобрать склонения', 'btn small', () => attempt(async () => {
      busy = true; render();
      try { return await invoke('onNamesFill', { id: entry.id }); } finally { busy = false; render(); }
    }, result => (result.filled ? 'Склонения подобраны, проверьте их' : result.failed ? 'Не получилось подобрать склонения' : 'Здесь всё уже заполнено')));
    fill.disabled = busy || !wordsToFill(entry).length;
    details.append(
      element('div', { className: 'ku-names-body' }, [
        element('div', { className: 'ku-names-add' }, [name, aliases, gender]),
        ...entry.words.map(word => wordRow(entry, word)),
        element('div', { className: 'row', style: { marginTop: '6px' } }, [
          fill,
          button('Удалить имя', 'btn small danger', () => attempt(() => act('onNamesRemove', { ids: [entry.id] }, 'names-remove'), 'Имя удалено')),
        ]),
      ]),
    );
    return details;
  }

  /** The tools over the list: pick, switch, move, delete the ticked (deleting asks twice) and make folders. */
  function renderBulk(entries) {
    for (const id of [...picked]) if (!entries.some(entry => entry.id === id)) picked.delete(id);
    const count = picked.size;
    const ids = () => [...picked];
    const folders = library().folders;
    const remove = button(armed ? `Точно удалить ${count}?` : `Удалить${count ? ` (${count})` : ''}`, `btn small danger${armed ? ' armed' : ''}`, () => {
      if (!armed) { armed = true; render(); return; }
      const chosen = ids();
      armed = false;
      picked.clear();
      attempt(() => act('onNamesRemove', { ids: chosen }, 'names-remove'), `Удалено имён: ${chosen.length}`);
    });
    const on = button('Включить', 'btn small', () => attempt(() => act('onNamesBulk', { ids: ids(), off: false }, 'names-bulk'), `Включено имён: ${count}`), 'Отправлять выбранные имена');
    const off = button('Выключить', 'btn small', () => attempt(() => act('onNamesBulk', { ids: ids(), off: true }, 'names-bulk'), `Выключено имён: ${count}`), 'Не отправлять выбранные имена');
    const move = element('select', { 'aria-label': 'Переложить выбранные в папку', className: 'ku-names-move' }, [element('option', { value: '', text: 'В папку…' }), element('option', { value: '-', text: 'Без папки' }),
      ...folders.map(item => element('option', { value: item.id, text: item.name }))]);
    move.addEventListener('change', () => { const value = move.value; if (value) attempt(() => act('onNamesBulk', { ids: ids(), folderId: value === '-' ? '' : value }, 'names-bulk'), `Переложено имён: ${count}`); });
    for (const node of [remove, on, off, move]) node.disabled = !count;
    const folderName = element('input', { placeholder: 'Новая папка: например, «Токийские мстители»', 'aria-label': 'Название новой папки' });
    const make = () => attempt(async () => { await act('onNamesFolderAdd', { name: folderName.value }, 'names-folder'); folderName.value = ''; }, 'Папка создана');
    folderName.addEventListener('keydown', event => { if (event.key === 'Enter') make(); });
    return element('div', { className: 'ku-names-bulk' }, [
      element('div', { className: 'row' }, [
        button('Выбрать все', 'btn small', () => { for (const entry of entries) picked.add(entry.id); armed = false; render(); }),
        button('Без склонений', 'btn small', () => { picked.clear(); for (const entry of entries.filter(item => !hasForms(item))) picked.add(entry.id); armed = false; render(); }, 'Выбрать имена, у которых нет ни одного склонения'),
        button('Снять выбор', 'btn small', () => { picked.clear(); armed = false; render(); }),
        on, off, move, remove,
      ]),
      element('div', { className: 'row', style: { marginTop: '6px' } }, [folderName, button('Создать папку', 'btn small', make)]),
    ]);
  }

  /** One folder (or the names without one): fold, tick all inside, rename, switch the whole folder, delete it (the names stay). */
  function renderGroup(folder, entries) {
    const id = folder?.id ?? '';
    const folded = collapsed.has(id);
    const ticked = entries.length > 0 && entries.every(entry => picked.has(entry.id));
    const all = element('input', { type: 'checkbox', className: 'ku-names-pick', checked: ticked, title: 'Выбрать все имена в папке', 'aria-label': `Выбрать все в папке ${folder?.name ?? 'без папки'}` });
    all.addEventListener('change', () => { for (const entry of entries) { if (all.checked) picked.add(entry.id); else picked.delete(entry.id); } armed = false; render(); });
    const head = element('div', { className: `ku-names-folder${folder?.off ? ' off' : ''}` }, [
      button(folded ? '▸' : '▾', 'btn icon small', () => { if (folded) collapsed.delete(id); else collapsed.add(id); render(); }, folded ? 'Развернуть' : 'Свернуть'),
      all,
    ]);
    if (folder) {
      const name = element('input', { className: 'ku-names-folder-name', value: folder.name, 'aria-label': 'Название папки' });
      name.addEventListener('change', () => attempt(() => act('onNamesFolderUpdate', { id, name: name.value }, 'names-folder'), 'Папка переименована'));
      const send = element('input', { type: 'checkbox', className: 'set-switch ku-names-send', checked: !folder.off, title: 'Отправлять имена этой папки', 'aria-label': `Отправлять папку ${folder.name}` });
      send.addEventListener('change', () => attempt(() => act('onNamesFolderUpdate', { id, off: !send.checked }, 'names-folder'), send.checked ? 'Папка включена' : 'Папка выключена: её имена не отправляются'));
      head.append(name, element('span', { className: 'muted ku-small', text: `${entries.length}` }), send,
        button('×', 'btn icon small', () => attempt(() => act('onNamesFolderRemove', { id }, 'names-folder'), 'Папка удалена, имена остались без папки'), `Удалить папку ${folder.name} (имена останутся)`));
    } else {
      head.append(element('strong', { className: 'ku-names-folder-title', text: 'Без папки' }), element('span', { className: 'muted ku-small', text: `${entries.length}` }));
    }
    const group = element('div', { className: 'ku-names-group' }, [head]);
    if (!folded) for (const entry of entries) group.append(renderEntry(entry, Boolean(folder?.off)));
    return group;
  }

  function renderNames() {
    const view = element('div', { className: 'records-view ku-names' });
    view.append(renderTop(), renderAdd());
    const lib = library();
    const entries = lib.entries;
    const list = element('div', { className: 'card' }, [element('h3', { text: `Библиотека · ${entries.length}` })]);
    list.append(renderBulk(entries));
    if (!entries.length && !lib.folders.length) list.append(element('p', { className: 'muted ku-small', text: 'Пока пусто. Добавьте имя выше или нажмите «Добавить из персонажей чата».' }));
    for (const folder of lib.folders) list.append(renderGroup(folder, entries.filter(entry => entry.folderId === folder.id)));
    const loose = entries.filter(entry => !lib.folders.some(folder => folder.id === entry.folderId));
    if (loose.length || !lib.folders.length) list.append(renderGroup(null, loose));
    view.append(list);
    return view;
  }

  return { renderNames };
}

export const NAMES_STYLE = `
.ku-names{container-type:inline-size}
.ku-names-opt{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 0;border-top:1px solid var(--k-line);cursor:pointer}
.ku-names-opt>span{display:flex;flex-direction:column;gap:2px;min-width:0}
.ku-names-opt .set-switch,.ku-names-send{width:38px;flex:0 0 auto;padding:0}
.ku-names-pick{width:auto;flex:0 0 auto;margin:0;padding:0}
.ku-names-bulk{margin:4px 0 10px}
.ku-names-bulk .row{gap:6px}
.ku-names-bulk input{min-width:0;flex:1 1 220px;width:auto}
.ku-names-move{width:auto;flex:0 0 auto;min-width:0}
.ku-names-group{margin-top:8px}
.ku-names-folder{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;background:var(--k-inset)}
.ku-names-folder.off{opacity:.65}
.ku-names-folder-name{flex:1 1 120px;min-width:0;background:transparent;border-color:transparent;font-weight:700}
.ku-names-folder-name:focus{border-color:var(--k-line)}
.ku-names-folder-title{flex:1}
.ku-names-bulk .armed{outline:2px solid var(--k-warn)}
.ku-names-add{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,.8fr);gap:6px}
.ku-names-add input,.ku-names-add select{min-width:0;width:100%}
.ku-names-card{border:1px solid var(--k-line);border-radius:10px;margin-top:6px;background:var(--k-panel)}
.ku-names-card.off{opacity:.6}
.ku-names-card summary{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;flex-wrap:wrap}
.ku-names-state{margin-left:auto;font-size:11px;color:var(--k-warn)}
.ku-names-state.ok{color:var(--k-muted)}
.ku-names-body{padding:4px 10px 10px;display:flex;flex-direction:column;gap:8px}
.ku-names-word{display:grid;grid-template-columns:minmax(80px,auto) 1fr;gap:4px 10px;align-items:center}
.ku-names-same input{width:auto;margin:0}
.ku-names-same{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--k-muted)}
.ku-names-forms{grid-column:1/-1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.ku-names-forms input{min-width:0;width:100%}
@container (max-width:560px){.ku-names-add{grid-template-columns:1fr}.ku-names-forms{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
