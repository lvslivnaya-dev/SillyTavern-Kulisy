import { button, element } from '../helpers.js';
import { QUEST_LABELS, currentStep, dueText, progressOf } from '../../core/quests.js';

/**
 * «Квесты» (Мир → Квесты): нити истории. Список по статусам, шаги галочками, срок, скрытность,
 * «ввести шаг сейчас» (уходит со следующим ответом) и итоги: выполнен / провален с наградой или последствием,
 * которые двигают отношения. Правки идут через onAddQuest / onUpdateQuest / onQuestStep / onCloseQuest /
 * onRemoveQuest / onQuestPush (index.js, world-actions.js).
 */
export function createQuestsPages(ctx) {
  const act = (...args) => ctx.act(...args);
  const setStatus = (...args) => ctx.setStatus(...args);
  const snapshot = () => ctx.snapshot;

  // The open editor (null = closed) and the quest whose ending note is being written.
  let editor = null;
  let closing = null;
  let armedRemove = '';

  const people = () => Object.values(snapshot().entities ?? {}).filter(entity => entity?.id && entity.name !== 'Narrator');
  const nameOf = id => snapshot().entities?.[id]?.name ?? id;
  const lines = () => Object.values(snapshot().relationships ?? {}).map(relation => ({ id: relation.id, label: `${nameOf(relation.from)} → ${nameOf(relation.to)}` }));
  const scales = () => (snapshot().config?.scales ?? []).map(scale => ({ id: scale.id, label: scale.label }));
  const today = () => snapshot().questToday || 0;

  async function attempt(run, done) {
    try { const result = await run(); if (done) setStatus(done); return result; }
    catch (error) { setStatus(error?.message || String(error), true); return undefined; }
  }

  // ---- Editor -------------------------------------------------------------------------

  function blankDraft() {
    return { id: '', name: '', text: '', steps: '', dueIn: '', dueDay: 0, secret: false, knownByIds: [], participantIds: [], reward: { text: '', shifts: [] }, penalty: { text: '', shifts: [] } };
  }

  function draftFrom(quest) {
    return {
      id: quest.id, name: quest.name, text: quest.text ?? '', steps: (quest.steps ?? []).map(step => step.text).join('\n'),
      stepsRaw: quest.steps ?? [], dueIn: '', dueDay: quest.dueDay ?? 0, secret: Boolean(quest.secret),
      knownByIds: [...(quest.knownByIds ?? [])], participantIds: [...(quest.participantIds ?? [])],
      reward: { text: quest.reward?.text ?? '', shifts: (quest.reward?.shifts ?? []).map(shift => ({ ...shift })) },
      penalty: { text: quest.penalty?.text ?? '', shifts: (quest.penalty?.shifts ?? []).map(shift => ({ ...shift })) },
    };
  }

  function chips(selected, onToggle, label) {
    const row = element('div', { className: 'ku-q-chips', role: 'group', 'aria-label': label });
    for (const person of people()) {
      const on = selected.includes(person.id);
      row.append(button(person.name, `btn small${on ? ' primary' : ''}`, () => { onToggle(person.id); ctx.render(); }, on ? `Убрать: ${person.name}` : `Добавить: ${person.name}`));
    }
    if (!row.children.length) row.append(element('span', { className: 'muted ku-small', text: 'В чате пока нет персонажей.' }));
    return row;
  }

  function shiftRows(block) {
    const wrap = element('div', { className: 'ku-q-shifts' });
    block.shifts.forEach((shift, index) => {
      const line = element('select', { 'aria-label': 'Линия отношений' }, lines().map(item => element('option', { value: item.id, text: item.label, selected: item.id === shift.relationshipId })));
      const scale = element('select', { 'aria-label': 'Шкала' }, scales().map(item => element('option', { value: item.id, text: item.label, selected: item.id === shift.scaleId })));
      const value = element('input', { type: 'number', min: '-30', max: '30', value: String(shift.value), 'aria-label': 'На сколько' });
      line.addEventListener('change', () => { shift.relationshipId = line.value; });
      scale.addEventListener('change', () => { shift.scaleId = scale.value; });
      value.addEventListener('input', () => { shift.value = Number(value.value) || 0; });
      wrap.append(element('div', { className: 'ku-q-shift' }, [line, scale, value, button('×', 'btn icon small', () => { block.shifts.splice(index, 1); ctx.render(); }, 'Убрать сдвиг')]));
    });
    const available = lines();
    const add = button('＋ Сдвиг отношений', 'btn small', () => {
      block.shifts.push({ relationshipId: available[0].id, scaleId: scales()[0]?.id ?? 'trust', value: 5 });
      ctx.render();
    }, 'Добавить сдвиг шкалы на линии отношений');
    if (!available.length || !scales().length) add.disabled = true;
    wrap.append(add);
    return wrap;
  }

  function outcomeBlock(title, hint, block) {
    const text = element('input', { value: block.text, placeholder: hint, 'aria-label': title });
    text.addEventListener('input', () => { block.text = text.value; });
    return element('div', { className: 'ku-q-outcome' }, [element('strong', { text: title }), text, shiftRows(block)]);
  }

  function renderEditor() {
    const draft = editor;
    const name = element('input', { value: draft.name, placeholder: 'Название: например, «Найти пропавшую сестру»', maxlength: '120', 'aria-label': 'Название квеста' });
    name.addEventListener('input', () => { draft.name = name.value; });
    const text = element('textarea', { rows: 3, maxlength: '400', placeholder: 'Суть для модели: что случилось, чего хотят, что стоит на кону', 'aria-label': 'Суть квеста' });
    text.value = draft.text;
    text.addEventListener('input', () => { draft.text = text.value; });
    const steps = element('textarea', { rows: 4, placeholder: 'Шаги, каждый с новой строки', 'aria-label': 'Шаги квеста' });
    steps.value = draft.steps;
    steps.addEventListener('input', () => { draft.steps = steps.value; });
    const dueIn = element('input', { type: 'number', min: '1', max: '3650', value: draft.dueIn, placeholder: 'дней', 'aria-label': 'Срок: через сколько дней' });
    dueIn.addEventListener('input', () => { draft.dueIn = dueIn.value; });
    const dueNow = draft.dueDay ? `Срок сейчас: день ${draft.dueDay}${today() ? ` (${dueText({ dueDay: draft.dueDay }, today())})` : ''}.` : 'Срока нет.';
    const secret = element('input', { type: 'checkbox', className: 'set-switch', checked: draft.secret, 'aria-label': 'Скрытый квест' });
    secret.addEventListener('change', () => { draft.secret = secret.checked; ctx.render(); });

    const card = element('div', { className: 'card ku-q-editor' }, [
      element('h3', { text: draft.id ? 'Правка квеста' : 'Новый квест' }),
      name, text, steps,
      element('div', { className: 'row' }, [
        element('span', { text: 'Срок: через' }), dueIn, element('span', { text: 'дн. истории' }),
        ...(draft.dueDay ? [button('Убрать срок', 'btn small', () => { draft.dueDay = 0; draft.dueIn = ''; ctx.render(); })] : []),
      ]),
      element('p', { className: 'muted ku-small', text: `${dueNow} ${today() ? `Сегодня день ${today()}.` : 'Время истории не задано, срок станет считаться, когда оно появится.'}` }),
      element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: 'Скрытый квест' }), element('small', { className: 'muted', text: 'Знают только отмеченные ниже. Модель получает его, только когда кто-то из них на сцене; персона и остальные о нём не знают.' })]), secret]),
    ]);
    if (draft.secret) card.append(element('div', {}, [element('strong', { text: 'Кто знает' }), chips(draft.knownByIds, id => toggle(draft.knownByIds, id), 'Кто знает о квесте')]));
    card.append(
      element('div', {}, [element('strong', { text: 'Кого касается' }), chips(draft.participantIds, id => toggle(draft.participantIds, id), 'Кого касается квест')]),
      outcomeBlock('Награда за успех', 'Что получат: например, «Судзу доверяет Рану»', draft.reward),
      outcomeBlock('Последствие провала', 'Что будет: например, «сестра пропадёт насовсем»', draft.penalty),
    );
    const save = button(draft.id ? 'Сохранить' : 'Добавить квест', 'btn primary', () => attempt(async () => {
      const list = draft.steps.split('\n').map(line => line.trim()).filter(Boolean);
      const old = new Map((draft.stepsRaw ?? []).map(step => [step.text, step]));
      const stepsOut = list.map(line => old.get(line) ?? line);
      const payload = {
        name: draft.name, text: draft.text, steps: stepsOut, secret: draft.secret,
        knownByIds: draft.secret ? draft.knownByIds : [], participantIds: draft.participantIds,
        reward: draft.reward, penalty: draft.penalty,
      };
      const due = Number(draft.dueIn) > 0 && today() ? today() + Math.round(Number(draft.dueIn)) : draft.dueDay;
      if (draft.id) await act('onUpdateQuest', { questId: draft.id, changes: { ...payload, dueDay: due || 0 } }, 'quest-update');
      else await act('onAddQuest', { ...payload, dueDay: due || 0 }, 'quest-add');
      editor = null;
      ctx.render();
    }, draft.id ? 'Квест сохранён' : 'Квест добавлен'));
    card.append(element('div', { className: 'row', style: { marginTop: '10px' } }, [save, button('Отмена', 'btn', () => { editor = null; ctx.render(); })]));
    return card;
  }

  function toggle(list, id) {
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1); else list.push(id);
  }

  // ---- Cards ----------------------------------------------------------------------------

  function renderClosing(quest) {
    const note = element('input', { value: closing.note, placeholder: 'Чем кончилось, одной строкой (по желанию)', maxlength: '300', 'aria-label': 'Итог квеста' });
    note.addEventListener('input', () => { closing.note = note.value; });
    const block = closing.status === 'done' ? quest.reward : quest.penalty;
    const count = block?.shifts?.length ?? 0;
    const apply = element('input', { type: 'checkbox', className: 'set-switch', checked: closing.apply, 'aria-label': 'Применить сдвиги отношений' });
    apply.addEventListener('change', () => { closing.apply = apply.checked; });
    const verb = closing.status === 'done' ? 'Выполнен' : 'Провален';
    return element('div', { className: 'ku-q-closing' }, [
      element('strong', { text: `${verb}: ${quest.name}` }), note,
      ...(block?.text ? [element('p', { className: 'muted ku-small', text: `${closing.status === 'done' ? 'Награда' : 'Последствие'}: ${block.text}` })] : []),
      ...(count ? [element('label', { className: 'ku-names-opt' }, [element('span', {}, [element('strong', { text: `Применить сдвиги отношений (${count})` }), element('small', { className: 'muted', text: block.shifts.map(shift => `${nameOf(snapshot().relationships?.[shift.relationshipId]?.from)} → ${nameOf(snapshot().relationships?.[shift.relationshipId]?.to)}: ${scales().find(item => item.id === shift.scaleId)?.label ?? shift.scaleId} ${shift.value > 0 ? '+' : ''}${shift.value}`).join('; ') })]), apply])] : []),
      element('div', { className: 'row' }, [
        button(`Закрыть как «${verb.toLowerCase()}»`, 'btn primary', () => attempt(async () => {
          await act('onCloseQuest', { questId: quest.id, status: closing.status, outcome: closing.note, apply: closing.apply }, 'quest-close');
          closing = null;
          ctx.render();
        }, 'Квест закрыт')),
        button('Отмена', 'btn', () => { closing = null; ctx.render(); }),
      ]),
    ]);
  }

  function renderQuest(quest) {
    const progress = progressOf(quest);
    const step = currentStep(quest);
    const due = dueText(quest, today());
    const late = due.startsWith('просрочен');
    const head = element('div', { className: 'ku-q-head' }, [
      element('h3', { text: quest.name, style: { margin: 0 } }),
      element('span', { className: `ku-q-pill ${quest.status}`, text: QUEST_LABELS[quest.status] ?? quest.status }),
      ...(quest.secret ? [element('span', { className: 'ku-q-pill secret', text: '🔒 скрыт' })] : []),
    ]);
    const meta = [];
    if (progress.total) meta.push(`шаги ${progress.done}/${progress.total}`);
    if (quest.status === 'active' && due) meta.push(due);
    if (quest.dueDay && quest.status !== 'active') meta.push(`срок: день ${quest.dueDay}`);
    if (quest.participantIds?.length) meta.push(`касается: ${quest.participantIds.map(nameOf).join(', ')}`);
    if (quest.secret && quest.knownByIds?.length) meta.push(`знают: ${quest.knownByIds.map(nameOf).join(', ')}`);
    const card = element('div', { className: `card ku-quest ${quest.status}${late && quest.status === 'active' ? ' late' : ''}` }, [head]);
    if (meta.length) card.append(element('p', { className: 'muted ku-small', style: { margin: '2px 0 6px' }, text: meta.join(' · ') }));
    if (quest.text) card.append(element('p', { text: quest.text, style: { margin: '0 0 8px' } }));
    if (quest.steps?.length) {
      const list = element('div', { className: 'ku-q-steps' });
      for (const item of quest.steps) {
        const box = element('input', { type: 'checkbox', checked: item.done, 'aria-label': `Шаг: ${item.text}` });
        box.addEventListener('change', () => attempt(() => act('onQuestStep', { questId: quest.id, stepId: item.id, done: box.checked }, 'quest-step')));
        list.append(element('label', { className: `ku-q-step${item.done ? ' done' : ''}${step?.id === item.id && quest.status === 'active' ? ' now' : ''}` }, [box, element('span', { text: item.text })]));
      }
      card.append(list);
    }
    if (quest.outcome) card.append(element('p', { className: 'muted ku-small', text: `Итог: ${quest.outcome}` }));
    if (quest.status === 'active' && (quest.reward || quest.penalty)) {
      const bits = [];
      if (quest.reward) bits.push(`успех: ${quest.reward.text || `${quest.reward.shifts.length} сдвиг(а) отношений`}`);
      if (quest.penalty) bits.push(`провал: ${quest.penalty.text || `${quest.penalty.shifts.length} сдвиг(а) отношений`}`);
      card.append(element('p', { className: 'muted ku-small', text: bits.join(' · ') }));
    }
    if (closing?.id === quest.id) { card.append(renderClosing(quest)); return card; }

    const row = element('div', { className: 'row ku-q-actions' });
    if (quest.status === 'active') {
      row.append(
        button('▶ Ввести шаг сейчас', 'btn small primary', () => attempt(() => act('onQuestPush', { questId: quest.id }, 'quest-push')), 'Следующий ответ подаст текущий шаг через сюжет'),
        button('✔ Выполнен', 'btn small', () => { closing = { id: quest.id, status: 'done', note: '', apply: true }; ctx.render(); }),
        button('✖ Провален', 'btn small', () => { closing = { id: quest.id, status: 'failed', note: '', apply: true }; ctx.render(); }),
        button('Отложить', 'btn small', () => attempt(() => act('onUpdateQuest', { questId: quest.id, changes: { status: 'paused' } }, 'quest-update'))),
      );
    } else {
      row.append(button('Вернуть в игру', 'btn small', () => attempt(() => act('onUpdateQuest', { questId: quest.id, changes: { status: 'active' } }, 'quest-update'))));
    }
    row.append(button('Править', 'btn small', () => { editor = draftFrom(quest); ctx.render(); }));
    const armed = armedRemove === quest.id;
    row.append(button(armed ? 'Точно удалить?' : 'Удалить', `btn small${armed ? ' danger' : ''}`, () => {
      if (!armed) { armedRemove = quest.id; ctx.render(); return; }
      armedRemove = '';
      attempt(() => act('onRemoveQuest', { questId: quest.id }, 'quest-remove'), 'Квест удалён');
    }));
    card.append(row);
    return card;
  }

  function section(title, quests, { fold = false } = {}) {
    if (!quests.length) return null;
    const body = element('div', { className: 'ku-q-list' }, quests.map(renderQuest));
    if (!fold) return element('div', { className: 'ku-q-section' }, [element('p', { className: 'section-title', text: `${title} · ${quests.length}` }), body]);
    const details = element('details', { className: 'ku-q-section' }, [element('summary', { text: `${title} · ${quests.length}` }), body]);
    return details;
  }

  function renderQuests() {
    const view = element('div', { className: 'records-view ku-quests' });
    const all = snapshot().quests ?? [];
    view.append(element('div', { className: 'card' }, [
      element('h3', { text: 'Квесты' }),
      element('p', { className: 'muted ku-small', style: { margin: '0 0 8px' }, text: 'Нити истории с шагами, сроком и итогом. Идущие уходят рассказчику; шаг можно ввести в сюжет кнопкой, а выполнение отмечаете вы (или подтверждаете плашку летописца под ответом). Модель сама квесты не закрывает и за персону их не проходит.' }),
      ...(snapshot().questSecretsHidden ? [element('p', { className: 'muted ku-small', text: 'Сейчас квесты не уходят модели: выключено «Квесты в промпт» в настройках.' })] : []),
      button('＋ Квест', 'btn primary', () => { editor = blankDraft(); ctx.render(); }),
    ]));
    if (editor) view.append(renderEditor());
    const groups = { active: [], paused: [], done: [], failed: [] };
    for (const quest of all) groups[quest.status]?.push(quest);
    if (!all.length && !editor) view.append(element('div', { className: 'card' }, [element('p', { className: 'muted', text: 'Квестов пока нет. Добавьте свой или дождитесь плашки «Похоже, началось задание» под ответом.' })]));
    for (const item of [section('Идут', groups.active), section('Отложены', groups.paused), section('Выполнены', groups.done, { fold: true }), section('Провалены', groups.failed, { fold: true })]) if (item) view.append(item);
    return view;
  }

  return { renderQuests };
}

export const QUESTS_STYLE = `
.ku-q-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ku-q-pill{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--rs-line);background:color-mix(in srgb,var(--rs-panel) 80%,var(--rs-accent))}
.ku-q-pill.done{color:var(--k-ok)}.ku-q-pill.failed{color:var(--rs-danger)}.ku-q-pill.paused{opacity:.7}
.ku-quest.late{border-color:var(--rs-danger)}
.ku-quest.done,.ku-quest.failed,.ku-quest.paused{opacity:.85}
.ku-q-steps{display:flex;flex-direction:column;gap:2px;margin:0 0 8px}
.ku-q-step{display:flex;align-items:flex-start;gap:8px;padding:3px 2px;cursor:pointer}
.ku-q-step input{width:auto;margin:3px 0 0;flex:0 0 auto}
.ku-q-step span{flex:1;min-width:0;overflow-wrap:anywhere}
.ku-q-step.done span{opacity:.55;text-decoration:line-through}
.ku-q-step.now span{font-weight:700}
.ku-q-actions{gap:6px;flex-wrap:wrap}
.ku-q-list{display:flex;flex-direction:column;gap:10px}
.ku-q-section{display:flex;flex-direction:column;gap:8px}
.ku-q-section summary{cursor:pointer;font-weight:700;margin:6px 0}
.ku-q-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px}
.ku-q-editor>input,.ku-q-editor>textarea{margin:0 0 8px}
.ku-q-outcome{display:flex;flex-direction:column;gap:6px;margin:10px 0}
.ku-q-shifts{display:flex;flex-direction:column;gap:6px}
.ku-q-shift{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1.4fr) 72px auto;gap:6px;align-items:center}
.ku-q-shift select,.ku-q-shift input{min-width:0;width:100%}
.ku-q-closing{display:flex;flex-direction:column;gap:8px;padding-top:6px;border-top:1px solid var(--rs-line)}
.ku-quests .row input[type=number]{width:90px;flex:0 0 auto}
@media (max-width:520px){.ku-q-shift{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
`;
