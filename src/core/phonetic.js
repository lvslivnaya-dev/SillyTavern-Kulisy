/**
 * Names by how they sound, so «Ran Haitani», «Ран Хайтани» and «Хайтани Ран» are one
 * person. Mostly Japanese names, which Russian writes in two systems (Polivanov:
 * Сандзу, Харутиё, Мотидзуки; the popular one: Санзу, Харучиё, Мочизуки) and English
 * in Hepburn (Sanzu, Haruchiyo, Mochizuki). Both scripts go to one Latin skeleton.
 *
 * phoneticWords(name) → the skeleton of each word; namesSoundAlike compares them as sets
 * (word order does not matter). editDistance is for the "maybe" cases — those are asked,
 * never merged silently.
 */

// Longest first: «дзю» before «дз», «тё» before «т».
const CYRILLIC = [
  ['дзю', 'ju'], ['дзя', 'ja'], ['дзё', 'jo'], ['дзи', 'ji'], ['дзу', 'zu'], ['дза', 'za'], ['дзе', 'ze'], ['дзо', 'zo'],
  ['джю', 'ju'], ['джя', 'ja'], ['джё', 'jo'], ['джи', 'ji'], ['джа', 'ja'], ['джу', 'ju'], ['джо', 'jo'], ['дже', 'je'], ['дж', 'j'],
  ['тю', 'chu'], ['тя', 'cha'], ['тё', 'cho'], ['ти', 'chi'],
  ['сю', 'shu'], ['ся', 'sha'], ['сё', 'sho'], ['си', 'shi'],
  ['щ', 'sh'], ['ш', 'sh'], ['ч', 'ch'], ['ц', 'ts'], ['ж', 'j'], ['х', 'h'],
  ['я', 'ya'], ['ю', 'yu'], ['ё', 'yo'], ['е', 'e'], ['э', 'e'], ['ы', 'i'], ['й', 'i'], ['ъ', ''], ['ь', ''],
  ['а', 'a'], ['б', 'b'], ['в', 'v'], ['г', 'g'], ['д', 'd'], ['з', 'z'], ['и', 'i'], ['к', 'k'], ['л', 'l'], ['м', 'm'],
  ['н', 'n'], ['о', 'o'], ['п', 'p'], ['р', 'r'], ['с', 's'], ['т', 't'], ['у', 'u'], ['ф', 'f'],
];

/** The skeleton of a word never changes, and the same few names are asked about again and again: remember them. */
const KEY_CACHE = new Map();

/** One word to its sound skeleton. */
export function phoneticKey(word) {
  const raw = String(word ?? '');
  const known = KEY_CACHE.get(raw);
  if (known !== undefined) return known;
  const key = computePhoneticKey(raw);
  if (KEY_CACHE.size > 20000) KEY_CACHE.clear();
  KEY_CACHE.set(raw, key);
  return key;
}

function computePhoneticKey(word) {
  // Composed first: NFKD would split «ё» and «й» into «е»/«и» + a mark and lose them.
  let text = String(word ?? '').normalize('NFC').toLowerCase().replace(/ō/g, 'o').replace(/ū/g, 'u');
  // Cyrillic → Latin, longest pieces first.
  let latin = '';
  for (let index = 0; index < text.length;) {
    const piece = CYRILLIC.find(([from]) => text.startsWith(from, index));
    if (piece) { latin += piece[1]; index += piece[0].length; }
    else { latin += text[index]; index += 1; }
  }
  // Then Latin accents go (é → e), and anything that is not a letter.
  text = latin.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  // One Latin spelling for the sounds that are written in several ways.
  text = text
    .replace(/tsu/g, 'TSU').replace(/dzu|du/g, 'zu').replace(/zi|di|dji|dzi/g, 'ji').replace(/dz/g, 'z')
    .replace(/si/g, 'shi').replace(/shhi/g, 'shi').replace(/ti/g, 'chi').replace(/tchi|cchi/g, 'chi').replace(/hu/g, 'fu')
    .replace(/sy/g, 'sh').replace(/ty|chy/g, 'ch').replace(/jy/g, 'j').replace(/shy/g, 'sh')
    .replace(/TSU/g, 'tsu')
    .replace(/l/g, 'r').replace(/w(?=o)/g, '').replace(/c(?!h)/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
    // Long vowels, doubled letters, «m» before b/m/p (Симбаси / Shinbashi).
    .replace(/ou|oo/g, 'o').replace(/uu/g, 'u').replace(/ei/g, 'e').replace(/ii/g, 'i').replace(/aa/g, 'a').replace(/ee/g, 'e')
    .replace(/m(?=[bmp])/g, 'n')
    .replace(/([bcdfghjkmnprstvz])\1+/g, '$1')
    // «y» between vowels or after i (Харучиё / Haruchiyo / Харучие): carries little.
    .replace(/(?<=[aeiou])y(?=[aeiou])/g, '');
  return text;
}

/** Words of a name, each as a sound skeleton (empty ones dropped). */
export function phoneticWords(name) {
  return String(name ?? '').split(/[\s,.()«»"'\-–—]+/).map(phoneticKey).filter(word => word.length > 1);
}

/** Two names sound the same: the same words, in any order. */
export function namesSoundAlike(left, right) {
  const a = phoneticWords(left).sort();
  const b = phoneticWords(right).sort();
  return a.length > 0 && a.length === b.length && a.every((word, index) => word === b[index]);
}

/** Damerau–Levenshtein distance (a swap of two letters counts as one). */
export function editDistance(left, right) {
  const a = String(left);
  const b = String(right);
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index, ...Array(b.length).fill(0)]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + cost);
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/**
 * Names that might be one person: same number of words, each pair of words close
 * (one letter off for words of five letters and more, otherwise the same).
 * Never used to merge silently — only to ask.
 */
export function namesMaybeAlike(left, right) {
  const a = phoneticWords(left).sort();
  const b = phoneticWords(right).sort();
  if (!a.length || a.length !== b.length) return false;
  // Any word order: try matching each word of `a` to a free word of `b`.
  const free = [...b];
  for (const word of a) {
    const index = free.findIndex(other => other === word || (Math.min(word.length, other.length) >= 5 && editDistance(word, other) <= 1));
    if (index < 0) return false;
    free.splice(index, 1);
  }
  return true;
}
