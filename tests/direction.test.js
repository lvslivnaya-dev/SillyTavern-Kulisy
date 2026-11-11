import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeCues, armCue, buildDirectionPrompt, cueLabel, normalizeDirection, normalizeFavorites,
  presenceAfterReply, removeCue, silenceCounts, startGeneration,
} from '../src/core/direction.js';
import { createDefaultState, importState } from '../src/core/index.js';

const ids = ['ran', 'rindo', 'suzu'];
const state = { entities: { ran: { id: 'ran', name: 'Ран' }, rindo: { id: 'rindo', name: 'Риндо' }, suzu: { id: 'suzu', name: 'Судзу' } } };

test('an armed cue rides with the next post, holds for swipes, burns with the post after', () => {
  let direction = armCue({ cues: [] }, { id: 'c1', kind: 'enter', entityId: 'ran' }, ids);
  assert.equal(activeCues(direction).length, 0, 'armed, not yet in force');
  assert.equal(buildDirectionPrompt(state, direction), '');

  let step = startGeneration(direction, 'normal');
  assert.deepEqual(step.fired, ['c1']);
  direction = step.direction;
  assert.match(buildDirectionPrompt(state, direction), /Ран steps in/);

  for (const type of ['swipe', 'regenerate', 'continue']) {
    step = startGeneration(direction, type);
    assert.equal(step.changed, false, `${type} keeps it`);
    assert.equal(activeCues(step.direction).length, 1);
  }
  assert.equal(startGeneration(direction, 'quiet').changed, false, 'background requests do not count');
  assert.equal(startGeneration(direction, 'impersonate').changed, false);

  step = startGeneration(direction, 'normal');
  assert.equal(step.direction.cues.length, 0, 'the next turn burns it');
  assert.equal(startGeneration(direction, undefined).direction.cues.length, 0, 'ST sends a plain post with no type');
});

test('a cue armed after the reply joins its swipes', () => {
  let direction = startGeneration(armCue({ cues: [] }, { id: 'a', kind: 'enter', entityId: 'ran' }, ids), 'normal').direction;
  direction = armCue(direction, { id: 'b', kind: 'hold', entityId: 'rindo' }, ids);
  const step = startGeneration(direction, 'swipe');
  assert.deepEqual(step.fired, ['b']);
  assert.equal(activeCues(step.direction).length, 2);
});

test('a waiting cue counts down by posts, not by swipes', () => {
  let direction = armCue({ cues: [] }, { id: 'w', kind: 'call', entityId: 'rindo', wait: 2 }, ids);
  direction = startGeneration(direction, 'normal').direction;
  assert.equal(direction.cues[0].wait, 1);
  direction = startGeneration(direction, 'swipe').direction;
  assert.equal(direction.cues[0].wait, 1, 'a swipe does not count');
  direction = startGeneration(direction, 'normal').direction;
  assert.equal(direction.cues[0].wait, 0);
  assert.equal(activeCues(direction).length, 0);
  const step = startGeneration(direction, 'normal');
  assert.deepEqual(step.fired, ['w']);
  assert.match(buildDirectionPrompt(state, step.direction), /Риндо comes into the scene/);
  assert.deepEqual(presenceAfterReply(step.direction), { add: ['rindo'], remove: [], cast: null, place: null });
});

test('one of enter/hold/call/leave per character, one focus per reply, hold and focus exclude each other', () => {
  let direction = armCue({ cues: [] }, { id: '1', kind: 'enter', entityId: 'ran' }, ids);
  direction = armCue(direction, { id: '2', kind: 'hold', entityId: 'ran' }, ids);
  assert.deepEqual(direction.cues.map(cue => cue.id), ['2']);
  direction = armCue(direction, { id: '3', kind: 'focus', entityId: 'ran' }, ids);
  assert.deepEqual(direction.cues.map(cue => cue.id), ['3']);
  direction = armCue(direction, { id: '4', kind: 'focus', entityId: 'rindo' }, ids);
  assert.deepEqual(direction.cues.map(cue => cue.id), ['4']);
  direction = armCue(direction, { id: '5', kind: 'custom', entityId: 'ran', text: 'пусть приревнует' }, ids);
  direction = armCue(direction, { id: '6', kind: 'custom', entityId: 'ran', text: 'и подколет' }, ids);
  assert.equal(direction.cues.length, 3, 'custom cues add up');
  assert.deepEqual(removeCue(direction, '5').cues.map(cue => cue.id), ['4', '6']);
});

test('bad cues are refused; cues about removed characters are dropped', () => {
  assert.throws(() => armCue({ cues: [] }, { kind: 'enter', entityId: 'ghost' }, ids), /Пинок не понят/);
  assert.throws(() => armCue({ cues: [] }, { kind: 'custom', entityId: 'ran', text: '  ' }, ids));
  assert.throws(() => armCue({ cues: [] }, { kind: 'react', entityId: 'ran' }, ids), 'react needs a target');
  const direction = normalizeDirection({ cues: [{ id: 'x', kind: 'enter', entityId: 'gone' }, { id: 'y', kind: 'event' }, { kind: 'bogus' }] }, ids);
  assert.deepEqual(direction.cues.map(cue => cue.id), ['y']);
});

test('every kind has a narrator line; a secret is sent only while its keeper is on stage', () => {
  const cues = [
    { id: 'a', kind: 'react', entityId: 'ran', targetId: 'last' },
    { id: 'b', kind: 'react', entityId: 'rindo', targetId: 'suzu' },
    { id: 'c', kind: 'factor', entityId: 'ran', targetId: 'suzu', text: 'заступается за неё при всех' },
    { id: 'd', kind: 'secret', entityId: 'rindo', text: 'сломал руку брату', eventId: 'e1' },
    { id: 'e', kind: 'leave', entityId: 'suzu' },
    { id: 'f', kind: 'event' },
    { id: 'g', kind: 'event', text: 'в дверь звонят' },
  ].map(cue => ({ ...cue, used: true }));
  const direction = normalizeDirection({ cues }, ids);
  const text = buildDirectionPrompt(state, direction, { presentIds: ['ran', 'rindo', 'suzu'] });
  assert.match(text, /Ран openly reacts to what has just happened/);
  assert.match(text, /Риндо reacts to Судзу/);
  assert.match(text, /how Судзу feels about Ран.*заступается/);
  assert.match(text, /«сломал руку брату».*do NOT reveal it/);
  assert.match(text, /Судзу leaves the scene/);
  assert.match(text, /pick what fits the place/);
  assert.match(text, /changes the scene: в дверь звонят/);
  assert.match(text, /Never write \{\{user\}\}'s actions/);
  const offstage = buildDirectionPrompt(state, direction, { presentIds: ['ran', 'suzu'] });
  assert.doesNotMatch(offstage, /сломал руку/);
  assert.deepEqual(presenceAfterReply(direction), { add: [], remove: ['suzu'], cast: null, place: null });
  assert.equal(cueLabel(direction.cues[0], id => state.entities[id].name), 'Ран → последнее');
});

test('silence counts bot replies without a mention, newest first; user posts do not count', () => {
  const mentions = text => new Set(ids.filter(id => text.includes(state.entities[id].name)));
  const messages = [
    { isUser: false, text: 'Ран смеётся.' },
    { isUser: false, text: 'Риндо молча курит.' },
    { isUser: true, text: 'Ран, ты чего?' },
    { isUser: false, text: 'Судзу отворачивается.' },
    { isUser: false, text: 'Тишина.' },
  ];
  const counts = silenceCounts(messages, ['ran', 'rindo', 'suzu'], mentions);
  assert.equal(counts.get('suzu'), 1);
  assert.equal(counts.get('rindo'), 2);
  assert.equal(counts.get('ran'), 3, 'her own post naming him is not him speaking');
});

test('favourites: trimmed, unique, capped', () => {
  assert.deepEqual(normalizeFavorites([' пусть приревнует ', 'Пусть приревнует', '', 'подколет']), ['пусть приревнует', 'подколет']);
  assert.equal(normalizeFavorites(Array.from({ length: 50 }, (_, index) => `t${index}`)).length, 30);
});

test('the chat state keeps the cues through save and load', () => {
  const base = createDefaultState();
  const saved = importState({ ...base, ui: { ...base.ui, direction: { cues: [{ id: 'k', kind: 'event', wait: 1, used: false }] } } });
  assert.deepEqual(saved.ui.direction.cues.map(cue => cue.id), ['k']);
});

test('a factor of the kicked one\'s own line: open to the moment, never acting for the other', () => {
  const direction = normalizeDirection({ cues: [{ id: 'o', kind: 'factor', side: 'out', entityId: 'ran', targetId: 'suzu', text: 'она прикрывает его перед братом', used: true }] }, ids);
  assert.equal(direction.cues[0].side, 'out');
  const text = buildDirectionPrompt(state, direction);
  assert.match(text, /Ран's feelings toward Судзу can be moved by moments like this: она прикрывает его/);
  assert.match(text, /Ран is open to such a moment/);
  assert.doesNotMatch(text, /Ран does something like this/);
});

test('a new scene: text, time skip, place and cast reach the narrator; the reply sets who and where', () => {
  let direction = armCue({ cues: [] }, { id: 's1', kind: 'scene', text: 'утро после драки', skip: 'nextday', place: 'палуба', placeId: 'deck', castIds: ['ran', 'ghost', 'suzu'] }, ids);
  assert.deepEqual(direction.cues[0].castIds, ['ran', 'suzu'], 'unknown people are dropped');
  direction = armCue(direction, { id: 's2', kind: 'scene', text: 'вечер в баре' }, ids);
  assert.deepEqual(direction.cues.map(cue => cue.id), ['s2'], 'one new scene per reply');
  direction = armCue(direction, { id: 's3', kind: 'scene', text: 'утро после драки', skip: 'nextday', place: 'палуба', placeId: 'deck', castIds: ['ran', 'suzu'] }, ids);
  direction = startGeneration(direction, 'normal').direction;
  const text = buildDirectionPrompt(state, direction);
  assert.match(text, /Start a NEW scene in this reply, the next day: утро после драки\. Place: палуба\. In the scene: Ран, Судзу\./);
  assert.match(text, /clean break from the previous scene/);
  assert.deepEqual(presenceAfterReply(direction), { add: [], remove: [], cast: ['ran', 'suzu'], place: { location: 'палуба', locationId: 'deck' } });
});

test('an empty new scene is allowed (the narrator decides); a note needs text', () => {
  const direction = startGeneration(armCue({ cues: [] }, { kind: 'scene' }, ids), 'normal').direction;
  assert.match(buildDirectionPrompt(state, direction), /a fresh scene that follows naturally/);
  assert.deepEqual(presenceAfterReply(direction), { add: [], remove: [], cast: null, place: null });
  assert.throws(() => armCue({ cues: [] }, { kind: 'note', text: '' }, ids));
  const note = startGeneration(armCue({ cues: [] }, { kind: 'note', text: 'короче, больше атмосферы' }, ids), 'normal').direction;
  assert.match(buildDirectionPrompt(state, note), /Note for the narrator: короче, больше атмосферы/);
  assert.equal(cueLabel(note.cues[0], () => ''), 'рассказчику: короче, больше атмосферы');
});

test('recall cue: needs text, the same text is armed once, and it tells the narrator to bring it back', async () => {
  const { armCue, startGeneration, buildDirectionPrompt, cueLabel } = await import('../src/core/direction.js');
  assert.throws(() => armCue({ cues: [] }, { kind: 'recall', text: '' }));
  let direction = armCue({ cues: [] }, { kind: 'recall', text: 'Поцелуй под дождём' });
  direction = armCue(direction, { kind: 'recall', text: 'Поцелуй под дождём' });
  direction = armCue(direction, { kind: 'recall', text: 'Клятва на крыше' });
  assert.equal(direction.cues.length, 2);
  assert.equal(cueLabel(direction.cues[0], () => ''), 'вспомнить: Поцелуй под дождём');
  const fired = startGeneration(direction, 'normal').direction;
  const prompt = buildDirectionPrompt({ entities: {} }, fired);
  assert.match(prompt, /Bring this back into play in this reply: «Поцелуй под дождём»/);
  assert.equal(startGeneration(fired, 'normal').direction.cues.length, 0, 'сгорает на следующем ходу');
});

test('an event with a genre tells the narrator the genre and keeps the label for the badge', () => {
  const state = createDefaultState();
  const direction = armCue({ cues: [] }, { kind: 'event', genre: 'pressure' }, []);
  const cue = direction.cues[0];
  assert.equal(cue.genre, 'pressure');
  assert.equal(cue.text, 'Психологическое давление');
  assert.equal(armCue({ cues: [] }, { kind: 'event', genre: 'nonsense' }, []).cues[0].genre, undefined);
  const forced = startGeneration(direction, 'normal').direction;
  assert.match(buildDirectionPrompt(state, forced), /genre: psychological pressure/);
  const detailed = startGeneration(armCue({ cues: [] }, { kind: 'event', genre: 'fight', text: 'за ужином' }, []), 'normal').direction;
  assert.match(buildDirectionPrompt(state, detailed), /Details: за ужином/);
  assert.match(cueLabel(cue, id => id), /Психологическое давление/);
});
