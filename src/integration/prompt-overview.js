/**
 * «Что получает модель»: everything Kulisy adds to the next request, described in plain words.
 *
 * Pure (no DOM, no SillyTavern). index.js hands it the finished blocks and the settings; the settings
 * page draws the result. Each block says what it is, where it comes from, where in the request it
 * sits and how to switch it off, and carries the same text split into readable rows. The exact text
 * the model receives stays available next to it. `readable(id, text)` is called by the page only for the blocks it draws.
 */
import { DEFAULT_SCALES } from '../core/schema.js';

const SCALE_LABELS = Object.fromEntries(DEFAULT_SCALES.map(scale => [scale.id, scale.label]));

/**
 * Order = the order the model meets them: the chronicle opens the request, the blocks near the end of the chat
 * come next, the stage direction is the very last.
 */
export const BLOCK_ORDER = Object.freeze(['chronicle', 'scene', 'calendar', 'knowledge', 'names', 'relationships', 'direction']);

const DESCRIPTIONS = Object.freeze({
  chronicle: {
    title: 'Хроника: что было раньше',
    what: 'Короткие пересказы давних сцен. Благодаря им модель помнит сюжет, а сами старые сообщения можно убрать из запроса.',
    source: 'Страница «Хроника»: пересказы пишет модель после каждых нескольких сообщений.',
    where: 'В самом начале запроса, раньше всей истории чата.',
    off: 'Настройки → «Хроника и сжатие» → переключатель «Хроника».',
    tab: ['chronicle', 'Хроника'],
    section: 'chronicle',
  },
  scene: {
    title: 'Сцена: время, место, одежда, вещи',
    what: 'Что происходит вокруг прямо сейчас: который час, какая погода, где все находятся, кто во что одет, какие вещи у кого. Сюда же попадают напоминания, которые ты ставила рассказчику.',
    source: 'Страницы «Сейчас», «Локации», «Гардероб», «Вещи», «Погода». После каждого ответа их обновляет летописец сцены.',
    where: 'Рядом с последними сообщениями чата, перед самым последним.',
    off: 'Настройки → «Знания и сцена» → «Сцена в промпт».',
    tab: ['scene', 'Сейчас'],
    section: 'scene',
  },
  calendar: {
    title: 'Календарь: какое сегодня число',
    what: 'Дата истории и ближайшие события из календаря. Модель следит, чтобы дни недели и сроки не расходились.',
    source: 'Страница «Календарь» и время, которое ведёт летописец.',
    where: 'Рядом с последними сообщениями чата, перед самым последним.',
    off: 'Настройки → «Знания и сцена» → «Календарь в промпт».',
    tab: ['calendar', 'Календарь'],
    section: 'scene',
  },
  knowledge: {
    title: 'Кто что знает',
    what: 'Что известно каждому из тех, кто в сцене: чего он не видел и не слышал, что знает только со слов других, какие секреты у него есть, кто с кем не знаком.',
    source: 'Страницы «Лента событий», «Секреты», «Персонажи». События и знакомства записывает летописец после каждого ответа.',
    where: 'Рядом с последними сообщениями чата, перед самым последним.',
    off: 'Настройки → «Знания и сцена» → «Знания в промпт».',
    tab: ['events', 'Лента событий'],
    section: 'scene',
  },
  names: {
    title: 'Имена: как писать и склонять',
    what: 'Написание и падежи имён тех, кто в сцене или назван в последних постах. Модель перестаёт путать написания и склонять имена как придётся.',
    source: 'Страница «Имена» (Мир → Имена): библиотека имён, общая для всех чатов.',
    where: 'Рядом с последними сообщениями чата, перед самым последним.',
    off: 'Мир → Имена: переключатель «Отправлять имена», либо переключатель имени, либо «Выключить в этом чате».',
    tab: ['names', 'Имена'],
    section: 'scene',
  },
  relationships: {
    title: 'Отношения: чувства, воспоминания, напряжения',
    what: 'Как персонажи относятся друг к другу: числа чувств со словесной подписью, общие воспоминания и напряжения, хедканоны и правила для треугольников. Берутся только те пары, что связаны с текущей сценой.',
    source: 'Страницы «Все отношения», «Воспоминания», «Напряжения», «Хедканоны». Числа меняет анализ ответов.',
    where: 'Рядом с последними сообщениями чата, перед самым последним.',
    off: 'Настройки → «Модули» → карточка «Отношения». Воспоминания, напряжения и хедканоны отключаются по отдельности в «Настройки → Отношения».',
    tab: ['overview', 'Все отношения'],
    section: 'relations',
  },
  direction: {
    title: 'Подсказка режиссёра',
    what: 'То, что ты задала кнопкой «Пнуть» или «Сцена» в панели над полем ввода: войти, заговорить, вспомнить. Уходит один раз, с ближайшим ответом.',
    source: 'Панель сцены над полем ввода.',
    where: 'В самом конце запроса, после последнего сообщения.',
    off: 'Пока ничего не поставлено, блока нет.',
    tab: null,
    section: 'behaviour',
  },
});

/**
 * parts:    { chronicle, scene, calendar, knowledge, relationships, direction } — the texts as the model gets them ('' = none);
 * tokens:   { id: number };
 * enabled:  { id: boolean | string } — true, or the reason it is switched off.
 */
export function describeBlocks({ parts = {}, tokens = {}, enabled = {} } = {}) {
  return BLOCK_ORDER.map(id => {
    const text = String(parts[id] ?? '').trim();
    const flag = enabled[id] ?? true;
    const on = flag === true;
    const state = !on ? 'off' : text ? 'on' : 'empty';
    return {
      id, ...DESCRIPTIONS[id],
      state,
      why: !on ? String(flag) : text ? '' : id === 'direction' ? 'Сейчас ничего не поставлено.' : 'Пока пусто: нечего отправлять.',
      tokens: Math.round(Number(tokens[id]) || 0),
      text,
    };
  });
}

// ---- Readable rows -------------------------------------------------------------

const clean = value => String(value ?? '').trim();
const list = value => clean(value).split(/\s*,\s*/).filter(Boolean);
const sameSet = (left, right) => left.length === right.length && left.every(item => right.includes(item));

/** Strip the [TAG] … [/TAG] wrapper and cut the fixed «Rules:» tail: { lines, rules }. */
export function unwrap(text) {
  let lines = String(text ?? '').split('\n').map(line => line.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && /^\[[^\]\n]+\]$/.test(lines[0].trim())) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines.length && /^\[\/[^\]\n]+\]$/.test(lines.at(-1).trim())) lines.pop();
  const at = lines.findIndex(line => /^Rules:\s*$/.test(line.trim()));
  const rules = at >= 0 ? lines.slice(at + 1).map(line => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean).join('\n') : '';
  if (at >= 0) lines = lines.slice(0, at);
  return { lines: lines.filter(line => line.trim()), rules };
}

const PARTS_OF_DAY = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь', dawn: 'рассвет', dusk: 'сумерки' };

/** «day 1, 23:25, (night)» → «день истории 1, 23:25, ночь»: the block is English for the model, the page is not. */
export function humanTime(value) {
  return String(value ?? '')
    .replace(/\bstory day (\d+)/g, 'день истории $1')
    .replace(/\bday (\d+)/g, 'день истории $1')
    .replace(/\(([a-z]+)\)/g, (whole, part) => PARTS_OF_DAY[part] ?? whole);
}

/** «Бонтен: …» → { head, text }; used by the chronicle. */
function headed(line) {
  const match = /^([^:]{1,40}):\s*(.*)$/.exec(line);
  return match ? { head: match[1], text: match[2] } : { head: '', text: line };
}

/** `affection=42(теплеет),family=36(…)` → chips [{ label, value, hint }]. */
export function scaleChips(text) {
  const chips = [];
  for (const match of String(text ?? '').matchAll(/([a-z_]+)=(-?\d+(?:\.\d+)?)(?:\(([^)]*)\))?/gi)) {
    chips.push({ label: SCALE_LABELS[match[1]] ?? match[1], value: Number(match[2]), hint: match[3] ?? '' });
  }
  return chips;
}

function readableChronicle(text) {
  const items = unwrap(text).lines.map(headed);
  return { sections: [{ title: 'Пересказы, от старых к новым', items }], rules: '' };
}

function readableScene(text) {
  const { lines, rules } = unwrap(text);
  const labels = { time: 'Время', weather: 'Погода', place: 'Место', 'place-features': 'Особенности места', 'place-now': 'Что сейчас в месте' };
  const items = lines.map(line => {
    const keyed = /^([a-z-]+)\[(.+?)\]:\s*(.*)$/.exec(line);
    if (keyed) {
      const head = { wears: 'Одет(а)', 'also-has': 'Ещё при себе', holds: 'Держит', body: 'Постоянные изменения тела', carries: 'Несёт' }[keyed[1]] ?? keyed[1];
      return { head: `${head}: ${keyed[2]}`, text: keyed[3] };
    }
    const plain = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (plain && labels[plain[1]]) return { head: labels[plain[1]], text: plain[1] === 'time' ? humanTime(plain[2]) : plain[2] };
    return { head: '', text: line };
  });
  return { sections: [{ title: 'Состояние сцены', items }], rules };
}

function readableCalendar(text) {
  const { lines, rules } = unwrap(text);
  const labels = { today: 'Сегодня', 'must-today': 'Обязательно сегодня', 'background-today': 'Фоном сегодня' };
  const items = lines.map(line => {
    const soon = /^soon \(([^)]*)\):\s*(.*)$/.exec(line);
    if (soon) return { head: `Скоро (${soon[1].replace(/^in /, 'через ').replace(/\bd\./g, 'дн.')})`, text: soon[2] };
    const plain = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (plain && labels[plain[1]]) return { head: labels[plain[1]], text: humanTime(plain[2]) };
    return { head: '', text: line };
  });
  return { sections: [{ title: 'Календарь', items }], rules };
}

function readableKnowledge(text) {
  const { lines, rules } = unwrap(text);
  const present = [];
  const unknown = [];
  const heard = [];
  const secrets = [];
  const meetings = [];
  const dead = [];
  const other = [];
  for (const line of lines) {
    let match;
    if ((match = /^scene:\s*present=(.*?);\s*place=(.*)$/.exec(line))) {
      present.push({ head: 'В сцене', text: `${match[1]}. Место: ${match[2]}` });
    } else if ((match = /^unknown\[(.+?)\]:\s*(.*)$/.exec(line))) {
      for (const part of match[2].split(/\s+\|\s+/)) unknown.push({ head: `${match[1]} не знает`, text: part.replace(/^\(secret\)\s*/, ''), note: /^\(secret\)/.test(part) ? 'секрет' : '' });
    } else if ((match = /^heard\[(.+?)\]:\s*(.*)$/.exec(line))) {
      for (const part of match[2].split(/\s+\|\s+/)) {
        const told = /^told by (.+?) — (.*)$/.exec(part);
        heard.push({ head: `${match[1]} знает только со слов`, text: told ? told[2] : part.replace(/^rumou?r — /, ''), note: told ? `рассказал(а) ${told[1]}` : /^rumou?r/.test(part) ? 'слух' : '' });
      }
    } else if ((match = /^secret\[(.+?)\]:\s*(.*)$/.exec(line))) {
      for (const part of match[2].split(/\s+\|\s+/)) secrets.push({ head: `${match[1]} знает секрет`, text: part });
    } else if ((match = /^(strangers|seen)\[(.+?)\s*&\s*(.+?)\]\s*$/.exec(line))) {
      meetings.push({ head: `${match[2]} и ${match[3]}`, text: match[1] === 'strangers' ? 'никогда не встречались, имён не знают' : 'виделись, но имён друг друга не знают' });
    } else if ((match = /^dead\[(.+?)\]:?\s*(.*)$/.exec(line))) {
      dead.push({ head: `${match[1]} мёртв(а)`, text: match[2] });
    } else other.push({ head: '', text: line });
  }
  const sections = [
    { title: 'Кто в сцене', items: present },
    { title: 'Чего они не знают', items: unknown },
    { title: 'Что знают только со слов других', items: heard },
    { title: 'Секреты', items: secrets },
    { title: 'Кто не знаком', items: meetings },
    { title: 'Умершие', items: dead },
    { title: 'Прочее', items: other },
  ].filter(section => section.items.length);
  return { sections, rules };
}

function readableRelationships(text) {
  const pairs = [];
  const memories = [];
  const tensions = [];
  const headcanons = [];
  const triangles = [];
  const other = [];
  for (const line of String(text ?? '').split('\n').map(item => item.trim()).filter(Boolean)) {
    let match;
    if ((match = /^(shared|secret)-(memories|tensions)(?:\[(.*?)\])?=(.*?)(?:\s*\[known only to:\s*(.*?);\s*everyone else is unaware\])?$/.exec(line))) {
      const people = match[3] ? list(match[3]) : [];
      const knowers = match[5] ? list(match[5]) : [];
      const item = {
        head: people.length ? people.join(', ') : 'тайное',
        text: match[4].trim(),
        note: knowers.length && !sameSet(knowers, people) ? `знают: ${knowers.join(', ')}` : '',
      };
      (match[2] === 'memories' ? memories : tensions).push(item);
    } else if ((match = /^headcanon\[(.+?)\]:\s*(.*)$/.exec(line))) {
      headcanons.push({ head: match[1], text: match[2] });
    } else if (/^triangle /.test(line)) {
      const body = line.replace(/^triangle\s+/, '');
      triangles.push({ head: 'Треугольник', text: body });
    } else if ((match = /^(.+?)>(.+?)(?:;(.*))?$/.exec(line))) {
      const chips = scaleChips(match[3]);
      pairs.push({ head: `${match[1]} → ${match[2]}`, text: chips.length ? '' : 'пока ровно: ни одно чувство не отклонилось от нуля', chips });
    } else other.push({ head: '', text: line });
  }
  const sections = [
    { title: 'Чувства (кто к кому и сколько, от −100 до 100)', items: pairs },
    { title: 'Общие воспоминания', items: memories },
    { title: 'Напряжения', items: tensions },
    { title: 'Хедканоны', items: headcanons },
    { title: 'Треугольники', items: triangles },
    { title: 'Прочее', items: other },
  ].filter(section => section.items.length);
  return { sections, rules: '' };
}

function readableDirection(text) {
  const { lines } = unwrap(text);
  return { sections: [{ title: 'Что уйдёт с ближайшим ответом', items: lines.map(line => ({ head: '', text: line.replace(/^\s*-\s*/, '') })) }], rules: '' };
}

function readableNames(text) {
  const { lines, rules } = unwrap(text);
  const items = lines.map(line => {
    const at = line.indexOf(': ');
    return at > 0 ? { head: line.slice(0, at), text: line.slice(at + 2) } : { head: '', text: line };
  });
  return { sections: [{ title: 'Как писать имена', items }], rules };
}

const READERS = { chronicle: readableChronicle, scene: readableScene, calendar: readableCalendar, knowledge: readableKnowledge, names: readableNames, relationships: readableRelationships, direction: readableDirection };

/** { sections: [{ title, items: [{ head, text, note?, chips? }] }], rules } — the same text, in words. */
export function readable(id, text) {
  try { return (READERS[id] ?? readableDirection)(text); }
  catch { return { sections: [{ title: 'Текст', items: [{ head: '', text: String(text ?? '') }] }], rules: '' }; }
}
