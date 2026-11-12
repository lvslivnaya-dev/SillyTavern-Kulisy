/**
 * Character cards of the library: a character written once, in sections, kept across chats.
 *
 * card = { id, folderId, name, aliases[], sections[], image?, lang?, source?, nameId? }
 *   nameId — the entry of the name library («Мир → Имена») this card shares its names with; several cards (one character in
 *            different AUs) may point at one entry, whose aliases then hold the names of all of them;
 *   lang   — 'en' once the card was translated into English (absent = as written, Russian);
 *   source — { path, hash, stale? } where the card came from: a note of the Obsidian folder (path inside it; hash of what was
 *            read; stale — the note has changed since). The note stays the Russian original, the card holds the working copy.
 * section = { id, kind, title, text, when?, keys[]? }
 *   text   — the section; ONE text per section, so the card never holds two languages at once
 *   kind  — one of CARD_SECTION_KINDS: it says which rule of «Суфлёр» the section follows
 *           (the same ids as the sheet sections of a lorebook: basic, voice, visual…);
 *   title — what the section is called on the card and in the prompt («Public Info», «Biography»);
 *   when  — its own rule instead of the one in the settings ('' = the settings'), see CARD_WHEN;
 *   keys  — words that bring the section in when its rule is «по ключам».
 *
 * Pure: no DOM, no SillyTavern. The library functions that store cards are in location-library.js.
 */
import { uniqueId } from './ids.js';

/** Sections a card knows. The ids are the same as GATE_SECTIONS in integration/lore-gate.js (a test keeps them equal). */
export const CARD_SECTION_KINDS = Object.freeze({
  basic: 'Basic Info',
  character: 'Character and psychology',
  voice: 'Voice',
  visual: 'Visual',
  relationships: 'Relationships',
  skills: 'Skills',
  nsfw: 'NSFW module',
  other: 'Другой раздел',
});

/** Own rule of a section; '' means «as in the settings of the lorebook prompter». */
export const CARD_WHEN = Object.freeze(['always', 'entrance', 'pair', 'fight', 'intim', 'keys', 'never']);

export const CARD_LIMITS = Object.freeze({ sections: 24, title: 80, text: 8000, keys: 12, key: 160 });

/** The sections of the questionnaire template, in its order: a new card starts with them. */
export const TEMPLATE_SECTIONS = Object.freeze([
  Object.freeze({ kind: 'basic', title: 'Basic Info' }),
  Object.freeze({ kind: 'visual', title: 'Visual' }),
  Object.freeze({ kind: 'voice', title: 'Voice' }),
  Object.freeze({ kind: 'other', title: 'Public Info' }),
  Object.freeze({ kind: 'skills', title: 'Skills' }),
  Object.freeze({ kind: 'relationships', title: 'Relationships' }),
  Object.freeze({ kind: 'other', title: 'Biography' }),
  Object.freeze({ kind: 'character', title: 'Character and psychology' }),
  Object.freeze({ kind: 'nsfw', title: 'NSFW module' }),
]);

function cleanLine(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanProse(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const REGEX_KEY = /\/(?:\\.|[^/\\\n])+\/[a-z]*/;
const BEFORE = '(?<![\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';
const ENDINGS = '\\p{L}{0,3}';

/** Words typed in one field → a list: split at commas and line breaks, but a «/regex/» key keeps its commas ({0,3}). */
export function splitKeys(text) {
  return (String(text ?? '').match(new RegExp(`\\s*${REGEX_KEY.source}|[^,\\n]+`, 'g')) ?? []).map(item => item.trim()).filter(Boolean);
}

export const isRegexKey = key => /^\/.+\/[a-z]*$/s.test(String(key ?? '').trim());

/** The ways to put a word into a regular expression (what the «надеть регекс» button offers), whole-word aware for Russian letters. */
export const KEY_REGEX_MODES = Object.freeze({
  endings: 'Слово и его окончания (байк → байк, байка, байку, байком)',
  whole: 'Только это слово целиком (байк, но не байка)',
  start: 'Любое слово, которое так начинается (байк → байкер, байкерский)',
});

/** A plain word → «/regex/iu» in the form lorebook keys have; an existing regex stays as it is. */
export function keyToRegex(key, mode = 'endings') {
  const text = cleanLine(key, CARD_LIMITS.key);
  if (!text || isRegexKey(text)) return text;
  const word = text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = mode === 'whole' ? `${BEFORE}${word}${AFTER}` : mode === 'start' ? `${BEFORE}${word}` : `${BEFORE}${word}${ENDINGS}${AFTER}`;
  return `/${pattern}/iu`;
}

/** The reverse of keyToRegex for the regexes it made (a hand-written one stays as it is). */
export function keyFromRegex(key) {
  const text = String(key ?? '').trim();
  if (!text.startsWith(`/${BEFORE}`) || !text.endsWith('/iu')) return text;
  let body = text.slice(BEFORE.length + 1, -3);
  if (body.endsWith(AFTER)) body = body.slice(0, -AFTER.length);
  if (body.endsWith(ENDINGS)) body = body.slice(0, -ENDINGS.length);
  return body.replace(/\\(.)/g, '$1');
}

function cleanKeys(values) {
  const list = Array.isArray(values) ? values : String(values ?? '').split(/[,\n]/);
  const seen = new Set();
  const result = [];
  for (const value of list) {
    const text = cleanLine(value, CARD_LIMITS.key);
    const id = text.toLocaleLowerCase('ru-RU');
    if (!text || seen.has(id)) continue;
    seen.add(id);
    result.push(text);
    if (result.length >= CARD_LIMITS.keys) break;
  }
  return result;
}

/** A tidy section from loose fields; `id` is kept when the caller has one. */
export function makeSection(raw = {}, { id } = {}) {
  const kind = Object.hasOwn(CARD_SECTION_KINDS, raw?.kind) ? raw.kind : 'other';
  const title = cleanLine(raw?.title, CARD_LIMITS.title) || CARD_SECTION_KINDS[kind];
  const when = CARD_WHEN.includes(raw?.when) ? raw.when : '';
  const keys = cleanKeys(raw?.keys);
  return {
    id: String(id ?? raw?.id ?? '') || uniqueId('sec'),
    kind, title,
    text: cleanProse(raw?.text, CARD_LIMITS.text),
    ...(when ? { when } : {}),
    ...(keys.length ? { keys } : {}),
  };
}

/** The sections of a new card: the template's, empty. */
export function templateSections() {
  return TEMPLATE_SECTIONS.map(section => makeSection(section));
}

/** Repair a stored list of sections: unknown kinds become «other», ids stay unique, the count is capped. */
export function normalizeSections(input) {
  const seen = new Set();
  const result = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (!raw || typeof raw !== 'object') continue;
    let id = String(raw.id ?? '');
    if (!id || seen.has(id)) id = uniqueId('sec');
    seen.add(id);
    result.push(makeSection(raw, { id }));
    if (result.length >= CARD_LIMITS.sections) break;
  }
  return result;
}

/** Sections that have any text (an empty section is never sent). */
export function filledSections(card) {
  return (card?.sections ?? []).filter(section => section.text.trim());
}

/** The text of a section as it goes out: a card holds one text per section, in the language the card is in (card.lang). */
export function sectionText(section) {
  return String(section?.text ?? '').trim();
}

/** The whole card as one text for a model that is asked to think about the character (not the narrator's prompt). */
export function cardPlainText(card, maxCharacters = 6000) {
  if (!card) return '';
  const head = [card.name, ...(card.aliases ?? [])].filter(Boolean).join(' / ');
  const parts = [`## ${head}`];
  let left = Math.max(0, maxCharacters - parts[0].length);
  for (const section of filledSections(card)) {
    const block = `### ${section.title}\n${sectionText(section)}`;
    if (block.length + 1 > left) continue;
    parts.push(block);
    left -= block.length + 1;
  }
  return parts.length > 1 ? parts.join('\n') : '';
}

/**
 * Sections from loose input: [{ kind?, title, text }] or { 'Voice': 'text' }. Used by imports.
 * Two imports of the same title in one card are joined into one section.
 */
export function sectionsFromParts(parts) {
  const list = Array.isArray(parts) ? parts : Object.entries(parts ?? {}).map(([title, text]) => ({ title, text }));
  const byTitle = new Map();
  for (const part of list) {
    const section = makeSection(part);
    if (!section.text) continue;
    const key = section.title.toLocaleLowerCase('ru-RU');
    const had = byTitle.get(key);
    if (had) {
      had.text = cleanProse(`${had.text}\n\n${section.text}`, CARD_LIMITS.text);
    } else byTitle.set(key, section);
  }
  return [...byTitle.values()].slice(0, CARD_LIMITS.sections);
}
