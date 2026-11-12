import { button, downloadJson, element } from '../helpers.js';
import { SONG_RANGES, exportSongs, findSongs, searchSongs, songLabel, songWords } from '../../core/index.js';

/**
 * «Песни» (Мир → Песни): the song library. For every song: how it feels (атмосфера), how it sounds (мелодия и звучание), its words
 * and, if she wants, extra key words. The narrator gets the songs that play, are sung or are quoted in the last posts; a few quoted
 * lines are enough for a song to be noticed. What plays in a chat is set in the drawer (the tile «Песни»).
 * Every change goes through the handlers in index.js (songsCallbacks); text fields save on change, not on every key.
 */
export function createSongsPages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const act = (...args) => ctx.act(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const snapshot = () => ctx.snapshot;

  const open = new Set(); // ids of the songs that are unfolded
  const collapsed = new Set(); // ids of folded folders ('' = songs without a folder)
  let armed = ''; // the id of the song whose delete button was pressed once
  let query = '';
  let draft = { title: '', artist: '', folderId: '' };
  let probe = '';

  const library = () => ({ enabled: true, minWords: 4, lookback: 4, maxCharacters: 5000, folders: [], songs: [], ...(snapshot().songs ?? {}) });

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(typeof done === 'function' ? done(result) : done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }

  const listOf = text => String(text ?? '').split(/[,;\n]/).map(part => part.trim()).filter(Boolean);
  const countWords = text => songWords(text).length;
  const countLines = text => String(text ?? '').split('\n').filter(line => line.trim()).length;

  // ---- The top card -----------------------------------------------------------

  function numberField(label, value, [min, max], hint, save) {
    const input = element('input', { type: 'number', value: String(value), min: String(min), max: String(max), 'aria-label': label });
    input.addEventListener('change', () => attempt(() => save(Number(input.value))));
    return element('label', { className: 'ku-songs-num', title: hint }, [element('span', { text: label }), input]);
  }

  function renderTop() {
    const lib = library();
    const send = element('input', { type: 'checkbox', className: 'set-switch', checked: lib.enabled, 'aria-label': 'Отправлять песни модели' });
    send.addEventListener('change', () => attempt(() => act('onSongsSettings', { enabled: send.checked }, 'songs-enabled'), send.checked ? 'Песни отправляются модели' : 'Песни не отправляются'));
    const entries = snapshot().songsReport?.entries ?? [];
    const tokens = snapshot().songsTokens ?? 0;
    const now = tokens
      ? `Сейчас в запросе: ${tokens} ток. — ${entries.filter(item => !item.trimmed || item.characters).map(item => `«${item.title}»`).join(', ')}.`
      : 'Сейчас в запрос ничего не уходит: ни одна песня не звучит в этом чате и не названа в последних постах.';
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Песни и музыка в ролевой' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: 'Модель не слышит музыку, поэтому у каждой песни записано, какая она: атмосфера, звучание и слова. Когда в постах цитируют несколько строк или называют песню, она сама попадает в запрос: модель описывает, как музыка звучит, и поёт слова без выдумок. То, что звучит или поётся без цитат, ставится в шторке (плитка «Песни»).' }),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Отправлять песни модели' }), element('small', { className: 'muted', text: 'Общий выключатель для всех чатов.' })]), send]),
      element('div', { className: 'row ku-songs-numbers' }, [
        numberField('Слов подряд', lib.minWords, SONG_RANGES.minWords, 'Сколько слов песни подряд должно стоять в посте, чтобы песня узналась по словам. Меньше — узнаётся легче, но чаще по ошибке.', value => act('onSongsSettings', { minWords: value }, 'songs-settings')),
        numberField('Смотреть постов', lib.lookback, SONG_RANGES.lookback, 'Сколько последних сообщений просматривается: песня остаётся «слышна», пока строка в этих постах.', value => act('onSongsSettings', { lookback: value }, 'songs-settings')),
        numberField('Лимит знаков', lib.maxCharacters, SONG_RANGES.maxCharacters, 'Сколько знаков могут занять описания и слова всех песен в запросе.', value => act('onSongsSettings', { maxCharacters: value }, 'songs-settings')),
      ]),
      element('p', { className: 'muted ku-small', style: { margin: '8px 0 0' }, text: now }),
    ]);
  }

  // ---- «Что узнаётся» ---------------------------------------------------------------

  function renderProbe() {
    const area = element('textarea', { rows: '3', placeholder: 'Вставьте кусок поста со строками песни или её названием — проверим, узнается ли она', 'aria-label': 'Текст для проверки узнавания' });
    area.value = probe;
    const result = element('p', { className: 'ku-small ku-songs-probe' });
    const show = () => {
      const lib = library();
      if (!probe.trim()) { result.textContent = ''; return; }
      const found = findSongs(lib, probe, { minWords: lib.minWords });
      const WHY = { lyrics: 'по словам', title: 'по названию', key: 'по ключевому слову' };
      result.textContent = found.length
        ? `Узнана: ${found.map(item => `«${songLabel(item.song)}» (${WHY[item.why]}${item.hit ? `, дошли до строки ${item.hit.line + 1} из ${item.hit.lines}` : ''})`).join('; ')}`
        : `Ничего не узнано. Для слов нужно хотя бы ${lib.minWords} слов песни подряд; одно слово названия узнаётся, только если стоит в кавычках или между ♪.`;
    };
    area.addEventListener('input', () => { probe = area.value; show(); });
    show();
    return element('div', { className: 'card' }, [element('h3', { text: 'Проверить узнавание' }), area, result]);
  }

  // ---- Add -----------------------------------------------------------------------

  function renderAdd() {
    const lib = library();
    const title = element('input', { value: draft.title, placeholder: 'Название: Ласточка', 'aria-label': 'Название песни' });
    const artist = element('input', { value: draft.artist, placeholder: 'Кто поёт (можно пусто)', 'aria-label': 'Исполнитель' });
    const folder = element('select', { 'aria-label': 'В какую папку' }, [element('option', { value: '', text: 'без папки', selected: !draft.folderId }),
      ...lib.folders.map(item => element('option', { value: item.id, text: item.name, selected: draft.folderId === item.id }))]);
    title.addEventListener('input', () => { draft.title = title.value; });
    artist.addEventListener('input', () => { draft.artist = artist.value; });
    folder.addEventListener('change', () => { draft.folderId = folder.value; });
    const add = () => attempt(async () => {
      const song = await invoke('onSongAdd', { title: draft.title, artist: draft.artist, folderId: draft.folderId });
      if (song?.id) open.add(song.id);
      draft = { title: '', artist: '', folderId: draft.folderId };
      render();
    }, 'Песня добавлена: опишите её и впишите слова.');
    title.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    artist.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Добавить песню' }),
      element('div', { className: 'ku-songs-add' }, [title, artist, folder, button('Добавить', 'btn primary', add)]),
    ]);
  }

  // ---- One song -------------------------------------------------------------------

  function field(label, hint, input) {
    return element('div', { className: 'field' }, [element('label', { text: label }), input, ...(hint ? [element('small', { className: 'muted', text: hint })] : [])]);
  }

  function renderSong(song, folderOff = false) {
    const lib = library();
    const send = element('input', { type: 'checkbox', className: 'set-switch ku-names-send', checked: !song.off, title: 'Узнавать и отправлять эту песню', 'aria-label': `Отправлять песню ${song.title}` });
    send.addEventListener('click', event => event.stopPropagation());
    send.addEventListener('change', () => attempt(() => act('onSongUpdate', { id: song.id, patch: { off: !send.checked } }, 'songs-off')));
    const missing = [!song.lyrics && 'нет слов', !song.sound && !song.mood && 'нет описания'].filter(Boolean);
    const details = element('details', { className: `ku-names-card${song.off || folderOff ? ' off' : ''}` });
    details.open = open.has(song.id);
    details.addEventListener('toggle', () => { if (details.open) open.add(song.id); else open.delete(song.id); });
    details.append(element('summary', {}, [
      send,
      element('strong', { text: song.title }),
      song.artist ? element('span', { className: 'muted ku-small', text: ` — ${song.artist}` }) : null,
      element('span', { className: `ku-names-state${missing.length ? '' : ' ok'}`, text: missing.length ? missing.join(', ') : 'готова' }),
    ]));
    const save = (patch, done) => attempt(() => act('onSongUpdate', { id: song.id, patch }, 'songs-edit'), done);
    const text = (value, placeholder, label, patchKey) => {
      const input = element('input', { value, placeholder, 'aria-label': label });
      input.addEventListener('change', () => save({ [patchKey]: patchKey === 'aliases' || patchKey === 'keys' ? listOf(input.value) : input.value }));
      return input;
    };
    const area = (value, rows, placeholder, label, patchKey) => {
      const input = element('textarea', { rows: String(rows), placeholder, 'aria-label': label });
      input.value = value;
      input.addEventListener('change', () => save({ [patchKey]: input.value }));
      return input;
    };
    const folder = element('select', { 'aria-label': 'Папка' }, [element('option', { value: '', text: 'без папки', selected: !song.folderId }),
      ...lib.folders.map(item => element('option', { value: item.id, text: item.name, selected: song.folderId === item.id }))]);
    folder.addEventListener('change', () => save({ folderId: folder.value }));
    const words = countWords(song.lyrics);
    const removeSong = button(armed === song.id ? 'Точно удалить?' : 'Удалить песню', `btn small danger${armed === song.id ? ' armed' : ''}`, () => {
      if (armed !== song.id) { armed = song.id; render(); return; }
      armed = '';
      attempt(() => act('onSongRemove', { ids: [song.id] }, 'songs-remove'), 'Песня удалена');
    });
    details.append(element('div', { className: 'ku-names-body' }, [
      element('div', { className: 'ku-songs-head' }, [text(song.title, 'Название', 'Название песни', 'title'), text(song.artist, 'Исполнитель', 'Исполнитель', 'artist'), folder]),
      field('Другие названия', 'Как ещё называют песню (через запятую): перевод, сокращение, название латиницей.', text(song.aliases.join(', '), 'Через запятую', 'Другие названия', 'aliases')),
      field('Ключевые слова', 'Необязательно. Что ещё должно навести на песню, например «песня про вокзал». Ищется как написано, поэтому берите слова, которые не встретятся в обычном тексте.', text(song.keys.join(', '), 'Через запятую', 'Ключевые слова', 'keys')),
      field('Атмосфера', 'Что это за песня по ощущению: светлая грусть, злость, ночной разговор.', area(song.mood, 3, 'Например: светлая грусть, как расставание на вокзале.', 'Атмосфера песни', 'mood')),
      field('Мелодия и звучание', 'Как она звучит: темп, инструменты, как нарастает, какой голос.', area(song.sound, 4, 'Например: медленная акустическая гитара, голос тихий и хрипловатый, к припеву вступает бас.', 'Мелодия и звучание', 'sound')),
      field('Слова', `Строки по порядку, пустая строка между куплетами. Пометки вроде «[Припев]» можно оставить: на узнавание они не влияют. ${words ? `Сейчас: ${countLines(song.lyrics)} строк, ${words} слов.` : ''}`, area(song.lyrics, 12, 'Ласточка моя, улетай за море…', 'Слова песни', 'lyrics')),
      element('div', { className: 'row', style: { marginTop: '6px' } }, [removeSong]),
    ]));
    return details;
  }

  // ---- Folders and the list --------------------------------------------------------

  function renderGroup(folder, songs) {
    const id = folder?.id ?? '';
    const folded = collapsed.has(id) && !query;
    const head = element('div', { className: `ku-names-folder${folder?.off ? ' off' : ''}` }, [
      button(folded ? '▸' : '▾', 'btn icon small', () => { if (folded) collapsed.delete(id); else collapsed.add(id); render(); }, folded ? 'Развернуть' : 'Свернуть'),
    ]);
    if (folder) {
      const name = element('input', { className: 'ku-names-folder-name', value: folder.name, 'aria-label': 'Название папки' });
      name.addEventListener('change', () => attempt(() => act('onSongFolderUpdate', { id, name: name.value }, 'songs-folder'), 'Папка переименована'));
      const on = element('input', { type: 'checkbox', className: 'set-switch ku-names-send', checked: !folder.off, title: 'Узнавать песни этой папки', 'aria-label': `Отправлять папку ${folder.name}` });
      on.addEventListener('change', () => attempt(() => act('onSongFolderUpdate', { id, off: !on.checked }, 'songs-folder'), on.checked ? 'Папка включена' : 'Папка выключена: её песни не узнаются'));
      head.append(name, element('span', { className: 'muted ku-small', text: `${songs.length}` }), on,
        button('×', 'btn icon small', () => attempt(() => act('onSongFolderRemove', { id }, 'songs-folder'), 'Папка удалена, песни остались без папки'), `Удалить папку ${folder.name} (песни останутся)`));
    } else {
      head.append(element('strong', { className: 'ku-names-folder-title', text: 'Без папки' }), element('span', { className: 'muted ku-small', text: `${songs.length}` }));
    }
    const group = element('div', { className: 'ku-names-group' }, [head]);
    if (!folded) for (const song of songs) group.append(renderSong(song, Boolean(folder?.off)));
    return group;
  }

  function renderTools() {
    const search = element('input', { type: 'search', value: query, placeholder: 'Поиск по названию, исполнителю, ключам', 'aria-label': 'Поиск песни' });
    search.addEventListener('change', () => { query = search.value; render(); });
    const folderName = element('input', { placeholder: 'Новая папка: например, «Токийские мстители»', 'aria-label': 'Название новой папки' });
    const make = () => attempt(async () => { await act('onSongFolderAdd', { name: folderName.value }, 'songs-folder'); folderName.value = ''; }, 'Папка создана');
    folderName.addEventListener('keydown', event => { if (event.key === 'Enter') make(); });
    const picker = element('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Файл песен' });
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      picker.value = '';
      if (!file) return;
      await attempt(async () => invoke('onSongsImport', { data: JSON.parse(await file.text()) }), result => `Добавлено песен: ${result.added}${result.skipped ? `, пропущено (уже есть): ${result.skipped}` : ''}`);
      render();
    });
    return element('div', { className: 'ku-names-bulk' }, [
      element('div', { className: 'row' }, [
        search,
        button('Экспорт', 'btn small', () => { try { downloadJson(exportSongs(library()), 'kulisy-songs.json'); } catch (error) { setStatus(error?.message || 'Не удалось выгрузить', true); } }, 'Выгрузить все песни в файл (запасная копия)'),
        button('Импорт', 'btn small', () => picker.click(), 'Добавить песни из такого файла; уже имеющиеся не трогаются'),
        picker,
      ]),
      element('div', { className: 'row', style: { marginTop: '6px' } }, [folderName, button('Создать папку', 'btn small', make)]),
    ]);
  }

  function renderSongs() {
    const view = element('div', { className: 'records-view ku-names ku-songs' });
    view.append(renderTop(), renderProbe(), renderAdd());
    const lib = library();
    const songs = query ? searchSongs(lib, query) : lib.songs;
    const list = element('div', { className: 'card' }, [element('h3', { text: `Библиотека · ${lib.songs.length}${query ? ` · найдено ${songs.length}` : ''}` })]);
    list.append(renderTools());
    if (!lib.songs.length) list.append(element('p', { className: 'muted ku-small', text: 'Пока пусто. Добавьте песню выше: название, потом атмосфера, звучание и слова.' }));
    for (const folder of lib.folders) {
      const inside = songs.filter(song => song.folderId === folder.id);
      if (inside.length || !query) list.append(renderGroup(folder, inside));
    }
    const loose = songs.filter(song => !lib.folders.some(folder => folder.id === song.folderId));
    if (loose.length || (!lib.folders.length && !query)) list.append(renderGroup(null, loose));
    view.append(list);
    return view;
  }

  return { renderSongs };
}

export const SONGS_STYLE = `
.ku-songs-numbers{gap:10px;margin-top:8px}
.ku-songs-num{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--k-muted);min-width:110px;flex:0 1 150px}
.ku-songs-num input{width:100%}
.ku-songs-add{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,.8fr) auto;gap:6px;align-items:center}
.ku-songs-add input,.ku-songs-add select{min-width:0;width:100%}
.ku-songs-head{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,.8fr);gap:6px}
.ku-songs-head input,.ku-songs-head select{min-width:0;width:100%}
.ku-songs .field small{font-size:11px}
.ku-songs textarea{width:100%}
.ku-songs-probe{margin:6px 0 0;color:var(--k-muted)}
@container (max-width:560px){.ku-songs-add,.ku-songs-head{grid-template-columns:1fr}}
`;
