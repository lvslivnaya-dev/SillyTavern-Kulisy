import { LEGACY_METADATA_KEY, METADATA_KEY } from './settings.js';

/**
 * Chat-bound storage. Every save is immediate: SillyTavern's clearChat() calls
 * cancelDebouncedMetadataSave() on chat exit, which silently discards any
 * pending debounced metadata write — debounced persistence loses data on
 * chat switch, so all commits must flush synchronously.
 */
export function createChatStorage(contextProvider, createState, normalizeState) {
  function context() {
    const value = contextProvider();
    if (!value) throw new Error('SillyTavern context is unavailable.');
    return value;
  }

  function load() {
    try {
      const ctx = context();
      const raw = ctx.chatMetadata?.[METADATA_KEY];
      if (raw) return normalizeState(structuredClone(raw));
      // A chat started under Relationship Engine: adopt a copy of its state.
      // Its own key stays untouched; Kulisy saves only under METADATA_KEY.
      const legacy = ctx.chatMetadata?.[LEGACY_METADATA_KEY];
      if (legacy) {
        try {
          return normalizeState(structuredClone(legacy));
        } catch (error) {
          console.warn('[Kulisy] Relationship Engine state could not be adopted.', error);
        }
      }
      return createState();
    } catch (error) {
      console.error('[Kulisy] Failed to load chat state.', error);
      return createState();
    }
  }

  async function save(state) {
    const checked = normalizeState(structuredClone(state));
    const ctx = context();
    ctx.chatMetadata[METADATA_KEY] = checked;
    await ctx.saveMetadata();
    return checked;
  }

  async function clear() {
    const ctx = context();
    delete ctx.chatMetadata[METADATA_KEY];
    await ctx.saveMetadata();
  }

  return { load, save, clear };
}
