import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`<!doctype html><html><body>
  <div id="message_template"><div class="mes"><div class="extraMesButtons"></div></div></div>
  <div id="chat">
    <div class="mes" mesid="5"><div class="extraMesButtons"></div><div class="mes_block"><div class="mes_text">Он шепнул ей в трубку: «Не верь Санзу, у него приказ».</div></div></div>
    <div class="mes" mesid="6" is_user="true"><div class="extraMesButtons"></div><div class="mes_block"><div class="mes_text">Другой пост</div></div></div>
  </div>
  <div id="form_sheld"><div id="send_form"><textarea id="send_textarea"></textarea></div></div>
</body></html>`, { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
const { mountChatOverlay } = await import('../src/integration/chat-overlay.js');
const { mountMessageButtons } = await import('../src/integration/message-buttons.js');
const { mountSelectionChip, readSelection } = await import('../src/integration/selection-chip.js');
const { openSecretDialog } = await import('../src/integration/secret-dialog.js');

const wait = () => new Promise(resolve => setTimeout(resolve, 20));

function select(node, from, to) {
  const range = document.createRange();
  range.setStart(node, from);
  range.setEnd(node, to);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

test('a guess at a secret is a note under the reply with two answers; text from the chat stays text', () => {
  const actions = [];
  const overlay = mountChatOverlay({ onTogglePresent: () => {}, onLeak: () => {}, onSecretHint: (action, payload) => actions.push([action, payload]) });
  try {
    overlay.render({ chips: false, cast: [], location: '', leaks: [], secretHints: [{ messageIndex: 5, eventId: 'e1', text: 'Махито шепнул <b>Иоко</b>', names: 'Иоко, Махито' }] });
    const note = document.querySelector('#chat .mes[mesid="5"] .ku-secret-hint');
    assert.ok(note);
    assert.equal(note.previousElementSibling.classList.contains('mes_text'), true, 'right under the reply text');
    assert.match(note.textContent, /Похоже на секрет: «Махито шепнул <b>Иоко<\/b>»/);
    assert.equal(note.querySelector('b b'), null, 'no HTML was parsed');
    const [open, dismiss] = note.querySelectorAll('button');
    assert.match(open.textContent, /Открыть в окне/);
    open.click();
    dismiss.click();
    assert.deepEqual(actions, [['open', { messageIndex: 5, eventId: 'e1' }], ['dismiss', { messageIndex: 5, eventId: 'e1' }]]);
    overlay.render({ chips: false, cast: [], location: '', leaks: [], secretHints: [] });
    assert.equal(document.querySelector('.ku-secret-hint'), null, 'answered: the note goes');
  } finally { overlay.unmount(); }
});

test('selection: only a passage inside one message text counts; the chip carries it and forgets it after a click', async () => {
  const text = document.querySelector('#chat .mes[mesid="5"] .mes_text').firstChild;
  const created = [];
  const chip = mountSelectionChip({ onCreate: selection => created.push(selection) });
  try {
    select(text, 0, 3);
    assert.equal(readSelection(), null, 'too short');
    select(text, 0, text.length);
    const info = readSelection();
    assert.equal(info.messageIndex, 5);
    assert.match(info.text, /^Он шепнул ей/);
    document.dispatchEvent(new dom.window.Event('selectionchange'));
    await wait();
    const button = document.getElementById('ku-secret-chip');
    assert.equal(button.hidden, false);
    assert.equal(chip.recent().messageIndex, 5);
    button.click();
    assert.equal(created.length, 1);
    assert.equal(created[0].messageIndex, 5);
    assert.equal(button.hidden, true);
    assert.equal(chip.recent().text, created[0].text, 'the menu button can still use it for a while');
    // Outside the chat: nothing.
    const outside = document.getElementById('send_textarea');
    outside.value = 'какой-то длинный текст в поле ввода';
    document.getSelection().removeAllRanges();
    assert.equal(readSelection(), null);
  } finally { chip.unmount(); }
  assert.equal(document.getElementById('ku-secret-chip'), null);
});

test('the message menu gets a secret button on every message, user posts included', () => {
  const calls = [];
  const buttons = mountMessageButtons(index => calls.push(['check', index]), index => calls.push(['secret', index]));
  try {
    assert.equal(document.querySelectorAll('#chat .kulisy-secret').length, 2);
    assert.equal(document.querySelectorAll('#message_template .kulisy-secret').length, 1, 'new messages are cloned with it');
    document.querySelector('#chat .mes[mesid="6"] .kulisy-secret').click();
    document.querySelector('#chat .mes[mesid="5"] .kulisy-check').click();
    assert.deepEqual(calls, [['secret', 6], ['check', 5]]);
  } finally { buttons.unmount(); }
  assert.equal(document.querySelectorAll('.kulisy-secret').length, 0);
  const plain = mountMessageButtons(() => {});
  try { assert.equal(document.querySelectorAll('.kulisy-secret').length, 0, 'without a handler no secret button'); } finally { plain.unmount(); }
});

/** A stand-in for SillyTavern's Popup: the content stays in the page, `finish` presses a button. */
function fakePopupContext() {
  const POPUP_RESULT = { AFFIRMATIVE: 1, CANCELLED: 0 };
  const state = { popup: null };
  class Popup {
    constructor(content, type, value, options) { this.content = content; this.options = options; state.popup = this; document.body.append(content); }
    async show() {
      await this.options.onOpen?.(this);
      return new Promise(resolve => { this.finish = async result => { this.result = result; if (await this.options.onClosing?.(this)) { this.content.remove(); resolve(result); } }; });
    }
  }
  return { ctx: { Popup, POPUP_TYPE: { TEXT: 1 }, POPUP_RESULT }, state };
}

const roster = [{ id: 'ioko', name: 'Иоко' }, { id: 'mahito', name: 'Махито' }, { id: 'mikey', name: 'Майки' }];

test('the secret window: the model fills it, the person fixes it, nothing is saved without a valid «Сохранить»', async () => {
  const { ctx, state } = fakePopupContext();
  const sent = [];
  const compose = async input => {
    sent.push(input);
    return { label: 'Махито о чём-то предупредил Иоко', detail: 'Махито шепнул не верить Санзу.', knowIds: ['ioko', 'mahito'], contextIds: ['m2'], fallback: false };
  };
  const toasts = [];
  globalThis.toastr = { warning: message => toasts.push(message), info: message => toasts.push(message) };
  const pending = openSecretDialog(ctx, {
    text: 'Он шепнул: «Не верь Санзу».', roster, presentIds: ['ioko', 'mikey'],
    neighbours: [{ key: 'm1', label: '#5 · этот ответ', text: 'Первый пост' }, { key: 'm2', label: '#4 · ответ', text: 'Второй пост' }],
    compose,
  });
  await wait();
  const window = state.popup.content;
  assert.equal(sent.length, 1, 'composed on open');
  assert.deepEqual(sent[0].neighbours.map(item => item.key), ['m1', 'm2'], 'the first time every post is offered');
  assert.equal(window.querySelector('.ku-sd-input').value, 'Махито о чём-то предупредил Иоко');
  const pills = [...window.querySelectorAll('.ku-sd-pill')];
  assert.deepEqual(pills.filter(pill => pill.classList.contains('on')).map(pill => pill.firstChild.textContent).sort(), ['Иоко', 'Махито']);
  const boxes = [...window.querySelectorAll('.ku-sd-post input')];
  assert.deepEqual(boxes.map(box => box.checked), [false, true], 'ticks follow what the model used');
  assert.match(window.querySelector('.ku-sd-preview').textContent, /secret\[Иоко, Махито\]: Махито о чём-то предупредил Иоко — Махито шепнул/);
  assert.match(window.querySelector('.ku-sd-preview').textContent, /unknown\[Майки\]: \(secret\)/);

  // The person adds Mikey as a knower, empties the label: «Сохранить» is refused.
  pills.find(pill => pill.firstChild.textContent === 'Майки').click();
  const label = window.querySelector('.ku-sd-input');
  label.value = '';
  await state.popup.finish(1);
  assert.equal(toasts.at(-1), 'Нужны подпись и подробности.');
  label.value = 'Тайное предупреждение';
  label.dispatchEvent(new dom.window.Event('input'));
  // Composing again sends only the ticked post.
  window.querySelector('.ku-sd-again').click();
  await wait();
  assert.deepEqual(sent[1].neighbours.map(item => item.key), ['m2']);
  assert.equal(window.querySelector('.ku-sd-input').value, 'Махито о чём-то предупредил Иоко');
  await state.popup.finish(1);
  const result = await pending;
  assert.deepEqual(result, { label: 'Махито о чём-то предупредил Иоко', detail: 'Махито шепнул не верить Санзу.', knowIds: ['ioko', 'mahito'] });
  assert.equal(window.isConnected, false);
});

test('the secret window: cancel saves nothing; a model that failed leaves the person their own words; nobody knowing is refused', async () => {
  const { ctx, state } = fakePopupContext();
  const toasts = [];
  globalThis.toastr = { warning: message => toasts.push(message), info: message => toasts.push(message) };
  const failing = async () => ({ label: 'Майки спрятал ключ', detail: 'Майки спрятал ключ от Иоко.', knowIds: [], contextIds: [], fallback: true, error: 'нет ответа' });
  const pending = openSecretDialog(ctx, { text: 'Майки спрятал ключ от Иоко.', roster, presentIds: [], neighbours: [], compose: failing });
  await wait();
  const window = state.popup.content;
  assert.match(window.querySelector('.ku-sd-status').textContent, /Модель не помогла \(нет ответа\)/);
  assert.match(window.textContent, /Соседних постов нет/);
  await state.popup.finish(1);
  assert.equal(toasts.at(-1), 'Отметь хотя бы одного, кто знает секрет.');
  await state.popup.finish(0);
  assert.equal(await pending, null);

  // Nothing typed: no request goes to the model.
  let calls = 0;
  const second = fakePopupContext();
  const blank = openSecretDialog(second.ctx, { text: '', roster, presentIds: [], neighbours: [], compose: async () => { calls += 1; return {}; } });
  await wait();
  assert.equal(calls, 0);
  await second.state.popup.finish(0);
  assert.equal(await blank, null);
});
