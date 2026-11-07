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
import { newTreeFiles, placeFromPath, treeDirFor } from './wardrobe-inbox.js';

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

  /**
   * A picture of the folder tree «Гардероб» lies in its card's section folder: when the card
   * changes shelf, gender or section, the file moves too (deps.relocate). Other pictures stay.
   */
  async function settle(cardId) {
    const card = store.get().cards.find(candidate => candidate.id === cardId);
    if (!card?.image || !deps.relocate || !deps.isTreeImage?.(card.image)) return card;
    const dir = treeDirFor(card);
    if (deps.treeDirOf?.(card.image) === dir) return card;
    try {
      const image = await deps.relocate(card.image, dir);
      if (image && image !== card.image) store.set(updateCard(store.get(), cardId, { image }));
    } catch (error) {
      deps.log?.('warn', `Картинка карточки не переложилась в папку «${dir}»`, error);
    }
    return store.get().cards.find(candidate => candidate.id === cardId);
  }

  /** Ask the model about a card's picture and fill what is empty (or everything with `overwrite`). */
  // descriptionOnly: only the description changes — the name, section and gender stay.
  // adoptGender (default: with adoptSection): may the model change the gender too — not when a folder already said it.
  async function describe(cardId, { overwrite = false, adoptSection = false, adoptGender = adoptSection, descriptionOnly = false } = {}) {
    const card = cardOf(cardId);
    if (!card.image) throw new Error('У карточки нет картинки: опишите её вручную.');
    // The section decides what may be described: a hairstyle card never gets the necklace.
    const answer = parseDescription(await deps.ask(await deps.imageForModel(card.image), describePrompt(adoptSection ? null : card.category, { placement: card.placement })));
    if (!answer.description && !answer.name) throw new Error('Модель ничего не описала. Видит ли она картинки?');
    const fresh = cardOf(cardId);
    const changes = {};
    if (answer.description && (overwrite || !fresh.description)) changes.description = answer.description;
    // A name typed by hand is never replaced; the model's own (or a placeholder) is.
    if (!descriptionOnly && answer.name && (!fresh.name || fresh.autoName || fresh.name === PLACEHOLDER)) { changes.name = answer.name; changes.autoName = true; }
    if (adoptSection && answer.category) changes.category = answer.category;
    if (adoptGender && answer.gender) changes.gender = answer.gender;
    if (Object.keys(changes).length) store.set(updateCard(store.get(), cardId, changes));
    if (changes.category || changes.gender) await settle(cardId);
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
      const image = imageDataUrl ? await deps.upload(imageDataUrl, uniqueId('wear'), fields) : '';
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
    onWardrobeUpdateCard: async ({ cardId, changes }) => {
      const { image: _ignored, ...rest } = changes ?? {}; // pictures change through onWardrobeSetImage
      store.set(updateCard(store.get(), cardId, rest));
      if (rest.shelf || rest.gender || rest.category) await settle(cardId);
      return cardOf(cardId);
    },
    onWardrobeSetImage: async ({ cardId, imageDataUrl }) => {
      const old = cardOf(cardId).image ?? '';
      const image = await deps.upload(imageDataUrl, uniqueId('wear'), cardOf(cardId));
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
    /**
     * Pictures dropped into the folder «Гардероб» become cards. The picture stays where it
     * lies: the card points at that file. The folder gives the shelf, gender and section
     * (placeFromPath); with `describe` the model writes the description and fills what the
     * folder left out (then the file moves into that section's folder). Cards are made
     * first, all of them; describing comes after, one by one, a failure never stops the rest.
     * deps.inbox: { list() → [{ path, public }] }; onProgress(done, total, stage).
     * Returns { added, described, failed, undescribed, skipped: [{ path, problem }] } or null when declined.
     */
    onWardrobeImportInbox: async ({ describe: describeNow = false, onProgress = () => {} } = {}) => {
      if (!deps.inbox) throw new Error('Папка для картинок не подключена.');
      const files = newTreeFiles(await deps.inbox.list(), store.get().cards);
      if (!files.length) throw new Error('В папке «Гардероб» нет новых картинок.');
      const placed = files.map(file => ({ ...file, place: placeFromPath(file.path) }));
      const skipped = placed.filter(file => file.place.problem).map(file => ({ path: file.path, problem: file.place.problem }));
      const todo = placed.filter(file => !file.place.problem);
      if (!todo.length) return { added: 0, described: 0, failed: 0, undescribed: 0, skipped };
      const ok = await deps.confirm('Забрать картинки из папки',
        `Новых карточек: ${todo.length}. Картинки останутся в своих папках, карточки будут показывать их оттуда.${describeNow ? ` Модель опишет каждую (${todo.length} запросов, по одному).` : ''} Продолжить?`);
      if (!ok) return null;
      const result = { added: 0, described: 0, failed: 0, undescribed: 0, skipped };
      const made = [];
      for (const [index, file] of todo.entries()) {
        const { shelf, gender, category, name } = file.place;
        try {
          const added = addCard(store.get(), { shelf, gender: gender || 'female', category: category || 'top', name, image: file.public });
          if (!added.card.image) throw new Error('Путь картинки не подошёл.');
          store.set(added.wardrobe);
          made.push({ card: added.card, gender, category, path: file.path });
          result.added += 1;
        } catch (error) {
          result.failed += 1;
          deps.log?.('warn', `Картинка из папки не стала карточкой: ${file.path}`, error);
        }
        try { onProgress(index + 1, todo.length, 'add'); } catch { /* the page may be gone */ }
      }
      if (describeNow) {
        for (const [index, item] of made.entries()) {
          try { onProgress(index + 1, made.length, 'describe'); } catch { /* the page may be gone */ }
          try { await describe(item.card.id, { adoptSection: !item.category, adoptGender: !item.gender }); result.described += 1; }
          catch (error) { result.undescribed += 1; deps.log?.('warn', `Карточка из папки создана, но не описалась: ${item.path}`, error); }
        }
      }
      return result;
    },
    /**
     * Describe these cards again from their pictures, one by one: only the description
     * is rewritten. Cards without a picture are skipped; a failed card does not stop the rest.
     * onProgress(done, total). Returns { done, failed, skipped } or null when declined.
     */
    onWardrobeRedescribe: async ({ cardIds = [], onProgress = () => {} }) => {
      const cards = cardIds.map(id => store.get().cards.find(card => card.id === id)).filter(Boolean);
      const withPicture = cards.filter(card => card.image);
      if (!withPicture.length) throw new Error('В этом разделе нет карточек с картинками.');
      const ok = await deps.confirm('Переписать описания',
        `Модель заново опишет ${withPicture.length} карт. по картинкам (${withPicture.length} запросов). Заменится только описание: название, раздел и пол останутся. Продолжить?`);
      if (!ok) return null;
      let done = 0;
      let failed = 0;
      for (const [index, card] of withPicture.entries()) {
        try { await describe(card.id, { overwrite: true, descriptionOnly: true }); done += 1; }
        catch (error) { failed += 1; deps.log?.('warn', `Описание «${card.name || 'без названия'}» не переписалось`, error); }
        try { onProgress(index + 1, withPicture.length); } catch { /* the page may be gone */ }
      }
      return { done, failed, skipped: cards.length - withPicture.length };
    },
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
    /** Rebuild the outfit line from the cards they wear (an old line, or one edited by hand). */
    onWardrobeRecompose: async ({ entityId }) => {
      const current = getState().world?.wardrobe?.[entityId]?.cardIds ?? [];
      if (!current.length) throw new Error('На персонаже нет карточек гардероба.');
      return commitOperations([wearOperation(entityId, current, `${nameOf(entityId)}: одежда собрана из карточек`)]);
    },
  };
}
