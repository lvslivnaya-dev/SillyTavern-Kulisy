import { button, characterId, characterName, element } from '../helpers.js';
import { MONTHS, clockOf, eventsOn, upcoming } from '../../core/calendar.js';
import { createCalendarBuilder } from './calendar-builder.js';

/**
 * «Календарь» (Мир → Календарь): the story's dates, a month grid, events of a day,
 * the event editor, templates and the generator. Every change goes through
 * the handlers in index.js (calendarCallbacks).
 */
export function createCalendarPages(ctx) {
  const act = (...args) => ctx.act(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const snapshot = () => ctx.snapshot;

  let month = ''; // 'YYYY-MM' on screen
  let selected = ''; // 'YYYY-MM-DD'
  let draft = null; // the event in the editor
  let generated = null; // { name, startMonth, events } from the generator
  let picked = new Set(); // generated events to take
  let wish = '';
  let busy = false;

  const calendar = () => snapshot().calendar ?? { anchor: '', events: [] };
  const today = () => snapshot().calendarToday || '';
  const characters = () => snapshot().characters ?? [];
  const nameOf = id => characterName(characters().find(item => characterId(item) === id), id);
  const thisYear = () => Number((today() || calendar().anchor || new Date().toISOString()).slice(0, 4));
  /** The rules of dates of this chat's calendar (earthly or its own). */
  const cal = () => clockOf(calendar());
  const humanDate = (iso, options) => cal().humanDate(iso, options);
  const addDays = (iso, days) => cal().addDays(iso, days);
  const weekdayOf = iso => cal().weekdayOf(iso);
  const parseDate = iso => (cal().valid(iso) ? cal().parse(iso) : null);

  /**
   * A date field: the browser's date picker for the earthly calendar; day, month and year for your own
   * (the browser does not know its months). The returned node has `.value` like an input: 'Y-MM-DD' or ''.
   */
  function dateInput(value, attrs = {}) {
    const clock = cal();
    if (!clock.custom) return element('input', { type: 'date', value: value ?? '', ...attrs });
    const wrapper = element('div', { className: 'ku-cal-date', role: 'group', 'aria-label': attrs['aria-label'] ?? 'Дата' });
    const [y, m, d] = /^\d+-\d+-\d+$/.test(value ?? '') ? value.split('-').map(Number) : [0, 0, 0];
    const day = element('input', { type: 'number', min: 1, max: 99, value: d || '', placeholder: 'день', className: 'ku-short', 'aria-label': 'День месяца' });
    const monthSelect = element('select', { 'aria-label': 'Месяц' }, [element('option', { value: '', text: 'месяц', selected: !m }), ...clock.monthNames.map((name, index) => element('option', { value: index + 1, text: name, selected: m === index + 1 }))]);
    const year = element('input', { type: 'number', min: 1, max: 9999, value: y || '', placeholder: 'год', className: 'ku-short', 'aria-label': 'Год' });
    wrapper.append(day, monthSelect, year);
    Object.defineProperty(wrapper, 'value', {
      get: () => (day.value && monthSelect.value && year.value ? `${String(year.value).padStart(4, '0')}-${String(monthSelect.value).padStart(2, '0')}-${String(day.value).padStart(2, '0')}` : ''),
      set: () => {},
    });
    return wrapper;
  }
  /** Same for events: the editor's draft keeps the text of the field. */
  function dateField(event, key, attrs = {}) {
    const node = dateInput(event[key], attrs);
    node.addEventListener('input', () => { event[key] = node.value; });
    node.addEventListener('change', () => { event[key] = node.value; });
    return node;
  }

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(typeof done === 'function' ? done(result) : done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }

  function blankEvent(date) {
    return { title: '', note: '', date, endDate: '', time: '', repeat: 'none', weekdays: [weekdayOf(date) || 1], until: '', who: [], must: false, ahead: 0 };
  }

  // ---- «Сегодня в истории» --------------------------------------------------
  function renderToday() {
    const day = snapshot().world?.clock?.day ?? 0;
    const input = dateInput(today(), { 'aria-label': 'Какая сегодня дата в истории' });
    const save = button('Запомнить', 'btn small primary', () => attempt(() => act('onCalendarSetToday', { date: input.value }, 'calendar-today'), 'Дата истории записана'));
    const text = today()
      ? `Сегодня в истории: ${humanDate(today())}${day ? ` (день ${day})` : ''}. Дальше даты идут сами, вслед за днями истории.`
      : day ? `Сейчас день ${day} истории, но его дата не задана. Укажите её — и у каждого дня появится настоящая дата.`
        : 'Летописец ещё не знает, какой сегодня день истории. Укажите дату: это будет день 1.';
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Дата истории' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text }),
      element('div', { className: 'row' }, [input, save]),
    ]);
  }

  // ---- Month grid -------------------------------------------------------------
  function renderMonth() {
    const clock = cal();
    const N = clock.monthsCount;
    const W = clock.weekdayCount;
    const pad = (year, monthNumber) => `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}`;
    const fallback = clock.custom ? '0001-01-01' : new Date().toISOString().slice(0, 10);
    const known = value => (clock.valid(value) ? value : '');
    const base = month || (known(selected) || known(today()) || fallback).slice(0, 7);
    month = base;
    const first = `${base}-01`;
    const [year, monthNumber] = base.split('-').map(Number);
    const offset = clock.weekdayOf(first) - 1;
    const start = clock.addDays(first, -offset);
    const length = clock.daysInMonth(year, monthNumber);
    const rows = clock.custom ? Math.ceil((offset + length) / W) : 6;
    const shift = delta => {
      const total = Math.max(0, year * N + (monthNumber - 1) + delta);
      month = pad(Math.max(1, Math.floor(total / N)), (total % N) + 1);
      render();
    };
    const grid = element('div', { className: 'ku-cal-grid', role: 'grid', style: { gridTemplateColumns: `repeat(${W}, minmax(0, 1fr))` } });
    for (const label of clock.weekdayShort) grid.append(element('span', { className: 'ku-cal-head', text: label }));
    for (let index = 0; index < rows * W; index += 1) {
      const iso = start ? clock.addDays(start, index) : '';
      if (!iso) { grid.append(element('span', { className: 'ku-cal-cell other', 'aria-hidden': 'true' })); continue; }
      const items = eventsOn(calendar(), iso);
      const cell = element('button', {
        type: 'button',
        className: ['ku-cal-cell', iso.slice(0, 7) !== base ? 'other' : '', iso === today() ? 'today' : '', iso === selected ? 'on' : '', items.some(item => item.must) ? 'must' : ''].filter(Boolean).join(' '),
        'aria-label': `${humanDate(iso)}${items.length ? `: ${items.map(item => item.title).join(', ')}` : ''}`,
        title: items.map(item => `${item.time ? `${item.time} ` : ''}${item.title}`).join('\n') || humanDate(iso),
      }, [
        element('span', { className: 'ku-cal-num', text: String(Number(iso.slice(8))) }),
        ...items.slice(0, 2).map(item => element('span', { className: `ku-cal-dot${item.must ? ' must' : ''}`, text: item.title })),
        ...(items.length > 2 ? [element('span', { className: 'ku-cal-more', text: `+${items.length - 2}` })] : []),
      ]);
      cell.addEventListener('click', () => { selected = iso; draft = null; render(); });
      grid.append(cell);
    }
    const season = clock.custom ? clock.seasonOf(monthNumber) : null;
    return element('div', { className: 'card' }, [
      element('div', { className: 'ku-row' }, [
        button('‹', 'btn small', () => shift(-1), 'Предыдущий месяц'),
        element('strong', { className: 'ku-cal-title', text: `${clock.monthNames[monthNumber - 1] ?? ''} ${year}${clock.custom && clock.system.era ? ` ${clock.system.era}` : ''}` }),
        button('›', 'btn small', () => shift(1), 'Следующий месяц'),
        ...(season ? [element('span', { className: 'muted ku-small', text: season.name })] : []),
        element('span', { className: 'ku-push' }),
        ...(today() ? [button('К сегодняшнему', 'btn small', () => { month = today().slice(0, 7); selected = today(); render(); })] : []),
      ]),
      grid,
    ]);
  }

  // ---- A day: its events and the editor ---------------------------------------
  function describe(event) {
    const parts = [];
    if (event.repeat === 'weekly') parts.push(`по ${(event.weekdays ?? []).map(day => cal().weekdayShort[day - 1]).join(', ')}`);
    if (event.repeat === 'daily') parts.push('каждый день');
    if (event.repeat === 'yearly') parts.push('каждый год');
    if (event.endDate) parts.push(`${humanDate(event.date, { weekday: false })} – ${humanDate(event.endDate, { weekday: false })}`);
    if (event.until) parts.push(`до ${humanDate(event.until, { weekday: false })}`);
    if (event.who?.length) parts.push(event.who.map(nameOf).join(', '));
    if (event.ahead) parts.push(`знают за ${event.ahead} дн.`);
    return parts.join(' · ');
  }

  function eventRow(event) {
    return element('div', { className: `ku-cal-event${event.must ? ' must' : ''}` }, [
      element('div', { className: 'ku-cal-event-text' }, [
        element('strong', { text: `${event.time ? `${event.time} · ` : ''}${event.title}` }),
        element('span', { className: `ku-tag${event.must ? ' on' : ''}`, text: event.must ? 'случится' : 'фон' }),
        ...(describe(event) ? [element('span', { className: 'muted ku-small', text: describe(event) })] : []),
        ...(event.note ? [element('span', { className: 'ku-small', text: event.note })] : []),
      ]),
      button('Изменить', 'btn small', () => { draft = { ...blankEvent(event.date), ...event }; render(); }),
      button('×', 'btn icon small', () => attempt(() => act('onCalendarRemoveEvent', { id: event.id }, 'calendar-remove'), 'Событие удалено'), 'Удалить событие'),
    ]);
  }

  function renderDay() {
    if (!selected) return element('p', { className: 'muted', text: 'Выберите день в календаре, чтобы увидеть и добавить его события.' });
    const items = eventsOn(calendar(), selected);
    const card = element('div', { className: 'card' }, [
      element('div', { className: 'ku-row' }, [
        element('h3', { text: humanDate(selected), style: { margin: '0' } }),
        element('span', { className: 'ku-push' }),
        button('+ Событие', 'btn small primary', () => { draft = blankEvent(selected); render(); }),
      ]),
    ]);
    if (!items.length) card.append(element('p', { className: 'muted ku-small', text: 'В этот день ничего не записано.' }));
    for (const event of items) card.append(eventRow(event));
    if (draft) card.append(renderEditor());
    return card;
  }

  function renderEditor() {
    const event = draft;
    const field = (label, control, hint) => element('label', { className: 'ku-cal-field' }, [element('span', { text: label }), control, ...(hint ? [element('small', { className: 'muted', text: hint })] : [])]);
    const input = (key, attrs = {}) => {
      const node = element('input', { value: event[key] ?? '', ...attrs });
      node.addEventListener('input', () => { event[key] = node.value; });
      return node;
    };
    const note = element('textarea', { value: event.note ?? '', rows: 2, placeholder: 'Подробности для модели: что проверяют, где, кто строгий, что взять с собой' });
    note.addEventListener('input', () => { event.note = note.value; });
    const repeat = element('select', {}, [['none', 'Один раз / отрезок'], ['weekly', 'По дням недели'], ['daily', 'Каждый день'], ['yearly', 'Каждый год']]
      .map(([value, text]) => element('option', { value, text, selected: event.repeat === value })));
    repeat.addEventListener('change', () => { event.repeat = repeat.value; render(); });
    const weekdays = element('div', { className: 'ku-cal-weekdays' }, cal().weekdayShort.map((label, index) => {
      const box = element('input', { type: 'checkbox', checked: (event.weekdays ?? []).includes(index + 1) });
      box.addEventListener('change', () => {
        const set = new Set(event.weekdays ?? []);
        if (box.checked) set.add(index + 1); else set.delete(index + 1);
        event.weekdays = [...set].sort();
      });
      return element('label', {}, [box, label]);
    }));
    const who = element('div', { className: 'ku-knowers' }, characters().map(character => {
      const id = characterId(character);
      const on = (event.who ?? []).includes(id);
      const chip = button(characterName(character), `ku-chip ku-knower${on ? ' seen' : ''}`, () => {
        event.who = on ? event.who.filter(item => item !== id) : [...(event.who ?? []), id];
        render();
      });
      chip.setAttribute('aria-pressed', String(on));
      return chip;
    }));
    const must = element('input', { type: 'checkbox', checked: Boolean(event.must) });
    must.addEventListener('change', () => { event.must = must.checked; });
    const ahead = element('input', { type: 'number', min: 0, max: 14, value: event.ahead ?? 0, className: 'ku-short' });
    ahead.addEventListener('input', () => { event.ahead = Number(ahead.value) || 0; });
    return element('div', { className: 'ku-cal-editor' }, [
      field('Что', input('title', { placeholder: 'Контрольная по анатомии', maxlength: 120 })),
      field('Подробности', note),
      element('div', { className: 'ku-cal-fields' }, [
        field('Дата', dateField(event, 'date')),
        field('По какое (если несколько дней)', dateField(event, 'endDate')),
        field('Время', input('time', { type: 'time' })),
      ]),
      element('div', { className: 'ku-cal-fields' }, [
        field('Повтор', repeat),
        ...(event.repeat !== 'none' ? [field('До какого числа', dateField(event, 'until'), 'пусто — без конца')] : []),
      ]),
      ...(event.repeat === 'weekly' ? [weekdays] : []),
      field('Кого касается', who, 'никто не выбран — события мира, для всех'),
      element('label', { className: 'strangers-toggle' }, [must, 'Обязательно случится: модель сама введёт его в сюжет в этот день']),
      field('За сколько дней персонажи уже знают о нём', ahead, '0 — узнают в сам день; 7 — неделю готовятся к экзамену'),
      element('div', { className: 'row' }, [
        button('Сохранить', 'btn primary', () => attempt(async () => {
          await act('onCalendarSaveEvent', { event: { ...event, weekdays: event.weekdays } }, 'calendar-save');
          selected = event.date || selected;
          draft = null;
          render();
        }, 'Событие сохранено')),
        button('Отмена', 'btn', () => { draft = null; render(); }),
      ]),
    ]);
  }

  // ---- What is coming ----------------------------------------------------------
  function renderSoon() {
    if (!today()) return null;
    const list = [];
    for (let inDays = 0; inDays <= 14; inDays += 1) {
      const date = addDays(today(), inDays);
      for (const event of eventsOn(calendar(), date)) {
        if (event.repeat !== 'none' && inDays > 0) continue; // classes are not «coming»
        list.push({ event, date, inDays });
      }
    }
    const known = new Set(upcoming(calendar(), today()).map(item => item.event.id));
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Ближайшие две недели' }),
      ...(list.length ? list.slice(0, 30).map(({ event, date, inDays }) => element('div', { className: 'ku-fact' }, [
        element('span', { className: 'ku-fact-text' }, [
          element('strong', { text: inDays === 0 ? 'сегодня' : inDays === 1 ? 'завтра' : humanDate(date, { year: false }) }),
          ` · ${event.time ? `${event.time} ` : ''}${event.title}`,
          ...(inDays > 0 && known.has(event.id) ? [element('span', { className: 'muted', text: ' · модель знает, что скоро' })] : []),
          ...(inDays === 0 ? [element('span', { className: 'muted', text: event.must ? ' · модель введёт сегодня' : ' · фон дня' })] : []),
        ]),
      ])) : [element('p', { className: 'muted ku-small', text: 'Ничего не запланировано.' })]),
    ]);
  }

  // ---- Templates and the generator -----------------------------------------------
  function renderTemplates() {
    if (cal().custom) {
      return element('div', { className: 'card' }, [element('h3', { text: 'Шаблоны и генерация' }), element('p', { className: 'muted ku-small', text: 'Шаблоны и генератор года сделаны для земного календаря. У календаря этого чата свои месяцы, события добавляйте на нужные дни вручную. Повторы («каждый год», «по дням недели») работают.' })]);
    }
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Шаблоны и генерация' })]);
    const yearInput = element('input', { type: 'number', min: 1, max: 9999, value: thisYear(), className: 'ku-short', 'aria-label': 'Год, с которого начинается шаблон' });
    // The generator.
    const description = element('textarea', { rows: 2, value: wish, placeholder: 'Для кого год. Например: студентка 3 курса ветеринарного факультета Токийского университета, подрабатывает в кафе' });
    description.addEventListener('input', () => { wish = description.value; });
    const generate = button(busy ? 'Планирую год…' : 'Сгенерировать', 'btn primary', () => attempt(async () => {
      busy = true; render();
      try {
        generated = await invoke('onCalendarGenerate', { description: wish });
        picked = new Set(generated.events.map((_, index) => index));
      } finally { busy = false; render(); }
    }, () => (generated ? `Событий: ${generated.events.length}. Отметьте нужные и добавьте в календарь или сохраните шаблоном.` : '')));
    generate.disabled = busy;
    card.append(
      element('p', { className: 'muted ku-small', style: { margin: '0 0 6px' }, text: 'Модель планирует год по реальному календарю места: учебный год, сессии, практики, праздники, фестивали. Сначала вы смотрите список, потом решаете, что взять.' }),
      description,
      element('div', { className: 'row', style: { marginTop: '6px' } }, [generate]),
    );
    if (generated) {
      const name = element('input', { value: generated.name, 'aria-label': 'Название шаблона' });
      const rows = element('div', { className: 'ku-cal-drafts' }, generated.events.map((event, index) => {
        const box = element('input', { type: 'checkbox', checked: picked.has(index) });
        box.addEventListener('change', () => { if (box.checked) picked.add(index); else picked.delete(index); });
        const when = `${event.date.split('-').reverse().join('.')}${event.endDate ? `–${event.endDate.split('-').reverse().join('.')}` : ''}${event.repeat === 'weekly' ? ` · по ${(event.weekdays ?? []).map(day => ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][day - 1]).join(', ')}` : event.repeat === 'yearly' ? ' · каждый год' : ''}`;
        return element('label', { className: `ku-cal-draft${event.must ? ' must' : ''}` }, [
          box,
          element('span', {}, [element('strong', { text: event.title }), element('span', { className: 'muted ku-small', text: ` · ${when}${event.time ? ` · ${event.time}` : ''}` }), ...(event.note ? [element('br'), element('small', { text: event.note })] : [])]),
        ]);
      }));
      card.append(
        element('div', { className: 'ku-row', style: { marginTop: '10px' } }, [
          button('Отметить все', 'btn small', () => { picked = new Set(generated.events.map((_, index) => index)); render(); }),
          button('Снять все', 'btn small', () => { picked = new Set(); render(); }),
        ]),
        rows,
        element('div', { className: 'row', style: { marginTop: '8px' } }, [
          element('span', { className: 'muted ku-small', text: `Учебный год с ${MONTHS[(generated.startMonth || 1) - 1].toLocaleLowerCase('ru-RU')}` }),
          yearInput,
          button('Добавить отмеченные в календарь', 'btn primary', () => attempt(() => act('onCalendarApplyTemplate', { template: generated, year: yearInput.value, indexes: [...picked] }, 'calendar-apply'), count => `Добавлено событий: ${count}`)),
        ]),
        element('div', { className: 'row', style: { marginTop: '6px' } }, [
          name,
          button('Сохранить шаблоном', 'btn', () => attempt(() => act('onCalendarSaveTemplate', {
            name: name.value, startMonth: generated.startMonth, description: wish, events: generated.events.filter((_, index) => picked.has(index)),
          }, 'calendar-template'), 'Шаблон сохранён: он есть во всех чатах')),
          button('Убрать список', 'btn small', () => { generated = null; render(); }),
        ]),
      );
    }
    // Saved templates.
    const templates = snapshot().calendarTemplates ?? [];
    card.append(element('p', { className: 'section-title', style: { margin: '14px 0 6px' }, text: `Сохранённые шаблоны · ${templates.length}` }));
    if (!templates.length) card.append(element('p', { className: 'muted ku-small', text: 'Пока нет. Сохраните сгенерированный список или свой календарь.' }));
    for (const template of templates) {
      const year = element('input', { type: 'number', min: 1, max: 9999, value: thisYear(), className: 'ku-short', 'aria-label': `Год для шаблона ${template.name}` });
      card.append(element('div', { className: 'ku-fact' }, [
        element('span', { className: 'ku-fact-text' }, [element('strong', { text: template.name }), element('span', { className: 'muted', text: ` · ${template.events.length} событий · с ${MONTHS[(template.startMonth || 1) - 1].toLocaleLowerCase('ru-RU')}` })]),
        year,
        button('В календарь', 'btn small primary', () => attempt(() => act('onCalendarApplyTemplate', { templateId: template.id, year: year.value }, 'calendar-apply'), count => `Добавлено событий: ${count}`)),
        button('×', 'btn icon small', () => attempt(() => act('onCalendarRemoveTemplate', { id: template.id }, 'calendar-template-remove'), 'Шаблон удалён'), `Удалить шаблон ${template.name}`),
      ]));
    }
    // This chat's calendar as a template.
    const own = element('input', { placeholder: 'Название шаблона', 'aria-label': 'Название шаблона из этого календаря' });
    const startMonth = element('select', { 'aria-label': 'С какого месяца начинается год' }, MONTHS.map((label, index) => element('option', { value: index + 1, text: `год с: ${label.toLocaleLowerCase('ru-RU')}` })));
    card.append(element('div', { className: 'row', style: { marginTop: '10px' } }, [
      own, startMonth,
      button('Сохранить этот календарь шаблоном', 'btn', () => attempt(() => act('onCalendarSaveTemplate', { name: own.value, startMonth: Number(startMonth.value) }, 'calendar-template'), 'Шаблон сохранён: он есть во всех чатах')),
    ]));
    if (calendar().events.length) {
      card.append(element('div', { className: 'row', style: { marginTop: '6px' } }, [
        button(`Очистить календарь чата (${calendar().events.length})`, 'btn small', () => attempt(() => act('onCalendarClear', {}, 'calendar-clear'), 'Календарь чата очищен')),
      ]));
    }
    return card;
  }

  const builder = createCalendarBuilder(ctx, { attempt });

  function renderCalendar() {
    if (!selected && today()) selected = today();
    if (draft && !parseDate(draft.date)) draft.date = selected;
    const view = element('div', { className: 'records-view ku-calendar' });
    view.append(renderToday(), builder.renderBuilder(), renderMonth(), renderDay(), ...[renderSoon()].filter(Boolean), renderTemplates());
    return view;
  }

  return { renderCalendar };
}

export const CALENDAR_STYLE = `
.ku-calendar{container-type:inline-size}
.ku-cal-title{min-width:130px;text-align:center}
.ku-cal-date{display:flex;gap:6px;flex-wrap:wrap}.ku-cal-date select{width:auto;min-width:0;flex:1 1 120px}
.ku-cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-top:8px}
.ku-cal-head{font-size:11px;text-align:center;color:var(--k-muted);text-transform:uppercase}
.ku-cal-cell{display:flex;flex-direction:column;gap:2px;align-items:stretch;min-height:64px;min-width:0;padding:4px;border:1px solid var(--k-line);border-radius:10px;background:var(--k-panel);color:var(--k-text);font:inherit;text-align:left;cursor:pointer;overflow:hidden}
.ku-cal-cell.other{opacity:.45}
.ku-cal-cell.today{border-color:var(--k-accent);box-shadow:inset 0 0 0 1px var(--k-accent)}
.ku-cal-cell.on{background:var(--k-inset)}
.ku-cal-cell.must .ku-cal-num{color:var(--k-warn)}
.ku-cal-num{font-weight:700;font-size:12px}
.ku-cal-dot{font-size:10px;line-height:1.2;padding:1px 4px;border-radius:6px;background:var(--k-inset);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ku-cal-dot.must{color:var(--k-warn);font-weight:700}
.ku-cal-more{font-size:10px;color:var(--k-muted)}
.ku-cal-event{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--k-line)}
.ku-cal-event-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;overflow-wrap:anywhere}
.ku-cal-event.must strong{color:var(--k-warn)}
.ku-cal-editor{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--k-line)}
.ku-cal-field{display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:0}
.ku-cal-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.ku-cal-weekdays{display:flex;flex-wrap:wrap;gap:8px;font-size:12px}
.ku-cal-drafts{display:flex;flex-direction:column;gap:4px;max-height:420px;overflow:auto;margin-top:6px;padding-right:4px}
.ku-cal-draft{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;overflow-wrap:anywhere}
.ku-cal-draft.must strong{color:var(--k-warn)}
@container (max-width:520px){.ku-cal-cell{min-height:44px}.ku-cal-dot{display:none}.ku-cal-cell.must::after{content:'';width:6px;height:6px;border-radius:50%;background:var(--k-warn)}}
`;
