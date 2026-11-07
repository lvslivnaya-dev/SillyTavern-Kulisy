import { button, characterId, characterName, element } from '../helpers.js';
import { icon } from '../icons.js';
import { activeConditions, folderPath, locationPath } from '../../core/index.js';
import { effectiveLocation } from '../../integration/location-links.js';
import { effectiveItem } from '../../integration/item-links.js';
import { looksIssues } from '../../integration/world-prompt.js';
import { nextSceneText } from '../../integration/chronicle-actions.js';

/**
 * The scene and its world: «Сейчас» (the control desk), places and things (each:
 * this chat + the library, which shares its folders between the two), the chronicle, the check of replies (leaks + slips), and the
 * wardrobe / things tabs of a dossier. Everything goes through act() to index.js.
 */
export function createWorldPages(ctx) {
  const act = (...args) => ctx.act(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);

  const snapshot = () => ctx.snapshot;
  const characters = () => snapshot().characters || [];
  const world = () => snapshot().world ?? { clock: { label: '', day: 0, time: '', part: '' }, locations: [], wardrobe: {}, items: [] };
  const scene = () => snapshot().knowledge?.scene ?? { presentIds: [], location: '' };
  const library = () => snapshot().locationLibrary ?? { folders: [], locations: [], items: [] };
  const personaId = () => snapshot().personaId || '';
  const nameOf = id => characterName(characters().find(character => characterId(character) === id), id);
  const present = () => (scene().presentIds ?? []).filter(id => characters().some(character => characterId(character) === id));

  let editingClock = false;
  let backstageAll = false; // «За кулисами»: show everyone, not only the first ones
  let editingPlace = false;
  let placesTab = 'library'; // library | chat
  let editingChatPlace = '';
  // The library is one gallery seen from two pages: «Локации» shows its places, «Вещи» its
  // things. Each page remembers its own open folder, selection, search and import.
  let itemsTab = 'chat'; // chat | library
  let itemsFocus = '';
  let selectingItems = false;
  let itemsView = 'active'; // active | shade | off
  const pickedItems = new Set();
  let editingFeature = '';
  let editingItemId = '';
  let editingSummaryId = '';
  const pickedSummaries = new Set();

  const PART_RU = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };

  function avatar(character, size = '') {
    const name = characterName(character);
    return character?.avatar
      ? element('img', { className: `avatar ${size}`, src: character.avatar, alt: '' })
      : element('span', { className: `avatar ${size}`, text: name.slice(0, 2) });
  }

  function chip(text, kind = '') {
    return element('span', { className: `ku-chip${kind ? ` ${kind}` : ''}`, text });
  }

  function toggle(checked, label, onChange) {
    const input = element('input', { type: 'checkbox', className: 'ku-switch', checked: Boolean(checked), 'aria-label': label, title: label });
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function iconButton(name, label, onClick, active = false) {
    const node = element('button', { type: 'button', className: `ku-ib${active ? ' on' : ''}`, 'aria-label': label, title: label }, [icon(name)]);
    node.addEventListener('click', onClick);
    return node;
  }

  function empty(text) {
    return element('div', { className: 'empty', text });
  }

  /** Run an action (a function, so even a synchronous error lands in the status line). */
  async function attempt(work, done) {
    try {
      const result = await (typeof work === 'function' ? work() : work);
      if (done) setStatus(typeof done === 'function' ? done(result) : done);
      return result;
    } catch (error) {
      setStatus(error?.message || String(error), true);
      return undefined;
    } finally {
      render();
    }
  }

  /** Russian plural: 1 событие, 3 события, 5 событий. */
  function plural(count, one, few, many) {
    const tens = Math.abs(count) % 100;
    const units = tens % 10;
    if (tens > 10 && tens < 20) return many;
    if (units === 1) return one;
    if (units >= 2 && units <= 4) return few;
    return many;
  }

  function daysLeft(condition) {
    const day = world().clock?.day ?? 0;
    if (!condition.days || !condition.sinceDay || !day) return '';
    const left = condition.sinceDay + condition.days - day;
    return left <= 1 ? 'сегодня' : `ещё ${left} дн.`;
  }

  function placeView(card) {
    return effectiveLocation(card, library());
  }

  function folderPicker(onPick) {
    const lib = library();
    const select = element('select', { 'aria-label': 'Сохранить в папку библиотеки', title: 'Сохранить в библиотеку, чтобы была во всех чатах' }, [
      element('option', { value: '', text: 'в библиотеку…' }),
      ...lib.folders.map(folder => element('option', { value: folder.id, text: folderPath(lib, folder.id).map(step => step.name).join(' › ') })),
    ]);
    select.addEventListener('change', () => { if (select.value) onPick(select.value); });
    if (!lib.folders.length) { select.disabled = true; select.title = 'Сначала создайте папку в библиотеке'; }
    return select;
  }

  // ---- Сейчас ---------------------------------------------------------------

  function renderClock() {
    const clock = world().clock ?? {};
    if (editingClock) {
      const day = element('input', { type: 'number', min: 0, value: clock.day || '', className: 'ku-short', 'aria-label': 'День истории', placeholder: 'день' });
      const time = element('input', { type: 'text', value: clock.time || '', className: 'ku-short', 'aria-label': 'Время', placeholder: 'ЧЧ:ММ' });
      const label = element('input', { type: 'text', value: clock.label || '', 'aria-label': 'Подпись', placeholder: 'Суббота, 14 марта' });
      const flashback = toggle(Boolean(clock.flashback), 'Идёт флешбек', () => {});
      return element('div', { className: 'ku-clock editing' }, [
        element('div', { className: 'ku-row' }, [day, time]),
        label,
        element('label', { className: 'ku-inline' }, [flashback, 'флешбек']),
        element('div', { className: 'ku-row' }, [
          button('Сохранить', 'btn primary small', () => {
            editingClock = false;
            attempt(() => act('onSetClock', { day: day.value, time: time.value, label: label.value, flashback: flashback.checked }, 'clock-set'), 'Время сохранено');
          }),
          button('Отмена', 'btn small', () => { editingClock = false; render(); }),
        ]),
      ]);
    }
    const node = element('button', { type: 'button', className: 'ku-clock', title: 'Изменить время' }, [
      element('strong', { text: clock.time || '--:--' }),
      element('span', { className: 'muted', text: [clock.day ? `день ${clock.day}` : 'день ?', PART_RU[clock.part] ?? '', clock.flashback ? 'флешбек' : ''].filter(Boolean).join(' · ') }),
      ...(clock.label ? [element('span', { className: 'muted', text: clock.label })] : []),
    ]);
    node.addEventListener('click', () => { editingClock = true; render(); });
    return node;
  }

  function renderPlaceStrip() {
    const state = snapshot();
    const cards = world().locations ?? [];
    const current = cards.find(card => card.id === scene().locationId);
    if (editingPlace) {
      const select = element('select', { 'aria-label': 'Место из карточек чата' }, [
        element('option', { value: '', text: 'Выберите карточку места' }),
        ...cards.map(card => element('option', { value: card.id, text: locationPath(state, card.id).join(' › '), selected: card.id === current?.id })),
      ]);
      const text = element('input', { type: 'text', value: scene().location ?? '', placeholder: 'или впишите место', 'aria-label': 'Место словами' });
      return element('div', { className: 'ku-place editing' }, [select, text, element('div', { className: 'ku-row' }, [
        button('Сохранить', 'btn primary small', () => {
          editingPlace = false;
          attempt(() => act('onSetSceneLocation', select.value ? { locationId: select.value } : { location: text.value }, 'scene-location'), 'Место сохранено');
        }),
        button('Отмена', 'btn small', () => { editingPlace = false; render(); }),
      ])]);
    }
    const place = current ? placeView(current) : null;
    const path = current ? locationPath(state, current.id) : [];
    const crumbs = element('div', { className: 'ku-crumbs' });
    if (path.length) path.forEach((step, index) => {
      if (index) crumbs.append(element('span', { className: 'muted', text: '›', 'aria-hidden': 'true' }));
      crumbs.append(element(index === path.length - 1 ? 'strong' : 'span', { className: index === path.length - 1 ? '' : 'muted', text: step }));
    });
    else crumbs.append(element('strong', { text: scene().location || 'Место не указано' }));
    const chips = element('div', { className: 'ku-chips' });
    if (place) {
      for (const trait of place.traits.slice(0, 3)) chips.append(chip(trait));
      if (place.traits.length > 3) chips.append(chip(`+${place.traits.length - 3}`));
      for (const note of place.notes ?? []) chips.append(chip(note, 'warn'));
    }
    const node = element('button', { type: 'button', className: 'ku-place', title: 'Изменить место' }, [crumbs, chips]);
    node.addEventListener('click', () => { editingPlace = true; render(); });
    return node;
  }

  function lastReply() {
    const operations = snapshot().operations ?? [];
    let index = -1;
    for (const operation of operations) if (Number.isInteger(operation.messageIndex) && operation.messageIndex > index) index = operation.messageIndex;
    if (index < 0) return { index, rows: [] };
    const TYPE_ICON = { 'clock.set': 'clock', 'scene.set': 'pin', 'location.add': 'pin', 'location.update': 'pin', 'wardrobe.set': 'shirt', 'condition.add': 'shirt', 'condition.remove': 'shirt', 'item.add': 'bag', 'item.update': 'bag', 'item.remove': 'bag', 'scale.delta': 'heart', 'memory.add': 'clock', 'tension.add': 'bolt', 'event.add': 'eye', 'learned.add': 'eye', 'acquaintance.set': 'people' };
    const rows = operations.filter(operation => operation.messageIndex === index && operation.reason)
      .map(operation => ({ id: operation.id, iconName: TYPE_ICON[operation.type] ?? 'check', text: operation.reason }));
    return { index, rows };
  }

  function renderNow() {
    const state = snapshot();
    const here = present();
    const view = element('div', { className: 'ku-now' });
    view.append(element('div', { className: 'ku-strip' }, [renderClock(), renderPlaceStrip()]));

    const main = element('div', { className: 'ku-now-main' });
    main.append(element('p', { className: 'section-title', text: `На сцене · ${here.length}` }));
    const cast = element('div', { className: 'ku-stage' });
    const dossiers = state.dossiers ?? {};
    for (const id of here) {
      const character = characters().find(item => characterId(item) === id);
      const entry = world().wardrobe?.[id];
      const conditions = activeConditions(state, id);
      const held = (world().items ?? []).filter(item => item.ownerId === id);
      const file = dossiers[id] ?? { knows: [], doesNotKnow: [] };
      const card = element('button', { type: 'button', className: 'ku-actor' }, [
        element('div', { className: 'ku-row' }, [avatar(character), element('strong', { text: characterName(character) }), ...(id === personaId() ? [chip('персона', 'told')] : [])]),
        element('div', { className: 'ku-outfit' }, [icon('shirt'), element('span', { text: entry?.outfit || 'одежда не записана' }), ...(entry?.locked ? [icon('lock')] : [])]),
        ...(entry?.features?.length ? [element('div', { className: 'ku-outfit' }, [icon('eye'), element('span', { className: 'ku-looks-line', text: entry.features.map(feature => feature.text).join('; ') })])] : []),
        ...(entry?.awayDays ? [element('span', { className: 'muted ku-small', text: `прошло ${entry.awayDays} дн. — мог(ла) переодеться` })] : []),
        ...(state.looksFit?.[id] === 'dropped' ? [chip('описания одежды не влезли в сцену', 'warn')] : []),
        ...(conditions.length ? [element('div', { className: 'ku-chips' }, conditions.map(condition => chip([condition.text, daysLeft(condition)].filter(Boolean).join(' · '), 'warn')))] : []),
        // What the numbers are: events of the story they know / do not know, things they hold.
        element('div', { className: 'ku-stats ku-stats-named' }, [
          element('span', { className: 'ku-stat', 'data-tab': 'knows', title: 'Событий сюжета, которые видел(а) сам(а) или о которых узнал(а). Открыть «Знания»' }, [
            icon('eye'), element('b', { text: String(file.knows.length) }), ` ${plural(file.knows.length, 'событие', 'события', 'событий')} знает`]),
          element('span', { className: `ku-stat${file.doesNotKnow.length ? ' warn' : ''}`, 'data-tab': 'knows', title: 'Событий, о которых не знает: модель не даст их упомянуть или угадать. Открыть «Знания»' }, [
            icon('alert'), element('b', { text: String(file.doesNotKnow.length) }), ' не знает']),
          element('span', { className: 'ku-stat', 'data-tab': 'items', title: 'Вещей при себе. Открыть «Вещи»' }, [
            icon('bag'), element('b', { text: String(held.length) }), ` ${plural(held.length, 'вещь', 'вещи', 'вещей')}`]),
        ]),
      ]);
      // The card opens the dossier on the wardrobe; a number opens its own tab.
      card.addEventListener('click', event => ctx.openDossier?.(id, event.target.closest?.('[data-tab]')?.dataset.tab ?? 'wardrobe'));
      cast.append(card);
    }
    main.append(here.length ? cast : empty('На сцене никого. Выведите персонажей ниже или чипами над полем ввода.'));
    // Wardrobe descriptions that found no room: one way to fix it, right here.
    const dropped = here.filter(id => state.looksFit?.[id] === 'dropped');
    if (dropped.length) {
      main.append(element('div', { className: 'ku-fit ku-row dropped' }, [
        element('span', { className: 'ku-small', text: `Описания из гардероба не влезли в сцену: ${dropped.map(nameOf).join(', ')}. Модель знает только, во что одеты, без подробностей. ${ctx.needText?.(state.looksFit) ?? ''}` }),
        button('Поднять объём сцены', 'btn small', () => ctx.openSettingsSection?.('scene', { focus: 'Объём сцены' })),
      ]));
    }

    const away = characters().filter(character => !here.includes(characterId(character)));
    if (away.length) {
      // Who was seen most recently first: they are the likeliest to come back.
      const seen = character => world().wardrobe?.[characterId(character)]?.seenDay ?? 0;
      const sorted = [...away].sort((left, right) => seen(right) - seen(left) || characterName(left).localeCompare(characterName(right), 'ru'));
      const LIMIT = 8;
      const shown = backstageAll ? sorted : sorted.slice(0, LIMIT);
      const backstage = element('section', { className: 'ku-backstage', 'aria-label': 'За кулисами' });
      backstage.append(element('div', { className: 'ku-backstage-head' }, [
        element('span', { className: 'section-title', text: `За кулисами · ${away.length}` }),
        element('span', { className: 'muted ku-small', text: 'клик — на сцену · одежда хранится, в промпт не идёт' }),
      ]));
      const grid = element('div', { className: 'ku-backstage-grid' });
      for (const character of shown) {
        const id = characterId(character);
        const entry = world().wardrobe?.[id];
        const day = world().clock?.day ?? 0;
        const sub = entry?.seenDay && day && day > entry.seenDay ? `не видели ${day - entry.seenDay} дн.` : (entry?.outfit || 'одежда не записана');
        const node = element('button', { type: 'button', className: 'ku-off', title: `${characterName(character)}: вывести на сцену${entry?.outfit ? `
Одежда: ${entry.outfit}` : ''}` }, [
          avatar(character, 'small'),
          element('span', { className: 'ku-off-text' }, [element('strong', { text: characterName(character) }), element('span', { className: 'muted', text: sub })]),
          element('span', { className: 'ku-off-go', 'aria-hidden': 'true', text: '+' }),
        ]);
        node.addEventListener('click', () => attempt(() => act('onTogglePresent', { characterId: id, present: true }, 'scene-presence')));
        grid.append(node);
      }
      backstage.append(grid);
      if (sorted.length > LIMIT) {
        backstage.append(button(backstageAll ? 'Свернуть' : `Показать всех · ещё ${sorted.length - LIMIT}`, 'ku-backstage-more', () => { backstageAll = !backstageAll; render(); }));
      }
      main.append(backstage);
    }

    const things = (world().items ?? []).filter(item => (item.ownerId && here.includes(item.ownerId)) || (!item.ownerId && item.importance !== 'normal'));
    if (things.length) {
      main.append(element('p', { className: 'section-title', text: `Вещи в сцене · ${things.length}` }));
      main.append(element('div', { className: 'ku-things' }, things.map(item => element('div', { className: 'ku-thing' }, [
        icon('bag'), element('span', { text: item.name }),
        ...(item.secret ? [chip('тайная', 'warn')] : []),
        element('span', { className: 'muted ku-small ku-push', text: [item.ownerId ? `у ${nameOf(item.ownerId)}` : 'ни у кого', item.place].filter(Boolean).join(' · ') }),
      ]))));
    }
    view.append(main);

    const reply = lastReply();
    const checks = (state.leaks?.length ?? 0) + (state.slips?.length ?? 0) + looksIssues(state.looksFit).length;
    const feed = element('aside', { className: 'ku-feed', 'aria-label': 'Что изменил последний ответ' }, [
      element('div', { className: 'ku-row' }, [element('span', { className: 'section-title', text: reply.index >= 0 ? `Последний ответ · #${reply.index}` : 'Последний ответ' })]),
    ]);
    if (!reply.rows.length) feed.append(element('p', { className: 'muted ku-small', text: 'Пока ничего не записано.' }));
    if (state.chroniclerSilent) {
      feed.append(element('div', { className: 'ku-feed-alert', role: 'status' }, [
        icon('alert'),
        element('span', { text: `Летописец молчит ${state.chroniclerSilent.count} ответа подряд: время, одежда и знания не обновляются.${state.chroniclerSilent.reason ? ` ${state.chroniclerSilent.reason}` : ''}` }),
        button('Диагностика', 'btn small', () => ctx.openSettingsSection?.('diagnostics')),
      ]));
    }
    for (const row of reply.rows.slice(0, 14)) {
      feed.append(element('div', { className: 'ku-feed-row' }, [
        element('span', { className: 'ku-feed-icon' }, [icon(row.iconName)]),
        element('span', { className: 'ku-feed-text', text: row.text }),
        iconButton('undo', `Отменить: ${row.text}`, () => attempt(() => act('onUndoOperation', { operationId: row.id }, 'undo-operation'), 'Отменено')),
      ]));
    }
    if (reply.rows.length > 14) feed.append(element('p', { className: 'muted ku-small', text: `и ещё ${reply.rows.length - 14} — в «Истории»` }));
    if (checks) feed.append(button(`Проверка: ${checks}`, 'btn small', () => ctx.setTab('leaks')));
    const total = (state.promptTokens ?? 0) + (state.knowledgeTokens ?? 0) + (state.sceneTokens ?? 0) + (state.chronicleTokens ?? 0);
    feed.append(element('div', { className: 'ku-feed-foot' }, [
      element('span', { className: 'muted ku-small', text: `в промпт ~${total} ток.` }),
      button('Превью', 'btn small', () => ctx.openSettingsSection?.('prompt')),
    ]));
    view.append(feed);
    return view;
  }

  // ---- Dossier tabs: wardrobe and things --------------------------------------

  function renderWardrobeTab(id) {
    const box = element('div', { className: 'ku-facts' });
    const entry = world().wardrobe?.[id] ?? { outfit: '', conditions: [] };
    const outfit = element('textarea', { rows: 2, value: entry.outfit ?? '', 'aria-label': 'Одежда', placeholder: 'Что надето' });
    const hasCards = Boolean(entry.cardIds?.length);
    box.append(element('p', { className: 'section-title', text: 'Одет(а)' }), outfit);
    if (hasCards) box.append(element('p', { className: 'muted ku-small', text: 'Коротко, что надето. Подробности каждой вещи модель получает из описаний карточек гардероба ниже.' }));
    box.append(element('div', { className: 'ku-row' }, [
      button('Сохранить', 'btn primary small', () => attempt(() => act('onSetOutfit', { entityId: id, outfit: outfit.value, keepCards: hasCards }, 'outfit-set'), 'Одежда сохранена'),
        hasCards ? 'Сохранить строку; карточки гардероба остаются надетыми' : 'Сохранить'),
      ...(hasCards ? [
        button('Собрать из карточек', 'btn small', () => attempt(() => act('onWardrobeRecompose', { entityId: id }, 'outfit-recompose'), 'Строка собрана из карточек'), 'Пересобрать строку из надетых карточек'),
        button('Переодеть словами', 'btn small', () => attempt(() => act('onSetOutfit', { entityId: id, outfit: outfit.value, keepCards: false }, 'outfit-set'), 'Карточки сняты, строка сохранена'), 'Снять карточки гардероба и оставить только эту строку'),
      ] : []),
      element('label', { className: 'ku-inline' }, [toggle(entry.locked, 'Закрепить одежду', value => attempt(() => act('onSetOutfit', { entityId: id, locked: value }, 'outfit-lock'))), 'закрепить — летописец не меняет']),
    ]));
    if (entry.awayDays) box.append(element('p', { className: 'muted ku-small', text: `Прошло ${entry.awayDays} дн. с последней встречи: модель может переодеть персонажа, если это логично.` }));
    // Cards from the wardrobe they have on: pictures, each can be taken off.
    if (ctx.renderWornCards) box.append(element('p', { className: 'section-title', text: 'Из гардероба' }), ctx.renderWornCards(id));
    box.append(element('p', { className: 'section-title', text: 'Состояние' }));
    const state = snapshot();
    const live = new Set(activeConditions(state, id).map(condition => condition.id));
    if (!(entry.conditions ?? []).length) box.append(element('p', { className: 'muted', text: 'Ничего: ни ран, ни мокрой одежды.' }));
    for (const condition of entry.conditions ?? []) {
      const text = element('input', { type: 'text', value: condition.text, 'aria-label': 'Состояние' });
      const days = element('input', { type: 'number', min: 0, value: condition.days ?? '', className: 'ku-short', 'aria-label': 'Сколько дней', placeholder: 'дней' });
      box.append(element('div', { className: `ku-fact${live.has(condition.id) ? '' : ' off'}` }, [
        text, days, element('span', { className: 'muted ku-small', text: live.has(condition.id) ? daysLeft(condition) : 'прошло' }),
        iconButton('check', 'Сохранить', () => attempt(() => act('onUpdateCondition', { entityId: id, conditionId: condition.id, changes: { text: text.value, days: days.value ? Number(days.value) : null } }, 'condition-update'), 'Состояние сохранено')),
        iconButton('close', 'Убрать', () => attempt(() => act('onRemoveCondition', { entityId: id, conditionId: condition.id }, 'condition-remove'))),
      ]));
    }
    const newText = element('input', { type: 'text', placeholder: 'Новое: промок, синяк на скуле…', 'aria-label': 'Новое состояние' });
    const newDays = element('input', { type: 'number', min: 0, className: 'ku-short', placeholder: 'дней', 'aria-label': 'Сколько дней' });
    box.append(element('div', { className: 'ku-fact' }, [newText, newDays, button('Добавить', 'btn small', () => attempt(() => act('onAddCondition', { entityId: id, text: newText.value, days: newDays.value }, 'condition-add'), 'Состояние добавлено'))]));
    return box;
  }

  function itemEditor(item) {
    const name = element('input', { type: 'text', value: item?.name ?? '', 'aria-label': 'Название', placeholder: 'Название' });
    const owner = element('select', { 'aria-label': 'У кого' }, [
      element('option', { value: '', text: 'ни у кого' }),
      ...characters().map(character => element('option', { value: characterId(character), text: characterName(character), selected: characterId(character) === (item?.ownerId ?? itemsFocus) })),
    ]);
    const place = element('input', { type: 'text', value: item?.place ?? '', 'aria-label': 'Где именно', placeholder: 'где: в кармане, на столе…' });
    const importance = element('select', { 'aria-label': 'Важность' }, [['normal', 'обычная'], ['important', 'важная'], ['key', 'ключевая']]
      .map(([value, text]) => element('option', { value, text, selected: (item?.importance ?? 'normal') === value })));
    const secret = toggle(item?.secret, 'Тайная', () => {});
    const fields = () => ({ name: name.value, ownerId: owner.value, place: place.value, importance: importance.value, secret: secret.checked });
    return { fields, node: element('div', { className: 'ku-item-edit' }, [name, owner, place, importance, element('label', { className: 'ku-inline' }, [secret, 'тайная'])]) };
  }

  function itemRow(item, { shelfTools = false } = {}) {
    if (selectingItems && shelfTools) {
      const box = element('input', { type: 'checkbox', checked: pickedItems.has(item.id), 'aria-label': `Выбрать: ${item.name}` });
      box.addEventListener('change', () => { if (box.checked) pickedItems.add(item.id); else pickedItems.delete(item.id); render(); });
      return element('label', { className: `ku-fact${item.off ? ' off' : ''}` }, [box, element('span', { className: 'ku-fact-text' }, [element('strong', { text: item.name }), item.place ? element('span', { className: 'muted', text: ` · ${item.place}` }) : null])]);
    }
    if (editingItemId === item.id) {
      const editor = itemEditor(item);
      return element('div', { className: 'ku-fact editing' }, [editor.node, element('div', { className: 'ku-row' }, [
        button('Сохранить', 'btn primary small', () => { editingItemId = ''; attempt(() => act('onUpdateItem', { itemId: item.id, changes: editor.fields() }, 'item-update'), 'Вещь сохранена'); }),
        button('Отмена', 'btn small', () => { editingItemId = ''; render(); }),
      ])]);
    }
    const thing = effectiveItem(item, library());
    const shaded = (snapshot().dormantItemIds ?? []).includes(item.id);
    return element('div', { className: `ku-fact${item.off ? ' off' : ''}`, title: thing.description || '' }, [
      icon('bag'),
      element('span', { className: 'ku-fact-text' }, [
        element('strong', { text: thing.name }),
        item.place ? element('span', { className: 'muted', text: ` · ${item.place}` }) : null,
        item.note ? element('span', { className: 'muted', text: ` · ${item.note}` }) : null,
      ]),
      ...(item.importance !== 'normal' ? [chip(item.importance === 'key' ? 'ключевая' : 'важная', 'told')] : []),
      ...(item.secret ? [chip('тайная', 'warn')] : []),
      ...(thing.fromLibrary ? [chip('из библиотеки', 'told')] : []),
      ...(shaded ? [chip('в тени')] : []),
      ...(shelfTools && !item.libraryId ? [folderPicker(id => attempt(() => invoke('onLibrarySaveItem', { itemId: item.id, folderId: id }), 'Сохранено в библиотеку'))] : []),
      // Move between «В ходу», «В тени» and «Отключённые»: the two places it is not in.
      ...[
        ['on', 'eye', 'В ход — модель снова её получает'],
        ['shade', 'moon', 'В тень — хранится, не отправляется, вернётся, когда упомянут'],
        ['off', 'eyeoff', 'Отключить — не видят ни модель, ни летописец'],
      ].filter(([where]) => where !== (item.off ? 'off' : shaded ? 'shade' : 'on'))
        .map(([where, name, label]) => iconButton(name, label, () => attempt(() => act('onItemsBulk', { itemIds: [item.id], action: where }, 'item-move'), { on: 'В ходу', shade: 'В тени', off: 'Отключена' }[where]))),
      iconButton('lock', item.locked ? 'Открепить' : 'Закрепить — летописец не меняет', () => attempt(() => act('onUpdateItem', { itemId: item.id, changes: { locked: !item.locked } }, 'item-lock')), item.locked),
      iconButton('edit', 'Изменить', () => { editingItemId = item.id; render(); }),
      iconButton('close', 'Удалить', () => attempt(() => act('onRemoveItem', { itemId: item.id }, 'item-remove'))),
    ]);
  }

  /** Lasting looks of a character: scars, tattoos, dyed hair… — added, changed, locked, removed. */
  function renderLooksTab(id) {
    const box = element('div', { className: 'ku-facts' });
    const features = world().wardrobe?.[id]?.features ?? [];
    const KIND = { scar: 'шрам', tattoo: 'тату', piercing: 'пирсинг', hair: 'волосы', eyes: 'глаза', body: 'тело', other: 'другое' };
    const kindSelect = value => element('select', { 'aria-label': 'Что это', className: 'ku-short' }, Object.entries(KIND).map(([key, text]) => element('option', { value: key, text, selected: key === value })));
    box.append(element('p', { className: 'section-title', text: `Внешность · ${features.length}` }),
      element('p', { className: 'muted ku-small', text: 'Что изменилось или открылось в сюжете и осталось: шрамы, тату, пирсинг, перекрашенные волосы. Рассказчик получает это важнее карточки и описания персоны.' }));
    if (!features.length) box.append(element('p', { className: 'muted', text: 'Пока ничего: выглядит, как в карточке.' }));
    for (const feature of features) {
      if (editingFeature === feature.id) {
        const text = element('textarea', { rows: 2, value: feature.text, 'aria-label': 'Как выглядит' });
        const kind = kindSelect(feature.kind);
        box.append(element('div', { className: 'ku-fact editing' }, [text, element('div', { className: 'ku-row' }, [
          kind,
          button('Сохранить', 'btn primary small', () => { editingFeature = ''; attempt(() => act('onUpdateFeature', { entityId: id, featureId: feature.id, changes: { text: text.value, kind: kind.value } }, 'feature-update'), 'Сохранено'); }),
          button('Отмена', 'btn small', () => { editingFeature = ''; render(); }),
        ])]));
        continue;
      }
      box.append(element('div', { className: 'ku-fact' }, [
        chip(KIND[feature.kind] ?? 'другое'),
        element('span', { className: 'ku-fact-text', text: feature.text }),
        feature.sinceDay ? element('span', { className: 'muted ku-small', text: `с дня ${feature.sinceDay}` }) : null,
        iconButton('lock', feature.locked ? 'Открепить' : 'Закрепить — летописец не меняет', () => attempt(() => act('onUpdateFeature', { entityId: id, featureId: feature.id, changes: { locked: !feature.locked } }, 'feature-lock')), feature.locked),
        iconButton('edit', 'Изменить', () => { editingFeature = feature.id; render(); }),
        iconButton('close', 'Убрать', () => attempt(() => act('onRemoveFeature', { entityId: id, featureId: feature.id }, 'feature-remove'))),
      ]));
    }
    const text = element('input', { type: 'text', placeholder: 'Новое: шрам через левую бровь, волосы перекрашены в рыжий…', 'aria-label': 'Новая черта внешности' });
    const kind = kindSelect('other');
    box.append(element('div', { className: 'ku-fact' }, [text, kind, button('Добавить', 'btn small', () => attempt(() => act('onAddFeature', { entityId: id, text: text.value, kind: kind.value }, 'feature-add'), 'Добавлено'))]));
    return box;
  }

  function renderHeldTab(id) {
    const box = element('div', { className: 'ku-facts' });
    const held = (world().items ?? []).filter(item => item.ownerId === id);
    box.append(element('p', { className: 'section-title', text: `Вещи · ${held.length}` }));
    if (!held.length) box.append(element('p', { className: 'muted', text: 'Ничего не записано.' }));
    for (const item of held) box.append(itemRow(item));
    itemsFocus = id;
    box.append(addItemForm());
    return box;
  }

  function addItemForm() {
    const editor = itemEditor(null);
    return element('details', { className: 'fold' }, [
      element('summary', { text: '+ вещь' }),
      element('div', { className: 'fold-body' }, [editor.node, button('Добавить', 'btn primary small', () => attempt(() => act('onAddItem', editor.fields(), 'item-add'), 'Вещь добавлена'))]),
    ]);
  }

  // ---- Вещи ------------------------------------------------------------------

  function renderItems() {
    const view = element('div', { className: 'records-view' });
    const tabs = element('div', { className: 'ku-tabs', role: 'tablist' });
    for (const [key, label] of [['chat', 'В этом чате'], ['library', 'Библиотека']]) {
      const tab = button(label, itemsTab === key ? 'on' : '', () => { itemsTab = key; render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(itemsTab === key));
      tabs.append(tab);
    }
    view.append(tabs);
    if (itemsTab === 'library') {
      // The library is a gallery of its own (library.js), shared with «Локации».
      view.append(ctx.renderLibrary('items'));
      return view;
    }
    const all = world().items ?? [];
    const shade = new Set(snapshot().dormantItemIds ?? []);
    const offItems = all.filter(item => item.off);
    const shaded = all.filter(item => !item.off && shade.has(item.id));
    const items = all.filter(item => !item.off && !shade.has(item.id));
    for (const id of [...pickedItems]) if (!all.some(item => item.id === id)) pickedItems.delete(id);
    const here = present();
    const owners = [...new Set([...here, ...characters().map(characterId)])];
    if (itemsFocus && !characters().some(character => characterId(character) === itemsFocus)) itemsFocus = '';
    const filter = element('select', { 'aria-label': 'Показать вещи' }, [
      element('option', { value: '', text: 'Все' }),
      ...characters().map(character => element('option', { value: characterId(character), text: characterName(character), selected: characterId(character) === itemsFocus })),
    ]);
    filter.addEventListener('change', () => { itemsFocus = filter.value; render(); });
    const bulk = action => attempt(async () => {
      await act('onItemsBulk', { itemIds: [...pickedItems], action }, 'items-bulk');
      pickedItems.clear();
    }, { remove: 'Удалено', off: 'Отключено', shade: 'Убрано в тень', on: 'Снова в ходу' }[action]);
    // Three tabs: in use / in the shade / switched off.
    const lists = { active: items, shade: shaded, off: offItems };
    const listTabs = element('div', { className: 'ku-tabs ku-subtabs', role: 'tablist', 'aria-label': 'Какие вещи' });
    for (const [key, label] of [['active', 'В ходу'], ['shade', 'В тени'], ['off', 'Отключённые']]) {
      const tab = button(`${label} · ${lists[key].length}`, itemsView === key ? 'on' : '', () => { itemsView = key; pickedItems.clear(); render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(itemsView === key));
      listTabs.append(tab);
    }
    const shown = lists[itemsView];
    view.append(listTabs, element('div', { className: 'ku-row' }, [
      filter,
      element('span', { className: 'ku-push' }),
      button(selectingItems ? 'Готово' : 'Выбрать несколько', selectingItems ? 'btn primary small' : 'btn small', () => { selectingItems = !selectingItems; pickedItems.clear(); render(); }),
    ]));
    const hint = {
      active: 'Вещи, которые модель получает, когда их хозяин на сцене (важные и ключевые — всегда). 🔒 закреплённые летописец не меняет.',
      shade: `Убранные сюда вручную и обычные вещи, о которых давно ни слова (${snapshot().settings?.itemsDormantAfter ?? 40} сообщений, меняется в «Настройки → Знания и сцена»). Хранятся, но модель их не получает; упомянуты снова — вернутся сами.`,
      off: 'Хранятся, но модель и летописец их не видят. Если вещь снова появится в сюжете по названию, летописец включит её сам.',
    }[itemsView];
    view.append(element('p', { className: 'muted ku-small', text: hint }));
    if (selectingItems) {
      const on = button(`В ход (${pickedItems.size})`, 'btn small', () => bulk('on'));
      const shadeButton = button(`В тень (${pickedItems.size})`, 'btn small', () => bulk('shade'));
      const off = button(`Отключить (${pickedItems.size})`, 'btn small', () => bulk('off'));
      const remove = button('Удалить', 'btn small danger', () => bulk('remove'));
      for (const node of [on, shadeButton, off, remove]) node.disabled = !pickedItems.size;
      // Only the places the shown things are not in.
      on.hidden = itemsView === 'active';
      shadeButton.hidden = itemsView === 'shade';
      off.hidden = itemsView === 'off';
      view.append(element('div', { className: 'ku-row ku-bulk' }, [
        button('Выбрать все', 'btn small', () => { shown.filter(item => !itemsFocus || item.ownerId === itemsFocus).forEach(item => pickedItems.add(item.id)); render(); }),
        button('Снять выбор', 'btn small', () => { pickedItems.clear(); render(); }),
        on, shadeButton, off, remove,
      ]));
    }
    if (itemsView === 'off' && offItems.length && !selectingItems) {
      view.append(element('div', { className: 'ku-row' }, [
        button('Удалить все отключённые', 'btn small danger', () => attempt(() => act('onItemsBulk', { itemIds: offItems.map(item => item.id), action: 'remove' }, 'items-bulk'), 'Отключённые удалены')),
      ]));
    }
    const groups = [...(itemsFocus ? [itemsFocus] : owners).map(id => [nameOf(id) + (here.includes(id) ? ' · на сцене' : ''), shown.filter(item => item.ownerId === id)]),
      ...(itemsFocus ? [] : [['Ни у кого', shown.filter(item => !item.ownerId)]])];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      view.append(element('div', { className: 'card' }, [element('h3', { text: title }), element('div', { className: 'ku-facts' }, list.map(item => itemRow(item, { shelfTools: true })))]));
    }
    if (!all.length) view.append(empty('Вещей пока нет. Летописец сцены добавит их по ходу игры, или впишите ниже.'));
    else if (!shown.length) view.append(empty({ active: 'Сейчас в ходу ничего нет.', shade: 'В тени ничего нет.', off: 'Отключённых вещей нет.' }[itemsView]));
    if (itemsView === 'active') view.append(addItemForm());
    return view;
  }

  // ---- Локации ----------------------------------------------------------------

  function renderPlaces() {
    const view = element('div', { className: 'records-view' });
    const tabs = element('div', { className: 'ku-tabs', role: 'tablist' });
    for (const [key, label] of [['library', 'Библиотека'], ['chat', 'В этом чате']]) {
      const tab = button(label, placesTab === key ? 'on' : '', () => { placesTab = key; render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(placesTab === key));
      tabs.append(tab);
    }
    view.append(tabs, placesTab === 'chat' ? renderChatPlaces() : ctx.renderLibrary('places'));
    return view;
  }

  function renderChatPlaces() {
    const box = element('div', { className: 'ku-facts' });
    const state = snapshot();
    const cards = world().locations ?? [];
    const lib = library();
    box.append(element('p', { className: 'muted ku-small', text: 'Места этого чата: включённые из библиотеки и найденные летописцем. Перемены («разбито окно») хранятся здесь.' }));
    if (!cards.length) box.append(empty('В этом чате мест пока нет.'));
    for (const card of cards) {
      const place = placeView(card);
      if (editingChatPlace === card.id) {
        const name = element('input', { type: 'text', value: card.name, 'aria-label': 'Название', disabled: Boolean(card.libraryId) });
        const traits = element('textarea', { rows: 2, value: card.traits.join('\n'), 'aria-label': 'Черты, найденные в чате' });
        const notes = element('textarea', { rows: 2, value: (card.notes ?? []).join('\n'), 'aria-label': 'Перемены сейчас' });
        box.append(element('div', { className: 'card' }, [
          element('div', { className: 'field' }, [element('label', { text: card.libraryId ? 'Название (из библиотеки)' : 'Название' }), name]),
          element('div', { className: 'field' }, [element('label', { text: card.libraryId ? 'Черты, найденные в этом чате' : 'Черты' }), traits]),
          element('div', { className: 'field' }, [element('label', { text: 'Перемены сейчас' }), notes]),
          element('div', { className: 'ku-row' }, [
            button('Сохранить', 'btn primary small', () => {
              editingChatPlace = '';
              attempt(() => act('onUpdateChatLocation', { locationId: card.id, changes: { ...(card.libraryId ? {} : { name: name.value }), traits: traits.value.split('\n'), notes: notes.value.split('\n') } }, 'place-update'), 'Место сохранено');
            }),
            button('Отмена', 'btn small', () => { editingChatPlace = ''; render(); }),
          ]),
        ]));
        continue;
      }
      const save = [];
      if (!card.libraryId) {
        const folders = element('select', { 'aria-label': 'Папка библиотеки' }, [element('option', { value: '', text: 'в папку…' }), ...lib.folders.map(folder => element('option', { value: folder.id, text: folderPath(lib, folder.id).map(step => step.name).join(' › ') }))]);
        folders.addEventListener('change', () => { if (folders.value) attempt(() => invoke('onLibrarySaveCard', { locationId: card.id, folderId: folders.value }), 'Сохранено в библиотеку'); });
        save.push(folders);
      }
      box.append(element('div', { className: `ku-fact${scene().locationId === card.id ? ' current' : ''}` }, [
        icon('pin'),
        element('span', { className: 'ku-fact-text' }, [
          element('strong', { text: locationPath(state, card.id).join(' › ') }),
          element('span', { className: 'ku-chips' }, [...place.traits.slice(0, 4).map(trait => chip(trait)), ...(place.notes ?? []).map(note => chip(note, 'warn'))]),
        ]),
        card.libraryId ? chip('из библиотеки', 'told') : chip('только в чате'),
        ...save,
        iconButton('lock', card.locked ? 'Открепить' : 'Закрепить — летописец не меняет', () => attempt(() => act('onUpdateChatLocation', { locationId: card.id, changes: { locked: !card.locked } }, 'place-lock')), card.locked),
        iconButton('edit', 'Изменить', () => { editingChatPlace = card.id; render(); }),
        iconButton('close', 'Убрать из чата', () => attempt(() => act('onRemoveChatLocation', { locationId: card.id }, 'place-remove'))),
      ]));
    }
    const name = element('input', { type: 'text', placeholder: 'Новое место этого чата', 'aria-label': 'Новое место' });
    box.append(element('div', { className: 'ku-fact' }, [name, button('Добавить', 'btn small', () => attempt(() => act('onAddChatLocation', { name: name.value }, 'place-add'), 'Место добавлено'))]));
    return box;
  }

  // ---- Хроника -------------------------------------------------------------

  function renderChronicle() {
    const view = element('div', { className: 'records-view' });
    const info = invoke('onChronicleGet', {});
    if (!info) return empty('Хроника недоступна.');
    const { config, stats, chronicle } = info;
    const run = button(info.running ? 'Сжимаю…' : 'Сжать сейчас', 'btn small', () => attempt(() => invoke('onChronicleRun', {}), result => `Новых сцен: ${result?.scenes ?? 0}, сжатий: ${result?.merges ?? 0}`));
    run.disabled = info.running || !stats.pending;
    view.append(element('div', { className: 'ku-row' }, [
      element('span', { className: 'muted ku-small', text: `${stats.messages} сообщ. → ${stats.scenes} сцен → ${stats.chapters} глав → ${stats.arcs} арок · ждут: ${stats.pending}` }),
      element('span', { className: 'ku-push' }),
      run,
      button('Настройки', 'btn small', () => ctx.openSettingsSection?.('chronicle')),
    ]));
    if (config.enabled && stats.untilNext) view.append(element('p', { className: 'muted ku-small', text: nextSceneText(stats) }));
    if (!config.enabled) view.append(element('div', { className: 'card' }, [
      element('p', { text: 'Хроника выключена: сводки не пишутся и не уходят модели.' }),
      button('Включить', 'btn primary small', () => attempt(() => invoke('onChronicleSettings', { changes: { enabled: true } }), 'Хроника включена')),
    ]));
    const byId = new Map(chronicle.summaries.map(item => [item.id, item]));
    const active = chronicle.summaries.filter(item => !item.parentId).sort((left, right) => left.seq - right.seq);
    const picked = [...pickedSummaries].map(id => byId.get(id)).filter(item => item && !item.parentId);
    const compress = button(`Сжать выбранные (${picked.length})`, 'btn small', () => attempt(() => invoke('onChronicleCompress', { ids: picked.map(item => item.id) }).then(result => { pickedSummaries.clear(); return result; }), 'Сжато'));
    compress.disabled = picked.length < 2 || picked.some(item => item.level !== picked[0].level);
    if (active.length) view.append(element('div', { className: 'ku-row' }, [element('span', { className: 'section-title', text: `Сводки · ${active.length}` }), element('span', { className: 'ku-push' }), compress]));
    else view.append(empty('Сводок пока нет.'));
    const LABEL = ['Сцена', 'Глава', 'Арка'];
    const card = (item, nested = false) => {
      const node = element('div', { className: `card ku-summary${item.pinned ? ' pinned' : ''}${nested ? ' nested' : ''}` });
      const head = element('div', { className: 'ku-row' }, [
        ...(nested ? [] : [toggle(pickedSummaries.has(item.id), 'Выбрать для сжатия', value => { if (value) pickedSummaries.add(item.id); else pickedSummaries.delete(item.id); render(); })]),
        chip(LABEL[item.level], item.level ? 'told' : ''),
        element('span', { className: 'muted ku-small', text: item.childIds ? `из ${item.childIds.length}` : `${item.messageCount ?? '?'} сообщ.` }),
        ...(item.stale ? [chip('устарела', 'warn')] : []),
        ...(item.edited ? [chip('правлена')] : []),
        element('span', { className: 'ku-push' }),
        ...(item.stale ? [button('Пересобрать', 'btn small', () => attempt(() => invoke('onChronicleRebuild', { id: item.id }), 'Сцена пересобрана'))] : []),
        iconButton('lock', item.pinned ? 'Открепить: можно сжимать' : 'Закрепить: не сжимать', () => attempt(() => invoke('onChroniclePin', { id: item.id, pinned: !item.pinned })), item.pinned),
        iconButton('edit', 'Изменить', () => { editingSummaryId = item.id; render(); }),
        iconButton('expand', item.childIds ? 'Развернуть на части' : 'Развернуть в сообщения', () => attempt(() => invoke('onChronicleUnfold', { id: item.id }))),
      ]);
      node.append(head);
      if (editingSummaryId === item.id) {
        const text = element('textarea', { rows: 5, value: item.text, 'aria-label': 'Текст сводки' });
        node.append(text, element('div', { className: 'ku-row' }, [
          button('Сохранить', 'btn primary small', () => { editingSummaryId = ''; attempt(() => invoke('onChronicleEdit', { id: item.id, text: text.value }), 'Сводка сохранена'); }),
          button('Отмена', 'btn small', () => { editingSummaryId = ''; render(); }),
        ]));
      } else {
        node.append(element('p', { className: 'ku-summary-text', text: item.text }));
      }
      if (item.childIds?.length) {
        const inner = element('details', { className: 'ku-children' }, [element('summary', { text: `Части · ${item.childIds.length}` })]);
        for (const childId of item.childIds) { const child = byId.get(childId); if (child) inner.append(card(child, true)); }
        node.append(inner);
      }
      return node;
    };
    for (const item of active) view.append(card(item));
    return view;
  }

  // ---- Проверка: утечки и ляпы -----------------------------------------------

  function renderChecks() {
    const view = element('div', { className: 'records-view' });
    const slips = snapshot().slips ?? [];
    view.append(element('p', { className: 'section-title', text: `Ляпы · ${slips.length}` }));
    if (!slips.length) view.append(empty('Открытых ляпов нет.'));
    for (const slip of slips) {
      const payload = { messageIndex: slip.messageIndex, slipIndex: slip.slipIndex };
      view.append(element('div', { className: 'card ku-leak-card' }, [
        element('div', { className: 'ku-row' }, [
          chip(slip.label, 'warn'),
          element('strong', { text: slip.name || 'Сцена' }),
          element('span', { className: 'muted ku-small ku-push', text: `сообщение #${slip.messageIndex}` }),
        ]),
        element('blockquote', { className: 'ku-quote', text: slip.quote }),
        ...(slip.note ? [element('p', { className: 'muted', text: slip.note })] : []),
        element('div', { className: 'record-actions' }, [
          slip.canSwipe
            ? button('Свайп', 'btn primary', () => attempt(() => act('onSlipSwipe', payload, 'slip-swipe')), 'Перегенерировать этот ответ')
            : button('Править', 'btn primary', () => attempt(() => act('onSlipEdit', payload, 'slip-edit')), 'Открыть сообщение для правки'),
          button('Так и есть', 'btn', () => attempt(() => act('onSlipAccept', payload, 'slip-accept')), 'Текст верный: переписать запись под него'),
          button('Не ляп', 'btn', () => attempt(() => act('onSlipDismiss', payload, 'slip-dismiss')), 'Убрать отметку, ничего не меняя'),
          button('Напомнить рассказчику', 'btn', () => attempt(() => act('onSlipRemind', payload, 'slip-remind'), 'В следующий ответ уйдёт поправка'), 'Текст не трогать, но в следующем ответе сказать модели, как на самом деле'),
        ]),
      ]));
    }
    view.append(element('p', { className: 'section-title', text: `Утечки · ${snapshot().leaks?.length ?? 0}` }));
    view.append(ctx.renderLeaks());
    // Wardrobe descriptions of characters on stage that reach the narrator cut, or not at all.
    const looks = looksIssues(snapshot().looksFit);
    view.append(element('p', { className: 'section-title', text: `Одежда · ${looks.length}` }));
    const advice = ctx.looksAdvice?.();
    if (advice) view.append(advice);
    else if (!looks.length) view.append(empty('Описания надетого доходят до модели целиком.'));
    for (const issue of looks) {
      const lost = issue.parts.filter(part => part.sent < part.total);
      view.append(element('div', { className: 'card ku-leak-card' }, [
        element('div', { className: 'ku-row' }, [
          chip(issue.status === 'dropped' ? 'не дошло' : 'обрезано', 'warn'),
          element('strong', { text: nameOf(issue.entityId) }),
        ]),
        element('p', { className: 'muted', text: issue.status === 'dropped'
          ? 'Описания надетого не влезли в сцену: модель знает только, во что одет(а), без подробностей.'
          : 'Модель получает описания надетого не целиком: всё, что дальше лимита, она не видит.' }),
        element('ul', { className: 'ku-looks-parts' }, lost.map(part => element('li', {}, [
          element('strong', { text: part.label }),
          element('span', { className: 'muted', text: part.sent ? ` — доходит ${part.sent} из ${part.total} символов` : ` — не доходит совсем (${part.total} символов)` }),
        ]))),
        ...(issue.status === 'dropped' ? [element('p', { className: 'muted ku-small', text: ctx.needText?.(snapshot().looksFit) ?? '' })] : []),
        element('div', { className: 'record-actions' }, [
          issue.status === 'dropped'
            ? button('Поднять объём сцены', 'btn primary', () => ctx.openSettingsSection?.('scene', { focus: 'Объём сцены' }))
            : button('Поднять лимит описаний', 'btn primary', () => ctx.openSettingsSection?.('scene', { focus: 'Описание одной вещи' })),
          button('Открыть гардероб', 'btn', () => ctx.openDossier?.(issue.entityId, 'wardrobe'), 'Посмотреть и сократить описания'),
        ]),
      ]));
    }
    return view;
  }

  /** Show the things page for one character (from a slip, a dossier, the chat). */
  function focusItems(entityId) {
    itemsFocus = entityId ?? '';
    itemsTab = 'chat';
    itemsView = 'active';
  }

  return { renderNow, renderPlaces, renderItems, renderChronicle, renderChecks, renderWardrobeTab, renderHeldTab, renderLooksTab, focusItems };
}

/** Styles of the world pages; colours only from the theme tokens. */
export const WORLD_STYLE = `
.ku-now{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;container-type:inline-size}
.ku-strip{flex:1 1 100%;display:flex;gap:12px;flex-wrap:wrap;align-items:stretch}
.ku-clock{display:flex;flex-direction:column;justify-content:center;gap:3px;padding:10px 16px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);color:var(--k-text);font:inherit;text-align:left;cursor:pointer;min-width:130px}
.ku-clock strong{font-size:30px;line-height:1;font-variant-numeric:tabular-nums}
.ku-clock .muted{font-size:12px}
.ku-clock.editing{cursor:default;gap:8px}
.ku-place{flex:1 1 280px;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:10px 14px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);color:var(--k-text);font:inherit;text-align:left;cursor:pointer;min-width:0}
.ku-place.editing{cursor:default}
.ku-clock:not(.editing):hover,.ku-place:not(.editing):hover{border-color:var(--k-accent-line)}
.ku-crumbs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px}
.ku-crumbs strong{font-size:16px}
.ku-crumb{border:0;background:transparent;color:var(--k-muted);font:inherit;cursor:pointer;padding:2px 0}
.ku-crumb:last-child{color:var(--k-text);font-weight:700}
.ku-chips{display:flex;gap:6px;flex-wrap:wrap}
.ku-now-main{flex:999 1 420px;min-width:0;display:flex;flex-direction:column;gap:10px}
.ku-stage{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:10px}
.ku-actor{display:flex;flex-direction:column;gap:8px;text-align:left;padding:12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);color:var(--k-text);font:inherit;cursor:pointer;min-width:0}
.ku-actor:hover{border-color:var(--k-accent-line)}
.ku-outfit{display:flex;gap:7px;align-items:flex-start;font-size:12.5px;line-height:1.35}
.ku-outfit .ku-ico{color:var(--k-muted);flex:0 0 auto}
.ku-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.ku-push{margin-left:auto}
.ku-small{font-size:12px}
.ku-inline{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}
.ku-short{width:90px!important;flex:0 0 auto}
.ku-search{width:auto!important;flex:1 1 140px;min-width:0}
.ku-stats-named{gap:6px}
.ku-stat{display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 7px;border-radius:20px;background:var(--k-inset);font-size:12px;color:var(--k-muted)}
.ku-stat b{font-size:13px;margin:0}
.ku-stat .ku-ico{width:13px;height:13px;flex:0 0 auto}
.ku-stat:hover{color:var(--k-text)}
.ku-stat.warn b,.ku-stat.warn .ku-ico{color:var(--k-warn)}
.ku-backstage{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-inset)}
.ku-backstage-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
.ku-backstage-head .section-title{margin:0}
.ku-backstage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:6px}
.ku-off{display:flex;align-items:center;gap:9px;min-width:0;min-height:44px;padding:6px 8px;border:1px solid transparent;border-radius:11px;background:var(--k-panel);color:var(--k-text);font:inherit;text-align:left;cursor:pointer}
.ku-off:hover,.ku-off:focus-visible{border-color:var(--k-accent-line)}
.ku-off .avatar{flex:0 0 auto}
.ku-off-text{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;line-height:1.25}
.ku-off-text strong{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-off-text .muted{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-off-go{flex:0 0 auto;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:var(--k-accent);background:var(--k-accent-soft);opacity:0;transition:opacity .15s}
.ku-off:hover .ku-off-go,.ku-off:focus-visible .ku-off-go{opacity:1}
.ku-backstage-more{align-self:flex-start;border:0;background:transparent;color:var(--k-accent);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;padding:2px 0}
.ku-mini{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border:1px solid var(--k-line);border-radius:20px;background:var(--k-inset);color:var(--k-text);font:inherit;font-size:12.5px;cursor:pointer}
.ku-mini:hover{border-color:var(--k-accent-line)}
.ku-things{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:8px}
.ku-thing{display:flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid var(--k-line);border-radius:11px;background:var(--k-inset);font-size:13px;min-width:0}
.ku-thing .ku-ico{color:var(--k-muted)}
.ku-feed{flex:1 1 260px;max-width:360px;display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel)}
.ku-feed-row{display:flex;align-items:flex-start;gap:9px;font-size:12.5px;line-height:1.35}
.ku-feed-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.ku-feed-row .ku-ib{width:26px;height:26px;min-height:26px;opacity:.55}
.ku-feed-row:hover .ku-ib,.ku-feed-row .ku-ib:focus-visible{opacity:1}
.ku-feed-alert{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid var(--k-warn);border-radius:10px;font-size:12.5px;line-height:1.35;color:var(--k-text)}
.ku-feed-alert .ku-ico{color:var(--k-warn)}
.ku-rename{display:inline-flex;gap:6px;align-items:center}
.ku-rename input{width:180px!important}
.ku-feed-icon{width:26px;height:26px;border-radius:8px;border:1px solid var(--k-line);background:var(--k-inset);display:grid;place-items:center;color:var(--k-muted);flex:0 0 auto}
.ku-feed-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding-top:8px;border-top:1px solid var(--k-line)}
.ku-ib{width:30px;height:30px;min-height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--k-muted);display:grid;place-items:center;cursor:pointer;flex:0 0 auto}
.ku-ib:hover{color:var(--k-text);background:var(--k-inset)}
.ku-ib.on{color:var(--k-accent)}
.ku-fact.current{border-color:var(--k-accent)}
.ku-fact.off{opacity:.6}
.ku-subtabs{max-width:none;margin-bottom:4px}
.ku-bulk{padding:8px 10px;border:1px dashed var(--k-accent-line);border-radius:10px}
.ku-looks-line{font-size:12.5px;line-height:1.35;color:var(--k-text)}
.ku-fact.editing{flex-direction:column;align-items:stretch}
.ku-fact input[type=text]{flex:1 1 180px;width:auto}
.ku-item-edit{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),1fr));gap:8px;align-items:center}
.ku-toolbar{padding:8px 0}
.ku-folders{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:8px}
.ku-folder{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid var(--k-line);border-radius:12px;background:var(--k-panel);color:var(--k-text);font:inherit;text-align:left;cursor:pointer}
.ku-folder .ku-ico{color:var(--k-accent)}
.ku-places{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:10px}
.ku-place-card{display:flex;flex-direction:column;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);overflow:hidden}
.ku-place-card.on{border-color:var(--k-accent);box-shadow:0 0 0 3px var(--k-accent-soft)}
.ku-place-open{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:0 12px 8px;border:0;background:transparent;color:var(--k-text);font:inherit;text-align:left;cursor:pointer}
.ku-cover{align-self:stretch;margin:0 -12px 4px;height:48px;display:flex;align-items:flex-end;padding:6px 12px;font-size:22px;font-weight:800;background:var(--k-accent-soft);color:var(--k-accent)}
.ku-place-card .ku-inline{padding:8px 12px;border-top:1px solid var(--k-line)}
.ku-place-editor .field{margin:8px 0}
.ku-import-list{display:grid;gap:4px;max-height:260px;overflow:auto;margin:8px 0}
.ku-summary{display:flex;flex-direction:column;gap:8px}
.ku-summary.pinned{border-color:var(--k-accent-line)}
.ku-summary.nested{background:var(--k-inset)}
.ku-summary-text{margin:0;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
.ku-children>summary{cursor:pointer;font-size:12.5px;color:var(--k-muted)}
.ku-children .ku-summary{margin-top:8px}
.btn.danger{color:var(--k-warn)}
@container (max-width:620px){.ku-feed{max-width:none;flex-basis:100%}.ku-stage{grid-template-columns:1fr}}
`;
