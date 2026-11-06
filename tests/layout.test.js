import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TAB, DOCK_CHAT_ROOM, DOCK_WIDTH, NAV_GROUPS, NAV_TABS, PENDING_TABS, RELATION_TABS,
  clampDockWidth, effectiveMode, normalizeLayout, reopenOnLoad,
} from '../src/ui/layout.js';
import { ICON_NAMES } from '../src/ui/icons.js';
import { DEFAULT_SETTINGS } from '../src/integration/settings.js';

test('menu has the four groups in the agreed order', () => {
  assert.deepEqual(NAV_GROUPS.map(group => group.title), ['Сцена', 'Мир', 'Отношения', 'Система']);
});

test('every engine tab survived the move into groups', () => {
  const ids = NAV_TABS.map(([id]) => id);
  for (const id of ['overview', 'memories', 'tensions', 'headcanons', 'triangles', 'journal', 'lorebooks', 'settings']) {
    assert.ok(ids.includes(id), `${id} is in the menu`);
  }
  assert.equal(new Set(ids).size, ids.length, 'no tab appears twice');
});

test('every menu icon exists', () => {
  for (const [id, , iconName] of NAV_TABS) assert.ok(ICON_NAMES.includes(iconName), `${id}: icon ${iconName}`);
});

test('pending tabs are only the new scene pages, never an engine page', () => {
  const scene = NAV_GROUPS.find(group => group.id === 'scene').items.map(([id]) => id);
  for (const id of PENDING_TABS) assert.ok(scene.includes(id), `${id} is a scene page`);
  for (const id of RELATION_TABS) assert.ok(!PENDING_TABS.has(id));
});

test('stored layout is sanitised', () => {
  const width = DOCK_WIDTH.default;
  assert.deepEqual(normalizeLayout(undefined), { mode: 'window', tab: DEFAULT_TAB, width, open: false });
  assert.deepEqual(normalizeLayout({ mode: 'dock', tab: 'journal', width: 700 }), { mode: 'dock', tab: 'journal', width: 700, open: false });
  assert.deepEqual(normalizeLayout({ mode: 'sideways', tab: 'gone', width: 'wide' }), { mode: 'window', tab: DEFAULT_TAB, width, open: false });
  assert.deepEqual(normalizeLayout('dock'), { mode: 'window', tab: DEFAULT_TAB, width, open: false });
});

test('after a reload only the docked panel that was open comes back', () => {
  assert.equal(reopenOnLoad({ mode: 'dock', open: true }, false), true);
  assert.equal(reopenOnLoad({ mode: 'dock', open: false }, false), false, 'it was closed');
  assert.equal(reopenOnLoad({ mode: 'window', open: true }, false), false, 'a window over the chat stays closed');
  assert.equal(reopenOnLoad({ mode: 'dock', open: true }, true), false, 'a phone never docks');
  assert.equal(normalizeLayout({ mode: 'dock', open: 1 }).open, true);
});

test('dock width stays within limits and leaves the chat room', () => {
  assert.equal(clampDockWidth(100), DOCK_WIDTH.min);
  assert.equal(clampDockWidth(5000), DOCK_WIDTH.max);
  assert.equal(clampDockWidth(612.4), 612);
  assert.equal(clampDockWidth(900, 1000), 1000 - DOCK_CHAT_ROOM, 'a narrow window keeps room for the chat');
  assert.equal(clampDockWidth(900, 500), DOCK_WIDTH.min, 'never below the minimum, even on a tiny window');
  assert.equal(clampDockWidth(NaN), DOCK_WIDTH.default);
});

test('the default settings hold a valid layout', () => {
  assert.deepEqual(normalizeLayout(DEFAULT_SETTINGS.studio), DEFAULT_SETTINGS.studio);
});

test('a phone never docks', () => {
  assert.equal(effectiveMode('dock', false), 'dock');
  assert.equal(effectiveMode('dock', true), 'window');
  assert.equal(effectiveMode('window', false), 'window');
});

test('top bar button does not use the class SillyTavern binds to its own drawers', () => {
  const shell = readFileSync(fileURLToPath(new URL('../src/integration/shell.js', import.meta.url)), 'utf8');
  const mount = shell.slice(shell.indexOf('export function mountTopBarButton'));
  assert.ok(!/className\s*=\s*['"][^'"]*\bdrawer-toggle\b/.test(mount), 'no .drawer-toggle on our button');
  assert.match(mount, /drawer-icon/);
});
