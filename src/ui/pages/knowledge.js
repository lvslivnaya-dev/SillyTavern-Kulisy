import { button, characterId, characterName, element } from '../helpers.js';
import { acquaintanceOf } from '../../core/index.js';

/**
 * Kulisy's own pages: who is on stage, character dossiers (what they know, whom
 * they have met), the event log and open leaks. Every change goes through the
 * frame's act() to a handler in index.js, which journals it as a manual edit.
 */
export function createKnowledgePages(ctx) {
  const act = (...args) => ctx.act(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  let selectedId = null; // character whose dossier is open
  let dossierTab = 'knows'; // knows | met | looks | wardrobe | items
  let editingEventId = null;
  let deathDraftId = null; // dossier where the «Умер(ла)» form is open
  const newEvent = { text: '', witnessIds: new Set(), secret: false };

  const snapshot = () => ctx.snapshot;
  const characters = () => snapshot().characters || [];
  const personaId = () => snapshot().personaId || snapshot().ui?.personaId || '';
  const nameOf = id => characterName(characters().find(character => characterId(character) === id), id);
  const knowledge = () => snapshot().knowledge ?? { events: [], learned: [], acquaintances: {}, scene: { presentIds: [], location: '' } };
  const present = () => new Set((knowledge().scene?.presentIds ?? []).filter(id => characters().some(character => characterId(character) === id)));
  const events = () => knowledge().events ?? [];
  const deathOf = id => knowledge().deaths?.[id] ?? null;

  function avatar(character, size = '') {
    const name = characterName(character);
    return character.avatar
      ? element('img', { className: `avatar ${size}`, src: character.avatar, alt: '' })
      : element('span', { className: `avatar ${size}`, text: name.slice(0, 2) });
  }

  /** A switch drawn by CSS on a real checkbox, so keyboards and screen readers get it. */
  function toggle(checked, label, onChange) {
    const input = element('input', { type: 'checkbox', className: 'ku-switch', checked, 'aria-label': label, title: label });
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  function sourceChip(how, event) {
    if (!how) return element('span', { className: 'ku-chip', text: 'не знает' });
    if (how.source === 'seen' && event?.lore) return element('span', { className: 'ku-chip seen', text: 'знает по лору' });
    if (how.source === 'seen') return element('span', { className: 'ku-chip seen', text: 'видел сам' });
    if (how.source === 'rumor') return element('span', { className: 'ku-chip rumor', text: 'слух' });
    // Neutral wording: a name says nothing about grammatical gender.
    return element('span', { className: 'ku-chip told', text: how.fromId ? `рассказ: ${nameOf(how.fromId)}` : 'узнал(а)' });
  }

  function empty(text) {
    return element('div', { className: 'empty', text });
  }

  // ---- Персонажи и досье -------------------------------------------------

  function renderCharacters() {
    const view = element('div', { className: 'records-view' });
    const here = present();
    const persona = personaId();
    const dossiers = snapshot().dossiers ?? {};
    if (selectedId && !characters().some(character => characterId(character) === selectedId)) selectedId = null;
    const grid = element('div', { className: 'ku-cast' });
    for (const character of characters()) {
      const id = characterId(character);
      const file = dossiers[id] ?? { knows: [], doesNotKnow: [] };
      const unmet = characters().filter(other => characterId(other) !== id && acquaintanceOf(snapshot(), id, characterId(other)) === 'strangers').length;
      const card = element('button', { type: 'button', className: `ku-person${selectedId === id ? ' on' : ''}`, 'aria-pressed': String(selectedId === id) }, [
        element('div', { className: 'ku-person-head' }, [
          avatar(character),
          element('span', { className: 'ku-person-name' }, [
            element('strong', { text: characterName(character) }),
            element('span', { className: 'muted', text: id === persona ? 'персона' : (character.aliases ?? []).slice(0, 2).join(', ') }),
          ]),
          deathOf(id)
            ? element('span', { className: 'ku-tag ku-dead', text: 'умер(ла)' })
            : element('span', { className: `ku-tag${here.has(id) ? ' on' : ''}`, text: here.has(id) ? 'в сцене' : 'за кулисами' }),
        ]),
        element('div', { className: 'ku-stats' }, [
          element('span', {}, [element('b', { text: String(file.knows.length) }), ' знает']),
          element('span', {}, [element('b', { className: file.doesNotKnow.length ? 'warn' : '', text: String(file.doesNotKnow.length) }), ' не знает']),
          element('span', {}, [element('b', { text: String(unmet) }), ' не знаком']),
        ]),
      ]);
      card.addEventListener('click', () => { selectedId = selectedId === id ? null : id; render(); });
      grid.append(card);
    }
    const scan = button('Скан лорбука на знакомства', 'btn', async () => {
      scan.disabled = true;
      setStatus('Ищу в лорбуке, кто с кем знаком…');
      try {
        const result = await ctx.facade.invoke('onScanAcquaintances', {});
        setStatus(result?.applied ? `Записано знакомств: ${result.applied}` : 'Знакомства не изменены');
      } catch (error) { setStatus(error?.message || 'Не удалось просканировать знакомства', true); }
      finally { scan.disabled = false; }
    }, 'ИИ читает лор персонажей и персоны и предлагает, кто с кем уже знаком. Вы подтверждаете список; отмеченное вручную не меняется.');
    const loreNames = button('Другие имена из лорбука', 'btn', async () => {
      loreNames.disabled = true;
      try { const count = await ctx.facade.invoke('onAliasesFromLore', {}); setStatus(count ? `Добавлены другие имена у персонажей: ${count}` : 'Новых имён в лорбуке не нашлось'); }
      catch (error) { setStatus(error?.message || 'Лорбук не прочитан', true); }
      finally { loreNames.disabled = false; }
    }, 'Берёт написания из ключей записи персонажа в лорбуке («Ран», «Ran», «Хайтани Ран»), чтобы Кулисы узнавали его под любым. Делается само при открытии чата.');
    const secrets = button('Секреты из лорбука', 'btn', async () => {
      secrets.disabled = true;
      setStatus('Читаю секреты в лорбуках…');
      try {
        const result = await ctx.facade.invoke('onScanSecrets', {});
        const parts = [];
        if (result?.applied) parts.push(`записано секретов: ${result.applied}`);
        if (result?.updated) parts.push(`обновлён текст: ${result.updated}`);
        setStatus(parts.length ? parts.join(', ').replace(/^./, letter => letter.toUpperCase()) : result?.found ? 'Секреты не записаны' : 'Новых секретов нет. Секрет — запись лорбука с названием «[Секрет] …» или «[Секрет: Имя, Имя] …».');
      } catch (error) { setStatus(error?.message || 'Не удалось прочитать секреты', true); }
      finally { secrets.disabled = false; }
    }, 'Записи лорбука с названием «[Секрет] …» или «[Секрет: Риндо, Санзу] …». Кулисы убирают их из лорбука таверны и отдают только тем, кто знает. Если знающие не вписаны в название, ИИ найдёт их по тексту, а вы подтвердите.');
    view.append(element('div', { className: 'row' }, [scan, secrets, loreNames, element('span', { className: 'muted', style: { fontSize: '12px' }, text: 'Персону по умолчанию не знает никто. Скан найдёт тех, с кем знакомство прописано в лоре.' })]));
    const all = snapshot().duplicates ?? [];
    const twins = all.filter(pair => pair.sure !== false);
    const maybe = all.filter(pair => pair.sure === false);
    if (maybe.length) {
      view.append(element('div', { className: 'card ku-twins maybe' }, [
        element('strong', { text: `Возможно, это один персонаж · ${maybe.length}` }),
        element('p', { className: 'muted ku-small', text: 'Имена отличаются на букву — Кулисы не склеивают их сами. Скажите, как есть: ответ запомнится.' }),
        ...maybe.map(pair => element('div', { className: 'ku-fact' }, [
          element('span', { className: 'ku-fact-text' }, [element('strong', { text: pair.fromName }), element('span', { className: 'muted', text: ' и ' }), element('strong', { text: pair.intoName })]),
          button('Это один', 'btn small', async () => {
            try { if (await ctx.facade.invoke('onMergeCharacters', { pairs: [{ fromId: pair.fromId, intoId: pair.intoId }] })) setStatus('Объединено'); }
            catch (error) { setStatus(error?.message || 'Не удалось объединить', true); }
          }, `«${pair.fromName}» войдёт в «${pair.intoName}»`),
          button('Разные люди', 'btn small', async () => {
            try { await ctx.facade.invoke('onDistinctCharacters', { firstId: pair.fromId, secondId: pair.intoId }); setStatus('Запомнено: это разные персонажи'); }
            catch (error) { setStatus(error?.message || 'Не удалось запомнить', true); }
          }),
        ])),
      ]));
    }
    if (twins.length) {
      const merge = pairs => ctx.facade.invoke('onMergeCharacters', { pairs });
      const run = async pairs => {
        try { const done = await merge(pairs); if (done) setStatus('Объединено'); }
        catch (error) { setStatus(error?.message || 'Не удалось объединить', true); }
      };
      view.append(element('div', { className: 'card ku-twins' }, [
        element('div', { className: 'ku-row' }, [
          element('strong', { text: `Похоже, записаны дважды · ${twins.length}` }),
          element('span', { className: 'ku-push' }),
          ...(twins.length > 1 ? [button('Объединить все', 'btn primary small', () => run(twins.map(({ fromId, intoId }) => ({ fromId, intoId }))))] : []),
        ]),
        element('p', { className: 'muted ku-small', text: 'Один персонаж под двумя именами — например, латиницей и кириллицей. Из-за этого модель предлагает линии, которые уже есть, а одежда и знания делятся надвое.' }),
        ...twins.map(pair => element('div', { className: 'ku-fact' }, [
          element('span', { className: 'ku-fact-text' }, [element('strong', { text: pair.fromName }), element('span', { className: 'muted', text: ' → войдёт в → ' }), element('strong', { text: pair.intoName })]),
          button('Объединить', 'btn small', () => run([{ fromId: pair.fromId, intoId: pair.intoId }])),
          button('Наоборот', 'btn small', () => run([{ fromId: pair.intoId, intoId: pair.fromId }]), `Оставить «${pair.fromName}», а «${pair.intoName}» влить в него`),
        ])),
      ]));
    }
    view.append(characters().length ? grid : empty('Персонажей пока нет. Добавьте их ниже, из лорбука или поиском по чату.'));
    if (selectedId) view.append(renderDossier(selectedId));
    if (typeof ctx.renderCharacterManager === 'function') {
      const manage = element('details', { className: 'fold' });
      manage.append(element('summary', { text: 'Список персонажей: добавить, псевдонимы, удалить' }), ctx.renderCharacterManager());
      view.append(manage);
    }
    return view;
  }

  function renderDossier(id) {
    const panel = element('div', { className: 'card ku-dossier' });
    const character = characters().find(item => characterId(item) === id);
    const tabs = element('div', { className: 'ku-tabs', role: 'tablist' });
    for (const [key, label] of [['knows', 'Знания'], ['met', 'Знакомства'], ['looks', 'Внешность'], ['wardrobe', 'Гардероб'], ['items', 'Вещи']]) {
      const tab = button(label, dossierTab === key ? 'on' : '', () => { dossierTab = key; render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(dossierTab === key));
      tabs.append(tab);
    }
    panel.append(
      element('div', { className: 'ku-dossier-head' }, [avatar(character, 'large'), element('div', {}, [
        element('h3', { text: characterName(character) }),
        element('span', { className: 'muted', text: id === personaId() ? 'Персона: что она знает, решаете вы; здесь видно, с кем она знакома.' : 'Досье: что знает, чего не знает и с кем знаком.' }),
      ]), element('div', { className: 'ku-name-tools' }, [mainName(id), genderSelect(id), mergeWith(id)])]),
      renderDeath(id),
      tabs,
      dossierTab === 'met' ? renderAcquaintances(id)
        : dossierTab === 'looks' ? ctx.renderLooksTab(id)
          : dossierTab === 'wardrobe' ? ctx.renderWardrobeTab(id)
          : dossierTab === 'items' ? ctx.renderHeldTab(id)
            : renderFacts(id),
    );
    return panel;
  }

  /** Dead or alive: «Умер(ла)» with how and when, or the note and «Воскресить». */
  function renderDeath(id) {
    const death = deathOf(id);
    if (death) {
      return element('div', { className: 'ku-death on' }, [
        element('span', { className: 'ku-dead', text: 'Умер(ла)' }),
        element('span', { className: 'ku-death-note', text: death.note ? ` — ${death.note}` : ' — как и когда, не записано' }),
        element('span', { className: 'ku-push' }),
        button('Воскресить', 'btn small', async () => {
          try { await ctx.facade.invoke('onSetDeath', { entityId: id, dead: false }); setStatus(`${nameOf(id)} снова жив(а)`); }
          catch (error) { setStatus(error?.message || 'Не удалось снять отметку', true); }
        }, 'Снять отметку: воскрешение, ошибка или АУ'),
      ]);
    }
    if (deathDraftId !== id) {
      return element('div', { className: 'ku-death' }, [
        button('Умер(ла)', 'btn small', () => { deathDraftId = id; render(); },
          'Персонаж уходит со сцены, модель получает dead[…]: он не появляется и не говорит. Его чувства к другим замирают, чувства других к нему — нет.'),
      ]);
    }
    const note = element('input', { type: 'text', maxlength: 300, placeholder: 'Как и когда: погиб в драке у моста, 3 августа', 'aria-label': 'Как и когда умер(ла)' });
    const save = async () => {
      try {
        await ctx.facade.invoke('onSetDeath', { entityId: id, dead: true, note: note.value });
        deathDraftId = null;
        setStatus(`${nameOf(id)}: отмечено, что умер(ла)`);
      } catch (error) { setStatus(error?.message || 'Не удалось отметить', true); }
    };
    note.addEventListener('keydown', event => { if (event.key === 'Enter') save(); });
    setTimeout(() => note.focus(), 0);
    return element('div', { className: 'ku-death' }, [
      note,
      button('Отметить', 'btn primary small', save),
      button('Отмена', 'btn small', () => { deathDraftId = null; render(); }),
    ]);
  }

  /** Grammatical gender: only for the wording of trope factors («пришёл»/«пришла»). */
  function genderSelect(id) {
    const current = snapshot().ui?.genders?.[id] ?? '';
    const select = element('select', { 'aria-label': 'Пол', title: 'Для текстов тропов: «пришёл» или «пришла», «его» или «её». Не указан — обе формы через косую черту.' },
      [['', 'Пол: не указан'], ['male', 'Мужской'], ['female', 'Женский']].map(([value, text]) => element('option', { value, text, selected: value === current })));
    select.addEventListener('change', async () => {
      try { await ctx.facade.invoke('onSetGender', { entityId: id, gender: select.value }); setStatus('Пол сохранён'); }
      catch (error) { setStatus(error?.message || 'Не удалось сохранить', true); }
    });
    return select;
  }

  /** «Главное имя»: which spelling the Studio shows; the others stay other names. */
  function mainName(id) {
    const entity = snapshot().entities?.[id];
    const names = entity ? [entity.name, ...(entity.aliases ?? [])] : [];
    const select = element('select', { 'aria-label': 'Главное имя', title: 'Каким написанием показывать персонажа; остальные останутся другими именами' },
      names.map(name => element('option', { value: name, text: name === entity?.name ? `Имя: ${name}` : name, selected: name === entity?.name })));
    select.addEventListener('change', async () => {
      try { if (await ctx.facade.invoke('onSetMainName', { entityId: id, name: select.value })) setStatus('Главное имя изменено'); }
      catch (error) { setStatus(error?.message || 'Не удалось сменить имя', true); }
    });
    return select;
  }

  /** «Объединить с…»: another record of the same person goes into this one. */
  function mergeWith(id) {
    const others = characters().filter(character => characterId(character) !== id);
    const select = element('select', { 'aria-label': 'Объединить с другим персонажем', className: 'ku-merge', title: 'Если это один и тот же персонаж под другим именем: выбранный войдёт в этого' }, [
      element('option', { value: '', text: 'Объединить с…' }),
      ...others.map(character => element('option', { value: characterId(character), text: characterName(character) })),
    ]);
    select.addEventListener('change', async () => {
      const fromId = select.value;
      if (!fromId) return;
      try { const done = await ctx.facade.invoke('onMergeCharacters', { pairs: [{ fromId, intoId: id }] }); if (done) setStatus('Объединено'); }
      catch (error) { setStatus(error?.message || 'Не удалось объединить', true); }
      finally { select.value = ''; }
    });
    return select;
  }

  function renderFacts(id) {
    const box = element('div', { className: 'ku-facts' });
    const state = snapshot();
    const file = state.dossiers?.[id] ?? { knows: [], doesNotKnow: [] };
    const learned = state.knowledge?.learned ?? [];
    box.append(element('p', { className: 'section-title', text: 'Знает' }));
    if (!file.knows.length) box.append(element('p', { className: 'muted', text: 'Ничего из отслеживаемых событий.' }));
    for (const item of file.knows) {
      const controls = [];
      if (item.source === 'seen') {
        controls.push(button('×', 'btn icon small', () => act('onUpdateEvent', {
          eventId: item.event.id, changes: { witnessIds: item.event.witnessIds.filter(witness => witness !== id) },
        }, 'witness-remove'), item.event.lore ? `${nameOf(id)} не знает этот секрет` : `Убрать ${nameOf(id)} из свидетелей`));
      } else if (item.learnedId) {
        controls.push(toggle(true, 'Учитывать, что знает', value => act('onToggleKnowledge', { kind: 'learned', itemId: item.learnedId, disabled: !value }, 'learned-toggle')));
        controls.push(button('×', 'btn icon small', () => act('onRemoveLearned', { learnedId: item.learnedId }, 'learned-remove'), 'Убрать это знание'));
      }
      box.append(factRow(item.event, sourceChip(item, item.event), controls));
    }
    // Switched-off "learned" entries: kept, shown dimmed, can be switched back on.
    for (const entry of learned.filter(candidate => candidate.entityId === id && candidate.disabled)) {
      const event = events().find(candidate => candidate.id === entry.eventId);
      if (!event || event.disabled) continue;
      box.append(factRow(event, element('span', { className: 'ku-chip', text: 'выключено' }), [
        toggle(false, 'Учитывать, что знает', value => act('onToggleKnowledge', { kind: 'learned', itemId: entry.id, disabled: !value }, 'learned-toggle')),
      ], true));
    }
    box.append(element('p', { className: 'section-title warn', text: 'Не знает' }));
    if (!file.doesNotKnow.length) box.append(element('p', { className: 'muted', text: 'Знает всё, что отслеживается.' }));
    for (const event of file.doesNotKnow) {
      box.append(factRow(event, sourceChip(null), [
        button('Знает', 'btn small', () => act('onAddLearned', { eventId: event.id, entityId: id, source: 'told' }, 'learned-add'), `${nameOf(id)} знает об этом`),
        button('Слух', 'btn small', () => act('onAddLearned', { eventId: event.id, entityId: id, source: 'rumor' }, 'learned-add'), `До ${nameOf(id)} дошли слухи`),
      ]));
    }
    return box;
  }

  function factRow(event, chip, controls, off = false) {
    return element('div', { className: `ku-fact${off ? ' off' : ''}` }, [
      element('span', { className: 'ku-fact-text' }, [
        event.secret ? element('span', { className: 'ku-secret', text: event.lore ? 'секрет из лорбука · ' : 'секрет · ' }) : null,
        event.text,
        event.location ? element('span', { className: 'muted', text: ` · ${event.location}` }) : null,
      ].filter(Boolean)),
      chip,
      ...controls,
    ]);
  }

  const MEET_OPTIONS = [['', 'по канону'], ['known', 'знакомы'], ['seen', 'видел, имени не знает'], ['strangers', 'не знакомы']];

  function renderAcquaintances(id) {
    const box = element('div', { className: 'ku-facts' });
    const persona = personaId();
    const state = snapshot();
    const others = characters().filter(character => characterId(character) !== id)
      .sort((left, right) => Number(characterId(right) === persona) - Number(characterId(left) === persona));
    box.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Персону по умолчанию не знает никто, пока не отмечено иное. Двое персонажей без отметки — «по канону»: модель исходит из сюжета. Летописец сам отмечает знакомство, когда оно случается в тексте.' }));
    for (const other of others) {
      const otherId = characterId(other);
      const explicit = state.knowledge?.acquaintances?.[[id, otherId].sort().join('|')] ?? '';
      const effective = acquaintanceOf(state, id, otherId);
      const select = element('select', { 'aria-label': `Знакомство: ${characterName(other)}` });
      for (const [value, label] of MEET_OPTIONS) select.append(element('option', { value, text: label, selected: value === explicit }));
      select.addEventListener('change', () => act('onSetAcquaintance', { firstId: id, secondId: otherId, status: select.value || null }, 'acquaintance-set'));
      // Without a hand-set value: the persona rule, or an old pair flag from Relationship Engine.
      const legacy = (state.ui?.strangerPairs ?? []).includes([id, otherId].sort().join('|'));
      const note = !explicit && effective === 'strangers'
        ? element('span', { className: 'ku-chip warn', text: legacy ? 'не знакомы (старая отметка)' : 'не знакомы (персона)' }) : null;
      box.append(element('div', { className: `ku-fact${effective === 'strangers' ? ' warn' : ''}` }, [
        avatar(other, 'small'),
        element('span', { className: 'ku-fact-text', text: `${characterName(other)}${otherId === persona ? ' · персона' : ''}` }),
        note,
        select,
      ].filter(Boolean)));
    }
    if (!others.length) box.append(empty('Других персонажей нет.'));
    return box;
  }

  // ---- Лента событий -----------------------------------------------------

  function renderEvents() {
    const view = element('div', { className: 'records-view' });
    const state = snapshot();
    const text = element('textarea', { value: newEvent.text, rows: 2, placeholder: 'Что произошло. Например: Ран и Судзу говорили в подворотне', 'aria-label': 'Новое событие' });
    text.addEventListener('input', () => { newEvent.text = text.value; });
    const roster = element('div', { className: 'roster-list' });
    for (const character of characters()) {
      const id = characterId(character);
      const box = element('input', { type: 'checkbox', checked: newEvent.witnessIds.has(id) });
      box.addEventListener('change', () => { if (box.checked) newEvent.witnessIds.add(id); else newEvent.witnessIds.delete(id); });
      roster.append(element('label', { className: 'roster-item' }, [box, element('span', { text: characterName(character) })]));
    }
    const secret = element('input', { type: 'checkbox', checked: newEvent.secret });
    secret.addEventListener('change', () => { newEvent.secret = secret.checked; });
    const add = button('Добавить событие', 'btn primary', async () => {
      try {
        await ctx.facade.invoke('onAddEvent', { text: newEvent.text, witnessIds: [...newEvent.witnessIds], secret: newEvent.secret, location: knowledge().scene?.location || undefined });
        newEvent.text = '';
        newEvent.witnessIds.clear();
        newEvent.secret = false;
        setStatus('Событие добавлено');
        render();
      } catch (error) { setStatus(error?.message || 'Не удалось добавить событие', true); }
    });
    view.append(element('div', { className: 'card' }, [
      element('h3', { text: 'Новое событие' }),
      text,
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '8px 0 4px' }, text: 'Кто видел или слышал своими глазами:' }),
      element('div', { className: 'roster' }, [roster]),
      element('label', { className: 'strangers-toggle', style: { margin: '10px 0' } }, [secret, 'Секрет: участники скрывают это от других']),
      add,
    ]));
    const list = element('div', { className: 'record-list' });
    for (const event of [...events()].reverse()) list.append(renderEvent(event, state));
    const foldable = state.tidy?.foldable ?? 0;
    const fold = button('Свернуть дубли', 'btn', async () => {
      fold.disabled = true;
      setStatus('Ищу дубли среди событий…');
      try {
        const result = await ctx.facade.invoke('onFoldEvents', {});
        setStatus(result?.folded ? `Склеено событий: ${result.folded}` : 'Без изменений');
      } catch (error) { setStatus(error?.message || 'Не удалось свернуть дубли', true); }
      finally { fold.disabled = false; render(); }
    }, 'Модель находит цепочки событий с одними и теми же свидетелями (одна сцена, записанная по шагам) и предлагает один текст на цепочку. Ничего не меняется, пока не нажмёшь «Склеить отмеченные»');
    view.append(element('div', { className: 'card' }, [
      element('h3', { text: `События: ${events().length}` }),
      element('div', { className: 'row', style: { marginBottom: '8px' } }, [fold, element('span', { className: 'muted', style: { fontSize: '12px' }, text: foldable ? `Ещё не проверено: ${foldable}. Одно нажатие доводит всё до конца, второй раз жать не нужно.` : 'Все события проверены. Новые события той же сцены летописец дописывает к предыдущему сам.' })]),
      events().length ? list : empty('Событий пока нет. Летописец добавит их по ходу игры, или впишите выше.'),
    ]));
    return view;
  }

  function renderEvent(event, state) {
    const item = element('div', { className: `record${event.disabled ? ' off' : ''}${editingEventId === event.id ? ' editing' : ''}` });
    const later = (state.knowledge?.learned ?? []).filter(entry => entry.eventId === event.id && !entry.disabled)
      .map(entry => `${nameOf(entry.entityId)} (${entry.source === 'rumor' ? 'слух' : entry.fromId ? `от ${nameOf(entry.fromId)}` : 'узнал'})`);
    const head = element('div', { className: 'record-head' }, [
      event.secret ? element('span', { className: 'record-badge ku-secret', text: 'секрет' }) : null,
      event.lore ? element('span', { className: 'record-badge', text: `лорбук «${event.lore.book}»`, title: 'Текст берётся из записи лорбука. Его знают только отмеченные; если в сцене никто из них, модель о нём не слышит.' }) : null,
      event.location ? element('span', { className: 'record-badge', text: event.location }) : null,
      element('span', { style: { flex: '1' } }),
      toggle(!event.disabled, 'Учитывать событие', value => act('onToggleKnowledge', { kind: 'event', itemId: event.id, disabled: !value }, 'event-toggle')),
    ].filter(Boolean));
    item.append(head);
    if (editingEventId === event.id) {
      const text = element('textarea', { value: event.text, rows: 2, 'aria-label': 'Текст события' });
      const roster = element('div', { className: 'roster-list' });
      const witnesses = new Set(event.witnessIds);
      for (const character of characters()) {
        const id = characterId(character);
        const box = element('input', { type: 'checkbox', checked: witnesses.has(id) });
        box.addEventListener('change', () => { if (box.checked) witnesses.add(id); else witnesses.delete(id); });
        roster.append(element('label', { className: 'roster-item' }, [box, element('span', { text: characterName(character) })]));
      }
      const secret = element('input', { type: 'checkbox', checked: Boolean(event.secret) });
      item.append(text, element('div', { className: 'roster' }, [roster]),
        element('label', { className: 'strangers-toggle', style: { margin: '8px 0' } }, [secret, 'Секрет']),
        element('div', { className: 'record-actions' }, [
          button('Сохранить', 'btn primary', async () => {
            try {
              await ctx.facade.invoke('onUpdateEvent', { eventId: event.id, changes: { text: text.value, witnessIds: [...witnesses], secret: secret.checked } });
              editingEventId = null;
              render();
            } catch (error) { setStatus(error?.message || 'Не удалось сохранить событие', true); }
          }),
          button('Отмена', 'btn', () => { editingEventId = null; render(); }),
        ]));
      return item;
    }
    item.append(
      element('p', { className: 'record-text', text: event.text }),
      element('div', { className: 'record-people' }, [
        element('span', { className: 'muted', text: event.lore ? 'знают: ' : 'видели: ' }),
        ...(event.witnessIds.length ? event.witnessIds.map(id => element('span', { className: 'chip', text: nameOf(id) })) : [element('span', { className: 'muted', text: '—' })]),
      ]),
      ...(later.length ? [element('p', { className: 'muted', style: { fontSize: '12px', margin: '6px 0 0' }, text: `узнали позже: ${later.join(', ')}` })] : []),
      element('div', { className: 'record-actions' }, [
        ...(event.secret || event.lore ? [] : [button('Сделать секретом', 'btn', () => act('onCreateSecret', { eventId: event.id }, 'event-secret'), 'Составить секрет из этого события: подпись для тех, кто не знает, и подробности для знающих. Проверишь перед сохранением')]),
        button('Изменить', 'btn', () => { editingEventId = event.id; render(); }),
        button('Удалить', 'btn', () => act('onRemoveEvent', { eventId: event.id }, 'event-remove')),
      ]),
    );
    return item;
  }

  // ---- Утечки ------------------------------------------------------------

  function renderLeaks() {
    const view = element('div', { className: 'records-view' });
    const leaks = snapshot().leaks ?? [];
    view.append(element('p', { className: 'muted', style: { fontSize: '12px', margin: '0' }, text: 'Утечка — персонаж ведёт себя так, будто знает то, чего не видел и о чём ему не рассказывали. Летописец отмечает их при проверке ответа. Утечка исчезает сама, если персонаж узнал об этом позже.' }));
    if (!leaks.length) {
      view.append(empty('Открытых утечек нет.'));
      return view;
    }
    for (const leak of leaks) {
      const payload = { messageIndex: leak.messageIndex, entityId: leak.entityId, eventId: leak.eventId };
      view.append(element('div', { className: 'card ku-leak-card' }, [
        element('div', { className: 'record-head' }, [
          element('strong', { text: `${leak.name} знает о том, чего знать не может` }),
          element('span', { className: 'muted', style: { marginLeft: 'auto' }, text: `сообщение #${leak.messageIndex}` }),
        ]),
        element('p', { className: 'record-text', text: leak.eventText }),
        ...(leak.quote ? [element('blockquote', { className: 'ku-quote', text: leak.quote })] : []),
        element('div', { className: 'record-actions' }, [
          ...(leak.canSwipe ? [button('Свайп', 'btn primary', () => act('onLeakSwipe', payload, 'leak-swipe'), 'Перегенерировать этот ответ')] : []),
          button('Он знает', 'btn', () => act('onLeakKnows', payload, 'leak-knows'), 'Это не ошибка: записать, что он знает'),
          button('Не утечка', 'btn', () => act('onLeakDismiss', payload, 'leak-dismiss'), 'Убрать отметку, ничего не записывая'),
        ]),
      ]));
    }
    return view;
  }

  /** Open a character's dossier on a tab (from the control desk, a slip, the chat). */
  function openDossier(id, tab = 'knows') {
    selectedId = id;
    dossierTab = tab;
    ctx.setTab('characters');
  }

  /**
   * «Секреты»: every secret in one place. Who knows it (one click to change), whether the
   * model hears it in the current scene, and the reveals waiting for an answer under replies.
   */
  function renderSecrets() {
    const view = element('div', { className: 'records-view' });
    const state = snapshot();
    const here = present();
    const persona = personaId();
    const knowsOf = (event, id) => event.witnessIds.includes(id)
      || (knowledge().learned ?? []).some(item => item.eventId === event.id && item.entityId === id && !item.disabled);
    const scan = button('Секреты из лорбука', 'btn', async () => {
      scan.disabled = true;
      setStatus('Читаю секреты в лорбуках…');
      try {
        const result = await ctx.facade.invoke('onScanSecrets', {});
        setStatus(result?.applied ? `Записано секретов: ${result.applied}` : result?.updated ? `Обновлён текст: ${result.updated}` : 'Новых секретов нет');
      } catch (error) { setStatus(error?.message || 'Не удалось прочитать секреты', true); }
      finally { scan.disabled = false; }
    }, 'Записи лорбука с названием «[Секрет] …» или «[Секрет: Имя] …»');
    const create = button('Создать секрет', 'btn primary', async () => {
      try { await ctx.facade.invoke('onCreateSecret', {}); render(); }
      catch (error) { setStatus(error?.message || 'Не удалось создать секрет', true); }
    }, 'Впиши или вставь фрагмент истории: ИИ составит подпись и подробности, ты проверишь. Проще выделить текст прямо в чате: над ним появится кнопка «Создать секрет»');
    const strayCount = state.tidy?.autoSecrets ?? 0;
    const tidy = strayCount ? button(`Разобрать автосекреты (${strayCount})`, 'btn', async () => {
      tidy.disabled = true;
      setStatus('Проверяю, какие секреты настоящие…');
      try {
        const result = await ctx.facade.invoke('onStripAutoSecrets', {});
        setStatus(result?.changed ? `Секретность снята: ${result.changed}` : 'Без изменений');
      } catch (error) { setStatus(error?.message || 'Не удалось разобрать секреты', true); }
      finally { tidy.disabled = false; render(); }
    }, 'Секреты, которые летописец отмечал сам раньше. Модель подскажет, какие настоящие; снять пометку можно с любых, событие и свидетели остаются') : null;
    view.append(element('div', { className: 'row' }, [create, scan, ...(tidy ? [tidy] : []), element('span', { className: 'muted', style: { fontSize: '12px' }, text: 'Клик по имени — знает / не знает.' })]));

    const waiting = state.reveals ?? [];
    if (waiting.length) {
      view.append(element('div', { className: 'card ku-twins' }, [
        element('strong', { text: `Ждут ответа · ${waiting.length}` }),
        element('p', { className: 'muted ku-small', text: 'Летописец думает, что персонаж узнал секрет. Ответьте здесь или под сообщением.' }),
        ...waiting.map(item => element('div', { className: 'ku-fact' }, [
          element('span', { className: 'ku-fact-text' }, [element('strong', { text: item.name }), ` узнаёт: ${item.eventText}`, item.how ? element('span', { className: 'muted', text: ` (${item.how})` }) : null].filter(Boolean)),
          button('Отметить', 'btn small primary', () => act('onRevealConfirm', item, 'reveal-confirm')),
          button('Нет', 'btn small', () => act('onRevealDismiss', item, 'reveal-dismiss')),
        ])),
      ]));
    }

    const secrets = events().filter(event => event.secret);
    if (!secrets.length) {
      view.append(element('p', { className: 'muted', text: 'Секретов пока нет. Их приносят лорбук («[Секрет] …»), выделенный в чате текст («Создать секрет») и подсказки летописца под сообщениями; событие можно сделать секретом и в «Ленте событий».' }));
      return view;
    }
    // Lorebook secrets first, then the newest.
    const ordered = secrets.map((event, order) => ({ event, order }))
      .sort((left, right) => Number(Boolean(right.event.lore)) - Number(Boolean(left.event.lore)) || right.order - left.order);
    for (const { event } of ordered) {
      const knowers = characters().map(characterId).filter(id => knowsOf(event, id));
      const knowerOnStage = knowers.some(id => id !== persona && here.has(id));
      const status = event.disabled ? 'выключен: модель его не получает'
        : event.lore ? (knowerOnStage ? 'в сцене есть знающий: модель получает текст' : 'в сцене никто не знает: модель молчит')
          : 'кто не знает, получает «не знает»';
      const chips = characters().map(character => {
        const id = characterId(character);
        const on = knowers.includes(id);
        const chip = button(characterName(character), `ku-chip ku-knower${on ? ' seen' : ''}`,
          () => act('onSetSecretKnower', { eventId: event.id, entityId: id, knows: !on }, 'secret-knower'),
          on ? `${characterName(character)} знает — убрать` : `${characterName(character)} не знает — отметить, что знает`);
        chip.setAttribute('aria-pressed', String(on));
        return chip;
      });
      const card = element('div', { className: `card ku-secret-card${event.disabled ? ' off' : ''}` }, [
        element('div', { className: 'ku-row' }, [
          element('strong', { text: event.text }),
          element('span', { className: 'ku-push' }),
          toggle(!event.disabled, 'Учитывать секрет', value => act('onToggleKnowledge', { kind: 'event', itemId: event.id, disabled: !value }, 'event-toggle')),
        ]),
        element('p', { className: 'muted ku-small', style: { margin: '2px 0 6px' }, text: `${event.lore ? `лорбук «${event.lore.book}»` : 'из чата'} · ${status}` }),
        element('div', { className: 'ku-knowers' }, chips),
      ]);
      if (event.detail) card.append(element('details', { className: 'ku-secret-detail' }, [element('summary', { text: 'Текст секрета' }), element('p', { text: event.detail })]));
      view.append(card);
    }
    return view;
  }

  return { renderCharacters, renderEvents, renderLeaks, renderSecrets, openDossier };
}

/** Styles of the knowledge pages; colours only from the theme tokens. */
export const KNOWLEDGE_STYLE = `
.ku-cast{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:12px}
.ku-person{display:flex;flex-direction:column;gap:10px;text-align:left;padding:13px 14px;border:1px solid var(--k-line);border-radius:14px;background:var(--k-panel);color:var(--k-text);cursor:pointer;font:inherit}
.ku-person:hover{border-color:var(--k-accent-line)}
.ku-person.on{border-color:var(--k-accent);box-shadow:0 0 0 3px var(--k-accent-soft)}
.ku-person-head{display:flex;align-items:center;gap:10px;min-width:0}
.ku-person-name{display:grid;min-width:0;flex:1}
.ku-person-name strong,.ku-person-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ku-person-name span{font-size:12px}
.ku-tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;border:1px solid var(--k-line);color:var(--k-muted);white-space:nowrap}
.ku-tag.on{border-color:var(--k-accent-line);background:var(--k-accent-soft);color:var(--k-accent)}
.ku-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--k-muted)}
.ku-stats b{color:var(--k-text);font-size:14px;margin-right:2px}
.ku-stats b.warn{color:var(--k-warn)}
.avatar.small{width:26px;height:26px;font-size:11px}
.avatar.large{width:46px;height:46px;font-size:16px}
.ku-dossier-head{display:flex;gap:12px;align-items:center;margin-bottom:12px}
.ku-dossier-head h3{margin:0 0 2px}
.ku-twins{border-color:var(--k-warn)}
.ku-twins.maybe{border-style:dashed}
.ku-name-tools{display:flex;flex-direction:column;gap:6px;margin-left:auto;align-self:flex-start}
.ku-name-tools select{width:auto!important;font-size:12.5px}
.ku-twins .ku-fact{margin-top:6px}
.ku-merge{width:auto!important;font-size:12.5px}
.ku-tabs{display:flex;gap:4px;padding:4px;border-radius:11px;background:var(--k-inset);border:1px solid var(--k-line);margin-bottom:12px;max-width:520px;flex-wrap:wrap}
.ku-tabs button{flex:1;min-height:34px;border:0;border-radius:8px;background:transparent;color:var(--k-muted);font:inherit;font-weight:700;cursor:pointer}
.ku-tabs button.on{background:var(--k-bg);color:var(--k-accent)}
.ku-facts{display:grid;gap:6px}
.ku-facts .section-title{margin:10px 0 2px}
.section-title.warn{color:var(--k-warn)}
.ku-fact{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--k-line);border-radius:10px;background:var(--k-inset);flex-wrap:wrap}
.ku-fact.warn{border-color:var(--k-warn)}
.ku-fact.off .ku-fact-text{opacity:.5;text-decoration:line-through}
.ku-fact-text{flex:1 1 220px;min-width:0;line-height:1.4;overflow-wrap:anywhere}
.ku-fact select{width:auto;min-width:170px}
.ku-chip{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid var(--k-line);color:var(--k-muted);white-space:nowrap}
.ku-chip.seen{color:var(--k-ok);border-color:var(--k-ok)}
.ku-chip.told{color:var(--k-accent);border-color:var(--k-accent-line)}
.ku-chip.rumor{color:var(--k-warn);border-color:var(--k-warn);border-style:dashed}
.ku-chip.warn{color:var(--k-warn);border-color:var(--k-warn)}
.ku-knowers{display:flex;flex-wrap:wrap;gap:6px}
.ku-knower{cursor:pointer;background:transparent;min-height:0}
.ku-secret-card.off{opacity:.6}
.ku-secret-detail summary{cursor:pointer;font-size:12px;margin-top:8px}
.ku-secret-detail p{white-space:pre-wrap;font-size:12px;margin:6px 0 0}
.ku-secret{color:var(--k-warn);font-weight:700}
.ku-death{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}
.ku-death input{flex:1 1 220px;min-width:0}
.ku-dead{color:var(--k-warn);font-weight:700}
.btn.small{min-height:30px;padding:3px 10px;font-size:12px}
.btn.icon.small{width:30px;min-height:30px;padding:0}
.ku-switch{appearance:none;-webkit-appearance:none;width:36px;height:20px;border-radius:20px;background:var(--k-track);position:relative;margin:0;flex:0 0 auto;cursor:pointer;border:1px solid var(--k-line)}
.ku-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--k-text);opacity:.75;transition:left .15s}
.ku-switch:checked{background:var(--k-accent-soft);border-color:var(--k-accent)}
.ku-switch:checked::after{left:18px;background:var(--k-accent);opacity:1}
.ku-switch:focus-visible{outline:2px solid var(--k-accent);outline-offset:2px}
.ku-presence{display:grid;gap:4px}
.ku-presence-row{display:flex;align-items:center;gap:10px;padding:6px 4px}
.ku-presence-row.away .ku-presence-name{opacity:.6}
.ku-presence-name{flex:1;font-weight:600}
.ku-quote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--k-warn);background:var(--k-warn-soft);border-radius:0 8px 8px 0;font-style:italic}
.ku-leak-card{border-color:var(--k-warn)}
.nav .badge{margin-left:auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;border:1px solid var(--k-warn);color:var(--k-warn);font-size:11px;font-weight:700;display:inline-grid;place-items:center;box-sizing:border-box}
.dock .nav .badge{position:absolute;top:2px;right:2px;margin:0;min-width:15px;height:15px;font-size:9px;background:var(--k-bg)}
.dock .nav button{position:relative}
`;
