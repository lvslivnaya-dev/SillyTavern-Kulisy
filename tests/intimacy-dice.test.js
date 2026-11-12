import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState } from '../src/core/index.js';
import { armCue, buildDirectionPrompt, cueBadge, cueLabel, startGeneration } from '../src/core/direction.js';
import { DICE_GROUPS, describeGroups, diceCue, normalizeDice, optionsOf, recordDice, rollDice, togglePick, updateDice, viewGroups } from '../src/core/intimacy-dice.js';

const npcs = [{ id: 'ran', name: 'Ран' }, { id: 'mikey', name: 'Майки' }];
/** A deterministic «random»: walks through the given numbers, then repeats. */
const sequence = (...values) => { let index = 0; return () => values[index++ % values.length]; };

test('a roll gives one pick per group; the optional groups join only some rolls', () => {
  const all = rollDice({}, { npcs, random: sequence(0.01) });
  assert.deepEqual(all.map(pick => pick.group), ['initiative', 'act', 'pace', 'setting', 'mood', 'conditions', 'twist'], 'low numbers: the optional groups are in');
  const few = rollDice({}, { npcs, random: sequence(0.99) });
  assert.deepEqual(few.map(pick => pick.group), ['initiative', 'act', 'pace', 'setting', 'mood'], 'high numbers: the optional ones sit out');
  for (const pick of all) assert.ok(pick.text && pick.en && pick.label && pick.icon);
});

test('the persona never leads: «who leads» is drawn only among the characters the narrator plays', () => {
  for (let roll = 0; roll < 200; roll += 1) {
    const picks = rollDice({}, { npcs });
    const leader = picks.find(pick => pick.group === 'initiative');
    assert.ok(['npc:ran', 'npc:mikey'].includes(leader.id), leader.id);
  }
  // Nobody to play: the group is skipped, never filled with the persona.
  const alone = rollDice({}, { npcs: [], random: sequence(0.01) });
  assert.equal(alone.some(pick => pick.group === 'initiative'), false);
  assert.deepEqual(optionsOf({}, 'initiative', []), []);
  assert.deepEqual(optionsOf({}, 'initiative', npcs).map(option => option.text), ['ведёт Ран', 'ведёт Майки']);
});

test('keep and only: locked picks stay, one group can be re-rolled alone', () => {
  const first = rollDice({}, { npcs, random: sequence(0.01) });
  const pace = first.find(pick => pick.group === 'pace');
  const again = rollDice({}, { npcs, keep: [pace], random: sequence(0.5, 0.9, 0.3) });
  assert.equal(again.find(pick => pick.group === 'pace').id, pace.id, 'the locked group is not rolled');
  const onlyMood = rollDice({}, { npcs, keep: first, only: 'mood', random: sequence(0.9, 0.2) });
  assert.deepEqual(onlyMood.filter(pick => pick.group !== 'mood').map(pick => pick.id), first.filter(pick => pick.group !== 'mood').map(pick => pick.id), 'the others are as before');
  assert.equal(onlyMood.length, first.length);
  // A group asked for by hand always joins, even an optional one.
  const twist = rollDice({}, { npcs, keep: [], only: 'twist', random: sequence(0.99, 0.5) });
  assert.deepEqual(twist.map(pick => pick.group), ['twist']);
});

test('groups can be switched off, options hidden, own options added and removed', () => {
  let settings = updateDice({}, { group: 'pace', off: true });
  assert.equal(rollDice(settings, { npcs, random: sequence(0.01) }).some(pick => pick.group === 'pace'), false);
  settings = updateDice(settings, { group: 'pace', off: false });
  for (const id of ['tender', 'passionate', 'rough', 'lazy', 'playful', 'slow']) settings = updateDice(settings, { group: 'pace', option: id, hidden: true });
  assert.deepEqual(optionsOf(settings, 'pace').map(option => option.id), ['hurried']);
  settings = updateDice(settings, { group: 'pace', option: 'tender', hidden: false });
  assert.deepEqual(optionsOf(settings, 'pace').map(option => option.id), ['tender', 'hurried']);
  settings = updateDice(settings, { group: 'setting', addCustom: '  под   дождём ' });
  const own = optionsOf(settings, 'setting').find(option => option.custom);
  assert.deepEqual([own.text, own.en], ['под дождём', 'под дождём']);
  assert.equal(describeGroups(settings).find(group => group.id === 'setting').options.at(-1).custom, true);
  assert.equal(optionsOf(updateDice(settings, { group: 'setting', removeCustom: own.id }), 'setting').some(option => option.custom), false);
  assert.throws(() => updateDice(settings, { group: 'setting', addCustom: ' ' }), /Впишите/);
  assert.throws(() => updateDice(settings, { group: 'nope', off: true }), /группы/);
  assert.deepEqual(normalizeDice({ groups: { pace: { hidden: [1, 'x'], custom: [{ id: '', text: 'bad' }] } } }).groups.pace, { off: false, hidden: ['x'], custom: [] });
  assert.equal(DICE_GROUPS.length, 8);
});

test('what was sent is remembered and comes up much more rarely', () => {
  let settings = {};
  const picks = rollDice(settings, { npcs, random: sequence(0.01) });
  settings = recordDice(settings, picks);
  assert.equal(normalizeDice(settings).history.length, 1);
  assert.ok(normalizeDice(settings).history[0].includes(`pace:${picks.find(pick => pick.group === 'pace').id}`));
  // With «tender» the last pace, a roll that would have hit it (the first slot) moves on.
  const tender = { group: 'pace', id: 'tender' };
  const remembered = recordDice({}, [tender]);
  let hits = 0;
  for (let roll = 0; roll < 400; roll += 1) if (rollDice(remembered, { npcs, only: 'pace' })[0].id === 'tender') hits += 1;
  let free = 0;
  for (let roll = 0; roll < 400; roll += 1) if (rollDice({}, { npcs, only: 'pace' })[0].id === 'tender') free += 1;
  assert.ok(hits < free / 3, `remembered ${hits} vs ${free}`);
  const off = recordDice(updateDice({}, { avoidRepeat: false }), [tender]);
  assert.equal(normalizeDice(off).avoidRepeat, false);
  assert.equal(normalizeDice(updateDice(settings, { clearHistory: true })).history.length, 0);
  let long = {};
  for (let index = 0; index < 9; index += 1) long = recordDice(long, [{ group: 'pace', id: String(index) }]);
  assert.equal(normalizeDice(long).history.length, 5, 'only the last five');
});

test('the roll becomes one stage direction for one reply, and the persona is never written for', () => {
  const picks = rollDice({}, { npcs, random: sequence(0.01) });
  const { text, detail } = diceCue(picks);
  assert.match(text, / · /);
  assert.match(detail, /^initiative: .+ takes the lead; kind of sex: .+; pace: /);
  const state = createDefaultState();
  const direction = armCue({ cues: [] }, { kind: 'dice', text, detail }, []);
  const cue = direction.cues[0];
  assert.equal(cueBadge(cue), '🎲');
  assert.match(cueLabel(cue, id => id), /^кубик: /);
  const prompt = buildDirectionPrompt(state, startGeneration(direction, 'normal').direction);
  assert.match(prompt, /takes this direction/);
  assert.match(prompt, /\{\{user\}\} is never the one who leads and is never written for/);
  // One roll per reply: a new one replaces the old.
  const second = armCue(direction, { kind: 'dice', text: 'ещё', detail: 'pace: slow' }, []);
  assert.deepEqual(second.cues.map(item => item.text), ['ещё']);
  // A cue without the text or the detail is refused.
  assert.throws(() => armCue({ cues: [] }, { kind: 'dice', text: 'только слова' }, []), /не понят/);
});

test('the kind of sex: oral can be asked or demanded of the persona, and the narrator writes only the characters side', () => {
  const acts = optionsOf({}, 'act');
  assert.deepEqual(acts.map(option => option.id).slice(0, 5), ['vaginal', 'anal', 'oral-gives', 'oral-asks', 'oral-demands']);
  const asks = acts.find(option => option.id === 'oral-asks');
  const demands = acts.find(option => option.id === 'oral-demands');
  assert.match(asks.text, /просит персону/);
  assert.match(demands.text, /требует/);
  assert.match(asks.en, /ASKS the user's character/);
  assert.match(asks.en, /for the user to write/);
  assert.match(demands.en, /never write their compliance/);
});

test('a chip pressed by hand: single groups replace and clear, multi groups add up (a kind of sex can be several)', () => {
  let picks = [];
  picks = togglePick({}, picks, 'pace', 'tender');
  picks = togglePick({}, picks, 'pace', 'rough');
  assert.deepEqual(picks.map(pick => pick.id), ['rough'], 'single: replaced');
  picks = togglePick({}, picks, 'pace', 'rough');
  assert.deepEqual(picks, [], 'pressed again: cleared');
  picks = togglePick({}, picks, 'act', 'vaginal');
  picks = togglePick({}, picks, 'act', 'oral-asks');
  assert.deepEqual(picks.map(pick => pick.id), ['vaginal', 'oral-asks'], 'multi: both burn');
  picks = togglePick({}, picks, 'act', 'vaginal');
  assert.deepEqual(picks.map(pick => pick.id), ['oral-asks']);
  // Groups stay in their order whatever was pressed first.
  picks = togglePick({}, picks, 'mood', 'shy');
  picks = togglePick({}, picks, 'pace', 'lazy');
  assert.deepEqual(picks.map(pick => pick.group), ['act', 'pace', 'mood']);
  // Strangers, the persona and hidden options change nothing.
  assert.deepEqual(togglePick({}, picks, 'initiative', 'npc:persona', npcs), picks);
  assert.deepEqual(togglePick({}, picks, 'nope', 'x'), picks);
  assert.deepEqual(togglePick(updateDice({}, { group: 'mood', option: 'shy', hidden: true }), [], 'mood', 'shy'), []);
  // The direction joins a multi group with «+».
  const { detail } = diceCue(togglePick({}, togglePick({}, [], 'act', 'vaginal'), 'act', 'anal'));
  assert.equal(detail, 'kind of sex: vaginal sex + anal sex');
});

test('a roll keeps what is locked in a multi group whole, and the drawer gets chips for every group', () => {
  const held = togglePick({}, togglePick({}, [], 'act', 'vaginal'), 'act', 'anal');
  const rolled = rollDice({}, { npcs, keep: held, random: sequence(0.5) });
  assert.deepEqual(rolled.filter(pick => pick.group === 'act').map(pick => pick.id), ['vaginal', 'anal']);
  const groups = viewGroups(updateDice({}, { group: 'twist', off: true }), npcs);
  assert.equal(groups.some(group => group.id === 'twist'), false, 'a group that is off is not shown');
  assert.deepEqual(groups.find(group => group.id === 'initiative').options.map(option => option.text), ['ведёт Ран', 'ведёт Майки']);
  assert.equal(groups.find(group => group.id === 'act').multi, true);
  assert.equal(normalizeDice({}).autoRoll, false, 'nothing rolls by itself: what burns is what the user pressed');
  assert.equal(normalizeDice({ auto: true }).autoRoll, false, 'the old «auto» switch is not carried over');
  assert.equal(normalizeDice(updateDice({}, { autoRoll: true })).autoRoll, true);
});
