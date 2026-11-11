/**
 * «Новый секрет»: the window where a secret made from a selected passage is checked before it is saved.
 *
 * It lives in SillyTavern's popup and its DOM, styled by style.css with theme variables only.
 * All text is set with textContent: passages and names come from the chat and are never parsed as HTML.
 *
 * openSecretDialog(ctx, options) → { label, detail, knowIds } or null (cancelled).
 *   options.text          the passage (editable in the window);
 *   options.neighbours    [{ key, label, text }]: posts around it the model may use (keys m1, m2…);
 *   options.roster        [{ id, name }]: every character; options.presentIds: who is on stage;
 *   options.knowIds       preset knowers (kept when the model names nobody);
 *   options.label/detail  preset texts (an event being turned into a secret); options.compose is not run
 *                         on open when the passage is empty;
 *   options.compose({ text, neighbours }) → { label, detail, knowIds, contextIds, fallback, error? }.
 */
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function field(labelText, control, hint) {
  const wrap = node('div', 'ku-sd-field');
  const label = node('label', 'ku-sd-label', labelText);
  if (control.id) label.htmlFor = control.id;
  wrap.append(label, control);
  if (hint) wrap.append(node('div', 'ku-sd-hint', hint));
  return wrap;
}

let counter = 0;

export async function openSecretDialog(ctx, options) {
  const roster = options.roster ?? [];
  const present = new Set(options.presentIds ?? []);
  const nameOf = id => roster.find(entry => entry.id === id)?.name ?? id;
  const neighbours = options.neighbours ?? [];
  const uid = `ku-sd-${(counter += 1)}`;
  const known = new Set(options.knowIds ?? []);
  const ticked = new Set(neighbours.map(item => item.key));
  const ui = { busy: false, composed: false };

  const source = node('textarea', 'text_pole ku-sd-text');
  source.id = `${uid}-source`;
  source.rows = 3;
  source.value = options.text ?? '';
  source.placeholder = 'Вставь или впиши фрагмент истории, из которого получится секрет';
  const label = node('input', 'text_pole ku-sd-input');
  label.id = `${uid}-label`;
  label.type = 'text';
  label.maxLength = 120;
  label.value = options.label ?? '';
  const detail = node('textarea', 'text_pole ku-sd-text');
  detail.id = `${uid}-detail`;
  detail.rows = 4;
  detail.value = options.detail ?? '';
  const status = node('div', 'ku-sd-status');
  status.setAttribute('role', 'status');
  const preview = node('div', 'ku-sd-preview');
  const pills = node('div', 'ku-sd-pills');
  const posts = node('div', 'ku-sd-posts');
  const again = node('button', 'menu_button ku-sd-again', 'Составить заново');
  again.type = 'button';

  const ordered = [...roster].sort((left, right) => Number(present.has(right.id)) - Number(present.has(left.id)) || left.name.localeCompare(right.name, 'ru-RU'));
  const renderPills = () => {
    pills.replaceChildren(...ordered.map(entry => {
      const on = known.has(entry.id);
      const pill = node('button', `ku-sd-pill${on ? ' on' : ''}`, entry.name);
      pill.type = 'button';
      pill.setAttribute('aria-pressed', String(on));
      pill.title = on ? 'Знает: убрать' : present.has(entry.id) ? 'В сцене, не знает: отметить, что знает' : 'Не знает: отметить, что знает';
      if (present.has(entry.id)) pill.append(node('small', null, ' · в сцене'));
      pill.addEventListener('click', () => { if (on) known.delete(entry.id); else known.add(entry.id); renderPills(); renderPreview(); });
      return pill;
    }));
  };
  const renderPosts = () => {
    if (!neighbours.length) { posts.replaceChildren(node('div', 'ku-sd-hint', 'Соседних постов нет: секрет составляется только из текста выше.')); return; }
    posts.replaceChildren(...neighbours.map(item => {
      const row = node('label', 'ku-sd-post');
      const box = node('input');
      box.type = 'checkbox';
      box.checked = ticked.has(item.key);
      box.addEventListener('change', () => { if (box.checked) ticked.add(item.key); else ticked.delete(item.key); });
      const text = node('span', null);
      text.append(node('b', null, `${item.label}: `), String(item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) + (String(item.text ?? '').length > 160 ? '…' : ''));
      row.append(box, text);
      return row;
    }));
  };
  const renderPreview = () => {
    const knowers = [...known].map(nameOf);
    const others = [...present].filter(id => !known.has(id)).map(nameOf);
    const short = detail.value.replace(/\s+/g, ' ').trim();
    preview.replaceChildren(
      node('div', null, `secret[${knowers.join(', ') || 'никто'}]: ${label.value.trim()} — ${short.slice(0, 120)}${short.length > 120 ? '…' : ''}`),
      node('div', null, `unknown[${others.join(', ') || 'никто в сцене'}]: (secret) ${label.value.trim()}`),
    );
  };
  const setBusy = (busy, message = '') => {
    ui.busy = busy;
    for (const control of [source, label, detail, again]) control.disabled = busy;
    status.textContent = message;
  };

  async function run() {
    const text = source.value.trim();
    if (!text) { status.textContent = 'Впиши фрагмент, из которого составить секрет.'; return; }
    setBusy(true, 'Составляю секрет…');
    try {
      const sent = neighbours.filter(item => ticked.has(item.key));
      const result = await options.compose({ text, neighbours: sent });
      label.value = result.label || label.value;
      detail.value = result.detail || detail.value;
      if (result.knowIds?.length) { known.clear(); result.knowIds.forEach(id => known.add(id)); }
      if (!result.fallback) { ticked.clear(); (result.contextIds ?? []).forEach(key => ticked.add(key)); }
      ui.composed = true;
      renderPills(); renderPosts();
      setBusy(false, result.fallback ? `Модель не помогла (${result.error ?? 'нет ответа'}): подставлены твои слова, поправь вручную.` : 'Проверь текст и знающих, потом сохрани.');
    } catch (error) {
      setBusy(false, `Не получилось составить: ${error?.message ?? error}`);
    }
    renderPreview();
  }

  again.addEventListener('click', run);
  label.addEventListener('input', renderPreview);
  detail.addEventListener('input', renderPreview);

  const body = node('div', 'ku-sd');
  body.append(
    node('h3', 'ku-sd-title', options.title ?? 'Новый секрет'),
    field('Фрагмент', source, 'ИИ берёт его и посты рядом, чтобы составить секрет. Можно поправить текст и составить заново.'),
    field('Кто знает', pills, 'Остальные в сцене увидят только подпись.'),
    field('Подтянутые соседние посты', posts, 'Снятые галочки при повторном составлении не учитываются.'),
    field('Подпись: что видят те, кто не знает', label, 'Только факт, без подробностей.'),
    field('Подробности: уходят только знающим', detail),
    field('Как это увидит модель', preview),
    node('div', 'ku-sd-actions'),
    status,
  );
  body.querySelector('.ku-sd-actions').append(again);
  renderPills(); renderPosts(); renderPreview();

  const popup = new ctx.Popup(body, ctx.POPUP_TYPE.TEXT, '', {
    okButton: 'Сохранить секрет',
    cancelButton: 'Отмена',
    wide: true,
    leftAlign: true,
    allowVerticalScrolling: true,
    onOpen: () => { if (source.value.trim() && !(label.value.trim() && detail.value.trim())) run(); else if (!source.value.trim()) source.focus(); },
    onClosing: closing => {
      if (closing.result !== ctx.POPUP_RESULT.AFFIRMATIVE) return true;
      if (ui.busy) { globalThis.toastr?.info?.('Подожди, секрет ещё составляется.', 'Кулисы'); return false; }
      if (!label.value.trim() || !detail.value.trim()) { globalThis.toastr?.warning?.('Нужны подпись и подробности.', 'Кулисы'); return false; }
      if (!known.size) { globalThis.toastr?.warning?.('Отметь хотя бы одного, кто знает секрет.', 'Кулисы'); return false; }
      return true;
    },
  });
  const result = await popup.show();
  if (result !== ctx.POPUP_RESULT.AFFIRMATIVE) return null;
  return { label: label.value.trim().slice(0, 120), detail: detail.value.trim(), knowIds: [...known].sort() };
}
