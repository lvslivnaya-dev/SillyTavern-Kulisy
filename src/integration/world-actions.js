/**
 * Hand edits of the scene (clock, place, outfits, conditions, items, chat place
 * cards) and the four answers to a continuity slip. Every edit is an ordinary
 * journaled manual operation, so it shows in the history and survives swipes of
 * other replies; whatever the user writes by hand can be locked against the chronicler.
 */
import { WEATHER_KINDS, WEATHER_KIND_IDS, cleanShifts, stageOf, closingShifts, createOperation, dropOperation, parseTime, questId, questsOf, uniqueId } from '../core/index.js';

function meta(reason) {
  return { transactionId: uniqueId('manual'), reason, timestamp: new Date().toISOString() };
}

/** Reminders for the narrator's next reply only ("Майки всё ещё в форме"). */
export function createReminders() {
  let items = [];
  return {
    add(text) { const value = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300); if (value) items.push(value); },
    list: () => [...items],
    /** Called when the reply they were meant for has arrived. */
    clear() { items = []; },
  };
}

/**
 * deps: { getState(), commitOperations(ops), chat(), saveChat(), markerKey, input(title, text, value) → string|null,
 *         swipe(messageIndex), editMessage(messageIndex), reminders, openStudio(tab, options), refresh() }
 */
export function createWorldCallbacks(deps) {
  const { getState, commitOperations } = deps;
  const run = (type, payload, reason) => commitOperations([createOperation(type, payload, meta(reason))]);
  const nameOf = id => getState().entities?.[id]?.name ?? id;
  const requireCharacter = id => { if (!getState().entities?.[id]) throw new Error('Персонаж не найден.'); };

  function slipOf(messageIndex, slipIndex) {
    const slip = deps.chat()?.[messageIndex]?.extra?.[deps.markerKey]?.slips?.[slipIndex];
    if (!slip) throw new Error('Отметка уже снята.');
    return slip;
  }

  async function dropSlip(messageIndex, slipIndex) {
    const marker = deps.chat()?.[messageIndex]?.extra?.[deps.markerKey];
    if (!marker?.slips?.[slipIndex]) return;
    marker.slips.splice(slipIndex, 1);
    if (!marker.slips.length) delete marker.slips;
    await deps.saveChat();
    deps.refresh();
  }

  const callbacks = {
    // ---- Clock and place ------------------------------------------------
    onSetClock: ({ day, time, label, flashback, mode }) => {
      const payload = {};
      if (day != null && day !== '') payload.day = Number(day);
      if (time != null) {
        if (String(time).trim() && parseTime(time) == null) throw new Error('Время пишется как ЧЧ:ММ, например 07:30 или 23:05.');
        payload.time = String(time).trim();
      }
      if (label != null) payload.label = label;
      if (flashback != null) payload.flashback = Boolean(flashback);
      if (mode != null) payload.mode = String(mode);
      if (!Object.keys(payload).length) return null;
      return run('clock.set', payload, mode != null && Object.keys(payload).length === 1 ? 'Тип сцены задан вручную' : 'Ручная правка времени');
    },
    /** Weather by hand: { kind, temp, text, lock }, or { clear: true } to hand it back to the forecast. */
    onSetWeather: ({ kind, temp, text, lock, clear }) => {
      if (clear) return run('weather.set', { clear: true }, 'Погода: по прогнозу');
      if (!WEATHER_KIND_IDS.includes(kind)) throw new Error('Не знаю такой погоды.');
      return run('weather.set', { kind, temp: temp === '' ? null : temp, text, lock: Boolean(lock) }, `Погода: ${WEATHER_KINDS[kind].label.toLowerCase()}${lock ? ' (держать)' : ''}`);
    },
    /** The heat of the scene by hand: { value } or { delta }, { lock }, { clear }. */
    onSetHeat: ({ value, delta, lock, clear, why }) => {
      if (clear) return run('heat.set', { clear: true }, 'Накал: по ответам');
      const payload = {};
      if (value != null) payload.value = Number(value);
      else if (delta != null) payload.delta = Number(delta);
      if (lock !== undefined) payload.lock = Boolean(lock);
      if (why !== undefined) payload.why = why;
      if (!Object.keys(payload).length) return null;
      return run('heat.set', payload, `Накал: ${value != null ? value : `${Number(delta) > 0 ? '+' : ''}${delta ?? ''}`}${lock ? ' (держать)' : ''}`);
    },
    /** The stage of an intimate scene by hand: { stage } or { delta: ±1 }, { lock }, { clear } (the scene is over). */
    onSetStage: ({ stage, delta, lock, clear, note }) => {
      if (clear) return run('intimacy.set', { clear: true }, 'Стадия близости: сцена окончена');
      const payload = {};
      if (stage != null) payload.stage = String(stage);
      else if (delta != null) payload.delta = Number(delta) < 0 ? -1 : 1;
      if (lock !== undefined) payload.lock = Boolean(lock);
      if (note !== undefined) payload.note = String(note);
      if (!Object.keys(payload).length) return null;
      const what = note !== undefined ? 'своя заметка' : stage != null ? `«${stageOf(stage)?.label ?? stage}»` : delta != null ? (payload.delta > 0 ? 'шаг вперёд' : 'шаг назад') : (lock ? 'держу' : 'отпускаю');
      return run('intimacy.set', payload, `Стадия близости: ${what}`);
    },
    /** A place card of this chat, or free text (a matching card is picked up by name). */
    onSetSceneLocation: ({ locationId, location }) => {
      const scene = getState().knowledge?.scene ?? { presentIds: [] };
      const payload = { presentIds: scene.presentIds ?? [] };
      if (locationId) payload.locationId = locationId;
      else payload.location = String(location ?? '').trim();
      return run('scene.set', payload, 'Ручная правка места');
    },

    // ---- Outfits and conditions -----------------------------------------
    onSetOutfit: ({ entityId, outfit, locked, keepCards = false }) => {
      requireCharacter(entityId);
      // Words alone mean "changed into something else" (the cards come off); keepCards keeps them on.
      const cardIds = keepCards ? getState().world?.wardrobe?.[entityId]?.cardIds : undefined;
      return run('wardrobe.set', { entityId, ...(outfit != null ? { outfit } : {}), ...(cardIds?.length ? { cardIds } : {}), ...(locked != null ? { locked: Boolean(locked) } : {}) },
        outfit != null ? `Одежда ${nameOf(entityId)}: ${String(outfit).slice(0, 80)}` : `${locked ? 'Закреплено' : 'Откреплено'}: одежда ${nameOf(entityId)}`);
    },
    onAddCondition: ({ entityId, text, days }) => {
      requireCharacter(entityId);
      if (!String(text ?? '').trim()) throw new Error('Опишите состояние.');
      return run('condition.add', { entityId, item: { id: uniqueId('condition'), text, ...(Number(days) > 0 ? { days: Number(days) } : {}) } }, `${nameOf(entityId)}: ${text}`);
    },
    onUpdateCondition: ({ entityId, conditionId, changes }) => run('condition.update', { entityId, conditionId, changes }, `Правка состояния ${nameOf(entityId)}`),
    onRemoveCondition: ({ entityId, conditionId }) => run('condition.remove', { entityId, conditionId }, `Состояние снято: ${nameOf(entityId)}`),

    // ---- Undo one change of the last reply ----------------------------------
    /** Only a change the chronicler made for a message; hand edits are changed by hand. */
    onUndoOperation: ({ operationId }) => {
      const operation = getState().operations.find(candidate => candidate.id === operationId);
      if (!operation) throw new Error('Такого изменения уже нет.');
      if (!operation.messageId) throw new Error('Это ручная правка: её меняют там же, где сделали.');
      return deps.replaceState(dropOperation(getState(), operationId));
    },

    // ---- Lasting looks -------------------------------------------------------
    onAddFeature: ({ entityId, text, kind = 'other' }) => {
      requireCharacter(entityId);
      if (!String(text ?? '').trim()) throw new Error('Опишите, что изменилось.');
      return run('feature.add', { entityId, item: { id: uniqueId('feature'), text, kind } }, `${nameOf(entityId)}: ${text}`);
    },
    onUpdateFeature: ({ entityId, featureId, changes }) => run('feature.update', { entityId, featureId, changes }, 'Ручная правка внешности'),
    onRemoveFeature: ({ entityId, featureId }) => run('feature.remove', { entityId, featureId }, 'Черта внешности убрана'),

    // ---- Several items at once: switch off / on / delete ---------------------
    /**
     * action: 'on' (in use), 'shade', 'off', 'remove'. «In use» starts the shade count
     * again from now, so a thing brought back by hand does not slip straight back.
     */
    onItemsBulk: ({ itemIds = [], action }) => {
      const ids = new Set(itemIds);
      const items = (getState().world?.items ?? []).filter(item => ids.has(item.id));
      if (!items.length) throw new Error('Ничего не выбрано.');
      const label = { remove: 'Удалено', off: 'Отключено', shade: 'В тень', on: 'В ход' }[action];
      if (!label) throw new Error('Неизвестное действие.');
      const now = Math.max(0, (deps.chat?.()?.length ?? 1) - 1);
      const changes = { on: { off: false, shade: false, activeSince: now }, shade: { off: false, shade: true }, off: { off: true, shade: false } }[action];
      const metadata = meta(`${label} вещей: ${items.length}`);
      return commitOperations(items.map(item => (action === 'remove'
        ? createOperation('item.remove', { itemId: item.id }, metadata)
        : createOperation('item.update', { itemId: item.id, changes }, metadata))));
    },

    // ---- Items ------------------------------------------------------------
    onAddItem: ({ name, ownerId = '', place = '', importance = 'normal', secret = false }) => {
      if (!String(name ?? '').trim()) throw new Error('Назовите вещь.');
      return run('item.add', { item: { id: uniqueId('item'), name, ...(ownerId ? { ownerId } : {}), ...(place ? { place } : {}), importance, ...(secret ? { secret: true } : {}) } }, `Новая вещь: ${name}`);
    },
    onUpdateItem: ({ itemId, changes }) => run('item.update', { itemId, changes }, 'Ручная правка вещи'),
    onRemoveItem: ({ itemId }) => run('item.remove', { itemId }, 'Вещь удалена'),

    // ---- Quests (Мир → Квесты) ------------------------------------------------
    /** dueIn: days from today (the story day), dueDay: the day itself; reward/penalty: { text, shifts }. */
    onAddQuest: ({ name, text = '', steps = [], secret = false, knownByIds = [], participantIds = [], dueDay = 0, dueIn = 0, reward, penalty }) => {
      if (!String(name ?? '').trim()) throw new Error('Назовите квест.');
      const today = getState().world?.clock?.day || 0;
      const due = Number(dueDay) || (Number(dueIn) > 0 && today ? today + Math.round(Number(dueIn)) : 0);
      return run('quest.add', { item: { id: questId(), name, text, steps, secret, knownByIds, participantIds, ...(due ? { dueDay: due } : {}), ...(reward ? { reward } : {}), ...(penalty ? { penalty } : {}) } }, `Новый квест: ${name}`);
    },
    onUpdateQuest: ({ questId: id, changes }) => run('quest.update', { questId: id, changes }, 'Ручная правка квеста'),
    onQuestStep: ({ questId: id, stepId, done }) => run('quest.step', { questId: id, stepId, done }, 'Шаг квеста отмечен'),
    onRemoveQuest: ({ questId: id }) => run('quest.remove', { questId: id }, 'Квест удалён'),
    /** Ends a quest: status done/failed, a note, and (unless apply is false) the shifts it promised to the lines. */
    onCloseQuest: ({ questId: id, status, outcome = '', apply = true }) => {
      const state = getState();
      const quest = questsOf(state).find(item => item.id === id);
      if (!quest) throw new Error('Квест не найден.');
      if (status !== 'done' && status !== 'failed') throw new Error('Квест закрывается как выполненный или проваленный.');
      const label = status === 'done' ? 'выполнен' : 'провален';
      const operations = [createOperation('quest.update', { questId: id, changes: { status, outcome } }, meta(`Квест «${quest.name}» ${label}`))];
      if (apply) for (const shift of cleanShifts(closingShifts(quest, status), state)) {
        operations.push(createOperation('scale.delta', { relationshipId: shift.relationshipId, scaleId: shift.scaleId, value: shift.value }, meta(`Квест «${quest.name}» ${label}: сдвиг отношений`)));
      }
      return commitOperations(operations);
    },

    // ---- Place cards of this chat -------------------------------------------
    onAddChatLocation: ({ name, parentId = '', traits = [] }) => {
      if (!String(name ?? '').trim()) throw new Error('Назовите место.');
      return run('location.add', { item: { id: uniqueId('location'), name, traits, ...(parentId ? { parentId } : {}) } }, `Новое место: ${name}`);
    },
    onUpdateChatLocation: ({ locationId, changes }) => run('location.update', { locationId, changes }, 'Ручная правка места'),
    onRemoveChatLocation: ({ locationId }) => run('location.remove', { locationId }, 'Место удалено из чата'),

    // ---- Slips: the four answers -------------------------------------------
    onSlipSwipe: async ({ messageIndex, slipIndex }) => {
      slipOf(messageIndex, slipIndex);
      await deps.swipe(messageIndex);
    },
    onSlipEdit: ({ messageIndex }) => deps.editMessage(messageIndex),
    /** «Так и есть»: the text is right, the record is not — rewrite the record to match. */
    onSlipAccept: async ({ messageIndex, slipIndex }) => {
      const slip = slipOf(messageIndex, slipIndex);
      const state = getState();
      if (slip.kind === 'item') {
        await dropSlip(messageIndex, slipIndex);
        deps.openStudio('items', { entityId: slip.entityId });
        return 'items';
      }
      if (slip.kind === 'outfit') {
        const current = state.world?.wardrobe?.[slip.entityId]?.outfit ?? '';
        const value = await deps.input(`Что на ${nameOf(slip.entityId)} на самом деле`, `В ответе: «${slip.quote}»`, current);
        if (value == null) return null;
        await callbacks.onSetOutfit({ entityId: slip.entityId, outfit: value });
      } else if (slip.kind === 'time') {
        const value = await deps.input('Сколько сейчас времени', `В ответе: «${slip.quote}». Формат ЧЧ:ММ.`, state.world?.clock?.time ?? '');
        if (value == null) return null;
        await callbacks.onSetClock({ time: value });
      } else if (slip.kind === 'looks') {
        const value = await deps.input(`Как ${nameOf(slip.entityId)} выглядит на самом деле`, `В ответе: «${slip.quote}». Это запишется во «Внешность».`, '');
        if (value == null) return null;
        await callbacks.onAddFeature({ entityId: slip.entityId, text: value });
      } else if (slip.kind === 'place') {
        const value = await deps.input('Где сейчас сцена', `В ответе: «${slip.quote}»`, state.knowledge?.scene?.location ?? '');
        if (value == null) return null;
        await callbacks.onSetSceneLocation({ location: value });
      }
      await dropSlip(messageIndex, slipIndex);
      return slip.kind;
    },
    onSlipDismiss: ({ messageIndex, slipIndex }) => dropSlip(Number(messageIndex), Number(slipIndex)),
    /** Keep the text, but tell the narrator once what is actually true. */
    onSlipRemind: async ({ messageIndex, slipIndex }) => {
      const slip = slipOf(messageIndex, slipIndex);
      const state = getState();
      const who = slip.entityId ? nameOf(slip.entityId) : '';
      const truth = slip.kind === 'outfit' ? `${who} is still wearing: ${state.world?.wardrobe?.[slip.entityId]?.outfit ?? '(as recorded)'}`
        : slip.kind === 'time' ? `the time is still ${state.world?.clock?.time || 'as recorded'}`
          : slip.kind === 'place' ? `the scene is still at ${state.knowledge?.scene?.location || 'the recorded place'}`
            : slip.kind === 'looks' ? `${who}'s lasting looks are: ${(state.world?.wardrobe?.[slip.entityId]?.features ?? []).map(feature => feature.text).join('; ') || 'as recorded'}`
            : `${who ? `${who}: ` : ''}${slip.note || 'the item is not where the last reply put it'}`;
      deps.reminders.add(`correction of the last reply ("${slip.quote}"): ${truth}${slip.note ? ` — ${slip.note}` : ''}`);
      await dropSlip(messageIndex, slipIndex);
      deps.refresh();
    },
  };
  return callbacks;
}
