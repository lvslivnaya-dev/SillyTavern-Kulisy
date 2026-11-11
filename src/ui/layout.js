/**
 * Studio navigation and window layout — pure data and rules, no DOM.
 *
 * Navigation is grouped the way the narrator thinks about a scene:
 * who is on stage and what they know, how they feel about each other,
 * and the machinery behind it.
 */
export const NAV_GROUPS = Object.freeze([
  Object.freeze({ id: 'scene', title: 'Сцена', items: Object.freeze([
    ['scene', 'Сейчас', 'stage'],
    ['characters', 'Персонажи', 'people'],
    ['persona', 'Персона', 'eyeoff'],
    ['chronicle', 'Хроника', 'scroll'],
    ['events', 'События', 'list'],
    ['secrets', 'Секреты', 'lock'],
  ]) }),
  Object.freeze({ id: 'world', title: 'Мир', items: Object.freeze([
    ['places', 'Локации', 'pin'],
    ['items', 'Вещи', 'bag'],
    ['wardrobe', 'Гардероб', 'shirt'],
    ['calendar', 'Календарь', 'calendar'],
    ['weather', 'Погода', 'cloud'],
    ['dice', 'Кубик', 'dice'],
    ['names', 'Имена', 'tag'],
  ]) }),
  Object.freeze({ id: 'relations', title: 'Отношения', items: Object.freeze([
    ['overview', 'Обзор пар', 'heart'],
    ['memories', 'Воспоминания', 'clock'],
    ['tensions', 'Напряжения', 'bolt'],
    ['headcanons', 'Хедканоны', 'spark'],
    ['triangles', 'Треугольники', 'triangle'],
  ]) }),
  Object.freeze({ id: 'system', title: 'Система', items: Object.freeze([
    ['journal', 'История', 'history'],
    ['lorebooks', 'Лорбуки', 'book'],
    ['leaks', 'Проверка', 'alert'],
    ['settings', 'Настройки', 'gear'],
  ]) }),
]);

/** Flat [id, label, icon] list in menu order. */
export const NAV_TABS = Object.freeze(NAV_GROUPS.flatMap(group => group.items));

/** Tabs whose pages are not built yet; the menu marks them and the page says so. Empty since 0.1.0. */
export const PENDING_TABS = Object.freeze(new Set());

/** Tabs of the relationship group: they need the persona/pair tools at hand. */
export const RELATION_TABS = Object.freeze(new Set(NAV_GROUPS.find(group => group.id === 'relations').items.map(([id]) => id)));

export const LAYOUT_MODES = Object.freeze(['window', 'dock']);
export const DEFAULT_TAB = 'overview';

/** Docked panel width in px: dragged by its handle, stored with the layout. */
export const DOCK_WIDTH = Object.freeze({ default: 520, min: 360, max: 1200, step: 20 });
/** The chat keeps at least this much room beside the docked panel. */
export const DOCK_CHAT_ROOM = 320;

/** Clamp a dock width to the allowed range and to what the window can spare. */
export function clampDockWidth(width, viewportWidth = Infinity) {
  const value = Number(width);
  if (!Number.isFinite(value)) return DOCK_WIDTH.default;
  const roomy = Math.max(DOCK_WIDTH.min, viewportWidth - DOCK_CHAT_ROOM);
  return Math.round(Math.min(Math.max(value, DOCK_WIDTH.min), DOCK_WIDTH.max, roomy));
}

/** Sanitise a stored layout: unknown modes and tabs fall back to the defaults. */
export function normalizeLayout(value) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = LAYOUT_MODES.includes(source.mode) ? source.mode : 'window';
  const tab = NAV_TABS.some(([id]) => id === source.tab) ? source.tab : DEFAULT_TAB;
  const width = clampDockWidth(source.width ?? DOCK_WIDTH.default);
  // Was the panel open when the page went away? Only the docked panel comes back by
  // itself after a reload: a window over the chat would just be in the way.
  return { mode, tab, width, open: Boolean(source.open) };
}

/** Whether to open the Studio right after the page (re)loads. */
export function reopenOnLoad(layout, isPhone) {
  return Boolean(layout?.open) && effectiveMode(layout?.mode, isPhone) === 'dock';
}

/** The dock needs room beside the chat; on a phone the Studio is always a full-screen window. */
export function effectiveMode(mode, isPhone) {
  return mode === 'dock' && !isPhone ? 'dock' : 'window';
}
