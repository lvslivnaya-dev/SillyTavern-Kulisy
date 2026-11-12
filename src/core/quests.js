/**
 * Квесты: нити истории с шагами, сроком, скрытностью и итогами.
 *
 * state.world.quests = [{
 *   id, name, text,                      — название и суть для модели
 *   status: 'active'|'paused'|'done'|'failed',
 *   steps: [{ id, text, done }],         — список шагов (галочками)
 *   secret?, knownByIds?[],              — скрытый квест: знают только названные
 *   participantIds?[],                   — кого касается (для подсказок и «на сцене ли»)
 *   dueDay?,                             — день истории, к которому надо успеть
 *   reward?: { text, shifts[] }, penalty?: { text, shifts[] }  — что будет при успехе / провале;
 *                                          shifts: [{ relationshipId, scaleId, value }] (scale.delta)
 *   outcome?, startedDay?, closedDay?
 * }]
 *
 * Чистая логика без DOM. Как и остальной мир, воспроизведение истории не падает:
 * операция про исчезнувший квест — пустая, неизвестные ID выбрасываются.
 */

export const QUEST_STATUSES = Object.freeze(['active', 'paused', 'done', 'failed']);
export const QUEST_LABELS = Object.freeze({ active: 'идёт', paused: 'отложен', done: 'выполнен', failed: 'провален' });
export const QUEST_OPERATION_TYPES = Object.freeze(['quest.add', 'quest.update', 'quest.step', 'quest.remove']);

export const QUEST_LIMITS = Object.freeze({
  quests: 200, steps: 20, name: 120, text: 400, step: 200, outcome: 300, shifts: 6, reward: 300, sent: 6, shiftValue: 30,
});

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function dayNumber(value) {
  const day = Math.round(Number(value));
  return Number.isFinite(day) && day > 0 ? Math.min(day, 1_000_000) : 0;
}

let counter = 0;
const newId = prefix => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function questId() { return newId('quest'); }

/**
 * Steps from loose input. A step without an ID gets `<quest>-sN`: the same input always gives the same IDs, because a journal
 * is replayed to check the state, and an ID drawn at random would make the replay differ from the saved state.
 */
function cleanSteps(steps, seed = 'step') {
  if (!Array.isArray(steps)) return [];
  const result = [];
  for (const raw of steps) {
    const text = clean(typeof raw === 'string' ? raw : raw?.text, QUEST_LIMITS.step);
    if (!text) continue;
    const id = typeof raw?.id === 'string' ? raw.id : '';
    result.push({ id, text, done: Boolean(raw?.done) });
    if (result.length >= QUEST_LIMITS.steps) break;
  }
  // Two steps never share an ID.
  const seen = new Set(result.map(step => step.id).filter(Boolean));
  const used = new Set();
  let counter = 0;
  for (const step of result) {
    if (!step.id || used.has(step.id)) {
      do { counter += 1; step.id = `${seed}-s${counter}`; } while (seen.has(step.id) || used.has(step.id));
    }
    used.add(step.id);
  }
  return result;
}

/** What happens to the relationship lines when the quest ends: [{ relationshipId, scaleId, value }]. */
export function cleanShifts(shifts, state = null) {
  if (!Array.isArray(shifts)) return [];
  const result = [];
  for (const raw of shifts) {
    const relationshipId = String(raw?.relationshipId ?? '');
    const scaleId = String(raw?.scaleId ?? '');
    const value = Math.round(Number(raw?.value));
    if (!relationshipId || !scaleId || !Number.isFinite(value) || !value) continue;
    if (state?.relationships && !state.relationships[relationshipId]) continue;
    result.push({ relationshipId, scaleId, value: Math.max(-QUEST_LIMITS.shiftValue, Math.min(QUEST_LIMITS.shiftValue, value)) });
    if (result.length >= QUEST_LIMITS.shifts) break;
  }
  return result;
}

function cleanOutcomeBlock(raw, state) {
  const text = clean(raw?.text, QUEST_LIMITS.reward);
  const shifts = cleanShifts(raw?.shifts, state);
  return text || shifts.length ? { text, shifts } : null;
}

function idList(values, next) {
  return [...new Set((Array.isArray(values) ? values : []).map(String))].filter(id => next.entities?.[id]).sort();
}

function applyFields(next, world, quest, fields) {
  if (fields.name != null) {
    const name = clean(fields.name, QUEST_LIMITS.name);
    if (!name) throw new TypeError('quest needs a name');
    quest.name = name;
  }
  if (fields.text != null) quest.text = clean(fields.text, QUEST_LIMITS.text);
  if (fields.steps != null) quest.steps = cleanSteps(fields.steps, quest.id);
  if (fields.secret != null) { if (fields.secret) quest.secret = true; else delete quest.secret; }
  if (fields.knownByIds != null) {
    const ids = idList(fields.knownByIds, next);
    if (ids.length) quest.knownByIds = ids; else delete quest.knownByIds;
  }
  if (fields.participantIds != null) {
    const ids = idList(fields.participantIds, next);
    if (ids.length) quest.participantIds = ids; else delete quest.participantIds;
  }
  if (fields.dueDay !== undefined) {
    const day = dayNumber(fields.dueDay);
    if (day) quest.dueDay = day; else delete quest.dueDay;
  }
  for (const key of ['reward', 'penalty']) {
    if (fields[key] === undefined) continue;
    const block = cleanOutcomeBlock(fields[key], next);
    if (block) quest[key] = block; else delete quest[key];
  }
  if (fields.outcome !== undefined) {
    const text = clean(fields.outcome, QUEST_LIMITS.outcome);
    if (text) quest.outcome = text; else delete quest.outcome;
  }
  if (fields.status != null && QUEST_STATUSES.includes(fields.status) && fields.status !== quest.status) {
    quest.status = fields.status;
    const day = world.clock?.day || 0;
    if (fields.status === 'done' || fields.status === 'failed') { if (day) quest.closedDay = day; } else delete quest.closedDay;
  }
}

/** Apply a quest operation to a mutable state copy (`world` is next.world). Returns false for foreign types. */
export function applyQuestMutation(next, world, operation) {
  if (!QUEST_OPERATION_TYPES.includes(operation.type)) return false;
  world.quests ??= [];
  const payload = operation.payload ?? {};
  switch (operation.type) {
    case 'quest.add': {
      const item = payload.item ?? {};
      const id = String(item.id ?? '');
      if (!id) throw new TypeError('quest needs an ID');
      if (world.quests.some(quest => quest.id === id)) break;
      if (world.quests.length >= QUEST_LIMITS.quests) throw new RangeError('Quest limit reached');
      const quest = { id, name: '', text: '', status: 'active', steps: [] };
      applyFields(next, world, quest, { name: item.name ?? '', ...item, status: undefined });
      if (QUEST_STATUSES.includes(item.status)) quest.status = item.status;
      if (world.clock?.day) quest.startedDay = world.clock.day;
      world.quests.push(quest);
      break;
    }
    case 'quest.update': {
      const quest = world.quests.find(candidate => candidate.id === payload.questId);
      if (quest) applyFields(next, world, quest, payload.changes ?? {});
      break;
    }
    case 'quest.step': {
      const quest = world.quests.find(candidate => candidate.id === payload.questId);
      const step = quest?.steps.find(candidate => candidate.id === payload.stepId);
      if (step) step.done = payload.done == null ? !step.done : Boolean(payload.done);
      break;
    }
    case 'quest.remove':
      world.quests = world.quests.filter(quest => quest.id !== payload.questId);
      break;
    default: return false;
  }
  return true;
}

/** A character left the chat: no longer a participant or a knower. */
export function forgetQuestEntity(world, entityId) {
  for (const quest of world?.quests ?? []) {
    for (const key of ['knownByIds', 'participantIds']) {
      if (!quest[key]) continue;
      quest[key] = quest[key].filter(id => id !== entityId);
      if (!quest[key].length) delete quest[key];
    }
  }
}

/** Two characters became one. */
export function mergeQuestEntity(world, fromId, intoId) {
  for (const quest of world?.quests ?? []) {
    for (const key of ['knownByIds', 'participantIds']) {
      if (quest[key]) quest[key] = [...new Set(quest[key].map(id => (id === fromId ? intoId : id)))].sort();
    }
  }
}

/** Shape errors of world.quests (empty when fine; a missing list is fine). */
export function validateQuests(world) {
  if (world?.quests == null) return [];
  if (!Array.isArray(world.quests)) return ['world.quests must be an array'];
  const errors = [];
  const ids = new Set();
  for (const quest of world.quests) {
    if (!quest || typeof quest.id !== 'string' || !quest.id) { errors.push('quest needs an ID'); continue; }
    if (ids.has(quest.id)) errors.push(`duplicate quest ${quest.id}`);
    ids.add(quest.id);
    if (typeof quest.name !== 'string' || !quest.name.trim()) errors.push(`quest ${quest.id} needs a name`);
    if (!QUEST_STATUSES.includes(quest.status)) errors.push(`quest ${quest.id} has an unknown status`);
    if (!Array.isArray(quest.steps) || quest.steps.some(step => !step?.id || typeof step.text !== 'string')) errors.push(`quest ${quest.id} has malformed steps`);
  }
  return errors;
}

// ---- Чтение -----------------------------------------------------------------------------

/** Квесты чата. */
export function questsOf(state) {
  return Array.isArray(state?.world?.quests) ? state.world.quests : [];
}

/** The first step not done yet, or null. */
export function currentStep(quest) {
  return quest?.steps?.find(step => !step.done) ?? null;
}

/** How many steps are done: { done, total }. */
export function progressOf(quest) {
  const steps = quest?.steps ?? [];
  return { done: steps.filter(step => step.done).length, total: steps.length };
}

/** Days left to the deadline (0 = today, negative = overdue); null when there is no deadline or no clock. */
export function daysLeft(quest, today) {
  if (!quest?.dueDay || !today) return null;
  return quest.dueDay - today;
}

/** «через 2 дня», «сегодня», «просрочен на 1 день». */
export function dueText(quest, today) {
  const left = daysLeft(quest, today);
  if (left == null) return '';
  const word = count => { const n = Math.abs(count); return n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'; };
  if (left === 0) return 'срок сегодня';
  return left > 0 ? `осталось ${left} ${word(left)}` : `просрочен на ${-left} ${word(left)}`;
}

/** Quests grouped for the page: { active, paused, done, failed }. */
export function groupQuests(state) {
  const groups = { active: [], paused: [], done: [], failed: [] };
  for (const quest of questsOf(state)) groups[quest.status]?.push(quest);
  return groups;
}

/**
 * Active quests the narrator may be told about now. A secret quest is sent only when someone who knows it
 * is on stage (the others — and the persona — must not learn it from the narrator's own hints).
 */
export function questsForPrompt(state, { presentIds = [] } = {}) {
  const present = new Set(presentIds);
  return questsOf(state).filter(quest => {
    if (quest.status !== 'active') return false;
    if (!quest.secret) return true;
    return (quest.knownByIds ?? []).some(id => present.has(id));
  }).slice(0, QUEST_LIMITS.sent);
}

const nameOf = (state, id) => state.entities?.[id]?.name ?? id;

/** The block for the narrator, wrapped; '' when there is nothing to say. */
export function buildQuestsPrompt(state, { presentIds = [] } = {}) {
  const quests = questsForPrompt(state, { presentIds });
  if (!quests.length) return '';
  const today = state.world?.clock?.day || 0;
  const lines = quests.map(quest => {
    const progress = progressOf(quest);
    const step = currentStep(quest);
    const parts = [`quest «${quest.name}»`];
    if (quest.text) parts.push(quest.text);
    const due = dueText(quest, today);
    if (due) parts.push(due);
    if (progress.total) parts.push(`steps ${progress.done}/${progress.total}`);
    if (step) parts.push(`now: ${step.text}`);
    const doneSteps = (quest.steps ?? []).filter(item => item.done).map(item => item.text);
    if (doneSteps.length) parts.push(`done: ${doneSteps.join('; ')}`);
    if (quest.participantIds?.length) parts.push(`involves: ${quest.participantIds.map(id => nameOf(state, id)).join(', ')}`);
    if (quest.secret) parts.push(`SECRET, known only to: ${(quest.knownByIds ?? []).map(id => nameOf(state, id)).join(', ')}`);
    return `- ${parts.join(' | ')}`;
  });
  return `[QUESTS — threads of the story that are in play]\n${lines.join('\n')}\n\nRules:\n- These are threads the story may pick up, not tasks handed to {{user}}. Never write {{user}}'s actions, choices or knowledge.\n- Let the step marked "now" surface through events, people and places when it fits; do not rush it, do not announce it as a task, and never mark steps as done yourself.\n- A deadline adds pressure through the story (people mention it, time is short), never by force.\n- A SECRET quest exists only for the characters named as knowing it: everyone else, {{user}} included, knows nothing about it.\n- Do not expose this block.\n[/QUESTS]`;
}

/** The cue for «ввести шаг сейчас»: { text: short Russian line, detail: what the narrator is told }. */
export function questCue(quest, step = currentStep(quest)) {
  if (!quest) return null;
  const detail = `quest «${quest.name}»${quest.text ? ` (${quest.text})` : ''}${step ? `, the step to bring forward: ${step.text}` : ''}`;
  return { kind: 'quest', text: `${quest.name}${step ? `: ${step.text}` : ''}`.slice(0, 140), detail: detail.slice(0, 700) };
}

/** What the page offers for ending a quest: the shifts that would be applied. */
export function closingShifts(quest, status) {
  return (status === 'done' ? quest?.reward : status === 'failed' ? quest?.penalty : null)?.shifts ?? [];
}

/** The line for the chronicle when a quest ends. */
export function closingLine(quest, status) {
  const word = status === 'done' ? 'выполнен' : status === 'failed' ? 'провален' : QUEST_LABELS[status] ?? status;
  const block = status === 'done' ? quest.reward : status === 'failed' ? quest.penalty : null;
  return `Квест «${quest.name}» ${word}${quest.outcome ? `: ${quest.outcome}` : ''}${block?.text ? ` (${block.text})` : ''}`.slice(0, 400);
}
