import { button, element } from '../helpers.js';
import { MONTH_NAMES, WEATHER_KINDS, WEATHER_KIND_IDS } from '../../core/weather.js';

/**
 * «Погода» (Мир → Погода): the weather in force now, the week ahead, the climate and the ready
 * scenarios. Every change goes through the handlers in index.js (weatherCallbacks).
 */
export function createWeatherPages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const act = (...args) => ctx.act(...args);
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);
  const snapshot = () => ctx.snapshot;

  let draft = { kind: '', temp: '', text: '', lock: false };
  let wish = '';
  let generated = null; // a climate the model proposed
  let busy = false;
  const starts = new Map(); // scenario id → typed start day

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(typeof done === 'function' ? done(result) : done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }

  const SOURCE = { lock: 'держится вручную', set: 'из ответа или выбрана вручную', scenario: 'сценарий', forecast: 'по прогнозу климата' };
  const clockDay = () => snapshot().world?.clock?.day ?? 0;
  const tempText = value => (value == null ? '' : `${value > 0 ? '+' : ''}${value}°`);
  const nameOfClimate = id => (snapshot().weatherClimates ?? []).find(item => item.id === id)?.name ?? '';

  // ---- Now ------------------------------------------------------------------------

  function renderNow() {
    const now = snapshot().weather;
    const set = snapshot().weatherSet;
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Сейчас на улице' })]);
    if (now) {
      const kind = WEATHER_KINDS[now.kind];
      card.append(element('div', { className: 'ku-wx-now' }, [
        element('span', { className: 'ku-wx-icon', text: kind.icon }),
        element('span', {}, [
          element('strong', { text: `${kind.label}${now.temp != null ? ` · ${tempText(now.temp)}` : ''}` }),
          element('small', { className: 'muted', text: `${now.text ? `${now.text}. ` : ''}${SOURCE[now.source] ?? ''}${now.scenario ? `: «${now.scenario}»` : ''}` }),
        ]),
      ]));
    } else {
      card.append(element('p', { className: 'muted ku-small', text: snapshot().weatherPlan?.climateId
        ? 'Прогноза на сегодня нет: сначала должен быть известен день истории. Выберите погоду кнопкой ниже или дождитесь ответа.'
        : 'Погоды пока нет. Выберите климат ниже, и она будет считаться сама, или поставьте погоду кнопкой.' }));
    }
    // By hand.
    if (!draft.kind) draft.kind = now?.kind ?? '';
    const kinds = element('div', { className: 'ku-wx-kinds', role: 'group', 'aria-label': 'Какая погода' }, WEATHER_KIND_IDS.map(id => {
      const node = button(`${WEATHER_KINDS[id].icon} ${WEATHER_KINDS[id].label}`, `btn small${draft.kind === id ? ' primary' : ''}`, () => { draft.kind = id; render(); });
      node.setAttribute('aria-pressed', String(draft.kind === id));
      return node;
    }));
    const temp = element('input', { type: 'number', min: -60, max: 60, className: 'ku-short', value: draft.temp, placeholder: '°C', 'aria-label': 'Температура, градусы' });
    temp.addEventListener('input', () => { draft.temp = temp.value; });
    const text = element('input', { value: draft.text, placeholder: 'Как выглядит: моросит, лужи', 'aria-label': 'Как выглядит погода' });
    text.addEventListener('input', () => { draft.text = text.value; });
    const lock = element('input', { type: 'checkbox', className: 'set-switch', checked: draft.lock, 'aria-label': 'Держать эту погоду' });
    lock.addEventListener('change', () => { draft.lock = lock.checked; });
    const apply = button('Задать погоду', 'btn primary', () => attempt(async () => {
      if (!draft.kind) throw new Error('Выберите, какая погода.');
      await act('onSetWeather', { kind: draft.kind, temp: draft.temp, text: draft.text, lock: draft.lock }, 'weather-set');
      draft = { kind: '', temp: '', text: '', lock: false };
      render();
    }, 'Погода задана'));
    card.append(
      element('p', { className: 'section-title', style: { margin: '12px 0 6px' }, text: 'Задать вручную' }),
      kinds,
      element('div', { className: 'ku-wx-fields' }, [temp, text]),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Держать' }), element('small', { className: 'muted', text: 'Летописец и прогноз её не меняют, пока вы не отпустите.' })]), lock]),
      element('div', { className: 'row', style: { marginTop: '8px' } }, [
        apply,
        ...(set ? [button('Вернуть прогнозу', 'btn', () => attempt(() => act('onSetWeather', { clear: true }, 'weather-clear'), 'Погода снова считается по прогнозу'))] : []),
      ]),
    );
    return card;
  }

  // ---- The week -----------------------------------------------------------------------

  function renderWeek() {
    const week = snapshot().weatherWeek ?? [];
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Ближайшая неделя' })]);
    if (!week.length) {
      card.append(element('p', { className: 'muted ku-small', text: clockDay() ? 'Прогноза нет: выберите климат ниже.' : 'День истории пока неизвестен, поэтому прогноз не посчитать.' }));
      return card;
    }
    card.append(element('div', { className: 'ku-wx-week' }, week.map(item => element('div', { className: `ku-wx-day ${item.source}` }, [
      element('small', { className: 'muted', text: item.date ? item.date.slice(5).split('-').reverse().join('.') : `день ${item.day}` }),
      element('span', { className: 'ku-wx-icon', text: WEATHER_KINDS[item.kind].icon }),
      element('strong', { text: tempText(item.temp) || '–' }),
      element('small', { text: item.scenario ? `«${item.scenario}»` : WEATHER_KINDS[item.kind].label }),
    ]))));
    card.append(element('p', { className: 'muted ku-small', style: { margin: '8px 0 0' }, text: 'Прогноз считается заново от дня истории и не меняется от свайпов. Всё, что написано в ответах, сильнее него.' }));
    return card;
  }

  // ---- Climate ---------------------------------------------------------------------------

  function climateTable(climate) {
    const table = element('div', { className: 'ku-wx-table' });
    climate.months.forEach((month, index) => {
      const kinds = Object.entries(month.kinds).sort((left, right) => right[1] - left[1]).slice(0, 3).map(([kind]) => WEATHER_KINDS[kind].icon).join(' ');
      table.append(element('span', { className: 'muted', text: MONTH_NAMES[index].slice(0, 3) }), element('span', { text: `${month.min}…${month.max}°` }), element('span', { text: kinds }));
    });
    return table;
  }

  function renderClimate() {
    const plan = snapshot().weatherPlan ?? { climateId: '', month: 0, scenarios: [] };
    const climates = snapshot().weatherClimates ?? [];
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Климат' })]);
    const select = element('select', { 'aria-label': 'Климат' }, [element('option', { value: '', text: 'Не выбран: погода только из ответов и вручную', selected: !plan.climateId }),
      ...climates.map(item => element('option', { value: item.id, text: `${item.name}${item.builtin ? '' : ' (мой)'}`, selected: item.id === plan.climateId }))]);
    select.addEventListener('change', () => attempt(() => act('onWeatherPlan', { climateId: select.value }, 'weather-plan'), 'Климат выбран'));
    card.append(select);
    const chosen = climates.find(item => item.id === plan.climateId);
    if (chosen) card.append(climateTable(chosen));
    if (snapshot().weatherDated) {
      card.append(element('p', { className: 'muted ku-small', text: 'Месяц берётся из даты истории (Мир → Календарь).' }));
    } else {
      const month = element('select', { 'aria-label': 'Месяц, если даты истории нет' }, [element('option', { value: 0, text: 'Месяц не выбран', selected: !plan.month }),
        ...MONTH_NAMES.map((name, index) => element('option', { value: index + 1, text: name, selected: plan.month === index + 1 }))]);
      month.addEventListener('change', () => attempt(() => act('onWeatherPlan', { month: month.value }, 'weather-plan'), 'Месяц выбран'));
      card.append(
        element('p', { className: 'muted ku-small', style: { margin: '10px 0 4px' }, text: 'Даты истории нет, поэтому сезон неизвестен: задайте дату в «Мир → Календарь» или выберите месяц здесь.' }),
        month,
      );
    }
    // The generator.
    const description = element('textarea', { rows: 2, value: wish, placeholder: 'Для какого места. Например: Санкт-Петербург, или вымышленный город у холодного моря' });
    description.addEventListener('input', () => { wish = description.value; });
    const generate = button(busy ? 'Подбираю климат…' : 'Подобрать климат', 'btn', () => attempt(async () => {
      busy = true; render();
      try { generated = await invoke('onWeatherGenerate', { description: wish }); } finally { busy = false; render(); }
    }, 'Климат подобран: посмотрите и сохраните'));
    generate.disabled = busy;
    card.append(element('p', { className: 'section-title', style: { margin: '14px 0 6px' }, text: 'Свой климат' }), description, element('div', { className: 'row', style: { marginTop: '6px' } }, [generate]));
    if (generated) {
      card.append(
        element('p', { style: { margin: '10px 0 4px' } }, [element('strong', { text: generated.name })]),
        climateTable(generated),
        element('div', { className: 'row', style: { marginTop: '8px' } }, [
          button('Сохранить и выбрать', 'btn primary', () => attempt(async () => { await act('onWeatherSaveClimate', { climate: generated, use: true }, 'weather-climate'); generated = null; render(); }, 'Климат сохранён и выбран')),
          button('Только сохранить', 'btn', () => attempt(async () => { await act('onWeatherSaveClimate', { climate: generated }, 'weather-climate'); generated = null; render(); }, 'Климат сохранён: он есть во всех чатах')),
          button('Убрать', 'btn small', () => { generated = null; render(); }),
        ]),
      );
    }
    const mine = climates.filter(item => !item.builtin);
    if (mine.length) {
      card.append(element('p', { className: 'section-title', style: { margin: '14px 0 6px' }, text: `Мои климаты · ${mine.length}` }));
      for (const item of mine) {
        card.append(element('div', { className: 'ku-fact' }, [
          element('span', { className: 'ku-fact-text', text: item.name }),
          button('×', 'btn icon small', () => attempt(() => act('onWeatherRemoveClimate', { id: item.id }, 'weather-climate-remove'), 'Климат удалён'), `Удалить климат ${item.name}`),
        ]));
      }
    }
    return card;
  }

  // ---- Scenarios ----------------------------------------------------------------------------

  function renderScenarios() {
    const plan = snapshot().weatherPlan ?? { scenarios: [] };
    const card = element('div', { className: 'card' }, [
      element('h3', { text: 'Заготовки на несколько дней' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: 'Выберите заготовку и день, с которого она начнётся: она ляжет в прогноз поверх климата. Всё, что напишет история, сильнее.' }),
    ]);
    const list = element('div', { className: 'ku-wx-scenarios' });
    for (const template of snapshot().weatherScenarios ?? []) {
      const start = element('input', { type: 'number', min: 1, className: 'ku-short', value: starts.get(template.id) ?? (clockDay() || 1), 'aria-label': `День начала: ${template.name}` });
      start.addEventListener('input', () => starts.set(template.id, start.value));
      list.append(element('div', { className: 'ku-wx-scenario' }, [
        element('span', { className: 'ku-wx-icon', text: WEATHER_KINDS[template.kind].icon }),
        element('span', { className: 'ku-wx-scenario-text' }, [element('strong', { text: template.name }), element('small', { className: 'muted', text: ` · ${template.days} дн. · ${template.text}` })]),
        element('span', { className: 'muted ku-small', text: 'с дня' }),
        start,
        button('Добавить', 'btn small', () => attempt(() => act('onWeatherScenario', { templateId: template.id, startDay: start.value }, 'weather-scenario'), `«${template.name}» добавлено в прогноз`)),
      ]));
    }
    card.append(list);
    if (plan.scenarios.length) {
      card.append(element('p', { className: 'section-title', style: { margin: '14px 0 6px' }, text: `В прогнозе · ${plan.scenarios.length}` }));
      for (const item of plan.scenarios) {
        card.append(element('div', { className: 'ku-fact' }, [
          element('span', { className: 'ku-fact-text' }, [element('strong', { text: `${WEATHER_KINDS[item.kind].icon} ${item.name}` }), element('span', { className: 'muted', text: ` · дни ${item.startDay}–${item.startDay + item.days - 1}${item.text ? ` · ${item.text}` : ''}` })]),
          button('×', 'btn icon small', () => attempt(() => act('onWeatherScenarioRemove', { id: item.id }, 'weather-scenario-remove'), 'Сценарий убран'), `Убрать сценарий ${item.name}`),
        ]));
      }
    }
    return card;
  }

  function renderWeather() {
    const view = element('div', { className: 'records-view ku-weather' });
    view.append(renderNow(), renderWeek(), renderClimate(), renderScenarios());
    return view;
  }

  return { renderWeather };
}

export const WEATHER_STYLE = `
.ku-weather{container-type:inline-size}
.ku-wx-now{display:flex;align-items:center;gap:14px}
.ku-wx-now>span:last-child{display:flex;flex-direction:column;gap:2px;min-width:0}
.ku-wx-icon{font-size:26px;line-height:1}
.ku-wx-kinds{display:flex;flex-wrap:wrap;gap:6px}
.ku-wx-fields{display:grid;grid-template-columns:90px minmax(0,1fr);gap:6px;margin-top:8px}
.ku-wx-fields input{min-width:0;width:100%}
.ku-wx-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.ku-wx-day{display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;border:1px solid var(--k-line);border-radius:10px;background:var(--k-panel);text-align:center;min-width:0}
.ku-wx-day small{overflow-wrap:anywhere}
.ku-wx-day.scenario{border-color:var(--k-warn)}
.ku-wx-day.set,.ku-wx-day.lock{border-color:var(--k-accent)}
.ku-wx-table{display:grid;grid-template-columns:auto auto 1fr;gap:2px 14px;margin-top:8px;font-size:12.5px}
.ku-wx-scenarios{display:flex;flex-direction:column;gap:6px}
.ku-wx-scenario{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--k-line);border-radius:10px;background:var(--k-panel);flex-wrap:wrap}
.ku-wx-scenario-text{flex:1 1 220px;min-width:0}
.ku-wx-scenario input{width:70px}
@container (max-width:560px){.ku-wx-week{grid-template-columns:repeat(4,minmax(0,1fr))}}
`;
