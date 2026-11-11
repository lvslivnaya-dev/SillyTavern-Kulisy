import { button, element } from '../helpers.js';
import { SYSTEM_LIMITS, normalizeSystem, yearLength } from '../../core/calendar-system.js';
import { BUILTIN_CLIMATES, MONTH_NAMES, WEATHER_KINDS, WEATHER_KIND_IDS } from '../../core/weather.js';

/**
 * «Календарь мира» (Мир → Календарь): a calendar of your own for this chat — months, days of the week,
 * seasons with a climate, the era, a leap rule. Ready calendars and your saved ones are listed; applying one
 * clears the date of the story and the events (their dates mean something else in another calendar), so that
 * takes a second press. Everything goes through calendarCallbacks in index.js.
 */
export function createCalendarBuilder(ctx, { attempt }) {
  const render = (...args) => ctx.render(...args);
  const act = (...args) => ctx.act(...args);
  const snapshot = () => ctx.snapshot;

  let draft = null; // the calendar being made or changed
  let armed = ''; // what waits for the second press: 'apply-draft' | 'earth' | 'apply:<id>'
  let counter = 0;
  let source = { climateId: BUILTIN_CLIMATES[0].id, month: 1 }; // where «взять погоду» copies from

  const chatSystem = () => snapshot().calendar?.system ?? null;
  const library = () => snapshot().calendarSystems ?? [];
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${(counter += 1).toString(36)}`;
  const summary = system => `${system.months.length} мес., ${yearLength(system)} дн. в году, неделя из ${system.weekdays.length} дн.${system.seasons.length ? `, сезонов: ${system.seasons.length}` : ''}`;
  const copy = value => JSON.parse(JSON.stringify(value));

  function blank() {
    const seasons = ['Зима', 'Весна', 'Лето', 'Осень'].map(name => ({ id: uid('season'), name }));
    return {
      id: uid('calsys'), name: 'Мой календарь', era: '', startWeekday: 1,
      weekdays: Array.from({ length: 7 }, (_, index) => ({ name: `День ${index + 1}`, short: `Д${index + 1}` })),
      seasons,
      months: Array.from({ length: 12 }, (_, index) => ({ name: `Месяц ${index + 1}`, of: '', days: 30, season: seasons[Math.floor(index / 3)].id })),
    };
  }

  /** A copy to change: your own keeps its id; a ready one becomes a new calendar. */
  function edit(system) {
    const made = copy(system);
    if (system.ready) { delete made.ready; made.id = uid('calsys'); made.name = `${system.name} (моя копия)`; }
    draft = made;
    armed = '';
    render();
  }

  const bindText = (node, object, key) => { node.addEventListener('input', () => { object[key] = node.value; }); return node; };
  const bindNumber = (node, object, key) => { node.addEventListener('input', () => { object[key] = node.value === '' ? '' : Number(node.value); }); return node; };
  const field = (label, control, hint) => element('label', { className: 'ku-cal-field' }, [element('span', { text: label }), control, ...(hint ? [element('small', { className: 'muted', text: hint })] : [])]);
  const sectionTitle = text => element('p', { className: 'section-title', style: { margin: '14px 0 6px' }, text });

  // ---- The parts of the editor ----------------------------------------------------------

  function weekdaysPart() {
    const box = element('div', { className: 'ku-cb-list' });
    draft.weekdays.forEach((day, index) => {
      box.append(element('div', { className: 'ku-cb-row' }, [
        element('span', { className: 'muted ku-small', text: `${index + 1}.` }),
        bindText(element('input', { value: day.name, placeholder: 'Название дня', 'aria-label': `День недели ${index + 1}: название`, maxLength: 24 }), day, 'name'),
        bindText(element('input', { value: day.short, placeholder: 'кратко', className: 'ku-short', 'aria-label': `День недели ${index + 1}: коротко`, maxLength: 5 }), day, 'short'),
        button('×', 'btn icon small', () => { if (draft.weekdays.length > SYSTEM_LIMITS.weekdays[0]) { draft.weekdays.splice(index, 1); render(); } }, 'Убрать день недели'),
      ]));
    });
    const first = element('select', { 'aria-label': 'Каким днём недели начинается первый год' }, draft.weekdays.map((day, index) => element('option', { value: index + 1, text: day.name || `День ${index + 1}`, selected: Number(draft.startWeekday) === index + 1 })));
    first.addEventListener('change', () => { draft.startWeekday = Number(first.value); });
    return element('div', {}, [
      sectionTitle(`Дни недели · ${draft.weekdays.length}`),
      box,
      element('div', { className: 'row', style: { marginTop: '6px' } }, [
        button('+ День недели', 'btn small', () => { if (draft.weekdays.length < SYSTEM_LIMITS.weekdays[1]) { draft.weekdays.push({ name: `День ${draft.weekdays.length + 1}`, short: `Д${draft.weekdays.length + 1}` }); render(); } }),
      ]),
      field('Каким днём недели начинается первый год', first),
    ]);
  }

  function seasonRow(season) {
    const details = element('details', { className: 'ku-cb-season' });
    const hasWeather = season.kinds && Object.keys(season.kinds).length;
    details.append(element('summary', {}, [
      element('strong', { text: season.name || 'Сезон' }),
      element('span', { className: 'muted ku-small', text: hasWeather ? ` · ${season.min}…${season.max}° · ${Object.entries(season.kinds).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([kind]) => WEATHER_KINDS[kind].icon).join(' ')}` : ' · погода не задана' }),
    ]));
    season.kinds ??= {};
    const kinds = element('div', { className: 'ku-cb-kinds' }, WEATHER_KIND_IDS.map(kind => {
      const input = element('input', { type: 'number', min: 0, max: 100, value: season.kinds[kind] ?? '', placeholder: '0', 'aria-label': `${season.name}: шанс «${WEATHER_KINDS[kind].label}»` });
      input.addEventListener('input', () => { if (input.value === '' || Number(input.value) <= 0) delete season.kinds[kind]; else season.kinds[kind] = Number(input.value); });
      return element('label', { className: 'ku-cb-kind', title: WEATHER_KINDS[kind].label }, [element('span', { text: WEATHER_KINDS[kind].icon }), input]);
    }));
    const copyFrom = element('div', { className: 'row' }, [
      element('span', { className: 'muted ku-small', text: 'Взять погоду из готового:' }),
      (() => { const node = element('select', { 'aria-label': 'Готовый климат' }, BUILTIN_CLIMATES.map(item => element('option', { value: item.id, text: item.name, selected: item.id === source.climateId }))); node.addEventListener('change', () => { source.climateId = node.value; }); return node; })(),
      (() => { const node = element('select', { 'aria-label': 'Месяц' }, MONTH_NAMES.map((name, index) => element('option', { value: index + 1, text: name, selected: source.month === index + 1 }))); node.addEventListener('change', () => { source.month = Number(node.value); }); return node; })(),
      button('Взять', 'btn small', () => {
        const month = BUILTIN_CLIMATES.find(item => item.id === source.climateId)?.months[source.month - 1];
        if (!month) return;
        Object.assign(season, { min: month.min, max: month.max, kinds: { ...month.kinds } });
        render();
      }, 'Скопировать температуру и шансы погоды из месяца готового климата; потом можно поправить'),
    ]);
    details.append(element('div', { className: 'ku-cb-season-body' }, [
      element('div', { className: 'ku-cal-fields' }, [
        field('Название', bindText(element('input', { value: season.name, maxLength: 40, 'aria-label': 'Название сезона' }), season, 'name')),
        field('Температура от, °C', bindNumber(element('input', { type: 'number', value: season.min ?? '', placeholder: '-5', 'aria-label': 'Температура от' }), season, 'min')),
        field('до, °C', bindNumber(element('input', { type: 'number', value: season.max ?? '', placeholder: '12', 'aria-label': 'Температура до' }), season, 'max')),
      ]),
      element('p', { className: 'muted ku-small', style: { margin: '6px 0 4px' }, text: 'Шансы погоды: чем больше число, тем чаще. Пусто или 0 — такой погоды в сезоне не бывает.' }),
      kinds,
      copyFrom,
      button('Удалить сезон', 'btn small danger', () => {
        draft.seasons = draft.seasons.filter(item => item !== season);
        for (const month of draft.months) if (month.season === season.id) month.season = '';
        render();
      }),
    ]));
    return details;
  }

  function seasonsPart() {
    return element('div', {}, [
      sectionTitle(`Сезоны и климат · ${draft.seasons.length}`),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 6px' }, text: 'Сезон задаёт погоду для своих месяцев: температуру и шансы дождя, снега, жары. Прогноз на странице «Погода» берётся отсюда.' }),
      ...draft.seasons.map(seasonRow),
      element('div', { className: 'row', style: { marginTop: '6px' } }, [
        button('+ Сезон', 'btn small', () => { if (draft.seasons.length < SYSTEM_LIMITS.seasons) { draft.seasons.push({ id: uid('season'), name: `Сезон ${draft.seasons.length + 1}` }); render(); } }),
      ]),
    ]);
  }

  function monthsPart() {
    const box = element('div', { className: 'ku-cb-list' });
    draft.months.forEach((month, index) => {
      const season = element('select', { 'aria-label': `Месяц ${index + 1}: сезон` }, [element('option', { value: '', text: 'без сезона', selected: !month.season }), ...draft.seasons.map(item => element('option', { value: item.id, text: item.name, selected: month.season === item.id }))]);
      season.addEventListener('change', () => { month.season = season.value; });
      box.append(element('div', { className: 'ku-cb-row ku-cb-month' }, [
        element('span', { className: 'muted ku-small', text: `${index + 1}.` }),
        bindText(element('input', { value: month.name, placeholder: 'Название месяца', 'aria-label': `Месяц ${index + 1}: название`, maxLength: 40 }), month, 'name'),
        bindText(element('input', { value: month.of ?? '', placeholder: 'после числа: «3 …»', 'aria-label': `Месяц ${index + 1}: форма после числа`, maxLength: 40 }), month, 'of'),
        bindNumber(element('input', { type: 'number', min: 1, max: 99, value: month.days, className: 'ku-short', 'aria-label': `Месяц ${index + 1}: дней` }), month, 'days'),
        season,
        button('↑', 'btn icon small', () => { if (index > 0) { [draft.months[index - 1], draft.months[index]] = [draft.months[index], draft.months[index - 1]]; render(); } }, 'Выше'),
        button('↓', 'btn icon small', () => { if (index < draft.months.length - 1) { [draft.months[index + 1], draft.months[index]] = [draft.months[index], draft.months[index + 1]]; render(); } }, 'Ниже'),
        button('×', 'btn icon small', () => { if (draft.months.length > 1) { draft.months.splice(index, 1); render(); } }, 'Убрать месяц'),
      ]));
    });
    const total = draft.months.reduce((sum, month) => sum + (Number(month.days) || 0), 0);
    return element('div', {}, [
      sectionTitle(`Месяцы · ${draft.months.length}`),
      box,
      element('div', { className: 'row', style: { marginTop: '6px' } }, [
        button('+ Месяц', 'btn small', () => { if (draft.months.length < SYSTEM_LIMITS.months[1]) { draft.months.push({ name: `Месяц ${draft.months.length + 1}`, of: '', days: 30, season: draft.months.at(-1)?.season ?? '' }); render(); } }),
        element('span', { className: 'muted ku-small', text: `В году ${total} дн.` }),
      ]),
    ]);
  }

  function leapPart() {
    const on = element('input', { type: 'checkbox', checked: Boolean(draft.leap), 'aria-label': 'Високосные годы' });
    on.addEventListener('change', () => { if (on.checked) draft.leap = { every: 4, month: draft.months.length, extra: 1 }; else delete draft.leap; render(); });
    const part = element('div', {}, [sectionTitle('Високосные годы'), element('label', { className: 'strangers-toggle' }, [on, 'У какого-то месяца раз в несколько лет больше дней'])]);
    if (draft.leap) {
      const month = element('select', { 'aria-label': 'Какому месяцу добавляются дни' }, draft.months.map((item, index) => element('option', { value: index + 1, text: item.name || `Месяц ${index + 1}`, selected: draft.leap.month === index + 1 })));
      month.addEventListener('change', () => { draft.leap.month = Number(month.value); });
      part.append(element('div', { className: 'ku-cal-fields' }, [
        field('Каждый N-й год', bindNumber(element('input', { type: 'number', min: 2, max: 1000, value: draft.leap.every, 'aria-label': 'Каждый какой год' }), draft.leap, 'every')),
        field('Месяц', month),
        field('Сколько дней добавить', bindNumber(element('input', { type: 'number', min: 1, max: 30, value: draft.leap.extra, 'aria-label': 'Сколько дней добавить' }), draft.leap, 'extra')),
      ]));
    }
    return part;
  }

  // ---- The editor and the page -------------------------------------------------------------

  function renderEditor() {
    const checked = () => normalizeSystem(draft);
    const apply = button(armed === 'apply-draft' ? 'Точно применить? Дата и события чата очистятся' : 'Применить к этому чату', `btn primary${armed === 'apply-draft' ? ' armed' : ''}`, () => {
      if (!checked()) { ctx.setStatus('Календарь неполный: нужны название, не меньше двух дней недели и хотя бы один месяц.', true); return; }
      if (armed !== 'apply-draft') { armed = 'apply-draft'; render(); return; }
      armed = '';
      attempt(async () => { await act('onCalendarSetSystem', { system: draft }, 'calendar-system'); draft = null; render(); }, 'Календарь применён. Задайте дату истории: она начнёт отсчёт по новому календарю.');
    });
    return element('div', { className: 'ku-cb-editor' }, [
      element('h3', { text: draft.name || 'Новый календарь' }),
      element('div', { className: 'ku-cal-fields' }, [
        field('Название календаря', bindText(element('input', { value: draft.name, maxLength: 40, 'aria-label': 'Название календаря' }), draft, 'name')),
        field('Эра', bindText(element('input', { value: draft.era ?? '', placeholder: 'эры Огня', maxLength: 40, 'aria-label': 'Эра' }), draft, 'era'), 'год пишется так: «14 год эры Огня»; можно пусто'),
      ]),
      weekdaysPart(),
      seasonsPart(),
      monthsPart(),
      leapPart(),
      element('div', { className: 'row', style: { marginTop: '14px' } }, [
        apply,
        button('Сохранить в библиотеку', 'btn', () => {
          if (!checked()) { ctx.setStatus('Календарь неполный: нужны название, не меньше двух дней недели и хотя бы один месяц.', true); return; }
          attempt(async () => { await act('onCalendarSaveSystem', { system: draft }, 'calendar-system-save'); }, 'Календарь сохранён: он есть во всех чатах');
        }),
        button('Закрыть редактор', 'btn', () => { draft = null; armed = ''; render(); }),
      ]),
    ]);
  }

  function libraryRow(system) {
    const key = `apply:${system.id}`;
    return element('div', { className: 'ku-fact' }, [
      element('span', { className: 'ku-fact-text' }, [element('strong', { text: system.name }), element('span', { className: 'muted', text: ` · ${summary(system)}${system.ready ? ' · готовый' : ''}` })]),
      button(armed === key ? 'Точно? Дата и события очистятся' : 'Применить', `btn small${armed === key ? ' primary armed' : ''}`, () => {
        if (armed !== key) { armed = key; render(); return; }
        armed = '';
        attempt(() => act('onCalendarSetSystem', { system }, 'calendar-system'), 'Календарь применён. Задайте дату истории.');
      }),
      button(system.ready ? 'Копию править' : 'Править', 'btn small', () => edit(system)),
      ...(system.ready ? [] : [button('×', 'btn icon small', () => attempt(() => act('onCalendarRemoveSystem', { id: system.id }, 'calendar-system-remove'), 'Календарь удалён из библиотеки'), `Удалить календарь ${system.name}`)]),
    ]);
  }

  function renderBuilder() {
    const system = chatSystem();
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Календарь мира' })]);
    card.append(element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: system
      ? `У этого чата свой календарь «${system.name}»: ${summary(system)}.`
      : 'У этого чата земной календарь. Можно сделать свой: месяцы, дни недели, сезоны с погодой. Другой календарь меняет даты, поэтому дата истории и события при его выборе очищаются.' }));
    card.append(element('div', { className: 'row' }, [
      button('Создать свой календарь', 'btn primary', () => { draft = blank(); armed = ''; render(); }),
      ...(system ? [
        button('Править календарь чата', 'btn', () => edit(system)),
        button(armed === 'earth' ? 'Точно? Дата и события очистятся' : 'Вернуть земной', `btn${armed === 'earth' ? ' armed' : ''}`, () => {
          if (armed !== 'earth') { armed = 'earth'; render(); return; }
          armed = '';
          attempt(() => act('onCalendarSetSystem', { system: null }, 'calendar-system'), 'Вернулся земной календарь. Задайте дату истории.');
        }),
      ] : []),
    ]));
    const list = library();
    card.append(sectionTitle(`Готовые и мои календари · ${list.length}`));
    for (const item of list) card.append(libraryRow(item));
    if (draft) card.append(renderEditor());
    return card;
  }

  return { renderBuilder };
}

export const CALENDAR_BUILDER_STYLE = `
.ku-cb-editor{margin-top:14px;padding-top:12px;border-top:1px solid var(--k-line)}
.ku-cb-list{display:flex;flex-direction:column;gap:6px}
.ku-cb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ku-cb-row input,.ku-cb-row select{min-width:0;width:auto;flex:1 1 110px}
.ku-cb-row .ku-short{flex:0 0 72px;width:72px}
.ku-cb-season{border:1px solid var(--k-line);border-radius:10px;margin-top:6px;background:var(--k-panel)}
.ku-cb-season summary{padding:8px 10px;cursor:pointer}
.ku-cb-season-body{padding:4px 10px 10px;display:flex;flex-direction:column;gap:8px}
.ku-cb-kinds{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px}
.ku-cb-kind{display:flex;flex-direction:column;align-items:center;gap:2px}
.ku-cb-kind input{width:100%;min-width:0;padding:4px}
@container (max-width:560px){.ku-cb-kinds{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
