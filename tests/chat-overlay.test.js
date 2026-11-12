import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="chat">
    <div class="mes" mesid="3"><div class="mes_block"><div class="mes_text">Раньше</div></div></div>
    <div class="mes" mesid="4"><div class="mes_block"><div class="mes_text">Ты же была в подворотне?</div><div class="mes_bias"></div></div></div>
  </div>
  <div id="form_sheld"><div id="send_form"><textarea id="send_textarea"></textarea></div></div>
</body></html>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
const { mountChatOverlay } = await import('../src/integration/chat-overlay.js');

const view = (overrides = {}) => ({
  chips: true,
  cast: [
    { id: 'm', name: 'Майки', present: true, persona: false },
    { id: 's', name: 'Судзу', present: true, persona: true },
    { id: 'r', name: 'Ран', present: false, persona: false },
  ],
  location: 'гараж',
  leaks: [{ messageIndex: 4, entityId: 'm', eventId: 'alley', name: 'Майки', eventText: 'Разговор в подворотне', quote: 'Ты же была в подворотне?', canSwipe: true }],
  ...overrides,
});

const tileOf = (bar, name) => [...bar.querySelectorAll('.ku-tile')].find(item => item.querySelector('.ku-tile-name').textContent === name);

test('the drawer is a side panel: a rail on the wall always, the panel beside it only when opened', () => {
  const toggles = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onToggleOpen: open => toggles.push(open) });
  try {
    overlay.render(view());
    const bar = document.getElementById('ku-scene-chips');
    assert.equal(bar.parentElement, document.body, 'it hangs on the browser, not above the message box');
    assert.ok(bar.classList.contains('ku-side'));
    assert.equal(bar.classList.contains('open'), false);
    assert.equal(bar.querySelectorAll('.ku-chip').length, 0, 'closed: the panel is empty, only the rail');
    assert.ok(bar.querySelector('.ku-rail .ku-rail-toggle'), 'the rail has its fold button');
    assert.match(tileOf(bar, 'Кто').textContent, /2 на сцене/, 'the tabs are on the rail even when the panel is folded');
    bar.querySelector('.ku-rail-toggle').click();
    assert.deepEqual(toggles, [true], 'the rail button unfolds the panel');
    tileOf(bar, 'Кто').click();
    assert.deepEqual(toggles, [true, true], 'a tab pressed on a folded panel unfolds it on that tab');
    overlay.render(view({ director: { open: true } }));
    const chips = [...bar.querySelectorAll('.ku-chip')];
    assert.deepEqual(chips.map(chip => chip.querySelector('.ku-chip-name').textContent), ['Майки', 'Судзу', 'Ран']);
    assert.equal(chips[2].classList.contains('on'), false);
    assert.match(bar.querySelector('.ku-tile-stack').textContent, /гараж/, 'time and place are strips on the rail');
    assert.equal(bar.querySelectorAll('.ku-tile-stack .ku-strip').length, 2, 'time and place (secrets only when there are some)');
    assert.match(bar.querySelector('.ku-dir-head').textContent, /Кто на сцене/, 'the head names the tab');
    // Open: clicking the head or a chip does not fold it; the rail button and the tab that is already on do.
    bar.querySelector('.ku-dir-head').click();
    chips[0].click();
    assert.deepEqual(toggles, [true, true]);
    bar.querySelector('.ku-rail-toggle').click();
    assert.deepEqual(toggles, [true, true, false]);
    tileOf(bar, 'Кто').click();
    assert.deepEqual(toggles, [true, true, false, false], 'the same tab again folds the panel into the rail');
  } finally { overlay.unmount(); }
  assert.equal(document.getElementById('ku-scene-chips'), null, 'unmount cleans up');
});

test('a leak note goes right under the reply text, with its answers', () => {
  const actions = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: (action, payload) => actions.push([action, payload]) });
  try {
    overlay.render(view());
    const block = document.querySelector('.mes[mesid="4"] .mes_block');
    const note = block.querySelector('.ku-leak');
    assert.equal(note.previousElementSibling.className, 'mes_text');
    assert.match(note.textContent, /Майки ведёт себя так, будто знает: «Разговор в подворотне»/);
    assert.equal(document.querySelectorAll('.ku-leak').length, 1, 'only on that reply');
    for (const label of ['Свайп', 'Он знает', 'Не утечка']) [...note.querySelectorAll('button')].find(button => button.textContent === label).click();
    const payload = { messageIndex: 4, entityId: 'm', eventId: 'alley' };
    assert.deepEqual(actions, [['swipe', payload], ['knows', payload], ['dismiss', payload]]);
    overlay.render(view({ leaks: [] }));
    assert.equal(document.querySelectorAll('.ku-leak').length, 0, 'a resolved leak disappears');
  } finally { overlay.unmount(); }
});

test('no swipe button on an older reply; chips hidden when switched off', () => {
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {} });
  try {
    overlay.render(view({ chips: false, leaks: [{ ...view().leaks[0], canSwipe: false }] }));
    assert.equal(document.getElementById('ku-scene-chips'), null);
    const labels = [...document.querySelectorAll('.ku-leak button')].map(button => button.textContent);
    assert.deepEqual(labels, ['Он знает', 'Не утечка']);
  } finally { overlay.unmount(); }
});

test('names and quotes from the chat are text, never HTML', () => {
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {} });
  try {
    const evil = '<img src=x onerror="globalThis.pwned=1">';
    overlay.render(view({
      director: { open: true },
      cast: [{ id: 'x', name: evil, present: true, persona: false }],
      leaks: [{ messageIndex: 4, entityId: 'x', eventId: 'e', name: evil, eventText: evil, quote: evil, canSwipe: false }],
    }));
    assert.equal(document.querySelector('#ku-scene-chips img'), null);
    assert.equal(document.querySelector('.ku-leak img'), null);
    assert.match(document.querySelector('.ku-chip-name').textContent, /<img/);
  } finally { overlay.unmount(); }
});

test('director: a chip opens its menu; a kick is armed with the chosen wait; the menu folds after', async () => {
  const cues = [];
  const describe = id => ({
    name: { m: 'Майки', r: 'Ран' }[id], persona: false, present: id === 'm',
    reactTargets: [{ id: 's', name: 'Судзу' }],
    lines: [{ targetId: 's', targetName: 'Судзу', factors: [{ label: 'Заступается', text: 'Заступается: • при всех' }] }],
    secrets: [{ eventId: 'e1', label: 'Сломанная рука', text: 'Сломанная рука — давно' }],
  });
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, describe, onCue: cue => { cues.push(cue); return true; } });
  try {
    const open = view({ director: { open: true, cues: [], others: [{ id: 'k', name: 'Какучо' }] } });
    overlay.render(open);
    const bar = document.getElementById('ku-scene-chips');
    const click = label => [...bar.querySelectorAll('button')].find(button => button.textContent.startsWith(label)).click();
    bar.querySelector('.ku-chip[data-entity-id="m"]').click();
    assert.ok(bar.querySelector('.ku-dir-card'), 'the menu of Майки');
    click('через 2');
    click('👟 Вступить');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'enter', entityId: 'm', wait: 2 });
    assert.equal(bar.querySelector('.ku-dir-card'), null, 'the menu folds after a kick');

    bar.querySelector('.ku-chip[data-entity-id="m"]').click();
    click('❤ Двинуть');
    click('Заступается');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'factor', entityId: 'm', targetId: 's', text: 'Заступается: • при всех', label: 'Заступается', wait: 0 });

    bar.querySelector('.ku-chip[data-entity-id="m"]').click();
    click('✍ Своё');
    const input = bar.querySelector('[data-ku-field="custom"]');
    input.value = 'пусть приревнует';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    overlay.render(open);
    assert.equal(bar.querySelector('[data-ku-field="custom"]').value, 'пусть приревнует', 'a re-render keeps what is typed');
    bar.querySelector('[data-ku-field="custom"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'custom', entityId: 'm', text: 'пусть приревнует', wait: 0 });

    // Someone off stage: only «call» and the quiet mark.
    bar.querySelector('.ku-chip[data-entity-id="r"]').click();
    assert.equal([...bar.querySelectorAll('.ku-dir-card button')].some(button => button.textContent.includes('Вступить')), false);
    click('🚪 Позвать');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cues.at(-1).kind, 'call');
  } finally { overlay.unmount(); }
});

test('director: queue tags can be taken back; Alt+digit kicks the n-th on stage', () => {
  const removed = [];
  const cues = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onRemoveCue: id => removed.push(id), onCue: cue => cues.push(cue) });
  try {
    overlay.render(view({ director: { open: true, hotkeys: true, cues: [{ id: 'c1', kind: 'hold', entityId: 'm', label: 'Майки молчит', badge: '🤐', used: true, wait: 0 }] } }));
    const tag = document.querySelector('.ku-dir-tag');
    assert.match(tag.textContent, /Майки молчит ✓/);
    tag.querySelector('button').click();
    assert.deepEqual(removed, ['c1']);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true }));
    assert.deepEqual(cues, [{ kind: 'enter', entityId: 'm', wait: 0 }], 'Alt+1 → Майки (the persona is skipped)');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit2', altKey: true, bubbles: true }));
    assert.equal(cues.length, 1, 'Alt+2: the persona and the absent are not counted');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit1', altKey: true, ctrlKey: true, bubbles: true }));
    assert.equal(cues.length, 1, 'AltGr (Ctrl+Alt) is not a hotkey');
  } finally { overlay.unmount(); }
});

test('director: «🎬 Сцена» collects text, time, place and cast; «Начать сейчас» sends right after', async () => {
  const cues = [];
  let kicked = 0;
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onCue: cue => { cues.push(cue); return true; }, onKickNow: () => { kicked += 1; } });
  try {
    const open = view({ director: { open: true, cues: [], places: [{ id: 'deck', name: 'Палуба' }], people: [{ id: 'm', name: 'Майки' }, { id: 'r', name: 'Ран' }] } });
    overlay.render(open);
    const bar = document.getElementById('ku-scene-chips');
    const click = label => [...bar.querySelectorAll('button')].find(button => button.textContent.startsWith(label)).click();
    tileOf(bar, 'Сцена').click();
    const text = bar.querySelector('[data-ku-field="scene"]');
    text.value = 'утро после драки';
    text.dispatchEvent(new window.Event('input', { bubbles: true }));
    click('на следующий день');
    const select = bar.querySelector('[data-ku-field="place-id"]');
    select.value = 'deck';
    select.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(bar.querySelector('[data-ku-field="place"]').value, 'Палуба', 'the chosen place fills the words');
    bar.querySelector('[data-ku-action="dir-cast"][data-entity-id="r"]').click();
    assert.equal(bar.querySelector('[data-ku-field="scene"]').value, 'утро после драки', 'kept through re-renders');
    click('▶ Начать сейчас');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'scene', text: 'утро после драки', skip: 'nextday', castIds: ['r'], placeId: 'deck', place: 'Палуба', wait: 0 });
    assert.equal(kicked, 1);
    assert.equal(bar.querySelector('[data-ku-field="scene"]'), null, 'the card folds after');

    tileOf(bar, 'Рассказчику').click();
    const note = bar.querySelector('[data-ku-field="note"]');
    note.value = 'короче';
    note.dispatchEvent(new window.Event('input', { bubbles: true }));
    note.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'note', text: 'короче', wait: 0 });
    assert.equal(kicked, 1, 'a note waits for the post');
  } finally { overlay.unmount(); }
});

test('the drawer has the scene type: three buttons when open, a mark when closed and not calm', async () => {
  const modes = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onSceneMode: mode => { modes.push(mode); } });
  try {
    overlay.render(view({ sceneMode: 'intim', director: { open: true } }));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(tileOf(bar, 'Тип').textContent, /Близость/, 'the tile shows the type');
    assert.equal(bar.querySelector('.ku-dir-mode'), null, 'the choice opens from the tile');
    tileOf(bar, 'Тип').click();
    const buttons = [...bar.querySelectorAll('.ku-dir-mode .ku-dir-btn')];
    assert.deepEqual(buttons.map(item => item.textContent), ['☕ Быт', '⚔ Бой', '🔥 Близость']);
    assert.deepEqual(buttons.map(item => item.getAttribute('aria-pressed')), ['false', 'false', 'true']);
    buttons[1].click();
    await Promise.resolve();
    assert.deepEqual(modes, ['fight']);
    overlay.render(view({ sceneMode: 'intim' }));
    assert.match(bar.querySelector('.ku-dir-head').textContent, /🔥 Близость/);
    overlay.render(view({ sceneMode: 'calm' }));
    assert.doesNotMatch(bar.querySelector('.ku-dir-head').textContent, /Быт/);
  } finally { overlay.unmount(); }
});

test('the drawer has the weather: a badge when closed, kind buttons and a lock when open', async () => {
  const sent = [];
  const opened = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onWeather: payload => { sent.push(payload); }, onOpenStudio: tab => opened.push(tab) });
  try {
    overlay.render(view({ weather: { kind: 'rain', temp: 14, source: 'forecast', badge: '🌧 14°' } }));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(bar.querySelector('.ku-dir-head').textContent, /🌧 14°/);
    overlay.render(view({ weather: { kind: 'rain', temp: 14, source: 'forecast', badge: '🌧 14°' }, director: { open: true } }));
    assert.match(tileOf(bar, 'Погода').textContent, /14° дождь/);
    tileOf(bar, 'Погода').click();
    const weatherButtons = () => [...bar.querySelectorAll('.ku-dir-weather .ku-dir-btn')];
    const buttons = weatherButtons();
    assert.equal(buttons.filter(item => item.getAttribute('aria-pressed') === 'true').length, 1, 'only the current kind is pressed (the lock is not)');
    buttons.find(item => item.title === 'Снег').click();
    await Promise.resolve();
    assert.deepEqual(sent.at(-1), { kind: 'snow', lock: false });
    weatherButtons().find(item => item.textContent === '🔓 Держать').click();
    await Promise.resolve();
    assert.deepEqual(sent.at(-1), { kind: 'rain', temp: 14, lock: true });
    weatherButtons().find(item => /Заготовки/.test(item.textContent)).click();
    assert.deepEqual(opened, ['weather']);
    overlay.render(view({ weather: { kind: 'rain', temp: 14, source: 'lock', badge: '🌧 14°' }, director: { open: true } }));
    assert.ok([...bar.querySelectorAll('.ku-dir-weather .ku-dir-btn')].find(item => item.textContent === '🔒 Держится'));
  } finally { overlay.unmount(); }
});

test('the event card has ready genres; one press arms an event cue with the genre', async () => {
  const cues = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onCue: cue => { cues.push(cue); return true; } });
  try {
    overlay.render(view({ director: { open: true, cues: [] } }));
    const bar = document.getElementById('ku-scene-chips');
    tileOf(bar, 'Событие').click();
    const genres = [...bar.querySelectorAll('.ku-dir-genres .ku-dir-btn')];
    assert.deepEqual(genres.map(item => item.textContent.replace(/^\S+\s/, '')), ['Драка', 'Конфликт', 'Драма', 'Резня', 'Изнасилование', 'Насилие', 'Психологическое давление']);
    genres.find(item => /Драма/.test(item.textContent)).click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(cues.at(-1).kind, 'event');
    assert.equal(cues.at(-1).genre, 'drama');
    assert.equal(cues.at(-1).entityId, undefined, 'about the whole reply');
  } finally { overlay.unmount(); }
});

test('the «Время» strip opens a panel: type the time or shift it, and it is saved through the callback', async () => {
  const saved = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onSetTime: payload => { saved.push(payload); return true; } });
  try {
    overlay.render(view({ clock: { time: '23:30', day: 3, label: 'вторник' }, director: { open: true } }));
    const bar = document.getElementById('ku-scene-chips');
    [...bar.querySelectorAll('.ku-strip')][0].click();
    const time = bar.querySelector('[data-ku-field="clock-time"]');
    assert.deepEqual([time.value, bar.querySelector('[data-ku-field="clock-day"]').value, bar.querySelector('[data-ku-field="clock-label"]').value], ['23:30', '3', 'вторник']);
    time.value = '07:05';
    time.dispatchEvent(new window.Event('input', { bubbles: true }));
    [...bar.querySelectorAll('.ku-dir-time button')].find(item => item.textContent === 'Сохранить').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(saved.at(-1), { time: '07:05', day: '3', label: 'вторник' });
    // «+1 ч» past midnight goes to the next day.
    [...bar.querySelectorAll('.ku-strip')][0].click();
    [...bar.querySelectorAll('.ku-strip')][0].click();
    [...bar.querySelectorAll('.ku-dir-time button')].find(item => item.textContent === '+1 ч').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(saved.at(-1), { time: '00:30', day: '4', label: 'вторник' });
  } finally { overlay.unmount(); }
});

test('the dice tile appears only in an intimate scene; options are chips, the chosen ones burn, your own can be added', async () => {
  const calls = [];
  const groups = [
    { id: 'initiative', label: 'Кто ведёт', icon: '👑', multi: false, options: [{ id: 'npc:ran', text: 'ведёт Ран' }, { id: 'npc:mikey', text: 'ведёт Майки' }] },
    { id: 'act', label: 'Тип секса', icon: '🔥', multi: true, options: [{ id: 'vaginal', text: 'вагинальный' }, { id: 'oral-asks', text: 'оральный: просит персону' }, { id: 'oral-demands', text: 'оральный: требует от персоны, нажимает' }] },
  ];
  const dice = (picks, extra = {}) => ({ groups, picks, locked: [], sent: false, ...extra });
  const overlay = mountChatOverlay({
    onTogglePresent: () => {}, onLeak: () => {},
    onDiceRoll: payload => { calls.push(['roll', payload]); },
    onDiceToggle: payload => { calls.push(['pick', payload]); },
    onDiceLock: payload => { calls.push(['lock', payload]); },
    onDiceAdd: payload => { calls.push(['add', payload]); },
    onDiceSend: () => { calls.push(['send']); },
    onDiceClear: () => { calls.push(['clear']); },
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    overlay.render(view({ sceneMode: 'calm', dice: null, director: { open: true } }));
    const bar = document.getElementById('ku-scene-chips');
    assert.equal(tileOf(bar, 'Кубик'), undefined, 'no dice in a calm scene');
    overlay.render(view({ sceneMode: 'intim', dice: dice([]), director: { open: true } }));
    assert.match(tileOf(bar, 'Кубик').textContent, /бросить/);
    tileOf(bar, 'Кубик').click();
    const chips = () => [...document.querySelectorAll('#ku-scene-chips .ku-dice-chip')];
    assert.deepEqual(chips().map(chip => chip.textContent), ['ведёт Ран', 'ведёт Майки', 'вагинальный', 'оральный: просит персону', 'оральный: требует от персоны, нажимает']);
    assert.equal(chips().filter(chip => chip.classList.contains('on')).length, 0);
    // The oral options that the persona is asked for and pressed into are there.
    chips()[3].click();
    await settle();
    assert.deepEqual(calls.at(-1), ['pick', { group: 'act', option: 'oral-asks' }]);
    // What came back as chosen burns (two in a multi group).
    overlay.render(view({ sceneMode: 'intim', dice: dice([{ group: 'initiative', id: 'npc:ran', text: 'ведёт Ран' }, { group: 'act', id: 'vaginal', text: 'вагинальный' }, { group: 'act', id: 'oral-asks', text: 'оральный: просит персону' }]), director: { open: true } }));
    assert.deepEqual(chips().filter(chip => chip.classList.contains('on')).map(chip => chip.textContent), ['ведёт Ран', 'вагинальный', 'оральный: просит персону']);
    assert.deepEqual(chips().filter(chip => chip.getAttribute('aria-pressed') === 'true').length, 3);
    assert.match(tileOf(bar, 'Кубик').textContent, /выбрано/);
    // Roll, lock, re-roll a group, send, clear.
    const press = label => [...document.querySelectorAll('#ku-scene-chips button')].find(item => item.textContent.startsWith(label));
    press('🎲 Перебросить').click(); await settle();
    assert.deepEqual(calls.at(-1), ['roll', { only: '' }]);
    [...document.querySelectorAll('#ku-scene-chips .ku-dir-dice-row')][1].querySelector('[data-ku-action="dir-dice-lock"]').click(); await settle();
    assert.deepEqual(calls.at(-1), ['lock', { group: 'act' }]);
    [...document.querySelectorAll('#ku-scene-chips .ku-dir-dice-row')][0].querySelector('[data-ku-action="dir-dice-roll"]').click(); await settle();
    assert.deepEqual(calls.at(-1), ['roll', { only: 'initiative' }]);
    press('▶ Отправить').click(); await settle();
    assert.deepEqual(calls.at(-1), ['send']);
    press('Сбросить').click(); await settle();
    assert.deepEqual(calls.at(-1), ['clear']);
    // Her own option: «+» opens a field, Enter adds it to the group.
    [...document.querySelectorAll('#ku-scene-chips .ku-dir-dice-row')][1].querySelector('[data-ku-action="dir-dice-add-open"]').click();
    const field = document.querySelector('#ku-scene-chips [data-ku-field="dice-add"]');
    field.value = 'с повязкой на глазах';
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
    field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    assert.deepEqual(calls.at(-1), ['add', { group: 'act', text: 'с повязкой на глазах' }]);
    assert.equal(document.querySelector('#ku-scene-chips [data-ku-field="dice-add"]'), null, 'the field folds after');
    // A sent roll is shown as sent.
    overlay.render(view({ sceneMode: 'intim', dice: dice([{ group: 'act', id: 'vaginal', text: 'вагинальный' }], { sent: true }), director: { open: true } }));
    assert.match(tileOf(bar, 'Кубик').textContent, /отправлен/);
  } finally { overlay.unmount(); }
});

test('the quests tile lists what is in play: tick the current step, bring it in, open the page', async () => {
  const calls = [];
  const overlay = mountChatOverlay({
    onTogglePresent: () => {}, onLeak: () => {},
    onQuestStep: payload => { calls.push(['step', payload]); },
    onQuestPush: payload => { calls.push(['push', payload]); },
    onOpenStudio: tab => { calls.push(['open', tab]); },
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    overlay.render(view({ quests: [], director: { open: true } }));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(tileOf(bar, 'Квесты').textContent, /нет/);
    overlay.render(view({ quests: [{ id: 'q1', name: 'Найти сестру', secret: true, stepId: 's2', step: 'осмотреть склад', progress: '1/3', due: 'осталось 2 дня', pushed: false }], director: { open: true } }));
    assert.match(tileOf(bar, 'Квесты').textContent, /1 идут/);
    tileOf(bar, 'Квесты').click();
    const card = bar.querySelector('.ku-dir-quests');
    assert.match(card.textContent, /🔒 Найти сестру/);
    assert.match(card.textContent, /1\/3 · осталось 2 дня/);
    assert.match(card.textContent, /осмотреть склад/);
    [...card.querySelectorAll('button')].find(item => /Шаг выполнен/.test(item.textContent)).click(); await settle();
    assert.deepEqual(calls.at(-1), ['step', { questId: 'q1', stepId: 's2', done: true }]);
    [...bar.querySelector('.ku-dir-quests').querySelectorAll('button')].find(item => /Ввести сейчас/.test(item.textContent)).click(); await settle();
    assert.deepEqual(calls.at(-1), ['push', { questId: 'q1' }]);
  } finally { overlay.unmount(); }
});

test('a quest guess goes under the reply with Add / No, and answers carry the hint', () => {
  const actions = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onQuestHint: (action, payload) => actions.push([action, payload]) });
  try {
    overlay.render(view({ leaks: [], questHints: [{ messageIndex: 4, id: 'new:тайный долг', title: 'Похоже, началось задание «Тайный долг».', detail: 'надо вернуть Шагов: 1', confirm: 'Добавить квест', confirmTitle: 'Добавить' }] }));
    const note = document.querySelector('.mes[mesid="4"] .ku-quest-note-chat');
    assert.ok(note, 'the plaque is under the reply');
    assert.equal(note.previousElementSibling.className, 'mes_text');
    assert.match(note.textContent, /Тайный долг/);
    for (const label of ['Добавить квест', 'Нет']) [...note.querySelectorAll('button')].find(button => button.textContent === label).click();
    assert.deepEqual(actions, [['confirm', { messageIndex: 4, hintId: 'new:тайный долг' }], ['dismiss', { messageIndex: 4, hintId: 'new:тайный долг' }]]);
    overlay.render(view({ leaks: [], questHints: [] }));
    assert.equal(document.querySelectorAll('.ku-quest-note-chat').length, 0);
  } finally { overlay.unmount(); }
});

test('the heat tile shows the number, the panel nudges, sets, locks and resets it', async () => {
  const calls = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onHeat: payload => { calls.push(payload); } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    overlay.render(view({ heat: { value: 0, label: 'спокойно', lock: false, why: '' }, director: { open: true } }));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(tileOf(bar, 'Накал').textContent, /спокойно/);
    overlay.render(view({ heat: { value: 72, label: 'накалено', lock: false, why: 'ссора' }, director: { open: true } }));
    assert.match(tileOf(bar, 'Накал').textContent, /72 · накалено/);
    tileOf(bar, 'Накал').click();
    const card = () => bar.querySelector('.ku-dir-heat');
    assert.match(card().textContent, /ссора/);
    assert.equal(card().querySelector('.ku-heat-fill').style.width, '72%');
    const press = label => [...card().querySelectorAll('button')].find(item => item.textContent === label);
    press('−10').click(); await settle();
    assert.deepEqual(calls.at(-1), { delta: -10 });
    press('90').click(); await settle();
    assert.deepEqual(calls.at(-1), { value: 90 });
    press('🔓 Держать').click(); await settle();
    assert.deepEqual(calls.at(-1), { lock: true });
    press('Сбросить').click(); await settle();
    assert.deepEqual(calls.at(-1), { clear: true });
  } finally { overlay.unmount(); }
});

test('the strip above the message box says what the scene is and what goes to the model with the next post', async () => {
  const toggles = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onToggleOpen: open => toggles.push(open) });
  try {
    overlay.render(view({ time: 'вт 22:20', location: 'палуба', director: { open: false, cues: [{ id: 'c1', badge: '⚡', label: 'Событие: шторм', used: false, wait: 0 }] },
      sceneMode: 'intim', dice: { groups: [], picks: [{ group: 'mood', id: 'j', text: 'с ревностью', ahead: false }], locked: [], sent: false, stage: { id: 'touch', label: 'Касания', ru: 'только касания', note: 'тихо', stages: [] } } }));
    const strip = document.getElementById('ku-scene-strip');
    assert.equal(strip.nextElementSibling.id, 'send_form', 'it sits right above the message box');
    assert.match(strip.textContent, /вт 22:20/);
    assert.match(strip.textContent, /гараж|палуба/);
    assert.match(strip.textContent, /Майки/, 'who is on stage');
    assert.match(strip.querySelector('.ku-ss-out').textContent, /Уйдёт модели: .*Касания: только касания · заметка: тихо.*Событие: шторм.*с ревностью \(не отправлен\)/, 'the stage, the queued directions and the roll');
    strip.click();
    assert.deepEqual(toggles, [true], 'a click opens the panel');
    overlay.render(view({ director: { open: false } }));
    assert.match(document.getElementById('ku-scene-strip').querySelector('.ku-ss-out').textContent, /ничего заготовленного/);
    assert.equal(document.getElementById('ku-scene-strip').querySelector('.ku-ss-last'), null, 'nothing was sent yet');
    overlay.render(view({ lastSent: { stage: { label: 'Касания', note: 'тихо' }, cues: ['⚡ Событие: шторм'] } }));
    assert.match(document.getElementById('ku-scene-strip').querySelector('.ku-ss-last').textContent, /В последний запрос ушло: стадия «Касания», заметка «тихо» · ⚡ Событие: шторм/);
    overlay.render(view({ lastSent: { stage: null, cues: [] } }));
    assert.match(document.getElementById('ku-scene-strip').querySelector('.ku-ss-last').textContent, /ничего от Кулис, кроме обычной сцены/);
  } finally { overlay.unmount(); }
  assert.equal(document.getElementById('ku-scene-strip'), null, 'unmount takes it away');
});

test('the songs tile: pin a song from the library, say who sings it, drop a false alarm', async () => {
  const calls = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onSong: payload => { calls.push(payload); } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const songs = (over = {}) => ({ enabled: true, playing: [], found: [], muted: [], library: [{ songId: 's1', title: 'Ласточка', artist: 'Кино' }, { songId: 's2', title: 'Дождь', artist: '' }], ...over });
  const director = { open: true, people: [{ id: 'm', name: 'Майки' }, { id: 'r', name: 'Ран' }] };
  const press = (bar, label) => [...bar.querySelector('.ku-dir-songs').querySelectorAll('button')].find(item => item.textContent.includes(label));
  try {
    overlay.render(view({ songs: songs(), director }));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(tileOf(bar, 'Песни').textContent, /тихо/);
    tileOf(bar, 'Песни').click();
    // Find a song of the library and put it on.
    const find = bar.querySelector('[data-ku-field="song-find"]');
    find.value = 'ласт';
    find.dispatchEvent(new window.Event('input', { bubbles: true }));
    press(bar, 'Ласточка — Кино').click(); await settle();
    assert.deepEqual(calls.at(-1), { op: 'pin', songId: 's1', mode: 'sound', singerId: '' });
    // On: it plays; pick who sings it, or take it away.
    overlay.render(view({ songs: songs({ playing: [{ songId: 's1', title: 'Ласточка', artist: 'Кино', mode: 'sound', singerId: '' }] }), director }));
    assert.match(tileOf(bar, 'Песни').textContent, /▶ 1/);
    assert.equal(press(bar, '🔊 Звучит').getAttribute('aria-pressed'), 'true');
    press(bar, '🎤 Майки').click(); await settle();
    assert.deepEqual(calls.at(-1), { op: 'pin', songId: 's1', mode: 'sung', singerId: 'm' });
    press(bar, '× Убрать').click(); await settle();
    assert.deepEqual(calls.at(-1), { op: 'unpin', songId: 's1' });
    // A song the posts brought up by mistake: «Не она» mutes it, «Вернуть» brings it back.
    overlay.render(view({ songs: songs({ found: [{ songId: 's2', title: 'Дождь', why: 'lyrics', muted: false }] }), director }));
    assert.match(tileOf(bar, 'Песни').textContent, /слышно/);
    assert.match(bar.querySelector('.ku-dir-songs').textContent, /Дождь · по словам/);
    press(bar, 'Не она').click(); await settle();
    assert.deepEqual(calls.at(-1), { op: 'mute', songId: 's2' });
    overlay.render(view({ songs: songs({ found: [{ songId: 's2', title: 'Дождь', why: 'lyrics', muted: true }], muted: [{ songId: 's2', title: 'Дождь' }] }), director }));
    assert.match(bar.querySelector('.ku-dir-songs').textContent, /заглушена/);
    press(bar, 'Вернуть').click(); await settle();
    assert.deepEqual(calls.at(-1), { op: 'unmute', songId: 's2' });
  } finally { overlay.unmount(); }
});
