/**
 * The wardrobe as the Studio uses it: kept in the extension settings (it outlives
 * every chat), pictures on the server (wardrobe-images.js), descriptions from a
 * model that sees pictures (vision.js). Putting cards on a character is a chat
 * change: a journaled `wardrobe.set` with the card IDs and the outfit line they make.
 */
import {
  addCard, addLook, addToWorn, composeOutfit, createOperation, emptyWardrobe, normalizeWardrobe, removeCard, removeLook,
  uniqueId, updateCard, updateLook,
} from '../core/index.js';
import { describePrompt, parseDescription } from './vision.js';

/** settings.wardrobe, repaired once per session and cached. */
export function createWardrobeStore({ settings, save, onChange }) {
  let cache = null;
  return {
    get() {
      if (!cache) {
        try { cache = normalizeWardrobe(settings().wardrobe); }
        catch (error) { console.error('[Kulisy] Wardrobe could not be read; starting empty.', error); cache = emptyWardrobe(); }
      }
      return cache;
    },
    set(next) {
      cache = normalizeWardrobe(next);
      settings().wardrobe = cache;
      save();
      // The Studio reads a snapshot: without this it keeps showing the card as it was.
      try { onChange?.(); } catch (error) { console.error('[Kulisy] Wardrobe change listener failed.', error); }
      return cache;
    },
  };
}

const PLACEHOLDER = 'Новая карточка';

function meta(reason) {
  return { transactionId: uniqueId('manual'), reason, timestamp: new Date().toISOString() };
}

/**
 * deps: { store, getState(), commitOperations(ops), confirm(title, text) → boolean,
 *         upload(dataUrl, name) → path, removeImage(path), imageForModel(path) → dataUrl,
 *         ask(dataUrl, prompt) → model text, log(level, text, error) }
 */
export function createWardrobeCallbacks(deps) {
  const { store, getState, commitOperations } = deps;
  const nameOf = id => getState().entities?.[id]?.name ?? id;
  const cardOf = cardId => {
    const card = store.get().cards.find(candidate => candidate.id === cardId);
    if (!card) throw new Error('Такой карточки уже нет.');
    return card;
  };

  async function forgetImage(path) {
    if (!path) return;
    try { await deps.removeImage(path); }
    catch (error) { deps.log?.('warn', 'Старая картинка гардероба не удалилась с сервера', error); }
  }

  /** Ask the model about a card's picture and fill what is empty (or everything with `overwrite`). */
  async function describe(cardId, { overwrite = false, adoptSection = false } = {}) {
    const card = cardOf(cardId);
    if (!card.image) throw new Error('У карточки нет картинки: опишите её вручную.');
    // The section decides what may be described: a hairstyle card never gets the necklace.
    const answer = parseDescription(await deps.ask(await deps.imageForModel(card.image), describePrompt(adoptSection ? null : card.category, { placement: card.placement })));
    if (!answer.description && !answer.name) throw new Error('Модель ничего не описала. Видит ли она картинки?');
    const fresh = cardOf(cardId);
    const changes = {};
    if (answer.description && (overwrite || !fresh.description)) changes.description = answer.description;
    // A name typed by hand is never replaced; the model's own (or a placeholder) is.
    if (answer.name && (!fresh.name || fresh.autoName || fresh.name === PLACEHOLDER)) { changes.name = answer.name; changes.autoName = true; }
    if (adoptSection && answer.category) changes.category = answer.category;
    if (adoptSection && answer.gender) changes.gender = answer.gender;
    if (Object.keys(changes).length) store.set(updateCard(store.get(), cardId, changes));
    return cardOf(cardId);
  }

  /** wardrobe.set for one character from a set of cards (the outfit line follows the cards). */
  function wearOperation(entityId, cardIds, reason) {
    const outfit = composeOutfit(store.get(), cardIds);
    return createOperation('wardrobe.set', { entityId, outfit, cardIds }, meta(reason));
  }

  return {
    onWardrobeGet: () => store.get(),

    /** fields + optional imageDataUrl; `describe`: ask the model right away (section too, when the user left it). */
    onWardrobeAddCard: async ({ imageDataUrl = '', describe: describeNow = false, adoptSection = false, ...fields }) => {
      const image = imageDataUrl ? await deps.upload(imageDataUrl, uniqueId('wear')) : '';
      let card;
      try {
        const result = addCard(store.get(), { ...fields, image });
        store.set(result.wardrobe);
        card = result.card;
      } catch (error) {
        await forgetImage(image);
        throw error;
      }
      if (describeNow && image) {
        try { return await describe(card.id, { adoptSection }); }
        catch (error) { deps.log?.('warn', 'Карточка добавлена, но описать картинку не вышло', error); throw new Error(`Карточка добавлена, но описать картинку не вышло: ${error.message}`); }
      }
      return card;
    },
    onWardrobeUpdateCard: ({ cardId, changes }) => {
      const { image: _ignored, ...rest } = changes ?? {}; // pictures change through onWardrobeSetImage
      store.set(updateCard(store.get(), cardId, rest));
      return cardOf(cardId);
    },
    onWardrobeSetImage: async ({ cardId, imageDataUrl }) => {
      const old = cardOf(cardId).image ?? '';
      const image = await deps.upload(imageDataUrl, uniqueId('wear'));
      store.set(updateCard(store.get(), cardId, { image }));
      await forgetImage(old);
      return cardOf(cardId);
    },
    onWardrobeRemoveImage: async ({ cardId }) => {
      const old = cardOf(cardId).image ?? '';
      store.set(updateCard(store.get(), cardId, { image: '' }));
      await forgetImage(old);
      return cardOf(cardId);
    },
    onWardrobeDescribe: ({ cardId, overwrite = true }) => describe(cardId, { overwrite }),
    /** Remove a card everywhere: from looks, from whoever wears it in the open chat, its picture from the server. */
    onWardrobeRemoveCard: async ({ cardId }) => {
      const card = cardOf(cardId);
      const ok = await deps.confirm('Удалить карточку', `«${card.name || 'Без названия'}» будет удалена из гардероба вместе с картинкой. Те, кто носит её в открытом чате, останутся в той же одежде на словах. Продолжить?`);
      if (!ok) return false;
      const result = removeCard(store.get(), cardId);
      store.set(result.wardrobe);
      const wearers = Object.entries(getState().world?.wardrobe ?? {}).filter(([, entry]) => entry.cardIds?.includes(cardId));
      if (wearers.length) {
        await commitOperations(wearers.map(([entityId, entry]) => createOperation('wardrobe.set',
          { entityId, cardIds: entry.cardIds.filter(id => id !== cardId) }, meta(`Карточка гардероба удалена: ${card.name}`))));
      }
      await forgetImage(result.image);
      return true;
    },

    onWardrobeAddLook: ({ shelf, name, cardIds }) => {
      const { wardrobe, look } = addLook(store.get(), { shelf, name, cardIds });
      store.set(wardrobe);
      return look;
    },
    onWardrobeUpdateLook: ({ lookId, changes }) => { store.set(updateLook(store.get(), lookId, changes)); },
    onWardrobeRemoveLook: ({ lookId }) => { store.set(removeLook(store.get(), lookId)); },

    /**
     * Put cards on a character of this chat. mode 'replace' (default) dresses them in
     * exactly these cards; 'add' puts the cards on over what they wear.
     */
    onWear: async ({ entityId, cardIds = [], lookId = '', mode = 'replace' }) => {
      if (!getState().entities?.[entityId]) throw new Error('Персонаж не найден.');
      const look = lookId ? store.get().looks.find(candidate => candidate.id === lookId) : null;
      if (lookId && !look) throw new Error('Такого образа уже нет.');
      const picked = look ? look.cardIds : cardIds;
      if (!picked.length) throw new Error('Выберите карточки или образ.');
      const current = getState().world?.wardrobe?.[entityId]?.cardIds ?? [];
      const ids = mode === 'add' ? addToWorn(current, picked) : addToWorn([], picked);
      return commitOperations([wearOperation(entityId, ids, `${nameOf(entityId)} надевает: ${look ? look.name : composeOutfit(store.get(), picked)}`)]);
    },
    onTakeOff: async ({ entityId, cardId }) => {
      const current = getState().world?.wardrobe?.[entityId]?.cardIds ?? [];
      if (!current.includes(cardId)) return undefined;
      const card = store.get().cards.find(candidate => candidate.id === cardId);
      return commitOperations([wearOperation(entityId, current.filter(id => id !== cardId), `${nameOf(entityId)} снимает: ${card?.name || 'вещь'}`)]);
    },
  };
}
