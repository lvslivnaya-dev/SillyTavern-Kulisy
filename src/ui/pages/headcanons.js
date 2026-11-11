import { button, characterId, characterName, element, formatTime, pairSource, pairTarget, themedSelect } from '../helpers.js';

/**
 * Headcanons per pair, and the read-only viewer sheet.
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createHeadcanonsPage(ctx) {
  const { facade, factorsLayer } = ctx;
  const act = (...args) => ctx.act(...args);
  const closeFactors = (...args) => ctx.closeFactors(...args);
  const fitFactorsToViewport = (...args) => ctx.fitFactorsToViewport(...args);
  const fold = (...args) => ctx.fold(...args);
  const nameOf = (...args) => ctx.nameOf(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  let openHeadcanonKey = null; // headcanons tab: the pair being viewed ("a|b")
  let editingHeadcanonId = null;
  const HEADCANON_SOURCES = { manual: 'вручную', lore: 'из лора и чата', auto: 'по ходу игры' };

  function headcanonEntry(key) {
    return ctx.snapshot.ui?.headcanons?.[key] ?? { items: [] };
  }

  /** Unordered pairs of the existing lines (A → B and B → A are one pair here). */
  function headcanonLinePairs() {
    const seen = new Map();
    for (const pair of ctx.snapshot.pairs || []) {
      const ids = [pairSource(pair), pairTarget(pair)];
      let key;
      try { key = facade.invoke('onHeadcanonKey', { firstId: ids[0], secondId: ids[1] }); } catch { continue; }
      if (!seen.has(key)) seen.set(key, ids.map(id => nameOf(id)).join(' & '));
    }
    return personaPairsFirst([...seen].map(([key, label]) => ({ key, label })));
  }

  /** Pairs with the persona first, then character-to-character ones; alphabetical inside each group. */
  function personaPairsFirst(pairs) {
    const personaId = ctx.snapshot.personaId || ctx.snapshot.ui?.personaId || '';
    const rank = pair => (personaId && pair.key.split('|').includes(personaId) ? 0 : 1);
    return [...pairs].sort((left, right) => rank(left) - rank(right) || left.label.localeCompare(right.label, 'ru-RU'));
  }

  function renderHeadcanons() {
    if (openHeadcanonKey) {
      const ids = openHeadcanonKey.split('|');
      if (ids.every(id => (ctx.snapshot.characters || []).some(character => characterId(character) === id))) return renderHeadcanonPair(openHeadcanonKey);
      openHeadcanonKey = null;
    }
    const container = element('div', { className: 'records-view' });
    // Picker: an existing line, or any two characters when there is no line yet.
    const linePairs = headcanonLinePairs();
    const lineSelect = themedSelect({
      options: [{ value: '', label: linePairs.length ? 'Выберите линию' : 'Линий пока нет' }, ...linePairs.map(item => ({ value: item.key, label: item.label }))],
      label: 'Линия', onChange: value => { if (value) { openHeadcanonKey = value; render(); } },
    });
    // Any two or more characters: a pair, or a group with its own headcanons.
    const chosen = new Set();
    const roster = element('div', { className: 'roster-list' });
    for (const character of ctx.snapshot.characters || []) {
      const box = element('input', { type: 'checkbox' });
      box.addEventListener('change', () => { if (box.checked) chosen.add(characterId(character)); else chosen.delete(characterId(character)); });
      roster.append(element('label', { className: 'roster-item' }, [box, element('span', { text: characterName(character) })]));
    }
    const openPair = button('Открыть', 'btn primary', () => {
      try {
        openHeadcanonKey = facade.invoke('onHeadcanonKey', { ids: [...chosen] });
        render();
      } catch (error) { setStatus(error?.message || 'Выберите хотя бы двух персонажей', true); }
    });
    container.append(element('div', { className: 'card' }, [
      element('h3', { text: 'Выбрать пару или группу' }),
      element('div', { className: 'record-filters' }, [
        element('div', { className: 'field' }, [element('label', { text: 'Линия' }), lineSelect]),
      ]),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 8px' }, text: 'Или отметьте персонажей: двое — пара, трое и больше — группа со своими хедканонами (например, о компании или семье).' }),
      element('div', { className: 'roster' }, [roster]),
      openPair,
    ]));

    const pairs = personaPairsFirst(ctx.snapshot.headcanonPairs || []);
    const list = element('div', { className: 'headcanon-pairs' });
    for (const pair of pairs) {
      const card = element('button', { type: 'button', className: 'headcanon-pair' }, [
        element('strong', { text: pair.label }),
        element('span', { className: 'muted', text: `хедканонов: ${pair.items.length}, включено: ${pair.enabledCount}` }),
        element('span', { className: pair.auto ? 'headcanon-auto on' : 'headcanon-auto', text: pair.auto ? 'автозаполнение вкл' : 'автозаполнение выкл' }),
      ]);
      card.addEventListener('click', () => { openHeadcanonKey = pair.key; render(); });
      list.append(card);
    }
    container.append(element('div', { className: 'card' }, [
      element('h3', { text: 'Пары и группы с хедканонами' }),
      pairs.length ? list : element('div', { className: 'empty', text: 'Хедканонов пока нет. Выберите пару или группу выше.' }),
    ]));
    return container;
  }

  function renderHeadcanonPair(key) {
    const ids = key.split('|');
    const label = ids.map(id => nameOf(id)).join(' & ');
    const entry = headcanonEntry(key);
    const items = entry.items ?? [];
    const auto = Boolean(facade.invoke('onAutoHeadcanons', { key }));
    const autoInput = element('input', { type: 'checkbox', checked: auto });
    autoInput.addEventListener('change', () => act('onSetHeadcanonAuto', { key, auto: autoInput.checked }, 'headcanon-auto'));
    const generate = button('Сгенерировать из лорбука и чата', 'btn', async () => {
      generate.disabled = true;
      setStatus('Генерирую хедканоны…');
      try {
        const added = await facade.invoke('onGenerateHeadcanons', { key });
        setStatus(`Добавлено хедканонов: ${added}`);
      } catch (error) { setStatus(error?.message || 'Не удалось сгенерировать хедканоны', true); }
      finally { generate.disabled = false; }
    });
    if (ctx.snapshot.modelBusy) generate.disabled = true;

    const head = element('div', { className: 'card' }, [
      element('div', { className: 'headcanon-head' }, [
        button('← Все пары', 'btn', () => { openHeadcanonKey = null; editingHeadcanonId = null; render(); }),
        element('h3', { text: label }),
      ]),
      element('label', { className: 'roster-item', style: { margin: '10px 0 4px' } }, [autoInput, 'Автозаполнение по ходу игры']),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 10px' }, text: ctx.snapshot.settings?.autoHeadcanons
        ? 'Новые устойчивые факты о паре анализатор будет добавлять сам, когда проверяет ответы.'
        : 'Общее автозаполнение выключено в настройках — галочка заработает, когда его включат.' }),
      generate,
    ]);

    const form = element('form', { className: 'record-form' });
    const text = element('textarea', { placeholder: 'Один факт — один хедканон. Несколько — каждый с новой строки.', 'aria-label': 'Новые хедканоны' });
    const add = button('Добавить', 'btn primary', () => {});
    add.type = 'submit';
    form.append(text, add);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const texts = text.value.split('\n').map(line => line.trim()).filter(Boolean);
      if (!texts.length) return;
      try {
        const added = await facade.invoke('onAddHeadcanons', { key, texts });
        text.value = '';
        setStatus(added ? `Добавлено хедканонов: ${added}` : 'Такие хедканоны уже есть');
      } catch (error) { setStatus(error?.message || 'Не удалось добавить', true); }
    });

    const list = element('div', { className: 'record-list' });
    for (const item of [...items].reverse()) {
      if (editingHeadcanonId === item.id) {
        const editor = element('form', { className: 'record editing' });
        const input = element('textarea', { value: item.text, 'aria-label': 'Текст хедканона' });
        const save = button('Сохранить', 'btn primary', () => {});
        save.type = 'submit';
        editor.append(input, element('div', { className: 'record-actions' }, [save, button('Отмена', 'btn', () => { editingHeadcanonId = null; render(); })]));
        editor.addEventListener('submit', async event => {
          event.preventDefault();
          try {
            await facade.invoke('onUpdateHeadcanon', { key, id: item.id, text: input.value });
            editingHeadcanonId = null;
            render();
          } catch (error) { setStatus(error?.message || 'Не удалось сохранить', true); }
        });
        list.append(editor);
        continue;
      }
      const enabled = element('input', { type: 'checkbox', checked: item.enabled !== false, 'aria-label': 'Отправлять модели' });
      enabled.addEventListener('change', () => act('onUpdateHeadcanon', { key, id: item.id, enabled: enabled.checked }, 'headcanon-toggle'));
      list.append(element('article', { className: `record headcanon${item.enabled === false ? ' off' : ''}` }, [
        element('div', { className: 'record-head' }, [
          element('label', { className: 'roster-item', title: 'Выключенный хедканон не отправляется модели' }, [enabled, item.enabled === false ? 'выключен' : 'включён']),
          item.pinned ? element('span', { className: 'record-badge pinned', title: 'Отправляется всегда, когда все из этой группы в сцене', text: '📌 закреплён' }) : null,
          element('span', { className: 'record-badge', text: HEADCANON_SOURCES[item.source] ?? 'вручную' }),
          element('time', { text: formatTime(item.createdAt) }),
        ].filter(Boolean)),
        element('p', { className: 'record-text', text: item.text }),
        element('div', { className: 'record-actions' }, [
          button(item.pinned ? '📌 Открепить' : '📌 Закрепить', 'btn', () => act('onUpdateHeadcanon', { key, id: item.id, pinned: !item.pinned }, 'headcanon-pin'),
            item.pinned ? 'Снова отбирать по сцене' : 'Отправлять всегда, когда все из этой группы в сцене: мимо отбора и лимита'),
          button('Вспомнить сейчас', 'btn', async () => {
            try {
              await facade.invoke('onRecallRecord', { text: item.text });
              setStatus('Всплывёт в следующем ответе. Снять можно в шторке над полем ввода.');
            } catch (error) { setStatus(error?.message || 'Не удалось поставить напоминание', true); }
          }, 'Разово: в следующем ответе это всплывёт в сцене'),
          button('Изменить', 'btn', () => { editingHeadcanonId = item.id; render(); }),
          button('Удалить', 'btn', () => act('onRemoveHeadcanon', { key, id: item.id }, 'headcanon-remove')),
        ]),
      ]));
    }
    return element('div', { className: 'records-view' }, [
      head,
      fold('newHeadcanon', '+ Новые хедканоны', '', form),
      element('div', { className: 'card' }, [
        element('div', { className: 'record-list-head' }, [element('h3', { text: 'Хедканоны' }), element('span', { className: 'muted', text: `${items.filter(item => item.enabled !== false).length} из ${items.length} включено` })]),
        items.length ? list : element('div', { className: 'empty', text: 'Хедканонов пока нет.' }),
      ]),
    ]);
  }

  /** Read-only list for the overview card: just the facts, no editing. */
  function openHeadcanonViewer(key) {
    const items = headcanonEntry(key).items ?? [];
    ctx.factorsPairId = null;
    ctx.triangleSetupId = null;
    const sheet = element('div', { className: 'factors-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Хедканоны' });
    const body = element('div', { className: 'factors-body' });
    if (!items.length) body.append(element('p', { className: 'muted', text: 'Хедканонов пока нет.' }));
    for (const item of items) body.append(element('p', { className: `headcanon-view${item.enabled === false ? ' off' : ''}`, text: item.text }));
    const edit = button('Открыть во вкладке', 'btn primary', () => { closeFactors(); openHeadcanonKey = key; ctx.setTab('headcanons'); });
    sheet.append(
      element('div', { className: 'factors-head' }, [element('h3', { text: `Хедканоны: ${key.split('|').map(id => nameOf(id)).join(' & ')}` })]),
      body,
      element('div', { className: 'factors-foot' }, [edit, button('Закрыть', 'btn factors-close', closeFactors)]),
    );
    factorsLayer.replaceChildren(sheet);
    factorsLayer.hidden = false;
    fitFactorsToViewport();
  }

  return { headcanonEntry, headcanonLinePairs, personaPairsFirst, renderHeadcanons, renderHeadcanonPair, openHeadcanonViewer };
}
