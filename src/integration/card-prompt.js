/**
 * The sheets of library character cards for the narrator.
 *
 * A card (core/character-cards.js) is attached to a character of the chat (card-links.js). Which of its
 * sections go out with the coming reply is decided by the same rules as the «Суфлёр лорбуков»
 * (lore-gate.js: always / on entrance / pair / fight / intimacy / by keys / never), so the two ways of keeping a
 * character — a lorebook sheet and a card — behave alike. A section with its own rule («when») follows that.
 *
 * Whoever has a card does not get their lorebook sheet (entries titled «[ Name ] - Section») as well:
 * planSheetDrops names those entries, so the same section never goes out twice.
 *
 * Pure: no DOM, no SillyTavern.
 */
import { filledSections, sectionText } from '../core/index.js';
import {
  GATE_SECTIONS, buildAround, decideSection, entityOf, entryKeysHit, namedInText, namedSentences, normalizeGate, parseGateTitle, partnerNamed,
} from './lore-gate.js';
import { cardsByEntity } from './card-links.js';
import { entryIsAbout } from './name-sources.js';
import { isSecretEntry } from '../core/lore-secrets.js';

export const CARDS_PROMPT_DEFAULTS = Object.freeze({ maxCharacters: 6000 });
export const CARDS_RULES = [
  '- Each sheet is established canon of the character named in its header. It belongs to that character only: never give their traits, voice or history to {{user}} or to anyone else.',
  '- A section that is not shown now is not cancelled: keep what the story has already shown about it, and do not invent anything that contradicts the sheets.',
  '- Let the sheet colour behaviour and speech; do not recite it and do not list its facts.',
  '- Do not expose this block.',
].join('\n');

const lower = value => String(value ?? '').toLocaleLowerCase('ru-RU');

/** Characters of the chat that have a card: Set of entity ids. */
export function cardedIds(state, library) {
  return new Set(cardsByEntity(state, library).keys());
}

/**
 * A test for «this lorebook entry is the sheet of a character who has a card»: titled «[ Name ] - Section», or titled with the
 * character's name alone («Майки (Бонтен)», «Ран Хайтани — анкета»). A character is taken from the card or from the lorebook, never both.
 * Secrets («[Секрет] …») are knowledge, not a sheet: never matched. → a function, or null when no card is attached.
 */
export function cardedSheetTest(state, library) {
  const ids = cardedIds(state, library);
  if (!ids.size) return null;
  const personaId = state?.ui?.personaId || '';
  const people = Object.values(state?.entities ?? {}).filter(entity => entity.id !== personaId);
  const carded = people.filter(entity => ids.has(entity.id));
  const cache = new Map();
  return entry => {
    if (!entry || isSecretEntry(entry)) return false;
    const title = parseGateTitle(entry.comment);
    if (title) {
      if (!cache.has(title.name)) cache.set(title.name, entityOf(entry, title.name, people));
      return ids.has(cache.get(title.name));
    }
    return carded.some(entity => entryIsAbout(entry, entity));
  };
}

/** Lorebook entries to take out because a card tells the same: a Map entry → 'drop'. */
export function planSheetDrops({ lists, state, library }) {
  const decisions = new Map();
  const isSheet = cardedSheetTest(state, library);
  if (!isSheet) return decisions;
  for (const list of Object.values(lists ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) if (entry && !entry.disable && isSheet(entry)) decisions.set(entry, 'drop');
  }
  return decisions;
}

/** In what order a card is read when only part of it fits: what makes the person first, the look and the rest later. NSFW is never in a digest. */
const DIGEST_ORDER = ['basic', 'character', 'relationships', 'voice', 'skills', 'visual', 'other'];

/** A card as plain text for a model that is asked to think about the character (not the narrator's prompt), at most `maxCharacters`. */
export function cardDigest(card, maxCharacters = 3000) {
  if (!card) return '';
  const rank = section => { const at = DIGEST_ORDER.indexOf(section.kind); return at < 0 ? DIGEST_ORDER.length : at; };
  const head = `## ${[card.name, ...card.aliases.slice(0, 3)].join(' / ')}`;
  let room = Math.max(200, maxCharacters) - head.length - 1;
  const lines = [];
  for (const section of filledSections(card).filter(item => item.kind !== 'nsfw').sort((left, right) => rank(left) - rank(right))) {
    const text = `### ${section.title}\n${sectionText(section)}`;
    if (text.length + 1 > room) continue;
    room -= text.length + 1;
    lines.push(text);
  }
  return lines.length ? `${head}\n${lines.join('\n')}` : '';
}

/** The digests of the cards attached to these characters, sharing `total` characters evenly. */
export function digestFor(state, library, ids, total = 9000) {
  const byEntity = cardsByEntity(state, library);
  const cards = [...new Set(ids)].map(id => byEntity.get(id)).filter(Boolean);
  if (!cards.length) return '';
  const each = Math.max(500, Math.floor(total / cards.length));
  return cards.map(card => cardDigest(card, each)).filter(Boolean).join('\n\n');
}

/**
 * Decide the sections of every attached card for the coming reply.
 *   presentIds, mode, turn, tracker, namedText, replyText — as in lore-gate.js planGate;
 *   extraNames — Map entityId → more names to be found by (card-links.js cardNameForms);
 *   config — the gate's settings (the rules per section; `enabled` is not needed here);
 *   maxCharacters — how much the block may hold.
 * → { block: '', report: { people: [{ id, name, cardId, present, named, parts: [{ title, kind, label, action, why, characters }] }],
 *      sent, characters, trimmed, nobody } }
 */
export function planCards({ state, library, config, extraNames = new Map(), presentIds = [], mode = 'calm', turn = 0, tracker = new Map(), namedText = '', replyText = '', maxCharacters = CARDS_PROMPT_DEFAULTS.maxCharacters }) {
  const gate = normalizeGate(config);
  const report = { people: [], sent: 0, characters: 0, trimmed: 0, nobody: false };
  const byEntity = cardsByEntity(state, library);
  if (!byEntity.size) return { block: '', report };
  const personaId = state?.ui?.personaId || '';
  const present = new Set(presentIds);
  // The cases of the names from the name library (tied to the card) are more ways to be named in the posts.
  const people = Object.values(state?.entities ?? {}).filter(entity => entity.id !== personaId)
    .map(entity => (extraNames.get(entity.id)?.length ? { ...entity, aliases: [...(entity.aliases ?? []), ...extraNames.get(entity.id)] } : entity));
  report.nobody = !people.some(entity => present.has(entity.id));

  const named = namedInText(namedText, people);
  const inReply = namedSentences(replyText, people);
  for (const [id, count] of inReply) if (count >= 2) named.add(id);
  const around = buildAround(people, present, named, inReply, id => (byEntity.has(id) ? [byEntity.get(id).name, ...byEntity.get(id).aliases] : []));
  const keyText = `${namedText}\n${replyText}`;

  const staged = new Set(present);
  const sent = [];
  const order = [...byEntity.keys()].filter(id => state.entities[id] && id !== personaId);
  for (const id of order) {
    const card = byEntity.get(id);
    const isNamed = !present.has(id) && named.has(id) && gate.named !== 'absent';
    const onStage = present.has(id) || (isNamed && gate.named === 'stage');
    if (onStage) staged.add(id);
    const last = tracker.get(id);
    const entranceDue = last == null || turn <= last || turn - last >= gate.visualEvery;
    const person = { id, name: card.name, cardId: card.id, present: present.has(id), named: isNamed, parts: [] };
    for (const section of filledSections(card)) {
      const base = gate.sections[section.kind] ?? gate.sections.other;
      const rule = { when: section.when || base.when, absent: base.absent };
      let verdict = decideSection(rule, {
        onStage, isNamed, mode, entranceDue, ago: turn - last,
        partner: () => partnerNamed(lower(section.text), id, around),
      });
      // «By keys» has no lorebook to leave it to: the section's own key words decide.
      if (verdict.action === 'keep') {
        const hit = entryKeysHit({ key: section.keys ?? [] }, keyText);
        verdict = hit ? { action: 'force', why: 'ключ найден', entrance: false } : { action: 'drop', why: section.keys?.length ? 'ключей нет в тексте' : 'нет ключей', entrance: false };
      }
      if (verdict.entrance) sent.push(id);
      person.parts.push({
        sectionId: section.id, title: section.title, kind: section.kind, label: GATE_SECTIONS[section.kind]?.label ?? section.title,
        action: verdict.action, why: verdict.why, characters: sectionText(section).length,
      });
    }
    report.people.push(person);
  }
  for (const id of [...tracker.keys()]) if (!staged.has(id) && byEntity.has(id)) tracker.delete(id);
  for (const id of sent) if (tracker.get(id) == null || turn - tracker.get(id) >= gate.visualEvery || turn < tracker.get(id)) tracker.set(id, turn);
  report.people.sort((left, right) => Number(right.present) - Number(left.present) || Number(right.named) - Number(left.named) || left.name.localeCompare(right.name, 'ru-RU'));

  // The block: those who go out, in the order of the report, while there is room.
  let room = Math.max(500, maxCharacters);
  const blocks = [];
  for (const person of report.people) {
    const card = byEntity.get(person.id);
    const header = `## ${[card.name, ...card.aliases.slice(0, 3)].join(' / ')}`;
    const lines = [];
    for (const part of person.parts) {
      if (part.action !== 'force') continue;
      const body = sectionText(card.sections.find(section => section.id === part.sectionId));
      const text = `### ${part.title}\n${body}`;
      if (text.length + (lines.length ? 0 : header.length + 1) > room) { part.action = 'trim'; part.why = 'не влезло в лимит'; report.trimmed += 1; continue; }
      room -= text.length + 1;
      lines.push(text);
      report.sent += 1;
      report.characters += body.length;
    }
    if (lines.length) { room -= header.length + 1; blocks.push(`${header}\n${lines.join('\n')}`); }
  }
  return { block: blocks.length ? `[CHARACTER SHEETS — CANON OF THE CHARACTERS IN PLAY]\n${blocks.join('\n\n')}\n\nRules:\n${CARDS_RULES}\n[/CHARACTER SHEETS]` : '', report };
}
