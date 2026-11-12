/**
 * «Суфлёр лорбуков»: which lorebook entries about a character the coming reply needs.
 *
 * SillyTavern picks entries by key words. With long posts a generic secondary key
 * («голос», «тело») is always there, so every section of every named character goes
 * out. Kulisy knows who is on stage and what kind of scene it is, so for entries
 * titled «[ Name ] - Section» it decides itself:
 *
 *   force — the character is on stage and the section's rule holds: sent without keys;
 *   drop  — the rule does not hold: taken out before SillyTavern scans;
 *   keep  — left to SillyTavern's keys, as before.
 *
 * Entries with other titles, entries about nobody Kulisy knows, the persona's own
 * entries and everything when nobody is on stage are never touched (fail open).
 *
 * The rest of the lorebook (places, rules, items, factions…) goes by the chronicler's pick: after each
 * reply it names the notes the next one needs (state.knowledge.scene.lore). A note it picked is sent,
 * a note it did not pick is held back unless the user's fresh post names it by its own key words.
 * Until the chronicler has answered once, nothing of this kind is held back.
 *
 * Pure: no DOM, no SillyTavern. index.js feeds it the WORLDINFO_ENTRIES_LOADED lists.
 */
import { namesSoundAlike, normalizeAlias } from '../core/index.js';
import { keyNames } from './name-sources.js';
import { isSecretEntry } from '../core/lore-secrets.js';

export const SCENE_MODE_LABELS = Object.freeze({ calm: 'Быт и разговор', fight: 'Бой', intim: 'Близость' });

/** Sections of a character sheet, by the words of the entry title after the dash. */
export const GATE_SECTIONS = Object.freeze({
  basic: { label: 'Basic Info', match: /^(basic|основн|общ)/i },
  character: { label: 'Character and psychology', match: /^(character|psycholog|personality|характер|психолог|личност)/i },
  voice: { label: 'Voice', match: /^(voice|speech|голос|речь)/i },
  visual: { label: 'Visual', match: /^(visual|appearance|looks|внешн)/i },
  relationships: { label: 'Relationships', match: /^(relationship|relations|отношен|связи)/i },
  skills: { label: 'Skills', match: /^(skill|abilit|combat|power|навык|способност|умени)/i },
  nsfw: { label: 'NSFW module', match: /(nsfw|intima|sexual|18\+|интим|близост)/i },
  other: { label: 'Остальные разделы (Biography, Public Info…)', match: null },
});

/** When a section of someone ON STAGE is sent. */
export const GATE_WHEN = Object.freeze({
  always: 'всегда, пока на сцене',
  entrance: 'при выходе на сцену и раз в N ходов',
  pair: 'если второй тоже в сцене или назван',
  fight: 'только в бою',
  intim: 'только в близости',
  keys: 'по ключам, как раньше',
  never: 'никогда',
});

/** What happens to a section of someone who is NOT on stage. */
export const GATE_ABSENT = Object.freeze({ keys: 'по ключам, как раньше', never: 'не отправлять' });

/**
 * What happens to the sheet of someone who is NOT on stage but acts nearby: named in the user's
 * fresh post, or in several sentences of the last reply (a voice behind the door, a call).
 * One passing mention in the reply is not enough: that is how half the cast got in before.
 */
export const GATE_NAMED = Object.freeze({
  core: 'основное: разделы с правилом «всегда, пока на сцене»',
  stage: 'всё, как будто он на сцене',
  absent: 'ничего особенного: как для тех, кого нет',
});

/** How the other entries of the lorebook (places, rules, items…) are chosen. */
export const GATE_WORLD = Object.freeze({
  chronicler: 'по выбору летописца: после каждого ответа он называет нужные записи',
  keys: 'по ключам, как раньше',
});

export const DEFAULT_GATE = Object.freeze({
  enabled: false,
  visualEvery: 6,
  named: 'core',
  world: 'chronicler',
  sections: Object.freeze({
    basic: { when: 'always', absent: 'keys' },
    character: { when: 'always', absent: 'never' },
    voice: { when: 'always', absent: 'never' },
    visual: { when: 'entrance', absent: 'never' },
    relationships: { when: 'pair', absent: 'never' },
    skills: { when: 'fight', absent: 'never' },
    nsfw: { when: 'intim', absent: 'never' },
    other: { when: 'keys', absent: 'keys' },
  }),
});

export function normalizeGate(raw) {
  const sections = {};
  for (const [id, fallback] of Object.entries(DEFAULT_GATE.sections)) {
    const own = raw?.sections?.[id] ?? {};
    sections[id] = {
      when: Object.hasOwn(GATE_WHEN, own.when) ? own.when : fallback.when,
      absent: Object.hasOwn(GATE_ABSENT, own.absent) ? own.absent : fallback.absent,
    };
  }
  const every = Math.round(Number(raw?.visualEvery));
  return {
    enabled: raw?.enabled === true,
    visualEvery: Number.isFinite(every) ? Math.max(1, Math.min(50, every)) : DEFAULT_GATE.visualEvery,
    named: Object.hasOwn(GATE_NAMED, raw?.named) ? raw.named : DEFAULT_GATE.named,
    world: Object.hasOwn(GATE_WORLD, raw?.world) ? raw.world : DEFAULT_GATE.world,
    sections,
  };
}

/** «[ Manjiro Sano ] - Visual» → { name: 'Manjiro Sano', section: 'visual' }; null for any other title. */
export function parseGateTitle(comment) {
  const found = splitGateTitle(comment);
  return found ? { name: found.name, section: found.section } : null;
}

/** The same, with the words of the section as they are written: «[ Manjiro Sano ] - Public Info» → { name, tail: 'Public Info', section: 'other' }. */
export function splitGateTitle(comment) {
  const found = /^\s*\[\s*([^\]]+?)\s*\]\s*[-–—:]\s*(.+?)\s*$/.exec(String(comment ?? ''));
  if (!found) return null;
  const tail = found[2];
  const section = Object.entries(GATE_SECTIONS).find(([, item]) => item.match?.test(tail))?.[0] ?? 'other';
  return { name: found[1], tail, section };
}

const lower = value => String(value ?? '').toLocaleLowerCase('ru-RU');

/**
 * Entries the chronicler may pick from: not a character's sheet, not a secret, not the persona's own,
 * not a constant (those are always sent), not switched off. [{ entry, title }].
 */
export function worldEntries(lists) {
  const persona = new Set(Array.isArray(lists?.personaLore) ? lists.personaLore : []);
  const found = [];
  for (const list of Object.values(lists ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const title = String(entry?.comment ?? '').replace(/\s+/g, ' ').trim();
      if (!entry || entry.disable || entry.constant || !title || persona.has(entry) || isSecretEntry(entry) || parseGateTitle(title)) continue;
      found.push({ entry, title });
    }
  }
  return found;
}

/** A lorebook key as SillyTavern writes it: «/regex/flags» or plain words. */
function keyTest(key) {
  const text = String(key ?? '').trim();
  if (!text) return null;
  const regex = /^\/(.+)\/([a-z]*)$/s.exec(text);
  if (regex) {
    try { const pattern = new RegExp(regex[1], regex[2]); return source => pattern.test(source); } catch { return null; }
  }
  const word = lower(text);
  return source => lower(source).includes(word);
}

/** Whether any primary key of the entry is found in the text. */
export function entryKeysHit(entry, text) {
  const source = String(text ?? '');
  if (!source) return false;
  return (Array.isArray(entry?.key) ? entry.key : []).some(key => { const test = keyTest(key); return test ? test(source) : false; });
}

/** In how many sentences of the text each character is named: Map id → count. */
export function namedSentences(text, people) {
  const counts = new Map();
  for (const sentence of String(text ?? '').split(/(?<=[.!?…])\s+|\n+/)) {
    for (const id of namedInText(sentence, people)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Who the text names. Whole capitalised words only, so «Ран» is not found in «охраны» or «рано»;
 * a Russian case ending is allowed («Рана», «Риндо», «Какучо» → «с Раном»).
 */
export function namedInText(text, people) {
  const source = String(text ?? '');
  const found = new Set();
  if (!source.trim()) return found;
  const whole = lower(source);
  const words = new Set((source.match(/\p{Lu}[\p{L}\p{M}]+/gu) ?? []).map(lower));
  const hit = name => {
    if (name.length < 3) return false;
    if (/\s/.test(name)) return whole.includes(name);
    if (words.has(name)) return true;
    const stem = name.length >= 4 ? name.slice(0, -1) : name;
    for (const word of words) if (word.startsWith(stem) && word.length >= name.length - 1 && word.length <= name.length + 2) return true;
    return false;
  };
  for (const entity of people) if ([entity.name, ...(entity.aliases ?? [])].map(lower).some(hit)) found.add(entity.id);
  return found;
}

/** The one character an entry is about (by its title name, else by its name-like keys), or ''. */
export function entityOf(entry, titleName, people) {
  const byTitle = people.filter(entity => [entity.name, ...(entity.aliases ?? [])]
    .some(name => normalizeAlias(name) === normalizeAlias(titleName) || namesSoundAlike(name, titleName)));
  if (byTitle.length === 1) return byTitle[0].id;
  if (byTitle.length > 1) return '';
  const keys = new Set((Array.isArray(entry.key) ? entry.key : []).flatMap(keyNames).map(normalizeAlias));
  if (!keys.size) return '';
  const byKey = people.filter(entity => [entity.name, ...(entity.aliases ?? [])].some(name => keys.has(normalizeAlias(name))));
  return byKey.length === 1 ? byKey[0].id : '';
}


/**
 * What happens to one section of one character, by its rule (the same for a lorebook entry and a library card).
 *   rule   — { when, absent } (GATE_WHEN / GATE_ABSENT);
 *   ctx    — onStage, isNamed (named in the posts, not on stage), mode, entranceDue, ago (turns since the last «entrance»),
 *            partner() → whether the second one of a pair is in play.
 * → { action: 'force' | 'drop' | 'keep', why, entrance } — `entrance`: this send counts as the character's entrance.
 */
export function decideSection(rule, { onStage, isNamed, mode, entranceDue, ago, partner }) {
  if (!onStage) {
    if (isNamed && rule.when === 'always') return { action: 'force', why: '', entrance: false };
    if (rule.absent === 'never') return { action: 'drop', why: isNamed ? 'только назван' : 'не на сцене', entrance: false };
    return { action: 'keep', why: '', entrance: false };
  }
  switch (rule.when) {
    case 'always': return { action: 'force', why: '', entrance: false };
    case 'never': return { action: 'drop', why: 'выключено правилом', entrance: false };
    case 'fight':
    case 'intim':
      return mode === rule.when
        ? { action: 'force', why: '', entrance: false }
        : { action: 'drop', why: rule.when === 'fight' ? 'не бой' : 'не близость', entrance: false };
    case 'entrance':
      return entranceDue
        ? { action: 'force', why: '', entrance: true }
        : { action: 'drop', why: `было ${ago} ход. назад`, entrance: false };
    case 'pair':
      return partner()
        ? { action: 'force', why: '', entrance: false }
        : { action: 'drop', why: 'второго нет в сцене', entrance: false };
    default: return { action: 'keep', why: '', entrance: false };
  }
}

/**
 * The words by which each person who is in play (on stage, named in the post, in several sentences of the reply)
 * can be found in a text: Map entityId → [words]. `extraNames(id)` adds more names, e.g. the title names of a sheet.
 */
export function buildAround(people, present, named, inReply, extraNames = () => []) {
  const around = new Map();
  for (const entity of people) {
    if (!present.has(entity.id) && !named.has(entity.id) && !inReply.has(entity.id)) continue;
    const words = new Set([entity.name, ...(entity.aliases ?? [])].map(lower).filter(word => word.length >= 3));
    for (const titleName of extraNames(entity.id)) {
      for (const word of lower(titleName).split(/\s+/)) if (word.length >= 3) words.add(word);
    }
    around.set(entity.id, [...words]);
  }
  return around;
}

/** Whether the lower-cased text names anybody in `around` other than `selfId`. */
export function partnerNamed(content, selfId, around) {
  return [...around].some(([otherId, words]) => otherId !== selfId && words.some(word => content.includes(word)));
}

/**
 * Decide every entry of the lists.
 *   lists      — the WORLDINFO_ENTRIES_LOADED payload ({ globalLore: [], … });
 *   presentIds — who is on stage (and who is being called in);
 *   mode       — 'calm' | 'fight' | 'intim';
 *   turn       — number of the user's posts so far (the same for a swipe of the reply);
 *   tracker    — Map entityId → turn when their «entrance» sections last went out (mutated);
 *   namedText  — the user's fresh post: whoever it names is spoken to or about;
 *   replyText  — the reply before it: whoever it names in two sentences or more acts nearby;
 *   skipIds    — characters whose sheet is a library card (card-prompt.js): their lorebook entries are not decided here.
 * → { decisions: Map entry → 'force' | 'drop', report }
 */
export function planGate({ lists, state, config, presentIds = [], mode = 'calm', turn = 0, tracker = new Map(), namedText = '', replyText = '', skipIds = new Set() }) {
  const gate = normalizeGate(config);
  const decisions = new Map();
  const report = { mode, forced: 0, dropped: 0, kept: 0, savedCharacters: 0, people: [] };
  const present = new Set(presentIds);
  const personaId = state?.ui?.personaId || '';
  const people = Object.values(state?.entities ?? {}).filter(entity => entity.id !== personaId);
  // Nobody known on stage: the scene is not tracked, so nothing is held back.
  if (!gate.enabled || !people.some(entity => present.has(entity.id))) return { decisions, report };

  // 1. Which entries are about whom.
  const sheets = new Map(); // entityId → [{ entry, section }]
  const cache = new Map();
  for (const list of Object.values(lists ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || entry.disable) continue;
      const title = parseGateTitle(entry.comment);
      if (!title) continue;
      if (!cache.has(title.name)) cache.set(title.name, entityOf(entry, title.name, people));
      const id = cache.get(title.name);
      if (!id || skipIds.has(id)) continue;
      if (!sheets.has(id)) sheets.set(id, { titleNames: new Set(), items: [] });
      sheets.get(id).titleNames.add(title.name);
      sheets.get(id).items.push({ entry, section: title.section });
    }
  }

  // 2. Who else is in the scene or named in the fresh post (for «pair»): the words their names are written with.
  const named = namedInText(namedText, people);
  const inReply = namedSentences(replyText, people);
  for (const [id, count] of inReply) if (count >= 2) named.add(id);
  const around = buildAround(people, present, named, inReply, id => sheets.get(id)?.titleNames ?? []);

  // 3. The rules.
  const sent = [];
  const staged = new Set(present);
  for (const [id, sheet] of sheets) {
    // Named in the posts but not on stage: the reply will most likely write them, so the model needs who they are.
    const isNamed = !present.has(id) && named.has(id) && gate.named !== 'absent';
    const onStage = present.has(id) || (isNamed && gate.named === 'stage');
    if (onStage) staged.add(id);
    const last = tracker.get(id);
    const entranceDue = last == null || turn <= last || turn - last >= gate.visualEvery;
    const person = { id, name: state.entities[id]?.name ?? id, present: present.has(id), named: isNamed, parts: [] };
    for (const { entry, section } of sheet.items) {
      const rule = gate.sections[section];
      const verdict = decideSection(rule, {
        onStage, isNamed, mode, entranceDue, ago: turn - last,
        partner: () => partnerNamed(lower(entry.content), id, around),
      });
      const { action, why } = verdict;
      if (verdict.entrance) sent.push(id);
      const characters = String(entry.content ?? '').length;
      if (action !== 'keep') decisions.set(entry, action);
      if (action === 'force') report.forced += 1;
      else if (action === 'drop') { report.dropped += 1; report.savedCharacters += characters; }
      else report.kept += 1;
      person.parts.push({ section, label: GATE_SECTIONS[section].label, title: String(entry.comment ?? ''), action, why, characters });
    }
    report.people.push(person);
  }
  // 4. The rest of the lorebook, by the chronicler's pick.
  const focus = state?.knowledge?.scene?.lore;
  if (gate.world === 'chronicler' && Array.isArray(focus)) {
    const chosen = new Set(focus.map(lower));
    const world = { picked: focus, forced: 0, dropped: 0, kept: 0, savedCharacters: 0 };
    for (const { entry, title } of worldEntries(lists)) {
      if (chosen.has(lower(title))) { decisions.set(entry, 'force'); world.forced += 1; }
      else if (entryKeysHit(entry, namedText)) world.kept += 1;
      else { decisions.set(entry, 'drop'); world.dropped += 1; world.savedCharacters += String(entry.content ?? '').length; }
    }
    report.world = world;
    report.forced += world.forced;
    report.dropped += world.dropped;
    report.savedCharacters += world.savedCharacters;
    report.kept += world.kept;
  }

  // Whoever left the stage will get their entrance sections again when they come back.
  for (const id of [...tracker.keys()]) if (!staged.has(id)) tracker.delete(id);
  for (const id of sent) if (tracker.get(id) == null || turn - tracker.get(id) >= gate.visualEvery || turn < tracker.get(id)) tracker.set(id, turn);
  report.people.sort((left, right) => Number(right.present) - Number(left.present) || Number(right.named) - Number(left.named) || left.name.localeCompare(right.name, 'ru-RU'));
  return { decisions, report };
}

/**
 * Apply the decisions to the lists in place (SillyTavern keeps using the same arrays).
 * A forced entry is replaced by a constant copy, so the lorebook's own data is not touched.
 */
export function applyGate(lists, decisions) {
  for (const list of Object.values(lists ?? {})) {
    if (!Array.isArray(list)) continue;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const action = decisions.get(list[index]);
      if (action === 'drop') list.splice(index, 1);
      else if (action === 'force') list[index] = { ...list[index], constant: true };
    }
  }
}
