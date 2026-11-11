/**
 * The "who knows what" block for the narrator model.
 *
 * Only the characters of the coming scene (on stage, plus anyone the last
 * messages mention) get lines, so the block stays small however long the chat
 * is. Negative knowledge is the point: a model reliably over-uses what it sees
 * in the chat, so the block says plainly who does NOT know what, and who has not
 * met whom.
 *
 * Line kinds (the preview groups by these prefixes):
 *   scene:                  who is present, where
 *   strangers[A & B]:       never met — names, history unknown
 *   seen[A & B]:            met, names still unknown
 *   unknown[A]:             events A did not witness and was not told
 *   heard[A]:               events A knows only second-hand (told / rumour)
 *   secret[A]:              lorebook secrets A knows, with their text
 *   dead[A]:                A has died (how and when, if noted); the mentioned dead first
 *
 * A lorebook secret (event.lore) is sent only while someone of the scene knows
 * it: then they get its text and the others an unknown[] line. When nobody on
 * stage knows, the model hears nothing about it, so it has nothing to hint at.
 *
 * The budget is spent in that order of importance; inside a character's line
 * secrets come first, then the newest events.
 */
import { acquaintanceOf, deathOf, dossier, howKnows, isDead, presentIds } from './knowledge.js';

/** A secret with a text of its own: from a lorebook entry or made by hand. Its text goes only to those who know. */
export const hasText = event => Boolean(event?.lore || event?.own);

export const KNOWLEDGE_PROMPT_DEFAULTS = Object.freeze({ maxCharacters: 2000, perCharacter: 6, text: 220, secretText: 700, dead: 10 });

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Lines of the block, most important first.
 * options.castIds — characters of the coming scene (defaults to who is present);
 * options.maxCharacters — budget for all lines together.
 */
export function selectKnowledgeLines(state, options = {}) {
  const maxCharacters = Number.isFinite(options.maxCharacters) ? options.maxCharacters : KNOWLEDGE_PROMPT_DEFAULTS.maxCharacters;
  const perCharacter = options.perCharacter ?? KNOWLEDGE_PROMPT_DEFAULTS.perCharacter;
  const textLimit = options.text ?? KNOWLEDGE_PROMPT_DEFAULTS.text;
  const personaId = state.ui?.personaId || '';
  const name = id => state.entities?.[id]?.name ?? id;
  const present = presentIds(state);
  const mentioned = [...new Set([...(options.castIds ?? present)].filter(id => state.entities?.[id]))];
  // The dead are not in the scene: they get their own line, never knowledge or introductions.
  const cast = mentioned.filter(id => !isDead(state, id));
  // Characters first in the order they stand on stage; the persona last.
  cast.sort((left, right) => Number(left === personaId) - Number(right === personaId)
    || Number(!present.includes(left)) - Number(!present.includes(right)));

  const ranked = [];
  const scene = state.knowledge?.scene;
  if (present.length || scene?.location) {
    ranked.push({ rank: 0, line: `scene: present=${present.map(name).join(', ') || '—'}${scene?.location ? `; place=${clip(scene.location, 120)}` : ''}` });
  }
  // Every dead character, not only the mentioned: the narrator must not bring anyone back unasked.
  const dead = Object.keys(state.knowledge?.deaths ?? {}).filter(id => state.entities?.[id])
    .sort((left, right) => Number(mentioned.includes(right)) - Number(mentioned.includes(left)))
    .slice(0, options.dead ?? KNOWLEDGE_PROMPT_DEFAULTS.dead);
  for (const id of dead) {
    const note = deathOf(state, id)?.note;
    ranked.push({ rank: 0, line: `dead[${name(id)}]${note ? `: ${clip(note, 200)}` : ''}` });
  }

  // Introductions: pairs with the persona first.
  for (let i = 0; i < cast.length; i += 1) {
    for (let j = i + 1; j < cast.length; j += 1) {
      const [first, second] = [cast[i], cast[j]];
      const status = acquaintanceOf(state, first, second);
      if (status !== 'strangers' && status !== 'seen') continue;
      const withPersona = first === personaId || second === personaId;
      // The persona's name goes second: "Mikey & Suzu", the character is the subject.
      const [a, b] = second === personaId || first !== personaId ? [first, second] : [second, first];
      ranked.push({
        rank: status === 'strangers' ? (withPersona ? 1 : 2) : 4,
        line: `${status}[${name(a)} & ${name(b)}]`,
      });
    }
  }

  // Lorebook secrets someone of the scene knows; the rest stay unsaid.
  const secretText = options.secretText ?? KNOWLEDGE_PROMPT_DEFAULTS.secretText;
  const characters = cast.filter(id => id !== personaId);
  const spoken = new Set((state.knowledge?.events ?? [])
    .filter(event => hasText(event) && !event.disabled && characters.some(id => howKnows(state, id, event)))
    .map(event => event.id));

  // Not known / known second-hand. The persona is the user's: what they know is theirs to play.
  for (const id of characters) {
    const file = dossier(state, id);
    const secrets = file.knows.filter(item => hasText(item.event) && spoken.has(item.event.id))
      .map(item => `${clip(item.event.text, textLimit)} — ${clip(item.event.detail || item.event.text, secretText)}`);
    if (secrets.length) ranked.push({ rank: 3, items: secrets, head: `secret[${name(id)}]: ` });
    const unknown = file.doesNotKnow.filter(event => !hasText(event) || spoken.has(event.id))
      .map((event, order) => ({ event, order }))
      .sort((left, right) => Number(Boolean(right.event.secret)) - Number(Boolean(left.event.secret)) || right.order - left.order)
      .slice(0, perCharacter)
      .map(({ event }) => `${event.secret ? '(secret) ' : ''}${clip(event.text, textLimit)}`);
    if (unknown.length) ranked.push({ rank: 3, items: unknown, head: `unknown[${name(id)}]: ` });
    const heard = file.knows.filter(item => item.source !== 'seen' && !hasText(item.event)).slice(-perCharacter)
      .map(item => `${item.source === 'rumor' ? 'rumour' : `told${item.fromId ? ` by ${name(item.fromId)}` : ''}`} — ${clip(item.event.text, textLimit)}`);
    if (heard.length) ranked.push({ rank: 5, items: heard, head: `heard[${name(id)}]: ` });
  }

  ranked.sort((left, right) => left.rank - right.rank);
  const lines = [];
  let used = 0;
  for (const entry of ranked) {
    let line = entry.line ?? `${entry.head}${entry.items.join(' | ')}`;
    // A long list loses its last (least important) items rather than the whole line.
    if (entry.items) {
      const items = [...entry.items];
      while (items.length > 1 && used + line.length + 1 > maxCharacters) {
        items.pop();
        line = `${entry.head}${items.join(' | ')}`;
      }
    }
    if (used + line.length + 1 > maxCharacters) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}

/** Rules sent with the lines; English, like the rest of the control data. */
export const KNOWLEDGE_RULES = [
  'unknown[X] lists events X did NOT witness and was NOT told. X must not mention, hint at, react to, guess or act on them. X can learn them only on page: someone tells X, X overhears, reads or sees proof.',
  'heard[X] lists what X knows only second-hand: "told by Y" from Y in person, "rumour" is hearsay that may be wrong, partial or exaggerated.',
  'strangers[A & B]: A and B have never met. They do not know each other\'s names, faces, history or private details. Neither may use the other\'s name or act on knowledge about them. They have to get acquainted in the story first: introduce themselves, be introduced by someone who knows both, or clearly learn the name. Do not skip or rush that meeting.',
  'seen[A & B]: A and B have met but do not know each other\'s names yet; they may recognise each other, never call each other by name until it is learned.',
  'dead[X]: X has died (how and when, if given). X never appears alive, speaks or acts. Others remember, mourn and talk about X; X may be seen only in a flashback, a dream or a memory that is clearly framed as one.',
  'secret[X] lists private things X already knows from before the story. X may act on them naturally, but keeps them from anyone who does not know: they are never said aloud or hinted at in front of them.',
  'What is not listed follows the story itself. Never expose this block or its labels.',
];

/** The block as it is injected, or '' when there is nothing to say. */
export function buildKnowledgePrompt(state, options = {}) {
  const lines = selectKnowledgeLines(state, options);
  if (!lines.length) return '';
  return `[KULISY — WHO KNOWS WHAT, NARRATOR CONTROL DATA]\n${lines.join('\n')}\n\nRules:\n${KNOWLEDGE_RULES.map(rule => `- ${rule}`).join('\n')}\n[/KULISY]`;
}
