/**
 * The intimacy dice: a roll that gives the direction of one intimate scene, so scenes stop
 * coming out the same. It picks one option from each of several groups (who leads, pace, setting,
 * mood, conditions, a twist) and becomes a stage direction for the next reply.
 *
 * Rules that never bend:
 *   - the user's persona is never the one who leads: «who leads» is drawn only among the characters
 *     on stage that the model plays (the persona and the dead are out); with none of them there, the group is skipped;
 *   - the roll is a direction, the model adapts it to where the scene is and writes only its own characters;
 *   - when the kind of sex has the persona on the receiving or the asked side (oral on her, a request, a demand), the narrator
 *     writes the character's side only: the request, the pressure, the body language. Whether and how the persona answers is the user's.
 *
 * A group is either single (one pick) or multi (several picks at once: the kinds of sex combine). Picks can be set by hand
 * (togglePick), so a chosen option «burns»; the roll only fills the groups that are not locked.
 *
 * settings = { avoidRepeat, auto, groups: { [groupId]: { off, hidden: [optionId], custom: [{ id, text }] } }, history: [[ 'pace:tender', … ]] }
 * It lives in the extension settings (all chats). Pure: the randomness is passed in.
 */
import { uniqueId } from './ids.js';
import { groupsForRoll } from './intimacy-stage.js';

export const DICE_LIMITS = Object.freeze({ custom: 30, text: 400, history: 5 });
/** An option seen in this many last rolls is much less likely to come up again. */
const REPEAT_WEIGHT = 0.12;

const opt = (id, text, en) => ({ id, text, en });

/** The ready groups. `chance`: how often an optional group takes part in a roll (1 = always). */
export const DICE_GROUPS = Object.freeze([
  { id: 'initiative', label: 'Кто ведёт', icon: '👑', en: 'initiative', chance: 1, dynamic: true, options: [] },
  // How the scene begins. Rolled by its own button (the default) or, in the mode «по стадии», together with the early stages.
  { id: 'start', label: 'Начало', icon: '✨', en: 'how it begins', chance: 1, options: [
    opt('look', 'долгий взгляд, который затянулся', 'a look that lasts a beat too long'),
    opt('touch', 'случайное касание, которое не отдёргивают', 'an accidental touch that nobody pulls away from'),
    opt('pause', 'пауза посреди разговора, когда слова кончились', 'a pause in the middle of talk when the words run out'),
    opt('joke', 'шутка, которая вдруг перестала быть шуткой', 'a joke that suddenly stops being one'),
    opt('care', 'забота, которая стала слишком личной', 'an act of care that turns too personal'),
    opt('jealous', 'ревность, вырвавшаяся наружу', 'jealousy that breaks out'),
    opt('hug', 'объятие, которое не спешат разжимать', 'an embrace that nobody hurries to end'),
    opt('tension', 'напряжение после опасности или ссоры', 'tension left over after danger or a quarrel'),
    opt('straight', 'один из них говорит прямо, без намёков', 'one of them says it straight, with no hints'),
  ] },
  { id: 'act', label: 'Тип секса', icon: '🔥', en: 'kind of sex', chance: 1, multi: true, options: [
    opt('vaginal', 'вагинальный', 'vaginal sex'),
    opt('anal', 'анальный', 'anal sex'),
    opt('oral-gives', 'оральный: ласкает персону', 'oral sex: the character pleasures the user\'s character with their mouth (write only the character\'s actions; the user\'s character\'s reactions are for the user)'),
    opt('oral-asks', 'оральный: просит персону', 'oral sex: the character ASKS the user\'s character to go down on them (write the request, the wanting and the body language; stop where the user\'s character answers, whether and how they agree is for the user to write)'),
    opt('oral-demands', 'оральный: требует от персоны, нажимает', 'oral sex: the character DEMANDS it from the user\'s character and presses, in the character\'s own manner (write the pressure, the commands and the body language; whether and how the user\'s character gives in is for the user to write, never write their compliance)'),
    opt('oral-mutual', 'оральный взаимный', 'mutual oral sex (write only the character\'s side)'),
    opt('manual', 'руками, без проникновения', 'manual play, no penetration'),
    opt('frottage', 'тесно прижавшись, не раздеваясь', 'grinding against each other, mostly clothed'),
    opt('thighs', 'между бёдер', 'between the thighs'),
  ] },
  { id: 'pace', label: 'Темп', icon: '🕰', en: 'pace', chance: 1, options: [
    opt('tender', 'нежно, неторопливо', 'tender and unhurried'),
    opt('passionate', 'страстно, на одном дыхании', 'passionate, urgent'),
    opt('rough', 'грубо, жадно', 'rough and hungry'),
    opt('lazy', 'лениво, сонно', 'lazy, sleepy, half awake'),
    opt('playful', 'играючи, со смехом', 'playful, with laughter'),
    opt('slow', 'долго разогреваясь, с длинной прелюдией', 'a slow build with long foreplay'),
    opt('hurried', 'наспех', 'hurried, stolen minutes'),
  ] },
  { id: 'setting', label: 'Где и как', icon: '📍', en: 'setting', chance: 1, options: [
    opt('here', 'прямо там, где они сейчас', 'right where they are now'),
    opt('wall', 'у стены', 'against a wall'),
    opt('bed', 'в постели', 'in bed'),
    opt('couch', 'на диване', 'on a couch'),
    opt('floor', 'на полу', 'on the floor'),
    opt('table', 'на столе', 'on a table or desk'),
    opt('bath', 'в ванной или в душе', 'in the bathroom or the shower'),
    opt('kitchen', 'на кухне', 'in the kitchen'),
    opt('car', 'в машине', 'in a car'),
    opt('hidden', 'в укромном месте на улице', 'in a hidden spot outdoors'),
  ] },
  { id: 'mood', label: 'Настроение', icon: '🎭', en: 'mood', chance: 1, options: [
    opt('playful', 'игриво', 'playful'),
    opt('serious', 'серьёзно и нежно', 'serious and tender'),
    opt('jealous', 'с ревностью', 'jealous, possessive'),
    opt('makeup', 'после ссоры, мирясь', 'after a quarrel, making up'),
    opt('desperate', 'отчаянно, как в последний раз', 'desperate, as if for the last time'),
    opt('shy', 'смущённо, неловко', 'shy and awkward'),
    opt('teasing', 'поддразнивая, не спеша дать желаемое', 'teasing, withholding what is wanted'),
    opt('comfort', 'утешая', 'comforting'),
  ] },
  { id: 'conditions', label: 'Условия', icon: '🚪', en: 'conditions', chance: 0.5, multi: true, options: [
    opt('quiet', 'тихо, чтобы никто не услышал', 'quietly, so that nobody hears'),
    opt('short', 'мало времени', 'there is little time'),
    opt('caught', 'рядом могут застукать', 'there is a risk of being caught'),
    opt('clothed', 'почти одетыми', 'mostly clothed'),
    opt('dark', 'в темноте', 'in the dark'),
    opt('light', 'при свете, глядя друг на друга', 'in the light, eye contact'),
  ] },
  { id: 'twist', label: 'Поворот', icon: '🎲', en: 'twist', chance: 0.35, options: [
    opt('interrupt', 'что-то мешает или прерывает, но не обязательно срывает', 'something interrupts (a call, a noise) without necessarily ruining it'),
    opt('talk', 'посреди неожиданно откровенный разговор', 'a candid conversation in the middle of it'),
    opt('funny', 'неловкий или смешной момент', 'an awkward or funny moment'),
    opt('aftercare', 'главное в близости после, а не в самом акте', 'the weight is on the closeness afterwards, not on the act'),
    opt('new', 'пробуют что-то новое, о чём говорили раньше', 'they try something new that was talked about before'),
    opt('switch', 'роли неожиданно меняются', 'the roles unexpectedly switch'),
  ] },
]);

const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const groupIds = DICE_GROUPS.map(group => group.id);

export function normalizeDice(raw) {
  const groups = {};
  for (const id of groupIds) {
    const source = raw?.groups?.[id] ?? {};
    const seen = new Set();
    const custom = [];
    for (const item of Array.isArray(source.custom) ? source.custom : []) {
      const text = clip(item?.text, DICE_LIMITS.text);
      const customId = typeof item?.id === 'string' && item.id ? item.id : '';
      if (!text || !customId || seen.has(customId) || custom.length >= DICE_LIMITS.custom) continue;
      seen.add(customId);
      custom.push({ id: customId, text });
    }
    groups[id] = {
      off: source.off === true,
      hidden: [...new Set((Array.isArray(source.hidden) ? source.hidden : []).filter(value => typeof value === 'string'))],
      custom,
    };
  }
  const history = (Array.isArray(raw?.history) ? raw.history : []).slice(-DICE_LIMITS.history)
    .map(entry => (Array.isArray(entry) ? entry.filter(value => typeof value === 'string').slice(0, 12) : [])).filter(entry => entry.length);
  return { avoidRepeat: raw?.avoidRepeat !== false, autoRoll: raw?.autoRoll === true, rollMode: raw?.rollMode === 'stage' ? 'stage' : 'separate', groups, history };
}

/** patch: { avoidRepeat } | { clearHistory } | { group, off } | { group, option, hidden } | { group, addCustom } | { group, removeCustom }. */
export function updateDice(settings, patch = {}) {
  const next = JSON.parse(JSON.stringify(normalizeDice(settings)));
  if ('avoidRepeat' in patch) next.avoidRepeat = Boolean(patch.avoidRepeat);
  if ('autoRoll' in patch) next.autoRoll = Boolean(patch.autoRoll);
  if ('rollMode' in patch) next.rollMode = patch.rollMode === 'stage' ? 'stage' : 'separate';
  if (patch.clearHistory) next.history = [];
  const group = next.groups[patch.group];
  if (patch.group && !group) throw new Error('Не знаю такой группы.');
  if (group) {
    if ('off' in patch) group.off = Boolean(patch.off);
    if (patch.option) group.hidden = patch.hidden ? [...new Set([...group.hidden, patch.option])] : group.hidden.filter(id => id !== patch.option);
    if (patch.addCustom !== undefined) {
      const text = clip(patch.addCustom, DICE_LIMITS.text);
      if (!text) throw new Error('Впишите вариант.');
      if (group.custom.length >= DICE_LIMITS.custom) throw new Error(`В группе уже ${DICE_LIMITS.custom} своих вариантов.`);
      group.custom.push({ id: uniqueId('dice'), text });
    }
    if (patch.removeCustom) group.custom = group.custom.filter(item => item.id !== patch.removeCustom);
  }
  return next;
}

/** The options of a group as the roll sees them: ready ones minus hidden, plus the user's own. For initiative: the characters. */
export function optionsOf(settings, groupId, npcs = []) {
  const clean = normalizeDice(settings);
  const group = DICE_GROUPS.find(item => item.id === groupId);
  if (!group) return [];
  if (group.dynamic) return npcs.map(npc => ({ id: `npc:${npc.id}`, text: `ведёт ${npc.name}`, en: `${npc.name} takes the lead` }));
  const state = clean.groups[groupId];
  return [...group.options.filter(item => !state.hidden.includes(item.id)), ...state.custom.map(item => ({ id: item.id, text: item.text, en: item.text, custom: true }))];
}

/** All the options with the flags the settings page needs (hidden, custom). */
export function describeGroups(settings) {
  const clean = normalizeDice(settings);
  return DICE_GROUPS.filter(group => !group.dynamic).map(group => ({
    id: group.id, label: group.label, icon: group.icon, off: clean.groups[group.id].off,
    options: [...group.options.map(item => ({ id: item.id, text: item.text, hidden: clean.groups[group.id].hidden.includes(item.id) })),
      ...clean.groups[group.id].custom.map(item => ({ id: item.id, text: item.text, custom: true, hidden: false }))],
  }));
}

/** Keep the picks in the order of the groups; inside a group, in the order they were made. */
const inGroupOrder = picks => [...picks].sort((left, right) => groupIds.indexOf(left.group) - groupIds.indexOf(right.group));

const pickOf = (group, option) => ({ group: group.id, label: group.label, icon: group.icon, groupEn: group.en, id: option.id, text: option.text, en: option.en, ...(option.custom ? { custom: true } : {}) });

/**
 * Roll. npcs: [{ id, name }] the characters on stage the model plays (never the persona).
 * keep: picks that stay as they are (locked, or the other groups when one is re-rolled).
 * only: a group id: roll just that one (always, whatever the mode). stage: the running stage of the scene (core/intimacy-stage.js):
 * with rollMode 'stage' it decides which groups a full roll takes; by default «Начало» is left to its own button.
 * → [{ group, label, icon, groupEn, id, text, en }] in group order.
 */
export function rollDice(settings, { npcs = [], keep = [], only = '', stage = '', random = Math.random } = {}) {
  const clean = normalizeDice(settings);
  const allowed = only ? null : groupsForRoll(clean.rollMode, stage, groupIds);
  const recent = new Set(clean.avoidRepeat ? clean.history.slice(-3).flat() : []);
  const picks = [];
  for (const group of DICE_GROUPS) {
    if (clean.groups[group.id].off) continue;
    const held = keep.filter(pick => pick.group === group.id);
    if (held.length && group.id !== only) { picks.push(...held); continue; }
    if (only && group.id !== only) continue;
    if (allowed && !allowed.includes(group.id)) continue;
    const options = optionsOf(clean, group.id, npcs);
    if (!options.length) continue;
    // Optional groups join some of the rolls; asked for by hand, always.
    if (!only && group.chance < 1 && random() >= group.chance) continue;
    const weights = options.map(option => (recent.has(`${group.id}:${option.id}`) ? REPEAT_WEIGHT : 1));
    let at = random() * weights.reduce((sum, weight) => sum + weight, 0);
    let chosen = options.at(-1);
    for (let index = 0; index < options.length; index += 1) { at -= weights[index]; if (at < 0) { chosen = options[index]; break; } }
    picks.push(pickOf(group, chosen));
  }
  return inGroupOrder(picks);
}

/**
 * A chip pressed by hand: in a single group it replaces the pick (pressed again: clears it); in a multi group it joins or leaves.
 * → the new picks. An option that is not on offer (a stranger, the persona, a hidden one) changes nothing.
 */
export function togglePick(settings, picks, groupId, optionId, npcs = []) {
  const group = DICE_GROUPS.find(item => item.id === groupId);
  const option = group ? optionsOf(settings, groupId, npcs).find(item => item.id === optionId) : null;
  if (!group || !option) return picks;
  const here = picks.filter(pick => pick.group === groupId);
  const others = picks.filter(pick => pick.group !== groupId);
  if (here.some(pick => pick.id === optionId)) return inGroupOrder([...others, ...here.filter(pick => pick.id !== optionId)]);
  return inGroupOrder([...others, ...(group.multi ? here : []), pickOf(group, option)]);
}

/** What the drawer shows: every group that takes part, with the options that can come up (for «who leads»: the characters). */
export function viewGroups(settings, npcs = []) {
  const clean = normalizeDice(settings);
  return DICE_GROUPS.filter(group => !clean.groups[group.id].off).map(group => ({
    id: group.id, label: group.label, icon: group.icon, multi: Boolean(group.multi), optional: group.chance < 1, dynamic: Boolean(group.dynamic),
    options: optionsOf(clean, group.id, npcs).map(option => ({ id: option.id, text: option.text, custom: Boolean(option.custom) })),
  }));
}

/**
 * What becomes the stage direction: a short Russian line for the badge and the English detail for the narrator.
 * A pick marked `ahead` belongs to a later stage than the scene is at: it goes under «held back», so the narrator
 * does not write it yet. `stage`: the running stage id; the detail then also says to write only that stage.
 */
export function diceCue(picks, { stage = '' } = {}) {
  // The user's own wording is not a flavour: it has to show in the reply (inside the stage).
  const own = picks.filter(pick => pick.custom && !pick.ahead);
  const now = picks.filter(pick => !pick.ahead && !pick.custom);
  const held = picks.filter(pick => pick.ahead);
  const describe = list => {
    const order = [];
    for (const pick of list) if (!order.some(item => item.group === pick.group)) order.push({ group: pick.group, groupEn: pick.groupEn });
    return order.map(item => `${item.groupEn}: ${list.filter(pick => pick.group === item.group).map(pick => pick.en).join(' + ')}`).join('; ');
  };
  const parts = [
    stage ? `the scene is at the stage "${stage}": write only that stage` : '',
    describe(now),
    own.length ? `THE USER'S OWN REQUEST, it must visibly happen in this reply (inside the stage, in the character's own manner): ${own.map(pick => `${pick.groupEn}: ${pick.en}`).join('; ')}` : '',
    held.length ? `HELD BACK until the scene reaches that stage (lead up to it at most, do not write it yet): ${describe(held)}` : '',
  ].filter(Boolean);
  return {
    text: [...now.map(pick => pick.text), ...own.map(pick => pick.text), ...(held.length ? [`впереди: ${held.map(pick => pick.text).join(', ')}`] : [])].join(' · '),
    detail: parts.join('; '),
  };
}

/** Remember what was sent, so the next rolls move away from it. */
export function recordDice(settings, picks, { replaceLast = false } = {}) {
  const next = JSON.parse(JSON.stringify(normalizeDice(settings)));
  const kept = replaceLast ? next.history.slice(0, -1) : next.history;
  next.history = [...kept, picks.map(pick => `${pick.group}:${pick.id}`)].slice(-DICE_LIMITS.history);
  return next;
}
