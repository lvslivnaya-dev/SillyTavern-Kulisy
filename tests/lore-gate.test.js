import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createDefaultState, createOperation, importState } from '../src/core/index.js';
import { applyGate, namedInText, normalizeGate, parseGateTitle, planGate } from '../src/integration/lore-gate.js';
import { materializeClock, parseWorld } from '../src/integration/world-analysis.js';

const rx = word => `/(?<![\\p{L}\\p{M}\\p{N}_-])${word}(?![\\p{L}\\p{M}\\p{N}_-])/iu`;

function setup(present = ['mikey', 'sanzu']) {
  const state = applyOperations(createDefaultState(), [
    createOperation('entity.upsert', { id: 'me', name: 'Иоко' }),
    createOperation('entity.upsert', { id: 'mikey', name: 'Майки', aliases: ['Манджиро', 'Сано Манджиро'] }),
    createOperation('entity.upsert', { id: 'sanzu', name: 'Санзу', aliases: ['Харучиё'] }),
    createOperation('entity.upsert', { id: 'kaku', name: 'Какучо' }),
    createOperation('scene.set', { presentIds: present }),
  ]);
  state.ui = { ...state.ui, personaId: 'me' };
  return state;
}

let uid = 0;
const entry = (comment, key, content = 'text') => ({ uid: uid += 1, world: 'Бонтен', comment, key: [rx(key)], keysecondary: [rx('голос')], content, constant: false });

function lists() {
  return {
    globalLore: [],
    characterLore: [
      entry('[ Manjiro Sano ] - Basic Info', 'майки'),
      entry('[ Manjiro Sano ] - Character and psychology', 'майки'),
      entry('[ Manjiro Sano ] - Voice', 'майки'),
      entry('[ Manjiro Sano ] - Visual', 'майки'),
      entry('[ Manjiro Sano ] - Relationships', 'майки', 'Sanzu is his loyal dog. Kakucho keeps order.'),
      entry('[ Manjiro Sano ] - NSFW module', 'майки', 'x'.repeat(500)),
      entry('[ Manjiro Sano ] - Biography', 'майки'),
      entry('[ Haruchiyo Sanzu ] - Basic Info', 'санзу'),
      entry('[ Haruchiyo Sanzu ] - Skills', 'санзу'),
      entry('[ Hitto Kakucho ] - Basic Info', 'какучо'),
      entry('[ Hitto Kakucho ] - Visual', 'какучо'),
      entry('[ Draken ] - Basic Info', 'дракен'),
      entry('Пентхаус Бонтен - Кухня', 'кухня'),
    ],
    chatLore: [],
    personaLore: [entry('[ Иоко ] - Visual', 'иоко')],
  };
}

const on = { enabled: true };
const titles = payload => Object.values(payload).flat().map(item => item.comment);
const forced = payload => Object.values(payload).flat().filter(item => item.constant).map(item => item.comment);

test('titles: only «[ Name ] - Section» is a sheet section', () => {
  assert.deepEqual(parseGateTitle('[ Manjiro Sano ] - Character and psychology'), { name: 'Manjiro Sano', section: 'character' });
  assert.deepEqual(parseGateTitle('[ Ран ] — Внешность'), { name: 'Ран', section: 'visual' });
  assert.equal(parseGateTitle('[ Manjiro Sano ] - Public Info').section, 'other');
  assert.equal(parseGateTitle('Пентхаус Бонтен - Кухня'), null);
  assert.equal(parseGateTitle('[☰] World Setting [☰]'), null);
});

test('on stage: sheet by the rules, off stage: only what the rule allows, the rest untouched', () => {
  const payload = lists();
  const before = payload.characterLore.map(item => ({ ...item }));
  const originals = [...payload.characterLore];
  const { decisions, report } = planGate({ lists: payload, state: setup(), config: on, presentIds: ['mikey', 'sanzu'], turn: 3, tracker: new Map() });
  applyGate(payload, decisions);
  assert.deepEqual(forced(payload), [
    '[ Manjiro Sano ] - Basic Info', '[ Manjiro Sano ] - Character and psychology', '[ Manjiro Sano ] - Voice',
    '[ Manjiro Sano ] - Visual', '[ Manjiro Sano ] - Relationships', '[ Haruchiyo Sanzu ] - Basic Info',
  ]);
  const left = titles(payload);
  assert.ok(!left.includes('[ Manjiro Sano ] - NSFW module'), 'не близость');
  assert.ok(!left.includes('[ Haruchiyo Sanzu ] - Skills'), 'не бой');
  assert.ok(!left.includes('[ Hitto Kakucho ] - Visual'), 'не на сцене');
  // Left to SillyTavern's keys, unchanged: an absent character's Basic Info, «other» sections, unknown people, places, the persona.
  for (const title of ['[ Hitto Kakucho ] - Basic Info', '[ Manjiro Sano ] - Biography', '[ Draken ] - Basic Info', 'Пентхаус Бонтен - Кухня', '[ Иоко ] - Visual']) {
    assert.ok(left.includes(title), title);
    assert.ok(!forced(payload).includes(title), title);
  }
  assert.deepEqual(originals.map(item => item.constant), before.map(() => false), 'сами записи лорбука не меняются');
  assert.equal(report.dropped, 3);
  assert.equal(report.savedCharacters, 500 + 4 + 4);
  assert.equal(report.people[0].present, true);
});

test('scene mode opens fight and intimacy sections', () => {
  const run = mode => { const payload = lists(); applyGate(payload, planGate({ lists: payload, state: setup(), config: on, presentIds: ['mikey', 'sanzu'], mode, turn: 1 }).decisions); return forced(payload); };
  assert.ok(run('intim').includes('[ Manjiro Sano ] - NSFW module'));
  assert.ok(!run('intim').includes('[ Haruchiyo Sanzu ] - Skills'));
  assert.ok(run('fight').includes('[ Haruchiyo Sanzu ] - Skills'));
});

test('Visual: on entrance, again on a swipe of that reply, then every N posts, and again after coming back', () => {
  const tracker = new Map();
  const visual = (turn, present = ['mikey']) => {
    const payload = lists();
    applyGate(payload, planGate({ lists: payload, state: setup(present), config: { enabled: true, visualEvery: 3 }, presentIds: present, turn, tracker }).decisions);
    return forced(payload).includes('[ Manjiro Sano ] - Visual');
  };
  assert.equal(visual(5), true, 'вышел на сцену');
  assert.equal(visual(5), true, 'свайп того же ответа');
  assert.equal(visual(6), false);
  assert.equal(visual(7), false);
  assert.equal(visual(8), true, 'прошло три поста');
  assert.equal(visual(9, ['sanzu']), false, 'ушёл со сцены');
  assert.equal(visual(10), true, 'вернулся');
});

test('Relationships need someone it speaks about: on stage or named in the fresh post', () => {
  const rel = (present, namedText = '') => {
    const payload = lists();
    applyGate(payload, planGate({ lists: payload, state: setup(present), config: on, presentIds: present, turn: 1, namedText }).decisions);
    return titles(payload).includes('[ Manjiro Sano ] - Relationships');
  };
  assert.equal(rel(['mikey']), false, 'один на сцене');
  assert.equal(rel(['mikey', 'sanzu']), true);
  assert.equal(rel(['mikey'], 'А где сейчас Какучо?'), true, 'назван в свежем посте');
});

test('fail open: off, or nobody known on stage, touches nothing', () => {
  for (const options of [{ config: { enabled: false }, presentIds: ['mikey'] }, { config: on, presentIds: [] }, { config: on, presentIds: ['me'] }]) {
    const payload = lists();
    const { decisions } = planGate({ lists: payload, state: setup(options.presentIds), turn: 1, ...options });
    assert.equal(decisions.size, 0);
  }
});

test('rules are editable and unknown values fall back to the defaults', () => {
  const gate = normalizeGate({ enabled: true, visualEvery: 999, sections: { nsfw: { when: 'always' }, basic: { when: 'bogus', absent: 'never' } } });
  assert.equal(gate.visualEvery, 50);
  assert.deepEqual(gate.sections.nsfw, { when: 'always', absent: 'never' });
  assert.deepEqual(gate.sections.basic, { when: 'always', absent: 'never' });
  assert.equal(gate.named, 'core');
  assert.equal(normalizeGate({ named: 'stage' }).named, 'stage');
  const payload = lists();
  applyGate(payload, planGate({ lists: payload, state: setup(), config: gate, presentIds: ['mikey'], turn: 1 }).decisions);
  assert.ok(forced(payload).includes('[ Manjiro Sano ] - NSFW module'));
  assert.ok(!titles(payload).includes('[ Hitto Kakucho ] - Basic Info'));
});

test('scene mode: the chronicler sets it, it is journaled, calm is not stored', () => {
  assert.equal(parseWorld({ clock: { mode: 'intim' } }).clock.mode, 'intim');
  assert.equal(parseWorld({ clock: { mode: 'party' } }).clock, null);
  let state = setup();
  const added = [];
  const api = { state: () => state, add: (type, payload, reason) => added.push({ type, payload, reason }) };
  materializeClock({ clock: { mode: 'calm' } }, api);
  assert.equal(added.length, 0, 'спокойная сцена и так спокойная');
  materializeClock({ clock: { mode: 'fight' } }, api);
  assert.deepEqual(added[0].payload, { mode: 'fight' });
  assert.match(added[0].reason, /бой/);
  state = applyOperations(state, [createOperation('clock.set', added[0].payload)]);
  assert.equal(state.world.clock.mode, 'fight');
  assert.doesNotThrow(() => importState(state));
  state = applyOperations(state, [createOperation('clock.set', { mode: 'calm' })]);
  assert.equal(state.world.clock.mode, undefined);
});

test('names in the posts: whole capitalised words with a case ending, not pieces of other words', () => {
  const people = [{ id: 'ran', name: 'Ran Haitani', aliases: ['Ран', 'Хайтани Ран'] }, { id: 'rindo', name: 'Rindo', aliases: ['Риндо', 'Рин'] }, { id: 'kaku', name: 'Какучо', aliases: [] }];
  const found = text => [...namedInText(text, people)].sort();
  assert.deepEqual(found('Вызовы охраны перевели, было ещё рано, а раны ныли.'), []);
  assert.deepEqual(found('Она покосилась на Рана.'), ['ran']);
  assert.deepEqual(found('«Хайтани Ран здесь?»'), ['ran']);
  assert.deepEqual(found('В коридоре послышались шаги Какучо, а за ним шёл Риндо.'), ['kaku', 'rindo']);
  assert.deepEqual(found(''), []);
});

test('named in the posts but not on stage: the core of the sheet goes out, the rest stays held', () => {
  const run = (named, namedText = '«Майки, я открыл замок», сообщил Какучо через дверь.') => {
    const payload = lists();
    const { decisions, report } = planGate({ lists: payload, state: setup(['mikey']), config: { enabled: true, named }, presentIds: ['mikey'], turn: 1, namedText });
    applyGate(payload, decisions);
    return { sent: forced(payload), left: titles(payload), person: report.people.find(item => item.id === 'kaku') };
  };
  const core = run('core');
  assert.ok(core.sent.includes('[ Hitto Kakucho ] - Basic Info'));
  assert.ok(!core.left.includes('[ Hitto Kakucho ] - Visual'), 'внешность только тем, кто на сцене');
  assert.equal(core.person.named, true);
  assert.equal(core.person.present, false);
  assert.ok(run('stage').sent.includes('[ Hitto Kakucho ] - Visual'));
  const off = run('absent');
  assert.ok(!off.sent.includes('[ Hitto Kakucho ] - Basic Info'));
  assert.ok(off.left.includes('[ Hitto Kakucho ] - Basic Info'), 'оставлено ключам');
  assert.equal(run('core', 'Тишина.').person.named, false);
});

test('a passing mention in the last reply is not enough; acting there (two sentences) or a name in the fresh post is', () => {
  const run = (replyText, namedText = '') => {
    const payload = lists();
    const { decisions, report } = planGate({ lists: payload, state: setup(['mikey']), config: on, presentIds: ['mikey'], turn: 1, replyText, namedText });
    applyGate(payload, decisions);
    return { sent: forced(payload), person: report.people.find(item => item.id === 'kaku') };
  };
  const passing = run('Майки сдвинул поднос, который оставил Какучо. Потом лёг.');
  assert.equal(passing.person.named, false);
  assert.ok(!passing.sent.includes('[ Hitto Kakucho ] - Basic Info'));
  const acting = run('В коридоре послышались шаги Какучо. «Я открыл замок», сообщил Какучо через дверь.');
  assert.equal(acting.person.named, true);
  assert.ok(acting.sent.includes('[ Hitto Kakucho ] - Basic Info'));
  assert.equal(run('Тишина.', 'Она спросила, где Какучо.').person.named, true);
  // Relationships still open on a single mention: the pair is being talked about.
  assert.ok(passing.sent.includes('[ Manjiro Sano ] - Relationships'));
});
