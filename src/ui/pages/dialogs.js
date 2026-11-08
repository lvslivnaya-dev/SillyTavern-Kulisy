import { button, element, metricDefinitions, pairId, pairLabel, pairSource, pairTarget } from '../helpers.js';

/**
 * Factor and triangle setup sheets (shown in the factors layer).
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createDialogs(ctx) {
  const { facade, options } = ctx;
  const closeFactors = (...args) => ctx.closeFactors(...args);
  const emit = (...args) => ctx.emit(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  /** One sheet for a triangle: end point, ready-made trope and factors of all its lines. */
  function renderTriangleDialog(triangle, lines) {
    const sheet = element('div', { className: 'factors-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Настройка треугольника' });
    const head = element('div', { className: 'factors-head' }, [element('h3', { text: `Треугольник: ${triangle.name}` })]);
    const body = element('div', { className: 'factors-body' });
    const status = element('p', { className: 'muted factors-status', role: 'status' });
    const setSheetStatus = (message, danger = false) => { status.textContent = message || ''; status.classList.toggle('danger', danger); };
    const lineIds = new Set(lines.map(line => line.relationshipId));
    // Current factors of the triangle's lines (they are the same factors the pair dialog edits).
    const factors = (ctx.snapshot.pairs || []).filter(pair => lineIds.has(pairId(pair)))
      .flatMap(pair => (pair.factors ?? []).map(factor => ({ ...factor, relationshipId: pairId(pair) })));
    const paceByLine = Object.fromEntries((ctx.snapshot.pairs || []).filter(pair => lineIds.has(pairId(pair)) && pair.pace)
      .map(pair => [pairId(pair), { ...pair.pace }]));
    const lineLabel = id => lines.find(line => line.relationshipId === id)?.label ?? id;
    // A line's own trope (set in its card) outranks anything applied from the triangle.
    const ownTrope = id => factors.find(factor => factor.relationshipId === id && factor.origin?.startsWith('pair-trope:'))?.origin;

    const goal = element('textarea', { value: triangle.goal ?? '', rows: 3, placeholder: 'Куда в итоге должны прийти отношения. Например: центр выбирает одного, второй принимает это и остаётся другом.', 'aria-label': 'Конечная точка' });
    const wish = element('input', { type: 'text', placeholder: 'Пожелание для генерации (необязательно)', 'aria-label': 'Пожелание к конечной точке' });
    const generateGoal = button('Сгенерировать цель', 'btn', async () => {
      generateGoal.disabled = true;
      setSheetStatus('Придумываю конечную точку по лору и сценам…');
      try {
        goal.value = await facade.invoke('onGenerateTriangleGoal', { id: triangle.id, wish: wish.value });
        setSheetStatus('Цель предложена — поправьте при желании и нажмите «Сохранить».');
      } catch (error) { setSheetStatus(error?.message || 'Не удалось сгенерировать цель', true); }
      finally { generateGoal.disabled = false; }
    });

    const list = element('div', { className: 'factor-list' });
    function renderRows() {
      list.replaceChildren();
      factors.forEach((factor, index) => {
        const line = element('select', { 'aria-label': 'Линия' });
        for (const item of lines) line.append(element('option', { value: item.relationshipId, text: item.label, selected: item.relationshipId === factor.relationshipId }));
        line.addEventListener('change', () => { factor.relationshipId = line.value; });
        const scale = element('select', { 'aria-label': 'Шкала' });
        for (const definition of metricDefinitions(ctx.snapshot)) scale.append(element('option', { value: definition.key, text: definition.label, selected: definition.key === factor.scaleId }));
        scale.addEventListener('change', () => { factor.scaleId = scale.value; });
        const direction = element('select', { 'aria-label': 'Направление' });
        direction.append(element('option', { value: 'up', text: '+ рост', selected: factor.direction === 'up' }));
        direction.append(element('option', { value: 'down', text: '− падение', selected: factor.direction === 'down' }));
        direction.addEventListener('change', () => { factor.direction = direction.value; });
        const text = element('textarea', { value: factor.text ?? '', 'aria-label': 'Условие', rows: 2 });
        const autoGrow = () => { text.style.height = 'auto'; text.style.height = `${Math.max(44, text.scrollHeight + 4)}px`; };
        text.addEventListener('input', () => { factor.text = text.value; autoGrow(); });
        requestAnimationFrame(autoGrow);
        const remove = button('×', 'btn icon', () => { factors.splice(index, 1); renderRows(); }, 'Удалить фактор');
        list.append(element('div', { className: 'factor-row' }, [
          line,
          element('div', { className: 'factor-controls' }, [scale, direction, remove]),
          text,
          originBadge(factor),
        ].filter(Boolean)));
      });
      if (!factors.length) list.append(element('p', { className: 'muted', text: 'Факторов пока нет.' }));
    }
    renderRows();
    const paceBox = element('div', { className: 'pace-box' });
    // Every line of the triangle gets the same per-scale editor as a single line.
    function renderPace() {
      paceBox.replaceChildren(...lines.map(line => {
        const pair = (ctx.snapshot.pairs || []).find(item => pairId(item) === line.relationshipId);
        return pair ? paceEditor(pair, paceByLine[line.relationshipId] ?? {}, next => {
          paceByLine[line.relationshipId] = next;
          renderPace();
        }, line.label) : null;
      }).filter(Boolean));
    }
    renderPace();
    const addRow = button('+ Добавить фактор', 'btn', () => {
      factors.push({ relationshipId: lines[0]?.relationshipId, scaleId: metricDefinitions(ctx.snapshot)[0]?.key ?? 'trust', direction: 'up', text: '' });
      renderRows();
      list.querySelector('.factor-row:last-child textarea')?.focus();
    });

    // Tropes: triangle tropes (by roles, all lines) and ordinary line tropes (all lines or one).
    const triangleTropeList = facade.invoke('onTriangleTropes', {}) ?? [];
    const pairTropeList = facade.invoke('onPairTropes', {}) ?? [];
    const tropeSelect = element('select', { 'aria-label': 'Троп' });
    const triangleGroup = element('optgroup', { label: 'Тропы треугольника' });
    for (const trope of triangleTropeList) triangleGroup.append(element('option', { value: `t:${trope.id}`, text: trope.label }));
    const pairGroup = element('optgroup', { label: 'Тропы линии' });
    for (const trope of pairTropeList) pairGroup.append(element('option', { value: `p:${trope.id}`, text: trope.label }));
    tropeSelect.append(triangleGroup, pairGroup);
    const targetSelect = element('select', { 'aria-label': 'К каким линиям' });
    targetSelect.append(element('option', { value: '', text: 'Ко всем линиям треугольника' }));
    for (const line of lines) targetSelect.append(element('option', { value: line.relationshipId, text: `Только ${line.label}` }));
    const tropeHint = element('p', { className: 'muted trope-hint' });
    const describeTrope = () => {
      const [kind, id] = tropeSelect.value.split(':');
      const trope = (kind === 't' ? triangleTropeList : pairTropeList).find(item => item.id === id);
      targetSelect.hidden = kind !== 'p';
      tropeHint.textContent = trope ? `${trope.description}${Object.keys(trope.pace ?? {}).length ? ` Темп: ${paceText(trope.pace)}.` : ''}` : '';
    };
    tropeSelect.addEventListener('change', describeTrope);
    describeTrope();
    // The model writes the trope for these three from the lorebook; the template is the fallback.
    const applyTrope = button('Применить троп', 'btn', async () => {
      applyTrope.disabled = true;
      try {
        const [kind, tropeId] = tropeSelect.value.split(':');
        const wanted = kind === 'p' && targetSelect.value ? [targetSelect.value] : lines.map(line => line.relationshipId);
        const skipped = wanted.filter(id => ownTrope(id));
        const targets = new Set(wanted.filter(id => !ownTrope(id)));
        let additions = [];
        let suggestedGoal = '';
        let fallbackNote = '';
        setSheetStatus('Пишу троп под этих персонажей по лорбуку…');
        if (kind === 't') {
          let result;
          try { result = await facade.invoke('onTriangleTropeFromLore', { id: triangle.id, tropeId, goal: goal.value.trim() }); }
          catch (error) {
            fallbackNote = ` Модель не ответила (${error?.message || error}), поставлен шаблон.`;
            result = facade.invoke('onTriangleTropeFactors', { id: triangle.id, tropeId });
          }
          additions = (result?.factors ?? []).filter(factor => targets.has(factor.relationshipId));
          suggestedGoal = result?.goal ?? '';
        } else {
          for (const id of targets) {
            // One request per line: each gets its own characters' lore and names.
            let result;
            try { result = await facade.invoke('onTropeFactorsFromLore', { tropeId, relationshipId: id }); }
            catch (error) {
              fallbackNote = ` Модель не ответила (${error?.message || error}), где-то поставлен шаблон.`;
              result = facade.invoke('onPairTropeFactors', { tropeId, relationshipId: id });
            }
            additions.push(...(result?.factors ?? []).map(factor => ({ ...factor, relationshipId: id, origin: `triangle-trope:${tropeId}` })));
            paceByLine[id] = { ...(result?.pace ?? {}) };
          }
        }
        // Replace earlier triangle-trope factors on the target lines; hand-written ones stay.
        const kept = factors.filter(factor => !(targets.has(factor.relationshipId) && factor.origin?.startsWith('triangle-trope:')));
        factors.splice(0, factors.length, ...kept);
        const added = appendUniqueFactors(factors, additions);
        if (!goal.value.trim() && suggestedGoal) goal.value = suggestedGoal;
        renderRows();
        renderPace();
        const skippedNote = skipped.length
          ? ` Пропущены линии со своим тропом (он важнее): ${skipped.map(id => `${lineLabel(id)} — «${facade.invoke('onTropeLabel', { origin: ownTrope(id) })}»`).join('; ')}. Чтобы сменить им троп, откройте «Факторы роста» линии.`
          : '';
        setSheetStatus(`Добавлено факторов: ${added}${suggestedGoal && goal.value === suggestedGoal ? ', цель подставлена' : ''}.${fallbackNote}${skippedNote} Проверьте и нажмите «Сохранить».`);
      } catch (error) { setSheetStatus(error?.message || 'Не удалось применить троп', true); }
      finally { applyTrope.disabled = false; }
    });

    const generateFactors = button('Сгенерировать факторы (заменит список)', 'btn', async () => {
      generateFactors.disabled = true;
      setSheetStatus('Генерирую факторы для линий треугольника…');
      try {
        const generated = await facade.invoke('onGenerateTriangleFactors', { id: triangle.id, goal: goal.value.trim() });
        // Lines with their own trope keep it untouched; the rest get the generated factors.
        const protectedLines = new Set(lines.map(line => line.relationshipId).filter(id => ownTrope(id)));
        const kept = factors.filter(factor => protectedLines.has(factor.relationshipId));
        factors.splice(0, factors.length, ...kept, ...(generated ?? []).filter(factor => lineIds.has(factor.relationshipId) && !protectedLines.has(factor.relationshipId)));
        renderRows();
        setSheetStatus(`Сгенерировано факторов: ${factors.length - kept.length}${protectedLines.size ? `; линии со своим тропом не тронуты: ${protectedLines.size}` : ''}. Проверьте и нажмите «Сохранить».`);
      } catch (error) { setSheetStatus(error?.message || 'Не удалось сгенерировать факторы', true); }
      finally { generateFactors.disabled = false; }
    });

    const save = button('Сохранить', 'btn primary', async () => {
      save.disabled = true;
      try {
        await facade.invoke('onSetTriangleGoal', { id: triangle.id, goal: goal.value });
        await facade.invoke('onSetTriangleFactors', { id: triangle.id, factors: factors.filter(factor => String(factor.text ?? '').trim()), paceByLine });
        setStatus('Треугольник сохранён');
        closeFactors();
      } catch (error) {
        setSheetStatus(error?.message || 'Не удалось сохранить треугольник', true);
      } finally { save.disabled = false; }
    });
    const close = button('Закрыть', 'btn factors-close', closeFactors);

    body.append(
      element('h4', { className: 'sheet-section', text: 'Конечная точка' }),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 6px' }, text: 'Её видят анализатор и модель — как далёкое направление сюжета, а не задачу на ближайший ответ.' }),
      goal,
      element('div', { className: 'factors-generate-row', style: { marginTop: '6px' } }, [wish, generateGoal]),
      element('h4', { className: 'sheet-section', text: 'Готовый троп' }),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 6px' }, text: 'Троп треугольника расписан по ролям сразу на все линии. Троп линии можно поставить на все линии или на одну. Линии, у которых в карточке уже стоит свой троп, пропускаются — он важнее.' }),
      element('div', { className: 'factors-generate-row' }, [tropeSelect, targetSelect, applyTrope]),
      tropeHint,
      element('h4', { className: 'sheet-section', text: 'Факторы по линиям' }),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 8px' }, text: 'Это те же факторы, что и в окне «Факторы роста» каждой линии: здесь они собраны для всего треугольника.' }),
      list, addRow, paceBox,
      element('div', { className: 'factors-generate' }, [
        element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Автогенерация учитывает конечную точку, лор подключённых книг и общие сцены троих.' }),
        generateFactors,
      ]),
      status,
    );
    sheet.append(head, body, element('div', { className: 'factors-foot' }, [save, close]));
    return sheet;
  }

  const paceEditorOpen = new Set(); // lines whose pace editor is unfolded

  function scaleLabel(scaleId) {
    return metricDefinitions(ctx.snapshot).find(definition => definition.key === scaleId)?.label ?? scaleId;
  }

  function paceText(pace) {
    return Object.entries(pace ?? {}).map(([scaleId, value]) => `${scaleLabel(scaleId).toLocaleLowerCase('ru-RU')} — ${value === 'slow' ? 'медленно' : 'быстро'}`).join(', ');
  }

  /** "Pace: …" line with a reset button; empty when the line has no pace. */
  function paceControls(pace, onReset, prefix = 'Темп') {
    if (!Object.keys(pace ?? {}).length) return [];
    return [
      element('span', { text: `${prefix}: ${paceText(pace)}. «Медленно» — не больше ±2 за ответ, «быстро» — изменения ×1,5.` }),
      button('Сбросить темп', 'btn', onReset),
    ];
  }

  /**
   * Pace of each scale of one line, by hand: обычно / медленно / быстро.
   * Folded by default; the summary says what is set. A trope fills it too.
   */
  function paceEditor(pair, pace, onChange, lineLabel = '') {
    const box = element('details', { className: 'pace-editor' });
    const key = pairId(pair);
    box.open = paceEditorOpen.has(key);
    box.addEventListener('toggle', () => { if (box.open) paceEditorOpen.add(key); else paceEditorOpen.delete(key); });
    const set = Object.keys(pace ?? {}).length;
    const head = lineLabel ? `Темп ${lineLabel}` : 'Темп шкал';
    box.append(element('summary', { text: set ? `${head}: ${paceText(pace)}` : `${head}: везде обычный` }));
    box.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '4px 0' }, text: '«Медленно» — не больше ±2 за ответ, «быстро» — изменения ×1,5. Действует поверх темпа чата (Настройки → Отношения).' }));
    const grid = element('div', { className: 'pace-grid' });
    for (const definition of metricDefinitions(ctx.snapshot, pair)) {
      const select = element('select', { 'aria-label': `Темп: ${definition.label}` },
        [['', 'обычно'], ['slow', 'медленно'], ['fast', 'быстро']].map(([value, text]) => element('option', { value, text, selected: (pace?.[definition.key] ?? '') === value })));
      select.addEventListener('change', () => {
        const next = { ...(pace ?? {}) };
        if (select.value) next[definition.key] = select.value; else delete next[definition.key];
        onChange(next);
      });
      grid.append(element('label', { className: 'pace-cell' }, [element('span', { text: definition.label }), select]));
    }
    box.append(grid);
    if (set) box.append(button('Сбросить темп', 'btn small', () => onChange({})));
    return box;
  }

  /** Small note under a factor that came from a trope. */
  function originBadge(factor) {
    if (!factor.origin) return null;
    const label = facade.invoke('onTropeLabel', { origin: factor.origin }) || 'троп';
    return element('span', { className: 'factor-origin', text: factor.origin.startsWith('pair-trope:') ? `троп линии: ${label}` : `троп треугольника: ${label}` });
  }

  /** Append factors that are not in the list yet (same line, scale, direction and text). Returns how many were added. */
  function appendUniqueFactors(list, additions) {
    const key = factor => `${factor.relationshipId ?? ''}|${factor.scaleId}|${factor.direction}|${String(factor.text).trim().toLocaleLowerCase('ru-RU')}`;
    const seen = new Set(list.map(key));
    let added = 0;
    for (const factor of additions) {
      if (seen.has(key(factor))) continue;
      seen.add(key(factor));
      list.push({ ...factor });
      added += 1;
    }
    return added;
  }

  function renderFactorsDialog(pair) {
    const sheet = element('div', { className: 'factors-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Факторы роста' });
    const factors = [...(pair.factors ?? [])].map(factor => ({ ...factor }));
    let pace = { ...(pair.pace ?? {}) };
    const head = element('div', { className: 'factors-head' }, [
      element('h3', { text: `Факторы роста: ${pairLabel(ctx.snapshot, pair)}` }),
    ]);
    const body = element('div', { className: 'factors-body' });
    const status = element('p', { className: 'muted factors-status', role: 'status' });
    const setSheetStatus = (message, danger = false) => { status.textContent = message || ''; status.classList.toggle('danger', danger); };
    body.append(element('p', { className: 'muted', style: { fontSize: '11px', marginTop: '0' }, text: 'От чего растут или падают чувства первого ко второму: что делает второй и что происходит между ними. Не то, что должен делать первый. Факторы передаются анализатору: сцена, совпавшая с фактором, двигает шкалу в выбранную сторону.' }));

    // End point of THIS directed line. The reverse line is a separate object with its own.
    const lineName = pairLabel(ctx.snapshot, pair);
    const goalField = element('textarea', { value: pair.goal ?? '', rows: 2, className: 'goal-field', 'aria-label': `Конечная точка линии ${lineName}`, placeholder: 'К чему в итоге придёт эта линия. Например: признаёт её равной и перестаёт опекать' });
    const goalWish = element('input', { type: 'text', placeholder: 'Пожелание для подсказки (необязательно)', 'aria-label': 'Пожелание к конечной точке' });
    const goalGenerate = button('Предложить', 'btn', async () => {
      goalGenerate.disabled = true;
      setSheetStatus('Подбираю конечную точку по лору и сценам…');
      try {
        const goal = await facade.invoke('onGeneratePairGoal', { sourceId: pairSource(pair), targetId: pairTarget(pair), wish: goalWish.value.trim() });
        if (goal) goalField.value = goal;
        setSheetStatus('Конечная точка предложена. Поправьте и нажмите «Сохранить».');
      } catch (error) {
        setSheetStatus(error?.message || 'Не удалось предложить конечную точку', true);
      } finally { goalGenerate.disabled = false; }
    });
    body.append(element('div', { className: 'factors-generate goal-box' }, [
      element('p', { className: 'section-title', style: { margin: '0 0 6px' }, text: 'Конечная точка' }),
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0 0 6px' }, text: `Куда в итоге должна прийти именно линия ${lineName}. Обратное направление — отдельная линия со своей точкой. Модель получает её как далёкий ориентир: без спешки и только через события сюжета.` }),
      goalField,
      element('div', { className: 'factors-generate-row' }, [goalWish, goalGenerate]),
    ]));

    // How the model read these two for the last generated factors: the proof it analysed, not copied.
    const analysisBox = element('details', { className: 'factor-analysis' });
    const renderAnalysis = analysis => {
      analysisBox.hidden = !analysis;
      if (!analysis) return;
      analysisBox.replaceChildren(
        element('summary', { text: 'Как модель поняла персонажей' }),
        ...[['Чьи чувства', analysis.subject], ['К кому', analysis.object], ['Между ними', analysis.dynamic]]
          .filter(([, text]) => text).map(([label, text]) => element('p', {}, [element('b', { text: `${label}: ` }), text])),
      );
    };
    renderAnalysis(ctx.snapshot.ui?.analyses?.[pairId(pair)] ?? null);
    body.append(analysisBox);

    const list = element('div', { className: 'factor-list' });
    function renderRows() {
      list.replaceChildren();
      factors.forEach((factor, index) => {
        const scale = element('select', { 'aria-label': 'Шкала' });
        for (const definition of metricDefinitions(ctx.snapshot, pair)) scale.append(element('option', { value: definition.key, text: definition.label, selected: definition.key === factor.scaleId }));
        scale.addEventListener('change', () => { factor.scaleId = scale.value; });
        const direction = element('select', { 'aria-label': 'Направление' });
        direction.append(element('option', { value: 'up', text: '+ рост', selected: factor.direction === 'up' }));
        direction.append(element('option', { value: 'down', text: '− падение', selected: factor.direction === 'down' }));
        direction.addEventListener('change', () => { factor.direction = direction.value; });
        const text = element('textarea', { value: factor.text ?? '', 'aria-label': 'Условие', placeholder: 'Например: Судзу держит слово, даже когда ей невыгодно', rows: 2 });
        const hits = ctx.snapshot.factorHits?.[pairId(pair)]?.[String(factor.text ?? '').trim()] ?? 0;
        const autoGrow = () => { text.style.height = 'auto'; text.style.height = `${Math.max(44, text.scrollHeight + 4)}px`; };
        text.addEventListener('input', () => { factor.text = text.value; autoGrow(); });
        requestAnimationFrame(autoGrow);
        const remove = button('×', 'btn icon', () => { factors.splice(index, 1); renderRows(); }, 'Удалить фактор');
        list.append(element('div', { className: 'factor-row' }, [
          element('div', { className: 'factor-controls' }, [scale, direction, remove]),
          text,
          element('span', { className: `factor-hits${hits ? ' on' : ''}`, text: hits ? `сработал: ${hits}` : 'ещё не срабатывал', title: 'Сколько раз анализатор изменил шкалу, сославшись на этот фактор (по журналу чата)' }),
          originBadge(factor),
        ].filter(Boolean)));
      });
      if (!factors.length) list.append(element('p', { className: 'muted', text: 'Факторов пока нет.' }));
    }
    renderRows();
    const paceBox = element('div', { className: 'pace-box' });
    const renderPace = () => paceBox.replaceChildren(paceEditor(pair, pace, next => { pace = next; renderPace(); }));
    renderPace();

    const addRow = button('+ Добавить фактор', 'btn', () => {
      factors.push({ scaleId: metricDefinitions(ctx.snapshot, pair)[0]?.key ?? 'trust', direction: 'up', text: '' });
      renderRows();
      list.querySelector('.factor-row:last-child textarea')?.focus();
    });

    const directionSelect = element('select', { 'aria-label': 'Направление развития' });
    const presets = options.directionPresets ? options.directionPresets() : [
      { id: 'romance', label: 'Романтика' }, { id: 'friendship', label: 'Дружба' },
      { id: 'rivalry', label: 'Вражда' }, { id: 'obsession', label: 'Одержимость' },
      { id: 'fear', label: 'Страх' }, { id: 'custom', label: 'Своё направление' },
    ];
    for (const preset of presets) directionSelect.append(element('option', { value: preset.id, text: preset.label }));
    const customDirection = element('input', { type: 'text', placeholder: 'Опишите желаемое направление развития', 'aria-label': 'Своё направление' });
    const generate = button('Сгенерировать по персонажу', 'btn', async () => {
      generate.disabled = true;
      setSheetStatus('Генерирую факторы по лору и сценам…');
      try {
        await facade.invoke('onGenerateFactors', {
          sourceId: pairSource(pair), targetId: pairTarget(pair),
          directionId: directionSelect.value, customDirection: customDirection.value, replace: true,
          // Generation closes the sheet: the end point typed so far is saved with the factors.
          goal: goalField.value,
        });
        emit('factors-generate', {});
        setStatus('Факторы сгенерированы');
        closeFactors();
      } catch (error) {
        setSheetStatus(error?.message || 'Не удалось сгенерировать факторы', true);
      } finally { generate.disabled = false; }
    });
    const save = button('Сохранить', 'btn primary', async () => {
      save.disabled = true;
      try {
        await facade.invoke('onSetFactors', {
          sourceId: pairSource(pair), targetId: pairTarget(pair),
          factors: factors.filter(factor => String(factor.text ?? '').trim()),
          pace,
          goal: goalField.value,
        });
        emit('factors-save', {});
        setStatus('Факторы сохранены');
        closeFactors();
      } catch (error) {
        setSheetStatus(error?.message || 'Не удалось сохранить факторы', true);
      } finally { save.disabled = false; }
    });
    const close = button('Закрыть', 'btn factors-close', closeFactors);

    // Ready-made tropes: prewritten factors, no model request. A line's own trope replaces
    // factors of any previous trope (its own or a triangle's); hand-written ones stay.
    const tropes = facade.invoke('onPairTropes', {}) ?? [];
    const tropeSelect = element('select', { 'aria-label': 'Готовый троп' });
    for (const trope of tropes) tropeSelect.append(element('option', { value: trope.id, text: trope.label }));
    const tropeHint = element('p', { className: 'muted trope-hint' });
    const describeTrope = () => {
      const trope = tropes.find(item => item.id === tropeSelect.value);
      tropeHint.textContent = trope ? `${trope.description}${Object.keys(trope.pace ?? {}).length ? ` Темп: ${paceText(trope.pace)}.` : ''}` : '';
    };
    tropeSelect.addEventListener('change', describeTrope);
    describeTrope();
    const putTrope = (result, note) => {
      const kept = factors.filter(factor => !factor.origin);
      const replaced = factors.length - kept.length;
      factors.splice(0, factors.length, ...kept);
      const added = appendUniqueFactors(factors, result?.factors ?? []);
      pace = { ...(result?.pace ?? {}) };
      renderRows();
      renderPace();
      setSheetStatus(`${note}Добавлено факторов: ${added}${replaced ? `, факторы прежнего тропа убраны: ${replaced}` : ''}. Ручные факторы сохранены. Проверьте и нажмите «Сохранить».`);
    };
    const ids = { tropeId: '', sourceId: pairSource(pair), targetId: pairTarget(pair) };
    // The trope is written for these two by the model, from the lorebook; the template is the fallback.
    const addTrope = button('Поставить троп', 'btn', async () => {
      addTrope.disabled = true;
      setSheetStatus('Пишу троп под этих персонажей по лорбуку…');
      try {
        const result = await facade.invoke('onTropeFactorsFromLore', { ...ids, tropeId: tropeSelect.value });
        renderAnalysis(result?.analysis ?? null);
        putTrope(result, 'Троп написан по разбору персонажей (раскройте «Как модель поняла персонажей»). ');
      } catch (error) {
        try {
          putTrope(facade.invoke('onPairTropeFactors', { ...ids, tropeId: tropeSelect.value }), `Модель не ответила (${error?.message || error}), поставлен шаблон тропа. `);
        } catch (fallback) { setSheetStatus(fallback?.message || 'Не удалось поставить троп', true); }
      } finally { addTrope.disabled = false; }
    }, 'Модель пишет факторы тропа под этих двоих: по их характерам в лорбуке и сценам');
    const addTemplate = button('Шаблон', 'btn small', () => {
      try { putTrope(facade.invoke('onPairTropeFactors', { ...ids, tropeId: tropeSelect.value }), 'Шаблон тропа без модели. '); }
      catch (error) { setSheetStatus(error?.message || 'Не удалось поставить троп', true); }
    }, 'Заранее написанные факторы тропа, без запроса к модели');

    body.append(
      list, addRow, paceBox,
      element('div', { className: 'factors-generate' }, [
        element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Готовый троп: заранее прописанные факторы без запроса к модели. Заменяет факторы прежнего тропа, ручные остаются. Троп линии важнее тропа треугольника.' }),
        element('div', { className: 'factors-generate-row' }, [tropeSelect, addTrope, addTemplate]),
        tropeHint,
      ]),
      element('div', { className: 'factors-generate' }, [
        element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Автогенерация: учитывает лорбук этих персонажей (их анкеты и общие записи), сцены с обоими и конечную точку линии. «Своё направление» — впишите текстом.' }),
        element('div', { className: 'factors-generate-row' }, [directionSelect, customDirection, generate]),
      ]),
      status,
    );
    sheet.append(head, body, element('div', { className: 'factors-foot' }, [save, close]));
    return sheet;
  }

  return { renderTriangleDialog, scaleLabel, paceText, paceControls, originBadge, appendUniqueFactors, renderFactorsDialog };
}
