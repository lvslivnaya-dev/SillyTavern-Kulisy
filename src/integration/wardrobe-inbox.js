/**
 * The wardrobe inbox: a folder tree on the computer (kept by the server plugin
 * kulisy-images) where pictures are dropped by hand and become cards.
 *
 *   <папка>/Гардероб/<Персона|Персонажи>/<Женское|Унисекс|Мужское>/<раздел>/картинка.jpg
 *
 * The folder a picture lies in gives the card its shelf, gender and section; a picture
 * higher up (no section, or no gender) gets them from the model when describing is on.
 * Folder names are the page's own labels, so the tree reads like the wardrobe.
 */
import { WARDROBE_CATEGORIES, WARDROBE_GENDERS, WARDROBE_SHELVES } from '../core/index.js';

const norm = value => String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

/** Names besides the labels that mean the same folder. */
const SHELF_ALIASES = { persona: ['персона', 'персоны'], characters: ['персонажи', 'персонаж'] };
const GENDER_ALIASES = { female: ['женское', 'женский', 'жен', 'ж'], unisex: ['унисекс', 'уни'], male: ['мужское', 'мужской', 'муж', 'м'] };

function lookup(entries, aliases = {}) {
  const map = new Map();
  for (const [key, label] of entries) map.set(norm(label), key);
  for (const [key, names] of Object.entries(aliases)) for (const name of names) map.set(norm(name), key);
  return map;
}
const SHELVES = lookup(Object.entries(WARDROBE_SHELVES), SHELF_ALIASES);
const GENDERS = lookup(Object.entries(WARDROBE_GENDERS), GENDER_ALIASES);
const CATEGORIES = lookup(WARDROBE_CATEGORIES);

/** Every folder of the tree, relative to «Гардероб»: 'Персона/Женское/Верх', … */
export function inboxDirectories() {
  const dirs = [];
  for (const shelf of Object.values(WARDROBE_SHELVES)) {
    for (const gender of Object.values(WARDROBE_GENDERS)) {
      for (const [, section] of WARDROBE_CATEGORIES) dirs.push(`${shelf}/${gender}/${section}`);
    }
  }
  return dirs;
}

const SECTION_LABELS = Object.fromEntries(WARDROBE_CATEGORIES);

/** The folder of the tree a card's picture belongs in: 'Персона/Женское/Платья'. */
export function treeDirFor(card) {
  const shelf = WARDROBE_SHELVES[card?.shelf] ?? WARDROBE_SHELVES.characters;
  const gender = WARDROBE_GENDERS[card?.gender] ?? WARDROBE_GENDERS.female;
  const section = SECTION_LABELS[card?.category] ?? SECTION_LABELS.top;
  return `${shelf}/${gender}/${section}`;
}

/** Pictures of the tree no card points at yet: the ones dropped in by hand. */
export function newTreeFiles(files, cards) {
  const used = new Set((cards ?? []).map(card => String(card.image ?? '').replace(/^\/+/, '')).filter(Boolean));
  return (files ?? []).filter(file => file?.public && !used.has(String(file.public).replace(/^\/+/, '')));
}

/**
 * A file name worth keeping as the card's name: «розовое платье.jpg» yes;
 * «IMG_2034.jpg», «8f3a…c1.jpg», «wear_…» or «Без названия» no ('').
 */
export function nameFromFile(fileName) {
  const base = String(fileName ?? '').replace(/\.[^.]+$/, '');
  const text = base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\p{L}/u.test(text)) return '';
  if (/^(img|image|photo|pxl|dsc|dscn|screenshot|снимок|скриншот|изображение|wear|place|thing|download|file|unnamed|pinterest)\b[\s\d-]*/i.test(text) && /\d/.test(text)) return '';
  if (/^(без названия|untitled|unnamed|image|изображение)$/i.test(text)) return '';
  if (!/\s/.test(text) && /\d/.test(text) && text.length >= 10) return ''; // a hash, an id
  return text.slice(0, 120);
}

/**
 * 'Персона/Женское/Верх/фото.jpg' → { shelf, gender, category, name, problem }.
 * Missing levels are '' (the model may fill them); an unknown folder name is a problem.
 */
export function placeFromPath(relativePath) {
  const parts = String(relativePath ?? '').split('/').filter(Boolean);
  const fileName = parts.pop() ?? '';
  const place = { shelf: 'characters', gender: '', category: '', name: nameFromFile(fileName), problem: '' };
  const [shelfName, genderName, sectionName] = parts;
  if (shelfName !== undefined) {
    const shelf = SHELVES.get(norm(shelfName));
    if (!shelf) return { ...place, problem: `Непонятная папка «${shelfName}»: нужна «${WARDROBE_SHELVES.persona}» или «${WARDROBE_SHELVES.characters}».` };
    place.shelf = shelf;
  }
  if (genderName !== undefined) {
    const gender = GENDERS.get(norm(genderName));
    if (!gender) return { ...place, problem: `Непонятная папка «${genderName}»: нужна «Женское», «Унисекс» или «Мужское».` };
    place.gender = gender;
  }
  if (sectionName !== undefined) {
    const category = CATEGORIES.get(norm(sectionName));
    if (!category) return { ...place, problem: `Непонятная папка «${sectionName}»: такого раздела в гардеробе нет.` };
    place.category = category;
  }
  return place;
}
