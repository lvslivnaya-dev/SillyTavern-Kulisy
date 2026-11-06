import { button, characterId, characterName, element } from '../helpers.js';
import { icon } from '../icons.js';
import { WARDROBE_CATEGORIES, WARDROBE_GENDERS, WARDROBE_SHELVES, cardLabel, cardsOf, composeOutfit, searchCards } from '../../core/index.js';
import { fileToDataUrl, imageUrl } from '../../integration/wardrobe-images.js';
import { LOOKS_LIMITS } from '../../integration/world-prompt.js';

/**
 * «Гардероб»: a gallery of pictures (descriptions open on click, in a card over the
 * window), a ready outfit as one card, and the look composer. Shelves: persona /
 * characters; then female / male; then sections. Everything goes through act().
 */
export function createWardrobePages(ctx) {
  const act = (...args) => ctx.act(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  const snapshot = () => ctx.snapshot;
  const wardrobe = () => snapshot().wardrobe ?? { cards: [], looks: [] };
  const characters = () => snapshot().characters || [];
  const personaId = () => snapshot().personaId || '';
  const worn = () => snapshot().world?.wardrobe ?? {};
  const nameOf = id => characterName(characters().find(character => characterId(character) === id), id);
  const SECTION = Object.fromEntries(WARDROBE_CATEGORIES);

  let shelf = 'characters';
  let gender = 'female';
  let section = ''; // '' = everything
  let query = '';
  let composing = false;
  const picked = new Set();
  let lookId = '';
  let lookName = '';
  let target = '';
  let wearMode = 'replace';
  let openId = '';
  let askReplace = false;
  let describeOnUpload = false;
  // What was typed into the open card: kept through any redraw until saved or closed.
  let draft = null; // { cardId, fields }
  let focusedId = ''; // the card whose name got the focus when it opened (only then, not on every redraw)

  /** Run an action; a synchronous error lands in the status line too. */
  async function attempt(work, done) {
    try {
      const result = await work();
      if (done) setStatus(typeof done === 'function' ? done(result) : done);
      return result;
    } catch (error) {
      setStatus(error?.message || String(error), true);
      return undefined;
    } finally {
      render();
    }
  }

  /** Who may wear this shelf: the persona for «Персона», the others for «Персонажи». */
  function wearers(forShelf = shelf) {
    const persona = personaId();
    return characters().map(characterId).filter(id => (forShelf === 'persona' ? id === persona : id !== persona));
  }

  /** «Нужно ~2300 (сейчас 1500)»: how far to raise the scene volume. */
  function needText(fit) {
    const now = Number(snapshot().settings?.scenePromptCharacters) || 1500;
    return fit.need ? `Хватит объёма сцены ${fit.need} (сейчас ${now}).` : `Даже 6000 мало (сейчас ${now}): сократите описания или уберите лишнее со сцены.`;
  }

  /** Does the narrator get the descriptions of what `id` wears? A line, with «Поднять объём сцены» when they did not fit. */
  function looksNote(id, { withName = false } = {}) {
    const fit = snapshot().looksFit ?? {};
    const who = withName ? `${nameOf(id)}: ` : '';
    const raise = () => button('Поднять объём сцены', 'btn small', () => { openId = ''; draft = null; ctx.openSettingsSection?.('scene', { focus: 'Объём сцены' }); },
      'Открыть «Настройки → Знания и сцена → Объём сцены»');
    if (fit.off) return element('p', { className: 'ku-fit muted ku-small', text: `${who}сцена не отправляется модели (выключено в «Настройках»).` });
    const status = fit[id];
    if (!status) return null;
    const text = {
      full: 'описания надетого уходят модели целиком.',
      cut: `модель получает начало описаний: до ${LOOKS_LIMITS.card} символов на вещь и ${LOOKS_LIMITS.character} на всё надетое. Главное пишите в начале.`,
      dropped: 'описания не влезли в сцену: модель знает только, во что одет(а), без подробностей.',
      offstage: 'не на сцене — сейчас модель описаний не получает.',
    }[status];
    if (!text) return null;
    const line = element('div', { className: `ku-fit ku-row ${status}` }, [element('span', { className: 'ku-small', text: `${who}${withName ? text : text[0].toLocaleUpperCase('ru-RU') + text.slice(1)}` })]);
    if (status === 'dropped') {
      line.append(element('span', { className: 'ku-small', text: needText(fit) }), raise());
    }
    return line;
  }

  const wearersOf = cardId => Object.entries(worn()).filter(([, entry]) => entry.cardIds?.includes(cardId)).map(([id]) => id);

  function seg(options, value, label, onPick) {
    const box = element('div', { className: 'ku-seg', role: 'tablist', 'aria-label': label });
    for (const [key, text] of options) {
      const node = button(text, key === value ? 'on' : '', () => onPick(key));
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(key === value));
      box.append(node);
    }
    return box;
  }

  function filePicker(label, { multiple = true, className = 'btn small', onFiles }) {
    const input = element('input', { type: 'file', accept: 'image/*', multiple, hidden: true, 'aria-label': label });
    input.addEventListener('change', () => { const files = [...(input.files ?? [])]; input.value = ''; if (files.length) onFiles(files); });
    const trigger = button(label, className, () => input.click());
    return element('span', { className: 'ku-filepick' }, [trigger, input]);
  }

  /** New cards from pictures, in the open section ('sets' for a ready outfit). */
  async function addPictures(files, { asOutfit = false } = {}) {
    const images = files.filter(file => /^image\//.test(file.type)).slice(0, 30);
    if (!images.length) { setStatus('Это не картинки.', true); return; }
    const category = asOutfit ? 'sets' : section;
    let added = 0;
    for (const file of images) {
      try {
        const imageDataUrl = await fileToDataUrl(file);
        setStatus(`Сохраняю картинку ${added + 1} из ${images.length}…`);
        await act('onWardrobeAddCard', {
          shelf, gender, category: category || 'top', imageDataUrl,
          describe: describeOnUpload, adoptSection: !category,
        }, 'wardrobe-add');
        added += 1;
      } catch (error) {
        setStatus(error?.message || 'Картинка не добавилась', true);
      }
    }
    if (added) setStatus(`Добавлено карточек: ${added}${describeOnUpload ? '' : '. Описание — в карточке, кнопкой «Описать по картинке»'}`);
    render();
  }

  function visibleCards() {
    const all = query.trim() ? searchCards(wardrobe(), query, { shelf }) : cardsOf(wardrobe(), { shelf, gender });
    return section && !query.trim() ? all.filter(card => card.category === section) : all;
  }

  function tile(card) {
    const selected = composing ? picked.has(card.id) : openId === card.id;
    const node = element('button', { type: 'button', className: `ku-tile${selected ? ' on' : ''}`, 'aria-label': `${cardLabel(card)} — ${composing ? (picked.has(card.id) ? 'убрать из образа' : 'в образ') : 'открыть'}`, 'aria-pressed': composing ? String(picked.has(card.id)) : null });
    const picture = card.image
      ? element('img', { className: 'ku-pic', src: imageUrl(card.image), alt: '', loading: 'lazy', draggable: false })
      : element('span', { className: 'ku-pic ku-nopic', 'aria-hidden': 'true' }, [icon('shirt'), element('span', { text: SECTION[card.category] })]);
    node.append(picture);
    if (composing) node.append(element('span', { className: 'ku-check', 'aria-hidden': 'true' }, picked.has(card.id) ? [icon('check')] : []));
    const who = wearersOf(card.id);
    if (who.length) node.append(element('span', { className: 'ku-worn', text: who.length > 1 ? `${nameOf(who[0])} +${who.length - 1}` : nameOf(who[0]) }));
    node.append(element('span', { className: 'ku-cap', text: cardLabel(card) }));
    node.addEventListener('click', () => {
      if (composing) { if (picked.has(card.id)) picked.delete(card.id); else picked.add(card.id); }
      else { openId = card.id; askReplace = false; draft = null; }
      render();
    });
    return node;
  }

  function renderWardrobe() {
    const view = element('div', { className: 'ku-wardrobe' });
    const cards = wardrobe().cards;
    if (openId && !cards.some(card => card.id === openId)) { openId = ''; draft = null; }
    if (!openId) focusedId = '';
    for (const id of [...picked]) if (!cards.some(card => card.id === id)) picked.delete(id);

    const search = element('input', { type: 'search', value: query, placeholder: 'Поиск', 'aria-label': 'Поиск по гардеробу', className: 'ku-search' });
    search.addEventListener('change', () => { query = search.value; render(); });
    const auto = element('input', { type: 'checkbox', className: 'ku-switch', checked: describeOnUpload, 'aria-label': 'Описывать картинки сразу' });
    auto.addEventListener('change', () => { describeOnUpload = auto.checked; });
    view.append(element('div', { className: 'ku-row ku-wtools' }, [
      seg(Object.entries(WARDROBE_SHELVES), shelf, 'Полка', key => { shelf = key; picked.clear(); lookId = ''; target = ''; render(); }),
      seg(Object.entries(WARDROBE_GENDERS), gender, 'Женское, унисекс или мужское', key => { gender = key; render(); }),
      search,
      button(composing ? 'Готово' : 'Собрать образ', composing ? 'btn primary small' : 'btn small', () => { composing = !composing; if (!composing) { picked.clear(); lookId = ''; lookName = ''; } render(); }),
      filePicker('+ Картинки', { className: 'btn primary small', onFiles: files => addPictures(files) }),
      filePicker('+ Готовый образ', { multiple: false, onFiles: files => addPictures(files, { asOutfit: true }) }),
      button('+ Без картинки', 'btn small', () => attempt(async () => {
        const card = await act('onWardrobeAddCard', { shelf, gender, category: section || 'top', name: 'Новая карточка' }, 'wardrobe-add');
        openId = card?.id ?? '';
      })),
      element('label', { className: 'ku-inline ku-small', title: 'Сразу просить модель описать новые картинки (тратит запрос на каждую)' }, [auto, 'описывать сразу']),
    ]));

    const body = element('div', { className: 'ku-wbody' });
    const sections = element('nav', { className: 'ku-wsec', 'aria-label': 'Подразделы' });
    const ofShelf = cardsOf(wardrobe(), { shelf, gender });
    for (const [key, label] of [['', 'Всё'], ...WARDROBE_CATEGORIES]) {
      const count = key ? ofShelf.filter(card => card.category === key).length : ofShelf.length;
      const node = element('button', { type: 'button', className: `ku-wsb${section === key ? ' on' : ''}`, 'aria-current': section === key ? 'true' : null }, [element('span', { text: label }), element('i', { text: String(count) })]);
      node.addEventListener('click', () => { section = key; render(); });
      sections.append(node);
    }
    body.append(sections);

    const gallery = element('div', { className: 'ku-wgal' });
    const looks = wardrobe().looks.filter(look => look.shelf === shelf);
    if (looks.length) {
      gallery.append(element('p', { className: 'section-title', text: 'Образы' }), element('div', { className: 'ku-looks' }, looks.map(look => {
        const node = element('button', { type: 'button', className: `ku-look${lookId === look.id ? ' on' : ''}`, title: composeOutfit(wardrobe(), look.cardIds) }, [
          element('span', { className: 'ku-mini', 'aria-hidden': 'true' }, look.cardIds.slice(0, 3).map(id => {
            const card = cards.find(item => item.id === id);
            return card?.image ? element('img', { src: imageUrl(card.image), alt: '' }) : element('span');
          })),
          element('span', { text: look.name }),
        ]);
        node.addEventListener('click', () => { composing = true; lookId = look.id; lookName = look.name; picked.clear(); look.cardIds.forEach(id => picked.add(id)); render(); });
        return node;
      })));
    }
    const list = visibleCards();
    gallery.append(element('p', { className: 'section-title', text: `${query.trim() ? 'Найдено' : (section ? SECTION[section] : 'Всё')} · ${list.length}` }));
    if (composing) gallery.append(element('p', { className: 'muted ku-small', text: 'Отметьте всё, что войдёт в образ, из любых подразделов. Карточки складываются, а не заменяют друг друга.' }));
    const grid = element('div', { className: 'ku-tiles' }, list.map(tile));
    const drop = filePicker('Перетащите картинки сюда или нажмите', { className: 'ku-tile ku-drop', onFiles: files => addPictures(files) });
    grid.append(drop);
    grid.addEventListener('dragover', event => { event.preventDefault(); grid.classList.add('over'); });
    grid.addEventListener('dragleave', () => grid.classList.remove('over'));
    grid.addEventListener('drop', event => { event.preventDefault(); grid.classList.remove('over'); addPictures([...(event.dataTransfer?.files ?? [])]); });
    gallery.append(grid);
    if (!cards.length) gallery.append(element('p', { className: 'muted', text: 'Гардероб пуст. Добавьте картинки — по одной вещи или готовый образ целиком. Вставить картинку можно и через Ctrl+V.' }));
    body.append(gallery);
    if (composing) body.append(renderComposer());
    view.append(body);
    const opened = cards.find(card => card.id === openId);
    if (opened && !composing) view.append(renderCard(opened, list));
    return view;
  }

  // ---- The card over the window ------------------------------------------------

  function renderCard(card, list) {
    const layer = element('div', { className: 'ku-wlayer' });
    const close = () => { openId = ''; askReplace = false; draft = null; focusedId = ''; render(); };
    layer.addEventListener('click', event => { if (event.target === layer) close(); });
    const dialog = element('section', { className: 'ku-wcard', role: 'dialog', 'aria-modal': 'true', 'aria-label': cardLabel(card) });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    });
    const index = list.findIndex(item => item.id === card.id);
    const go = step => { const next = list[index + step]; if (next) { openId = next.id; askReplace = false; draft = null; render(); } };

    const view = element('div', { className: 'ku-wview' }, [
      card.image ? element('img', { src: imageUrl(card.image), alt: cardLabel(card) }) : element('span', { className: 'ku-nopic big', 'aria-hidden': 'true' }, [icon('shirt'), element('span', { text: 'Нет картинки' })]),
      element('div', { className: 'ku-wview-tools' }, [
        filePicker(card.image ? 'Заменить' : 'Добавить картинку', { multiple: false, className: 'btn small', onFiles: async files => {
          await attempt(async () => act('onWardrobeSetImage', { cardId: card.id, imageDataUrl: await fileToDataUrl(files[0]) }, 'wardrobe-image'), 'Картинка заменена');
        } }),
        ...(card.image ? [button('Убрать картинку', 'btn small', () => attempt(() => act('onWardrobeRemoveImage', { cardId: card.id }, 'wardrobe-image'), 'Картинка убрана'))] : []),
        element('span', { className: 'ku-push' }),
        Object.assign(button('‹', 'btn small', () => go(-1), 'Предыдущая карточка'), { disabled: index <= 0 }),
        Object.assign(button('›', 'btn small', () => go(1), 'Следующая карточка'), { disabled: index < 0 || index >= list.length - 1 }),
      ]),
    ]);

    const typed = draft?.cardId === card.id ? draft.fields : {};
    const name = element('input', { type: 'text', value: typed.name ?? card.name, 'aria-label': 'Название', placeholder: 'Название' });
    const shelfSelect = element('select', { 'aria-label': 'Полка' }, Object.entries(WARDROBE_SHELVES).map(([key, text]) => element('option', { value: key, text, selected: key === (typed.shelf ?? card.shelf) })));
    const genderSelect = element('select', { 'aria-label': 'Женское, унисекс или мужское' }, Object.entries(WARDROBE_GENDERS).map(([key, text]) => element('option', { value: key, text, selected: key === (typed.gender ?? card.gender) })));
    const sectionSelect = element('select', { 'aria-label': 'Подраздел' }, WARDROBE_CATEGORIES.map(([key, text]) => element('option', { value: key, text, selected: key === (typed.category ?? card.category) })));
    const description = element('textarea', { rows: 7, value: typed.description ?? card.description, 'aria-label': 'Описание', placeholder: 'Как выглядит: цвет, ткань, крой, детали. Можно написать самой или попросить модель по картинке.' });
    // Tattoos: where it is — the description and the narrator use it.
    const placement = element('input', { type: 'text', value: typed.placement ?? card.placement ?? '', 'aria-label': 'Где находится', placeholder: 'например: левое предплечье, вдоль позвоночника, за ухом' });
    const placementField = element('div', { className: 'field' }, [element('label', { text: 'Где находится' }), placement,
      element('p', { className: 'muted ku-small ku-hint', text: '«Описать по картинке» напишет именно это место, рассказчик получит его вместе с тату.' })]);
    const showPlacement = () => { placementField.hidden = sectionSelect.value !== 'tattoos'; };
    sectionSelect.addEventListener('change', showPlacement);
    showPlacement();
    const fields = () => ({ name: name.value, shelf: shelfSelect.value, gender: genderSelect.value, category: sectionSelect.value, description: description.value, placement: placement.value });
    for (const node of [name, shelfSelect, genderSelect, sectionSelect, description, placement]) {
      for (const type of ['input', 'change']) node.addEventListener(type, () => { draft = { cardId: card.id, fields: fields() }; });
    }
    // How much of it the narrator gets: the start only, past the limit.
    const counter = element('p', { className: 'ku-count muted ku-small', 'aria-live': 'polite' });
    const count = () => {
      const length = description.value.replace(/\s+/g, ' ').trim().length;
      counter.textContent = length > LOOKS_LIMITS.card
        ? `${length} символов · модель получит первые ${LOOKS_LIMITS.card} — главное пишите в начале`
        : `${length} из ${LOOKS_LIMITS.card} символов, которые уходят модели`;
      counter.classList.toggle('over', length > LOOKS_LIMITS.card);
    };
    description.addEventListener('input', count);
    count();
    const saveFirst = async () => {
      const saved = await act('onWardrobeUpdateCard', { cardId: card.id, changes: fields() }, 'wardrobe-update');
      draft = null;
      return saved;
    };
    // Saved first, so a name typed by hand stays: the model renames only a card it named itself.
    const describe = () => attempt(async () => { await saveFirst(); askReplace = false; return act('onWardrobeDescribe', { cardId: card.id, overwrite: true }, 'wardrobe-describe'); }, 'Описание готово — проверьте и поправьте, если нужно');
    const describeButton = button('Описать по картинке', 'btn small', () => {
      if (description.value.trim()) { askReplace = true; render(); return; }
      describe();
    });
    describeButton.disabled = !card.image;
    if (!card.image) describeButton.title = 'Сначала добавьте картинку';
    const replaceRow = askReplace ? element('div', { className: 'ku-row ku-ask' }, [
      element('span', { className: 'ku-small', text: 'Описание уже есть. Заменить его новым?' }),
      button('Заменить описание', 'btn primary small', describe),
      button('Оставить', 'btn small', () => { askReplace = false; render(); }),
    ]) : null;

    const who = new Set(wearersOf(card.id));
    const people = wearers(card.shelf);
    const wearBox = element('div', { className: 'ku-wear' }, [element('strong', { className: 'ku-small', text: 'Носит в этом чате' })]);
    if (!people.length) {
      wearBox.append(element('p', { className: 'muted ku-small', text: card.shelf === 'persona' ? 'Персона не выбрана в этом чате.' : 'В чате пока нет персонажей.' }));
    } else {
      wearBox.append(element('div', { className: 'ku-row' }, people.map(id => {
        const on = who.has(id);
        const node = button(nameOf(id), `ku-who${on ? ' on' : ''}`, () => attempt(() => (on
          ? act('onTakeOff', { entityId: id, cardId: card.id }, 'wardrobe-take-off')
          : act('onWear', { entityId: id, cardIds: [card.id], mode: 'add' }, 'wardrobe-wear')), on ? `${nameOf(id)}: снято` : `${nameOf(id)}: надето`), on ? `Снять с: ${nameOf(id)}` : `Надеть поверх: ${nameOf(id)}`);
        node.setAttribute('aria-pressed', String(on));
        return node;
      })), element('p', { className: 'muted ku-small', text: 'Клик — надеть поверх того, что надето, или снять. Остальная одежда не меняется.' }));
      for (const id of people.filter(person => who.has(person))) { const note = looksNote(id, { withName: true }); if (note) wearBox.append(note); }
    }

    const form = element('div', { className: 'ku-wform' }, [
      element('div', { className: 'ku-row' }, [
        element('span', { className: 'muted ku-small', text: `${WARDROBE_SHELVES[card.shelf]} · ${WARDROBE_GENDERS[card.gender]} · ${SECTION[card.category]}` }),
        element('span', { className: 'ku-push' }),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': 'Закрыть', title: 'Закрыть' }, [icon('close')]), { onclick: close }),
      ]),
      element('div', { className: 'field' }, [element('label', { text: 'Название' }), name]),
      element('div', { className: 'ku-row ku-wselects' }, [shelfSelect, genderSelect, sectionSelect]),
      placementField,
      element('div', { className: 'field' }, [element('div', { className: 'ku-row' }, [element('label', { text: 'Описание' }), element('span', { className: 'ku-push' }), describeButton]), description, counter]),
      replaceRow,
      wearBox,
      element('div', { className: 'ku-row ku-wfoot' }, [
        button('Удалить карточку', 'btn small danger', () => attempt(async () => { const removed = await act('onWardrobeRemoveCard', { cardId: card.id }, 'wardrobe-remove'); if (removed) openId = ''; })),
        element('span', { className: 'ku-push' }),
        button('В образ…', 'btn small', () => { picked.add(card.id); composing = true; openId = ''; render(); }),
        // «Сохранить» closes the card; a failed save keeps it open with what was typed.
        button('Сохранить', 'btn primary small', () => attempt(async () => { await saveFirst(); openId = ''; askReplace = false; }, 'Карточка сохранена')),
      ]),
    ]);
    dialog.append(view, form);
    layer.append(dialog);
    if (focusedId !== card.id) {
      focusedId = card.id;
      setTimeout(() => { if (dialog.isConnected && !dialog.contains(ctx.shadow?.activeElement)) name.focus({ preventScroll: true }); }, 0);
    }
    return layer;
  }

  // ---- The look composer ----------------------------------------------------------

  function renderComposer() {
    const side = element('aside', { className: 'ku-wside', 'aria-label': 'Образ' });
    const cards = wardrobe().cards;
    const chosen = cards.filter(card => picked.has(card.id));
    side.append(element('p', { className: 'section-title', text: `В образе · ${chosen.length}` }));
    if (!chosen.length) side.append(element('p', { className: 'muted ku-small', text: 'Пока пусто: отметьте картинки слева.' }));
    for (const card of cardsOf({ cards: chosen, looks: [] })) {
      side.append(element('div', { className: 'ku-part' }, [
        card.image ? element('img', { src: imageUrl(card.image), alt: '' }) : element('span', { className: 'ku-part-blank', 'aria-hidden': 'true' }),
        element('span', { className: 'ku-part-text' }, [element('strong', { text: cardLabel(card) }), element('span', { className: 'muted ku-small', text: SECTION[card.category] })]),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': `Убрать из образа: ${cardLabel(card)}`, title: 'Убрать из образа' }, [icon('close')]), { onclick: () => { picked.delete(card.id); render(); } }),
      ]));
    }
    if (chosen.length) side.append(element('p', { className: 'ku-line ku-small', text: `Рассказчик получит: «${composeOutfit(wardrobe(), [...picked])}» и описания карточек, если хватит места.` }));
    const name = element('input', { type: 'text', value: lookName, 'aria-label': 'Название образа', placeholder: 'Например: форма Тосвы' });
    name.addEventListener('input', () => { lookName = name.value; });
    side.append(element('div', { className: 'field' }, [element('label', { text: 'Название образа' }), name]));
    const saveLook = button(lookId ? 'Сохранить изменения' : 'Сохранить образ', 'btn small', () => attempt(async () => {
      if (lookId) await act('onWardrobeUpdateLook', { lookId, changes: { name: lookName, cardIds: [...picked] } }, 'wardrobe-look');
      else { const look = await act('onWardrobeAddLook', { shelf, name: lookName, cardIds: [...picked] }, 'wardrobe-look'); lookId = look?.id ?? ''; }
    }, 'Образ сохранён'));
    saveLook.disabled = !chosen.length;
    side.append(element('div', { className: 'ku-row' }, [saveLook, ...(lookId ? [button('Удалить образ', 'btn small danger', () => attempt(async () => {
      await act('onWardrobeRemoveLook', { lookId }, 'wardrobe-look');
      lookId = ''; lookName = ''; picked.clear();
    }, 'Образ удалён'))] : [])]));

    const people = wearers();
    if (!people.includes(target)) target = people[0] ?? '';
    const dress = element('div', { className: 'ku-wear' }, [element('strong', { className: 'ku-small', text: 'Надеть в этом чате' })]);
    if (!people.length) {
      dress.append(element('p', { className: 'muted ku-small', text: shelf === 'persona' ? 'Персона не выбрана в этом чате.' : 'В чате пока нет персонажей.' }));
    } else {
      const who = element('select', { 'aria-label': 'Кому' }, people.map(id => element('option', { value: id, text: nameOf(id), selected: id === target })));
      who.addEventListener('change', () => { target = who.value; });
      const go = button('Надеть', 'btn primary small', () => attempt(() => act('onWear', { entityId: target, cardIds: [...picked], mode: wearMode }, 'wardrobe-wear'), `${nameOf(target)}: образ надет`));
      go.disabled = !chosen.length;
      dress.append(who, seg([['replace', 'Вместо надетого'], ['add', 'Поверх']], wearMode, 'Как надеть', key => { wearMode = key; render(); }), go);
    }
    side.append(dress);
    return side;
  }

  // ---- Ctrl+V of a picture while the wardrobe is open -------------------------------

  function onPaste(event) {
    try {
      if (ctx.tab !== 'wardrobe' || !ctx.shadow?.host?.isConnected) return;
      const target = event.composedPath?.()[0];
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && target.type !== 'file') return;
      const files = [...(event.clipboardData?.files ?? [])].filter(file => /^image\//.test(file.type));
      if (!files.length) return;
      event.preventDefault();
      addPictures(files);
    } catch (error) {
      console.error('[Kulisy] Paste into the wardrobe failed.', error);
    }
  }
  document.addEventListener('paste', onPaste);

  /** The worn cards of one character, for the dossier: pictures with «снять». */
  function renderWornCards(id) {
    const entry = worn()[id];
    const cards = (entry?.cardIds ?? []).map(cardId => wardrobe().cards.find(card => card.id === cardId)).filter(Boolean);
    const box = element('div', { className: 'ku-worn-row' });
    const note = cards.length ? looksNote(id) : null;
    if (note) box.append(note);
    for (const card of cards) {
      box.append(element('div', { className: 'ku-part' }, [
        card.image ? element('img', { src: imageUrl(card.image), alt: '' }) : element('span', { className: 'ku-part-blank', 'aria-hidden': 'true' }),
        element('span', { className: 'ku-part-text' }, [element('strong', { text: cardLabel(card) }), element('span', { className: 'muted ku-small', text: SECTION[card.category] })]),
        Object.assign(element('button', { type: 'button', className: 'ku-ib', 'aria-label': `Снять: ${cardLabel(card)}`, title: 'Снять' }, [icon('close')]), { onclick: () => attempt(() => act('onTakeOff', { entityId: id, cardId: card.id }, 'wardrobe-take-off')) }),
      ]));
    }
    box.append(button(cards.length ? 'Открыть гардероб' : 'Одеть из гардероба', 'btn small', () => {
      shelf = id === personaId() ? 'persona' : 'characters';
      composing = true; picked.clear(); target = id; lookId = ''; lookName = '';
      ctx.setTab('wardrobe');
    }));
    return box;
  }

  return { needText, renderWardrobe, renderWornCards, destroyWardrobe: () => document.removeEventListener('paste', onPaste) };
}

/** Styles of the wardrobe; colours only from the theme tokens. */
export const WARDROBE_STYLE = `
.ku-wardrobe{display:flex;flex-direction:column;gap:12px;container-type:inline-size}
.ku-wtools{gap:8px}
.ku-seg{display:inline-flex;padding:3px;border-radius:11px;background:var(--k-inset);border:1px solid var(--k-line);gap:2px}
.ku-seg button{min-height:30px;padding:0 12px;border-radius:8px;border:0;background:transparent;color:var(--k-muted);font:inherit;font-size:13px;font-weight:700;cursor:pointer}
.ku-seg button.on{background:var(--k-panel);color:var(--k-text);box-shadow:0 1px 3px var(--k-shadow)}
.ku-filepick{display:inline-flex}
.ku-wbody{display:flex;gap:14px;align-items:flex-start;min-width:0}
.ku-wsec{width:170px;flex:0 0 auto;display:flex;flex-direction:column;gap:1px;position:sticky;top:0}
.ku-wsb{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:31px;padding:0 10px;border-radius:8px;border:0;background:transparent;color:var(--k-muted);font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer}
.ku-wsb:hover{color:var(--k-text);background:var(--k-inset)}
.ku-wsb.on{background:var(--k-accent-soft);color:var(--k-accent);font-weight:800}
.ku-wsb i{font-style:normal;font-size:11px;opacity:.8}
.ku-wgal{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:10px}
.ku-looks{display:flex;gap:8px;flex-wrap:wrap}
.ku-look{display:inline-flex;align-items:center;gap:8px;padding:4px 12px 4px 4px;border-radius:12px;border:1px solid var(--k-line);background:var(--k-inset);color:var(--k-text);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.ku-look.on,.ku-look:hover{border-color:var(--k-accent-line)}
.ku-mini{display:flex;gap:2px}
.ku-mini img,.ku-mini span{width:20px;height:26px;border-radius:4px;object-fit:cover;background:var(--k-line)}
.ku-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;border-radius:14px}
.ku-tiles.over{outline:2px dashed var(--k-accent);outline-offset:4px}
.ku-tile{position:relative;padding:0;border:1px solid var(--k-line);border-radius:13px;overflow:hidden;background:var(--k-inset);color:var(--k-text);font:inherit;text-align:left;display:flex;flex-direction:column;cursor:pointer;min-width:0}
.ku-tile:hover{border-color:var(--k-accent-line)}
.ku-tile.on{border-color:var(--k-accent);box-shadow:0 0 0 3px var(--k-accent-soft)}
.ku-pic{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:var(--k-panel)}
.ku-nopic{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:var(--k-muted);font-size:11px;border-bottom:1px dashed var(--k-line)}
.ku-nopic.big{width:100%;height:100%;font-size:13px}
.ku-cap{padding:6px 8px;font-size:11.5px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-worn{position:absolute;top:6px;right:6px;max-width:calc(100% - 12px);padding:2px 8px;border-radius:20px;background:var(--k-panel);color:var(--k-text);font-size:10.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--k-accent-line)}
.ku-check{position:absolute;top:7px;left:7px;width:22px;height:22px;border-radius:7px;border:2px solid var(--k-text);background:var(--k-panel);display:grid;place-items:center;color:var(--k-accent)}
.ku-tile.on .ku-check{border-color:var(--k-accent)}
.ku-drop{border-style:dashed;align-items:center;justify-content:center;min-height:120px;color:var(--k-muted);font-weight:700;font-size:12px;text-align:center;padding:10px;width:100%}
.ku-wside{width:300px;flex:0 0 auto;display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);position:sticky;top:0}
.ku-part{display:flex;align-items:center;gap:10px;padding:6px;border-radius:11px;border:1px solid var(--k-line);background:var(--k-inset);min-width:0}
.ku-part img,.ku-part-blank{width:34px;height:44px;border-radius:7px;object-fit:cover;flex:0 0 auto;background:var(--k-line)}
.ku-part-text{display:flex;flex-direction:column;min-width:0;flex:1 1 auto}
.ku-part-text strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ku-line{margin:0;padding:9px 11px;border-radius:10px;border:1px dashed var(--k-line);color:var(--k-muted);line-height:1.45}
.ku-wear{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;border:1px solid var(--k-line);background:var(--k-inset)}
.ku-who{min-height:30px;padding:0 12px;border-radius:20px;border:1px solid var(--k-line);background:var(--k-panel);color:var(--k-text);font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.ku-who.on{border-color:var(--k-accent);background:var(--k-accent-soft);color:var(--k-accent)}
.ku-wlayer{position:fixed;inset:0;z-index:2147483002;background:var(--k-backdrop);display:grid;place-items:center;padding:16px}
.ku-wcard{width:min(940px,100%);max-height:100%;display:flex;border:1px solid var(--k-line);border-radius:18px;background:var(--k-bg);box-shadow:0 30px 80px var(--k-shadow);overflow:hidden}
.ku-wview{flex:0 0 42%;position:relative;background:var(--k-inset);display:grid;place-items:center;min-height:360px}
.ku-wview img{width:100%;height:100%;max-height:80vh;object-fit:contain;display:block}
.ku-wview-tools{position:absolute;left:12px;right:12px;bottom:12px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.ku-wform{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:12px;padding:18px 20px;overflow:auto}
.ku-wselects select{flex:1 1 120px;width:auto}
.ku-wfoot{margin-top:auto}
.ku-ask{padding:8px 10px;border:1px solid var(--k-accent-line);border-radius:10px}
.ku-worn-row{display:flex;flex-direction:column;gap:6px}
.ku-count,.ku-hint{margin:4px 0 0}
.ku-count.over{color:var(--k-accent)}
.ku-fit{gap:8px;padding:7px 10px;border-radius:10px;border:1px solid var(--k-line);margin:0}
.ku-fit.dropped{border-color:var(--k-accent-line);background:var(--k-accent-soft)}
.ku-flash{outline:2px solid var(--k-accent);outline-offset:4px;border-radius:10px}
@container (max-width:700px){.ku-wbody{flex-direction:column}.ku-wsec{width:100%;flex-direction:row;flex-wrap:wrap;position:static}.ku-wside{width:100%;position:static}}
@media (max-width:760px){.ku-wcard{flex-direction:column;overflow:auto}.ku-wview{flex-basis:auto;min-height:240px}}
`;
