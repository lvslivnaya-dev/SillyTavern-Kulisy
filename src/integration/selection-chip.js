/**
 * «Создать секрет»: a small button that appears over a passage selected inside one chat message.
 *
 * On phones the system selection menu sits where the button would, so the last selection is also
 * remembered for a while: the «…» menu of a message (message-buttons.js) can use it.
 * Lives in SillyTavern's DOM; styled by style.css with theme variables only.
 */
const CHIP_ID = 'ku-secret-chip';
const MIN_LENGTH = 8;

/** { text, messageIndex, rect } of the current selection when it sits inside one message text, else null. */
export function readSelection(doc = document) {
  const selection = doc.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().replace(/\s+/g, ' ').trim();
  if (text.length < MIN_LENGTH) return null;
  const range = selection.getRangeAt(0);
  const origin = range.commonAncestorContainer;
  const element = origin.nodeType === 1 ? origin : origin.parentElement;
  const message = element?.closest?.('#chat .mes');
  if (!message || !element.closest('.mes_text')) return null;
  const messageIndex = Number(message.getAttribute('mesid'));
  if (!Number.isInteger(messageIndex)) return null;
  return { text: selection.toString().replace(/[ \t]+/g, ' ').trim(), messageIndex, rect: range.getBoundingClientRect?.() ?? { top: 0, bottom: 0, left: 0, width: 0 } };
}

export function mountSelectionChip({ onCreate }) {
  const chip = document.createElement('button');
  chip.id = CHIP_ID;
  chip.type = 'button';
  chip.hidden = true;
  chip.textContent = 'Создать секрет';
  chip.title = 'Кулисы: составить секрет из выделенного текста';
  document.body.append(chip);

  let last = null;
  let frame = 0;

  const hide = () => { chip.hidden = true; };
  const update = () => {
    frame = 0;
    try {
      const info = readSelection();
      if (!info) { hide(); return; }
      last = { text: info.text, messageIndex: info.messageIndex, at: Date.now() };
      chip.hidden = false;
      const width = chip.offsetWidth || 140;
      const below = info.rect.top < 56;
      const top = below ? info.rect.bottom + 8 : info.rect.top - chip.offsetHeight - 8;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, info.rect.left + info.rect.width / 2 - width / 2));
      chip.style.top = `${Math.max(8, top)}px`;
      chip.style.left = `${left}px`;
    } catch (error) {
      hide();
      console.error('[Kulisy] Selection chip failed.', error);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  const onClick = event => {
    event.preventDefault();
    event.stopPropagation();
    const taken = last;
    hide();
    document.getSelection()?.removeAllRanges();
    if (taken) {
      try { onCreate({ text: taken.text, messageIndex: taken.messageIndex }); }
      catch (error) { console.error('[Kulisy] Secret from selection failed.', error); }
    }
  };
  // Keep the selection alive while the button is pressed.
  const keep = event => event.preventDefault();

  document.addEventListener('selectionchange', schedule);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule, { passive: true });
  chip.addEventListener('mousedown', keep);
  chip.addEventListener('click', onClick);

  return {
    /** The selection made within the last `maxAge` ms (it survives a tap on a menu button), or null. */
    recent(maxAge = 90000) { return last && Date.now() - last.at <= maxAge ? { text: last.text, messageIndex: last.messageIndex } : null; },
    unmount() {
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      chip.remove();
    },
  };
}
