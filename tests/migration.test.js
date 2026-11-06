import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatStorage } from '../src/integration/storage.js';
import { getSettings, LEGACY_METADATA_KEY, METADATA_KEY, MODULE_ID } from '../src/integration/settings.js';
import { detectConflicts } from '../src/integration/conflicts.js';
import { createDefaultState, createEntity, createOperation, applyOperations, importState } from '../src/core/index.js';

function chatContext(metadata) {
  const saves = [];
  return {
    chatMetadata: metadata,
    async saveMetadata() { saves.push(Object.keys(metadata)); },
    saves,
  };
}

function engineState() {
  return applyOperations(createDefaultState(), [
    createOperation('entity.upsert', createEntity('Ран')),
    createOperation('entity.upsert', createEntity('Судзу')),
  ]);
}

test('a chat from Relationship Engine opens with a copy of its state', () => {
  const legacy = engineState();
  const ctx = chatContext({ [LEGACY_METADATA_KEY]: legacy });
  const storage = createChatStorage(() => ctx, createDefaultState, importState);
  const loaded = storage.load();
  assert.deepEqual(Object.values(loaded.entities).map(entity => entity.name).sort(), ['Ран', 'Судзу']);
  assert.equal(ctx.saves.length, 0, 'reading alone writes nothing');
});

test('saving after adoption writes only the Kulisy key; the engine data stays as it was', async () => {
  const legacy = engineState();
  const before = structuredClone(legacy);
  const ctx = chatContext({ [LEGACY_METADATA_KEY]: legacy });
  const storage = createChatStorage(() => ctx, createDefaultState, importState);
  const next = applyOperations(storage.load(), [createOperation('entity.upsert', createEntity('Майки'))]);
  await storage.save(next);
  assert.ok(ctx.chatMetadata[METADATA_KEY]);
  assert.deepEqual(ctx.chatMetadata[LEGACY_METADATA_KEY], before);
});

test('Kulisy state wins over the engine state once it exists', () => {
  const own = applyOperations(createDefaultState(), [createOperation('entity.upsert', createEntity('Дракен'))]);
  const ctx = chatContext({ [METADATA_KEY]: own, [LEGACY_METADATA_KEY]: engineState() });
  const storage = createChatStorage(() => ctx, createDefaultState, importState);
  assert.deepEqual(Object.values(storage.load().entities).map(entity => entity.name), ['Дракен']);
});

test('broken engine state falls back to an empty chat instead of failing', () => {
  const ctx = chatContext({ [LEGACY_METADATA_KEY]: { schemaVersion: 999 } });
  const storage = createChatStorage(() => ctx, createDefaultState, importState);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(Object.keys(storage.load().entities), []);
  } finally {
    console.warn = originalWarn;
  }
});

test('first run copies Relationship Engine settings without touching them', () => {
  const engine = { enabled: true, autoAnalyze: true, aux: { mode: 'custom', url: 'http://x', key: 'k', model: 'm' } };
  const root = { relationshipEngine: engine };
  const settings = getSettings({ extensionSettings: root });
  assert.equal(settings.autoAnalyze, true);
  assert.equal(settings.aux.url, 'http://x');
  assert.ok(Object.hasOwn(settings, 'headcanonLimit'), 'missing keys are filled with defaults');
  settings.aux.url = 'changed';
  assert.equal(root.relationshipEngine.aux.url, 'http://x', 'engine settings are a separate object');
  assert.equal(root[MODULE_ID], settings);
});

test('later runs keep Kulisy settings even if the engine ones change', () => {
  const root = { [MODULE_ID]: { autoAnalyze: false }, relationshipEngine: { autoAnalyze: true } };
  assert.equal(getSettings({ extensionSettings: root }).autoAnalyze, false);
});

test('an active Relationship Engine is reported as a conflict', () => {
  const context = { extensionSettings: {}, getExtensionManifest: () => null };
  assert.deepEqual(detectConflicts(context, {}), []);
  const found = detectConflicts(context, { relationshipEngineInterceptor: async () => {} });
  assert.deepEqual(found.map(item => item.id), ['relationship-engine']);
});
