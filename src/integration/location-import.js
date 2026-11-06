/**
 * Turning outside material into location drafts for the library (see addDrafts):
 *   - entries of a SillyTavern lorebook (any book, no Obsidian needed);
 *   - Markdown notes, e.g. an Obsidian folder picked in the browser.
 * Pure functions: reading files and books is the caller's job.
 */

const MARKDOWN = /\.(md|markdown)$/i;

function clip(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Entries of a lorebook a user can pick from: [{ uid, name, keys, preview, disabled }]. */
export function listLorebookEntries(book) {
  return Object.entries(book?.entries ?? {}).map(([uid, entry]) => {
    const keys = (Array.isArray(entry?.key) ? entry.key : []).map(key => clip(key, 60)).filter(Boolean);
    return {
      uid: String(entry?.uid ?? uid),
      name: clip(entry?.comment, 120) || keys[0] || `Запись ${uid}`,
      keys,
      preview: clip(entry?.content, 160),
      disabled: Boolean(entry?.disable),
    };
  }).filter(entry => entry.preview || entry.keys.length);
}

/** Drafts from the chosen entries (all enabled ones when `uids` is not given). */
export function draftsFromLorebook(book, uids = null) {
  const wanted = uids ? new Set(uids.map(String)) : null;
  const entries = book?.entries ?? {};
  return listLorebookEntries(book)
    .filter(entry => (wanted ? wanted.has(entry.uid) : !entry.disabled))
    .map(entry => {
      const raw = Object.values(entries).find(item => String(item?.uid) === entry.uid) ?? entries[entry.uid] ?? {};
      return {
        name: entry.name,
        aliases: entry.keys.filter(key => key.toLocaleLowerCase('ru-RU') !== entry.name.toLocaleLowerCase('ru-RU')),
        description: markdownToText(String(raw.content ?? '')),
      };
    });
}

/** A minimal YAML front matter reader: `key: value`, `key: [a, b]`, and `key:` + `- item` lines. */
export function readFrontMatter(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(String(text ?? ''));
  if (!match) return { data: {}, body: String(text ?? '') };
  const data = {};
  let listKey = '';
  const unquote = value => value.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { data[listKey].push(unquote(item[1])); continue; }
    const pair = /^([A-Za-zА-Яа-яЁё_][\wЀ-ӿ -]*):\s*(.*)$/.exec(line);
    if (!pair) { listKey = ''; continue; }
    const key = pair[1].trim().toLowerCase();
    const value = pair[2].trim();
    if (!value) { data[key] = []; listKey = key; continue; }
    listKey = '';
    data[key] = value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',').map(unquote).filter(Boolean)
      : unquote(value);
  }
  return { data, body: String(text).slice(match[0].length) };
}

/**
 * Obsidian/Markdown → plain prose for the model: no embeds, comments or HTML;
 * [[link|shown]] → shown; ==mark== and **bold** → their text; heading marks dropped.
 */
export function markdownToText(text) {
  return String(text ?? '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]|#]+)(?:#[^\]]*)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?(\[![^\]]*\][+-]?[ \t]*)?/gm, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asList(value) {
  if (Array.isArray(value)) return value.map(item => clip(item, 300)).filter(Boolean);
  return value ? String(value).split(',').map(item => clip(item, 300)).filter(Boolean) : [];
}

/**
 * One note → one draft. `relativePath` is the browser's path inside the picked folder
 * ("Локации/Токио/Сибуя/Бар.md"): the picked folder itself is dropped, the folders
 * below it become library folders. Front matter may give title, aliases, traits and
 * parent ("находится в"). Returns null for non-Markdown files and empty notes.
 */
export function draftFromMarkdown(relativePath, text) {
  const parts = String(relativePath ?? '').split(/[\\/]/).filter(Boolean);
  const file = parts.pop() ?? '';
  if (!MARKDOWN.test(file)) return null;
  const folderPath = parts.slice(1).filter(part => !part.startsWith('.'));
  const { data, body } = readFrontMatter(text);
  const name = clip(data.title || data['название'] || file.replace(MARKDOWN, ''), 120);
  const description = markdownToText(body);
  if (!name || (!description && !data.traits)) return null;
  const parent = data.parent || data['находится в'] || data['где'] || '';
  return {
    folderPath,
    name,
    aliases: asList(data.aliases ?? data.alias),
    description,
    traits: asList(data.traits ?? data['черты']),
    parentName: markdownToText(Array.isArray(parent) ? parent[0] : parent),
    ...thingFields(data),
  };
}

/** For things: «владелец» / owner and «важность» / importance from the front matter. */
function thingFields(data) {
  const owner = data.owner ?? data['владелец'] ?? data['чьё'] ?? '';
  const raw = clip(Array.isArray(data.importance ?? data['важность']) ? (data.importance ?? data['важность'])[0] : (data.importance ?? data['важность'] ?? ''), 30).toLowerCase();
  const importance = { key: 'key', important: 'important', 'ключевая': 'key', 'важная': 'important' }[raw];
  return {
    ...(owner ? { ownerName: markdownToText(Array.isArray(owner) ? owner[0] : owner) } : {}),
    ...(importance ? { importance } : {}),
  };
}

/** Many notes at once: [{ path, text }] → drafts, skipping what is not a location note. */
export function draftsFromMarkdownFiles(files) {
  return (files ?? []).map(file => draftFromMarkdown(file.path, file.text)).filter(Boolean);
}
