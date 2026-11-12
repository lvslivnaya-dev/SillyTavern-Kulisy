/**
 * The setup guide of a chat: what to do when Kulisy meets a chat for the first time, as a short list of steps.
 * Pure data and rules; index.js collects the facts, the page «Настройка чата» draws the steps, the reminder above the message
 * box counts the required ones that are not done yet.
 *
 * facts = { enabled, personaId, characters (without the persona), libraryCards, cardsOn, lorebooks (linked), hasPlace, auxMode }
 * step  = { id, title, tab, required, done (true | false | null = nothing to tick), what, how[], note }
 */
export const SETUP_STEPS = Object.freeze([
  Object.freeze({
    id: 'persona', tab: 'persona', required: true,
    title: 'Выберите свою персону',
    what: 'Кулисы должны знать, кто вы в этой истории: за вашу персону они ничего не решают, и остальные не «знают» её сами по себе.',
    how: [
      'Откройте страницу «Персона» (меню слева, группа «Сцена»).',
      'Выберите себя в списке. Обычно персона подвязывается сама, по имени вашей персоны в SillyTavern.',
      'Списка нет или он пуст? Сначала отправьте пару постов: персонажи появятся после первых ответов.',
    ],
    done: facts => Boolean(facts.personaId),
  }),
  Object.freeze({
    id: 'characters', tab: 'characters', required: true,
    title: 'Соберите персонажей',
    what: 'Кулисы ведут отношения, знания и одежду каждого героя. Для этого им нужен список героев чата.',
    how: [
      'Отправьте пару постов: герои появятся сами, когда летописец прочтёт ответы.',
      'Если в чате уже есть переписка, нажмите вверху «Проанализировать историю»: он соберёт героев и события из неё.',
      'На странице «Персонажи» лишних можно удалить, недостающих добавить вручную.',
    ],
    done: facts => facts.characters > 0,
    note: facts => (facts.characters ? `Героев в чате: ${facts.characters}.` : ''),
  }),
  Object.freeze({
    id: 'cards', tab: 'cards', required: false,
    title: 'Подключите карточки героев',
    what: 'Если героя вы записали в библиотеку карточек (внешность, голос, характер, шкаф), рассказчик получит нужные разделы сам. Это необязательно.',
    how: [
      'Откройте «Карточки» (группа «Мир»).',
      'Включите переключатель на карточке героя: она подключится к персонажу чата с таким именем, а если его нет, он появится.',
      'Карточек ещё нет? Создайте «+ Карточка» или загрузите анкеты из Obsidian: «Импорт → Из папки анкет».',
    ],
    done: facts => facts.cardsOn > 0,
    note: facts => (facts.libraryCards ? `В библиотеке карточек: ${facts.libraryCards}, подключено здесь: ${facts.cardsOn}.` : 'В библиотеке пока нет карточек.'),
  }),
  Object.freeze({
    id: 'lorebooks', tab: 'lorebooks', required: false,
    title: 'Отметьте лорбуки этой истории',
    what: 'Кулисы читают лорбуки сами (анализ ответов, поиск героев, секреты). Нужно сказать, какие книги относятся к этой истории.',
    how: [
      'Откройте «Лорбуки» (группа «Система»).',
      'Отметьте книги этой истории: мир, места, анкеты героев.',
      'Если книги подключены в таверне к чату или персонажу, они уже видны в списке.',
    ],
    done: facts => facts.lorebooks > 0,
    note: facts => (facts.lorebooks ? `Отмечено книг: ${facts.lorebooks}.` : ''),
  }),
  Object.freeze({
    id: 'place', tab: 'scene', required: false,
    title: 'Задайте место и время',
    what: 'Погода, одежда и локации опираются на то, где и когда происходит сцена. Дальше летописец ведёт их сам.',
    how: [
      'Откройте «Сейчас» или нажмите на плитку «место» и «время» в шторке над полем ввода.',
      'Выберите место из библиотеки локаций или впишите своё. Время сцены ставится там же.',
    ],
    done: facts => facts.hasPlace,
  }),
  Object.freeze({
    id: 'analysis', tab: 'settings', required: false,
    title: 'Выберите модель для анализа',
    what: 'После каждого ответа летописец делает отдельный запрос. Его можно отдать недорогой модели, а основную оставить для рассказчика.',
    how: [
      'Откройте «Настройки» → «Модели и API» → «Вспомогательный API».',
      'Выберите профиль подключения или впишите адрес и модель, нажмите «Проверить».',
      'Ничего не выбирая, всё работает и на основной модели, просто дороже.',
    ],
    done: facts => facts.auxMode === 'profile' || facts.auxMode === 'custom',
  }),
  Object.freeze({
    id: 'prompt', tab: 'settings', required: false,
    title: 'Посмотрите, что уходит модели',
    what: 'Последняя проверка: какие блоки Кулисы добавят к следующему ответу.',
    how: [
      'Откройте «Настройки» → «Что получает модель».',
      'Просмотрите блоки: карточки, имена, сцена, знания. Раскройте любой, чтобы увидеть, что в нём.',
      'Лишнее выключается там же.',
    ],
    done: () => null,
  }),
]);

/** The steps of this chat, with their state: [{ id, title, tab, required, done, what, how, note }]. */
export function setupSteps(facts = {}) {
  return SETUP_STEPS.map(step => ({
    id: step.id, title: step.title, tab: step.tab, required: step.required, what: step.what, how: [...step.how],
    done: step.done(facts),
    note: step.note ? step.note(facts) : '',
  }));
}

/** { done, total, optionalDone, optionalTotal, missing: [step ids still to do among the required ones] }. */
export function setupProgress(steps) {
  const required = steps.filter(step => step.required);
  const optional = steps.filter(step => !step.required && step.done !== null);
  return {
    done: required.filter(step => step.done).length,
    total: required.length,
    optionalDone: optional.filter(step => step.done).length,
    optionalTotal: optional.length,
    missing: required.filter(step => !step.done).map(step => step.id),
  };
}

/** Whether to remind: Kulisy is on, the reminder is on, this chat did not switch it off and a required step is open. */
export function setupReminderDue({ enabled = true, remind = true, off = false }, progress) {
  return Boolean(enabled && remind && !off && progress.missing.length);
}
