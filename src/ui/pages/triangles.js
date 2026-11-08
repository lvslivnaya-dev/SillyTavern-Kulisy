import { button, characterId, characterName, element, pairLabel, pairSource, pairTarget } from '../helpers.js';
import { triangleEdges } from '../../core/records.js';

/**
 * Love triangles and their lines.
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createTrianglesPage(ctx) {
  const act = (...args) => ctx.act(...args);
  const characterSelect = (...args) => ctx.characterSelect(...args);
  const openTriangleSetup = (...args) => ctx.openTriangleSetup(...args);
  const renderOverview = (...args) => ctx.renderOverview(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  function renderTriangles() {
    const container = element('div', { className: 'triangle-list' });
    const form = element('form', { className: 'card triangle-form' });
    const name = element('input', { placeholder: 'Название треугольника', 'aria-label': 'Название треугольника' });
    const center = characterSelect('Центр (персонаж 2)', '', ctx.snapshot.characters);
    const first = characterSelect('Персонаж 1', '', ctx.snapshot.characters);
    const second = characterSelect('Персонаж 3', '', ctx.snapshot.characters);
    const submit = button('Создать треугольник', 'btn primary', () => {}); submit.type = 'submit';
    submit.style.cssText = 'justify-self:start;margin-top:4px';
    form.append(element('h3', { text: 'Новый треугольник', style: { margin: '0' } }), name, center.field, first.field, second.field, submit);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        triangleEdges(center.select.value, first.select.value, second.select.value);
        act('onAddTriangle', { name: name.value, centerId: center.select.value, firstId: first.select.value, secondId: second.select.value });
      } catch (error) { setStatus(error.message, true); }
    });
    container.append(form);
    const nameOf = id => characterName(ctx.snapshot.characters.find(c => characterId(c) === id), id);
    for (const triangle of ctx.snapshot.ui?.triangles || []) {
      const chosen = triangle.resolved?.chosenId;
      const loser = chosen ? (chosen === triangle.firstId ? triangle.secondId : triangle.firstId) : '';
      const choice = element('select', { 'aria-label': 'Выбор сделан' }, [
        element('option', { value: '', text: chosen ? 'Вернуть треугольник' : 'Выбор сделан…' }),
        ...[triangle.firstId, triangle.secondId].filter(id => id !== chosen).map(id => element('option', { value: id, text: `${nameOf(triangle.centerId)} выбирает: ${nameOf(id)}` })),
      ]);
      choice.addEventListener('change', async () => {
        const chosenId = choice.value || null;
        if (!chosenId && !chosen) return;
        await act('onResolveTriangle', { id: triangle.id, chosenId });
        if (chosenId) setStatus(`Треугольник закрыт: модель его больше не получает. Линии ${nameOf(chosenId === triangle.firstId ? triangle.secondId : triangle.firstId)} → ${nameOf(triangle.centerId)} можно поставить троп развязки: «Второй шанс» или «От любви до ненависти».`);
      });
      const echo = element('input', { type: 'checkbox', checked: !triangle.noEcho });
      echo.addEventListener('change', () => act('onSetTriangleEcho', { id: triangle.id, enabled: echo.checked }));
      const loserLine = loser ? ctx.snapshot.pairs.find(item => pairSource(item) === loser && pairTarget(item) === triangle.centerId) : null;
      const group = element('section', { className: `card triangle-group${chosen ? ' resolved' : ''}` }, [
        element('div', { className: 'triangle-head' }, [
          element('h3', { text: triangle.name }),
          element('div', { className: 'row' }, [
            button('Цель и факторы', 'btn primary', () => openTriangleSetup(triangle.id), 'Конечная точка, готовый троп и факторы роста всех линий треугольника'),
            button('Удалить группу', 'btn', () => act('onRemoveTriangle', { id: triangle.id })),
          ]),
        ]),
        element('p', { className: `triangle-goal${triangle.goal ? '' : ' muted'}`, text: triangle.goal ? `Конечная точка: ${triangle.goal}` : 'Конечная точка не задана.' }),
        chosen ? element('p', { className: 'triangle-resolved', text: `Выбор сделан: ${nameOf(triangle.centerId)} выбирает ${nameOf(chosen)}. Треугольник модели не отправляется.` }) : null,
        element('div', { className: 'row' }, [
          choice,
          ...(loserLine ? [button(`Развязка: ${nameOf(loser)} → ${nameOf(triangle.centerId)}`, 'btn', () => ctx.openFactors(loserLine.id), 'Факторы роста этой линии: поставьте троп развязки')] : []),
          element('label', { className: 'strangers-toggle', title: 'Когда центр сближается с одной стороной на глазах у другой, у той растёт ревность к сопернику. Если другой стороны нет в сцене, она ничего не видела.' }, [echo, 'Ревность третьего']),
        ]),
      ].filter(Boolean));
      const edges = element('div', { className: 'triangle-edges' });
      for (const [a, b] of triangleEdges(triangle.centerId, triangle.firstId, triangle.secondId)) {
        const label = `${characterName(ctx.snapshot.characters.find(c => characterId(c) === a), a)} ↔ ${characterName(ctx.snapshot.characters.find(c => characterId(c) === b), b)}`;
        const card = element('article', { className: 'relationship-card card' }, [element('h3', { text: label })]);
        for (const [from, to] of [[a, b], [b, a]]) {
          const relation = ctx.snapshot.pairs.find(item => pairSource(item) === from && pairTarget(item) === to);
          if (!relation) continue;
          const details = element('details', { open: from === a });
          details.append(element('summary', { text: pairLabel(ctx.snapshot, relation) }), renderOverview(relation));
          card.append(details);
        }
        edges.append(card);
      }
      group.append(edges); container.append(group);
    }
    return container;
  }

  return { renderTriangles };
}
