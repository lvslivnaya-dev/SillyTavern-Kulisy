/**
 * Moving a chat from Horae to Kulisy. Horae keeps its records inside the chat
 * itself, so they are there even with Horae switched off or removed:
 *   chat[i].horae_meta = { timestamp: { story_date, story_time }, scene: { location,
 *     characters_present[] }, costumes: { name: outfit }, items: { name: { holder,
 *     location, importance: ''|'!'|'!!', description } }, deletedItems: [names] }
 *   chat[i].horae_meta.events = [{ summary, level: 一般|重要|关键 }]   the story timeline, one line per reply
 *   chat[0].horae_meta.autoSummaries = [{ id, range: [from, to], summaryText, active }]   (only when compressed)
 *   chat[0].horae_meta.locationMemory = { name: { desc, _deleted? } }
 * Read-only: nothing of Horae's is changed. The latest state is rebuilt the way
 * Horae does it (later messages win), then turned into Kulisy operations.
 */
import {
  CHRONICLE_MARKER, addDrafts, addFolder, addScene, applyOperations, createOperation, formatTime, matchEntity, normalizeAlias, parseTime, uniqueId,
} from '../core/index.js';
import { findInLibrary, linkOperations, linkedCards } from './location-links.js';
import { fingerprintTexts } from './chronicle-run.js';

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const CONSUMED = /^(消耗|已消耗|已用完|消耗殆尽|用尽|无|無|consumed|used\s*up|depleted|none|нет|израсходован[оа]?)$/i;
const PART_WORDS = [
  [/утр|morning|早|上午|清晨/i, 'morning'],
  [/д[её]н|днём|полдень|noon|afternoon|daytime|中午|下午|白天/i, 'day'],
  [/вечер|evening|dusk|傍晚|晚上|黄昏/i, 'evening'],
  [/ноч|полноч|night|midnight|夜|深夜|凌晨/i, 'night'],
];

/** A date of Horae ("10/1", "2024/10/1", "1.10.2024", "2024年10月1日") as a day count, or null. */
export function horaeDateValue(text) {
  const value = String(text ?? '');
  let match = value.match(/(\d{4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
  match = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) return Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])) / 86_400_000;
  match = value.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})/);
  if (match) return Date.UTC(2001, Number(match[1]) - 1, Number(match[2])) / 86_400_000;
  return null;
}

const ORDINALS = ['перв', 'втор', 'трет', 'четв[её]рт', 'пят', 'шест', 'седьм', 'восьм', 'девят', 'десят', 'одиннадцат', 'двенадцат'];

/** «четвёртый день стоянки», «день 4», «4-й день» → 4; else null. */
export function horaeDayNumber(text) {
  const value = String(text ?? '').toLowerCase();
  // No \b here: in JavaScript it does not see Cyrillic letters as word letters.
  let match = value.match(/(?:день|day)\s*№?\s*(\d{1,4})/) ?? value.match(/(\d{1,4})\s*-?\s*(?:й|ый|ой|th|st|nd|rd)?\s*(?:день|day)/);
  if (match) return Number(match[1]);
  for (let index = 0; index < ORDINALS.length; index += 1) {
    if (new RegExp(`(^|[^а-яё])${ORDINALS[index]}[а-яё]*\\s+(день|дня|дне)`).test(value)) return index + 1;
  }
  return null;
}

/**
 * Which story day a date names, as a comparable key: «1524/05/14» and «1524/5/14 (三)»
 * are one day; «…острове, полдень» and «…острове,» too.
 */
function sameDayKey(text) {
  const value = horaeDateValue(text);
  if (value != null) return `d${value}`;
  return String(text ?? '').toLowerCase()
    .replace(/(утр\S*|д[её]н\S*|днём|полдень|полдня|вечер\S*|ноч\S*|полночь|рассвет\S*|закат\S*|morning|noon|afternoon|evening|night|midnight)/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[\s,.;:–—-]+/g, ' ').trim();
}

const metas = chat => (chat ?? []).map((message, index) => ({ index, meta: message?.horae_meta })).filter(({ meta }) => meta && typeof meta === 'object' && !meta._skipHorae);

/** What Horae knows about this chat, latest state first. `found` is false when there is nothing. */
export function readHorae(chat) {
  const list = metas(chat);
  const first = chat?.[0]?.horae_meta ?? {};
  const result = {
    found: false, date: '', time: '', day: 0, location: '', present: [], costumes: {}, items: [], places: [], summaries: [], events: [],
  };
  // Story days: from the first date that parses, else one more each time the date changes.
  let firstDate = null;
  let lastDate = null;
  let dayByChange = 0;
  let previousDate = '';
  let dayByWords = null;
  const items = new Map();
  for (const { index, meta } of list) {
    const date = clip(meta.timestamp?.story_date, 120);
    const time = clip(meta.timestamp?.story_time, 30);
    if (date) {
      result.date = date;
      const value = horaeDateValue(date);
      if (value != null) { if (firstDate == null) firstDate = value; lastDate = value; }
      const words = horaeDayNumber(date);
      if (words != null) dayByWords = words;
      const key = sameDayKey(date);
      if (key !== previousDate) { dayByChange += 1; previousDate = key; }
    }
    if (clip(meta.scene?.location, 120)) result.location = clip(meta.scene.location, 120);
    if (Array.isArray(meta.scene?.characters_present) && meta.scene.characters_present.length) {
      result.present = meta.scene.characters_present.map(name => clip(name, 120)).filter(Boolean);
    }
    // The timeline: one line per reply. A projection of a compressed summary is not a line of its own.
    for (const event of Array.isArray(meta.events) ? meta.events : (meta.event ? [meta.event] : [])) {
      const text = String(event?.summary ?? '').trim();
      if (!text || event.isSummary || event._summaryId || event.level === '摘要') continue;
      result.events.push({ index, text: text.slice(0, 600), key: event.level === '关键' || event.level === '關鍵', compressedBy: event._compressedBy ?? '', date, present: [...result.present], location: result.location });
    }
    if (time) result.time = time;
    for (const [name, outfit] of Object.entries(meta.costumes ?? {})) {
      if (clip(name, 120) && clip(outfit, 500)) result.costumes[clip(name, 120)] = clip(outfit, 500);
    }
    for (const [rawName, info] of Object.entries(meta.items ?? {})) {
      const name = clip(rawName, 120);
      if (!name || !info || typeof info !== 'object') continue;
      if (CONSUMED.test(clip(info.holder, 60))) { items.delete(name.toLowerCase()); continue; }
      const old = items.get(name.toLowerCase()) ?? {};
      items.set(name.toLowerCase(), {
        name,
        holder: info.holder !== undefined ? clip(info.holder, 120) : (old.holder ?? ''),
        place: info.location !== undefined ? clip(info.location, 200) : (old.place ?? ''),
        importance: info.importance === '!!' ? 'key' : info.importance === '!' ? 'important' : (old.importance ?? 'normal'),
        description: clip(info.description, 300) || old.description || '',
      });
    }
    for (const gone of Array.isArray(meta.deletedItems) ? meta.deletedItems : []) items.delete(clip(gone, 120).toLowerCase());
  }
  if (firstDate != null && lastDate != null) result.day = Math.max(1, Math.round(lastDate - firstDate) + 1);
  else if (dayByWords != null) result.day = dayByWords;
  else result.day = dayByChange;
  result.items = [...items.values()];
  for (const [name, entry] of Object.entries(first.locationMemory ?? {})) {
    if (!entry || entry._deleted || !clip(name, 120)) continue;
    const parts = name.split(/[·・|/]/).map(part => part.trim()).filter(Boolean);
    result.places.push({ name: clip(name, 120), description: String(entry.desc ?? '').trim().slice(0, 8000), parentName: parts.length > 1 ? parts.slice(0, -1).join('·') : '' });
  }
  result.summaries = (Array.isArray(first.autoSummaries) ? first.autoSummaries : [])
    .filter(entry => entry && entry.active !== false && clip(entry.summaryText, 20) && Array.isArray(entry.range) && Number.isInteger(entry.range[0]) && Number.isInteger(entry.range[1]))
    .map(entry => ({ from: Math.min(entry.range[0], entry.range[1]), to: Math.max(entry.range[0], entry.range[1]), text: String(entry.summaryText).trim() }))
    .sort((left, right) => left.from - right.from);
  // Lines folded into a summary that is still active travel with the summary, not alone.
  const activeIds = new Set((Array.isArray(first.autoSummaries) ? first.autoSummaries : []).filter(entry => entry?.active !== false).map(entry => entry.id));
  result.events = result.events.filter(event => !(event.compressedBy && activeIds.has(event.compressedBy)));
  result.found = Boolean(result.date || result.time || result.location || Object.keys(result.costumes).length || result.items.length || result.places.length || result.summaries.length || result.events.length);
  return result;
}

/** A Kulisy character by a name Horae used (name or alias), or ''. */
function entityByName(state, name) {
  const wanted = normalizeAlias(name ?? '');
  if (!wanted) return '';
  return Object.values(state.entities ?? {}).find(entity => [entity.name, ...(entity.aliases ?? [])].some(alias => normalizeAlias(alias) === wanted))?.id
    // Another spelling, the name in parts, the same sound — only when it is certain.
    ?? (matchEntity(state, name)?.sure ? matchEntity(state, name).id : '');
}

/** Names Horae mentions (present, costumes, holders) that this chat has no character for. */
export function unknownNames(state, horae) {
  const names = new Set([...horae.present, ...Object.keys(horae.costumes), ...horae.items.map(item => item.holder).filter(Boolean)]);
  return [...names].filter(name => !entityByName(state, name));
}

/** What the import would bring, for the preview. */
export function horaeSummary(state, horae, chat = []) {
  return {
    found: horae.found,
    clock: [horae.date, horae.time].filter(Boolean).join(', '),
    day: horae.day,
    location: horae.location,
    present: horae.present,
    outfits: Object.keys(horae.costumes).length,
    items: horae.items.length,
    places: horae.places.length,
    summaries: horae.summaries.length,
    events: horae.events.length,
    hidden: horaeHidden(chat).length,
    unknown: unknownNames(state, horae),
  };
}

/**
 * Operations for the chat (one manual transaction, so a swipe never undoes it).
 * options: { scene, outfits, items, events, createCharacters } — what to bring.
 * `createEntity(name)` makes a Kulisy character (state.js createEntity).
 * Returns { operations, created: [names] }. Place cards are linked by the caller (library).
 */
export function horaeOperations(state, horae, options, createEntity) {
  const metadata = { transactionId: uniqueId('import'), reason: 'Перенос из Хорае', timestamp: new Date().toISOString() };
  const operations = [];
  const created = [];
  const known = new Map();
  const idOf = name => {
    if (!name) return '';
    const key = normalizeAlias(name);
    if (known.has(key)) return known.get(key);
    let id = entityByName(state, name);
    if (!id && options.createCharacters) {
      const entity = createEntity(name);
      operations.push(createOperation('entity.upsert', entity, metadata));
      created.push(name);
      id = entity.id;
    }
    known.set(key, id);
    return id;
  };
  if (options.scene) {
    const minutes = parseTime(horae.time);
    const part = minutes == null ? PART_WORDS.find(([pattern]) => pattern.test(horae.time || horae.date))?.[1] : undefined;
    if (horae.day || minutes != null || part || horae.date) {
      operations.push(createOperation('clock.set', {
        ...(horae.day ? { day: horae.day } : {}),
        ...(minutes != null ? { time: formatTime(minutes) } : {}),
        ...(part ? { part } : {}),
        ...(horae.date ? { label: horae.date } : {}),
      }, metadata));
    }
  }
  if (options.outfits) {
    for (const [name, outfit] of Object.entries(horae.costumes)) {
      const entityId = idOf(name);
      if (entityId) operations.push(createOperation('wardrobe.set', { entityId, outfit }, metadata));
    }
  }
  if (options.items) {
    const have = new Set((state.world?.items ?? []).map(item => item.name.toLowerCase()));
    for (const item of horae.items) {
      if (have.has(item.name.toLowerCase())) continue;
      const ownerId = idOf(item.holder);
      const place = ownerId ? item.place : [item.holder, item.place].filter(Boolean).join(', ');
      operations.push(createOperation('item.add', {
        item: {
          id: uniqueId('item'), name: item.name, importance: item.importance,
          ...(ownerId ? { ownerId } : {}), ...(place ? { place: clip(place, 300) } : {}), ...(item.description ? { note: item.description } : {}),
        },
      }, metadata));
    }
  }
  if (options.events) {
    const have = new Set((state.knowledge?.events ?? []).map(event => event.text.toLowerCase()));
    for (const event of horae.events.slice(-1000)) {
      const text = clip(event.text, 500);
      if (!text || have.has(text.toLowerCase())) continue;
      have.add(text.toLowerCase());
      operations.push(createOperation('event.add', {
        item: { id: uniqueId('event'), text, witnessIds: event.present.map(idOf).filter(Boolean), ...(event.location ? { location: clip(event.location, 120) } : {}) },
      }, { ...metadata, reason: `Событие из Хорае: ${text.slice(0, 80)}` }));
    }
  }
  // Who is on stage goes last: the characters it names may have just been created.
  const presentIds = options.scene ? horae.present.map(idOf).filter(Boolean) : [];
  return { operations, created, presentIds, metadata };
}

/**
 * Horae's summaries as chronicle scenes: each covers its range of messages, which get
 * the chronicle marker (so they are not summarized again). A summary over messages the
 * chronicle already covers is skipped. Returns { scenes: [{ id, text, indices }], skipped }.
 */
export function horaeScenes(chat, horae, marker, { sceneEvery = 15, keepRecent = 20 } = {}) {
  const scenes = [];
  let skipped = 0;
  const taken = new Set();
  const story = index => isStory(chat?.[index]);
  for (const summary of horae.summaries) {
    const indices = [];
    for (let index = summary.from; index <= Math.min(summary.to, (chat?.length ?? 0) - 1); index += 1) {
      if (isStory(chat[index])) indices.push(index);
    }
    if (!indices.length || indices.some(index => chat[index]?.extra?.[marker] || taken.has(index))) { skipped += 1; continue; }
    indices.forEach(index => taken.add(index));
    scenes.push({ id: uniqueId('scene'), text: summary.text, indices });
  }
  // The timeline (most chats have only this): its lines, a scene per `sceneEvery` story
  // messages, like the chronicle would cut them. The newest `keepRecent` messages stay
  // as they are — the chronicle summarizes them itself later, never hiding them early.
  const lines = new Map();
  for (const event of horae.events ?? []) {
    if (!lines.has(event.index)) lines.set(event.index, []);
    lines.get(event.index).push(event);
  }
  const limit = (chat?.length ?? 0) - keepRecent;
  let run = [];
  const flush = () => {
    const withLines = run.filter(index => lines.has(index));
    if (withLines.length) {
      let lastDate = '';
      const parts = [];
      for (const index of withLines) {
        for (const event of lines.get(index)) {
          const date = event.date && sameDayKey(event.date) !== sameDayKey(lastDate) ? `[${event.date}] ` : '';
          if (event.date) lastDate = event.date;
          parts.push(`${date}${event.text}`);
        }
      }
      scenes.push({ id: uniqueId('scene'), text: parts.join(' ').slice(0, 4000), indices: [...run] });
    }
    run = [];
  };
  for (let index = 0; index < limit; index += 1) {
    if (!story(index)) continue;
    if (chat[index]?.extra?.[marker] || taken.has(index)) { if (run.length) flush(); continue; }
    run.push(index);
    if (run.length >= sceneEvery) flush();
  }
  if (run.length) flush();
  scenes.sort((left, right) => left.indices[0] - right.indices[0]);
  return { scenes, skipped };
}

/** A story message — including one Horae hid from the model after summarizing it (/hide sets is_system). */
function isStory(message) {
  return Boolean(message && String(message.mes ?? '').trim() && (!message.is_system || message.horae_meta?._autoBufferHidden));
}

/** Messages Horae hid from the model (its "buffer" after a summary). */
export function horaeHidden(chat) {
  return (chat ?? []).map((message, index) => (message?.is_system && message.horae_meta?._autoBufferHidden ? index : -1)).filter(index => index >= 0);
}

/** The library folder Horae's places go into. */
export const HORAE_FOLDER = 'Из Хорае';

/**
 * Studio callbacks.
 * deps: { getState(), commitOperations(ops), chat(), saveChat(), chronicle(), saveChronicle(next),
 *         chronicleConfig() → { sceneEvery, keepRecent }, library (store), createEntity(name), markShown(index) — the
 *         message row in the open chat, log(level, text, error) }
 */
export function createHoraeCallbacks(deps) {
  return {
    onHoraeScan: () => {
      const chat = deps.chat();
      const horae = readHorae(chat);
      const config = deps.chronicleConfig?.() ?? {};
      return { ...horaeSummary(deps.getState(), horae, chat), recent: Math.max(0, config.keepRecent ?? 20), messages: chat?.length ?? 0 };
    },

    /** options: { chronicle, scene, outfits, items, places, createCharacters } */
    onHoraeImport: async (options = {}) => {
      const chat = deps.chat();
      const horae = readHorae(chat);
      if (!horae.found) throw new Error('В этом чате нет записей Хорае.');
      const result = { created: [], operations: 0, places: 0, scenes: 0, skippedScenes: 0 };
      const { operations, created, presentIds, metadata } = horaeOperations(deps.getState(), horae, options, deps.createEntity);
      result.created = created;
      let preview = applyOperations(deps.getState(), operations);
      const all = [...operations];

      if (options.places && horae.places.length) {
        let library = deps.library.get();
        let folder = library.folders.find(item => item.name === HORAE_FOLDER && !item.parentId);
        if (!folder) ({ library, folder } = addFolder(library, { name: HORAE_FOLDER }));
        const added = addDrafts(library, horae.places.map(place => ({ name: place.name, description: place.description, parentName: place.parentName })), folder.id);
        library = deps.library.set(added.library);
        result.places = added.added.length;
        const names = new Set(horae.places.map(place => place.name.toLowerCase()));
        const ids = library.locations.filter(location => location.folderId === folder.id && names.has(location.name.toLowerCase())).map(location => location.id);
        const links = linkOperations(preview, library, ids);
        all.push(...links);
        preview = applyOperations(preview, links);
      }
      if (options.scene && (horae.location || presentIds.length)) {
        const shelved = horae.location ? findInLibrary(deps.library.get(), horae.location) : null;
        const card = (shelved && linkedCards(preview).get(shelved.id))
          ?? (preview.world?.locations ?? []).find(location => location.name.toLowerCase() === horae.location.toLowerCase());
        all.push(createOperation('scene.set', {
          presentIds, ...(horae.location ? { location: horae.location } : {}), ...(card ? { locationId: card.id } : {}),
        }, metadata));
      }
      if (all.length) await deps.commitOperations(all);
      result.operations = all.length;

      if (options.chronicle && (horae.summaries.length || horae.events.length)) {
        const config = deps.chronicleConfig?.() ?? {};
        const { scenes, skipped } = horaeScenes(chat, horae, CHRONICLE_MARKER, { sceneEvery: config.sceneEvery, keepRecent: config.keepRecent });
        result.skippedScenes = skipped;
        if (scenes.length) {
          let chronicle = deps.chronicle();
          for (const scene of scenes) {
            for (const index of scene.indices) {
              chat[index].extra ??= {};
              chat[index].extra[CHRONICLE_MARKER] = scene.id;
            }
            chronicle = addScene(chronicle, { id: scene.id, text: scene.text, messageCount: scene.indices.length, fingerprint: fingerprintTexts(scene.indices.map(index => String(chat[index].mes))) });
          }
          await deps.saveChat();
          await deps.saveChronicle(chronicle);
          result.scenes = scenes.length;
        }
      }
      if (options.unhide) {
        const hidden = horaeHidden(chat);
        for (const index of hidden) {
          chat[index].is_system = false;
          delete chat[index].horae_meta._autoBufferHidden;
          deps.markShown?.(index);
        }
        if (hidden.length) await deps.saveChat();
        result.unhidden = hidden.length;
      }
      deps.log?.('info', `Перенос из Хорае: изменений ${result.operations}, сводок ${result.scenes}, мест в библиотеку ${result.places}${created.length ? `, новых персонажей ${created.length}` : ''}`);
      return result;
    },
  };
}
