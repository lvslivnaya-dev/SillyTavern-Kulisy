import { button, element } from '../helpers.js';

/**
 * «Кубик» (Мир → Кубик): what the intimacy dice can roll. Every group can be switched off, every
 * ready option hidden, and the user adds her own. The roll itself lives in the scene drawer
 * (it appears when the scene type is «Близость»). Changes go through onDiceSettings in index.js.
 */
export function createDicePages(ctx) {
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const act = (...args) => ctx.act(...args);
  const snapshot = () => ctx.snapshot;

  const drafts = new Map(); // group id → text typed for a new option
  const dice = () => ({ avoidRepeat: true, groups: [], historyCount: 0, ...(snapshot().dice ?? {}) });

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(typeof done === 'function' ? done(result) : done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }
  const patch = (value, done) => attempt(() => act('onDiceSettings', { patch: value }, 'dice-settings'), done);

  function renderTop() {
    const current = dice();
    const avoid = element('input', { type: 'checkbox', className: 'set-switch', checked: current.avoidRepeat, 'aria-label': 'Не повторять недавние броски' });
    avoid.addEventListener('change', () => patch({ avoidRepeat: avoid.checked }));
    const auto = element('input', { type: 'checkbox', className: 'set-switch', checked: current.autoRoll === true, 'aria-label': 'Бросать само при переходе в близость' });
    auto.addEventListener('change', () => patch({ autoRoll: auto.checked }));
    const mode = element('select', { 'aria-label': 'Как бросается «Начало»' }, [
      element('option', { value: 'separate', text: 'А. Отдельной кнопкой «✨ Начало» (по умолчанию)', selected: current.rollMode !== 'stage' }),
      element('option', { value: 'stage', text: 'Б. По стадии: одна кнопка, кубик сам берёт нужные группы', selected: current.rollMode === 'stage' }),
    ]);
    mode.addEventListener('change', () => patch({ rollMode: mode.value }, 'Способ броска сохранён'));
    return element('div', { className: 'card' }, [
      element('h3', { text: 'Кубик близости' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: 'Когда тип сцены «Близость», в шторке появляется плитка «Кубик». Бросок выбирает по одному варианту из групп ниже (в «Типе секса» может быть несколько), выбранное горит, его можно менять нажатием, и оно уходит направлением на следующий ответ. «Кто ведёт» выбирается только среди тех, кого играет рассказчик: персона никогда не ведёт и за неё ничего не пишется.' }),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Не повторять недавнее' }), element('small', { className: 'muted', text: 'Варианты из трёх последних отправленных бросков выпадают заметно реже.' })]), avoid]),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Бросать само при переходе в близость' }), element('small', { className: 'muted', text: 'Когда тип сцены становится «Близость», кубик бросается сам и сразу уходит направлением на следующий ответ. Выбор в шторке можно поменять: изменённое уйдёт заново.' })]), auto]),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Как бросается «Начало»' }), element('small', { className: 'muted', text: 'А: «Начало» бросается своей кнопкой, остальное — обычным броском. Б: кубик смотрит на стадию сцены. До «Раздевания» он не бросает тип секса и условия, они появляются вместе со стадиями «Раздевание» и «Близость».' })]), mode]),
      element('div', { className: 'row', style: { marginTop: '8px' } }, [
        button(`Забыть прошлые броски${current.historyCount ? ` (${current.historyCount})` : ''}`, 'btn small', () => patch({ clearHistory: true }, 'Прошлые броски забыты')),
      ]),
    ]);
  }

  function renderGroup(group) {
    const on = element('input', { type: 'checkbox', className: 'set-switch', checked: !group.off, 'aria-label': `Группа «${group.label}» участвует в броске` });
    on.addEventListener('change', () => patch({ group: group.id, off: !on.checked }));
    const card = element('div', { className: `card ku-dice-group${group.off ? ' off' : ''}` }, [
      element('div', { className: 'ku-dice-head' }, [element('h3', { text: `${group.icon} ${group.label}`, style: { margin: 0 } }), on]),
    ]);
    const list = element('div', { className: 'ku-dice-options' });
    for (const option of group.options) {
      const box = element('input', { type: 'checkbox', checked: !option.hidden, 'aria-label': `Вариант «${option.text}» может выпасть` });
      box.addEventListener('change', () => patch({ group: group.id, option: option.id, hidden: !box.checked }));
      list.append(element('label', { className: `ku-dice-option${option.hidden ? ' off' : ''}` }, [
        box,
        element('span', { text: option.text }),
        ...(option.custom ? [button('×', 'btn icon small', event => { event.preventDefault(); patch({ group: group.id, removeCustom: option.id }, 'Вариант удалён'); }, `Удалить вариант «${option.text}»`)] : []),
      ]));
    }
    card.append(list);
    const input = element('input', { value: drafts.get(group.id) ?? '', placeholder: 'Свой вариант: например, «под дождём»', 'aria-label': `Свой вариант в группе «${group.label}»`, maxLength: 120 });
    input.addEventListener('input', () => drafts.set(group.id, input.value));
    const add = () => attempt(async () => { await act('onDiceSettings', { patch: { group: group.id, addCustom: input.value } }, 'dice-settings'); drafts.delete(group.id); render(); }, 'Вариант добавлен');
    input.addEventListener('keydown', event => { if (event.key === 'Enter') add(); });
    card.append(element('div', { className: 'row', style: { marginTop: '8px' } }, [input, button('Добавить', 'btn small', add)]));
    return card;
  }

  function renderDice() {
    const view = element('div', { className: 'records-view ku-dice' });
    view.append(renderTop(), ...dice().groups.map(renderGroup));
    return view;
  }

  return { renderDice };
}

export const DICE_STYLE = `
.ku-dice-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.ku-dice-group.off .ku-dice-options{opacity:.5}
.ku-dice-head .set-switch{width:38px;flex:0 0 auto;padding:0}
.ku-dice-options{display:flex;flex-direction:column;gap:2px}
.ku-dice-option{display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer}
.ku-dice-option input{width:auto;margin:0;flex:0 0 auto}
.ku-dice-option span{flex:1;min-width:0;overflow-wrap:anywhere}
.ku-dice-option.off span{opacity:.5;text-decoration:line-through}
.ku-dice .row input{flex:1 1 220px;min-width:0;width:auto}
`;
