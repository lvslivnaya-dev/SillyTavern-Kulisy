/**
 * Keeping things from piling up. Chats collect objects that mattered once (a cup, a
 * cigarette, a borrowed pen). An ordinary thing the story has not touched for a while
 * goes "into the shade": it is kept, but neither sent to the narrator nor listed for
 * the chronicler. If a reply names it again, the chronicler finds it by name.
 *
 * In the shade: put there by hand (any thing), or forgotten — importance "normal", not
 * locked, last changed by a reply (or brought back by hand) more than `after` messages
 * ago, and not named in those messages. Things added by hand or from the library (no
 * reply touched them) are never forgotten that way. Switched-off things are not here.
 */

/** itemId → index of the last message whose analysis touched it. */
export function lastTouched(state) {
  const map = new Map();
  for (const operation of state.operations ?? []) {
    if (!Number.isInteger(operation.messageIndex)) continue;
    const id = operation.payload?.itemId ?? (operation.type === 'item.add' ? operation.payload?.item?.id : null);
    if (id && (map.get(id) ?? -1) < operation.messageIndex) map.set(id, operation.messageIndex);
  }
  return map;
}

/** IDs of the things in the shade now. `after` 0 = never. */
export function dormantItemIds(state, chat, { after = 40 } = {}) {
  const byHand = (state.world?.items ?? []).filter(item => item.shade && !item.off).map(item => item.id);
  const limit = Math.round(Number(after));
  if (!Number.isFinite(limit) || limit <= 0) return byHand;
  const length = chat?.length ?? 0;
  const since = length - limit;
  if (since <= 0) return byHand;
  const touched = lastTouched(state);
  for (const item of state.world?.items ?? []) {
    if (Number.isInteger(item.activeSince) && (touched.get(item.id) ?? -1) < item.activeSince) touched.set(item.id, item.activeSince);
  }
  const recent = (chat ?? []).slice(since).map(message => String(message?.mes ?? '')).join('\n').toLocaleLowerCase('ru-RU');
  return (state.world?.items ?? [])
    .filter(item => item.importance === 'normal' && !item.locked && !item.off && !item.shade)
    .filter(item => touched.has(item.id) && touched.get(item.id) < since)
    .filter(item => {
      const name = item.name.toLocaleLowerCase('ru-RU');
      // Each longer word counts on its own, without its ending: «кожаный кошелёк» is named by «кошелёк», «кошелька».
      const stems = name.split(/\s+/).filter(word => word.length >= 5).map(word => word.slice(0, -2));
      return !(name.length >= 3 && recent.includes(name)) && !stems.some(stem => recent.includes(stem));
    })
    .map(item => item.id)
    .concat(byHand);
}
