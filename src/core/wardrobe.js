/**
 * The wardrobe: pieces of clothing (and hair, make-up, jewellery, bags…) kept across
 * chats, each a card with a picture and a description. It lives in the extension
 * settings like the library, so it is not journaled and never rolls back with a swipe.
 *
 * wardrobe = {
 *   version: 1,
 *   cards: [{ id, shelf, gender, category, name, description, image?, placement? }]
 *                                            placement: where a tattoo is («левое предплечье»)
 *   looks: [{ id, shelf, name, cardIds[] }]          a saved set of cards: "форма Тосвы"
 * }
 *
 * Two shelves: 'persona' (for any persona of the user) and 'characters' (for anyone
 * else). A card belongs to nobody: who wears it is the chat's business — the chat's
 * wardrobe entry lists the card IDs a character has on (world.wardrobe[id].cardIds).
 * Cards of a look add up, they never replace each other.
 *
 * `image` is a path the SillyTavern server gave back (user/images/…), not the picture.
 * Every function returns a new wardrobe and never mutates its input.
 */
import { uniqueId } from './ids.js';

export const WARDROBE_VERSION = 1;
export const WARDROBE_LIMITS = Object.freeze({ cards: 3000, looks: 500, name: 120, placement: 120, description: 3000, lookCards: 40, image: 400 });

export const WARDROBE_SHELVES = Object.freeze({ persona: 'Персона', characters: 'Персонажи' });
export const WARDROBE_GENDERS = Object.freeze({ female: 'Женское', unisex: 'Унисекс', male: 'Мужское' });
/** Sections in the order the page shows them. */
export const WARDROBE_CATEGORIES = Object.freeze([
  ['hair', 'Волосы'], ['top', 'Верх'], ['pants', 'Брюки'], ['skirts', 'Юбки'], ['dresses', 'Платья'],
  ['outerwear', 'Верхняя одежда'], ['underwear', 'Нижнее бельё'], ['shoes', 'Обувь'], ['headwear', 'Головной убор'],
  ['bags', 'Сумки'], ['jewelry', 'Украшения'], ['accessories', 'Аксессуары'], ['makeup', 'Макияж'], ['nails', 'Маникюр'], ['tattoos', 'Татуировки'], ['sets', 'Комплекты'],
].map(entry => Object.freeze(entry)));
const CATEGORY_IDS = new Set(WARDROBE_CATEGORIES.map(([id]) => id));

export function emptyWardrobe() {
  return { version: WARDROBE_VERSION, cards: [], looks: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanProse(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const shelfOr = value => (Object.hasOwn(WARDROBE_SHELVES, value) ? value : 'characters');
const genderOr = value => (Object.hasOwn(WARDROBE_GENDERS, value) ? value : 'female');
const categoryOr = value => (CATEGORY_IDS.has(value) ? value : 'top');

/**
 * Only a path on this server (never a remote URL or data URI). Shared with the library:
 * a relative /user/images/… path, or a picture of the folder storage served by the
 * server plugin (/api/plugins/kulisy-images/file/<kulisy-wardrobe|kulisy-library>/<name>).
 */
export function cleanImagePath(value) {
  const path = String(value ?? '').trim().slice(0, WARDROBE_LIMITS.image);
  if (path.includes('..')) return '';
  if (/^\/?user\/images\/[^?#]+\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(path)) return path;
  if (/^\/?api\/plugins\/kulisy-images\/file\/kulisy-(wardrobe|library)\/[\w-]{1,120}\.(png|jpg|webp|gif)$/.test(path)) return path;
  if (isTreePath(path)) return path;
  return '';
}

/** A picture of the wardrobe tree «Гардероб/<полка>/<пол>/<раздел>/файл» (served by the plugin). */
function isTreePath(path) {
  const match = /^\/?api\/plugins\/kulisy-images\/wardrobe\/(.+)$/.exec(path);
  if (!match) return false;
  const parts = match[1].split('/');
  if (parts.length < 1 || parts.length > 4) return false;
  const name = parts.at(-1);
  if (!/^[^\\/:*?"<>|\u0000-\u001f]{1,200}\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(name) || name.startsWith('.')) return false;
  return parts.slice(0, -1).every(part => /^[\p{L}\p{N}][\p{L}\p{N} _.()-]{0,59}$/u.test(part) && !part.endsWith('.'));
}

function cardFrom(id, raw) {
  const image = cleanImagePath(raw?.image);
  const placement = cleanText(raw?.placement, WARDROBE_LIMITS.placement);
  return {
    id,
    shelf: shelfOr(raw?.shelf),
    gender: genderOr(raw?.gender),
    category: categoryOr(raw?.category),
    name: cleanText(raw?.name, WARDROBE_LIMITS.name),
    description: cleanProse(raw?.description, WARDROBE_LIMITS.description),
    ...(image ? { image } : {}),
    ...(placement ? { placement } : {}),
    // The name came from the model: a new description may rename the card. Typed by hand: never.
    ...(raw?.autoName ? { autoName: true } : {}),
  };
}

/** Repair whatever came from settings or a file: junk dropped, looks keep only existing cards. */
export function normalizeWardrobe(input) {
  const wardrobe = emptyWardrobe();
  if (!input || typeof input !== 'object') return wardrobe;
  const ids = new Set();
  for (const raw of Array.isArray(input.cards) ? input.cards : []) {
    const id = String(raw?.id ?? '');
    if (!id || ids.has(id) || wardrobe.cards.length >= WARDROBE_LIMITS.cards) continue;
    const card = cardFrom(id, raw);
    // A card needs something to show: a name, a description or a picture.
    if (!card.name && !card.description && !card.image) continue;
    ids.add(id);
    wardrobe.cards.push(card);
  }
  const lookIds = new Set();
  for (const raw of Array.isArray(input.looks) ? input.looks : []) {
    const id = String(raw?.id ?? '');
    const name = cleanText(raw?.name, WARDROBE_LIMITS.name);
    if (!id || !name || lookIds.has(id) || wardrobe.looks.length >= WARDROBE_LIMITS.looks) continue;
    lookIds.add(id);
    wardrobe.looks.push({ id, shelf: shelfOr(raw.shelf), name, cardIds: cleanCardIds(wardrobe, raw.cardIds) });
  }
  return wardrobe;
}

function cleanCardIds(wardrobe, values) {
  const known = new Set(wardrobe.cards.map(card => card.id));
  return [...new Set((Array.isArray(values) ? values : []).map(String))].filter(id => known.has(id)).slice(0, WARDROBE_LIMITS.lookCards);
}

// ---- Cards ------------------------------------------------------------------

/** Add a card. It needs a name, a description or a picture (a picture alone is described later). */
export function addCard(wardrobe, fields = {}) {
  const next = clone(wardrobe);
  if (next.cards.length >= WARDROBE_LIMITS.cards) throw new RangeError('Слишком много карточек гардероба');
  const card = cardFrom(uniqueId('wear'), fields);
  if (!card.name && !card.description && !card.image) throw new TypeError('Нужна картинка, название или описание');
  next.cards.push(card);
  return { wardrobe: next, card };
}

export function updateCard(wardrobe, cardId, changes = {}) {
  const next = clone(wardrobe);
  const card = next.cards.find(candidate => candidate.id === cardId);
  if (!card) throw new RangeError('Такой карточки нет');
  if (changes.shelf != null) card.shelf = shelfOr(changes.shelf);
  if (changes.gender != null) card.gender = genderOr(changes.gender);
  if (changes.category != null) card.category = categoryOr(changes.category);
  if (changes.name != null) {
    const name = cleanText(changes.name, WARDROBE_LIMITS.name);
    if (name !== card.name && !changes.autoName) delete card.autoName; // a name typed by hand stays
    card.name = name;
  }
  if (changes.autoName) card.autoName = true;
  if (changes.placement != null) {
    const placement = cleanText(changes.placement, WARDROBE_LIMITS.placement);
    if (placement) card.placement = placement; else delete card.placement;
  }
  if (changes.description != null) card.description = cleanProse(changes.description, WARDROBE_LIMITS.description);
  if (changes.image !== undefined) {
    const image = cleanImagePath(changes.image);
    if (image) card.image = image; else delete card.image;
  }
  if (!card.name && !card.description && !card.image) throw new TypeError('Нужна картинка, название или описание');
  return next;
}

/** Remove a card; looks lose it too. Returns { wardrobe, image } — the picture to delete from the server. */
export function removeCard(wardrobe, cardId) {
  const card = wardrobe.cards.find(candidate => candidate.id === cardId);
  const next = clone(wardrobe);
  next.cards = next.cards.filter(candidate => candidate.id !== cardId);
  for (const look of next.looks) look.cardIds = look.cardIds.filter(id => id !== cardId);
  return { wardrobe: next, image: card?.image ?? '' };
}

/** Cards of a shelf, optionally of one gender and one section, sorted by section then name. */
export function cardsOf(wardrobe, { shelf, gender, category } = {}) {
  return sortCards(wardrobe.cards.filter(card => (!shelf || card.shelf === shelf) && (!gender || card.gender === gender) && (!category || card.category === category)));
}

const CATEGORY_ORDER = new Map(WARDROBE_CATEGORIES.map(([id], index) => [id, index]));

/** Section order first, then the name. */
function sortCards(list) {
  return list.sort((left, right) => (CATEGORY_ORDER.get(left.category) - CATEGORY_ORDER.get(right.category)) || cardLabel(left).localeCompare(cardLabel(right), 'ru'));
}

/** What to call a card: its name, else the start of its description, else its section. */
export function cardLabel(card) {
  if (card?.name) return card.name;
  const text = cleanText(card?.description, 60);
  if (text) return text.length >= 60 ? `${text.slice(0, 57)}…` : text;
  return WARDROBE_CATEGORIES.find(([id]) => id === card?.category)?.[1] ?? 'Без названия';
}

/** Cards whose name or description contains the query. */
export function searchCards(wardrobe, query, { shelf } = {}) {
  const wanted = cleanText(query, 200).toLocaleLowerCase('ru-RU');
  if (!wanted) return [];
  return wardrobe.cards.filter(card => (!shelf || card.shelf === shelf)
    && [card.name, card.description].some(text => text.toLocaleLowerCase('ru-RU').includes(wanted)));
}

// ---- Looks ------------------------------------------------------------------

export function addLook(wardrobe, { shelf, name, cardIds } = {}) {
  const next = clone(wardrobe);
  if (next.looks.length >= WARDROBE_LIMITS.looks) throw new RangeError('Слишком много образов');
  const title = cleanText(name, WARDROBE_LIMITS.name);
  if (!title) throw new TypeError('Назовите образ');
  const ids = cleanCardIds(next, cardIds);
  if (!ids.length) throw new TypeError('Выберите хотя бы одну карточку');
  const look = { id: uniqueId('look'), shelf: shelfOr(shelf), name: title, cardIds: ids };
  next.looks.push(look);
  return { wardrobe: next, look };
}

export function updateLook(wardrobe, lookId, changes = {}) {
  const next = clone(wardrobe);
  const look = next.looks.find(candidate => candidate.id === lookId);
  if (!look) throw new RangeError('Такого образа нет');
  if (changes.name != null) {
    const title = cleanText(changes.name, WARDROBE_LIMITS.name);
    if (!title) throw new TypeError('Назовите образ');
    look.name = title;
  }
  if (changes.cardIds != null) {
    const ids = cleanCardIds(next, changes.cardIds);
    if (!ids.length) throw new TypeError('Выберите хотя бы одну карточку');
    look.cardIds = ids;
  }
  return next;
}

export function removeLook(wardrobe, lookId) {
  const next = clone(wardrobe);
  next.looks = next.looks.filter(look => look.id !== lookId);
  return next;
}

// ---- Wearing ------------------------------------------------------------------

/** Existing cards among `cardIds`, in wardrobe order of sections (hair first, set last). */
export function wornCards(wardrobe, cardIds) {
  const wanted = new Set((cardIds ?? []).map(String));
  if (!wanted.size) return [];
  // Pick the few worn cards first, then sort them: sorting the whole wardrobe (hundreds of cards) on every redraw was slow.
  return sortCards((wardrobe ?? emptyWardrobe()).cards.filter(card => wanted.has(card.id)));
}

/** The outfit line of a set of cards: their names, in section order. They add up. */
export function composeOutfit(wardrobe, cardIds) {
  return wornCards(wardrobe, cardIds).map(outfitLabel).join('; ');
}

/** The start of a description: up to the first sentence end, at most `max` characters. */
function leadOf(text, max = 60) {
  const clean = cleanText(text, 1000);
  const sentence = clean.split(/(?<=[.!?;])\s/)[0].replace(/[.;]$/, '');
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * A card in the short outfit line. A card named only by its section («Волосы»,
 * «Обувь», «Новая карточка») says nothing, so it is told by the start of its
 * description: «Волосы: длинные розовые с чёлкой». A real name stays as it is.
 */
export function outfitLabel(card) {
  const section = WARDROBE_CATEGORIES.find(([id]) => id === card?.category)?.[1] ?? '';
  const name = String(card?.name ?? '').trim().toLocaleLowerCase('ru-RU');
  const generic = !name || name === section.toLocaleLowerCase('ru-RU') || name === 'новая карточка';
  const lead = leadOf(card?.description);
  if (!generic || !lead) return wornLabel(card);
  const placement = card?.category === 'tattoos' && card.placement ? ` (${card.placement})` : '';
  return `${section || cardLabel(card)}: ${lead}${placement}`;
}

/** A card as the narrator reads it: a tattoo says where it is («карп (левое предплечье)»). */
export function wornLabel(card) {
  const label = cardLabel(card);
  return card?.category === 'tattoos' && card.placement ? `${label} (${card.placement})` : label;
}

/** `current` plus `added` without duplicates (putting a card on over what is worn). */
export function addToWorn(current, added) {
  return [...new Set([...(current ?? []), ...(added ?? [])].map(String))].slice(0, WARDROBE_LIMITS.lookCards);
}
