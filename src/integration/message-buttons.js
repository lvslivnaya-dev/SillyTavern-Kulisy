/**
 * "Check this reply" button in every message's "…" menu.
 *
 * SillyTavern clones new messages from the #message_template node, so adding the
 * button to the template once covers all future messages; messages that are
 * already on screen get it through refresh(). One delegated click listener
 * serves every button. User messages hide it via style.css.
 */
const BUTTON_CLASS = 'kulisy-check';
const SECRET_CLASS = 'kulisy-secret';

function createButton() {
  const node = document.createElement('div');
  node.className = `mes_button ${BUTTON_CLASS} fa-solid fa-heart-pulse`;
  node.title = 'Кулисы: проверить этот ответ (отношения, сцена, кто что узнал, утечки)';
  node.setAttribute('aria-label', node.title);
  return node;
}

function createSecretButton() {
  const node = document.createElement('div');
  node.className = `mes_button ${SECRET_CLASS} fa-solid fa-user-secret`;
  node.title = 'Кулисы: создать секрет из выделенного текста (сначала выдели его в сообщении)';
  node.setAttribute('aria-label', node.title);
  return node;
}

function addButtons(root, withSecret) {
  if (!root) return;
  for (const container of root.querySelectorAll('.extraMesButtons')) {
    if (!container.querySelector(`.${BUTTON_CLASS}`)) container.prepend(createButton());
    if (withSecret && !container.querySelector(`.${SECRET_CLASS}`)) container.prepend(createSecretButton());
  }
}

export function mountMessageButtons(onCheck, onSecret = null) {
  const onClick = event => {
    const source = event.target instanceof Element ? event.target : null;
    const target = source?.closest(`.${BUTTON_CLASS}, .${SECRET_CLASS}`);
    if (!target) return;
    const index = Number(target.closest('.mes')?.getAttribute('mesid'));
    if (!Number.isInteger(index)) return;
    event.preventDefault();
    event.stopPropagation();
    try { (target.classList.contains(SECRET_CLASS) ? onSecret : onCheck)?.(index); }
    catch (error) { console.error('[Kulisy] Message button failed.', error); }
  };
  try {
    addButtons(document.getElementById('message_template'), Boolean(onSecret));
    addButtons(document.getElementById('chat'), Boolean(onSecret));
  } catch (error) {
    console.error('[Kulisy] Could not add message buttons.', error);
  }
  document.addEventListener('click', onClick, true);
  return {
    refresh() {
      try { addButtons(document.getElementById('chat'), Boolean(onSecret)); }
      catch (error) { console.error('[Kulisy] Could not add message buttons.', error); }
    },
    unmount() {
      document.removeEventListener('click', onClick, true);
      for (const node of document.querySelectorAll(`.${BUTTON_CLASS}, .${SECRET_CLASS}`)) node.remove();
    },
  };
}
