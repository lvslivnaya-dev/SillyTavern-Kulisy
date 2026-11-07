/**
 * Lorebook secrets: entries the characters must not know by default.
 *
 * An entry becomes a secret by its title (the "Memo" field, never sent to the
 * model): `[Секрет] Шрамы` or `[Секрет: Риндо, Санзу] Шрамы` (`[Secret]` works
 * too). Kulisy takes such entries out of SillyTavern's world info and hands
 * them to its knowledge block instead: the characters who know get the text,
 * the others are told they do not know it, and when nobody in the scene knows,
 * nothing about it is sent at all.
 *
 * In the journal a lore secret is an ordinary knowledge event with
 *   lore:   { book, uid }   — where it comes from (one event per entry);
 *   detail: the entry text  — what the characters who know it get;
 *   text:   a short label   — what the others are told they do not know.
 */

const MARK = /^\s*\[\s*(?:секрет|secret)\s*(?::\s*([^\]]*))?\]\s*(.*)$/iu;

export const LORE_SECRET_LIMITS = Object.freeze({ title: 200, detail: 1500, names: 20 });

/** The entry text as the journal keeps it: line breaks stay, runs of spaces and empty lines shrink. */
export function cleanSecretText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, LORE_SECRET_LIMITS.detail);
}

/** { title, names } of a secret title, or null when the title has no mark. names: [] = Kulisy works them out. */
export function parseSecretMark(comment) {
  const match = MARK.exec(String(comment ?? ''));
  if (!match) return null;
  const names = [...new Set(String(match[1] ?? '').split(/[,;]/).map(name => name.trim()).filter(Boolean))].slice(0, LORE_SECRET_LIMITS.names);
  // «[Секрет]: шрамы», «[Секрет] — шрамы»: the separator is not part of the title.
  return { title: match[2].replace(/^[\s:;.,—–-]+/u, '').trim().slice(0, LORE_SECRET_LIMITS.title), names };
}

export function isSecretEntry(entry) {
  return Boolean(entry) && parseSecretMark(entry.comment) !== null;
}

/** Enabled secret entries of a book: [{ book, uid, title, names, content }]. */
export function secretEntriesOf(book, bookName) {
  return Object.values(book?.entries ?? {}).flatMap(entry => {
    if (!entry || entry.disable || typeof entry.content !== 'string' || !entry.content.trim()) return [];
    const mark = parseSecretMark(entry.comment);
    if (!mark) return [];
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : '';
    return [{ book: String(bookName), uid: String(entry.uid), title: mark.title || keys || 'Секрет', names: mark.names, content: entry.content.trim() }];
  });
}

/**
 * Remove secret entries from the lists SillyTavern is about to scan
 * (the WORLDINFO_ENTRIES_LOADED payload). Lists are edited in place, because
 * SillyTavern keeps using the same arrays. Returns how many were removed.
 */
export function stripSecretEntries(lists) {
  let removed = 0;
  for (const list of Object.values(lists ?? {})) {
    if (!Array.isArray(list)) continue;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (isSecretEntry(list[index])) { list.splice(index, 1); removed += 1; }
    }
  }
  return removed;
}

/** The journal event of a lore entry, or null. */
export function loreSecretEvent(state, book, uid) {
  return (state.knowledge?.events ?? []).find(event => event.lore?.book === String(book) && event.lore?.uid === String(uid)) ?? null;
}
