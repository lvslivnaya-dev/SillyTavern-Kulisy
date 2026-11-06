import { button, clamp, element, metricDefinitions, nextControlId, pairId, pairLabel, pairSource, pairTarget, visibleMetricDefinitions } from '../helpers.js';

/**
 * All relationship lines: cards, scales, bulk removal.
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createOverviewPage(ctx) {
  const { facade } = ctx;
  const act = (...args) => ctx.act(...args);
  const openFactors = (...args) => ctx.openFactors(...args);
  const openHeadcanonViewer = (...args) => ctx.openHeadcanonViewer(...args);
  const render = (...args) => ctx.render(...args);
  const renderCharacterManager = (...args) => ctx.renderCharacterManager(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  // Overview sections; character-to-character lines start collapsed to keep the screen clean.
  const folds = { characters: false, personaLines: true, characterLines: false, allLines: true, newMemory: false, newTension: false, newHeadcanon: true };
  let scaleEditorPairId = null; // overview card whose scale checklist is open
  let selectedPairs = new Set(); // overview lines ticked for bulk removal

  function fold(key, title, note, body, actions = null) {
    const details = element('details', { className: 'fold' });
    details.open = folds[key];
    details.addEventListener('toggle', () => { folds[key] = details.open; });
    const summary = element('summary', { text: title });
    if (note) summary.append(element('span', { className: 'muted', text: note }));
    if (actions) summary.append(element('span', { className: 'fold-actions' }, [actions]));
    details.append(summary, element('div', { className: 'fold-body' }, [body]));
    return details;
  }

  /** Trash button in a section header: removes the selected lines of that section. */
  function bulkRemoveButton(pairs) {
    const ids = pairs.map(pair => pairId(pair)).filter(id => selectedPairs.has(id));
    const trash = button(ids.length ? `🗑 ${ids.length}` : '🗑', 'icon bulk-trash', async event => {
      // The button sits inside <summary>: keep the click from folding the section.
      event.preventDefault();
      event.stopPropagation();
      if (!ids.length) return;
      try {
        const removed = await facade.invoke('onRemovePairsBulk', { relationshipIds: ids });
        if (removed) {
          for (const id of ids) selectedPairs.delete(id);
          setStatus(`Удалено линий: ${ids.length}`);
          render();
        }
      } catch (error) { setStatus(error?.message || 'Не удалось удалить линии', true); }
    }, ids.length ? `Удалить выбранные линии: ${ids.length}` : 'Отметьте линии галочкой, чтобы удалить их');
    trash.disabled = !ids.length;
    return trash;
  }

  function renderAllRelationships() {
    const container = element('div', { style: { display: 'grid', gap: '16px' } });
    const characterCount = (ctx.snapshot.characters || []).length;
    container.append(fold('characters', 'Персонажи', `· ${characterCount}`, renderCharacterManager()));
    const pairs = ctx.snapshot.pairs || [];
    if (!pairs.length) {
      container.append(element('p', { className: 'empty', text: 'Пока нет связей: выберите пару в левой панели или запустите анализ истории.' }));
      return container;
    }
    // Forget selections of lines that no longer exist.
    selectedPairs = new Set([...selectedPairs].filter(id => pairs.some(pair => pairId(pair) === id)));
    const personaId = ctx.snapshot.personaId || ctx.snapshot.ui?.personaId || '';
    if (!personaId) {
      container.append(fold('allLines', 'Линии отношений', `· ${pairs.length}`, renderPairCards(pairs), bulkRemoveButton(pairs)));
      return container;
    }
    const withPersona = pairs.filter(pair => pairTarget(pair) === personaId);
    const between = pairs.filter(pair => pairTarget(pair) !== personaId);
    container.append(
      fold('personaLines', 'Линии с персоной', `· ${withPersona.length}`, withPersona.length
        ? renderPairCards(withPersona) : element('p', { className: 'empty', text: 'Пока никто не испытывает чувств к персоне.' }), bulkRemoveButton(withPersona)),
      fold('characterLines', 'Линии между персонажами', `· ${between.length}`, between.length
        ? renderPairCards(between) : element('p', { className: 'empty', text: 'Линий между персонажами пока нет.' }), bulkRemoveButton(between)),
    );
    return container;
  }

  function renderPairCards(pairs) {
    const grid = element('div', { className: 'relationship-cards', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,350px),1fr))', gap: '16px' } });
    for (const pair of pairs) {
      const hiddenFromWidget = (ctx.snapshot.ui?.hiddenRelationshipIds ?? []).includes(pairId(pair));
      const editingScales = scaleEditorPairId === pairId(pair);
      const hiddenCount = (pair.hiddenScales ?? []).length;
      const strangerKey = [pairSource(pair), pairTarget(pair)].sort().join('|');
      // Who has met whom now lives in the character dossiers (Персонажи → Знакомства).
      // Headcanons belong to the unordered pair, the same key as strangers.
      const headcanonCount = (ctx.snapshot.ui?.headcanons?.[strangerKey]?.items ?? []).length;
      const autoHeadInput = element('input', { type: 'checkbox', checked: Boolean(facade.invoke('onAutoHeadcanons', { key: strangerKey })) });
      autoHeadInput.addEventListener('change', () => act('onSetHeadcanonAuto', { key: strangerKey, auto: autoHeadInput.checked }, 'headcanon-auto'));
      const autoHead = element('label', { className: 'strangers-toggle', title: 'Автозаполнение хедканонов этой пары по ходу игры' }, [autoHeadInput, 'Авто-хедканоны']);
      const isSelected = selectedPairs.has(pairId(pair));
      const selectInput = element('input', { type: 'checkbox', checked: isSelected, className: 'pair-select', 'aria-label': `Выбрать линию ${pairLabel(ctx.snapshot, pair)}` });
      selectInput.addEventListener('change', () => {
        if (selectInput.checked) selectedPairs.add(pairId(pair)); else selectedPairs.delete(pairId(pair));
        render();
      });
      // Corner icons: the eye is crossed out while the line is hidden from the widget.
      const eye = button('👁', `icon eye-toggle${hiddenFromWidget ? ' off' : ''}`, () => act('onToggleWidgetPair', { relationshipId: pairId(pair) }, 'widget-pair-toggle'),
        hiddenFromWidget ? 'Не показывается в виджете — показать' : 'Показывается в виджете — скрыть');
      eye.setAttribute('aria-pressed', String(!hiddenFromWidget));
      const removeLine = button('×', 'icon remove-line', () => act('onRemovePair', {
        sourceId: pairSource(pair), targetId: pairTarget(pair),
      }, 'pair-remove'), 'Удалить линию');
      const card = element('article', { className: `card relationship-card${isSelected ? ' selected' : ''}` }, [
        element('div', { className: 'card-corner' }, [eye, removeLine]),
        element('div', { className: 'pair-card-head' }, [
          element('label', { className: 'pair-title', title: 'Отметить для удаления' }, [selectInput, element('h3', { text: pairLabel(ctx.snapshot, pair) })]),
        ]),
        editingScales ? renderScaleEditor(pair) : renderOverview(pair),
        element('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--rs-line)' } }, [
          button('Факторы роста', 'btn', () => openFactors(pairId(pair))),
          button(`Хедканоны (${headcanonCount})`, 'btn', () => openHeadcanonViewer(strangerKey), 'Посмотреть хедканоны этой пары'),
          button(editingScales ? 'Готово' : `Шкалы${hiddenCount ? ` (скрыто ${hiddenCount})` : ''}`, editingScales ? 'btn primary' : 'btn', () => {
            scaleEditorPairId = editingScales ? null : pairId(pair);
            render();
          }, 'Выбрать, какие шкалы есть у этой линии'),
        ]),
        element('div', { className: 'pair-flags' }, [autoHead]),
      ]);
      grid.append(card);
    }
    return grid;
  }

  /** Per-line scale visibility: hidden scales are not shown, sent to the model or changed by analysis. */
  function renderScaleEditor(pair) {
    const hidden = new Set(pair.hiddenScales ?? []);
    const definitions = metricDefinitions(ctx.snapshot, pair);
    const box = element('div', { className: 'scale-editor' }, [
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 8px' }, text: 'Отметьте шкалы, которые нужны этой линии. Скрытые шкалы не показываются, не отправляются модели и не меняются анализом. Значения сохраняются — шкалу можно вернуть.' }),
    ]);
    const list = element('div', { className: 'scale-editor-list' });
    for (const definition of definitions) {
      const input = element('input', { type: 'checkbox', checked: !hidden.has(definition.key) });
      input.addEventListener('change', async () => {
        const next = new Set(hidden);
        if (input.checked) next.delete(definition.key); else next.add(definition.key);
        if (next.size >= definitions.length) {
          input.checked = true;
          setStatus('Хотя бы одна шкала должна остаться', true);
          return;
        }
        try { await act('onSetHiddenScales', { relationshipId: pairId(pair), hiddenScales: [...next] }, 'scales-hide'); }
        catch (error) { input.checked = !input.checked; setStatus(error?.message || 'Не удалось изменить шкалы', true); }
      });
      list.append(element('label', { className: 'scale-editor-item' }, [input, definition.label]));
    }
    box.append(list);
    return box;
  }

  function renderOverview(pair) {
    const metrics = element('div', { className: 'card' }, [element('h3', { text: 'Показатели отношений' })]);
    const values = pair.metrics || pair.scales || {};
    for (const definition of visibleMetricDefinitions(ctx.snapshot, pair)) {
      const value = Number(values[definition.key] ?? definition.default ?? 0);
      const range = element('input', { id: nextControlId('rs-metric'), type: 'range', min: definition.min, max: definition.max, step: definition.step || 1, value });
      const output = element('output', { text: value });
      range.addEventListener('input', () => { output.textContent = range.value; });
      range.addEventListener('change', () => act('onMetricChange', {
        pairId: pairId(pair), sourceId: pairSource(pair), targetId: pairTarget(pair), metric: definition.key,
        value: clamp(range.value, Number(definition.min), Number(definition.max)), previousValue: value,
      }, 'metric-change'));
      metrics.append(element('div', { className: 'metric' }, [element('label', { text: definition.label, htmlFor: range.id }), range, output]));
    }
    return element('div', { className: 'grid' }, [metrics]);
  }

  return { fold, bulkRemoveButton, renderAllRelationships, renderPairCards, renderScaleEditor, renderOverview };
}
