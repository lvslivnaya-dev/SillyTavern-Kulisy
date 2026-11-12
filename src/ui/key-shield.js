/**
 * Keys typed inside Kulisy's windows must stay inside them.
 *
 * SillyTavern listens to keys on the whole page: with the message box empty, the right arrow SWIPES the last reply (a new
 * generation!), Ctrl+Enter regenerates it, Ctrl+Up edits the last post. It skips that only when a text field has focus, but
 * it looks with `:focus`, and a field inside a shadow root is not seen: the page reports the shadow host as focused. So an arrow
 * key pressed to move the cursor in one of our fields reached SillyTavern and regenerated the reply.
 *
 * The shield stops such a key at the edge of our shadow root: every key typed in a field, and the left and right arrows anywhere in the
 * window. Escape and Tab are let through (Kulisy's own handler and SillyTavern's popups use them).
 */
const PASS = new Set(['Escape', 'Tab']);
// SillyTavern swipes on these even when focus is on a button of ours (it cannot see the focus inside the shadow root at all).
const SWIPE_KEYS = new Set(['ArrowLeft', 'ArrowRight']);

const isField = node => Boolean(node) && (node.nodeName === 'INPUT' || node.nodeName === 'TEXTAREA' || node.nodeName === 'SELECT' || node.isContentEditable === true);

export function shieldKeys(shadow) {
  const stop = event => {
    if (PASS.has(event.key)) return;
    if (SWIPE_KEYS.has(event.key) || isField(event.composedPath?.()[0] ?? event.target)) event.stopPropagation();
  };
  shadow.addEventListener('keydown', stop);
  shadow.addEventListener('keyup', stop);
  return () => { shadow.removeEventListener('keydown', stop); shadow.removeEventListener('keyup', stop); };
}
