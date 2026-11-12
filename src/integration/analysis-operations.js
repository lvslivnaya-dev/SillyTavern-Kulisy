import { applyOperation, createEntity, createOperation, isDead, relationshipId, uniqueId } from '../core/index.js';
import { coupledDeltas } from './coupling.js';
import { materializeKnowledge } from './knowledge-analysis.js';
import { presentIds } from '../core/knowledge.js';
import { confirmSlips, materializeClock, materializePlace, materializeHeat, materializeSceneLocation, materializeWeather, materializeWorldRest, questProposals, stageProposals } from './world-analysis.js';

function normalizedName(value) {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

const SLOW_LIMIT = 2;
export const TEMPO_LABELS = Object.freeze({ 'very-slow': 'очень медленно', slow: 'медленно', normal: 'обычно', fast: 'быстро' });
const FAST_FACTOR = 1.5;

/**
 * The chat's tempo: every scale change is scaled before the line's own pace.
 * A change never vanishes completely (at least ±1), so very slow still moves.
 */
export const TEMPOS = Object.freeze({
  'very-slow': { factor: 0.4, cap: 3 },
  slow: { factor: 0.65, cap: 6 },
  normal: { factor: 1, cap: Infinity },
  fast: { factor: 1.5, cap: 25 },
});

export function tempoDelta(delta, tempo) {
  const value = Number(delta);
  const rule = TEMPOS[tempo];
  if (!value || !rule || tempo === 'normal') return value;
  return Math.sign(value) * Math.min(rule.cap, Math.max(1, Math.round(Math.abs(value) * rule.factor)));
}

/** A line's pace for one scale (a trope or set by hand): slow caps a change, fast amplifies it. */
export function pacedDelta(delta, pace) {
  const value = Number(delta);
  if (pace === 'slow') return Math.sign(value) * Math.min(SLOW_LIMIT, Math.abs(value));
  if (pace === 'fast') return Math.sign(value) * Math.min(25, Math.round(Math.abs(value) * FAST_FACTOR));
  return value;
}

const WARM = new Set(['love', 'attraction', 'affection']);

/**
 * Triangles: when the center and one side grow closer (love, attraction, affection up on
 * either of their lines) and the other side is in the scene, that rival's jealousy toward
 * this side rises by half the step (1–4). Not when the rival is away (they did not see it),
 * is the persona (their feelings are the user's), already got a jealousy change toward this
 * side from the analyzer, or the triangle is resolved or has the echo switched off.
 */
export function triangleEcho(api, operations, options = {}) {
  const state = api.state();
  const personaId = state.ui?.personaId || '';
  const here = new Set(presentIds(state));
  const steps = new Map(); // "rival|side" → { value, triangle }
  for (const triangle of state.ui?.triangles ?? []) {
    if (triangle.resolved || triangle.noEcho) continue;
    for (const operation of operations) {
      if (operation.type !== 'scale.delta' || !WARM.has(operation.payload.scaleId) || !(operation.payload.value > 0)) continue;
      const relation = state.relationships[operation.payload.relationshipId];
      if (!relation) continue;
      const pair = [relation.from, relation.to];
      if (!pair.includes(triangle.centerId)) continue;
      const side = pair.find(id => id !== triangle.centerId);
      if (side !== triangle.firstId && side !== triangle.secondId) continue;
      const rival = side === triangle.firstId ? triangle.secondId : triangle.firstId;
      if (rival === personaId || !here.has(rival)) continue;
      const already = operations.some(item => item.type === 'scale.delta' && item.payload.scaleId === 'jealousy'
        && state.relationships[item.payload.relationshipId]?.from === rival && state.relationships[item.payload.relationshipId]?.to === side);
      if (already) continue;
      const value = Math.min(4, Math.max(1, Math.ceil(operation.payload.value / 2)));
      const key = `${rival}|${side}`;
      if ((steps.get(key)?.value ?? 0) < value) steps.set(key, { value, triangle });
    }
  }
  for (const [key, { value, triangle }] of steps) {
    const [rival, side] = key.split('|');
    const current = api.state();
    if (!current.config.scales.some(scale => scale.id === 'jealousy')) return;
    const id = relationshipId(rival, side);
    if (!current.relationships[id]) {
      if (options.allowNewPair && !options.allowNewPair(rival, side)) continue;
      api.add('relationship.upsert', { from: rival, to: side }, 'Связь появилась из-за треугольника');
    }
    const relation = api.state().relationships[id];
    if (!relation || (relation.hiddenScales ?? []).includes('jealousy')) continue;
    const delta = pacedDelta(value, relation.pace?.jealousy);
    const name = entityId => current.entities[entityId]?.name ?? entityId;
    api.add('scale.delta', { relationshipId: id, scaleId: 'jealousy', value: delta },
      `Ревность третьего: ${name(rival)} видит, как ${name(side)} и ${name(triangle.centerId)} сближаются (треугольник «${triangle.name}»)`);
  }
}

/** Human-readable list of proposed scale changes for the confirmation popup.
 * Operations may reference characters by registry ID or by scene name. */
export function describeProposedChanges(state, operations, threshold) {
  const nameOf = reference => {
    if (state.entities?.[reference]) return state.entities[reference].name;
    const found = Object.values(state.entities ?? {}).find(entity =>
      [entity.name, ...(entity.aliases ?? [])].some(candidate => normalizedName(candidate) === normalizedName(reference)));
    return found?.name ?? String(reference ?? '?');
  };
  const labelOf = metric => state.config?.scales?.find(scale => scale.id === metric)?.label ?? metric;
  return (operations ?? []).map(operation => {
    const delta = Number(operation.delta);
    return {
      from: nameOf(operation.subjectId),
      to: nameOf(operation.objectId),
      scale: labelOf(operation.metric),
      delta,
      reason: String(operation.reason ?? ''),
      large: Math.abs(delta) >= threshold,
    };
  }).sort((left, right) => Number(right.large) - Number(left.large) || Math.abs(right.delta) - Math.abs(left.delta));
}

/** Materialize validated analysis into ordinary reversible core operations.
 * acceptedNewCharacters: entries from result.newCharacters that the user confirmed;
 * operations may reference them by scene name, which is mapped to the new stable ID.
 * options.linkedScales: false disables spills into related scales.
 * options.allowNewPair(subjectId, objectId): false skips everything that would create a new line.
 * options.tempo: the chat's tempo (TEMPOS), applied before each line's pace. */
export function applyAnalysisResult(state, result, metadata = {}, acceptedNewCharacters = [], options = {}) {
  let next = state;
  const personaId = state.ui?.personaId || '';
  const operations = [];
  const nameToId = new Map();

  for (const character of acceptedNewCharacters) {
    const entity = createEntity(character.name, { aliases: character.aliases });
    if (next.entities[entity.id]) { nameToId.set(normalizedName(character.name), entity.id); continue; }
    next = applyOperation(next, createOperation('entity.upsert', entity, {
      id: uniqueId('scene-character'), reason: `Персонаж найден в сцене${character.note ? `: ${character.note}` : ''}`, timestamp: new Date().toISOString(),
    }));
    nameToId.set(normalizedName(character.name), entity.id);
    for (const alias of character.aliases ?? []) nameToId.set(normalizedName(alias), entity.id);
  }

  function resolveId(reference) {
    if (!reference) return null;
    if (next.entities[reference]) return reference;
    const byNewName = nameToId.get(normalizedName(reference));
    if (byNewName) return byNewName;
    for (const entity of Object.values(next.entities)) {
      const candidates = [entity.name, ...(entity.aliases ?? [])];
      if (candidates.some(candidate => normalizedName(candidate) === normalizedName(reference))) return entity.id;
    }
    return null;
  }

  function ensurePair(subjectId, objectId) {
    if (subjectId === objectId || !next.entities[subjectId] || !next.entities[objectId]) return null;
    const id = relationshipId(subjectId, objectId);
    if (!next.relationships[id] && options.allowNewPair && !options.allowNewPair(subjectId, objectId)) return null;
    if (!next.relationships[id]) next = applyOperation(next, createOperation('relationship.upsert', {
      from: subjectId, to: objectId,
    }, { id: uniqueId('relationship'), reason: 'Связь обнаружена при анализе', timestamp: new Date().toISOString() }));
    // Never hand out an ID of a line that does not exist: callers read it right away.
    return next.relationships[id] ? id : null;
  }
  function add(type, payload, reason) {
    const operation = createOperation(type, payload, {
      ...metadata, id: uniqueId('analysis'), reason, timestamp: new Date().toISOString(),
    });
    next = applyOperation(next, operation);
    operations.push(operation);
  }
  // Resolve first, so linked-scale spills know which scales the analyzer evidenced itself.
  const resolved = [];
  for (const proposed of result.operations ?? []) {
    const subjectId = resolveId(proposed.subjectId);
    const objectId = resolveId(proposed.objectId);
    if (!subjectId || !objectId) continue;
    if (personaId && subjectId === personaId) continue;
    // The lines of the dead are frozen: grief and guilt of the living still change.
    if (isDead(next, subjectId)) continue;
    let metric = proposed.metric;
    if (metric === 'affection' && !next.config.scales.some(scale => scale.id === metric)
      && next.config.scales.some(scale => scale.id === 'affinity')) metric = 'affinity';
    if (!next.config.scales.some(scale => scale.id === metric)) continue;
    const id = ensurePair(subjectId, objectId);
    if (!id) continue;
    if ((next.relationships[id].hiddenScales ?? []).includes(metric)) continue;
    // The analyzer may name the factor it matched; it counts only if scale and direction agree.
    const factor = Number.isInteger(Number(proposed.factor)) ? (next.relationships[id].factors ?? [])[Number(proposed.factor) - 1] : null;
    const matched = factor && factor.scaleId === metric && (factor.direction === 'down') === (Number(proposed.delta) < 0) ? factor.text : '';
    resolved.push({ id, metric, delta: Number(proposed.delta), reason: proposed.reason, factor: matched });
  }
  const evidenced = new Map();
  for (const change of resolved) {
    if (!evidenced.has(change.id)) evidenced.set(change.id, new Set());
    evidenced.get(change.id).add(change.metric);
  }
  for (const change of resolved) {
    const pace = next.relationships[change.id].pace ?? {};
    const tempo = TEMPOS[options.tempo] && options.tempo !== 'normal' ? options.tempo : '';
    const delta = pacedDelta(tempoDelta(change.delta, tempo), pace[change.metric]);
    if (!delta) continue;
    const reasons = [tempo ? `темп чата: ${TEMPO_LABELS[tempo]}` : '', pace[change.metric] ? `темп шкалы: ${pace[change.metric] === 'slow' ? 'медленно' : 'быстро'}` : ''].filter(Boolean);
    const paceNote = delta !== change.delta ? ` (${reasons.join(', ')}, ${change.delta > 0 ? '+' : ''}${change.delta} → ${delta > 0 ? '+' : ''}${delta})` : '';
    add('scale.delta', { relationshipId: change.id, scaleId: change.metric, value: delta, ...(change.factor ? { factor: change.factor } : {}) },
      `${change.reason}${paceNote}${change.factor ? ` · по фактору: «${change.factor}»` : ''}`);
    if (options.linkedScales === false) continue;
    const hidden = new Set(next.relationships[change.id].hiddenScales ?? []);
    const available = new Set(next.config.scales.map(scale => scale.id).filter(scaleId => !hidden.has(scaleId)));
    for (const spill of coupledDeltas(change.metric, delta, available, evidenced.get(change.id))) {
      const value = pace[spill.scaleId] === 'slow' ? Math.sign(spill.value) * Math.min(SLOW_LIMIT, Math.abs(spill.value)) : spill.value;
      add('scale.delta', { relationshipId: change.id, scaleId: spill.scaleId, value },
        `Связанная шкала (${change.metric} ${delta > 0 ? '+' : ''}${delta})`);
    }
  }
  for (const [collection, type] of [['memories', 'memory.add'], ['tensions', 'tension.add']]) {
    for (const item of result[collection] ?? []) {
      if (Array.isArray(item.participantIds)) {
        const participants = [...new Set(item.participantIds.map(resolveId).filter(Boolean))].sort();
        if (!participants.length || participants.length !== item.participantIds.length) continue;
        if ((next.records?.[collection] ?? []).some(existing => existing.text.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase()
          && JSON.stringify([...(existing.participantIds ?? [])].sort()) === JSON.stringify(participants))) continue;
        const knownBy = (item.knownBy ?? participants).filter(id => next.entities[id]);
        if (item.knownBy && !participants.every(id => knownBy.includes(id))) {
          knownBy.push(...participants);
        }
        add(type, { shared: true, item: { id: uniqueId(collection), text: item.text, intensity: item.intensity, participantIds: participants, knownBy: [...new Set(knownBy)].sort(), createdAt: new Date().toISOString(), source: 'chat-analysis' } }, item.text);
        continue;
      }
      const subjectId = resolveId(item.subjectId);
      const objectId = resolveId(item.objectId);
      if (subjectId && isDead(next, subjectId)) continue;
      const id = subjectId && objectId ? ensurePair(subjectId, objectId) : null;
      if (!id) continue;
      if (next.relationships[id][collection].some(existing => existing.text?.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase())) continue;
      add(type, { relationshipId: id, item: { id: uniqueId(collection), text: item.text, intensity: item.intensity, createdAt: new Date().toISOString(), source: 'chat-analysis' } }, item.text);
    }
  }
  // Automatic headcanons: only for the pairs the caller allowed (options.headcanonKeys).
  const allowedHeadcanons = new Set(options.headcanonKeys ?? []);
  const headcanons = [];
  for (const item of result.headcanons ?? []) {
    const ids = [...new Set(item.participantIds.map(resolveId).filter(Boolean))];
    if (ids.length < 2 || ids.length !== item.participantIds.length) continue;
    const key = [...ids].sort().join('|');
    if (allowedHeadcanons.has(key)) headcanons.push({ key, text: item.text });
  }
  // The chroniclers: same metadata, so a swipe takes scene, events, learning, time,
  // clothes and things back too. Order: place → clock → who is on stage → the rest,
  // so someone walking in "three days later" may have changed clothes.
  const api = { state: () => next, add, resolveId, messageIndex: metadata.messageIndex ?? null, loreTitles: options.loreTitles ?? null, library: options.library ?? null, wardrobe: options.wardrobe ?? null };
  const world = options.trackWorld === false ? null : result.world;
  const beforeWorld = next;
  const locationId = world ? materializePlace(world, api) : undefined;
  if (world) { materializeClock(world, api); materializeWeather(world, api); materializeHeat(world, api); }
  let leaks = [];
  let deaths = [];
  let reveals = [];
  let secrets = [];
  if (result.knowledge && options.trackKnowledge !== false) {
    ({ leaks, deaths = [], reveals = [], secrets = [] } = materializeKnowledge(result.knowledge, { ...api, locationId }));
  } else if (locationId) {
    materializeSceneLocation(api, locationId);
  }
  if (world) materializeWorldRest(world, api, locationId ?? next.knowledge?.scene?.locationId);
  if (options.triangleEcho !== false) triangleEcho(api, operations, options);
  const slips = world ? confirmSlips(world, api, beforeWorld) : [];
  // Quests are only proposed: the plaque under the reply asks, nothing is written before.
  // The intimate stage is a proposal of the same kind (the plaque asks); it travels with the quests.
  const quests = world ? [...questProposals(world, api), ...stageProposals(world, api)] : [];
  return { state: next, operations, headcanons, leaks, deaths, reveals, secrets, slips, quests };
}
