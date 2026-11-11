import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_ORDER, describeBlocks, readable, scaleChips, unwrap } from '../src/integration/prompt-overview.js';

// Texts copied from a real chat (Bonten), shortened.
const SCENE = `[SCENE STATE — CONTINUITY]
time: day 1, 23:25, (night), "воскресенье, 20 декабря"
place: Пентхаус Бонтен
wears[Manjiro Sano]: полностью обнажен, босой
wears[Нода Иоко]: кожаный ошейник со стальным кольцом, полностью обнажена
also-has[Manjiro Sano]: карамель в прозрачной обертке (во рту у Майки)
place-features: кадки с бамбуком на террасе
place-now: терраса заблокирована магнитными фиксаторами
Rules:
- Keep clothing, injuries and objects consistent with these lines.
- Do not recite or expose this block.
[/SCENE STATE]`;

const KNOWLEDGE = `[KULISY — WHO KNOWS WHAT, NARRATOR CONTROL DATA]
scene: present=Manjiro Sano, Нода Иоко; place=Пентхаус Бонтен
strangers[Yuta Okkotsu & Тогэ]
unknown[Manjiro Sano]: (secret) Махито отправляет предупреждение Иоко | Верхушка Бонтен слышит через дверь
heard[Manjiro Sano]: told by Mahito Ogai — Махито отвечает на звонок Иоко | rumour — Говорят, что Санзу в ярости
secret[Maki Zenin]: Слияние Ю с Матерью проклятий — Когда Ю находилась при смерти, она наткнулась на Мать проклятий
Rules:
- unknown[X] lists events X did NOT witness.
[/KULISY]`;

const RELATIONSHIPS = [
  'Mahito Ogai>Нода Иоко;affection=42(теплеет),family=36(родственное тепло, заботится как о своём),fear=-2',
  'shared-memories[Hajime Kokonoi,Haruchiyo Sanzu,Mahito Ogai]=Бонтен планирует охоту на воровку [known only to: Hajime Kokonoi,Haruchiyo Sanzu,Mahito Ogai; everyone else is unaware]',
  'shared-tensions[Manjiro Sano,Нода Иоко]=Иоко находится под прицелом Бонтена [known only to: Manjiro Sano,Нода Иоко,Hitto Kakucho; everyone else is unaware]',
  'secret-memories=Тайное воспоминание [known only to: Нода Иоко; everyone else is unaware]',
  'headcanon[Манджиро & Иоко]: Майки не любит сладкое, но берёт у неё конфеты',
  'triangle center=Нода Иоко; others=Manjiro Sano,Ran Haitani; grouping only, do not invent love or rivalry',
].join('\n');

test('a block is described in plain words: what, where from, where in the request, how to switch off', () => {
  const blocks = describeBlocks({ parts: { scene: SCENE }, tokens: { scene: 312.4 }, enabled: { calendar: 'выключено в настройках' } });
  assert.deepEqual(blocks.map(block => block.id), [...BLOCK_ORDER]);
  const scene = blocks.find(block => block.id === 'scene');
  assert.equal(scene.state, 'on');
  assert.equal(scene.tokens, 312);
  assert.match(scene.what, /который час/);
  assert.match(scene.source, /Гардероб/);
  assert.match(scene.where, /последними сообщениями/);
  assert.match(scene.off, /Сцена в промпт/);
  assert.deepEqual(scene.tab, ['scene', 'Сейчас']);
  assert.equal(blocks.find(block => block.id === 'calendar').state, 'off');
  assert.equal(blocks.find(block => block.id === 'calendar').why, 'выключено в настройках');
  assert.equal(blocks.find(block => block.id === 'knowledge').state, 'empty');
  assert.match(blocks.find(block => block.id === 'direction').why, /ничего не поставлено/);
  assert.equal(describeBlocks({ parts: { scene: SCENE }, enabled: { scene: 'выключено' } }).find(block => block.id === 'scene').state, 'off', 'text of a switched-off block is not «sent»');
});

test('scene: time, place, clothes and things in words; the fixed rules are kept apart', () => {
  const { sections, rules } = readable('scene', SCENE);
  const rows = sections[0].items.map(item => `${item.head} | ${item.text}`);
  assert.deepEqual(rows, [
    'Время | день истории 1, 23:25, ночь, "воскресенье, 20 декабря"',
    'Место | Пентхаус Бонтен',
    'Одет(а): Manjiro Sano | полностью обнажен, босой',
    'Одет(а): Нода Иоко | кожаный ошейник со стальным кольцом, полностью обнажена',
    'Ещё при себе: Manjiro Sano | карамель в прозрачной обертке (во рту у Майки)',
    'Особенности места | кадки с бамбуком на террасе',
    'Что сейчас в месте | терраса заблокирована магнитными фиксаторами',
  ]);
  assert.match(rules, /Keep clothing/);
  assert.doesNotMatch(rows.join('\n'), /SCENE STATE|Rules/);
});

test('knowledge: who is in the scene, what each does not know, hearsay, secrets, strangers', () => {
  const { sections, rules } = readable('knowledge', KNOWLEDGE);
  const byTitle = Object.fromEntries(sections.map(section => [section.title, section.items]));
  assert.equal(byTitle['Кто в сцене'][0].text, 'Manjiro Sano, Нода Иоко. Место: Пентхаус Бонтен');
  assert.deepEqual(byTitle['Чего они не знают'].map(item => [item.head, item.text, item.note]), [
    ['Manjiro Sano не знает', 'Махито отправляет предупреждение Иоко', 'секрет'],
    ['Manjiro Sano не знает', 'Верхушка Бонтен слышит через дверь', ''],
  ]);
  assert.deepEqual(byTitle['Что знают только со слов других'].map(item => [item.text, item.note]), [
    ['Махито отвечает на звонок Иоко', 'рассказал(а) Mahito Ogai'], ['Говорят, что Санзу в ярости', 'слух'],
  ]);
  assert.match(byTitle['Секреты'][0].text, /Слияние Ю с Матерью проклятий — Когда Ю/);
  assert.equal(byTitle['Кто не знаком'][0].head, 'Yuta Okkotsu и Тогэ');
  assert.match(rules, /did NOT witness/);
});

test('relationships: feelings as labelled numbers, records with who knows, headcanons, triangles', () => {
  assert.deepEqual(scaleChips('affection=42(теплеет),family=36(родственное тепло, заботится как о своём),fear=-2'), [
    { label: 'Привязанность', value: 42, hint: 'теплеет' },
    { label: 'Семейная любовь', value: 36, hint: 'родственное тепло, заботится как о своём' },
    { label: 'Страх', value: -2, hint: '' },
  ]);
  const { sections } = readable('relationships', RELATIONSHIPS);
  const byTitle = Object.fromEntries(sections.map(section => [section.title.split(' (')[0], section.items]));
  assert.equal(byTitle['Чувства'][0].head, 'Mahito Ogai → Нода Иоко');
  assert.equal(byTitle['Чувства'][0].chips.length, 3);
  const memories = byTitle['Общие воспоминания'];
  assert.deepEqual([memories[0].head, memories[0].note], ['Hajime Kokonoi, Haruchiyo Sanzu, Mahito Ogai', ''], 'знают все участники: пометка лишняя');
  assert.equal(memories[1].head, 'тайное');
  assert.equal(memories[1].note, 'знают: Нода Иоко');
  assert.equal(byTitle['Напряжения'][0].note, 'знают: Manjiro Sano, Нода Иоко, Hitto Kakucho', 'знает больше людей, чем участвует');
  assert.deepEqual([byTitle['Хедканоны'][0].head, byTitle['Хедканоны'][0].text], ['Манджиро & Иоко', 'Майки не любит сладкое, но берёт у неё конфеты']);
  assert.match(byTitle['Треугольники'][0].text, /center=Нода Иоко/);
});

test('unrecognised lines are never lost, and a broken reader does not throw', () => {
  const { sections } = readable('relationships', 'что-то совсем другое');
  assert.deepEqual(sections[0].items, [{ head: '', text: 'что-то совсем другое' }]);
  assert.deepEqual(readable('knowledge', 'ещё строка').sections[0].items, [{ head: '', text: 'ещё строка' }]);
  assert.deepEqual(unwrap('[TAG]\na: b\n[/TAG]').lines, ['a: b']);
  assert.deepEqual(readable('chronicle', 'Глава 1: Судзу пришла.\nСцена 1: Драка.').sections[0].items.map(item => item.head), ['Глава 1', 'Сцена 1']);
  assert.doesNotThrow(() => readable('nope', null));
});

test('calendar and a pair with no feelings yet read in words too', () => {
  const calendar = readable('calendar', '[KULISY — STORY CALENDAR]\ntoday: воскресенье, 20 декабря 2026 (story day 1)\nsoon (in 2 d., вт 22 дек): Собрание шести (Майки, Ран)\nRules:\n- today is the date.\n[/KULISY]');
  assert.deepEqual(calendar.sections[0].items.map(item => [item.head, item.text]), [
    ['Сегодня', 'воскресенье, 20 декабря 2026 (день истории 1)'], ['Скоро (через 2 дн., вт 22 дек)', 'Собрание шести (Майки, Ран)'],
  ]);
  const pairs = readable('relationships', 'Rindo Haitani>Нода Иоко');
  assert.equal(pairs.sections[0].title.startsWith('Чувства'), true);
  assert.match(pairs.sections[0].items[0].text, /пока ровно/);
});
