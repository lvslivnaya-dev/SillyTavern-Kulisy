/**
 * Other names of a character from the lorebooks of the chat. The entry about a
 * character usually lists every spelling as its trigger keys («Ран», «Ran», «Хайтани
 * Ран», «Ран-сан») — better than any guess. An entry counts as "about" a character
 * when its title is one of their names (or sounds like one); its short, name-like keys
 * become other names. Pure: reading the books is the caller's job.
 */
import { createOperation, namesSoundAlike, normalizeAlias, phoneticKey, uniqueId } from '../core/index.js';

const MAX_NEW = 12;

/** A key that reads like a name: 2–40 letters, at most three words, no digits or symbols. */
function nameLike(value) {
  const text = String(value ?? '').trim();
  if (text.length < 2 || text.length > 40 || /[\d@#/\\|{}[\]<>=*_~^]/.test(text)) return false;
  if (/^\/.*\/[a-z]*$/i.test(text)) return false; // a regex key
  return text.split(/\s+/).length <= 3;
}

/**
 * The names a trigger key stands for. A plain key is itself; a regex key of the usual
 * «whole word» shape — /(?<!…)майки(?!…)/iu, /(?<!…)(?:харучие|харучиё)(?!…)/iu,
 * /(?<!…)сано[ \t]+манджиро(?!…)/iu — gives its plain words. Anything cleverer
 * (endings like главар(?:е|ей)) gives nothing: better no name than a wrong one.
 */
export function keyNames(key) {
  const text = String(key ?? '').trim();
  const regex = /^\/(.*)\/[a-z]*$/is.exec(text);
  const capital = value => value.replace(/(^|[\s-])(\p{L})/gu, (all, edge, letter) => edge + letter.toLocaleUpperCase('ru-RU'));
  // A key written in lower case reads as a name with capitals: «ran» → «Ran».
  if (!regex) return nameLike(text) ? [text === text.toLowerCase() ? capital(text) : text] : [];
  let body = regex[1]
    .replace(/\(\?<?[!=][^)]*\)/g, '')          // lookarounds (word edges)
    .replace(/\[ ?\\t\]\+|\\s\+|\\s\*|\[ \]\+/g, ' ') // "one or more spaces": [ \t]+, \s+, \s*, [ ]+
    .replace(/^\^|\$$/g, '')
    .trim();
  const group = /^\(\?:([^()]*)\)$/.exec(body);
  const variants = group ? group[1].split('|') : [body];
  return variants.map(variant => variant.trim())
    .filter(variant => /^[\p{L}' -]+$/u.test(variant) && nameLike(variant))
    .map(variant => variant.replace(/(^|[\s-])(\p{L})/gu, (all, edge, letter) => edge + letter.toLocaleUpperCase('ru-RU')));
}

/** Whether a lorebook entry is about this character: its title is one of their names. */
export function entryIsAbout(entry, entity) {
  // «[ Manjiro Sano ] - Basic Info», «Ран Хайтани — анкета», «Майки (Бонтен)» → the name part only.
  const raw = String(entry?.comment ?? '').trim();
  const bracket = /^\[\s*([^\]]+?)\s*\]/.exec(raw);
  const title = (bracket ? bracket[1] : raw.split(/\s[—–-]\s|[(:|[]/)[0]).trim();
  if (!title) return false;
  const names = [entity.name, ...(entity.aliases ?? [])];
  const wanted = normalizeAlias(title);
  return names.some(name => normalizeAlias(name) === wanted || namesSoundAlike(name, title));
}

/**
 * New other names for each character from `books` ([{ entries }]): Map entityId → [names].
 * Never a name that could mean someone else: one found in entries about two people, or a
 * single word that is part of another character's name («Хайтани» for Ran when there is
 * Rindo Haitani, «Акаши» for Takeomi when there is Akashi Hina).
 */
export function aliasesFromBooks(state, books) {
  const entities = Object.values(state.entities ?? {});
  const taken = new Map();
  const wordOwners = new Map();
  for (const entity of entities) {
    for (const name of [entity.name, ...(entity.aliases ?? [])]) {
      taken.set(normalizeAlias(name), entity.id);
      // By spelling and by sound: «Akashi» is someone else's «Акаши» too.
      for (const word of normalizeAlias(name).split(/\s+/)) {
        for (const form of [word, `~${phoneticKey(word)}`]) {
          if (!wordOwners.has(form)) wordOwners.set(form, new Set());
          wordOwners.get(form).add(entity.id);
        }
      }
    }
  }
  const candidates = new Map(); // normal name → { text, owners }
  for (const book of books ?? []) {
    for (const entry of Object.values(book?.entries ?? {})) {
      if (!entry || entry.disable) continue;
      for (const entity of entities) {
        if (!entryIsAbout(entry, entity)) continue;
        for (const key of (Array.isArray(entry.key) ? entry.key : []).flatMap(keyNames)) {
          const normal = normalizeAlias(String(key));
          if (taken.has(normal)) continue; // already theirs, or someone else's
          const item = candidates.get(normal) ?? { text: String(key).trim(), owners: new Set() };
          item.owners.add(entity.id);
          candidates.set(normal, item);
        }
      }
    }
  }
  const found = new Map();
  for (const [normal, { text, owners }] of candidates) {
    if (owners.size !== 1) continue;
    const [id] = owners;
    const words = normal.split(/\s+/);
    const others = form => [...(wordOwners.get(form) ?? [])].some(owner => owner !== id);
    if (words.length === 1 && (others(words[0]) || others(`~${phoneticKey(words[0])}`))) continue;
    const list = found.get(id) ?? [];
    if (list.length < MAX_NEW) list.push(text);
    found.set(id, list);
  }
  return found;
}

/** The entity.upsert operations that add them (one manual transaction). */
export function aliasOperations(state, found) {
  if (!found.size) return [];
  const metadata = { transactionId: uniqueId('manual'), reason: 'Другие имена из лорбука', timestamp: new Date().toISOString() };
  return [...found].filter(([id, names]) => state.entities?.[id] && names.length).map(([id, names]) => {
    const entity = state.entities[id];
    return createOperation('entity.upsert', { ...entity, aliases: [...(entity.aliases ?? []), ...names] }, metadata);
  });
}
