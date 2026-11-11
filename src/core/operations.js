import { normalizeAlias, relationshipId, stableId, uniqueId } from './ids.js';
import { OPERATION_TYPES, clamp } from './schema.js';
import { createDefaultState, createEntity, createRelationship, getScale } from './state.js';
import { applyKnowledgeMutation, emptyKnowledge, forgetEntity, mergeKnowledgeEntity } from './knowledge.js';
import { applyWorldMutation, emptyWorld, forgetWorldEntity, markOnStage, mergeWorldEntity } from './world.js';

const TYPES = OPERATION_TYPES;

/** Where a factor came from: a line's own trope outranks a triangle's trope. */
const FACTOR_ORIGIN = /^(pair-trope|triangle-trope):[a-z0-9-]{1,40}$/;

/** Normalize and bound a growth-factor list: { scaleId, direction: up|down, text, origin? }. */
export function normalizeFactors(factors, state) {
  if (!Array.isArray(factors)) throw new TypeError('factors must be an array');
  const seen = new Set();
  const result = [];
  for (const factor of factors.slice(0, 20)) {
    if (!factor || typeof factor !== 'object') continue;
    const scaleId = String(factor.scaleId ?? '');
    const direction = factor.direction === 'down' ? 'down' : 'up';
    const text = String(factor.text ?? '').trim().slice(0, 700);
    if (!text || !state.config.scales.some(scale => scale.id === scaleId)) continue;
    const key = `${scaleId}\u0000${direction}\u0000${text.toLocaleLowerCase('ru-RU')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const origin = typeof factor.origin === 'string' && FACTOR_ORIGIN.test(factor.origin) ? factor.origin : null;
    result.push(origin ? { scaleId, direction, text, origin } : { scaleId, direction, text });
  }
  return result;
}

/** Per-scale pace of a line: { scaleId: 'fast' | 'slow' }; unknown scales and values are dropped. */
export function normalizePace(pace, state) {
  if (pace == null) return {};
  if (typeof pace !== 'object' || Array.isArray(pace)) throw new TypeError('pace must be an object');
  const known = new Set(state.config.scales.map(scale => scale.id));
  return Object.fromEntries(Object.entries(pace).filter(([scaleId, value]) => known.has(scaleId) && (value === 'fast' || value === 'slow')));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Create a validated operation envelope with a unique ID. */
export function createOperation(type, payload, metadata = {}) {
  if (!TYPES.has(type)) throw new RangeError(`Unsupported operation type: ${type}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Operation payload must be an object');
  return {
    id: metadata.id || uniqueId('op'),
    type,
    payload: clone(payload),
    ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
    ...(metadata.messageId ? { messageId: metadata.messageId } : {}),
    ...(Number.isInteger(metadata.messageIndex) ? { messageIndex: metadata.messageIndex } : {}),
    ...(metadata.timestamp ? { timestamp: metadata.timestamp } : {}),
    ...(metadata.reason ? { reason: String(metadata.reason) } : {}),
    ...(Number.isFinite(metadata.confidence) ? { confidence: metadata.confidence } : {}),
  };
}

function relationshipFor(next, payload, create = false) {
  const id = payload.relationshipId || (payload.from && payload.to ? relationshipId(payload.from, payload.to) : null);
  if (!id) throw new TypeError('relationshipId or from/to is required');
  if (!next.relationships[id] && create) {
    if (!next.entities[payload.from] || !next.entities[payload.to]) throw new RangeError('Relationship endpoints must exist');
    next.relationships[id] = createRelationship(next, payload.from, payload.to, { id });
  }
  if (!next.relationships[id]) throw new RangeError(`Unknown relationship: ${id}`);
  return next.relationships[id];
}

/** A line with nothing in it yet: every scale at its default, no records, factors, goal or stage. */
export function lineIsEmpty(state, relation) {
  const defaults = new Map((state.config?.scales ?? []).map(scale => [scale.id, scale.default ?? 0]));
  return Object.entries(relation.scales ?? {}).every(([id, value]) => value === (defaults.get(id) ?? 0))
    && !(relation.memories ?? []).length && !(relation.tensions ?? []).length
    && !Object.keys(relation.factors ?? {}).length && !relation.goal && !relation.stage;
}

/**
 * Before a merge: lines both copies have, both with something in them. The kept one's
 * scales stay; this says what they are and what the twin's were, for the confirmation.
 * [{ line: 'A → B', kept: 'доверие 40', dropped: 'доверие 5' }]
 */
export function mergeClashes(state, pairs) {
  const labels = new Map((state.config?.scales ?? []).map(scale => [scale.id, [scale.label, scale.default ?? 0]]));
  const summary = relation => Object.entries(relation.scales ?? {})
    .filter(([id, value]) => value !== (labels.get(id)?.[1] ?? 0))
    .map(([id, value]) => `${(labels.get(id)?.[0] ?? id).toLowerCase()} ${value}`).join(', ');
  const clashes = [];
  for (const { fromId, intoId } of pairs ?? []) {
    for (const relation of Object.values(state.relationships ?? {})) {
      if (relation.from !== fromId && relation.to !== fromId) continue;
      const source = relation.from === fromId ? intoId : relation.from;
      const target = relation.to === fromId ? intoId : relation.to;
      if (source === target) continue;
      const kept = state.relationships?.[relationshipId(source, target)];
      if (!kept || lineIsEmpty(state, kept) || lineIsEmpty(state, relation)) continue;
      const name = id => state.entities?.[id]?.name ?? id;
      clashes.push({ line: `${name(source)} → ${name(target)}`, kept: summary(kept) || 'всё по нулям', dropped: summary(relation) });
    }
  }
  return clashes;
}

function applyMutation(next, operation) {
  const payload = operation.payload;
  switch (operation.type) {
    case 'entity.upsert': {
      const entity = createEntity(payload.name, payload);
      next.entities[entity.id] = entity;
      break;
    }
    case 'relationship.upsert': {
      if (!next.entities[payload.from] || !next.entities[payload.to]) throw new RangeError('Relationship endpoints must exist');
      const relation = createRelationship(next, payload.from, payload.to, payload);
      for (const [scaleId, value] of Object.entries(relation.scales)) {
        getScale(next, scaleId);
        relation.scales[scaleId] = clamp(value);
      }
      next.relationships[relation.id] = relation;
      break;
    }
    case 'scale.delta':
    case 'scale.set': {
      const relation = relationshipFor(next, payload, true);
      const scale = getScale(next, payload.scaleId);
      const current = relation.scales[payload.scaleId] ?? scale.default;
      relation.scales[payload.scaleId] = clamp(operation.type === 'scale.delta' ? current + payload.value : payload.value);
      break;
    }
    case 'memory.add':
    case 'tension.add': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = operation.type.startsWith('memory') ? 'memories' : 'tensions';
      const item = typeof payload.item === 'string'
        ? { id: payload.itemId || stableId(operation.id, key.slice(0, -1)), text: payload.item }
        : clone(payload.item);
      if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`${key} item needs an ID`);
      if (payload.shared) {
        item.participantIds = [...new Set(item.participantIds ?? [])];
        if (item.participantIds.some(id => !next.entities[id])) throw new RangeError('Unknown record participant');
      }
      if (!relation[key].some((candidate) => candidate.id === item.id)) relation[key].push(item);
      break;
    }
    case 'memory.remove':
    case 'tension.remove': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = operation.type.startsWith('memory') ? 'memories' : 'tensions';
      relation[key] = relation[key].filter((item) => item.id !== payload.itemId);
      break;
    }
    case 'record.toggle': {
      const relation = payload.shared ? (next.records ??= { memories: [], tensions: [] }) : relationshipFor(next, payload);
      const key = payload.kind === 'tension' ? 'tensions' : 'memories';
      const item = relation[key].find((candidate) => candidate.id === payload.itemId);
      if (item) item.disabled = Boolean(payload.disabled);
      break;
    }
    case 'record.update': {
      // A record removed by a rolled-back message makes its later edit a no-op.
      const owner = payload.shared ? next.records : next.relationships[payload.relationshipId];
      const key = payload.kind === 'tension' ? 'tensions' : 'memories';
      const item = owner?.[key]?.find(candidate => candidate.id === payload.itemId);
      if (!item) break;
      const changes = payload.changes ?? {};
      if (changes.text != null) {
        const text = String(changes.text).trim();
        if (!text) throw new TypeError('Record text is required');
        item.text = text.slice(0, 1000);
      }
      if (changes.intensity != null) item.intensity = Math.max(1, Math.min(5, Math.round(Number(changes.intensity)) || 3));
      // Pinned: always sent, past the ranking and the limits.
      if (changes.pinned != null) { if (changes.pinned) item.pinned = true; else delete item.pinned; }
      for (const field of ['participantIds', 'knownBy']) {
        if (changes[field] == null) continue;
        if (!payload.shared) throw new TypeError(`${field} can only be edited on shared records`);
        const ids = [...new Set(changes[field].map(String))];
        if (ids.some(id => !next.entities[id])) throw new RangeError('Unknown record participant');
        item[field] = ids.sort();
      }
      // Participants always know about their own event.
      if (payload.shared && item.knownBy) item.knownBy = [...new Set([...item.knownBy, ...(item.participantIds ?? [])])].sort();
      break;
    }
    case 'factors.set': {
      const relation = relationshipFor(next, payload);
      relation.factors = normalizeFactors(payload.factors, next);
      // Pace and goal are optional in the payload: operations without them leave the line's own alone.
      if (Object.hasOwn(payload, 'pace')) {
        const pace = normalizePace(payload.pace, next);
        if (Object.keys(pace).length) relation.pace = pace; else delete relation.pace;
      }
      // The end point belongs to this directed line only: A→B and B→A each keep their own.
      if (Object.hasOwn(payload, 'goal')) {
        const goal = String(payload.goal ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
        if (goal) relation.goal = goal; else delete relation.goal;
      }
      break;
    }
    case 'relationship.remove': {
      const id = payload.relationshipId || (payload.from && payload.to ? relationshipId(payload.from, payload.to) : null);
      if (!id) throw new TypeError('relationshipId or from/to is required');
      if (!next.relationships[id]) break;
      delete next.relationships[id];
      if (next.ui?.activeRelationshipId === id) next.ui.activeRelationshipId = '';
      break;
    }
    case 'entity.merge': {
      // One character recorded twice («Manjiro Sano» and «Манджиро Сано»): `fromId` goes
      // into `intoId`. Its names become other names; lines, records, knowledge, clothes and
      // things move over. Where both had the same line, the kept one wins and gets the records.
      const { fromId, intoId } = payload;
      const from = next.entities[fromId];
      const into = next.entities[intoId];
      if (!from || !into || fromId === intoId) break;
      const names = new Set([into.name, ...(into.aliases ?? [])].map(normalizeAlias));
      into.aliases = [...(into.aliases ?? [])];
      for (const name of [from.name, ...(from.aliases ?? [])]) {
        const key = normalizeAlias(name);
        if (key && !names.has(key)) { names.add(key); into.aliases.push(name); }
      }
      const swap = id => (id === fromId ? intoId : id);
      const swapRecord = item => ({
        ...item,
        ...(item.participantIds ? { participantIds: [...new Set(item.participantIds.map(swap))] } : {}),
        ...(item.knownBy ? { knownBy: [...new Set(item.knownBy.map(swap))].sort() } : {}),
      });
      for (const [id, relation] of Object.entries(next.relationships)) {
        if (relation.from !== fromId && relation.to !== fromId) continue;
        delete next.relationships[id];
        const source = swap(relation.from);
        const target = swap(relation.to);
        if (source === target) continue; // a line between the two copies of one person
        const newId = relationshipId(source, target);
        const kept = next.relationships[newId];
        // A line of the kept one that holds nothing yet (all at default, no records) takes
        // the twin's whole line: its scales are what the story built.
        if (kept && lineIsEmpty(next, kept)) {
          next.relationships[newId] = { ...relation, id: newId, from: source, to: target,
            memories: (relation.memories ?? []).map(swapRecord), tensions: (relation.tensions ?? []).map(swapRecord) };
        } else if (kept) {
          for (const key of ['memories', 'tensions']) {
            kept[key] = [...(kept[key] ?? []), ...(relation[key] ?? []).filter(item => !(kept[key] ?? []).some(have => have.id === item.id)).map(swapRecord)];
          }
        } else {
          next.relationships[newId] = { ...relation, id: newId, from: source, to: target,
            memories: (relation.memories ?? []).map(swapRecord), tensions: (relation.tensions ?? []).map(swapRecord) };
        }
        if (next.ui?.activeRelationshipId === id) next.ui.activeRelationshipId = newId;
      }
      if (next.records) {
        for (const key of ['memories', 'tensions']) next.records[key] = (next.records[key] ?? []).map(swapRecord);
      }
      mergeKnowledgeEntity(next, fromId, intoId);
      mergeWorldEntity(next, fromId, intoId);
      if (next.ui) {
        next.ui.triangles = (next.ui.triangles ?? [])
          .map(triangle => ({ ...triangle, centerId: swap(triangle.centerId), firstId: swap(triangle.firstId), secondId: swap(triangle.secondId) }))
          .filter(triangle => new Set([triangle.centerId, triangle.firstId, triangle.secondId]).size === 3);
        const swapKey = key => [...new Set(key.split('|').map(swap))].sort().join('|');
        if (next.ui.strangerPairs) next.ui.strangerPairs = [...new Set(next.ui.strangerPairs.map(swapKey))].filter(key => key.includes('|'));
        if (next.ui.headcanons) {
          for (const key of Object.keys(next.ui.headcanons)) {
            if (!key.split('|').includes(fromId)) continue;
            const merged = swapKey(key);
            const value = next.ui.headcanons[key];
            delete next.ui.headcanons[key];
            if (merged.includes('|') && !next.ui.headcanons[merged]) next.ui.headcanons[merged] = value;
          }
        }
        if (next.ui.personaId === fromId) next.ui.personaId = intoId;
      }
      delete next.entities[fromId];
      break;
    }
    case 'entity.remove': {
      const entityId = payload.entityId;
      if (!entityId || !next.entities[entityId]) break;
      delete next.entities[entityId];
      forgetEntity(next, entityId);
      forgetWorldEntity(next, entityId);
      for (const id of Object.keys(next.relationships)) {
        const relation = next.relationships[id];
        if (relation.from === entityId || relation.to === entityId) delete next.relationships[id];
      }
      if (next.records) {
        for (const key of ['memories', 'tensions']) {
          next.records[key] = (next.records[key] ?? [])
            .map(item => ({
              ...item,
              participantIds: (item.participantIds ?? []).filter(id => id !== entityId),
              knownBy: (item.knownBy ?? []).filter(id => id !== entityId),
            }))
            .filter(item => (item.participantIds ?? []).length > 0 || !Array.isArray(item.participantIds));
        }
      }
      for (const relation of Object.values(next.relationships)) {
        for (const key of ['memories', 'tensions']) {
          relation[key] = (relation[key] ?? []).filter(item =>
            !(item.participantIds ?? []).includes(entityId) || (item.participantIds ?? []).length > 1);
        }
      }
      if (next.ui) {
        next.ui.triangles = (next.ui.triangles ?? []).filter(triangle =>
          triangle.centerId !== entityId && triangle.firstId !== entityId && triangle.secondId !== entityId);
        if (next.ui.strangerPairs) next.ui.strangerPairs = next.ui.strangerPairs.filter(key => !key.split('|').includes(entityId));
        if (next.ui.headcanons) {
          for (const key of Object.keys(next.ui.headcanons)) if (key.split('|').includes(entityId)) delete next.ui.headcanons[key];
        }
        if (next.ui.personaId === entityId) next.ui.personaId = '';
        if (next.ui.activeRelationshipId && !next.relationships[next.ui.activeRelationshipId]) next.ui.activeRelationshipId = '';
      }
      break;
    }
    case 'stage.set':
      relationshipFor(next, payload).stage = payload.stage ?? null;
      break;
    case 'scales.hide': {
      // Per-line visibility: hidden scales are not shown, injected or changed by analysis.
      const relation = relationshipFor(next, payload);
      if (!Array.isArray(payload.hiddenScales)) throw new TypeError('hiddenScales must be an array');
      const known = new Set(next.config.scales.map(scale => scale.id));
      const hidden = [...new Set(payload.hiddenScales.map(String))].filter(scaleId => known.has(scaleId));
      if (hidden.length >= known.size) throw new RangeError('At least one scale must stay visible');
      if (hidden.length) relation.hiddenScales = hidden;
      else delete relation.hiddenScales;
      break;
    }
    default: {
      if (applyKnowledgeMutation(next, operation)) {
        if (operation.type === 'scene.set') markOnStage(next);
        break;
      }
      if (applyWorldMutation(next, operation)) break;
      throw new RangeError(`Unsupported operation type: ${operation.type}`);
    }
  }
}

/** Apply one operation immutably. Applying an existing ID is a no-op. */
export function applyOperation(state, operation) {
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  if (!operation || typeof operation.id !== 'string' || !operation.id) throw new TypeError('Operation ID is required');
  if (!TYPES.has(operation.type)) throw new RangeError(`Unsupported operation type: ${operation.type}`);
  if (state.appliedOperationIds.includes(operation.id)) return state;
  const next = clone(state);
  applyMutation(next, operation);
  next.operations.push(clone(operation));
  next.appliedOperationIds.push(operation.id);
  return next;
}

/** Apply operations atomically; an error leaves the input state untouched. */
export function applyOperations(state, operations) {
  if (!Array.isArray(operations)) throw new TypeError('Operations must be an array');
  if (!state || typeof state !== 'object') throw new TypeError('State is required');
  const next = clone(state);
  const appliedIds = new Set(next.appliedOperationIds);
  for (const operation of operations) {
    if (!operation || typeof operation.id !== 'string' || !operation.id) throw new TypeError('Operation ID is required');
    if (!TYPES.has(operation.type)) throw new RangeError(`Unsupported operation type: ${operation.type}`);
    if (appliedIds.has(operation.id)) continue;
    applyMutation(next, operation);
    next.operations.push(clone(operation));
    next.appliedOperationIds.push(operation.id);
    appliedIds.add(operation.id);
  }
  return next;
}

/**
 * A fresh state holding only the baseline, ready for a journal replay.
 * The ONE place that knows which parts of the state are materialised from the
 * baseline: every rebuild (rollback, reconciliation, import check, history
 * rebuild) goes through it, so a new journaled part cannot be forgotten in one of them.
 * `ui` and snapshots are not journaled and are carried over as they are.
 */
export function replayBase(state, { ui = state.ui } = {}) {
  const next = createDefaultState({ scales: state.config.scales });
  next.baseline = clone(state.baseline);
  next.entities = clone(state.baseline.entities || {});
  next.relationships = clone(state.baseline.relationships || {});
  next.records = clone(state.baseline.records || { memories: [], tensions: [] });
  next.knowledge = clone(state.baseline.knowledge || emptyKnowledge());
  next.world = clone(state.baseline.world || emptyWorld());
  next.snapshots = clone(state.snapshots || []);
  next.ui = clone(ui || { activeRelationshipId: '' });
  return next;
}

function replay(state, operations) {
  return applyOperations(replayBase(state), operations);
}

/** Roll back every operation in a transaction and replay the remaining journal. */
export function rollbackTransaction(state, transactionId) {
  if (!transactionId) throw new TypeError('transactionId is required');
  return replay(state, state.operations.filter((operation) => operation.transactionId !== transactionId));
}

/**
 * Undo ONE operation (a row of "what the last reply changed") and replay the rest.
 * Later operations that depended on it simply become no-ops.
 */
export function dropOperation(state, operationId) {
  if (!operationId) throw new TypeError('operationId is required');
  if (!state.operations.some(operation => operation.id === operationId)) throw new RangeError('Такого изменения уже нет');
  return replay(state, state.operations.filter(operation => operation.id !== operationId));
}

/** Roll back every operation associated with a message. */
export function rollbackMessage(state, messageId) {
  if (!messageId) throw new TypeError('messageId is required');
  return replay(state, state.operations.filter((operation) => operation.messageId !== messageId));
}

/** Replace a message's effects, suitable for swipe and edited-message replay. */
export function reapplyMessage(state, messageId, replacementOperations) {
  if (!Array.isArray(replacementOperations)) throw new TypeError('replacementOperations must be an array');
  const rolledBack = rollbackMessage(state, messageId);
  const normalized = replacementOperations.map((operation) => ({ ...clone(operation), messageId }));
  return applyOperations(rolledBack, normalized);
}
