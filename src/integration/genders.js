/**
 * Grammatical gender of characters, guessed from their own lore without a model
 * request: the pronouns of a profile entry, a character card or the persona
 * description. Used only for the wording of trope factors. A guess fills only
 * an empty gender; whatever was chosen in the dossier is never changed.
 */
import { canonKeys, keysIntersect } from './lorebooks.js';

const FEMALE = /(?<![\p{L}])(она|её|ее|ей|ею|неё|нее|ней|родилась|девушка|девочка|женщина|сестра|дочь|she|her|hers|herself)(?![\p{L}])/giu;
const MALE = /(?<![\p{L}])(он|его|ему|него|нём|нем|родился|парень|мальчик|мужчина|брат|сын|he|him|his|himself)(?![\p{L}])/giu;

/** 'female' | 'male' | '' — only when one side clearly wins (at least 3 hits and twice the other). */
export function genderFromText(text) {
  const value = String(text ?? '');
  const female = (value.match(FEMALE) ?? []).length;
  const male = (value.match(MALE) ?? []).length;
  if (female >= 3 && female >= male * 2) return 'female';
  if (male >= 3 && male >= female * 2) return 'male';
  return '';
}

/** Text that is about this character: lore entries keyed to their names (their profile). */
export function profileText(entity, books) {
  const names = new Set([entity.name, ...(entity.aliases ?? [])].flatMap(value => [...canonKeys(value)]));
  const parts = [];
  for (const book of books) {
    for (const entry of Object.values(book?.entries ?? {})) {
      if (entry?.disable || typeof entry.content !== 'string') continue;
      const keys = new Set((Array.isArray(entry.key) ? entry.key : []).flatMap(value => [...canonKeys(value)]));
      if (keys.size && keysIntersect(names, keys)) parts.push(entry.content);
    }
  }
  return parts.join('\n');
}

/**
 * Guesses for characters without a gender: { id: 'male' | 'female' }.
 * extraTexts: { id: text } — a card description, the persona description.
 */
export function guessGenders(state, books, extraTexts = {}) {
  const known = state.ui?.genders ?? {};
  const result = {};
  for (const entity of Object.values(state.entities ?? {})) {
    if (known[entity.id]) continue;
    const gender = genderFromText(`${extraTexts[entity.id] ?? ''}\n${profileText(entity, books)}`);
    if (gender) result[entity.id] = gender;
  }
  return result;
}
