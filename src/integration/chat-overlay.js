/**
 * Kulisy inside SillyTavern's own chat, outside the Studio:
 *   - the scene drawer above the message box: who is on stage, and the stage directions
 *     («пнуть» a character, a scene event). Opened, it stays open until its arrow is clicked;
 *   - a note under a reply where the chronicler found a leak, with its three answers;
 *   - a note under a reply where a character seems to die: mark it, or not;
 *   - a note under a reply where someone seems to learn a lorebook secret: mark it, or not.
 *
 * It lives in ST's DOM (not a shadow root), so it is styled by style.css with
 * ST theme variables only. All markup is built with textContent: names and
 * quotes come from the chat and are never parsed as HTML.
 */
const CHIPS_ID = 'ku-scene-chips';
const LEAK_CLASS = 'ku-leak';
const SLIP_CLASS = 'ku-slip';
const DEATH_CLASS = 'ku-death-note-chat';
const REVEAL_CLASS = 'ku-reveal-note';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function actionButton(label, action, data, title) {
  const button = node('button', 'menu_button ku-leak-button', label);
  button.type = 'button';
  button.dataset.kuAction = action;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
  if (title) button.title = title;
  return button;
}

function chipButton(text, action, data = {}, title = '', className = 'ku-dir-btn') {
  const button = node('button', className, text);
  button.type = 'button';
  button.dataset.kuAction = action;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
  if (title) button.title = title;
  return button;
}

/**
 * view = {
 *   chips: boolean,                       // the setting
 *   cast: [{ id, name, present, persona, silent, badges }],
 *   location: string, time: string, secrets: number, waitingReveals: number,
 *   director: { open, silenceAfter, hotkeys, canKick, favorites: [text],
 *               cues: [{ id, entityId, label, badge, used, wait }], others: [{ id, name }] },
 *   leaks: [{ messageIndex, entityId, eventId, name, eventText, quote, canSwipe }],
 * }
 * describe(id) → { persona, present, name, reactTargets: [{ id, name }],
 *                  lines: [{ targetId, targetName, factors: [{ label, text }] }],
 *                  secrets: [{ eventId, label, text }] }
 * eventIdeas() → [text]: today's calendar events, offered as ready scene events.
 */
export function mountChatOverlay({ onTogglePresent, onLeak, onSlip, onDeath, onReveal, onOpenStudio,
  onCue, onRemoveCue, onKickNow, onToggleOpen, onFavorite, describe, eventIdeas }) {
  // The panel's own state: what is selected and typed survives every re-render.
  const fresh = () => ({ selected: '', pane: '', wait: 0, draft: '', eventDraft: '', sceneDraft: '', noteDraft: '', placeDraft: '', placeId: '', skip: 'none', sceneCast: [] });
  const ui = fresh();
  let lastView = null;
  let lastMenu = null;

  const resetMenu = () => Object.assign(ui, fresh());
  /** Arm a cue; then (optionally) send right away, like «▶ Пнуть сейчас». */
  const arm = (cue, { now = false } = {}) => {
    Promise.resolve(onCue?.({ ...cue, wait: ui.wait })).then(ok => {
      if (ok === false) return;
      resetMenu();
      rerender();
      if (now) onKickNow?.();
    }).catch(error => console.error('[Kulisy] Cue failed.', error));
  };
  const sceneCue = () => {
    const place = ui.placeDraft.trim();
    const known = (lastView?.director?.places ?? []).find(item => item.id === ui.placeId);
    return {
      kind: 'scene', text: ui.sceneDraft.trim(), skip: ui.skip, castIds: [...ui.sceneCast],
      ...(known ? { placeId: known.id, place: place || known.name } : place ? { place } : {}),
    };
  };

  function directorAction(action, data) {
    switch (action) {
      case 'dir-toggle': onToggleOpen?.(!lastView?.director?.open); return true;
      case 'dir-select':
        if (ui.selected === data.entityId) resetMenu(); else Object.assign(ui, { selected: data.entityId, pane: '', draft: '' });
        rerender();
        return true;
      case 'dir-pane':
        ui.pane = ui.pane === data.pane ? '' : data.pane;
        if (['event', 'others', 'scene', 'note'].includes(data.pane)) ui.selected = '';
        rerender();
        return true;
      case 'dir-wait': ui.wait = Number(data.wait) || 0; rerender(); return true;
      case 'dir-cue': {
        const cue = { kind: data.kind, entityId: ui.selected };
        if (data.target) cue.targetId = data.target;
        if (data.kind === 'factor') {
          const factor = lastMenu?.lines?.[Number(data.line)]?.factors?.[Number(data.index)];
          if (!factor) return true;
          const line = lastMenu.lines[Number(data.line)];
          Object.assign(cue, { targetId: line.targetId, text: factor.text, label: factor.label });
          if (line.side === 'out') cue.side = 'out';
        }
        if (data.kind === 'secret') {
          const secret = lastMenu?.secrets?.[Number(data.index)];
          if (!secret) return true;
          Object.assign(cue, { eventId: secret.eventId, text: secret.text, label: secret.label });
        }
        if (data.kind === 'event') { delete cue.entityId; if (data.text) cue.text = data.text; }
        arm(cue);
        return true;
      }
      case 'dir-custom': {
        const text = (data.text ?? ui.draft).trim();
        if (text) arm({ kind: 'custom', entityId: ui.selected, text });
        return true;
      }
      case 'dir-event-custom': {
        const text = ui.eventDraft.trim();
        if (text) arm({ kind: 'event', text });
        return true;
      }
      case 'dir-scene': arm(sceneCue(), { now: data.now === 'true' }); return true;
      case 'dir-skip': ui.skip = data.skip; rerender(); return true;
      case 'dir-cast': {
        const id = data.entityId;
        ui.sceneCast = ui.sceneCast.includes(id) ? ui.sceneCast.filter(item => item !== id) : [...ui.sceneCast, id];
        rerender();
        return true;
      }
      case 'dir-note': {
        const text = ui.noteDraft.trim();
        if (text) arm({ kind: 'note', text });
        return true;
      }
      case 'dir-fav-save': if (ui.draft.trim()) onFavorite?.(ui.draft.trim(), true); return true;
      case 'dir-fav-del': onFavorite?.(data.text, false); return true;
      case 'dir-remove': onRemoveCue?.(data.cueId); return true;
      case 'dir-kick': onKickNow?.(); return true;
      default: return false;
    }
  }

  const onClick = event => {
    const target = event.target instanceof Element ? event.target.closest('[data-ku-action]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const { kuAction: action, entityId, eventId, messageIndex, slipIndex } = target.dataset;
    try {
      if (action.startsWith('dir-')) directorAction(action, target.dataset);
      else if (action === 'present') onTogglePresent(entityId, target.dataset.present !== 'true');
      else if (action === 'studio') onOpenStudio?.(target.dataset.tab);
      else if (action.startsWith('reveal-')) onReveal?.(action.slice(7), { messageIndex: Number(messageIndex), entityId, eventId });
      else if (action.startsWith('death-')) onDeath?.(action.slice(6), { messageIndex: Number(messageIndex), entityId });
      else if (action.startsWith('slip-')) onSlip?.(action.slice(5), { messageIndex: Number(messageIndex), slipIndex: Number(slipIndex) });
      else onLeak(action, { messageIndex: Number(messageIndex), entityId, eventId });
    } catch (error) {
      console.error('[Kulisy] Chat overlay action failed.', error);
    }
  };
  document.addEventListener('click', onClick, true);

  // Typing in the panel's fields: kept in ui, Enter sends.
  const onInput = event => {
    const field = event.target?.dataset?.kuField;
    if (field === 'custom') ui.draft = event.target.value;
    if (field === 'event') ui.eventDraft = event.target.value;
    if (field === 'scene') ui.sceneDraft = event.target.value;
    if (field === 'note') ui.noteDraft = event.target.value;
    if (field === 'place') ui.placeDraft = event.target.value;
    if (field === 'place-id') {
      ui.placeId = event.target.value;
      const place = (lastView?.director?.places ?? []).find(item => item.id === ui.placeId);
      ui.placeDraft = place ? place.name : '';
      rerender();
    }
  };
  // Enter sends from one-line fields; the scene's text is a textarea, Enter there is a new line.
  const ENTER_ACTIONS = { custom: 'dir-custom', event: 'dir-event-custom', note: 'dir-note' };
  const onKey = event => {
    const action = ENTER_ACTIONS[event.target?.dataset?.kuField];
    if (action && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      directorAction(action, {});
    }
  };
  // Alt+1…9: the n-th character on stage steps in (again: the kick is taken back).
  const onHotkey = event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code ?? '')?.[1];
    if (!digit || !lastView?.chips || !lastView.director?.hotkeys) return;
    const kickable = lastView.cast.filter(person => person.present && !person.persona);
    const person = kickable[Number(digit) - 1];
    if (!person) return;
    event.preventDefault();
    event.stopPropagation();
    const armed = (lastView.director.cues ?? []).find(cue => cue.kind === 'enter' && cue.entityId === person.id && !cue.used);
    if (armed) onRemoveCue?.(armed.id);
    else Promise.resolve(onCue?.({ kind: 'enter', entityId: person.id, wait: 0 })).catch(error => console.error('[Kulisy] Hotkey cue failed.', error));
  };
  document.addEventListener('keydown', onHotkey, true);

  function rerender() { if (lastView) renderChips(lastView); }

  function pill(text, title, tab = 'scene') {
    return chipButton(text, 'studio', { tab }, title, 'ku-chips-place');
  }

  function personChip(person, director) {
    const chip = chipButton('', 'dir-select', { entityId: person.id }, '', `ku-chip${person.present ? ' on' : ''}${ui.selected === person.id ? ' selected' : ''}`);
    chip.setAttribute('aria-pressed', String(ui.selected === person.id));
    chip.append(node('span', 'ku-chip-name', person.name));
    if (person.persona) chip.append(node('span', 'ku-chip-note', 'персона'));
    for (const cue of (director.cues ?? []).filter(item => item.entityId === person.id)) {
      const badge = node('span', `ku-chip-badge${cue.used ? ' used' : ''}`, `${cue.wait ? `⏳${cue.wait}` : ''}${cue.badge}`);
      badge.title = cue.used ? `${cue.label} — действует для свайпов этого ответа` : cue.label;
      chip.append(badge);
    }
    const sleepy = person.present && !person.persona && director.silenceAfter > 0 && person.silent >= director.silenceAfter;
    if (sleepy) {
      chip.classList.add('sleepy');
      chip.append(node('span', 'ku-chip-badge', `💤${person.silent}`));
    }
    chip.title = [
      person.present ? `${person.name}: на сцене` : `${person.name}: не на сцене`,
      sleepy ? `молчит уже ${person.silent} ${person.silent < 5 ? 'хода' : 'ходов'}` : '',
      'нажмите — что сделать',
    ].filter(Boolean).join(' · ');
    return chip;
  }

  function waitRow() {
    const row = node('div', 'ku-dir-row ku-dir-when');
    row.append(node('span', 'ku-dir-caption', 'Когда:'));
    for (const [value, text] of [[0, 'в этом ответе'], [1, 'через 1'], [2, 'через 2'], [3, 'через 3']]) {
      const button = chipButton(text, 'dir-wait', { wait: value }, value ? `Пропустить ${value} ${value === 1 ? 'ответ' : 'ответа'}, потом сработать` : 'В следующем ответе', `ku-dir-seg${ui.wait === value ? ' on' : ''}`);
      row.append(button);
    }
    return row;
  }

  function textField(field, value, placeholder) {
    const input = node('input', 'text_pole ku-dir-input');
    input.type = 'text';
    input.dataset.kuField = field;
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = 400;
    return input;
  }

  function characterMenu(director) {
    let info = null;
    try { info = describe?.(ui.selected) ?? null; } catch (error) { console.error('[Kulisy] Character menu failed.', error); }
    lastMenu = info;
    if (!info) { ui.selected = ''; return null; }
    const card = node('div', 'ku-dir-card');
    const head = node('div', 'ku-dir-card-head');
    head.append(node('b', null, info.name), node('span', 'ku-dir-caption', info.present ? 'на сцене' : 'не на сцене'));
    card.append(head);
    const presentToggle = chipButton(info.present ? '✖ Убрать тихо' : '➕ Отметить тихо', 'present', { entityId: ui.selected, present: info.present },
      info.present ? 'Просто снять с площадки, рассказчику ничего не говорить' : 'Просто отметить на площадке, рассказчику ничего не говорить');
    if (info.persona) {
      card.append(node('p', 'ku-dir-caption', 'Персону не пинают: за неё играешь ты.'), presentToggle);
      return card;
    }
    const row = node('div', 'ku-dir-row');
    if (info.present) {
      row.append(
        chipButton('👟 Вступить', 'dir-cue', { kind: 'enter' }, 'Сам заговорит или что-то сделает'),
        chipButton('💬 Отреагировать…', 'dir-pane', { pane: 'react' }, 'На кого-то из сцены или на последнюю реплику', `ku-dir-btn${ui.pane === 'react' ? ' on' : ''}`),
        chipButton('✍ Своё…', 'dir-pane', { pane: 'custom' }, 'Написать, что ему сделать', `ku-dir-btn${ui.pane === 'custom' ? ' on' : ''}`),
      );
      if (info.lines.length) row.append(chipButton('❤ Двинуть отношения…', 'dir-pane', { pane: 'factor' }, 'Поступок из факторов роста линии', `ku-dir-btn${ui.pane === 'factor' ? ' on' : ''}`));
      if (info.secrets.length) row.append(chipButton('🔒 На грани секрета…', 'dir-pane', { pane: 'secret' }, 'Почти проговорится, но не раскроет', `ku-dir-btn${ui.pane === 'secret' ? ' on' : ''}`));
      const quiet = node('div', 'ku-dir-row');
      quiet.append(
        chipButton('🤐 Молчит', 'dir-cue', { kind: 'hold' }, 'В сцене, но в этом ответе без реплик'),
        chipButton('🎯 Только он', 'dir-cue', { kind: 'focus' }, 'Ответ про него, остальные на фоне'),
        chipButton('🚪 Увести', 'dir-cue', { kind: 'leave' }, 'Уйдёт со сцены с понятной причиной'),
        presentToggle,
      );
      card.append(row, quiet);
    } else {
      row.append(chipButton('🚪 Позвать в сцену', 'dir-cue', { kind: 'call' }, 'Рассказчик введёт его и объяснит, откуда он взялся'), presentToggle);
      card.append(row);
    }
    if (ui.pane === 'react') {
      const targets = node('div', 'ku-dir-row ku-dir-sub');
      targets.append(chipButton('на последнее', 'dir-cue', { kind: 'react', target: 'last' }, 'На то, что только что произошло'));
      for (const target of info.reactTargets) targets.append(chipButton(target.name, 'dir-cue', { kind: 'react', target: target.id }));
      card.append(targets);
    }
    if (ui.pane === 'custom') {
      const sub = node('div', 'ku-dir-sub');
      const line = node('div', 'ku-dir-row ku-dir-field');
      line.append(textField('custom', ui.draft, 'пусть приревнует…'),
        chipButton('👟', 'dir-custom', {}, 'Пнуть с этим текстом (Enter)'),
        chipButton('⭐', 'dir-fav-save', {}, 'Сохранить в избранные'));
      sub.append(line);
      if (director.favorites?.length) {
        const favorites = node('div', 'ku-dir-row');
        for (const text of director.favorites) {
          const item = node('span', 'ku-dir-fav');
          item.append(chipButton(text, 'dir-custom', { text }, 'Пнуть с этим текстом', 'ku-dir-fav-text'), chipButton('×', 'dir-fav-del', { text }, 'Убрать из избранных', 'ku-dir-fav-del'));
          favorites.append(item);
        }
        sub.append(favorites);
      }
      card.append(sub);
    }
    if (ui.pane === 'factor') {
      const sub = node('div', 'ku-dir-sub');
      info.lines.forEach((line, lineIndex) => {
        sub.append(node('div', 'ku-dir-caption', line.side === 'out'
          ? `Его линия к ${line.targetName} — будет открыт к такому моменту:`
          : `Что он может сделать, чтобы сдвинулся ${line.targetName}:`));
        const row2 = node('div', 'ku-dir-row');
        line.factors.forEach((factor, index) => row2.append(chipButton(factor.label, 'dir-cue', { kind: 'factor', line: lineIndex, index }, factor.text)));
        sub.append(row2);
      });
      card.append(sub);
    }
    if (ui.pane === 'secret') {
      const sub = node('div', 'ku-dir-row ku-dir-sub');
      info.secrets.forEach((secret, index) => sub.append(chipButton(`🔒 ${secret.label}`, 'dir-cue', { kind: 'secret', index }, secret.text)));
      card.append(sub);
    }
    card.append(waitRow());
    return card;
  }

  function eventMenu() {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '⚡ Событие сцены'));
    const row = node('div', 'ku-dir-row');
    row.append(chipButton('🎲 Что-нибудь случится', 'dir-cue', { kind: 'event' }, 'Рассказчик сам выберет: звонок, гость, погода, шум, новость'));
    let ideas = [];
    try { ideas = eventIdeas?.() ?? []; } catch (error) { console.error('[Kulisy] Calendar ideas failed.', error); }
    for (const text of ideas) row.append(chipButton(`📅 ${text}`, 'dir-cue', { kind: 'event', text }, 'Из календаря на сегодня'));
    const field = node('div', 'ku-dir-row ku-dir-field');
    field.append(textField('event', ui.eventDraft, 'в дверь звонят…'), chipButton('⚡', 'dir-event-custom', {}, 'Пусть случится это (Enter)'));
    card.append(row, field, waitRow());
    return card;
  }

  function sceneMenu(director) {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '🎬 Начать новую сцену'));
    const text = node('textarea', 'text_pole ku-dir-input ku-dir-textarea');
    text.dataset.kuField = 'scene';
    text.rows = 3;
    text.maxLength = 1200;
    text.placeholder = 'с чего начать: утро после драки, Зоро чинит катану на палубе, Нами ругается из-за долгов… (можно пусто — рассказчик решит сам)';
    text.value = ui.sceneDraft;
    const when = node('div', 'ku-dir-row');
    when.append(node('span', 'ku-dir-caption', 'Когда:'));
    for (const [value, label] of [['none', 'сразу'], ['hour', 'через час'], ['evening', 'вечером'], ['nextday', 'на следующий день'], ['week', 'неделю спустя']]) {
      when.append(chipButton(label, 'dir-skip', { skip: value }, '', `ku-dir-seg${ui.skip === value ? ' on' : ''}`));
    }
    const where = node('div', 'ku-dir-row ku-dir-field');
    where.append(node('span', 'ku-dir-caption', 'Где:'));
    if (director.places?.length) {
      const select = node('select', 'text_pole ku-dir-select');
      select.dataset.kuField = 'place-id';
      select.setAttribute('aria-label', 'Место из чата');
      select.append(node('option', null, '— место чата —'));
      select.firstChild.value = '';
      for (const place of director.places) {
        const option = node('option', null, place.name);
        option.value = place.id;
        option.selected = place.id === ui.placeId;
        select.append(option);
      }
      where.append(select);
    }
    where.append(textField('place', ui.placeDraft, 'или словами: камбуз «Санни»'));
    const who = node('div', 'ku-dir-row');
    who.append(node('span', 'ku-dir-caption', 'Кто:'));
    for (const person of director.people ?? []) {
      const on = ui.sceneCast.includes(person.id);
      const chip = chipButton(`${on ? '✓ ' : ''}${person.name}`, 'dir-cast', { entityId: person.id }, on ? 'Убрать из сцены' : 'Будет в сцене', `ku-chip${on ? ' on' : ''}`);
      chip.setAttribute('aria-pressed', String(on));
      who.append(chip);
    }
    who.append(node('span', 'ku-dir-caption', ui.sceneCast.length ? '' : '(не отмечено — решит рассказчик)'));
    const go = node('div', 'ku-dir-row');
    go.append(
      chipButton('🎬 С моим постом', 'dir-scene', { now: false }, 'Уйдёт вместе с твоим следующим постом'),
      chipButton('▶ Начать сейчас', 'dir-scene', { now: true }, 'Отправить сразу: с текстом из поля ввода, а если оно пустое — рассказчик начнёт сам', 'ku-dir-btn ku-dir-kick'),
    );
    card.append(text, when, where, who, go);
    return card;
  }

  function noteMenu() {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '📝 Рассказчику'));
    card.append(node('div', 'ku-dir-caption', 'Указание на следующий ответ: «короче», «больше атмосферы, меньше диалогов», «пусть ночь будет дождливой».'));
    const field = node('div', 'ku-dir-row ku-dir-field');
    field.append(textField('note', ui.noteDraft, 'что сказать рассказчику…'), chipButton('📝', 'dir-note', {}, 'Добавить (Enter)'));
    card.append(field, waitRow());
    return card;
  }

  function othersMenu(director) {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', 'Кого позвать'));
    const row = node('div', 'ku-dir-row');
    if (!director.others?.length) row.append(node('span', 'ku-dir-caption', 'Все известные персонажи уже здесь.'));
    for (const person of director.others ?? []) row.append(chipButton(person.name, 'dir-select', { entityId: person.id }, 'Выбрать'));
    card.append(row);
    return card;
  }

  /** The drawer: a slim bar when closed; opened, it stays until its arrow is clicked. */
  function renderChips(view) {
    let bar = document.getElementById(CHIPS_ID);
    const show = view.chips && (view.cast.length || view.director?.others?.length);
    if (!show) { bar?.remove(); return; }
    const form = document.getElementById('send_form');
    if (!form?.parentElement) return;
    if (!bar) {
      bar = node('div', 'ku-director');
      bar.id = CHIPS_ID;
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Сцена и режиссура');
      const headElement = node('div', 'ku-dir-head');
      const body = node('div', 'ku-dir-body');
      body.append(node('div', 'ku-dir-inner'));
      bar.append(headElement, body);
      bar.addEventListener('input', onInput);
      bar.addEventListener('keydown', onKey);
      form.parentElement.insertBefore(bar, form);
    }
    const director = { cues: [], others: [], favorites: [], silenceAfter: 0, ...(view.director ?? {}) };
    const open = Boolean(director.open);
    bar.classList.toggle('open', open);
    const focused = document.activeElement?.dataset?.kuField ?? '';
    const caret = focused ? document.activeElement.selectionStart : null;

    const headElement = bar.querySelector('.ku-dir-head');
    const arrow = chipButton(open ? '▴' : '▾', 'dir-toggle', {}, open ? 'Свернуть' : 'Развернуть', 'ku-dir-arrow');
    arrow.setAttribute('aria-expanded', String(open));
    const places = [
      ...(view.time ? [pill(view.time, 'Время сцены — открыть пульт')] : []),
      ...(view.location ? [pill(`📍 ${view.location}`, 'Место сцены — открыть пульт')] : []),
      ...(view.secrets ? [pill(`🔒 ${view.secrets}${view.waitingReveals ? ` · ждут ${view.waitingReveals}` : ''}`, 'Секреты — кто что знает', 'secrets')] : []),
    ];
    const cast = [...view.cast].sort((left, right) => Number(right.present) - Number(left.present));
    if (open) {
      headElement.removeAttribute('data-ku-action');
      headElement.title = '';
      const tools = node('div', 'ku-dir-tools');
      tools.append(
        chipButton('🎬 Сцена', 'dir-pane', { pane: 'scene' }, 'Начать новую сцену: с чего, когда, где и с кем', `ku-dir-btn${ui.pane === 'scene' ? ' on' : ''}`),
        chipButton('📝 Рассказчику', 'dir-pane', { pane: 'note' }, 'Указание на следующий ответ, без персонажа', `ku-dir-btn${ui.pane === 'note' ? ' on' : ''}`),
        chipButton('⚡ Событие', 'dir-pane', { pane: 'event' }, 'Пусть в сцене что-то случится', `ku-dir-btn${ui.pane === 'event' ? ' on' : ''}`),
        chipButton('▶ Пнуть сейчас', 'dir-kick', {}, director.canKick ? 'Отправить: с твоим текстом из поля, а если оно пустое — без поста' : 'Сейчас идёт генерация', 'ku-dir-btn ku-dir-kick'),
      );
      headElement.replaceChildren(arrow, ...places, tools);
    } else {
      // Closed: one click anywhere on the bar opens it.
      headElement.dataset.kuAction = 'dir-toggle';
      headElement.title = 'Развернуть';
      const summary = node('span', 'ku-dir-summary');
      for (const person of cast.filter(item => item.present)) {
        const name = node('span', 'ku-dir-name', person.name);
        const marks = (director.cues ?? []).filter(cue => cue.entityId === person.id).map(cue => cue.badge).join('');
        const sleepy = !person.persona && director.silenceAfter > 0 && person.silent >= director.silenceAfter;
        if (marks || sleepy) name.append(node('span', 'ku-chip-badge', `${marks}${sleepy ? '💤' : ''}`));
        summary.append(name);
      }
      const pending = (director.cues ?? []).filter(cue => !cue.entityId).length;
      if (pending) summary.append(node('span', 'ku-chip-badge', `⚡${pending}`));
      headElement.replaceChildren(arrow, ...places.map(element => { element.removeAttribute('data-ku-action'); return element; }), summary);
    }

    const inner = bar.querySelector('.ku-dir-inner');
    if (!open) { inner.replaceChildren(); return; }
    const stage = node('div', 'ku-dir-row ku-dir-cast');
    stage.append(node('span', 'ku-dir-caption', 'На сцене:'));
    const here = cast.filter(item => item.present);
    if (!here.length) stage.append(node('span', 'ku-dir-caption', 'никого'));
    for (const person of here) stage.append(personChip(person, director));
    const nearby = cast.filter(item => !item.present);
    if (nearby.length) {
      stage.append(node('span', 'ku-dir-caption ku-dir-gap', 'Рядом:'));
      for (const person of nearby) stage.append(personChip(person, director));
    }
    stage.append(chipButton('+ Позвать', 'dir-pane', { pane: 'others' }, 'Позвать того, кого сейчас нет', `ku-dir-btn ku-dir-add${ui.pane === 'others' ? ' on' : ''}`));
    const parts = [stage];
    if (ui.selected) {
      const menu = characterMenu(director);
      if (menu) parts.push(menu);
    } else if (ui.pane === 'event') parts.push(eventMenu());
    else if (ui.pane === 'scene') parts.push(sceneMenu(director));
    else if (ui.pane === 'note') parts.push(noteMenu());
    else if (ui.pane === 'others') parts.push(othersMenu(director));
    if (director.cues?.length) {
      const queue = node('div', 'ku-dir-row ku-dir-queue');
      queue.append(node('span', 'ku-dir-caption', 'Режиссура:'));
      for (const cue of director.cues) {
        const tag = node('span', `ku-dir-tag${cue.used ? ' used' : ''}`);
        tag.title = cue.used ? 'Уже в силе: действует для свайпов этого ответа, сгорит с твоим следующим постом'
          : cue.wait ? `Сработает через ${cue.wait}` : 'Уйдёт с твоим следующим постом';
        tag.append(node('span', null, `${cue.wait ? `⏳${cue.wait} ` : ''}${cue.badge} ${cue.label}${cue.used ? ' ✓' : ''}`), chipButton('×', 'dir-remove', { cueId: cue.id }, 'Снять', 'ku-dir-fav-del'));
        queue.append(tag);
      }
      parts.push(queue);
    }
    inner.replaceChildren(...parts);
    if (focused) {
      const field = inner.querySelector(`[data-ku-field="${focused}"]`);
      if (field) {
        field.focus();
        try { if (caret != null && typeof field.setSelectionRange === 'function') field.setSelectionRange(caret, caret); } catch { /* a select has no caret */ }
      }
    }
  }

  function renderLeaks(view) {
    for (const old of document.querySelectorAll(`#chat .${LEAK_CLASS}`)) old.remove();
    const byMessage = new Map();
    for (const leak of view.leaks) {
      if (!byMessage.has(leak.messageIndex)) byMessage.set(leak.messageIndex, []);
      byMessage.get(leak.messageIndex).push(leak);
    }
    for (const [messageIndex, leaks] of byMessage) {
      const block = document.querySelector(`#chat .mes[mesid="${messageIndex}"] .mes_block`);
      if (!block) continue; // not rendered (older messages are loaded on scroll)
      for (const leak of leaks) {
        const data = { messageIndex, entityId: leak.entityId, eventId: leak.eventId };
        const note = node('div', LEAK_CLASS);
        note.setAttribute('role', 'note');
        const text = node('div', 'ku-leak-text');
        text.append(
          node('i', 'fa-solid fa-triangle-exclamation'),
          node('b', null, ' Возможная утечка. '),
          `${leak.name} ведёт себя так, будто знает: «${leak.eventText}». В сцене этого не видел(а), и никто не рассказывал.`,
        );
        if (leak.quote) text.append(node('span', 'ku-leak-quote', ` «${leak.quote}»`));
        const actions = node('div', 'ku-leak-actions');
        if (leak.canSwipe) actions.append(actionButton('Свайп', 'swipe', data, 'Перегенерировать этот ответ'));
        actions.append(
          actionButton('Он знает', 'knows', data, 'Это не ошибка: записать, что он знает'),
          actionButton('Не утечка', 'dismiss', data, 'Убрать отметку, ничего не записывая'),
        );
        note.append(text, actions);
        const anchor = block.querySelector('.mes_text');
        if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
      }
    }
  }

  function renderSlips(view) {
    for (const old of document.querySelectorAll(`#chat .${SLIP_CLASS}`)) old.remove();
    for (const slip of view.slips ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${slip.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: slip.messageIndex, slipIndex: slip.slipIndex };
      const note = node('div', `${LEAK_CLASS} ${SLIP_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-shirt'), node('b', null, ` Возможный ляп: ${slip.label}${slip.name ? ` — ${slip.name}` : ''}. `), `«${slip.quote}»`);
      if (slip.note) text.append(node('span', 'ku-leak-quote', ` ${slip.note}`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        slip.canSwipe ? actionButton('Свайп', 'slip-swipe', data, 'Перегенерировать этот ответ') : actionButton('Править', 'slip-edit', data, 'Открыть сообщение для правки'),
        actionButton('Так и есть', 'slip-accept', data, 'Текст верный: переписать запись под него'),
        actionButton('Не ляп', 'slip-dismiss', data, 'Убрать отметку, ничего не меняя'),
        actionButton('Напомнить', 'slip-remind', data, 'Текст не трогать, но в следующем ответе сказать рассказчику, как на самом деле'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  function renderDeaths(view) {
    for (const old of document.querySelectorAll(`#chat .${DEATH_CLASS}`)) old.remove();
    for (const death of view.deaths ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${death.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: death.messageIndex, entityId: death.entityId };
      const note = node('div', `${LEAK_CLASS} ${DEATH_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-cross'), node('b', null, ` Похоже, ${death.name} умирает${death.note ? `: ${death.note}` : ''}. `));
      if (death.quote) text.append(node('span', 'ku-leak-quote', `«${death.quote}»`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton('Отметить', 'death-confirm', data, 'Персонаж умер: уходит со сцены, модель больше не выводит его живым. Удаление или свайп этого ответа снимут отметку.'),
        actionButton('Нет', 'death-dismiss', data, 'Не умер: убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  function renderReveals(view) {
    for (const old of document.querySelectorAll(`#chat .${REVEAL_CLASS}`)) old.remove();
    for (const reveal of view.reveals ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${reveal.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: reveal.messageIndex, entityId: reveal.entityId, eventId: reveal.eventId };
      const note = node('div', `${LEAK_CLASS} ${REVEAL_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-key'), node('b', null, ` Похоже, ${reveal.name} узнаёт секрет: `), `«${reveal.eventText}»`);
      if (reveal.how) text.append(node('span', 'ku-leak-quote', ` (${reveal.how})`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton('Отметить', 'reveal-confirm', data, 'Да, теперь знает: дальше получает текст секрета. Удаление этого ответа снимет отметку.'),
        actionButton('Нет', 'reveal-dismiss', data, 'Не узнал(а): убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  return {
    render(view) {
      lastView = view;
      try {
        renderChips(view);
        renderLeaks(view);
        renderDeaths(view);
        renderReveals(view);
        renderSlips(view);
      } catch (error) {
        console.error('[Kulisy] Chat overlay render failed.', error);
      }
    },
    unmount() {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onHotkey, true);
      document.getElementById(CHIPS_ID)?.remove();
      for (const old of document.querySelectorAll(`.${LEAK_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${SLIP_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${DEATH_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${REVEAL_CLASS}`)) old.remove();
    },
  };
}
