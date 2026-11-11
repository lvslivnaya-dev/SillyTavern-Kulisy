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

test('"what the model gets": one card per block in request order, each saying what and where from, content in words, exact text apart', async () => {
  const { describeBlocks } = await import('../src/integration/prompt-overview.js');
  const knowledge = '[KULISY — WHO KNOWS WHAT, NARRATOR CONTROL DATA]\nscene: present=Майки; place=гараж\nstrangers[Майки & Судзу]\nunknown[Майки]: (secret) Разговор в подворотне\n\nRules:\n- unknown[X] lists events X did NOT witness.\n[/KULISY]';
  const relationships = 'Майки>Судзу;affection=42(теплеет),fear=-2\nshared-memories[Майки,Судзу]=Драка у моста [known only to: Майки,Судзу,Ран; everyone else is unaware]';
  let studio;
  const snapshot = {
    ...sampleState(),
    promptBlocks: describeBlocks({
      parts: { knowledge, relationships },
      tokens: { knowledge: 480, relationships: 1500 },
      enabled: { calendar: 'Выключено: «Календарь в промпт».' },
    }),
    loreGateReport: null,
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
    const titles = [...root.querySelectorAll('.pm-block .pm-title')].map(node => node.textContent);
    assert.deepEqual(titles.slice(0, 7), [
      'Хроника: что было раньше', 'Сцена: время, место, одежда, вещи', 'Календарь: какое сегодня число', 'Кто что знает',
      'Имена: как писать и склонять', 'Отношения: чувства, воспоминания, напряжения', 'Подсказка режиссёра',
    ]);
    assert.equal(titles.at(-1), 'Лорбуки: анкеты персонажей и мир');
    const blocks = [...root.querySelectorAll('.pm-block')];
    const knowledgeCard = blocks[3];
    assert.match(knowledgeCard.querySelector('.pm-pill').textContent, /уходит модели/);
    assert.match(knowledgeCard.querySelector('.pm-tokens').textContent, /480/);
    const meta = knowledgeCard.querySelector('.pm-meta').textContent;
    assert.match(meta, /Что это/);
    assert.match(meta, /Откуда берётся/);
    assert.match(meta, /Где в запросе/);
    assert.match(meta, /Знания в промпт/, 'как выключить: настоящее название переключателя');
    // The content in words: «Майки не знает», not the raw «unknown[Майки]:».
    const words = knowledgeCard.querySelector('.pm-fold').textContent;
    assert.match(words, /Майки не знает/);
    assert.match(words, /Разговор в подворотне/);
    assert.match(words, /Манджиро|Майки и Судзу/);
    assert.doesNotMatch(knowledgeCard.querySelector('.pm-items').textContent, /unknown\[/);
    // The exact text stays one fold away.
    assert.match(knowledgeCard.querySelector('.pm-raw').textContent, /unknown\[Майки\]: \(secret\)/);
    // Feelings as labelled numbers; the record says who else knows.
    const relation = blocks[5].textContent;
    assert.match(relation, /Привязанность 42/);
    assert.match(relation, /Страх -2/);
    assert.match(relation, /знают: Майки, Судзу, Ран/);
    // A switched-off block says why and shows no content; an empty one says it is empty.
    assert.match(blocks[2].querySelector('.pm-pill').textContent, /выключено/);
    assert.match(blocks[2].textContent, /Календарь в промпт/);
    assert.equal(blocks[2].querySelector('.pm-fold'), null);
    assert.match(blocks[1].querySelector('.pm-pill').textContent, /пока пусто/);
    // The bar and the total count only what is sent.
    assert.match(root.querySelector('.set-total').textContent, /1\s?980 токенов/);
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

test('secrets page: knower chips, scene status and waiting reveals', () => {
  const base = sampleState();
  const [ran, suzu] = Object.values(base.entities);
  const state = applyOperations(base, [
    createOperation('event.add', { item: { id: 'scars', text: 'Шрамы Судзу', witnessIds: [suzu.id], secret: true, lore: { book: 'Судзу', uid: 1 }, detail: 'Под одеждой шрамы' } }),
  ]);
  const snapshot = { ...state, pairs: base.pairs, reveals: [{ messageIndex: 3, entityId: ran.id, eventId: 'scars', name: 'Ран', eventText: 'Шрамы Судзу', how: '' }] };
  const calls = [];
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'secrets' }, callbacks: { onSetSecretKnower: payload => { calls.push(payload); } } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const shadow = studio.element.shadowRoot;
    const card = shadow.querySelector('.ku-secret-card');
    assert.ok(card, 'the secret is listed');
    assert.match(card.textContent, /лорбук «Судзу» · в сцене никто не знает: модель молчит/);
    assert.equal(shadow.querySelectorAll('.ku-knower[aria-pressed="true"]').length, 1, 'only Судзу knows');
    assert.match(shadow.textContent, /Ждут ответа · 1/);
  } finally { studio?.destroy(); }
});

test('triangle setup: every line gets its own per-scale pace editor', () => {
  const base = sampleState();
  const [ran, suzu, mikey] = Object.values(base.entities);
  const snapshot = { ...base, ui: { ...base.ui, triangles: [{ id: 'tri', name: 'Тест', centerId: suzu.id, firstId: ran.id, secondId: mikey.id }] } };
  const lines = base.pairs.map(pair => ({ relationshipId: pair.id, label: `${pair.from}→${pair.to}` }));
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'triangles' }, callbacks: { onTriangleLines: () => lines, onPairTropes: () => [], onTriangleTropes: () => [] } });
    [...studio.element.shadowRoot.querySelectorAll('button')].find(item => item.textContent === 'Цель и факторы')?.click();
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const editors = studio.element.shadowRoot.querySelectorAll('.pace-editor');
    assert.equal(editors.length, lines.length);
    assert.ok(editors[0].querySelectorAll('select').length >= 10, 'a select per scale');
  } finally { studio?.destroy(); }
});

test('line factors: the model\'s reading of the pair is shown, list factors keep their lines', () => {
  const base = sampleState();
  const pair = base.pairs[0];
  pair.factors = [{ scaleId: 'trust', direction: 'up', text: 'Слово:\n• держит слово\n• прикрывает\n• молчит о тайне' }];
  const snapshot = { ...base, ui: { ...base.ui, analyses: { [pair.id]: { subject: 'Ран ценит силу.', object: 'Судзу тихая.', dynamic: 'Он старше.' } } } };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'overview' }, callbacks: { onPairTropes: () => [], onDirectionPresets: () => [] } });
    studio.open?.();
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const shadow = studio.element.shadowRoot;
    const open = [...shadow.querySelectorAll('button')].find(item => /Факторы роста/.test(item.textContent));
    assert.ok(open, 'a factors button on the overview');
    open.click();
    const box = shadow.querySelector('.factor-analysis');
    assert.ok(box && !box.hidden, 'analysis shown');
    assert.match(box.textContent, /Чьи чувства: Ран ценит силу/);
    assert.match(shadow.querySelector('.factor-row textarea').value, /\n• прикрывает\n/);
  } finally { studio?.destroy(); }
});

test('persona page: binding and the hidden character field', () => {
  const base = sampleState();
  const snapshot = { ...base, personaBoundName: 'Судзу', personaAvatar: 'suzu.png', personaPrivate: 'Колючая', tavernPersonas: [{ avatarId: 'suzu.png', name: 'Судзу' }] };
  const calls = [];
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'persona' }, callbacks: { onSetPersonaPrivate: payload => { calls.push(payload); } } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const shadow = studio.element.shadowRoot;
    const field = shadow.querySelector('textarea[aria-label="Скрытый характер персоны"]');
    assert.equal(field.value, 'Колючая');
    field.value = 'Колючая, но теряется от нежности';
    [...shadow.querySelectorAll('button')].find(item => item.textContent === 'Сохранить').click();
    assert.deepEqual(calls, [{ text: 'Колючая, но теряется от нежности' }]);
    assert.ok([...shadow.querySelectorAll('.sidebar button')].some(item => item.textContent === 'Персона: Судзу'), 'the sidebar links to the page');
  } finally { studio?.destroy(); }
});

test('calendar page: month grid with events, a day, the editor and the generator drafts', async () => {
  const base = sampleState();
  const snapshot = {
    ...base,
    world: { clock: { day: 2, time: '14:20' } },
    calendarToday: '2025-04-08',
    calendar: { anchor: '2025-04-07', events: [
      { id: 'e1', title: 'Контрольная по анатомии', date: '2025-04-08', time: '10:00', repeat: 'none', must: true },
      { id: 'e2', title: 'Анатомия', date: '2025-04-07', repeat: 'weekly', weekdays: [2, 4] },
    ] },
    calendarTemplates: [{ id: 't1', name: 'Ветеринар', startMonth: 4, events: [{ title: 'Сессия', date: '07-20', repeat: 'none' }] }],
  };
  const calls = [];
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'calendar' }, callbacks: {
      onCalendarGenerate: async () => ({ name: 'Год', startMonth: 4, events: [{ title: 'Церемония поступления', date: '04-05', repeat: 'none', must: true }] }),
      onCalendarApplyTemplate: payload => { calls.push(payload); return Promise.resolve(1); },
      onCalendarSaveEvent: payload => { calls.push(payload); return Promise.resolve(); },
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const shadow = studio.element.shadowRoot;
    assert.equal(shadow.querySelectorAll('.ku-cal-cell').length, 42);
    assert.ok(shadow.querySelector('.ku-cal-cell.today.must'), 'today is marked, with a must event');
    assert.match(shadow.textContent, /Апрель 2025/);
    assert.match(shadow.textContent, /10:00 · Контрольная по анатомии/);
    assert.match(shadow.textContent, /Сегодня в истории: вторник, 8 апреля 2025 \(день 2\)/);
    [...shadow.querySelectorAll('button')].find(item => item.textContent === '+ Событие').click();
    const title = shadow.querySelector('.ku-cal-editor input');
    title.value = 'Практика';
    title.dispatchEvent(new window.Event('input'));
    [...shadow.querySelectorAll('.ku-cal-editor button')].find(item => item.textContent === 'Сохранить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(calls[0].event.title, 'Практика');
    assert.equal(calls[0].event.date, '2025-04-08');
    [...shadow.querySelectorAll('button')].find(item => item.textContent === 'Сгенерировать').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(shadow.textContent, /Церемония поступления/);
    [...shadow.querySelectorAll('button')].find(item => item.textContent === 'Добавить отмеченные в календарь').click();
    assert.deepEqual(calls.at(-1).indexes, [0]);
    assert.equal(Number(calls.at(-1).year), 2025);
  } finally { studio?.destroy(); }
});

test('names page: the library card, adding a name, editing a form, the switches', async () => {
  const calls = [];
  const snapshot = {
    ...sampleState(),
    names: { version: 1, enabled: true, entries: [
      { id: 'n1', name: 'Рён Хайтани', aliases: ['Рён'], gender: 'm', off: false, words: [
        { word: 'Рён', same: false, gen: 'Рёна', dat: '', acc: '', ins: '', pre: '' },
        { word: 'Хайтани', same: true, gen: '', dat: '', acc: '', ins: '', pre: '' },
      ] },
    ] },
    namesChatOff: false,
    namesTokens: 42,
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'names' }, callbacks: {
      onNamesAdd: payload => { calls.push(['add', payload]); return Promise.resolve(); },
      onNamesUpdate: payload => { calls.push(['update', payload]); return Promise.resolve(); },
      onNamesChatOff: payload => { calls.push(['chat', payload]); return Promise.resolve(); },
      onNamesRemove: payload => { calls.push(['remove', payload]); return Promise.resolve(); },
      onNamesFill: async () => ({ filled: 1, failed: 0, asked: 1 }),
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    assert.match(root.textContent, /Библиотека · 1/);
    assert.match(root.textContent, /Сейчас в запросе: 42 ток\./);
    assert.match(root.querySelector('.ku-names-card summary').textContent, /Рён Хайтани.*не все падежи/);
    // Add a name with other spellings.
    const [name, aliases] = root.querySelectorAll('.ku-names-add input');
    name.value = 'Манджиро Сано';
    name.dispatchEvent(new window.Event('input'));
    aliases.value = 'Майки, Манджиро';
    aliases.dispatchEvent(new window.Event('input'));
    [...root.querySelectorAll('button')].find(item => item.textContent === 'Добавить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls[0], ['add', { name: 'Манджиро Сано', aliases: ['Майки', 'Манджиро'], gender: '', folderId: '' }]);
    // A form typed into a card goes as one word.
    const details = root.querySelector('.ku-names-card');
    details.open = true;
    const dative = details.querySelector('input[aria-label="Рён: дат."]');
    dative.value = 'Рёну';
    dative.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.at(-1), ['update', { id: 'n1', patch: { words: [{ word: 'Рён', dat: 'Рёну' }] } }]);
    // A word that does not decline has no form fields.
    assert.equal(details.querySelectorAll('.ku-names-word')[1].querySelector('.ku-names-forms'), null);
    // «Выключить в этом чате».
    const chat = [...root.querySelectorAll('.ku-names-opt input')][1];
    chat.checked = true;
    chat.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.at(-1), ['chat', { off: true }]);
    // Bulk delete: tick, press once (it asks), press again.
    const remove = () => [...root.querySelectorAll('.ku-names-bulk button')].find(item => /^(Удалить|Точно удалить)/.test(item.textContent));
    assert.equal(remove().disabled, true);
    root.querySelector('.ku-names-pick').click();
    assert.match(remove().textContent, /Удалить \(1\)/);
    remove().click();
    assert.match(remove().textContent, /Точно удалить 1\?/);
    assert.equal(calls.filter(call => call[0] === 'remove').length, 0, 'the first press deletes nothing');
    remove().click();
    assert.deepEqual(calls.at(-1), ['remove', { ids: ['n1'] }]);
  } finally { studio?.destroy(); }
});

test('weather page: now, the week, the climate, ready scenarios, setting by hand', async () => {
  const calls = [];
  const snapshot = {
    ...sampleState(),
    world: { clock: { day: 5, time: '14:20' } },
    weather: { kind: 'rain', temp: 14, text: 'моросит', source: 'set' },
    weatherSet: { kind: 'rain', temp: 14, text: 'моросит', day: 5 },
    weatherPlan: { climateId: 'tokyo', month: 0, scenarios: [{ id: 'typhoon-8', name: 'Тайфун', startDay: 8, days: 2, kind: 'storm', tempDelta: -3, text: 'шквал' }] },
    weatherDated: false,
    weatherClimates: [{ id: 'tokyo', name: 'Токио и центральная Япония', builtin: true, months: Array.from({ length: 12 }, () => ({ min: 2, max: 10, kinds: { clear: 5, rain: 2 } })) }],
    weatherScenarios: [{ id: 'typhoon', name: 'Тайфун', days: 2, kind: 'storm', tempDelta: -3, text: 'шквал' }],
    weatherWeek: [
      { day: 5, date: '', kind: 'rain', temp: 14, source: 'set' },
      { day: 6, date: '', kind: 'clear', temp: 9, source: 'forecast' },
      { day: 8, date: '', kind: 'storm', temp: 6, source: 'scenario', scenario: 'Тайфун' },
    ],
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'weather' }, callbacks: {
      onSetWeather: payload => { calls.push(['set', payload]); return Promise.resolve(); },
      onWeatherScenario: payload => { calls.push(['scenario', payload]); return Promise.resolve(); },
      onWeatherPlan: payload => { calls.push(['plan', payload]); return Promise.resolve(); },
      onWeatherScenarioRemove: payload => { calls.push(['remove', payload]); return Promise.resolve(); },
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    assert.match(root.querySelector('.ku-wx-now').textContent, /Дождь · \+14°/);
    assert.match(root.querySelector('.ku-wx-now').textContent, /моросит/);
    assert.equal(root.querySelectorAll('.ku-wx-day').length, 3);
    assert.match(root.querySelector('.ku-wx-day.scenario').textContent, /«Тайфун»/);
    assert.match(root.textContent, /Даты истории нет/, 'no date: the month is asked for');
    // By hand: pick a kind, type, apply.
    [...root.querySelectorAll('.ku-wx-kinds button')].find(item => /Снег/.test(item.textContent)).click();
    const [temp, text] = root.querySelectorAll('.ku-wx-fields input');
    temp.value = '-2'; temp.dispatchEvent(new window.Event('input'));
    text.value = 'мелкий снег'; text.dispatchEvent(new window.Event('input'));
    [...root.querySelectorAll('button')].find(item => item.textContent === 'Задать погоду').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.at(-1), ['set', { kind: 'snow', temp: '-2', text: 'мелкий снег', lock: false }]);
    // A ready scenario from a day.
    const start = root.querySelector('.ku-wx-scenario input');
    start.value = '9'; start.dispatchEvent(new window.Event('input'));
    [...root.querySelectorAll('.ku-wx-scenario button')][0].click();
    assert.deepEqual(calls.at(-1), ['scenario', { templateId: 'typhoon', startDay: '9' }]);
    // Hand the weather back to the forecast; take a scenario out.
    [...root.querySelectorAll('button')].find(item => item.textContent === 'Вернуть прогнозу').click();
    assert.deepEqual(calls.at(-1), ['set', { clear: true }]);
    root.querySelector('.ku-fact button').click();
    assert.deepEqual(calls.at(-1), ['remove', { id: 'typhoon-8' }]);
  } finally { studio?.destroy(); }
});

test('names page: folders hold names, switch as a whole, and the ticked ones are switched and moved together', async () => {
  const calls = [];
  const word = text => ({ word: text, same: true, gen: '', dat: '', acc: '', ins: '', pre: '' });
  const entry = (id, name, folderId, off = false) => ({ id, name, aliases: [], gender: '', off, folderId, words: [word(name)] });
  const snapshot = {
    ...sampleState(),
    names: { version: 1, enabled: true, folders: [{ id: 'f1', name: 'Токийские мстители', off: false }, { id: 'f2', name: 'Магическая битва', off: true }], entries: [entry('a', 'Майки', 'f1'), entry('b', 'Санзу', 'f1'), entry('c', 'Юта', 'f2'), entry('d', 'Мими', '')] },
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'names' }, callbacks: {
      onNamesFolderAdd: payload => { calls.push(['folder-add', payload]); return Promise.resolve(); },
      onNamesFolderUpdate: payload => { calls.push(['folder-update', payload]); return Promise.resolve(); },
      onNamesFolderRemove: payload => { calls.push(['folder-remove', payload]); return Promise.resolve(); },
      onNamesBulk: payload => { calls.push(['bulk', payload]); return Promise.resolve(); },
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    const groups = [...root.querySelectorAll('.ku-names-group')];
    assert.deepEqual(groups.map(group => group.querySelector('.ku-names-folder-name, .ku-names-folder-title').value ?? group.querySelector('.ku-names-folder-title').textContent), ['Токийские мстители', 'Магическая битва', 'Без папки']);
    assert.deepEqual(groups.map(group => group.querySelectorAll('.ku-names-card').length), [2, 1, 1]);
    assert.ok(groups[1].querySelector('.ku-names-folder.off'), 'the folder is off');
    assert.ok(groups[1].querySelector('.ku-names-card.off'), 'its names look off too');
    // A new folder.
    const input = root.querySelector('.ku-names-bulk input');
    input.value = 'One Piece';
    [...root.querySelectorAll('.ku-names-bulk button')].find(item => item.textContent === 'Создать папку').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.at(-1), ['folder-add', { name: 'One Piece' }]);
    // The whole folder off, renamed, deleted.
    groups[0].querySelector('.ku-names-send').click();
    assert.deepEqual(calls.at(-1), ['folder-update', { id: 'f1', off: true }]);
    const name = groups[0].querySelector('.ku-names-folder-name');
    name.value = 'ТМ';
    name.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.at(-1), ['folder-update', { id: 'f1', name: 'ТМ' }]);
    groups[0].querySelector('.ku-names-folder button[title^="Удалить папку"]').click();
    assert.deepEqual(calls.at(-1), ['folder-remove', { id: 'f1' }]);
    // Tick the whole first folder: switch off / on / move.
    const barButton = label => [...root.querySelectorAll('.ku-names-bulk button')].find(item => item.textContent === label);
    assert.equal(barButton('Выключить').disabled, true, 'nothing ticked yet');
    root.querySelectorAll('.ku-names-group')[0].querySelector('.ku-names-folder .ku-names-pick').click();
    barButton('Выключить').click();
    assert.deepEqual(calls.at(-1), ['bulk', { ids: ['a', 'b'], off: true }]);
    barButton('Включить').click();
    assert.deepEqual(calls.at(-1), ['bulk', { ids: ['a', 'b'], off: false }]);
    const move = root.querySelector('.ku-names-move');
    move.value = 'f2';
    move.dispatchEvent(new window.Event('change'));
    assert.deepEqual(calls.at(-1), ['bulk', { ids: ['a', 'b'], folderId: 'f2' }]);
  } finally { studio?.destroy(); }
});

test('dice page: groups with their options, switching, hiding and adding your own', async () => {
  const calls = [];
  const snapshot = {
    ...sampleState(),
    dice: { avoidRepeat: true, historyCount: 2, groups: [
      { id: 'pace', label: 'Темп', icon: '🕰', off: false, options: [{ id: 'tender', text: 'нежно', hidden: false }, { id: 'rough', text: 'грубо', hidden: true }, { id: 'c1', text: 'под дождём', hidden: false, custom: true }] },
      { id: 'mood', label: 'Настроение', icon: '🎭', off: true, options: [{ id: 'shy', text: 'смущённо', hidden: false }] },
    ] },
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'dice' }, callbacks: {
      onDiceSettings: payload => { calls.push(payload.patch); return Promise.resolve(); },
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    assert.match(root.textContent, /персона никогда не ведёт/);
    assert.equal(root.querySelectorAll('.ku-dice-group').length, 2);
    assert.ok(root.querySelectorAll('.ku-dice-group')[1].classList.contains('off'));
    assert.ok(root.querySelector('.ku-dice-option.off'), 'a hidden option looks struck out');
    const groups = [...root.querySelectorAll('.ku-dice-group')];
    // Hide an option.
    groups[0].querySelectorAll('.ku-dice-option input')[0].click();
    assert.deepEqual(calls.at(-1), { group: 'pace', option: 'tender', hidden: true });
    // Switch a group.
    groups[1].querySelector('.ku-dice-head input').click();
    assert.deepEqual(calls.at(-1), { group: 'mood', off: false });
    // Add your own.
    const input = groups[0].querySelector('.row input');
    input.value = 'в тишине';
    input.dispatchEvent(new window.Event('input'));
    [...groups[0].querySelectorAll('button')].find(item => item.textContent === 'Добавить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.at(-1), { group: 'pace', addCustom: 'в тишине' });
    // Remove an own one; forget the history.
    groups[0].querySelector('.ku-dice-option button').click();
    assert.deepEqual(calls.at(-1), { group: 'pace', removeCustom: 'c1' });
    [...root.querySelectorAll('button')].find(item => /Забыть прошлые броски \(2\)/.test(item.textContent)).click();
    assert.deepEqual(calls.at(-1), { clearHistory: true });
  } finally { studio?.destroy(); }
});

test('own calendar: the grid follows its weekdays and months, dates are typed as day / month / year', async () => {
  const { normalizeSystem } = await import('../src/core/calendar-system.js');
  const system = normalizeSystem({
    id: 's1', name: 'Мой мир', era: 'эры Огня', startWeekday: 1,
    weekdays: ['Первень', 'Второй', 'Третий', 'Четвёртый', 'Пятый'].map(name => ({ name, short: name.slice(0, 2) })),
    seasons: [{ id: 'warm', name: 'Тепло', min: 14, max: 24, kinds: { clear: 4 } }],
    months: [{ name: 'Льдов', days: 20, season: 'warm' }, { name: 'Цветов', days: 25, season: 'warm' }],
  });
  const calls = [];
  const snapshot = {
    ...sampleState(),
    world: { clock: { day: 3, time: '14:20' } },
    calendarToday: '0014-02-03',
    calendar: { anchor: '0014-02-01', system, events: [{ id: 'e1', title: 'Праздник цветов', date: '0014-02-03', repeat: 'none', must: true }] },
    calendarTemplates: [],
    calendarSystems: [{ ...system, ready: true, id: 'ready-x', name: 'Готовый' }, { ...system, id: 'mine', name: 'Мой сохранённый' }],
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'calendar' }, callbacks: {
      onCalendarSaveEvent: payload => { calls.push(['event', payload]); return Promise.resolve(); },
      onCalendarSetToday: payload => { calls.push(['today', payload]); return Promise.resolve(); },
    } });
  });
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    assert.deepEqual([...root.querySelectorAll('.ku-cal-head')].map(node => node.textContent), ['Пе', 'Вт', 'Тр', 'Че', 'Пя']);
    assert.match(root.querySelector('.ku-cal-title').textContent, /Цветов 14 эры Огня/);
    // Month 2 of year 14 has 25 days in a five-day week: five full rows, and day 3 is marked.
    assert.equal(root.querySelectorAll('.ku-cal-cell').length, 25);
    assert.ok(root.querySelector('.ku-cal-cell.today.must'));
    assert.match(root.textContent, /Сегодня в истории: .*3 Цветов, 14 год эры Огня/);
    // The date of the story is three fields, not the browser's picker.
    const today = root.querySelector('.ku-cal-date');
    assert.ok(today, 'day / month / year');
    assert.equal(root.querySelector('input[type="date"]'), null);
    assert.equal(today.value, '0014-02-03');
    const [day] = today.querySelectorAll('input');
    day.value = '7';
    assert.equal(today.value, '0014-02-07');
    [...root.querySelectorAll('button')].find(item => item.textContent === 'Запомнить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(calls.at(-1), ['today', { date: '0014-02-07' }]);
    // The template block explains why it is not here.
    assert.match(root.textContent, /Шаблоны и генератор года сделаны для земного календаря/);
    // Next month of the last month: the year goes up.
    const next = [...root.querySelectorAll('button')].find(item => item.getAttribute('title') === 'Следующий месяц');
    next.click();
    assert.match(root.querySelector('.ku-cal-title').textContent, /Льдов 15/);
  } finally { studio?.destroy(); }
});

test('calendar builder: make one, change it, apply with a second press, keep it, copy a ready one', async () => {
  const calls = [];
  const snapshot = {
    ...sampleState(),
    world: { clock: { day: 0, time: '' } },
    calendarToday: '',
    calendar: { anchor: '', events: [] },
    calendarTemplates: [],
    calendarSystems: [{
      id: 'ready-x', name: 'Готовый мир', ready: true, startWeekday: 1,
      weekdays: [{ name: 'Раз', short: 'Рз' }, { name: 'Два', short: 'Дв' }],
      seasons: [{ id: 'a', name: 'Весна', min: 5, max: 15, kinds: { rain: 2 } }],
      months: [{ name: 'Месяц-один', days: 40, season: 'a' }],
    }],
  };
  let studio;
  const errors = captureErrors(() => {
    studio = createRelationshipStudio({ store: { getSnapshot: () => snapshot }, open: true, layout: { mode: 'window', tab: 'calendar' }, callbacks: {
      onCalendarSetSystem: payload => { calls.push(['set', payload]); return Promise.resolve(); },
      onCalendarSaveSystem: payload => { calls.push(['save', payload]); return Promise.resolve('id'); },
    } });
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    assert.deepEqual(errors, [], errors.join('\n'));
    const root = studio.element.shadowRoot;
    const press = label => [...root.querySelectorAll('button')].find(item => item.textContent === label);
    assert.match(root.textContent, /земной календарь/);
    press('Создать свой календарь').click();
    assert.equal(root.querySelectorAll('.ku-cb-editor .ku-cb-row').length, 7 + 12, 'seven weekdays and twelve months to start from');
    assert.equal(root.querySelectorAll('.ku-cb-season').length, 4);
    // Change the name, a weekday and a month; add a month; remove a weekday.
    const name = root.querySelector('.ku-cb-editor input[aria-label="Название календаря"]');
    name.value = 'Мир Пепла';
    name.dispatchEvent(new window.Event('input'));
    const dayName = root.querySelector('.ku-cb-editor input[aria-label="День недели 1: название"]');
    dayName.value = 'Солнцедень';
    dayName.dispatchEvent(new window.Event('input'));
    press('+ Месяц').click();
    assert.equal(root.querySelectorAll('.ku-cb-month').length, 13);
    root.querySelector('.ku-cb-editor button[title="Убрать день недели"]').click();
    assert.equal(root.querySelectorAll('.ku-cb-editor .ku-cb-row:not(.ku-cb-month)').length, 6);
    // A season's weather is taken from a ready climate.
    root.querySelector('.ku-cb-season button[title^="Скопировать температуру"]').click();
    assert.match(root.querySelector('.ku-cb-season summary').textContent, /-?\d+…-?\d+°/);
    // Apply: the first press only asks.
    press('Применить к этому чату').click();
    assert.equal(calls.length, 0);
    press('Точно применить? Дата и события чата очистятся').click();
    await settle();
    assert.equal(calls.at(-1)[0], 'set');
    const applied = calls.at(-1)[1].system;
    assert.equal(applied.name, 'Мир Пепла');
    assert.equal(applied.weekdays.length, 6);
    assert.equal(applied.weekdays[0].name, 'День 2', 'the first weekday was removed (the renamed one with it)');
    assert.equal(applied.months.length, 13);
    assert.ok(applied.seasons[0].kinds, 'the weather of the first season is in');
    // Keep in the library.
    press('Создать свой календарь').click();
    press('Сохранить в библиотеку').click();
    await settle();
    assert.equal(calls.at(-1)[0], 'save');
    // A ready calendar: «Копию править» makes a new calendar; «Применить» asks twice.
    press('Закрыть редактор').click();
    press('Копию править').click();
    assert.match(root.querySelector('.ku-cb-editor input[aria-label="Название календаря"]').value, /Готовый мир \(моя копия\)/);
    press('Закрыть редактор').click();
    [...root.querySelectorAll('.ku-fact button')].find(item => item.textContent === 'Применить').click();
    assert.equal(calls.filter(call => call[0] === 'set').length, 1, 'the first press only asks');
    [...root.querySelectorAll('.ku-fact button')].find(item => /^Точно/.test(item.textContent)).click();
    await settle();
    assert.equal(calls.at(-1)[1].system.id, 'ready-x');
  } finally { studio?.destroy(); }
});
