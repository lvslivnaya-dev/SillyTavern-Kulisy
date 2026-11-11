import { button, characterId, characterName, element, formatTime, nextControlId, pairId, pairLabel, pairSource, pairTarget, themedSelect } from '../helpers.js';
import { collectRecords, filterRecords } from '../../core/records.js';

/**
 * Memories and tensions: shared and per-line records.
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createRecordsPage(ctx) {
  const { facade } = ctx;
  const act = (...args) => ctx.act(...args);
  const fold = (...args) => ctx.fold(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  let recordFilter = {};
  let editingRecordId = null; // memory/tension shown as an inline editor

  /** One-off cue for the next reply. */
  async function recall(text) {
    try {
      await facade.invoke('onRecallRecord', { text });
      setStatus('Всплывёт в следующем ответе. Снять можно в шторке над полем ввода.');
    } catch (error) { setStatus(error?.message || 'Не удалось поставить напоминание', true); }
  }

  function nameOf(id) {
    return characterName((ctx.snapshot.characters || []).find(character => characterId(character) === id), id);
  }

  /** Checkbox list of characters; `locked` ids are checked and disabled (participants always know). */
  function makeRoster(legendText, selectedIds = []) {
    const box = element('div', { className: 'roster' });
    box.append(element('p', { className: 'muted roster-legend', text: legendText }));
    const list = element('div', { className: 'roster-list' });
    for (const character of ctx.snapshot.characters || []) {
      const input = element('input', { type: 'checkbox', value: characterId(character), checked: selectedIds.includes(characterId(character)) });
      list.append(element('label', { className: 'roster-item' }, [input, characterName(character)]));
    }
    box.append(list);
    const checked = () => [...list.querySelectorAll('input:checked')].map(input => input.value);
    return { box, list, checked };
  }

  /** Keep "who knows" consistent with participants: participants are checked and locked. */
  function linkRosters(participants, knownBy) {
    const sync = () => {
      const selected = participants.checked();
      for (const input of knownBy.list.querySelectorAll('input')) {
        if (selected.includes(input.value)) { input.checked = true; input.disabled = true; }
        else input.disabled = false;
      }
    };
    participants.list.addEventListener('change', sync);
    sync();
  }

  function intensityControl(value = 3) {
    const input = element('input', { id: nextControlId('rs-intensity'), type: 'range', min: 1, max: 5, value, 'aria-label': 'Интенсивность' });
    const output = element('output', { text: String(value) });
    input.addEventListener('input', () => { output.textContent = input.value; });
    const row = element('div', { className: 'metric' }, [element('label', { text: 'Интенсивность', htmlFor: input.id }), input, output]);
    row.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '2px 0 0', gridColumn: '1 / -1' }, text: '1 — фон, почти не влияет; 3 — заметно; 5 — определяет поведение' }));
    return { input, row };
  }

  function renderCollection(pair, type) {
    const singular = type === 'memories' ? 'воспоминание' : 'напряжение';
    const all = collectRecords(ctx.snapshot, type);

    // Filters: one dropdown for a character, one for a line that actually has records of this kind.
    const characterOptions = [{ value: '', label: 'Все персонажи' }, ...(ctx.snapshot.characters || []).map(character => ({ value: characterId(character), label: characterName(character) }))];
    const lines = (ctx.snapshot.pairs || []).filter(relation => filterRecords(all, { relationshipId: pairId(relation), pairIds: [pairSource(relation), pairTarget(relation)] }).length);
    const lineOptions = [{ value: '', label: 'Все линии' }, ...lines.map(relation => ({ value: pairId(relation), label: pairLabel(ctx.snapshot, relation) }))];
    if (recordFilter.relationshipId && !lines.some(relation => pairId(relation) === recordFilter.relationshipId)) {
      recordFilter = { characterId: recordFilter.characterId };
    }
    const characterFilter = themedSelect({
      options: characterOptions, value: recordFilter.characterId || '', label: 'Фильтр по персонажу',
      onChange: value => { recordFilter = { ...recordFilter, characterId: value || undefined }; render(); },
    });
    const lineFilter = themedSelect({
      options: lineOptions, value: recordFilter.relationshipId || '', label: 'Фильтр по линии',
      onChange: value => {
        const relation = lines.find(item => pairId(item) === value);
        recordFilter = { characterId: recordFilter.characterId, ...(relation ? { relationshipId: value, pairIds: [pairSource(relation), pairTarget(relation)] } : {}) };
        render();
      },
    });
    const filters = element('div', { className: 'record-filters' }, [
      element('div', { className: 'field' }, [element('label', { text: 'Персонаж' }), characterFilter]),
      element('div', { className: 'field' }, [element('label', { text: 'Линия' }), lineFilter]),
    ]);

    // New record: folded by default so the list gets the screen.
    const form = element('form', { className: 'record-form' });
    const text = element('textarea', { placeholder: `Опишите ${singular}…`, required: true, 'aria-label': `Текст: ${singular}` });
    const participants = makeRoster('Участники (никто не выбран — общее для чата)');
    const knownBy = makeRoster('Кому ещё известно (участники знают всегда; остальные не должны упоминать)');
    linkRosters(participants, knownBy);
    const intensity = intensityControl(3);
    const submit = button(`Добавить ${singular}`, 'btn primary', () => {});
    submit.type = 'submit';
    form.append(text, participants.box, knownBy.box, intensity.row, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!text.value.trim()) return;
      act(type === 'memories' ? 'onAddMemory' : 'onAddTension', {
        participantIds: participants.checked(), knownBy: knownBy.checked(),
        text: text.value.trim(), intensity: Number(intensity.input.value),
      }, type === 'memories' ? 'memory-add' : 'tension-add');
      text.value = '';
    });
    const foldKey = type === 'memories' ? 'newMemory' : 'newTension';

    const records = filterRecords(all, recordFilter);
    const heading = type === 'memories' ? 'Воспоминания' : 'Активные напряжения';
    const list = element('div', { className: 'card' }, [
      element('div', { className: 'record-list-head' }, [element('h3', { text: heading }), element('span', { className: 'muted', text: `${records.length} из ${all.length}` })]),
      filters,
      renderRecords(records, type),
    ]);
    return element('div', { className: 'records-view' }, [fold(foldKey, `+ Новое ${singular}`, '', form), list]);
  }

  function renderRecords(items, type) {
    if (!items.length) return element('div', { className: 'empty', text: 'Здесь пока ничего нет.' });
    const kind = type === 'memories' ? 'memory' : 'tension';
    const stack = element('div', { className: 'record-list' });
    // Newest first, like the history ctx.tab.
    for (const item of [...items].reverse()) {
      const owner = { kind, shared: !item.relationshipId, relationshipId: item.relationshipId ?? undefined, itemId: item.id };
      if (editingRecordId === item.id) { stack.append(renderRecordEditor(item, owner)); continue; }
      const intensity = Math.max(0, Math.min(5, Number(item.intensity) || 0));
      const participantIds = item.participantIds ?? [];
      const knownBy = item.knownBy ?? participantIds;
      const secret = knownBy.length !== participantIds.length || knownBy.some(id => !participantIds.includes(id))
        || (participantIds.length && (ctx.snapshot.characters || []).some(character => !knownBy.includes(characterId(character))));
      const extraKnown = knownBy.filter(id => !participantIds.includes(id));
      const article = element('article', { className: `record${item.disabled ? ' off' : ''}` }, [
        element('div', { className: 'record-head' }, [
          intensity ? element('span', { className: 'record-intensity', title: `Интенсивность ${intensity}/5`, text: '●'.repeat(intensity) + '○'.repeat(5 - intensity) }) : null,
          item.pinned ? element('span', { className: 'record-badge pinned', title: 'Отправляется всегда, мимо отбора и лимита', text: '📌 закреплено' }) : null,
          item.disabled ? element('span', { className: 'record-badge', text: 'отключено' }) : null,
          element('time', { text: formatTime(item.timestamp || item.createdAt || item.date) }),
        ].filter(Boolean)),
        element('p', { className: 'record-text', text: item.text || item.description || item.content || String(item) }),
        element('div', { className: 'record-people' }, participantIds.length
          ? participantIds.map(id => element('span', { className: 'chip', text: nameOf(id) }))
          : [element('span', { className: 'chip', text: 'Общее для чата' })]),
        ...(secret && participantIds.length ? [element('p', { className: 'record-secret', text: extraKnown.length
          ? `Знают также: ${extraKnown.map(nameOf).join(', ')}. Остальные не в курсе.`
          : 'Знают только участники.' })] : []),
      ]);
      const controls = element('div', { className: 'record-actions' }, [
        button(item.pinned ? '📌 Открепить' : '📌 Закрепить', 'btn', () => act('onUpdateRecord', { ...owner, changes: { pinned: !item.pinned } }, 'record-pin'),
          item.pinned ? 'Снова отбирать как обычную запись' : 'Отправлять всегда: мимо отбора по свежести и мимо лимита'),
        button('Вспомнить сейчас', 'btn', () => recall(item.text), 'Разово: в следующем ответе это всплывёт в сцене'),
        button('Изменить', 'btn', () => { editingRecordId = item.id; render(); }, 'Изменить текст, участников, кому известно и интенсивность'),
        button(item.disabled ? 'Включить' : 'Отключить', 'btn', () => act('onToggleRecord', { ...owner, disabled: !item.disabled }, 'record-toggle'),
          item.disabled ? 'Включить запись' : 'Отключить запись: не попадёт в промпт'),
        button('Удалить', 'btn', () => act('onRemoveRecord', owner, 'record-remove'), 'Удалить запись'),
      ]);
      article.append(controls);
      stack.append(article);
    }
    return stack;
  }

  function renderRecordEditor(item, owner) {
    const form = element('form', { className: 'record editing' });
    const text = element('textarea', { value: item.text || '', required: true, 'aria-label': 'Текст записи' });
    const participants = makeRoster('Участники (никто не выбран — общее для чата)', item.participantIds ?? []);
    const knownBy = makeRoster('Кому ещё известно', item.knownBy ?? item.participantIds ?? []);
    linkRosters(participants, knownBy);
    const intensity = intensityControl(Number(item.intensity) || 3);
    const save = button('Сохранить', 'btn primary', () => {});
    save.type = 'submit';
    const cancel = button('Отмена', 'btn', () => { editingRecordId = null; render(); });
    const notes = owner.shared ? [] : [element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: 'Старая запись пары: если поменять участников или кому известно, она станет общей записью.' })];
    form.append(text, participants.box, knownBy.box, intensity.row, ...notes, element('div', { className: 'record-actions' }, [save, cancel]));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!text.value.trim()) return;
      save.disabled = true;
      const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
      const changes = { text: text.value.trim(), intensity: Number(intensity.input.value) };
      // Send rosters only when they changed: for old pair records that is what moves them to shared ones.
      if (!same(participants.checked(), item.participantIds ?? [])) changes.participantIds = participants.checked();
      if (!same(knownBy.checked(), item.knownBy ?? item.participantIds ?? [])) changes.knownBy = knownBy.checked();
      try {
        await facade.invoke('onUpdateRecord', { ...owner, changes });
        editingRecordId = null;
        setStatus('Запись сохранена');
        render();
      } catch (error) {
        setStatus(error?.message || 'Не удалось сохранить запись', true);
      } finally { save.disabled = false; }
    });
    return form;
  }

  return { nameOf, recall, makeRoster, linkRosters, intensityControl, renderCollection, renderRecords, renderRecordEditor };
}
