/**
 * The name library: how each name is spelled and declined. It lives in the extension
 * settings (not in a chat), so it is shared by all chats and never rolls back with a swipe.
 *
 * library = { version: 1, enabled: true, folders: [{ id, name, off }], entries: [entry] }
 * entry   = { id, name, aliases[], gender: '' | 'm' | 'f', off, folderId, words: [word] }
 *            folderId '' = no folder; a switched-off folder switches off all its names (they stay ticked on inside).
 * word    = { word, same, gen, dat, acc, ins, pre }
 *           one word of the name or of an alias; `same` = it does not decline;
 *           the five forms are what the word turns into in the cases of Russian.
 *
 * What goes to the model (buildNamesPrompt): only the entries of people on stage and of names
 * said in the last posts, one short line each. Every function returns a new library.
 */
import { namesSoundAlike } from './phonetic.js';
import { normalizeAlias, uniqueId } from './ids.js';

export const NAMES_VERSION = 1;
export const NAME_LIMITS = Object.freeze({ folders: 60, folderName: 50, entries: 400, name: 80, aliases: 10, alias: 60, form: 60, prompt: 12, promptCharacters: 1800 });
export const NAME_CASES = Object.freeze([['gen', 'род.', 'кого'], ['dat', 'дат.', 'кому'], ['acc', 'вин.', 'кого (видеть)'], ['ins', 'тв.', 'кем'], ['pre', 'пр.', 'о ком']]);
export const NAMES_TAG = 'NAMES';

export function emptyNames() {
  return { version: NAMES_VERSION, enabled: true, folders: [], entries: [] };
}

const clone = value => JSON.parse(JSON.stringify(value));
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const wordKey = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru-RU');

/** «Манджиро Сано» → ['Манджиро', 'Сано']: the words that decline apart. */
export function splitWords(text) {
  return clip(text, NAME_LIMITS.name).split(/\s+/).filter(Boolean);
}

/** The words of the name and its aliases, once each, in reading order. */
export function wordsFor(name, aliases = []) {
  const seen = new Set();
  const list = [];
  for (const source of [name, ...aliases]) {
    for (const word of splitWords(source)) {
      const key = wordKey(word);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(word);
    }
  }
  return list;
}

function cleanWord(item, word) {
  const out = { word, same: item?.same === true };
  for (const [key] of NAME_CASES) out[key] = out.same ? '' : clip(item?.[key], NAME_LIMITS.form);
  return out;
}

/** Keep the forms already written for words that are still there; new words start empty. */
function syncWords(name, aliases, previous = []) {
  const known = new Map(previous.map(item => [wordKey(item.word), item]));
  return wordsFor(name, aliases).map(word => cleanWord(known.get(wordKey(word)), word));
}

function cleanEntry(raw) {
  const name = clip(raw?.name, NAME_LIMITS.name);
  if (!name) return null;
  const aliases = [...new Set((Array.isArray(raw.aliases) ? raw.aliases : []).map(alias => clip(alias, NAME_LIMITS.alias)).filter(alias => alias && wordKey(alias) !== wordKey(name)))].slice(0, NAME_LIMITS.aliases);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uniqueId('name'),
    name,
    aliases,
    gender: raw.gender === 'm' || raw.gender === 'f' ? raw.gender : '',
    off: raw.off === true,
    folderId: typeof raw.folderId === 'string' ? raw.folderId : '',
    words: syncWords(name, aliases, Array.isArray(raw.words) ? raw.words : []),
  };
}

/** Tolerant: anything broken becomes an empty library, a bad entry is dropped. */
export function normalizeNames(raw) {
  if (!raw || typeof raw !== 'object') return emptyNames();
  const folders = [];
  const folderIds = new Set();
  for (const item of Array.isArray(raw.folders) ? raw.folders : []) {
    const name = clip(item?.name, NAME_LIMITS.folderName);
    const id = typeof item?.id === 'string' && item.id ? item.id : '';
    if (!name || !id || folderIds.has(id) || folders.length >= NAME_LIMITS.folders) continue;
    folderIds.add(id);
    folders.push({ id, name, off: item.off === true });
  }
  const seen = new Set();
  const entries = [];
  for (const item of Array.isArray(raw.entries) ? raw.entries : []) {
    const entry = cleanEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    if (!folderIds.has(entry.folderId)) entry.folderId = '';
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= NAME_LIMITS.entries) break;
  }
  return { version: NAMES_VERSION, enabled: raw.enabled !== false, folders, entries };
}

/** Add one name; the same name (any case) is not added twice. → { library, entry, added } */
export function addName(library, { name, aliases = [], gender = '', folderId = '' } = {}) {
  const next = clone(normalizeNames(library));
  const entry = cleanEntry({ name, aliases, gender, folderId: next.folders.some(folder => folder.id === folderId) ? folderId : '' });
  if (!entry) throw new Error('Впишите имя.');
  const same = next.entries.find(item => wordKey(item.name) === wordKey(entry.name));
  if (same) return { library: next, entry: same, added: false };
  if (next.entries.length >= NAME_LIMITS.entries) throw new Error(`В библиотеке уже ${NAME_LIMITS.entries} имён.`);
  next.entries.push(entry);
  return { library: next, entry, added: true };
}

/** patch: { name, aliases, gender, off, words } (words: forms to merge by word). */
export function updateName(library, id, patch = {}) {
  const next = clone(normalizeNames(library));
  const index = next.entries.findIndex(item => item.id === id);
  if (index < 0) throw new Error('Имя не найдено.');
  const entry = next.entries[index];
  const merged = { ...entry };
  for (const key of ['name', 'aliases', 'gender', 'off']) if (key in patch) merged[key] = patch[key];
  if ('folderId' in patch) merged.folderId = next.folders.some(folder => folder.id === patch.folderId) ? patch.folderId : '';
  if (Array.isArray(patch.words)) {
    const byWord = new Map(patch.words.map(item => [wordKey(item.word), item]));
    merged.words = entry.words.map(item => (byWord.has(wordKey(item.word)) ? { ...item, ...byWord.get(wordKey(item.word)), word: item.word } : item));
  }
  const clean = cleanEntry(merged);
  if (!clean) throw new Error('У имени должно быть написание.');
  next.entries[index] = { ...clean, id };
  return next;
}

export function removeName(library, id) {
  const next = clone(normalizeNames(library));
  next.entries = next.entries.filter(item => item.id !== id);
  return next;
}

// ---- Folders and bulk changes -------------------------------------------------------

export function addNameFolder(library, name) {
  const next = clone(normalizeNames(library));
  const clean = clip(name, NAME_LIMITS.folderName);
  if (!clean) throw new Error('Назовите папку.');
  const same = next.folders.find(folder => wordKey(folder.name) === wordKey(clean));
  if (same) return { library: next, folder: same, added: false };
  if (next.folders.length >= NAME_LIMITS.folders) throw new Error(`Папок уже ${NAME_LIMITS.folders}.`);
  const folder = { id: uniqueId('namefolder'), name: clean, off: false };
  next.folders.push(folder);
  return { library: next, folder, added: true };
}

/** patch: { name, off }. */
export function updateNameFolder(library, id, patch = {}) {
  const next = clone(normalizeNames(library));
  const folder = next.folders.find(item => item.id === id);
  if (!folder) throw new Error('Папка не найдена.');
  if ('name' in patch) {
    const clean = clip(patch.name, NAME_LIMITS.folderName);
    if (!clean) throw new Error('У папки должно быть название.');
    if (next.folders.some(item => item.id !== id && wordKey(item.name) === wordKey(clean))) throw new Error('Папка с таким названием уже есть.');
    folder.name = clean;
  }
  if ('off' in patch) folder.off = Boolean(patch.off);
  return next;
}

/** The folder goes; its names stay, without a folder. */
export function removeNameFolder(library, id) {
  const next = clone(normalizeNames(library));
  next.folders = next.folders.filter(folder => folder.id !== id);
  for (const entry of next.entries) if (entry.folderId === id) entry.folderId = '';
  return next;
}

/** Several names at once: { off } switches them, { folderId } moves them ('' = out of any folder). */
export function changeNames(library, ids, change = {}) {
  const next = clone(normalizeNames(library));
  const chosen = new Set(ids ?? []);
  const folderId = 'folderId' in change && next.folders.some(folder => folder.id === change.folderId) ? change.folderId : '';
  for (const entry of next.entries) {
    if (!chosen.has(entry.id)) continue;
    if ('off' in change) entry.off = Boolean(change.off);
    if ('folderId' in change) entry.folderId = folderId;
  }
  return next;
}

/** A name that is switched on by itself and whose folder is not switched off. */
export function isSending(library, entry) {
  return !entry.off && !(library.folders ?? []).some(folder => folder.id === entry.folderId && folder.off);
}

/** Entries that still have no forms for a word that could decline: what «Заполнить склонения» asks for. */
export function wordsToFill(entry) {
  return entry.words.filter(item => !item.same && !NAME_CASES.some(([key]) => item[key]));
}

// ---- What the model gets ------------------------------------------------------

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names that count as «on stage»: the entity names and aliases of those present. */
function stageNames(state, presentIds) {
  const names = [];
  for (const id of presentIds ?? []) {
    const entity = state?.entities?.[id];
    if (entity) names.push(entity.name, ...(entity.aliases ?? []));
  }
  return names.filter(Boolean);
}

/**
 * Which entries go to the model now: those of people on stage (same name or same sound)
 * and those whose words occur in `text` (the last posts). A word counts by its beginning, so «Рёна»
 * and «Рёном» both find «Рён»; words shorter than 3 letters are not searched.
 */
export function selectNames(library, state, { presentIds = [], text = '' } = {}) {
  const lib = normalizeNames(library);
  if (!lib.enabled) return [];
  const stage = stageNames(state, presentIds);
  const stageKeys = new Set(stage.map(name => normalizeAlias(name)));
  const body = String(text ?? '').toLocaleLowerCase('ru-RU');
  const picked = [];
  for (const entry of lib.entries) {
    if (!isSending(lib, entry)) continue;
    const names = [entry.name, ...entry.aliases];
    const onStage = names.some(name => stageKeys.has(normalizeAlias(name)) || stage.some(other => namesSoundAlike(name, other)));
    const said = !onStage && body && entry.words.some(item => {
      const word = wordKey(item.word);
      return word.length >= 3 && new RegExp(`(?<![\\p{L}])${escapeRegex(word)}`, 'u').test(body);
    });
    if (onStage || said) picked.push({ entry, onStage });
  }
  // People on stage first, then those only mentioned.
  return picked.sort((left, right) => Number(right.onStage) - Number(left.onStage)).map(item => item.entry);
}

function wordText(item) {
  if (item.same) return `${item.word} — не склоняется`;
  const forms = NAME_CASES.filter(([key]) => item[key]).map(([key, label]) => `${label} ${item[key]}`);
  return forms.length ? `${item.word} — ${forms.join(', ')}` : '';
}

/** One line: «Манджиро Сано (Майки): Манджиро — род. …; Сано — не склоняется». */
export function nameLine(entry) {
  const head = entry.aliases.length ? `${entry.name} (${entry.aliases.join(', ')})` : entry.name;
  const parts = entry.words.map(wordText).filter(Boolean);
  return `${head}: ${parts.length ? parts.join('; ') : 'пишется именно так'}`;
}

export const NAMES_RULES = Object.freeze([
  'Write these names exactly as spelled here, in every post.',
  'Decline them by the forms shown; a name marked «не склоняется» keeps its form in every case.',
  'Do not invent other spellings or other forms.',
]);

/** The wrapped block, or '' when nobody is on the list. */
export function buildNamesPrompt(library, state, options = {}) {
  const entries = selectNames(library, state, options).slice(0, NAME_LIMITS.prompt);
  const lines = [];
  let size = 0;
  for (const entry of entries) {
    const line = nameLine(entry);
    if (size + line.length > NAME_LIMITS.promptCharacters) break;
    size += line.length;
    lines.push(line);
  }
  if (!lines.length) return '';
  return [`[${NAMES_TAG}]`, ...lines, 'Rules:', ...NAMES_RULES.map(rule => `- ${rule}`), `[/${NAMES_TAG}]`].join('\n');
}
