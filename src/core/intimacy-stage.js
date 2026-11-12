/**
 * «Стадия близости»: на каком шаге сейчас интимная сцена. Нужна, чтобы рассказчик не пробегал сцену целиком
 * за один ответ: он пишет только текущую стадию и останавливается на пороге следующей.
 *
 * state.world.intimacy = { stage: 'spark'|'touch'|'kiss'|'undress'|'act'|'after', why?, note?, lock? } — нет записи = лесенка не запущена.
 * note — своя заметка к сцене одной фразой («пусть он замирает, когда она касается шеи»): уходит рассказчику со стадией.
 * Стадию ставит рука (шторка: «Дальше», «Назад», точка на лесенке), а летописец после ответа только ПРЕДЛАГАЕТ шаг вперёд
 * плашкой под ответом (см. stageStepProposal). Замок = летописец ничего не предлагает.
 *
 * Тот же набор стадий решает, какие группы кубика бросаются в режиме «по стадии» (groupsForRoll).
 */
export const INTIMACY_STAGES = Object.freeze([
  { id: 'spark', label: 'Искра', icon: '✨', hint: 'взгляды, пауза, первый намёк', ru: 'только искра: взгляды, пауза, первый намёк. Без поцелуя и раздевания.',
    rule: 'only the spark: looks, a charged pause, a first hint or a small move. No kiss, no undressing. Stop at the edge of the next stage and hand the turn to the user\'s character.' },
  { id: 'touch', label: 'Касания', icon: '🤝', hint: 'прикосновения, близость тел, одежда на месте', ru: 'только касания. Одежда на месте, без поцелуев.',
    rule: 'only touching, clothes on. No kiss yet. Stop before the first kiss and hand the turn over.' },
  { id: 'kiss', label: 'Поцелуи', icon: '💋', hint: 'поцелуи и объятия, одежда ещё на месте', ru: 'только поцелуи и объятия. Без раздевания.',
    rule: 'only kissing and embraces, clothes mostly on. Nobody undresses yet. Stop before that and hand the turn over.' },
  { id: 'undress', label: 'Раздевание', icon: '👗', hint: 'одежда снимается, ласки', ru: 'только раздевание и ласки. Сама близость ещё не началась.',
    rule: 'only undressing and caresses; the act has not begun. Stop before it and hand the turn over.' },
  { id: 'act', label: 'Близость', icon: '🔥', hint: 'сама близость', ru: 'сама близость: не спеша, подробно, без спешки к финалу.',
    rule: 'the act itself at the pace of the roll: slow, detailed, not rushed to the end and not wrapped up in one reply.' },
  { id: 'after', label: 'После', icon: '🌙', hint: 'затишье, разговор, нежность', ru: 'затишье после: дыхание, тепло, пара слов. Новый круг не начинать.',
    rule: 'the quiet afterwards: breath, warmth, a few words. No new round on your own.' },
]);

export const STAGE_IDS = Object.freeze(INTIMACY_STAGES.map(stage => stage.id));

export const stageOf = id => INTIMACY_STAGES.find(stage => stage.id === id) ?? null;
export const stageIndex = id => STAGE_IDS.indexOf(id);

/** A stored stage, tidy; null when it is empty or unknown. */
export function cleanStage(raw) {
  const stage = stageOf(raw?.stage);
  if (!stage) return null;
  const clean = { stage: stage.id };
  const why = String(raw?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (why) clean.why = why;
  const note = String(raw?.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (note) clean.note = note;
  if (raw?.lock) clean.lock = true;
  return clean;
}

/**
 * Operation payload → the new stage: { stage } sets, { delta: ±1 } steps (the first step from nothing starts at the first stage),
 * { lock } holds, { note } writes the user's own line (empty removes it), { clear } ends the scene. A step past the ends stays where it is.
 */
export function nextStage(current, payload) {
  if (payload?.clear) return null;
  let id = current?.stage ?? '';
  if (payload?.stage !== undefined) id = payload.stage;
  else if (payload?.delta) {
    const at = current ? stageIndex(current.stage) : -1;
    id = STAGE_IDS[Math.max(0, Math.min(STAGE_IDS.length - 1, at + Math.sign(Number(payload.delta))))];
  }
  return cleanStage({
    stage: id,
    why: payload?.why !== undefined ? payload.why : (payload?.stage !== undefined || payload?.delta ? '' : current?.why),
    note: payload?.note !== undefined ? payload.note : current?.note,
    lock: payload?.lock !== undefined ? payload.lock : current?.lock,
  });
}

/**
 * What the chronicler says the scene is at now → a proposal for the plaque (nothing is written): { from, to, why } or null.
 * With a stage already running it only proposes ONE step forward; with none it may name where the scene is.
 * A locked ladder, a flashback and a scene that is not intimate propose nothing.
 */
export function stageStepProposal(current, proposed, { flashback = false, intimate = true } = {}) {
  if (!proposed || flashback || !intimate || current?.lock) return null;
  const to = stageOf(proposed.stage)?.id;
  if (!to) return null;
  const from = current?.stage ?? null;
  if (from === null) return { from, to, why: proposed.why ?? '' };
  const forward = stageIndex(to) - stageIndex(from);
  if (forward <= 0) return null;
  return { from, to: STAGE_IDS[stageIndex(from) + 1], why: proposed.why ?? '' };
}

/** The line for the scene block, or '' when no stage is running. */
export function stageLine(intimacy) {
  const stage = stageOf(intimacy?.stage);
  if (!stage) return '';
  return `intimacy stage: ${stageIndex(stage.id) + 1}/${STAGE_IDS.length} ${stage.id}${intimacy.why ? ` (${intimacy.why})` : ''} — write ${stage.rule}${intimacy.note ? ` The user\'s note for this scene: "${intimacy.note}".` : ''}`;
}

export const STAGE_RULE = '- intimacy stage: write only that stage, one step of it per reply; never run through several stages in one reply or jump ahead to the act or the finish. The user moves the stage, so do not push it. The dice details (kind of sex, setting, pace) apply only once the scene reaches that stage.';

/** The groups of the dice that a roll includes at a stage (the mode «по стадии»); `null` = all. */
const STAGE_GROUPS = Object.freeze({
  spark: ['initiative', 'start', 'mood'],
  touch: ['initiative', 'start', 'mood', 'pace'],
  kiss: ['initiative', 'mood', 'pace', 'setting'],
  undress: ['initiative', 'act', 'pace', 'setting', 'mood', 'conditions'],
  act: ['initiative', 'act', 'pace', 'setting', 'mood', 'conditions', 'twist'],
  after: ['mood', 'twist'],
});

/**
 * Which groups a full roll takes: the ones that fit the running stage (no stage: all of them; in the mode «по стадии»
 * the spark). «Начало» is left to its own button unless the mode is «по стадии». Asked for one group by hand, it always rolls.
 */
export function groupsForRoll(mode, stageId, allIds) {
  const known = stageOf(stageId)?.id;
  const base = known ? STAGE_GROUPS[known] : mode === 'stage' ? STAGE_GROUPS.spark : null;
  const ids = base ? allIds.filter(id => base.includes(id)) : allIds;
  return mode === 'stage' ? ids : ids.filter(id => id !== 'start');
}

/**
 * The groups that belong to a LATER stage than this one: what a pick from them means is «ahead of the scene».
 * The narrator is told to lead up to it at most; it comes alive when the stage moves (or the user releases it).
 */
export function aheadGroups(stageId) {
  const at = stageIndex(stageId);
  if (at < 0) return [];
  const now = new Set(STAGE_GROUPS[STAGE_IDS[at]]);
  const later = new Set(STAGE_IDS.slice(at + 1).flatMap(id => STAGE_GROUPS[id]));
  return [...later].filter(id => !now.has(id));
}
