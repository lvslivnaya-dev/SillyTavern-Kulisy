/**
 * Smoke test of the Studio in a fake browser (jsdom): every tab renders in
 * both window modes without throwing or logging errors. It guards refactors
 * of the UI, where a lost closure variable only fails at runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  addHeadcanons, applyOperations, createDefaultState, createEntity, createOperation, relationshipId,
} from '../src/core/index.js';

const dom = new JSDOM('<!doctype html><html><body><div id="top-settings-holder"><div id="persona-management-button" class="drawer"></div><div id="rightNavHolder" class="drawer"></div></div></body></html>', { pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
// Browser classes the UI checks with instanceof (ShadowRoot, HTMLElement, File…).
// Node's own versions (Event, Blob…) are replaced too, so instanceof matches jsdom's objects.
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^[A-Z]/.test(name) && typeof window[name] === 'function') {
    try { globalThis[name] = window[name]; } catch { /* read-only global */ }
  }
}
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
window.requestAnimationFrame = globalThis.requestAnimationFrame;

const { createRelationshipStudio } = await import('../src/ui/studio.js');
const { NAV_TABS, PENDING_TABS } = await import('../src/ui/layout.js');
const { mountTopBarButton } = await import('../src/integration/shell.js');

function sampleState() {
  const ran = createEntity('Ран');
  const suzu = createEntity('Судзу');
  const mikey = createEntity('Майки');
  const ranToSuzu = relationshipId(ran.id, suzu.id);
  let state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', ran),
    createOperation('entity.upsert', suzu),
    createOperation('entity.upsert', mikey),
    createOperation('relationship.upsert', { from: ran.id, to: suzu.id }, { id: 'rel:1' }),
    createOperation('relationship.upsert', { from: mikey.id, to: suzu.id }, { id: 'rel:2' }),
    createOperation('scale.delta', { relationshipId: ranToSuzu, scaleId: 'trust', value: 30 }, { id: 'scale:1' }),
    createOperation('memory.add', { relationshipId: ranToSuzu, item: { id: 'm1', text: 'Разговор в подворотне' } }, { id: 'mem:1' }),
    createOperation('tension.add', { relationshipId: ranToSuzu, item: { id: 't1', text: 'Недоговорённость' } }, { id: 'ten:1' }),
  ]);
  const withHeadcanon = addHeadcanons(state, `${ran.id}|${suzu.id}`, ['Зовёт её по фамилии']);
  state = { ...state, ui: { ...state.ui, headcanons: withHeadcanon.headcanons } };
  return {
    ...state,
    pairs: Object.values(state.relationships),
    tavernPersonas: [],
    lorebooks: { available: ['Токийские мстители'], selected: [], cardWorlds: [], status: '' },
    settings: { autoTrack: false, widgetEnabled: true, maxPromptCharacters: 4000, headcanonLimit: 8, aux: { mode: 'off', purposes: {} }, embeddings: { mode: 'off' } },
    promptPreview: 'превью',
    analysisTokens: {},
  };
}

function captureErrors(run) {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try { run(); } catch (error) { errors.push(error?.stack || String(error)); }
  finally { console.error = original; }
  return errors;
}

for (const mode of ['window', 'dock']) {
  for (const [tab, label] of NAV_TABS) {
    test(`${mode}: tab «${label}» renders`, () => {
      let studio;
      const snapshot = sampleState();
      const errors = captureErrors(() => {
        studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode, tab } });
      });
      try {
        assert.deepEqual(errors, [], errors.join('\n'));
        const shadow = studio.element.shadowRoot;
        const panel = shadow.querySelector('.studio');
        assert.equal(panel.classList.contains('dock'), mode === 'dock');
        assert.ok(shadow.querySelector('.content'), 'content area');
        assert.equal(shadow.querySelector('.nav button.active')?.getAttribute('aria-current'), 'page');
        if (PENDING_TABS.has(tab)) assert.ok(shadow.querySelector('.pending'), 'pending note');
        assert.equal(Boolean(shadow.querySelector('.dock-resize')), true, 'width handle is attached');
      } finally {
        studio?.destroy();
      }
    });
  }
}

test('switching tabs and modes reports the layout and keeps rendering', () => {
  const changes = [];
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({
      store: { getSnapshot: sampleState }, open: true, layout: { mode: 'window', tab: 'overview' },
      onLayoutChange: value => changes.push(value),
    });
    const shadow = studio.element.shadowRoot;
    [...shadow.querySelectorAll('.nav button')].find(node => node.textContent.includes('История')).click();
    shadow.querySelector('.mode-toggle').click();
    shadow.querySelector('.mode-toggle').click();
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.deepEqual(changes.map(({ mode, tab }) => `${mode}:${tab}`), ['window:overview', 'window:journal', 'dock:journal', 'window:journal'], 'opening is reported too');
    assert.equal(changes[0].open, true);
    studio.close();
    assert.equal(changes.at(-1).open, false, 'closing is remembered');
    assert.ok(changes.every(change => Number.isFinite(change.width)));
  } finally {
    studio?.destroy();
  }
});

test('Esc typed in the chat does not close the docked panel; inside it does', () => {
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: sampleState }, open: true, layout: { mode: 'dock', tab: 'overview' } });
  });
  try {
    assert.deepEqual(errors, []);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    assert.equal(studio.isOpen(), true, 'chat Esc ignored');
    studio.element.shadowRoot.querySelector('.content').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    assert.equal(studio.isOpen(), false, 'Esc inside the panel closes it');
    textarea.remove();
  } finally {
    studio?.destroy();
  }
});

test('top bar button sits after the persona button and mirrors the open state', () => {
  let toggled = 0;
  const bar = mountTopBarButton({ onToggle: () => { toggled += 1; } });
  try {
    const node = document.getElementById('ku-topbar-button');
    assert.equal(node.previousElementSibling?.id, 'persona-management-button');
    const iconNode = node.querySelector('.drawer-icon');
    assert.ok(iconNode.classList.contains('closedIcon'));
    iconNode.click();
    assert.equal(toggled, 1);
    bar.setOpen(true);
    assert.ok(iconNode.classList.contains('openIcon') && !iconNode.classList.contains('closedIcon'));
    assert.equal(iconNode.getAttribute('aria-pressed'), 'true');
  } finally {
    bar.unmount();
  }
  assert.equal(document.getElementById('ku-topbar-button'), null);
});

test('factors sheet opens with the line end point, and saving sends it for that line only', async () => {
  const saved = [];
  let studio;
  const snapshot = sampleState();
  const line = snapshot.pairs[0];
  line.goal = 'Ран признаёт её равной';
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({
      store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'overview' },
      onSetFactors: payload => { saved.push(payload); },
      onPairTropes: () => [],
      directionPresets: () => [{ id: 'romance', label: 'Романтика' }],
    });
    const shadow = studio.element.shadowRoot;
    [...shadow.querySelectorAll('button')].find(node => node.textContent === 'Факторы роста').click();
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const shadow = studio.element.shadowRoot;
    const goal = shadow.querySelector('.factors-sheet .goal-field');
    assert.ok(goal, 'end point field is in the sheet');
    assert.equal(goal.value, 'Ран признаёт её равной');
    goal.value = 'Новая цель';
    [...shadow.querySelectorAll('.factors-sheet button')].find(node => node.textContent === 'Сохранить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].goal, 'Новая цель');
    assert.equal(saved[0].sourceId, line.from);
    assert.equal(saved[0].targetId, line.to);
  } finally {
    studio?.destroy();
  }
});

test('headcanons: ticking three characters opens a group', () => {
  const asked = [];
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({
      store: { getSnapshot: sampleState }, open: true, layout: { mode: 'window', tab: 'headcanons' },
      // The page also asks for each line's pair key ({ firstId, secondId }) while it renders.
      onHeadcanonKey: ({ ids, firstId, secondId }) => { if (ids) asked.push(ids); return [...(ids ?? [firstId, secondId])].sort().join('|'); },
    });
    const shadow = studio.element.shadowRoot;
    const boxes = [...shadow.querySelectorAll('.roster-item input')];
    for (const box of boxes) { box.checked = true; box.dispatchEvent(new window.Event('change')); }
    const open = [...shadow.querySelectorAll('button')].find(node => node.textContent === 'Открыть');
    if (!open || boxes.length !== 3) throw new Error(`boxes=${boxes.length}; buttons: ${[...shadow.querySelectorAll('.content button')].map(node => node.textContent).join(' | ')}`);
    open.click();
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.equal(asked[0].length, 3);
  } finally {
    studio?.destroy();
  }
});

test('"what the model gets" shows the knowledge block in its own sections', () => {
  let studio;
  const snapshot = {
    ...sampleState(),
    knowledgePreview: '[KULISY — WHO KNOWS WHAT, NARRATOR CONTROL DATA]\nscene: present=Майки; place=гараж\nstrangers[Майки & Судзу]\nunknown[Майки]: (secret) Подворотня\n\nRules:\n- …\n[/KULISY]',
  };
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'settings' } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    // Settings open on «Модули»: four module cards, switches instead of a save form.
    assert.equal(root.querySelectorAll('.set-module').length, 4);
    assert.equal(root.querySelector('form.settings'), null);
    const section = label => [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === label);
    section('Что получает модель').click();
    const summaries = [...root.querySelectorAll('.prompt-section summary')].map(node => node.textContent);
    assert.ok(summaries.includes('Сцена и знакомства · 2'), summaries.join(' | '));
    assert.ok(summaries.includes('Кто чего не знает · 1'), summaries.join(' | '));
    assert.ok(!summaries.some(text => text.startsWith('Линии и шкалы') && /· [1-9]/.test(text) && text.includes('Rules')), 'rules are not counted as lines');
  } finally {
    studio?.destroy();
  }
});

test('settings: a switch applies at once, "?" unfolds its hint, the chronicle section shows presets and the ladder', () => {
  const calls = [];
  const snapshot = { ...sampleState(), settings: { ...sampleState().settings, autoTrack: false, chronicle: { enabled: true, preset: 'balanced' } } };
  const callbacks = {
    onSettingsChange: payload => { calls.push(['settings', payload.settings]); },
    onChronicleSettings: payload => { calls.push(['chronicle', payload.changes]); },
    onChronicleGet: () => ({
      config: { enabled: true, preset: 'balanced', sceneEvery: 15, chapterOf: 4, arcOf: 4, keepRecent: 20, hideSummarized: true, maxPromptCharacters: 6000 },
      stats: { messages: 140, scenes: 9, chapters: 2, arcs: 0, pending: 3 }, running: false,
    }),
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, callbacks, open: true, layout: { mode: 'window', tab: 'settings' } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    const section = label => [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === label);
    section('Как работает').click();
    const first = root.querySelector('.set-item');
    const help = first.querySelector('.set-help');
    assert.equal(first.querySelector('.set-hint').hidden, true);
    help.click();
    assert.equal(first.querySelector('.set-hint').hidden, false);
    const switchInput = first.querySelector('.set-switch');
    switchInput.checked = true;
    switchInput.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls[0], ['settings', { autoTrack: true }]);
    section('Хроника и сжатие').click();
    assert.equal(root.querySelector('.set-segment button.on strong').textContent, 'Сбалансированно');
    assert.deepEqual([...root.querySelectorAll('.set-step strong')].map(node => node.textContent), ['140', '9', '2', '0']);
    [...root.querySelectorAll('.set-segment button')].find(node => node.textContent.startsWith('Экономно')).click();
    assert.deepEqual(calls.at(-1), ['chronicle', { preset: 'economy' }]);
  } finally {
    studio?.destroy();
  }
});

test('settings → models: the wardrobe picture model is chosen, tested and saved', async () => {
  const calls = [];
  const snapshot = { ...sampleState(), visionChoices: { settings: { mode: 'main', maxTokens: 700 }, profiles: [{ id: 'p1', name: 'Gemini' }], mainChatCompletion: false, mainModel: '' } };
  const callbacks = {
    onSettingsChange: payload => { calls.push(['settings', payload.settings]); },
    onTestVision: async payload => { calls.push(['test', payload.vision]); return 'Модель видит картинки: «red»'; },
    onAuxProfiles: () => [], onAuxPurposes: () => ({}),
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, callbacks, open: true, layout: { mode: 'window', tab: 'settings' } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === 'Модели и API').click();
    const mode = root.querySelector('select[aria-label="Чем описывать картинки"]');
    assert.ok(mode);
    assert.match(root.textContent, /не Chat Completion API/);
    mode.value = 'profile';
    mode.dispatchEvent(new window.Event('change'));
    const profile = root.querySelector('select[aria-label="Профиль для картинок"]');
    profile.value = 'p1';
    const card = mode.closest('.card');
    [...card.querySelectorAll('button')].find(node => node.textContent === 'Проверить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.at(-1), ['test', { mode: 'profile', profileId: 'p1', url: '', key: '', model: '', maxTokens: 700 }]);
    [...card.querySelectorAll('button')].find(node => node.textContent === 'Сохранить').click();
    assert.equal(calls.at(-1)[1].wardrobeVision.mode, 'profile');
  } finally {
    studio?.destroy();
  }
});

test('settings → data: Horae records are found, shown and moved with the chosen parts', async () => {
  const calls = [];
  const snapshot = { ...sampleState(), chatKey: 'chat-1' };
  const callbacks = {
    onHoraeScan: () => ({ found: true, clock: '10/3, 23:10', day: 3, location: 'Храм', present: ['Майки'], outfits: 2, items: 0, places: 1, summaries: 4, unknown: ['Хина'] }),
    onHoraeImport: async options => { calls.push(options); return { operations: 5, scenes: 4, places: 1, created: ['Хина'], skippedScenes: 0 }; },
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, callbacks, open: true, layout: { mode: 'window', tab: 'settings' } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === 'Данные').click();
    [...root.querySelectorAll('button')].find(node => node.textContent === 'Найти записи Хорае в этом чате').click();
    const items = [...root.querySelectorAll('input[type=checkbox]')].find(node => node.getAttribute('aria-label').startsWith('Вещи'));
    assert.equal(items.disabled, true, 'nothing to bring is not offered');
    const outfits = [...root.querySelectorAll('input[type=checkbox]')].find(node => node.getAttribute('aria-label').startsWith('Одежда'));
    outfits.checked = false;
    [...root.querySelectorAll('button')].find(node => node.textContent === 'Перенести').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls[0], { chronicle: true, events: false, unhide: false, scene: true, outfits: false, items: false, places: true, createCharacters: true });
    assert.match(root.querySelector('.status').textContent, /сводок в хронику: 4[\s\S]*выключить Хорае/);
  } finally {
    studio?.destroy();
  }
});

test('settings → data: where pictures go — install hint without the plugin; folder, browse and move with it', async () => {
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const calls = [];
  let plugin = { installed: false };
  const snapshot = { ...sampleState(), settings: { ...(sampleState().settings ?? {}), imageStorage: 'server' } };
  const callbacks = {
    onImageStorageStatus: async () => ({ storage: snapshot.settings.imageStorage, plugin, counts: { server: 2, folder: 0 } }),
    onBrowseImageFolder: async () => 'D:\Картинки',
    onSetImageFolder: async ({ folder }) => { calls.push(['folder', folder]); plugin = { ...plugin, folder, ready: true, error: '' }; return folder; },
    onMoveImages: async ({ to }) => { calls.push(['move', to]); return { moved: 2, failed: 0, leftovers: 0 }; },
    onSettingsChange: ({ settings }) => { calls.push(['settings', settings]); Object.assign(snapshot.settings, settings); },
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, callbacks, open: true, layout: { mode: 'window', tab: 'settings' } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === 'Данные').click();
    await tick();
    const select = () => root.querySelector('select[aria-label="Где хранить картинки"]');
    assert.equal(select().querySelector('option[value=folder]').disabled, true, 'no plugin, no folder choice');
    assert.match(root.textContent, /server-plugin\/kulisy-images/);

    plugin = { installed: true, folder: '', ready: false, error: 'Папка не выбрана.', canBrowse: true, admin: true, version: '0.1.0' };
    studio.render?.();
    [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === 'Данные').click();
    await tick();
    select().value = 'folder';
    select().dispatchEvent(new window.Event('change'));
    assert.equal(select().value, 'server', 'a folder that is not ready cannot be chosen');
    assert.equal(calls.length, 0);
    [...root.querySelectorAll('button')].find(node => node.textContent === 'Обзор…').click();
    await tick();
    assert.equal(root.querySelector('input[aria-label="Папка для картинок"]').value, 'D:\Картинки');
    [...root.querySelectorAll('button')].find(node => node.textContent === 'Сохранить папку').click();
    await tick(); await tick();
    assert.deepEqual(calls[0], ['folder', 'D:\Картинки']);
    select().value = 'folder';
    select().dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls[1], ['settings', { imageStorage: 'folder' }]);
    studio.render?.();
    [...root.querySelectorAll('.set-nav button')].find(node => node.textContent === 'Данные').click();
    await tick();
    [...root.querySelectorAll('button')].find(node => node.textContent === 'Перенести в папку (2)').click();
    await tick(); await tick();
    assert.deepEqual(calls[2], ['move', 'folder']);
    assert.match(root.querySelector('.status').textContent, /перенесено: 2/);
  } finally {
    studio?.destroy();
  }
});
