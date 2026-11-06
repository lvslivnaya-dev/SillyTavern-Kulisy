import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHRONICLE_KEEP, CHRONICLE_MARKER, activeSummaries, addScene, buildChroniclePrompt, chronicleConfig, chronicleStats, editSummary,
  emptyChronicle, mergeCandidates, mergeSummaries, normalizeChronicle, pinSummary, removeScene, scenesOf, unfoldSummary,
} from '../src/core/index.js';
import { hideSummarized, parseSummaryText, pendingChunk, pendingCount, runChronicle, staleSceneOf } from '../src/integration/chronicle-run.js';
import { createChronicleRunner } from '../src/integration/chronicle-actions.js';

function scenes(count) {
  let chronicle = emptyChronicle();
  for (let index = 1; index <= count; index += 1) chronicle = addScene(chronicle, { id: `s${index}`, text: `Сцена ${index}`, messageCount: 15 });
  return chronicle;
}

function chat(count) {
  return Array.from({ length: count }, (_, index) => ({ mes: `Сообщение ${index}`, is_user: index % 2 === 0, name: index % 2 ? 'Narrator' : 'Судзу', extra: {} }));
}

test('presets give their numbers; custom keeps the user values within bounds', () => {
  assert.deepEqual([chronicleConfig({}).preset, chronicleConfig({}).sceneEvery, chronicleConfig({}).enabled], ['balanced', 15, false]);
  assert.equal(chronicleConfig({ preset: 'economy', sceneEvery: 99 }).sceneEvery, 25, 'a preset ignores stray numbers');
  const own = chronicleConfig({ preset: 'custom', sceneEvery: 1, chapterOf: 50, arcOf: 'x', keepRecent: 0 });
  assert.deepEqual([own.sceneEvery, own.chapterOf, own.arcOf, own.keepRecent], [4, 12, 4, 2]);
});

test('scenes merge into a chapter; the chapter takes the first scene\'s place; unfold brings them back', () => {
  let chronicle = scenes(5);
  const ids = mergeCandidates(chronicle, 0, 4);
  assert.deepEqual(ids, ['s1', 's2', 's3', 's4']);
  chronicle = mergeSummaries(chronicle, ids, { id: 'c1', text: 'Глава один' });
  assert.deepEqual(activeSummaries(chronicle).map(item => item.id), ['c1', 's5']);
  assert.deepEqual(scenesOf(chronicle, 'c1'), ['s1', 's2', 's3', 's4']);
  chronicle = unfoldSummary(chronicle, 'c1');
  assert.deepEqual(activeSummaries(chronicle).map(item => item.id), ['s1', 's2', 's3', 's4', 's5']);
  assert.throws(() => unfoldSummary(chronicle, 's1'), /вместе с сообщениями/);
});

test('a pinned scene is never merged and breaks the run', () => {
  let chronicle = pinSummary(scenes(6), 's3');
  assert.deepEqual(mergeCandidates(chronicle, 0, 3), ['s4', 's5', 's6'], 's1–s2 are too short a run before the pinned one');
  chronicle = mergeSummaries(chronicle, ['s4', 's5', 's6'], { id: 'c1', text: 'Глава' });
  assert.deepEqual(activeSummaries(chronicle).map(item => item.id), ['s1', 's2', 's3', 'c1']);
  assert.throws(() => mergeSummaries(chronicle, ['s1', 'c1'], { id: 'x', text: 'x' }), /одного уровня/);
});

test('removing a scene of a chapter: a chapter left with one part unfolds into it', () => {
  let chronicle = mergeSummaries(scenes(2), ['s1', 's2'], { id: 'c1', text: 'Глава' });
  chronicle = removeScene(chronicle, 's1');
  assert.deepEqual(activeSummaries(chronicle).map(item => item.id), ['s2']);
  assert.equal(chronicle.summaries.length, 1);
});

test('the prompt sends active summaries oldest first and drops the oldest over the budget', () => {
  const chronicle = mergeSummaries(scenes(3), ['s1', 's2'], { id: 'c1', text: 'Глава: Судзу знакомится с Тосвой.' });
  const block = buildChroniclePrompt(chronicle);
  assert.match(block, /Глава 1: Глава: Судзу знакомится с Тосвой\.\nСцена 1: Сцена 3/);
  const tight = buildChroniclePrompt(chronicle, { maxCharacters: 400 });
  assert.match(tight, /Сцена 1: Сцена 3/);
  assert.equal(buildChroniclePrompt(emptyChronicle()), '');
  assert.deepEqual(chronicleStats(chronicle, 140), { messages: 140, scenes: 1, chapters: 1, arcs: 0, characters: 'Глава: Судзу знакомится с Тосвой.'.length + 'Сцена 3'.length });
});

test('edits and storage repair', () => {
  const edited = editSummary(scenes(1), 's1', '  Новый текст  ');
  assert.deepEqual([edited.summaries[0].text, edited.summaries[0].edited], ['Новый текст', true]);
  const repaired = normalizeChronicle({ summaries: [{ id: 'a', level: 0, text: 'x', parentId: 'ghost' }, { id: 'a', level: 0, text: 'dup' }, { id: 'b', level: 7, text: 'y' }] });
  assert.equal(repaired.summaries.length, 1);
  assert.equal(repaired.summaries[0].parentId, undefined);
});

test('the due chunk: oldest uncovered story messages, never the newest ones, never across a covered one', () => {
  const messages = chat(40);
  const config = chronicleConfig({ preset: 'custom', sceneEvery: 10, keepRecent: 20 });
  assert.deepEqual(pendingChunk(messages, config), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  messages[3].is_system = true;
  messages[5].extra[CHRONICLE_MARKER] = CHRONICLE_KEEP;
  assert.deepEqual(pendingChunk(messages, config), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.equal(pendingCount(messages, config), 18);
  assert.equal(pendingChunk(chat(25), config), null, 'only 5 messages are old enough');
});

function fakeModel() {
  const calls = [];
  return {
    calls,
    context: { async generateRaw(options) { calls.push(options); return `<think>…</think>Сводка номер ${calls.length}: что-то произошло.`; } },
  };
}

test('a run writes scenes, marks their messages, then merges what became due', async () => {
  const messages = chat(70);
  let chronicle = emptyChronicle();
  const model = fakeModel();
  let saves = 0;
  const api = {
    context: model.context, chat: () => messages, chronicle: () => chronicle, persona: 'Судзу',
    save: async next => { chronicle = next; }, saveChat: async () => { saves += 1; }, isStale: () => false,
  };
  const config = chronicleConfig({ preset: 'custom', sceneEvery: 10, chapterOf: 3, keepRecent: 20 });
  const result = await runChronicle(api, config, { maxScenes: 10 });
  assert.deepEqual(result, { scenes: 5, merges: 1 });
  assert.equal(saves, 5);
  assert.deepEqual(activeSummaries(chronicle).map(item => item.level), [1, 0, 0]);
  assert.equal(messages[0].extra[CHRONICLE_MARKER], chronicle.summaries[0].id);
  assert.equal(messages[50].extra[CHRONICLE_MARKER], undefined, 'the newest 20 stay');
  assert.doesNotMatch(chronicle.summaries[0].text, /think/);
  assert.match(model.calls[1].prompt[1].content, /Previous summary/);

  const prompt = messages.map(message => ({ ...message }));
  assert.equal(hideSummarized(prompt, chronicle), 50);
  assert.equal(prompt.length, 20);
});

test('a run stops without writing when the chat changed meanwhile', async () => {
  const messages = chat(40);
  let chronicle = emptyChronicle();
  const api = { context: fakeModel().context, chat: () => messages, chronicle: () => chronicle, save: async next => { chronicle = next; }, saveChat: async () => {}, isStale: () => true };
  assert.deepEqual(await runChronicle(api, chronicleConfig({ preset: 'custom', sceneEvery: 10 })), { scenes: 0, merges: 0 });
  assert.equal(messages[0].extra[CHRONICLE_MARKER], undefined);
});

test('an edited message makes its scene stale; "keep" and removed scenes are not hidden', () => {
  const messages = chat(3);
  messages[0].extra[CHRONICLE_MARKER] = 's1';
  messages[1].extra[CHRONICLE_MARKER] = CHRONICLE_KEEP;
  messages[2].extra[CHRONICLE_MARKER] = 'gone';
  const chronicle = addScene(emptyChronicle(), { id: 's1', text: 'Сцена', messageCount: 1, fingerprint: 'old' });
  assert.equal(staleSceneOf(messages, chronicle, 0), 's1');
  assert.equal(staleSceneOf(messages, chronicle, 1), '');
  const prompt = [...messages];
  assert.equal(hideSummarized(prompt, chronicle), 1);
  assert.deepEqual(prompt.map(message => message.mes), ['Сообщение 1', 'Сообщение 2']);
  assert.equal(parseSummaryText('```\nсводка: ок\n```'), null, 'too short to be a summary');
});

test('runner callbacks: a slider switches to custom, unfolding a scene gives messages back, nothing runs while off', async () => {
  const settings = { chronicle: { enabled: false, preset: 'balanced' } };
  const messages = chat(4);
  messages[0].extra[CHRONICLE_MARKER] = 's1';
  let chronicle = addScene(emptyChronicle(), { id: 's1', text: 'Сцена один', messageCount: 1 });
  const runner = createChronicleRunner({
    settings: () => settings, saveSettings() {}, chronicle: () => chronicle, save: async next => { chronicle = next; },
    chat: () => messages, saveChat: async () => {}, context: () => fakeModel().context, persona: () => '',
    isGenerating: () => false, waitForGeneration: async () => {}, chatKey: () => 'chat', confirm: async () => true,
    refresh() {}, log() {},
  });
  assert.deepEqual(await runner.run(), { scenes: 0, merges: 0 });
  runner.callbacks.onChronicleSettings({ changes: { sceneEvery: 8 } });
  assert.equal(settings.chronicle.preset, 'custom');
  runner.callbacks.onChronicleSettings({ changes: { preset: 'economy' } });
  assert.equal(settings.chronicle.sceneEvery, 25);
  assert.equal(runner.callbacks.onChronicleGet().stats.scenes, 1);
  assert.equal(await runner.callbacks.onChronicleUnfold({ id: 's1' }), true);
  assert.equal(messages[0].extra[CHRONICLE_MARKER], CHRONICLE_KEEP);
  assert.deepEqual(chronicle.summaries, []);
});
