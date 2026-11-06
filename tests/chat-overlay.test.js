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

test('chips sit above the message box: present first, the absent ones can be brought on', () => {
  const toggled = [];
  const overlay = mountChatOverlay({ onTogglePresent: (id, present) => toggled.push([id, present]), onLeak: () => {} });
  try {
    overlay.render(view());
    const bar = document.getElementById('ku-scene-chips');
    assert.equal(bar.nextElementSibling.id, 'send_form');
    const chips = [...bar.querySelectorAll('.ku-chip')];
    assert.deepEqual(chips.map(chip => chip.querySelector('.ku-chip-name').textContent), ['Майки', 'Судзу', 'Ран']);
    assert.equal(chips[2].classList.contains('on'), false);
    assert.equal(bar.querySelector('.ku-chips-place').textContent, 'гараж');
    chips[2].click();
    chips[0].click();
    assert.deepEqual(toggled, [['r', true], ['m', false]]);
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
      cast: [{ id: 'x', name: evil, present: true, persona: false }],
      leaks: [{ messageIndex: 4, entityId: 'x', eventId: 'e', name: evil, eventText: evil, quote: evil, canSwipe: false }],
    }));
    assert.equal(document.querySelector('#ku-scene-chips img'), null);
    assert.equal(document.querySelector('.ku-leak img'), null);
    assert.match(document.querySelector('.ku-chip-name').textContent, /<img/);
  } finally { overlay.unmount(); }
});
