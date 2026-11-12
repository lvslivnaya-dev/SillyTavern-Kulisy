import { button, characterId, characterName, element } from '../helpers.js';

/**
 * Character roster: add, aliases, bulk removal.
 * Moved verbatim out of studio.js. `ctx` is the Studio frame: its functions,
 * objects, and the state it owns (ctx.snapshot, ctx.tab, …) through getters.
 */
export function createCharactersPage(ctx) {
  const { facade } = ctx;
  const act = (...args) => ctx.act(...args);
  const render = (...args) => ctx.render(...args);
  const setStatus = (...args) => ctx.setStatus(...args);

  let selectedForRemoval = new Set();
  let editingAliasesId = null; // character whose aliases are being edited in the overview

  function renderCharacterManager() {
    const box = element('div', { className: 'card' });
    // Up to three columns on wide screens (a column never gets narrower than a third);
    // narrows down to one on phones by itself.
    const list = element('div', { className: 'characters', style: { display: 'grid', gap: '6px', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,max(210px,calc((100% - 12px) / 3))),1fr))' } });
    const personaId = ctx.snapshot.personaId || ctx.snapshot.ui?.personaId || '';
    const removableCharacters = (ctx.snapshot.characters || []).filter(character => characterId(character) !== personaId);
    // Drop selections that no longer exist (deleted characters, switched chats).
    selectedForRemoval = new Set([...selectedForRemoval].filter(id => removableCharacters.some(character => characterId(character) === id)));
    const rowLayout = { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', border: '1px solid var(--rs-line)', borderRadius: '8px' };
    for (const character of ctx.snapshot.characters || []) {
      const name = characterName(character);
      const avatar = character.avatar || character.avatarUrl
        ? element('img', { className: 'avatar', src: character.avatar || character.avatarUrl, alt: '' })
        : element('span', { className: 'avatar', text: name.slice(0, 1).toUpperCase() });
      const isPersona = characterId(character) === personaId;
      const aliases = character.aliases ?? [];
      const aliasNote = aliases.length ? `\nПсевдонимы: ${aliases.join(', ')}` : '';
      const editAliases = button('✎', 'btn icon alias-edit', () => {
        editingAliasesId = editingAliasesId === characterId(character) ? null : characterId(character);
        render();
      }, `Псевдонимы ${name}`);
      const characterRow = element('div', { className: 'character', style: rowLayout, title: `${isPersona ? `${name} — персона этого чата` : name}${aliasNote}` }, [
        avatar,
        element('span', { style: { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: name }),
        ...(isPersona ? [element('em', { className: 'muted', text: 'персона' })] : []),
        ...(ctx.snapshot.cardByEntity?.[characterId(character)] ? [element('em', { className: 'muted', text: 'карточка', title: `Карточка из библиотеки: ${ctx.snapshot.cardByEntity[characterId(character)].name}` })] : []),
        editAliases,
      ]);
      if (!isPersona) {
        const checkbox = element('input', { type: 'checkbox', 'aria-label': `Выбрать ${name} для удаления` });
        checkbox.checked = selectedForRemoval.has(characterId(character));
        checkbox.style.cssText = 'flex:0 0 auto;width:14px;height:14px;accent-color:var(--rs-accent);margin:0';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedForRemoval.add(characterId(character));
          else selectedForRemoval.delete(characterId(character));
          bulkRemoveButton.disabled = selectedForRemoval.size === 0;
          selectAllButton.textContent = selectedForRemoval.size === removableCharacters.length && removableCharacters.length
            ? 'Снять всех' : 'Выбрать всех';
        });
        characterRow.append(checkbox);
        const removeButton = button('×', 'btn icon', () => act('onRemoveCharacter', { characterId: characterId(character) }, 'character-remove'), `Удалить персонажа ${name}`);
        removeButton.style.cssText = 'flex:0 0 26px;width:26px;height:26px;min-height:26px;padding:0;font-size:13px;line-height:1;border-radius:6px;display:grid;place-items:center';
        characterRow.append(removeButton);
      } else {
        characterRow.append(element('span', { style: { flex: '0 0 26px', width: '26px' }, text: '' }));
      }
      list.append(characterRow);
      if (editingAliasesId === characterId(character)) list.append(renderAliasEditor(character));
    }
    const bulkBar = element('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 10px' } });
    const allSelected = removableCharacters.length > 0 && selectedForRemoval.size === removableCharacters.length;
    const selectAllButton = button(allSelected ? 'Снять всех' : 'Выбрать всех', 'btn', () => {
      if (selectedForRemoval.size === removableCharacters.length && removableCharacters.length) selectedForRemoval.clear();
      else selectedForRemoval = new Set(removableCharacters.map(character => characterId(character)));
      render();
    });
    selectAllButton.style.cssText = 'min-height:30px;padding:4px 10px;font-size:12px';
    const bulkRemoveButton = button('Удалить выбранных', 'btn', () => {
      if (!selectedForRemoval.size) return;
      act('onRemoveCharactersBulk', { characterIds: [...selectedForRemoval] }, 'characters-bulk-remove');
    });
    bulkRemoveButton.disabled = selectedForRemoval.size === 0;
    bulkRemoveButton.style.cssText = 'min-height:30px;padding:4px 10px;font-size:12px';
    if (removableCharacters.length) bulkBar.append(selectAllButton, bulkRemoveButton);
    else bulkBar.append(element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: 'Нет персонажей для удаления.' }));
    const addForm = element('form', { className: 'field', style: { marginTop: '12px' } });
    const addInput = element('input', { type: 'text', placeholder: 'Имя персонажа', 'aria-label': 'Имя нового персонажа', required: true });
    const aliasInput = element('input', { type: 'text', placeholder: 'Псевдонимы через запятую', 'aria-label': 'Псевдонимы персонажа' });
    const addButton = button('Добавить персонажа', 'btn', () => {});
    addButton.type = 'submit';
    addForm.append(addInput, aliasInput, addButton);
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = addInput.value.trim();
      if (!name) return;
      const aliases = aliasInput.value.split(',').map(value => value.trim()).filter(Boolean);
      await act('onAddCharacter', { name, aliases }, 'character-add');
      addInput.value = '';
      aliasInput.value = '';
    });
    box.append(bulkBar, list, addForm);
    return box;
  }

  /** Aliases of an existing character: other spellings, nicknames, translations (Майки, Mikey…). */
  function renderAliasEditor(character) {
    const form = element('form', { className: 'alias-editor' });
    const input = element('input', { type: 'text', value: (character.aliases ?? []).join(', '), placeholder: 'Через запятую: Майки, Mikey, Sano', 'aria-label': `Псевдонимы ${characterName(character)}` });
    const save = button('Сохранить', 'btn primary', () => {});
    save.type = 'submit';
    form.append(
      element('label', { className: 'muted', text: `Псевдонимы: ${characterName(character)}` }),
      input,
      element('p', { className: 'muted', style: { fontSize: '11px', margin: '0' }, text: 'По псевдонимам анализатор узнаёт персонажа в тексте, а хедканоны подбираются к сцене.' }),
      element('div', { className: 'row' }, [save, button('Отмена', 'btn', () => { editingAliasesId = null; render(); })]),
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await facade.invoke('onSetAliases', {
          characterId: characterId(character),
          aliases: input.value.split(',').map(value => value.trim()).filter(Boolean),
        });
        editingAliasesId = null;
        setStatus('Псевдонимы сохранены');
        render();
      } catch (error) { setStatus(error?.message || 'Не удалось сохранить псевдонимы', true); }
    });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
    return form;
  }

  return { renderCharacterManager, renderAliasEditor };
}
