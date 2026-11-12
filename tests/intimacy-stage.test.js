import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyOperation, createDefaultState, createOperation, exportState, importState, validateState } from '../src/core/index.js';
import { INTIMACY_STAGES, STAGE_IDS, aheadGroups, cleanStage, groupsForRoll, nextStage, stageLine, stageStepProposal } from '../src/core/intimacy-stage.js';
import { DICE_GROUPS, diceCue, normalizeDice, optionsOf, rollDice, togglePick, updateDice } from '../src/core/intimacy-dice.js';
import { buildScenePrompt } from '../src/integration/world-prompt.js';
import { buildWorldBlock, parseWorld, stageProposals } from '../src/integration/world-analysis.js';

const meta = { transactionId: 't', reason: 'test', timestamp: '2026-01-01T00:00:00.000Z' };
const op = (state, type, payload) => applyOperation(state, createOperation(type, payload, meta));
const npcs = [{ id: 'ran', name: 'Ран' }];
const low = () => 0.01;

test('the stage ladder has six stages in order, each with a rule for the narrator', () => {
  assert.deepEqual(STAGE_IDS, ['spark', 'touch', 'kiss', 'undress', 'act', 'after']);
  for (const stage of INTIMACY_STAGES) assert.ok(stage.label && stage.icon && stage.hint && stage.rule, stage.id);
});

test('nextStage sets, steps, holds and ends; steps stop at the ends of the ladder', () => {
  assert.equal(nextStage(null, { clear: true }), null);
  assert.equal(nextStage(null, { stage: 'nope' }), null);
  assert.deepEqual(nextStage(null, { delta: 1 }), { stage: 'spark' }, 'the first step starts the ladder');
  let current = nextStage(null, { stage: 'touch', why: 'взялись за руки' });
  assert.deepEqual(current, { stage: 'touch', why: 'взялись за руки' });
  current = nextStage(current, { delta: 1 });
  assert.deepEqual(current, { stage: 'kiss' }, 'a new stage forgets the old reason');
  assert.equal(nextStage({ stage: 'after' }, { delta: 1 }).stage, 'after');
  assert.equal(nextStage({ stage: 'spark' }, { delta: -1 }).stage, 'spark');
  assert.deepEqual(nextStage({ stage: 'kiss', why: 'x' }, { lock: true }), { stage: 'kiss', why: 'x', lock: true });
  assert.equal(cleanStage({ stage: 'kiss', lock: 1 }).lock, true);
});

test('intimacy.set journals the stage, validates, and survives export and import', () => {
  let state = createDefaultState();
  state = op(state, 'intimacy.set', { stage: 'kiss', why: 'поцеловались' });
  assert.equal(state.world.intimacy.stage, 'kiss');
  state = op(state, 'intimacy.set', { delta: 1 });
  assert.equal(state.world.intimacy.stage, 'undress');
  assert.deepEqual(validateState(state).errors, []);
  assert.equal(importState(JSON.parse(exportState(state))).world.intimacy.stage, 'undress');
  state = op(state, 'intimacy.set', { clear: true });
  assert.equal(state.world.intimacy, undefined);
});

test('the chronicler only proposes one step forward, never when locked, in a flashback or outside an intimate scene', () => {
  assert.deepEqual(stageStepProposal(null, { stage: 'touch', why: 'взялись за руки' }), { from: null, to: 'touch', why: 'взялись за руки' }, 'with nothing running it may say where the scene is');
  assert.deepEqual(stageStepProposal({ stage: 'spark' }, { stage: 'act' }), { from: 'spark', to: 'touch', why: '' }, 'a jump becomes one step');
  assert.equal(stageStepProposal({ stage: 'kiss' }, { stage: 'kiss' }), null);
  assert.equal(stageStepProposal({ stage: 'kiss' }, { stage: 'touch' }), null, 'the way back is the user\'s');
  assert.equal(stageStepProposal({ stage: 'kiss', lock: true }, { stage: 'undress' }), null);
  assert.equal(stageStepProposal({ stage: 'kiss' }, { stage: 'undress' }, { flashback: true }), null);
  assert.equal(stageStepProposal({ stage: 'kiss' }, { stage: 'undress' }, { intimate: false }), null);
  assert.equal(stageStepProposal({ stage: 'kiss' }, { stage: 'nope' }), null);
});

test('the reply’s stage is read tolerantly and becomes a plaque proposal, written nowhere', () => {
  assert.deepEqual(parseWorld({ intimacy: { stage: 'kiss', why: 'целуются' } }).intimacy, { stage: 'kiss', why: 'целуются' });
  assert.equal(parseWorld({ intimacy: { stage: 'whatever' } }).intimacy, null);
  const base = op(op(createDefaultState(), 'clock.set', { day: 1, time: '22:00', mode: 'intim' }), 'intimacy.set', { stage: 'touch' });
  const proposals = stageProposals({ intimacy: { stage: 'kiss', why: 'первый поцелуй' } }, { state: () => base });
  assert.deepEqual(proposals, [{ id: 'stage:kiss', kind: 'stage', from: 'touch', to: 'kiss', why: 'первый поцелуй' }]);
  // The type of the scene does not matter while a stage is running (the user set it); with none and a calm scene nothing is proposed.
  const calm = op(base, 'clock.set', { mode: 'calm' });
  assert.equal(stageProposals({ intimacy: { stage: 'kiss' } }, { state: () => calm }).length, 1);
  const none = op(createDefaultState(), 'clock.set', { day: 1, time: '22:00' });
  assert.deepEqual(stageProposals({ intimacy: { stage: 'kiss' } }, { state: () => none }), []);
  assert.match(buildWorldBlock(base, 'текст'), /Intimacy stage before this reply: touch/);
  assert.doesNotMatch(buildWorldBlock(none, 'текст'), /Intimacy stage before this reply/);
});

test('the narrator gets the stage and its rule while the stage runs, whatever the scene type says, and not in a flashback', () => {
  let state = op(createDefaultState(), 'clock.set', { day: 2, time: '23:00', mode: 'intim' });
  assert.doesNotMatch(buildScenePrompt(state), /intimacy stage/, 'no stage running: nothing to say');
  state = op(state, 'intimacy.set', { stage: 'kiss' });
  const text = buildScenePrompt(state);
  assert.match(text, /intimacy stage: 3\/6 kiss/);
  assert.match(text, /only kissing and embraces/);
  assert.match(text, /write only that stage, one step of it per reply/);
  assert.match(stageLine({ stage: 'act' }), /the act itself/);
  assert.match(buildScenePrompt(op(state, 'clock.set', { mode: 'calm' })), /intimacy stage: 3\/6 kiss/, 'the chronicler flipping the scene type does not take the stage away');
  assert.doesNotMatch(buildScenePrompt(op(state, 'clock.set', { flashback: true })), /intimacy stage: 3/, 'not in a flashback');
});

test('«Начало» is a dice group; by default it has its own button and a full roll leaves it out', () => {
  assert.ok(DICE_GROUPS.some(group => group.id === 'start' && group.options.length >= 8 && group.options.every(option => option.text && option.en)));
  assert.equal(normalizeDice({}).rollMode, 'separate');
  const full = rollDice({}, { npcs, random: low });
  assert.equal(full.some(pick => pick.group === 'start'), false);
  const only = rollDice({}, { npcs, only: 'start', random: low });
  assert.deepEqual(only.map(pick => pick.group), ['start']);
  assert.ok(only[0].text && only[0].en);
});

test('in the mode «по стадии» one button takes the groups that fit the stage', () => {
  const settings = updateDice({}, { rollMode: 'stage' });
  assert.equal(normalizeDice(settings).rollMode, 'stage');
  assert.equal(updateDice(settings, { rollMode: 'whatever' }).rollMode, 'separate');
  const groupsAt = stage => rollDice(settings, { npcs, stage, random: low }).map(pick => pick.group);
  assert.deepEqual(groupsAt('spark'), ['initiative', 'start', 'mood']);
  assert.deepEqual(groupsAt(''), ['initiative', 'start', 'mood'], 'no stage counts as the spark');
  assert.deepEqual(groupsAt('kiss'), ['initiative', 'setting', 'mood', 'pace'].sort((left, right) => DICE_GROUPS.findIndex(g => g.id === left) - DICE_GROUPS.findIndex(g => g.id === right)));
  assert.ok(groupsAt('act').includes('act') && !groupsAt('act').includes('start'));
  assert.deepEqual(groupsAt('after'), ['mood', 'twist']);
  assert.deepEqual(groupsForRoll('separate', 'kiss', ['start', 'act', 'mood']), ['mood'], 'a running stage filters a full roll in the default mode too');
  assert.deepEqual(groupsForRoll('separate', '', ['start', 'act', 'mood']), ['act', 'mood'], 'no stage: everything but «Начало»');
  // A group asked for by hand rolls whatever the stage.
  assert.deepEqual(rollDice(settings, { npcs, only: 'act', stage: 'spark', random: low }).map(pick => pick.group), ['act']);
});

test('the stage has the user\'s own note, and it goes to the narrator with the stage', () => {
  let current = nextStage(null, { stage: 'touch' });
  current = nextStage(current, { note: '  пусть он замирает,   когда она касается шеи ' });
  assert.equal(current.note, 'пусть он замирает, когда она касается шеи');
  assert.equal(nextStage(current, { delta: 1 }).note, current.note, 'the note stays when the stage moves');
  assert.equal(nextStage(current, { note: '' }).note, undefined, 'an empty note removes it');
  assert.match(stageLine(current), /The user's note for this scene: "пусть он замирает, когда она касается шеи"/);
  assert.equal(nextStage(null, { note: 'без стадии' }), null, 'no note without a stage');
  const state = op(op(createDefaultState(), 'clock.set', { day: 1, time: '22:00', mode: 'intim' }), 'intimacy.set', { stage: 'touch', note: 'тихо' });
  assert.match(buildScenePrompt(state), /note for this scene: "тихо"/);
});

test('what lies ahead of the stage is held back in the direction, and comes alive when the stage reaches it', () => {
  assert.deepEqual(aheadGroups('touch'), ['setting', 'act', 'conditions', 'twist']);
  assert.deepEqual(aheadGroups('kiss'), ['act', 'conditions', 'twist']);
  assert.deepEqual(aheadGroups('act'), []);
  assert.deepEqual(aheadGroups(''), []);
  const pick = (group, groupEn, text, en, ahead) => ({ group, groupEn, text, en, ahead });
  const picks = [pick('mood', 'mood', 'с ревностью', 'jealous', false), pick('act', 'kind of sex', 'оральный', 'oral sex', true)];
  const cue = diceCue(picks, { stage: 'touch' });
  assert.equal(cue.text, 'с ревностью · впереди: оральный');
  assert.match(cue.detail, /the scene is at the stage "touch": write only that stage/);
  assert.match(cue.detail, /mood: jealous/);
  assert.match(cue.detail, /HELD BACK until the scene reaches that stage \(lead up to it at most, do not write it yet\): kind of sex: oral sex/);
  const open = diceCue(picks.map(item => ({ ...item, ahead: false })), { stage: 'undress' });
  assert.doesNotMatch(open.detail, /HELD BACK/);
  assert.deepEqual(diceCue(picks.slice(0, 1)), { text: 'с ревностью', detail: 'mood: jealous' }, 'no stage, nothing held: as before');
});

test('the user own long option is not cut, and goes to the narrator as her own request that must show', () => {
  const long = 'она сонно ерзает на нём, он возбуждается и начинает осторожно ласкать её сквозь сон, раздумывая над тем, насколько правильно это делать с девушкой, которая ему доверяет и не понимает, что с ней происходит';
  assert.ok(long.length > 120 && long.length < 400);
  let settings = updateDice({}, { group: 'start', addCustom: long });
  const own = optionsOf(settings, 'start').find(option => option.custom);
  assert.equal(own.text, long, 'no cutting at 120 signs');
  const picks = togglePick(settings, [], 'start', own.id);
  assert.equal(picks[0].custom, true);
  const cue = diceCue(picks, { stage: 'touch' });
  assert.match(cue.detail, /THE USER'S OWN REQUEST, it must visibly happen in this reply \(inside the stage, in the character's own manner\): how it begins: она сонно ерзает/);
  assert.equal(cue.text, long);
  assert.doesNotMatch(diceCue(picks.map(pick => ({ ...pick, ahead: true })), { stage: 'touch' }).detail, /THE USER'S OWN REQUEST/, 'a request that waits ahead is held back like the rest');
});

// ---- the drawer and the plaque ----
const dom = new JSDOM(`<!doctype html><html><body>
  <div id="chat"><div class="mes" mesid="4"><div class="mes_block"><div class="mes_text">Текст</div></div></div></div>
  <div id="form_sheld"><div id="send_form"><textarea id="send_textarea"></textarea></div></div>
</body></html>`);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Element = dom.window.Element;
const { mountChatOverlay } = await import('../src/integration/chat-overlay.js');
const tileOf = (bar, name) => [...bar.querySelectorAll('.ku-tile')].find(item => item.querySelector('.ku-tile-name').textContent === name);

test('the ladder in the drawer: stages are buttons, steps and the lock go out, the plaque asks', async () => {
  const calls = [];
  const hints = [];
  const overlay = mountChatOverlay({
    onTogglePresent: () => {}, onLeak: () => {},
    onStage: payload => { calls.push(payload); },
    onDiceRoll: payload => { calls.push(['roll', payload]); },
    onQuestHint: (action, payload) => { hints.push([action, payload]); },
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const stages = INTIMACY_STAGES.map(({ id, label, icon, hint }) => ({ id, label, icon, hint }));
  const groups = [{ id: 'start', label: 'Начало', icon: '✨', multi: false, options: [{ id: 'look', text: 'долгий взгляд' }] }];
  const intimView = (stage, rollMode = 'separate', extra = {}) => ({
    chips: true, cast: [{ id: 'm', name: 'Майки', present: true, persona: false }], location: 'гараж', leaks: [], sceneMode: 'intim',
    dice: { groups, picks: [], locked: [], sent: false, rollMode, stage: { id: '', label: '', hint: '', lock: false, why: '', stages, ...stage } },
    director: { open: true }, ...extra,
  });
  try {
    overlay.render(intimView({}));
    const bar = document.getElementById('ku-scene-chips');
    tileOf(bar, 'Кубик').click();
    const ladder = () => [...document.querySelectorAll('#ku-scene-chips .ku-stage-chip')];
    assert.deepEqual(ladder().map(chip => chip.textContent), INTIMACY_STAGES.map(stage => `${stage.icon} ${stage.label}`));
    assert.match(document.getElementById('ku-scene-chips').textContent, /Лесенка не запущена/);
    ladder()[2].click(); await settle();
    assert.deepEqual(calls.at(-1), { stage: 'kiss' });
    // A running stage burns, shows the hint, and gets the lock and the end of the scene.
    overlay.render(intimView({ id: 'kiss', label: 'Поцелуи', hint: 'поцелуи и объятия' }));
    assert.deepEqual(ladder().filter(chip => chip.classList.contains('on')).map(chip => chip.textContent), ['💋 Поцелуи']);
    assert.match(tileOf(bar, 'Кубик').textContent, /Поцелуи/);
    const press = label => [...document.querySelectorAll('#ku-scene-chips button')].find(item => item.textContent.startsWith(label));
    press('Дальше').click(); await settle();
    assert.deepEqual(calls.at(-1), { delta: 1 });
    press('◂ Назад').click(); await settle();
    assert.deepEqual(calls.at(-1), { delta: -1 });
    press('🔓 Держать').click(); await settle();
    assert.deepEqual(calls.at(-1), { lock: true });
    press('Сцена закончена').click(); await settle();
    assert.deepEqual(calls.at(-1), { clear: true });
    // Mode А: «Начало» has its own button; mode Б: it does not.
    press('✨ Начало').click(); await settle();
    assert.deepEqual(calls.at(-1), ['roll', { only: 'start' }]);
    overlay.render(intimView({ id: 'spark', label: 'Искра', hint: 'взгляды' }, 'stage'));
    assert.equal(press('✨ Начало'), undefined);
    // The plaque under the reply asks about the next stage.
    overlay.render(intimView({ id: 'touch', label: 'Касания', hint: 'x' }, 'separate', { questHints: [{ messageIndex: 4, id: 'stage:kiss', icon: 'fa-heart', title: 'Сцена дошла до стадии «Поцелуи»?', detail: 'целуются', confirm: 'Перейти: Поцелуи', confirmTitle: 'Поставить' }] }));
    const note = document.querySelector('#chat .ku-quest-note-chat');
    assert.ok(note.querySelector('i.fa-heart'));
    [...note.querySelectorAll('button')].find(item => item.textContent === 'Перейти: Поцелуи').click(); await settle();
    assert.deepEqual(hints.at(-1), ['confirm', { messageIndex: 4, hintId: 'stage:kiss' }]);
  } finally {
    overlay.unmount();
  }
});

test('the dice tab on the side panel: the ladder is a column, a held pick can be let through, the note is saved', async () => {
  const calls = [];
  const overlay = mountChatOverlay({
    onTogglePresent: () => {}, onLeak: () => {},
    onStage: payload => { calls.push(['stage', payload]); },
    onDiceRelease: payload => { calls.push(['release', payload]); },
    onToggleOpen: open => { calls.push(['open', open]); },
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const stages = INTIMACY_STAGES.map(({ id, label, icon, hint }) => ({ id, label, icon, hint }));
  const groups = [{ id: 'mood', label: 'Настроение', icon: '🎭', multi: false, options: [{ id: 'jealous', text: 'с ревностью' }] }, { id: 'act', label: 'Тип секса', icon: '🔥', multi: true, options: [{ id: 'oral', text: 'оральный' }] }];
  const picks = [{ group: 'mood', id: 'jealous', text: 'с ревностью', ahead: false }, { group: 'act', id: 'oral', text: 'оральный', ahead: true }];
  const intim = (open, extra = {}) => ({
    chips: true, cast: [{ id: 'm', name: 'Майки', present: true, persona: false }], location: 'гараж', leaks: [], sceneMode: 'intim', director: { open },
    dice: { groups, picks, locked: [], sent: false, rollMode: 'separate', stage: { id: 'touch', label: 'Касания', hint: 'x', lock: false, why: '', note: '', stages }, ...extra },
  });
  try {
    overlay.render(intim(false));
    const bar = document.getElementById('ku-scene-chips');
    assert.match(tileOf(bar, 'Кубик').textContent, /выбрано/, 'the rail tab shows the state of the roll');
    tileOf(bar, 'Кубик').click();
    assert.deepEqual(calls.at(-1), ['open', true], 'the tab unfolds the folded panel');
    overlay.render(intim(true));
    assert.match(bar.querySelector('.ku-dir-head').textContent, /Кубик близости/);
    assert.ok(bar.querySelector('.ku-dice-cols.with-ladder .ku-dice-ladder .ku-stage-chip'), 'the ladder is its own column');
    assert.ok(bar.querySelector('.ku-dice-foot [data-ku-action="dir-dice-roll"]'), 'the roll buttons sit in the footer');
    // The pick from a later stage is held back and shown dashed.
    assert.deepEqual([...bar.querySelectorAll('.ku-dice-chip.ahead')].map(chip => chip.textContent), ['оральный']);
    const held = [...bar.querySelectorAll('.ku-dice-held button')];
    assert.deepEqual(held.map(button => button.textContent), ['оральный · сейчас']);
    held[0].click(); await settle();
    assert.deepEqual(calls.at(-1), ['release', { group: 'act', option: 'oral' }]);
    // The note: typed, saved with Enter, sent as a payload (an empty one clears it).
    const field = () => bar.querySelector('[data-ku-field="stage-note"]');
    field().value = 'тихо, без слов';
    field().dispatchEvent(new window.Event('input', { bubbles: true }));
    field().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    assert.deepEqual(calls.at(-1), ['stage', { note: 'тихо, без слов' }]);
    // The tab that is on, pressed again, folds the panel; a calm scene has no dice tab.
    tileOf(bar, 'Кубик').click();
    assert.deepEqual(calls.at(-1), ['open', false]);
    overlay.render({ ...intim(true), sceneMode: 'calm', dice: null });
    assert.equal(tileOf(bar, 'Кубик'), undefined);
  } finally { overlay.unmount(); }
});
