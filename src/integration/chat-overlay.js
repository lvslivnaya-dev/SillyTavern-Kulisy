/**
 * Kulisy inside SillyTavern's own chat, outside the Studio:
 *   - chips above the message box: who is on stage (click to send someone off or bring them on);
 *   - a note under a reply where the chronicler found a leak, with its three answers;
 *   - a note under a reply where a character seems to die: mark it, or not.
 *
 * It lives in ST's DOM (not a shadow root), so it is styled by style.css with
 * ST theme variables only. All markup is built with textContent: names and
 * quotes come from the chat and are never parsed as HTML.
 */
const CHIPS_ID = 'ku-scene-chips';
const LEAK_CLASS = 'ku-leak';
const SLIP_CLASS = 'ku-slip';
const DEATH_CLASS = 'ku-death-note-chat';

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

/**
 * view = {
 *   chips: boolean,                       // the setting
 *   cast: [{ id, name, present, persona }],
 *   location: string,
 *   leaks: [{ messageIndex, entityId, eventId, name, eventText, quote, canSwipe }],
 * }
 */
export function mountChatOverlay({ onTogglePresent, onLeak, onSlip, onDeath, onOpenStudio }) {
  const onClick = event => {
    const target = event.target instanceof Element ? event.target.closest('[data-ku-action]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const { kuAction: action, entityId, eventId, messageIndex, slipIndex } = target.dataset;
    try {
      if (action === 'present') onTogglePresent(entityId, target.dataset.present !== 'true');
      else if (action === 'studio') onOpenStudio?.(target.dataset.tab);
      else if (action.startsWith('death-')) onDeath?.(action.slice(6), { messageIndex: Number(messageIndex), entityId });
      else if (action.startsWith('slip-')) onSlip?.(action.slice(5), { messageIndex: Number(messageIndex), slipIndex: Number(slipIndex) });
      else onLeak(action, { messageIndex: Number(messageIndex), entityId, eventId });
    } catch (error) {
      console.error('[Kulisy] Chat overlay action failed.', error);
    }
  };
  document.addEventListener('click', onClick, true);

  function renderChips(view) {
    let bar = document.getElementById(CHIPS_ID);
    const show = view.chips && view.cast.length;
    if (!show) { bar?.remove(); return; }
    const form = document.getElementById('send_form');
    if (!form?.parentElement) return;
    if (!bar) {
      bar = node('div');
      bar.id = CHIPS_ID;
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Кто на сцене');
      form.parentElement.insertBefore(bar, form);
    }
    const label = node('button', 'ku-chips-label', 'На сцене:');
    label.type = 'button';
    label.dataset.kuAction = 'studio';
    label.title = 'Открыть Кулисы';
    const chips = [...view.cast]
      .sort((left, right) => Number(right.present) - Number(left.present))
      .map(person => {
        const chip = node('button', `ku-chip${person.present ? ' on' : ''}`);
        chip.type = 'button';
        chip.dataset.kuAction = 'present';
        chip.dataset.entityId = person.id;
        chip.dataset.present = String(person.present);
        chip.setAttribute('aria-pressed', String(person.present));
        chip.title = person.present ? `${person.name}: убрать со сцены` : `${person.name}: вывести на сцену`;
        chip.append(node('span', 'ku-chip-name', person.name));
        if (person.persona) chip.append(node('span', 'ku-chip-note', 'персона'));
        return chip;
      });
    // Time and place first, as small pills that open the control desk.
    const pill = (text, title) => {
      const element = node('button', 'ku-chips-place', text);
      element.type = 'button';
      element.dataset.kuAction = 'studio';
      element.dataset.tab = 'scene';
      element.title = title;
      return element;
    };
    const head = [
      ...(view.time ? [pill(view.time, 'Время сцены — открыть пульт')] : []),
      ...(view.location ? [pill(view.location, 'Место сцены — открыть пульт')] : []),
    ];
    bar.replaceChildren(label, ...head, ...chips);
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

  return {
    render(view) {
      try {
        renderChips(view);
        renderLeaks(view);
        renderDeaths(view);
        renderSlips(view);
      } catch (error) {
        console.error('[Kulisy] Chat overlay render failed.', error);
      }
    },
    unmount() {
      document.removeEventListener('click', onClick, true);
      document.getElementById(CHIPS_ID)?.remove();
      for (const old of document.querySelectorAll(`.${LEAK_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${SLIP_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${DEATH_CLASS}`)) old.remove();
    },
  };
}
