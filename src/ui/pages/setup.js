import { button, element } from '../helpers.js';

/**
 * «Настройка чата» (Система): a step-by-step guide for a chat Kulisy has just met. Every step says what it is for, what to press
 * and shows whether it is done; «Открыть» goes to the right page. The same list drives the reminder above the message box
 * (it goes away once the required steps are done, or by «Не напоминать в этом чате»).
 */
export function createSetupPage(ctx) {
  const snapshot = () => ctx.snapshot;
  const invoke = (name, payload = {}) => ctx.facade.invoke(name, payload);

  const STATE = { true: ['ku-chip told', 'готово'], false: ['ku-chip', 'нужно сделать'], null: ['ku-chip', 'посмотреть'] };

  function renderSetup() {
    const view = element('div', { className: 'ku-setup' });
    const setup = snapshot().setup ?? { steps: [], progress: { done: 0, total: 0, optionalDone: 0, optionalTotal: 0, missing: [] }, off: false, remind: true };
    const { progress } = setup;
    const ready = progress.total > 0 && progress.done === progress.total;

    const bar = element('div', { className: 'ku-setup-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.done), 'aria-label': 'Обязательные шаги' }, [
      element('span', { style: { width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` } }),
    ]);
    const remindButton = button(setup.off ? 'Напоминать снова' : 'Не напоминать в этом чате', 'btn small', async () => {
      try { await invoke('onSetupOff', { off: !setup.off }); ctx.setStatus(setup.off ? 'Напоминание в этом чате снова включено' : 'В этом чате больше не напомню'); }
      catch (error) { ctx.setStatus(error?.message || String(error), true); }
    }, 'Напоминание над полем ввода. Совсем выключить для всех чатов можно в «Настройки → Знания и сцена».');
    view.append(element('div', { className: 'card' }, [
      element('h3', { text: ready ? 'Чат настроен' : 'Настроим Кулисы для этого чата' }),
      element('p', { className: 'muted', text: ready
        ? 'Обязательные шаги сделаны, дальше Кулисы работают сами. Остальное по желанию: список ниже.'
        : 'Шесть коротких шагов, по порядку. Обязательных два (персона и герои), остальные улучшают работу: можно пропустить и вернуться позже.' }),
      element('p', { className: 'ku-small', text: `Обязательные шаги: ${progress.done} из ${progress.total}${progress.optionalTotal ? ` · по желанию: ${progress.optionalDone} из ${progress.optionalTotal}` : ''}` }),
      bar,
      element('div', { className: 'ku-row' }, [remindButton]),
    ]));

    setup.steps.forEach((step, index) => {
      const [chipClass, chipText] = STATE[String(step.done)];
      view.append(element('section', { className: `card ku-setup-step${step.done ? ' done' : ''}` }, [
        element('div', { className: 'ku-row' }, [
          element('span', { className: 'ku-setup-num', 'aria-hidden': 'true', text: String(index + 1) }),
          element('h3', { className: 'ku-setup-title', text: step.title }),
          element('span', { className: chipClass, text: step.required && !step.done ? 'обязательно' : chipText }),
        ]),
        element('p', { text: step.what }),
        element('ol', { className: 'ku-setup-how' }, step.how.map(line => element('li', { text: line }))),
        ...(step.note ? [element('p', { className: 'muted ku-small', text: step.note })] : []),
        element('div', { className: 'ku-row' }, [button('Открыть страницу', step.done ? 'btn small' : 'btn primary small', () => ctx.setTab(step.tab), 'Перейти туда, где это делается')]),
      ]));
    });
    return view;
  }

  return { renderSetup };
}

export const SETUP_STYLE = `
.ku-setup{display:flex;flex-direction:column;gap:12px}
.ku-setup-bar{height:8px;border-radius:6px;background:var(--rs-track);overflow:hidden;margin:6px 0 10px}
.ku-setup-bar span{display:block;height:100%;background:var(--rs-accent)}
.ku-setup-step.done{opacity:.8}
.ku-setup-num{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--rs-inset);border:1px solid var(--rs-line);font-weight:700}
.ku-setup-step.done .ku-setup-num{background:var(--rs-accent);color:var(--rs-bg)}
.ku-setup-title{margin:0;flex:1 1 auto;min-width:0}
.ku-setup-how{margin:6px 0 8px;padding-left:22px;display:flex;flex-direction:column;gap:4px}
`;
