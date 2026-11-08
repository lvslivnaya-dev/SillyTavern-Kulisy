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

test('the drawer sits above the message box: closed it is a slim bar, open it shows the cast', () => {
  const toggles = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onToggleOpen: open => toggles.push(open) });
  try {
    overlay.render(view());
    const bar = document.getElementById('ku-scene-chips');
    assert.equal(bar.nextElementSibling.id, 'send_form');
    assert.equal(bar.classList.contains('open'), false);
    assert.equal(bar.querySelectorAll('.ku-chip').length, 0, 'closed: no chips, only the summary');
    assert.match(bar.querySelector('.ku-dir-summary').textContent, /Майки/);
    bar.querySelector('.ku-dir-summary').click();
    assert.deepEqual(toggles, [true], 'a click anywhere on the closed bar opens it');
    overlay.render(view({ director: { open: true } }));
    const chips = [...bar.querySelectorAll('.ku-chip')];
    assert.deepEqual(chips.map(chip => chip.querySelector('.ku-chip-name').textContent), ['Майки', 'Судзу', 'Ран']);
    assert.equal(chips[2].classList.contains('on'), false);
    assert.equal(bar.querySelector('.ku-chips-place').textContent, '📍 гараж');
    // Open: clicking the bar or a chip does not close it; only the arrow does.
    bar.querySelector('.ku-dir-head').click();
    chips[0].click();
    assert.deepEqual(toggles, [true]);
    bar.querySelector('.ku-dir-arrow').click();
    assert.deepEqual(toggles, [true, false]);
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
    click('🎬 Сцена');
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

    click('📝 Рассказчику');
    const note = bar.querySelector('[data-ku-field="note"]');
    note.value = 'короче';
    note.dispatchEvent(new window.Event('input', { bubbles: true }));
    note.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(cues.at(-1), { kind: 'note', text: 'короче', wait: 0 });
    assert.equal(kicked, 1, 'a note waits for the post');
  } finally { overlay.unmount(); }
});
