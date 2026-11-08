import { button, downloadJson, element, formatTime, nextControlId } from '../helpers.js';
import { icon } from '../icons.js';
import { nextSceneText } from '../../integration/chronicle-actions.js';

/** Settings page: section menu + rows with switches; narrow panels stack the menu on top. */
export const SETTINGS_STYLE = `
.set-shell{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;container-type:inline-size}
.set-nav{flex:1 1 190px;max-width:230px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0}
.set-nav button{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border:0;border-radius:9px;background:transparent;color:var(--rs-text);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.set-nav button .ku-ico{color:var(--rs-muted)}
.set-nav button:hover{background:color-mix(in srgb,var(--rs-accent) 8%,transparent)}
.set-nav button.on{background:color-mix(in srgb,var(--rs-accent) 16%,transparent);color:var(--rs-accent);font-weight:700}
.set-nav button.on .ku-ico{color:var(--rs-accent)}
.set-body{flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:14px;max-width:860px}
.set-head h3{margin:0;font-size:20px}.set-head p{margin:4px 0 0;font-size:12px}
.set-group{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--rs-muted);margin-top:6px}
.set-list{border:1px solid var(--rs-line);border-radius:14px;background:var(--rs-panel);overflow:hidden}
.set-item+.set-item{border-top:1px solid var(--rs-line)}
.set-row{display:flex;align-items:center;gap:12px;padding:11px 14px;min-height:46px}
.set-label{flex:1;min-width:0;font-size:13.5px}
.set-hint{margin:-4px 14px 10px;font-size:12px;line-height:1.45;color:var(--rs-muted)}
.set-help{width:24px;height:24px;min-height:24px;padding:0;border-radius:50%;border:1px solid var(--rs-line);background:transparent;color:var(--rs-muted);font:inherit;font-size:11px;font-weight:700;cursor:pointer;flex:0 0 auto}
.set-help[aria-expanded=true]{border-color:var(--rs-accent);color:var(--rs-accent)}
.set-switch{appearance:none;-webkit-appearance:none;width:38px;height:22px;border-radius:22px;background:var(--rs-track);border:1px solid var(--rs-line);position:relative;margin:0;flex:0 0 auto;cursor:pointer}
.set-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--rs-muted);transition:left .15s}
.set-switch:checked{background:var(--rs-accent);border-color:var(--rs-accent)}
.set-switch:checked::after{left:18px;background:var(--rs-bg)}
.set-switch:focus-visible{outline:2px solid var(--rs-accent);outline-offset:2px}
.set-slider{display:flex;align-items:center;gap:10px;width:min(220px,45%)}
.set-slider input{flex:1;min-width:0}
.set-value{min-width:30px;text-align:right;font-weight:700;color:var(--rs-accent);font-variant-numeric:tabular-nums}
.set-number{width:110px!important;flex:0 0 auto}
.set-modules{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:12px}
.set-module{border:1px solid var(--rs-line);border-radius:16px;background:var(--rs-panel);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.set-module.off{opacity:.65}
.set-module-head{display:flex;align-items:center;gap:12px}
.set-module-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:0 0 auto;background:color-mix(in srgb,var(--rs-accent) 16%,transparent);color:var(--rs-accent)}
.set-module.off .set-module-icon{background:var(--rs-inset);color:var(--rs-muted)}
.set-module-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.set-module-title .muted{font-size:12px}
.set-module-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.set-pills{display:flex;gap:6px;flex-wrap:wrap;flex:1}
.set-pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid var(--rs-line);color:var(--rs-muted)}
.set-link{border:0;background:transparent;color:var(--rs-accent);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:4px 0}
.set-total{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--rs-accent) 12%,transparent)}
.set-total strong{font-size:20px}
.set-segment{display:flex;gap:4px;padding:4px;border-radius:12px;background:var(--rs-inset);border:1px solid var(--rs-line);flex-wrap:wrap}
.set-segment button{flex:1 1 110px;min-height:46px;border:0;border-radius:9px;background:transparent;color:var(--rs-muted);font:inherit;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer}
.set-segment button strong{font-size:13px}.set-segment button span{font-size:11px}
.set-segment button.on{background:var(--rs-bg);color:var(--rs-accent);box-shadow:0 1px 4px var(--k-shadow)}
.set-ladder{display:flex;align-items:stretch;flex-wrap:wrap;gap:4px;border:1px solid var(--rs-line);border-radius:16px;background:var(--rs-inset);padding:14px 10px}
.set-step{flex:1 1 70px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
.set-step strong{font-size:28px;line-height:1;font-variant-numeric:tabular-nums}
.set-step .muted{font-size:12px}
.set-bar{width:70%;height:6px;border-radius:6px;background:var(--rs-track);overflow:hidden}
.set-bar i{display:block;height:100%;background:var(--rs-accent)}
.set-arrow{flex:0 0 auto;align-self:center;font-size:11px;font-weight:700;color:var(--rs-muted);padding:0 4px}
.set-arrow::before{content:'→';display:block;text-align:center;font-size:16px}
.set-note{display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;font-size:12px}
@container (max-width:640px){.set-nav{max-width:none;flex-direction:row;overflow-x:auto;position:static;flex-basis:100%}.set-nav button{white-space:nowrap;flex:0 0 auto}.set-slider{width:100%}.set-row{flex-wrap:wrap}}
`;

/**
 * Lorebooks, history, settings (prompt, embeddings, aux API, diagnostics, data transfer).
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createSystemPages(ctx) {
  const { facade, options, shadow } = ctx;
  const act = (...args) => ctx.act(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  const promptSectionsOpen = new Set(['lines']); // "What the model gets": open sections

  function renderLorebooks() {
    const lorebooks = ctx.snapshot.lorebooks || {};
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Лорбуки текущего чата' }), element('p', { text: lorebooks.status || '' })]);
    const select = element('select', { 'aria-label': 'Доступные лорбуки', style: { flex: '1', minWidth: '160px' } });
    select.append(element('option', { value: '', text: 'Выберите книгу' }));
    for (const name of lorebooks.available || []) if (!(lorebooks.selected || []).includes(name)) select.append(element('option', { value: name, text: name }));
    const lorebookSearchButton = button('Найти персонажей в лорбуках', 'btn', () => act('onAnalyzeLorebooks', {}, 'lorebooks-analyze'));
    if (ctx.snapshot.modelBusy) lorebookSearchButton.disabled = true;
    const actions = element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '12px 0' } }, [
      button('Подключить', 'btn primary', () => { if (select.value) act('onLinkLorebook', { name: select.value }); }),
      button('Обновить список', 'btn', () => act('onRefreshLorebooks', {})),
      lorebookSearchButton,
    ]);
    card.append(element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [select]), actions);
    const cardWorlds = (lorebooks.cardWorlds || []).filter(name => !(lorebooks.selected || []).includes(name));
    for (const name of cardWorlds) {
      card.append(element('div', { className: 'item', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0' } }, [
        element('span', { style: { flex: '1 1 200px' }, text: `Лорбук карточки: «${name}» — не подключён к анализатору.` }),
        button('Подключить книгу карточки', 'btn primary', () => act('onLinkLorebook', { name })),
      ]));
    }
    for (const name of lorebooks.selected || []) {
      const row = element('div', { className: 'item', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '8px 0' } }, [
        element('strong', { text: name }),
      ]);
      const unlink = button('×', 'btn icon', () => act('onUnlinkLorebook', { name }), `Отвязать ${name}`);
      unlink.style.cssText = 'flex:0 0 auto;width:26px;height:26px;min-height:26px;padding:0;font-size:13px;line-height:1;border-radius:6px';
      row.append(unlink);
      card.append(row);
    }
    return card;
  }

  function renderJournal() {
    const card = element('div', { className: 'card' }, [element('h3', { text: 'История изменений' })]);
    // The journal is chronological (the widget relies on that); show newest first.
    const entries = [...(ctx.snapshot.journal || ctx.snapshot.history || [])].reverse();
    if (!entries.length) card.append(element('div', { className: 'empty', text: 'Изменений отношений пока нет.' }));
    for (const entry of entries) {
      const row = element('div', { className: 'journal-row', style: { padding: '8px 0', borderBottom: '1px solid var(--rs-line)' } }, [
        element('time', { text: formatTime(entry.timestamp || entry.createdAt) }),
        element('strong', { text: entry.label || entry.type || 'Изменение' }),
        element('span', { text: entry.description || entry.reason || entry.text || `${entry.metric || ''} ${entry.delta > 0 ? '+' : ''}${entry.delta ?? ''}`.trim() }),
      ]);
      card.append(row);
    }
    return card;
  }

  /** Settings: a section menu on the left, one section at a time; every change applies at once. */
  let settingsSection = 'modules';

  const SETTINGS_SECTIONS = [
    ['modules', 'Модули', 'grid'],
    ['behaviour', 'Как работает', 'bolt'],
    ['relations', 'Отношения', 'heart'],
    ['scene', 'Знания и сцена', 'stage'],
    ['chronicle', 'Хроника и сжатие', 'list'],
    ['prompt', 'Что получает модель', 'chat'],
    ['models', 'Модели и API', 'spark'],
    ['data', 'Данные', 'download'],
    ['diagnostics', 'Диагностика', 'pulse'],
  ];

  const tokens = value => `~${Math.round(Number(value) || 0).toLocaleString('ru-RU')}`;
  const change = patch => act('onSettingsChange', { settings: patch }, 'settings-change');

  /** A row: label, optional "?" that unfolds a one-line hint, and the control on the right. */
  function settingRow(label, control, hint = '') {
    const row = element('div', { className: 'set-row' }, [element('span', { className: 'set-label', text: label })]);
    if (hint) {
      const note = element('p', { className: 'set-hint', text: hint, hidden: true });
      const help = button('?', 'set-help', () => { note.hidden = !note.hidden; help.setAttribute('aria-expanded', String(!note.hidden)); }, `Подробнее: ${label}`);
      help.setAttribute('aria-expanded', 'false');
      row.append(help);
      row.append(control);
      return element('div', { className: 'set-item' }, [row, note]);
    }
    row.append(control);
    return element('div', { className: 'set-item' }, [row]);
  }

  function toggle(label, checked, onChange) {
    const input = element('input', { type: 'checkbox', className: 'set-switch', checked: Boolean(checked), 'aria-label': label });
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function switchRow(label, key, hint, current) {
    return settingRow(label, toggle(label, current[key] !== false, value => change({ [key]: value })), hint);
  }

  /** A slider with its value; the change is sent when the slider is let go. */
  function slider(label, value, min, max, onCommit) {
    const output = element('output', { className: 'set-value', text: String(value) });
    const input = element('input', { type: 'range', min, max, value, 'aria-label': label });
    input.addEventListener('input', () => { output.textContent = input.value; });
    input.addEventListener('change', () => onCommit(Number(input.value)));
    return element('span', { className: 'set-slider' }, [input, output]);
  }

  function numberInput(label, value, min, max, onCommit) {
    const input = element('input', { type: 'number', min, max, value, className: 'set-number', 'aria-label': label });
    input.addEventListener('change', () => onCommit(Number(input.value)));
    return input;
  }

  function list(...rows) {
    return element('div', { className: 'set-list' }, rows);
  }

  function heading(title, subtitle = '') {
    return element('div', { className: 'set-head' }, [element('h3', { text: title }), subtitle ? element('p', { className: 'muted', text: subtitle }) : null]);
  }

  function moduleCard({ iconName, title, subtitle, on, onToggle, pills, section }) {
    const card = element('div', { className: `set-module${on ? '' : ' off'}` });
    const head = element('div', { className: 'set-module-head' }, [
      element('span', { className: 'set-module-icon' }, [icon(iconName)]),
      element('div', { className: 'set-module-title' }, [element('strong', { text: title }), element('span', { className: 'muted', text: subtitle })]),
      toggle(title, on, onToggle),
    ]);
    const foot = element('div', { className: 'set-module-foot' }, [
      element('div', { className: 'set-pills' }, pills.map(text => element('span', { className: 'set-pill', text }))),
      button('Настроить', 'set-link', () => { settingsSection = section; ctx.render(); }),
    ]);
    card.append(head, foot);
    return card;
  }

  function sectionModules(current) {
    const chronicle = current.chronicle ?? {};
    const snap = ctx.snapshot;
    const total = (snap.promptTokens ?? 0) + (snap.knowledgeTokens ?? 0) + (snap.sceneTokens ?? 0) + (snap.chronicleTokens ?? 0);
    return [
      heading('Модули', 'Выключенный модуль ничего не отправляет модели.'),
      element('div', { className: 'set-modules' }, [
        moduleCard({
          iconName: 'heart', title: 'Отношения', subtitle: 'шкалы, воспоминания, хедканоны', section: 'relations',
          on: current.injectPrompt !== false, onToggle: value => change({ injectPrompt: value }),
          pills: [`промпт ${tokens(snap.promptTokens)}`],
        }),
        moduleCard({
          iconName: 'eye', title: 'Знания', subtitle: 'кто что видел, утечки, знакомства', section: 'scene',
          on: current.trackKnowledge !== false, onToggle: value => change({ trackKnowledge: value, sendKnowledge: value }),
          pills: [`промпт ${tokens(snap.knowledgeTokens)}`],
        }),
        moduleCard({
          iconName: 'pin', title: 'Сцена', subtitle: 'время, места, одежда, вещи', section: 'scene',
          on: current.trackWorld !== false, onToggle: value => change({ trackWorld: value, sendScene: value }),
          pills: [`промпт ${tokens(snap.sceneTokens)}`],
        }),
        moduleCard({
          iconName: 'list', title: 'Хроника', subtitle: 'сводки сцен, глав и арок', section: 'chronicle',
          on: chronicle.enabled === true, onToggle: value => act('onChronicleSettings', { changes: { enabled: value } }),
          pills: [`промпт ${tokens(snap.chronicleTokens)}`, 'свои запросы к модели'],
        }),
      ]),
      element('div', { className: 'set-total' }, [
        element('span', { className: 'muted', text: 'Сейчас в промпт' }),
        element('strong', { text: tokens(total) }),
        element('span', { className: 'muted', text: `токенов · анализ за сессию ${tokens(snap.analysisTokens)}` }),
      ]),
    ];
  }

  function sectionBehaviour(current) {
    const threshold = slider('Порог скачка', current.largeChangeThreshold ?? 12, 4, 25, value => change({ largeChangeThreshold: value }));
    return [
      heading('Как работает'),
      list(
        switchRow('Проверять ответы сами', 'autoTrack', 'После каждого ответа бота анализатор сам записывает отношения, знания и сцену.', current),
        switchRow('Летописец отдельным запросом', 'knowledgeSeparateRequest', 'Знания и сцена уйдут вторым запросом. Дороже, но слабые модели реже путаются в большом ответе.', current),
        switchRow('Спрашивать о крупных скачках', 'confirmLargeChanges', 'Если шкала меняется сильнее порога, Кулисы спросят, применять ли.', current),
        settingRow('Порог скачка', threshold),
        switchRow('Чипы «на сцене» над вводом', 'sceneChips', 'Кто на сцене, одним кликом убрать или вывести. Под ответами — отметки утечек и ляпов.', current),
        switchRow('Компактный виджет', 'widgetEnabled', 'Плавающая мини-панель отношений поверх чата.', current),
      ),
    ];
  }

  function tempoSelect() {
    const current = ctx.snapshot.ui?.tempo ?? 'normal';
    const select = element('select', { 'aria-label': 'Темп отношений в этом чате' },
      [['very-slow', 'Очень медленно'], ['slow', 'Медленно'], ['normal', 'Обычно'], ['fast', 'Быстро']]
        .map(([value, text]) => element('option', { value, text, selected: value === current })));
    select.addEventListener('change', () => act('onSetTempo', { tempo: select.value }, 'tempo'));
    return select;
  }

  function sectionRelations(current) {
    return [
      heading('Отношения'),
      list(
        settingRow('Темп отношений в этом чате', tempoSelect(), 'Насколько сильно каждый ответ двигает шкалы. Очень медленно — ×0,4 и не больше ±3 за ответ, медленно — ×0,65 и не больше ±6, быстро — ×1,5. Изменение не пропадает совсем: минимум ±1. Темп шкалы в «Факторах роста» линии действует поверх этого.'),
        switchRow('Связанные шкалы', 'linkedScales', 'Доверие тянет за собой дружбу и т. п. Выключите, если хотите менять каждую шкалу только по прямым уликам.', current),
        switchRow('Новые линии между персонажами', 'autoCharacterLines', 'Анализатор сам заводит линию, когда двое впервые взаимодействуют.', current),
        switchRow('Спрашивать перед линией к персоне', 'confirmPersonaLines', '', current),
        switchRow('Воспоминания в промпт', 'sendMemories', '', current),
        switchRow('Напряжения в промпт', 'sendTensions', '', current),
        switchRow('Факторы роста в промпт', 'sendFactors', '', current),
        switchRow('Хедканоны в промпт', 'sendHeadcanons', 'Только подходящие к сцене.', current),
        switchRow('Автозаполнение хедканонов', 'autoHeadcanons', 'Анализатор добавляет новые устойчивые факты о парах с включёнными авто-хедканонами.', current),
        settingRow('Хедканонов к сцене', slider('Хедканонов к сцене', current.headcanonLimit ?? 8, 1, 30, value => change({ headcanonLimit: value }))),
        settingRow('Объём отношений, символов', numberInput('Объём отношений', current.maxPromptCharacters ?? 4000, 800, 20000, value => change({ maxPromptCharacters: value })), 'Не влезает всё — уходят самые слабые линии и старые записи. ~1 токен на 3–4 символа.'),
      ),
    ];
  }

  function sectionScene(current) {
    return [
      heading('Знания и сцена'),
      element('div', { className: 'set-group', text: 'Знания' }),
      list(
        switchRow('Летописец знаний', 'trackKnowledge', 'Кто в сцене, что произошло, кто что узнал, кто с кем познакомился, утечки.', current),
        switchRow('Знания в промпт', 'sendKnowledge', 'Кто чего НЕ знает и кто с кем не знаком.', current),
        settingRow('Событий летописцу', slider('Событий летописцу', current.knowledgeCandidates ?? 15, 1, 40, value => change({ knowledgeCandidates: value })), 'Больше — точнее ловит утечки, но дороже.'),
        settingRow('Объём знаний, символов', numberInput('Объём знаний', current.knowledgePromptCharacters ?? 2000, 300, 8000, value => change({ knowledgePromptCharacters: value })), 'Не влезает — первыми уходят слухи, незнакомства и секреты остаются.'),
      ),
      element('div', { className: 'set-group', text: 'Сцена' }),
      list(
        switchRow('Летописец сцены', 'trackWorld', 'Время (24 ч), место, одежда, состояние и вещи. Закреплённое вручную не меняется.', current),
        switchRow('Сцена в промпт', 'sendScene', 'Только тех, кто на сцене.', current),
        switchRow('Календарь в промпт', 'sendCalendar', 'Дата истории, события сегодняшнего дня и то, что скоро. Нужна дата истории в «Мир → Календарь».', current),
        switchRow('Сообщать, если одежда не влезла', 'looksWarning', 'Всплывающее сообщение, когда описания из гардероба у кого-то на сцене перестают влезать в объём сцены: один раз, и снова — только если они влезли, а потом опять нет.', current),
        settingRow('Объём сцены, символов', numberInput('Объём сцены', current.scenePromptCharacters ?? 1500, 300, 6000, value => change({ scenePromptCharacters: value })), 'Не влезает — первыми уходят описание места и мелкие вещи.'),
        settingRow('Описание одной вещи, символов', numberInput('Описание одной вещи', current.looksCardCharacters ?? 300, 80, 1000, value => change({ looksCardCharacters: value })), 'Сколько от описания каждой карточки гардероба уходит модели. Дальше — обрезается; что обрезано, видно в «Проверке» и в досье.'),
        settingRow('Всё надетое на персонаже, символов', numberInput('Всё надетое', current.looksCharacterCharacters ?? 1200, 200, 4000, value => change({ looksCharacterCharacters: value })), 'Общий предел описаний одного персонажа. Больше лимит — больше нужен и объём сцены.'),
        ...(ctx.looksAdvice?.() ? [ctx.looksAdvice()] : []),
        ...(ctx.snapshot.looksFit?.need !== undefined ? [element('p', { className: 'ku-fit dropped ku-small', text: `Описания из гардероба сейчас не влезают. ${ctx.needText?.(ctx.snapshot.looksFit) ?? ''} Примерно 1 токен на 3–4 символа русского текста.` })] : []),
        settingRow('Вещи в тень через, сообщений', numberInput('Вещи в тень через', current.itemsDormantAfter ?? 40, 0, 500, value => change({ itemsDormantAfter: value })), 'Обычная вещь, о которой столько сообщений ни слова, хранится, но не отправляется модели. Упомянут снова — вернётся. 0 — никогда.'),
      ),
    ];
  }

  function sectionChronicle() {
    const info = facade.invoke('onChronicleGet', {}) ?? null;
    if (!info) return [heading('Хроника и сжатие'), element('p', { className: 'muted', text: 'Хроника недоступна.' })];
    const { config, stats } = info;
    const setChronicle = changes => act('onChronicleSettings', { changes });
    const presets = [['detailed', 'Подробно', 'больше деталей'], ['balanced', 'Сбалансированно', 'по умолчанию'], ['economy', 'Экономно', 'меньше токенов'], ['custom', 'Своё', 'ползунки']];
    const segment = element('div', { className: 'set-segment', role: 'radiogroup', 'aria-label': 'Режим сжатия' }, presets.map(([value, title, sub]) => {
      const node = element('button', { type: 'button', role: 'radio', className: config.preset === value ? 'on' : '', 'aria-checked': String(config.preset === value) }, [element('strong', { text: title }), element('span', { text: sub })]);
      node.addEventListener('click', () => setChronicle({ preset: value }));
      return node;
    }));
    const step = (label, value, fill) => element('div', { className: 'set-step' }, [
      element('span', { className: 'muted', text: label }), element('strong', { text: String(value) }),
      element('span', { className: 'set-bar' }, [element('i', { style: { width: `${Math.max(0, Math.min(100, fill))}%` } })]),
    ]);
    const arrow = text => element('div', { className: 'set-arrow', text });
    const total = Math.max(1, stats.messages);
    const ladder = element('div', { className: 'set-ladder', 'aria-label': 'Этот чат сейчас' }, [
      step('сообщения', stats.messages, 100), arrow(`по ${config.sceneEvery}`),
      step('сцены', stats.scenes, (stats.scenes * config.sceneEvery * 100) / total), arrow(`по ${config.chapterOf}`),
      step('главы', stats.chapters, (stats.chapters * config.sceneEvery * config.chapterOf * 100) / total), arrow(`по ${config.arcOf}`),
      step('арки', stats.arcs, (stats.arcs * config.sceneEvery * config.chapterOf * config.arcOf * 100) / total),
    ]);
    const run = button(info.running ? 'Сжимаю…' : 'Сжать сейчас', 'btn', async () => {
      run.disabled = true;
      try {
        const result = await facade.invoke('onChronicleRun', {});
        setStatus(`Хроника: новых сцен ${result?.scenes ?? 0}, сжатий ${result?.merges ?? 0}`);
      } catch (error) { setStatus(error?.message || 'Хроника не записалась', true); }
      finally { run.disabled = false; ctx.render(); }
    });
    run.disabled = info.running || !stats.pending;
    return [
      heading('Хроника и сжатие', 'Чем выше уровень, тем короче пересказ и меньше токенов.'),
      list(settingRow('Хроника', toggle('Хроника', config.enabled, value => setChronicle({ enabled: value })), 'Пишет сводки в фоне после ответов, своими запросами к модели. Сводки идут модели перед историей чата.')),
      segment,
      ladder,
      element('div', { className: 'set-note' }, [
        element('span', { className: 'muted', text: `Ждут сжатия: ${stats.pending}. ${config.enabled ? nextSceneText(stats) : ''} В промпт уходит ${tokens(ctx.snapshot.chronicleTokens)} токенов.` }),
        run,
      ]),
      list(
        settingRow('Сводка сцены каждые', slider('Сообщений на сцену', config.sceneEvery, 4, 100, value => setChronicle({ sceneEvery: value })), 'Сдвиньте любой ползунок — режим станет «Своё».'),
        settingRow('Глава из сцен', slider('Сцен на главу', config.chapterOf, 2, 12, value => setChronicle({ chapterOf: value }))),
        settingRow('Арка из глав', slider('Глав на арку', config.arcOf, 2, 12, value => setChronicle({ arcOf: value }))),
      ),
      list(
        settingRow('Прятать сжатые сообщения от модели', toggle('Прятать сжатые сообщения', config.hideSummarized, value => setChronicle({ hideSummarized: value })), 'Сжатые сообщения не идут модели — вместо них сводки. Сам чат не меняется.'),
        settingRow('Последние сообщения всегда целиком', numberInput('Сколько последних сообщений не сжимать', config.keepRecent, 2, 200, value => setChronicle({ keepRecent: value })), 'Первая сводка появится, когда сообщений станет больше, чем «каждые» + это число.'),
        settingRow('Объём хроники, символов', numberInput('Объём хроники', config.maxPromptCharacters, 500, 30000, value => setChronicle({ maxPromptCharacters: value })), 'Не влезает — первыми уходят самые старые сводки.'),
      ),
    ];
  }

  function sectionPrompt() {
    const snap = ctx.snapshot;
    const preview = element('div', { className: 'card' }, [element('h3', { text: 'Отношения и знания' })]);
    preview.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Отношения ${tokens(snap.promptTokens)}, знания ${tokens(snap.knowledgeTokens)} токенов. Пусто — проверьте, что связь не исключена персоной и значения не нулевые.` }));
    preview.append(...renderPromptSections([snap.promptPreview || '', knowledgeLines(snap.knowledgePreview)].filter(Boolean).join('\n')));
    const block = (title, text, count) => {
      const details = element('details', { className: 'fold', style: { marginTop: '12px' } }, [element('summary', {}, [title, element('span', { className: 'muted', text: ` · ${tokens(count)} токенов` })])]);
      details.append(element('div', { className: 'fold-body' }, [element('pre', { className: 'prompt-lines', text: text || 'Пока пусто.' })]));
      return details;
    };
    return [
      heading('Что получает модель', 'Всё, что Кулисы добавят к следующему ответу.'),
      preview,
      block('Сцена', snap.scenePreview, snap.sceneTokens),
    ];
  }

  function renderSettings() {
    const current = ctx.snapshot.settings || {};
    const nav = element('nav', { className: 'set-nav', 'aria-label': 'Разделы настроек' }, SETTINGS_SECTIONS.map(([id, label, iconName]) => {
      const node = element('button', { type: 'button', className: settingsSection === id ? 'on' : '', 'aria-current': settingsSection === id ? 'page' : null }, [icon(iconName), element('span', { text: label })]);
      node.addEventListener('click', () => { settingsSection = id; ctx.render(); });
      return node;
    }));
    let body;
    switch (settingsSection) {
      case 'behaviour': body = sectionBehaviour(current); break;
      case 'relations': body = sectionRelations(current); break;
      case 'scene': body = sectionScene(current); break;
      case 'chronicle': body = sectionChronicle(); break;
      case 'prompt': body = sectionPrompt(); break;
      case 'models': body = [heading('Модели и API'), renderAuxApi(), renderVisionApi(), renderEmbeddings()]; break;
      case 'data': body = [heading('Данные'), renderImageStorage(), renderHoraeImport(), renderDataTransfer()]; break;
      case 'diagnostics': body = [heading('Диагностика'), renderDiagnostics()]; break;
      default: body = sectionModules(current);
    }
    return element('div', { className: 'set-shell' }, [nav, element('div', { className: 'set-body' }, body)]);
  }

  /** The injection split by kind, each section foldable with a counter, so nothing has to be searched for. */
  /** Data lines of the knowledge block (its header and rules are the same every time). */
  function knowledgeLines(block) {
    const text = String(block ?? '');
    const start = text.indexOf('\n');
    const end = text.indexOf('\n\nRules:');
    return start >= 0 && end > start ? text.slice(start + 1, end) : '';
  }

  function renderPromptSections(text) {
    const sections = [
      ['scene', 'Сцена и знакомства', line => /^(scene:|strangers\[|seen\[|dead\[)/.test(line)],
      ['knowledge', 'Кто чего не знает', line => /^(unknown|heard|secret)\[/.test(line)],
      ['rules', 'Правила: треугольники', line => line.startsWith('triangle ')],
      ['memories', 'Воспоминания', line => /^(shared|secret)-memories/.test(line)],
      ['tensions', 'Напряжения', line => /^(shared|secret)-tensions/.test(line)],
      ['headcanons', 'Хедканоны', line => line.startsWith('headcanon[')],
      ['lines', 'Линии и шкалы', () => true],
    ];
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const groups = new Map(sections.map(([key]) => [key, []]));
    for (const line of lines) groups.get(sections.find(([, , test]) => test(line))[0]).push(line);
    const order = ['scene', 'knowledge', 'lines', 'memories', 'tensions', 'headcanons', 'rules'];
    const nodes = order.map(key => {
      const [, title] = sections.find(([id]) => id === key);
      const items = groups.get(key);
      const details = element('details', { className: 'prompt-section' });
      details.open = promptSectionsOpen.has(key);
      details.addEventListener('toggle', () => { if (details.open) promptSectionsOpen.add(key); else promptSectionsOpen.delete(key); });
      details.append(element('summary', { text: `${title} · ${items.length}` }));
      if (key === 'headcanons') details.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '4px 0' }, text: headcanonStatusText() }), button('Подобрать к текущей сцене', 'btn', () => act('onRefreshScene', {}, 'scene-refresh')));
      details.append(element('pre', { className: 'prompt-lines', text: items.join('\n') || '—' }));
      return details;
    });
    if (!lines.length) nodes.unshift(element('p', { className: 'muted', text: text || 'Пока пусто.' }));
    return nodes;
  }

  function headcanonStatusText() {
    const info = ctx.snapshot.headcanonInfo ?? {};
    if (info.disabled) return 'Отправка хедканонов выключена в настройках.';
    if (!info.enabled) return 'Включённых хедканонов нет.';
    if (info.error) return `Не удалось подобрать: ${info.error}`;
    return `Включено: ${info.enabled}, подобрано к текущей сцене: ${info.picked}. Отбор: ${info.method === 'semantic' ? 'по смыслу' : 'оба участника пары упомянуты в последних сообщениях (персона — всегда)'}. Подбор обновляется перед каждой генерацией.${info.note ? ` ${info.note}` : ''}`;
  }

  /** Semantic choice of headcanons: a model in the browser or an embeddings API. */
  function renderEmbeddings() {
    const config = { ...(ctx.snapshot.settings?.embeddings ?? {}) };
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Смысловой поиск хедканонов' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Перед каждой генерацией к сцене подбираются хедканоны, близкие ей по смыслу, — даже если имён в тексте нет. Выключено — подбор по упоминаниям участников пары.' }),
    ]);
    const field = (label, control, hint) => element('div', { className: 'field' }, [
      element('label', { text: label }), control, ...(hint ? [element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: hint })] : []),
    ]);
    const mode = element('select', { 'aria-label': 'Источник эмбеддингов' });
    for (const [value, text] of [['off', 'Выключен — подбор по упоминаниям'], ['local', 'Локальная модель в браузере'], ['api', 'API эмбеддингов']]) {
      mode.append(element('option', { value, text, selected: (config.mode || 'off') === value }));
    }
    const localModel = element('select', { 'aria-label': 'Локальная модель' });
    for (const model of facade.invoke('onLocalEmbeddingModels', {}) ?? []) localModel.append(element('option', { value: model.id, text: model.label, selected: model.id === config.localModel }));
    const localBlock = element('div', {}, [
      field('Модель', localModel, 'Скачивается один раз и дальше берётся из кэша браузера. В памяти занимает примерно столько же, сколько весит. Модели тяжелее 300 МБ — для компьютера; на телефоне лучше e5-small или API. После смены модели хедканоны один раз пересчитываются заново. «Проверить» скачивает модель сразу.'),
    ]);
    const format = element('select', { 'aria-label': 'Формат API' });
    for (const [value, text] of [['openai', 'OpenAI-совместимый (/embeddings)'], ['gemini', 'Gemini (batchEmbedContents)']]) format.append(element('option', { value, text, selected: (config.format || 'openai') === value }));
    const url = element('input', { type: 'text', value: config.url ?? '', placeholder: 'https://api.openai.com/v1', 'aria-label': 'URL API эмбеддингов' });
    const key = element('input', { type: 'password', value: config.key ?? '', autocomplete: 'off', 'aria-label': 'Ключ API эмбеддингов' });
    const reveal = button('👁', 'icon', () => { key.type = key.type === 'password' ? 'text' : 'password'; }, 'Показать или скрыть ключ');
    const model = element('input', { type: 'text', value: config.model ?? '', placeholder: 'text-embedding-3-small', 'aria-label': 'Модель эмбеддингов' });
    const apiBlock = element('div', {}, [
      field('Формат', format, 'Для официального Gemini укажите базовый URL Google Generative Language API: https://generativelanguage.googleapis.com/v1beta'),
      field('URL API', url),
      field('Ключ API', element('div', { className: 'row', style: { flexWrap: 'nowrap' } }, [key, reveal]), 'Хранится в настройках расширений SillyTavern. Запрос идёт из браузера; если провайдер его блокирует (CORS), используется CORS-прокси SillyTavern, когда он включён.'),
      field('Модель', model),
    ]);
    const threshold = element('input', { type: 'number', min: 0, max: 0.95, step: 0.05, value: config.threshold ?? 0, 'aria-label': 'Порог сходства' });
    const commonBlock = element('div', {}, [
      field('Порог сходства (0 — просто брать самые близкие)', threshold, 'Хедканоны с меньшим сходством со сценой не отправляются. Сколько отправлять — «Сколько хедканонов к сцене» выше.'),
    ]);
    const collect = () => ({
      mode: mode.value, localModel: localModel.value, format: format.value,
      url: url.value, key: key.value, model: model.value, threshold: Number(threshold.value),
    });
    const sync = () => {
      localBlock.hidden = mode.value !== 'local';
      apiBlock.hidden = mode.value !== 'api';
      commonBlock.hidden = mode.value === 'off';
    };
    mode.addEventListener('change', sync);
    sync();
    const test = button('Проверить', 'btn', async () => {
      test.disabled = true;
      setStatus(mode.value === 'local' ? 'Загружаю модель и считаю пример… первый раз это может занять минуту' : 'Проверяю API эмбеддингов…');
      try { setStatus(await facade.invoke('onTestEmbeddings', { embeddings: collect() })); }
      catch (error) { setStatus(error?.message || 'Эмбеддинги не работают', true); }
      finally { test.disabled = false; }
    });
    const save = button('Сохранить', 'btn primary', () => {
      act('onSettingsChange', { settings: { embeddings: collect() } }, 'settings-change');
      setStatus('Смысловой поиск сохранён');
    });
    card.append(field('Источник', mode), localBlock, apiBlock, commonBlock, element('div', { className: 'row', style: { marginTop: '10px' } }, [save, test]));
    return card;
  }

  /** Auxiliary model for the extension's own requests: a SillyTavern profile or a custom URL. */
  function renderAuxApi() {
    const aux = { ...(ctx.snapshot.settings?.aux ?? {}) };
    aux.purposes = { ...(aux.purposes ?? {}) };
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Вспомогательный API' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Анализ и генерация расширения могут идти через отдельную, более дешёвую модель, не нагружая основной API.' }),
    ]);
    const field = (label, control, hint) => element('div', { className: 'field' }, [
      element('label', { text: label }), control, ...(hint ? [element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: hint })] : []),
    ]);
    const mode = element('select', { 'aria-label': 'Режим вспомогательного API' });
    for (const [value, text] of [['off', 'Выключен — всё через основной API'], ['profile', 'Профиль подключения SillyTavern'], ['custom', 'Свой URL (OpenAI-совместимый)']]) {
      mode.append(element('option', { value, text, selected: (aux.mode || 'off') === value }));
    }

    const profileSelect = element('select', { 'aria-label': 'Профиль подключения' });
    const fillProfiles = () => {
      const profiles = facade.invoke('onAuxProfiles', {}) ?? [];
      profileSelect.replaceChildren(element('option', { value: '', text: profiles.length ? 'Выберите профиль' : 'Профилей нет' }),
        ...profiles.map(profile => element('option', { value: profile.id, text: profile.name, selected: profile.id === aux.profileId })));
    };
    fillProfiles();
    const profileBlock = element('div', {}, [
      field('Профиль', profileSelect, 'Ключ хранится в секретах SillyTavern, запрос идёт через её сервер. Профиль создаётся в Connection Manager (значок вилки в верхней панели таверны).'),
      button('Обновить список профилей', 'btn', fillProfiles),
    ]);

    const url = element('input', { type: 'text', value: aux.url ?? '', placeholder: 'https://api.openai.com/v1', 'aria-label': 'URL API' });
    const key = element('input', { type: 'password', value: aux.key ?? '', autocomplete: 'off', 'aria-label': 'Ключ API' });
    const reveal = button('👁', 'icon', () => { key.type = key.type === 'password' ? 'text' : 'password'; }, 'Показать или скрыть ключ');
    const modelList = element('datalist', { id: nextControlId('rs-aux-models') });
    const model = element('input', { type: 'text', value: aux.model ?? '', 'aria-label': 'Модель' });
    model.setAttribute('list', modelList.id);
    const fetchModels = button('Получить модели', 'btn', async () => {
      fetchModels.disabled = true;
      try {
        const models = await facade.invoke('onFetchAuxModels', { url: url.value, key: key.value });
        modelList.replaceChildren(...models.map(id => element('option', { value: id })));
        setStatus(`Моделей найдено: ${models.length} — выберите в поле «Модель»`);
      } catch (error) { setStatus(error?.message || 'Не удалось получить список моделей', true); }
      finally { fetchModels.disabled = false; }
    });
    const customBlock = element('div', {}, [
      field('URL API', url, 'Базовый адрес OpenAI-совместимой точки, например https://api.openai.com/v1'),
      field('Ключ API', element('div', { className: 'row', style: { flexWrap: 'nowrap' } }, [key, reveal]),
        'Хранится в настройках расширений SillyTavern на этом сервере; в журнал диагностики и экспорт чата не попадает. Запросы идут через сервер SillyTavern, поэтому блокировок CORS нет; в секреты таверны ключ не записывается.'),
      field('Модель', element('div', { className: 'row', style: { flexWrap: 'nowrap' } }, [model, fetchModels]), 'Заполните URL и ключ, затем получите список моделей.'),
      modelList,
    ]);

    const purposes = element('div', { className: 'stack' });
    for (const [purposeKey, label] of Object.entries(facade.invoke('onAuxPurposes', {}) ?? {})) {
      const input = element('input', { type: 'checkbox', checked: aux.purposes[purposeKey] !== false });
      input.addEventListener('change', () => { aux.purposes[purposeKey] = input.checked; });
      purposes.append(element('label', { className: 'roster-item' }, [input, label]));
    }
    const fallback = element('input', { type: 'checkbox', checked: Boolean(aux.fallbackToMain) });
    const maxTokens = element('input', { type: 'number', min: 256, max: 32000, value: aux.maxTokens ?? 4096, 'aria-label': 'Максимум токенов ответа' });
    const commonBlock = element('div', {}, [
      field('Через вспомогательный API идут:', purposes),
      element('label', { className: 'roster-item', style: { margin: '10px 0' } }, [fallback, 'При ошибке вспомогательного API отправить запрос в основной API']),
      field('Максимум токенов ответа', maxTokens, 'Модели с размышлениями тратят токены и на них — не ставьте слишком мало.'),
    ]);

    const collect = () => ({
      mode: mode.value, profileId: profileSelect.value, url: url.value, key: key.value, model: model.value,
      maxTokens: Number(maxTokens.value), fallbackToMain: fallback.checked, purposes: { ...aux.purposes },
    });
    const sync = () => {
      profileBlock.hidden = mode.value !== 'profile';
      customBlock.hidden = mode.value !== 'custom';
      commonBlock.hidden = mode.value === 'off';
    };
    mode.addEventListener('change', sync);
    sync();
    const test = button('Проверить', 'btn', async () => {
      test.disabled = true;
      setStatus('Проверяю вспомогательный API…');
      try { setStatus(await facade.invoke('onTestAux', { aux: collect() })); }
      catch (error) { setStatus(error?.message || 'Вспомогательный API не ответил', true); }
      finally { test.disabled = false; }
    });
    const save = button('Сохранить', 'btn primary', () => {
      act('onSettingsChange', { settings: { aux: collect() } }, 'settings-change');
      setStatus('Вспомогательный API сохранён');
    });
    card.append(field('Режим', mode), profileBlock, customBlock, commonBlock, element('div', { className: 'row', style: { marginTop: '10px' } }, [save, test]));
    return card;
  }

  /** Which model describes wardrobe pictures: the chat's own, a profile, or an endpoint of its own. */
  function renderVisionApi() {
    const choices = ctx.snapshot.visionChoices ?? { settings: { mode: 'main' }, profiles: [], mainChatCompletion: false, mainModel: '' };
    const vision = { ...choices.settings };
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Картинки: описание по картинке' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Одна модель для всего: карточки гардероба, локации и вещи библиотеки. Она смотрит на картинку и пишет описание. Не все модели видят картинки — проверьте кнопкой.' }),
    ]);
    const field = (label, control, hint) => element('div', { className: 'field' }, [
      element('label', { text: label }), control, ...(hint ? [element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: hint })] : []),
    ]);
    const mode = element('select', { 'aria-label': 'Чем описывать картинки' });
    for (const [value, text] of [['main', 'Как у таверны — модель чата'], ['profile', 'Профиль подключения SillyTavern'], ['custom', 'Свой URL (OpenAI-совместимый)']]) {
      mode.append(element('option', { value, text, selected: vision.mode === value }));
    }
    const mainNote = element('p', { className: 'muted', style: { fontSize: '11px', margin: '4px 0 0' }, text: choices.mainChatCompletion
      ? `Сейчас: ${choices.mainModel || 'модель чата'}. Сменится вместе с моделью таверны.`
      : 'Сейчас в таверне не Chat Completion API — этот режим не сработает. Выберите профиль или свой URL.' });
    const profile = element('select', { 'aria-label': 'Профиль для картинок' }, [
      element('option', { value: '', text: choices.profiles.length ? 'Выберите профиль' : 'Профилей нет' }),
      ...choices.profiles.map(item => element('option', { value: item.id, text: item.name, selected: item.id === vision.profileId })),
    ]);
    const url = element('input', { type: 'text', value: vision.url ?? '', placeholder: 'https://api.openai.com/v1', 'aria-label': 'URL API для картинок' });
    const key = element('input', { type: 'password', value: vision.key ?? '', autocomplete: 'off', 'aria-label': 'Ключ API для картинок' });
    const model = element('input', { type: 'text', value: vision.model ?? '', 'aria-label': 'Модель для картинок', placeholder: 'например gpt-4o-mini' });
    const maxTokens = element('input', { type: 'number', min: 200, max: 4000, value: vision.maxTokens ?? 700, 'aria-label': 'Максимум токенов описания' });
    const profileBlock = field('Профиль', profile, 'Профиль создаётся в Connection Manager. В нём должна быть модель, которая видит картинки.');
    const customBlock = element('div', {}, [field('URL API', url), field('Ключ API', key, 'Хранится в настройках расширений на этом сервере, запрос идёт через сервер таверны.'), field('Модель', model)]);
    const sync = () => {
      mainNote.hidden = mode.value !== 'main';
      profileBlock.hidden = mode.value !== 'profile';
      customBlock.hidden = mode.value !== 'custom';
    };
    mode.addEventListener('change', sync);
    sync();
    const collect = () => ({ mode: mode.value, profileId: profile.value, url: url.value, key: key.value, model: model.value, maxTokens: Number(maxTokens.value) });
    const test = button('Проверить', 'btn', async () => {
      test.disabled = true;
      setStatus('Показываю модели красный квадрат…');
      try { setStatus(await facade.invoke('onTestVision', { vision: collect() })); }
      catch (error) { setStatus(error?.message || 'Модель не ответила', true); }
      finally { test.disabled = false; }
    });
    const save = button('Сохранить', 'btn primary', () => {
      act('onSettingsChange', { settings: { wardrobeVision: collect() } }, 'settings-change');
      setStatus('Модель для картинок сохранена');
    });
    card.append(field('Чем описывать', mode), mainNote, profileBlock, customBlock, field('Максимум токенов описания', maxTokens),
      element('div', { className: 'row', style: { marginTop: '10px' } }, [save, test]));
    return card;
  }

  /** Last answer of onImageStorageStatus: the card draws from it at once, then asks again. */
  let imageStorageInfo = null;

  /** Where pictures live: the tavern's user/images or a folder on the computer (server plugin kulisy-images). */
  function renderImageStorage() {
    const card = element('div', { className: 'card settings' }, [
      element('h3', { text: 'Где хранить картинки' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Картинки гардероба и библиотеки. Новые картинки сохраняются туда, что выбрано здесь; уже сохранённые остаются на месте, пока их не перенести кнопкой ниже.' }),
    ]);
    const body = element('div', {});
    card.append(body);

    const draw = cached => {
      body.replaceChildren();
      if (!cached) { body.append(element('p', { className: 'muted', text: 'Проверяю плагин…' })); return; }
      // The choice itself comes from the snapshot: it is fresher than the last plugin answer.
      const info = { ...cached, storage: ctx.snapshot.settings?.imageStorage ?? cached.storage };
      const plugin = info.plugin ?? { installed: false };
      const field = (label, control, hint) => element('div', { className: 'field' }, [
        element('label', { text: label }), control, ...(hint ? [element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: hint })] : []),
      ]);
      const mode = element('select', { 'aria-label': 'Где хранить картинки' }, [
        element('option', { value: 'server', text: 'На сервере таверны (user/images)', selected: info.storage !== 'folder' }),
        element('option', { value: 'folder', text: 'В папке на компьютере', selected: info.storage === 'folder', disabled: !plugin.installed }),
      ]);
      mode.addEventListener('change', () => {
        if (mode.value === 'folder' && !plugin.ready) {
          mode.value = 'server';
          setStatus(plugin.error || 'Сначала выберите папку.', true);
          return;
        }
        act('onSettingsChange', { settings: { imageStorage: mode.value } }, 'settings-change');
        setStatus(mode.value === 'folder' ? 'Новые картинки пойдут в папку' : 'Новые картинки пойдут на сервер таверны');
      });
      body.append(field('Куда сохранять новые картинки', mode));

      if (!plugin.installed) {
        body.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Папка на компьютере работает через серверный плагин «kulisy-images». Чтобы его поставить: скопируйте папку server-plugin/kulisy-images из расширения в SillyTavern/plugins/, в config.yaml поставьте enableServerPlugins: true и перезапустите таверну. Подробно — в РУКОВОДСТВЕ, раздел «Картинки в папке на компьютере».' }));
      } else {
        const path = element('input', { type: 'text', value: plugin.folder ?? '', placeholder: 'D:\\Картинки\\Кулисы', 'aria-label': 'Папка для картинок', disabled: !plugin.admin });
        const state = element('p', { className: 'muted', style: { fontSize: '11px', margin: '4px 0 0' }, text: plugin.ready
          ? `Плагин${plugin.version ? ` ${plugin.version}` : ''} работает, папка доступна. Внутри неё лежат подпапки kulisy-wardrobe и kulisy-library.`
          : `Плагин работает, но: ${plugin.error || 'папка не выбрана.'}` });
        const save = button('Сохранить папку', 'btn primary', async () => {
          save.disabled = true;
          try {
            const saved = await facade.invoke('onSetImageFolder', { folder: path.value });
            setStatus(saved ? `Папка сохранена: ${saved}` : 'Папка забыта; картинки снова идут на сервер таверны');
            await refresh();
          } catch (error) { setStatus(error?.message || 'Папка не сохранилась', true); }
          finally { save.disabled = false; }
        });
        const row = element('div', { className: 'row', style: { marginTop: '8px', flexWrap: 'wrap', gap: '8px' } }, [save]);
        if (plugin.canBrowse && plugin.admin) {
          const browse = button('Обзор…', 'btn', async () => {
            browse.disabled = true;
            setStatus('Окно выбора папки открыто на компьютере с таверной…');
            try {
              const chosen = await facade.invoke('onBrowseImageFolder', {});
              if (chosen) { path.value = chosen; setStatus('Папка выбрана — нажмите «Сохранить папку»'); }
              else setStatus('Выбор отменён');
            } catch (error) { setStatus(error?.message || 'Окно выбора папки не открылось', true); }
            finally { browse.disabled = false; }
          });
          row.prepend(browse);
        }
        body.append(field('Папка на компьютере', path, plugin.admin ? 'Полный путь. Если перенесёте папку — укажите новое место, картинки найдутся.' : 'Менять папку может только администратор SillyTavern.'), state);
        if (plugin.admin) body.append(row);
      }

      const counts = info.counts ?? { server: 0, folder: 0 };
      body.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '12px 0 4px' }, text: `Сейчас картинок: на сервере таверны — ${counts.server}, в папке — ${counts.folder}.` }));
      const target = info.storage === 'folder' ? 'folder' : 'server';
      const elsewhere = target === 'folder' ? counts.server : counts.folder;
      if (elsewhere > 0 && (target === 'server' || plugin.ready)) {
        const move = button(target === 'folder' ? `Перенести в папку (${elsewhere})` : `Перенести на сервер таверны (${elsewhere})`, 'btn', async () => {
          move.disabled = true;
          setStatus('Переношу картинки…');
          try {
            const result = await facade.invoke('onMoveImages', { to: target });
            const notes = [`перенесено: ${result.moved}`];
            if (result.failed) notes.push(`не вышло: ${result.failed} (см. Диагностику)`);
            if (result.leftovers) notes.push(`старых копий не удалилось: ${result.leftovers}`);
            setStatus(`Готово — ${notes.join(', ')}`, Boolean(result.failed));
            await refresh();
          } catch (error) { setStatus(error?.message || 'Картинки не перенеслись', true); }
          finally { move.disabled = false; }
        });
        body.append(element('div', { className: 'row' }, [move]));
      }
    };

    async function refresh() {
      try { imageStorageInfo = await facade.invoke('onImageStorageStatus', {}); }
      catch (error) { imageStorageInfo = { storage: 'server', plugin: { installed: false }, counts: { server: 0, folder: 0 } }; setStatus(error?.message || 'Не удалось проверить плагин', true); }
      draw(imageStorageInfo);
    }

    draw(imageStorageInfo);
    refresh().catch(() => {});
    return card;
  }

  function renderDiagnostics() {
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Диагностика' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Журнал записывает, когда анализ запускался, почему пропускался и что не удалось сохранить. Если что-то работает не так — скопируйте журнал и пришлите разработчику. Ключей API и текста чата в нём нет.' }),
    ]);
    const output = element('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '0 0 10px', maxHeight: '220px', overflow: 'auto', fontSize: '11px' } });
    const refresh = () => {
      try { output.textContent = facade.invoke('onGetDiagnostics', {}) || '(журнал пуст)'; }
      catch (error) { output.textContent = `Не удалось прочитать журнал: ${error?.message ?? error}`; }
    };
    refresh();
    const copy = button('Скопировать журнал', 'btn', async () => {
      refresh();
      try {
        await navigator.clipboard.writeText(output.textContent);
        setStatus('Журнал скопирован');
      } catch {
        // Clipboard API is unavailable on plain-HTTP origins (typical for a phone on LAN): select the text instead.
        const range = document.createRange();
        range.selectNodeContents(output);
        const selection = shadow.getSelection?.() ?? document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        setStatus('Текст журнала выделен — скопируйте его вручную', true);
      }
    });
    card.append(output, element('div', { className: 'row' }, [
      copy,
      button('Обновить', 'btn', refresh),
      button('Очистить', 'btn', () => { act('onClearDiagnostics', {}); refresh(); }),
    ]));
    return card;
  }

  function renderDataTransfer() {
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Перенос данных' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Экспорт сохраняет персонажей, линии, воспоминания, напряжения и треугольники текущего чата в JSON-файл. Импорт заменяет ими состояние открытого чата.' }),
    ]);
    const importInput = element('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      try {
        if (file.size > 5_000_000) throw new Error('Файл импорта больше 5 МБ.');
        const data = JSON.parse(await file.text());
        const imported = await act('onImport', { data, file }, 'import');
        if (imported !== false) setStatus('Импорт завершён');
      } catch (error) {
        setStatus(error?.message || 'Не удалось импортировать данные', true);
      } finally {
        importInput.value = '';
      }
    });
    const exportButton = button('Экспорт в файл', 'btn', async () => {
      try {
        const result = await act('onExport', { snapshot: ctx.snapshot }, 'export');
        if (result !== false) downloadJson(result ?? ctx.snapshot, options.exportFilename);
        setStatus('Экспорт завершён');
      } catch (error) { setStatus(error?.message || 'Не удалось экспортировать данные', true); }
    });
    card.append(importInput, element('div', { className: 'row' }, [
      exportButton,
      button('Импорт из файла', 'btn', () => importInput.click()),
    ]));
    return card;
  }

  /**
   * Moving a chat from Horae: find its records in this chat, show what is there,
   * choose what to bring. Horae's own data stays untouched.
   */
  let horaeScan = null;
  let horaeChatKey = '';
  function renderHoraeImport() {
    const card = element('div', { className: 'card settings', style: { marginTop: '14px' } }, [
      element('h3', { text: 'Перенос из Хорае' }),
      element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'Хорае хранит записи прямо в сообщениях чата, поэтому их можно перенести, даже если Хорае уже выключен. Его данные не меняются. После переноса выключите Хорае, иначе модель получит время, место и одежду дважды.' }),
    ]);
    const key = String(ctx.snapshot.chatKey ?? '');
    if (horaeChatKey !== key) { horaeScan = null; horaeChatKey = key; }
    const scan = button(horaeScan ? 'Проверить ещё раз' : 'Найти записи Хорае в этом чате', 'btn', () => {
      try { horaeScan = facade.invoke('onHoraeScan', {}); ctx.render(); }
      catch (error) { setStatus(error?.message || 'Не удалось прочитать записи Хорае', true); }
    });
    card.append(scan);
    if (!horaeScan) return card;
    if (!horaeScan.found) {
      card.append(element('p', { className: 'muted', text: 'В этом чате записей Хорае нет.' }));
      return card;
    }
    const choices = [
      ['chronicle', `Хроника Хорае → сводки Хроники Кулис: ${[horaeScan.summaries ? `сводок ${horaeScan.summaries}` : '', horaeScan.events ? `событий сюжета ${horaeScan.events}` : ''].filter(Boolean).join(', ') || 'нет'}. События собираются в сцены; последние ${horaeScan.recent ?? 20} сообщений остаются как есть${(horaeScan.messages ?? 0) <= (horaeScan.recent ?? 20) ? ' — в этом чате пока только они, так что сводок не будет, модель видит его целиком' : ''}`, (horaeScan.summaries + (horaeScan.events ?? 0)) > 0 && (horaeScan.summaries > 0 || (horaeScan.messages ?? 0) > (horaeScan.recent ?? 20))],
      ['events', `События сюжета → «События» (кто был в сцене, тот видел): ${horaeScan.events ?? 0}`, (horaeScan.events ?? 0) > 0],
      ['unhide', `Вернуть сообщения, которые Хорае скрыл от модели: ${horaeScan.hidden ?? 0}. Сжатые сводками Кулисы прячут сами, если в «Хронике» включено «прятать сжатые»`, (horaeScan.hidden ?? 0) > 0],
      ['scene', `Время и место: ${[horaeScan.clock, horaeScan.day ? `день ${horaeScan.day}` : '', horaeScan.location].filter(Boolean).join(' · ') || '—'}${horaeScan.present.length ? `; на сцене: ${horaeScan.present.join(', ')}` : ''}`, Boolean(horaeScan.clock || horaeScan.location || horaeScan.present.length)],
      ['outfits', `Одежда: ${horaeScan.outfits}`, horaeScan.outfits > 0],
      ['items', `Вещи: ${horaeScan.items}`, horaeScan.items > 0],
      ['places', `Места → библиотека, папка «Из Хорае», и включить в этом чате: ${horaeScan.places}`, horaeScan.places > 0],
      ['createCharacters', horaeScan.unknown.length ? `Создать персонажей, которых нет в Кулисах: ${horaeScan.unknown.join(', ')}` : 'Все персонажи Хорае уже есть в Кулисах', horaeScan.unknown.length > 0],
    ];
    const boxes = {};
    const list = element('div', { className: 'stack', style: { margin: '10px 0' } });
    for (const [id, label, available] of choices) {
      const input = element('input', { type: 'checkbox', checked: available, disabled: !available, 'aria-label': label });
      boxes[id] = input;
      list.append(element('label', { className: 'roster-item' }, [input, label]));
    }
    if (horaeScan.unknown.length) list.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: 'Без новых персонажей их одежда и вещи у них не перенесутся (вещи лягут «ни у кого», с пометкой, у кого были).' }));
    const go = button('Перенести', 'btn primary', async () => {
      go.disabled = true;
      setStatus('Переношу из Хорае…');
      try {
        const options = Object.fromEntries(Object.entries(boxes).map(([id, input]) => [id, input.checked && !input.disabled]));
        const result = await act('onHoraeImport', options, 'horae-import');
        const parts = [`изменений: ${result?.operations ?? 0}`, `сводок в хронику: ${result?.scenes ?? 0}`];
        if (result?.places) parts.push(`мест в библиотеку: ${result.places}`);
        if (result?.created?.length) parts.push(`новых персонажей: ${result.created.length}`);
        if (result?.skippedScenes) parts.push(`сводок пропущено (уже в хронике): ${result.skippedScenes}`);
        if (result?.unhidden) parts.push(`возвращено сообщений: ${result.unhidden}`);
        const chronicleOff = result?.scenes && !ctx.snapshot.settings?.chronicle?.enabled;
        setStatus(`Перенесено — ${parts.join(', ')}.${chronicleOff ? ' Хроника выключена: включите её в «Модули», чтобы модель получала сводки.' : ''} Не забудьте выключить Хорае.`);
        horaeScan = null;
      } catch (error) {
        setStatus(error?.message || 'Перенос не удался', true);
      } finally { go.disabled = false; ctx.render(); }
    });
    card.append(list, go);
    return card;
  }

  /** Jump to a settings section (from «Сейчас», the chronicle page). */
  /** Open a section of the settings; `focus`: the aria-label of a field to show (scrolled to, selected, lit up). */
  function openSettingsSection(id, { focus = '' } = {}) {
    settingsSection = id;
    ctx.setTab('settings');
    if (!focus) return;
    setTimeout(() => {
      try {
        const input = [...ctx.shadow.querySelectorAll('input, select, textarea')].find(node => node.getAttribute('aria-label') === focus);
        if (!input) return;
        input.scrollIntoView?.({ block: 'center' });
        input.focus({ preventScroll: true });
        input.select?.();
        const row = input.closest('.set-item') ?? input;
        row.classList.add('ku-flash');
        setTimeout(() => row.classList.remove('ku-flash'), 2400);
      } catch (error) { console.warn('[Kulisy] Could not show the setting.', error); }
    }, 0);
  }

  return { openSettingsSection, renderLorebooks, renderJournal, renderSettings, renderPromptSections, headcanonStatusText, renderEmbeddings, renderAuxApi, renderDiagnostics, renderDataTransfer, renderHoraeImport };
}
