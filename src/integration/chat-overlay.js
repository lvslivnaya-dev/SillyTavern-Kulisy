/**
 * Kulisy inside SillyTavern's own chat, outside the Studio:
 *   - the scene drawer above the message box: who is on stage, and the stage directions
 *     («пнуть» a character, a scene event). Opened, it stays open until its arrow is clicked;
 *   - a note under a reply where the chronicler found a leak, with its three answers;
 *   - a note under a reply where a character seems to die: mark it, or not;
 *   - a note under a reply where someone seems to learn a lorebook secret: mark it, or not;
 *   - a note under a reply where the chronicler thinks something is a secret: open the window to check it, or not.
 *
 * It lives in ST's DOM (not a shadow root), so it is styled by style.css with
 * ST theme variables only. All markup is built with textContent: names and
 * quotes come from the chat and are never parsed as HTML.
 */
const CHIPS_ID = 'ku-scene-chips';
const STRIP_ID = 'ku-scene-strip';
const SETUP_ID = 'ku-setup-banner';

const LEAK_CLASS = 'ku-leak';
const SLIP_CLASS = 'ku-slip';
const DEATH_CLASS = 'ku-death-note-chat';
const QUEST_HINT_CLASS = 'ku-quest-note-chat';
const REVEAL_CLASS = 'ku-reveal-note';
const SECRET_HINT_CLASS = 'ku-secret-hint';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
}

function actionButton(label, action, data, title) {
  const button = node('button', 'menu_button ku-leak-button', label);
  button.type = 'button';
  button.dataset.kuAction = action;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
  if (title) button.title = title;
  return button;
}

import { WEATHER_KINDS, WEATHER_KIND_IDS } from '../core/weather.js';
import { EVENT_GENRES } from '../core/direction.js';

const MODE_LABEL = { calm: 'Быт', fight: 'Бой', intim: 'Близость' };
const MODE_MARK = { calm: '☕', fight: '⚔', intim: '🔥' };
const MODE_HINT = {
  calm: 'Обычная сцена: быт и разговор',
  fight: 'Бой: модели уходят боевые разделы анкет',
  intim: 'Близость: модели уходят разделы анкет для интимных сцен',
};

function chipButton(text, action, data = {}, title = '', className = 'ku-dir-btn') {
  const button = node('button', className, text);
  button.type = 'button';
  button.dataset.kuAction = action;
  for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
  if (title) button.title = title;
  return button;
}

/**
 * view = {
 *   chips: boolean,                       // the setting
 *   cast: [{ id, name, present, persona, silent, badges }],
 *   dice: { groups: [{ id, label, icon, multi, options: [{ id, text, custom }] }], picks: [{ group, id, text }], locked: [groupId], sent } | null,
 *   clock: { time: 'HH:MM', day, label },            // the story clock the «Время» panel edits
 *   weather: { kind, temp, source, badge } | null,   // the weather in force; the drawer shows it and sets it
 *   sceneMode: 'calm' | 'fight' | 'intim',   // the kind of scene (decides which lorebook sections go out)
 *   location: string, time: string, secrets: number, waitingReveals: number,
 *   director: { open, silenceAfter, hotkeys, canKick, favorites: [text],
 *               cues: [{ id, entityId, label, badge, used, wait }], others: [{ id, name }] },
 *   leaks: [{ messageIndex, entityId, eventId, name, eventText, quote, canSwipe }],
 * }
 * describe(id) → { persona, present, name, reactTargets: [{ id, name }],
 *                  lines: [{ targetId, targetName, factors: [{ label, text }] }],
 *                  secrets: [{ eventId, label, text }] }
 * eventIdeas() → [text]: today's calendar events, offered as ready scene events.
 */
export function mountChatOverlay({ onDiceRelease, onStage, onHeat, onQuestHint, onQuestStep, onSong, onQuestPush, onDiceRoll, onDiceToggle, onDiceLock, onDiceAdd, onDiceSend, onDiceClear, onSetTime, onWeather, onSceneMode, onTogglePresent, onLeak, onSlip, onDeath, onReveal, onSecretHint, onOpenStudio, onSetupOff,
  onCue, onRemoveCue, onKickNow, onToggleOpen, onFavorite, describe, eventIdeas }) {
  // The panel's own state: what is selected and typed survives every re-render.
  const fresh = () => ({ stageNote: null, diceAdd: '', diceDraft: '', clock: null, selected: '', pane: '', wait: 0, draft: '', eventDraft: '', sceneDraft: '', noteDraft: '', placeDraft: '', placeId: '', skip: 'none', sceneCast: [], songFind: '' });
  const ui = fresh();
  let lastView = null;
  const snoozed = new Set(); // chats whose setup reminder was put off until the page is reloaded
  let lastMenu = null;

  const resetMenu = () => Object.assign(ui, fresh());
  /** Arm a cue; then (optionally) send right away, like «▶ Пнуть сейчас». */
  const arm = (cue, { now = false } = {}) => {
    Promise.resolve(onCue?.({ ...cue, wait: ui.wait })).then(ok => {
      if (ok === false) return;
      resetMenu();
      rerender();
      if (now) onKickNow?.();
    }).catch(error => console.error('[Kulisy] Cue failed.', error));
  };
  const sceneCue = () => {
    const place = ui.placeDraft.trim();
    const known = (lastView?.director?.places ?? []).find(item => item.id === ui.placeId);
    return {
      kind: 'scene', text: ui.sceneDraft.trim(), skip: ui.skip, castIds: [...ui.sceneCast],
      ...(known ? { placeId: known.id, place: place || known.name } : place ? { place } : {}),
    };
  };

  /** The drafts of the «Время» panel; they start from the clock and survive re-renders. */
  const clockDraft = () => {
    ui.clock ??= { time: lastView?.clock?.time ?? '', day: lastView?.clock?.day ? String(lastView.clock.day) : '', label: lastView?.clock?.label ?? '' };
    return ui.clock;
  };
  function saveClock() {
    const draft = clockDraft();
    Promise.resolve(onSetTime?.({ time: draft.time.trim(), day: draft.day.trim(), label: draft.label.trim() }))
      .then(ok => { if (ok !== false) { ui.clock = null; rerender(); } });
  }
  /** «+1 ч»: whole minutes forward; past midnight the day goes up too (when the day is known). */
  function shiftClock(minutes) {
    const draft = clockDraft();
    const match = /^(\d{1,2}):(\d{2})$/.exec(draft.time.trim());
    if (!match || !Number.isFinite(minutes)) return;
    const total = Number(match[1]) * 60 + Number(match[2]) + minutes;
    const days = Math.floor(total / 1440);
    const within = ((total % 1440) + 1440) % 1440;
    draft.time = `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
    if (days && Number(draft.day) > 0) draft.day = String(Number(draft.day) + days);
    saveClock();
  }

  function directorAction(action, data) {
    switch (action) {
      case 'dir-weather': Promise.resolve(onWeather?.({ kind: data.kind, lock: lastView?.weather?.source === 'lock' })).then(() => rerender()); return true;
      case 'dir-weather-lock': Promise.resolve(onWeather?.({ kind: lastView?.weather?.kind, temp: lastView?.weather?.temp, lock: lastView?.weather?.source !== 'lock' })).then(() => rerender()); return true;
      case 'dir-dice-roll': Promise.resolve(onDiceRoll?.({ only: data.group || '' })).then(() => rerender()); return true;
      case 'dir-dice-pick': Promise.resolve(onDiceToggle?.({ group: data.group, option: data.option })).then(() => rerender()); return true;
      case 'dir-dice-lock': Promise.resolve(onDiceLock?.({ group: data.group })).then(() => rerender()); return true;
      case 'dir-heat': {
        const payload = data.value !== undefined ? { value: Number(data.value) } : { delta: Number(data.delta) };
        Promise.resolve(onHeat?.(payload)).then(() => rerender());
        return true;
      }
      case 'dir-dice-release': Promise.resolve(onDiceRelease?.({ group: data.group, option: data.option })).then(() => rerender()); return true;
      case 'dir-stage-note': {
        const text = (ui.stageNote ?? lastView?.dice?.stage?.note ?? '').trim();
        Promise.resolve(onStage?.({ note: text })).then(() => { ui.stageNote = null; rerender(); });
        return true;
      }
      case 'dir-stage': Promise.resolve(onStage?.({ stage: data.stage })).then(() => rerender()); return true;
      case 'dir-stage-step': Promise.resolve(onStage?.({ delta: Number(data.delta) })).then(() => rerender()); return true;
      case 'dir-stage-lock': Promise.resolve(onStage?.({ lock: !lastView?.dice?.stage?.lock })).then(() => rerender()); return true;
      case 'dir-stage-clear': Promise.resolve(onStage?.({ clear: true })).then(() => rerender()); return true;
      case 'dir-heat-lock': Promise.resolve(onHeat?.({ lock: !lastView?.heat?.lock })).then(() => rerender()); return true;
      case 'dir-heat-clear': Promise.resolve(onHeat?.({ clear: true })).then(() => rerender()); return true;
      case 'dir-quest-step': Promise.resolve(onQuestStep?.({ questId: data.questId, stepId: data.stepId, done: true })).then(() => rerender()); return true;
      case 'dir-song-pin': Promise.resolve(onSong?.({ op: 'pin', songId: data.songId, mode: data.mode || 'sound', singerId: data.singerId || '' })).then(() => rerender()); return true;
      case 'dir-song-unpin': Promise.resolve(onSong?.({ op: 'unpin', songId: data.songId })).then(() => rerender()); return true;
      case 'dir-song-mute': Promise.resolve(onSong?.({ op: 'mute', songId: data.songId })).then(() => rerender()); return true;
      case 'dir-song-unmute': Promise.resolve(onSong?.({ op: 'unmute', songId: data.songId })).then(() => rerender()); return true;
      case 'dir-quest-push': Promise.resolve(onQuestPush?.({ questId: data.questId })).then(() => rerender()); return true;
      case 'dir-dice-send': Promise.resolve(onDiceSend?.()).then(() => rerender()); return true;
      case 'dir-dice-clear': Promise.resolve(onDiceClear?.()).then(() => rerender()); return true;
      case 'dir-dice-add-open': ui.diceAdd = ui.diceAdd === data.group ? '' : data.group; ui.diceDraft = ''; rerender(); return true;
      case 'dir-dice-add-save': {
        const text = ui.diceDraft.trim();
        if (!text) return true;
        const group = ui.diceAdd;
        Promise.resolve(onDiceAdd?.({ group, text })).then(() => { ui.diceAdd = ''; ui.diceDraft = ''; rerender(); });
        return true;
      }
      case 'dir-clock-save': saveClock(); return true;
      case 'dir-clock-shift': shiftClock(Number(data.minutes)); return true;
      case 'dir-mode': Promise.resolve(onSceneMode?.(data.mode)).then(() => rerender()); return true;
      case 'dir-toggle': onToggleOpen?.(!lastView?.director?.open); return true;
      case 'dir-select':
        if (ui.selected === data.entityId) resetMenu(); else Object.assign(ui, { selected: data.entityId, pane: '', draft: '' });
        rerender();
        return true;
      case 'dir-pane': {
        const open = Boolean(lastView?.director?.open);
        // The tab that is already on: a second press folds the panel back into the rail.
        if (open && !ui.selected && (ui.pane || 'who') === data.pane) { onToggleOpen?.(false); return true; }
        ui.pane = data.pane;
        if (['event', 'others', 'scene', 'note', 'who', 'weather', 'mode', 'time', 'dice', 'quests', 'songs', 'heat'].includes(data.pane)) ui.selected = '';
        if (data.pane === 'time') ui.clock = null;
        if (!open) onToggleOpen?.(true);
        rerender();
        return true;
      }
      case 'dir-wait': ui.wait = Number(data.wait) || 0; rerender(); return true;
      case 'dir-cue': {
        const cue = { kind: data.kind, entityId: ui.selected };
        if (data.target) cue.targetId = data.target;
        if (data.kind === 'factor') {
          const factor = lastMenu?.lines?.[Number(data.line)]?.factors?.[Number(data.index)];
          if (!factor) return true;
          const line = lastMenu.lines[Number(data.line)];
          Object.assign(cue, { targetId: line.targetId, text: factor.text, label: factor.label });
          if (line.side === 'out') cue.side = 'out';
        }
        if (data.kind === 'secret') {
          const secret = lastMenu?.secrets?.[Number(data.index)];
          if (!secret) return true;
          Object.assign(cue, { eventId: secret.eventId, text: secret.text, label: secret.label });
        }
        if (data.kind === 'event') { delete cue.entityId; if (data.text) cue.text = data.text; if (data.genre) cue.genre = data.genre; }
        arm(cue);
        return true;
      }
      case 'dir-custom': {
        const text = (data.text ?? ui.draft).trim();
        if (text) arm({ kind: 'custom', entityId: ui.selected, text });
        return true;
      }
      case 'dir-event-custom': {
        const text = ui.eventDraft.trim();
        if (text) arm({ kind: 'event', text });
        return true;
      }
      case 'dir-scene': arm(sceneCue(), { now: data.now === 'true' }); return true;
      case 'dir-skip': ui.skip = data.skip; rerender(); return true;
      case 'dir-cast': {
        const id = data.entityId;
        ui.sceneCast = ui.sceneCast.includes(id) ? ui.sceneCast.filter(item => item !== id) : [...ui.sceneCast, id];
        rerender();
        return true;
      }
      case 'dir-note': {
        const text = ui.noteDraft.trim();
        if (text) arm({ kind: 'note', text });
        return true;
      }
      case 'dir-fav-save': if (ui.draft.trim()) onFavorite?.(ui.draft.trim(), true); return true;
      case 'dir-fav-del': onFavorite?.(data.text, false); return true;
      case 'dir-remove': onRemoveCue?.(data.cueId); return true;
      case 'dir-kick': onKickNow?.(); return true;
      default: return false;
    }
  }

  const onClick = event => {
    const target = event.target instanceof Element ? event.target.closest('[data-ku-action]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const { kuAction: action, entityId, eventId, messageIndex, slipIndex } = target.dataset;
    try {
      if (action.startsWith('dir-')) directorAction(action, target.dataset);
      else if (action === 'present') onTogglePresent(entityId, target.dataset.present !== 'true');
      else if (action === 'studio') onOpenStudio?.(target.dataset.tab);
      else if (action === 'setup-later') { snoozed.add(target.dataset.chat ?? ''); if (lastView) renderSetupBanner(lastView); }
      else if (action === 'setup-off') onSetupOff?.();
      else if (action.startsWith('reveal-')) onReveal?.(action.slice(7), { messageIndex: Number(messageIndex), entityId, eventId });
      else if (action.startsWith('secret-')) onSecretHint?.(action.slice(7), { messageIndex: Number(messageIndex), eventId });
      else if (action.startsWith('quest-')) onQuestHint?.(action.slice(6), { messageIndex: Number(messageIndex), hintId: target.dataset.hintId });
      else if (action.startsWith('death-')) onDeath?.(action.slice(6), { messageIndex: Number(messageIndex), entityId });
      else if (action.startsWith('slip-')) onSlip?.(action.slice(5), { messageIndex: Number(messageIndex), slipIndex: Number(slipIndex) });
      else onLeak(action, { messageIndex: Number(messageIndex), entityId, eventId });
    } catch (error) {
      console.error('[Kulisy] Chat overlay action failed.', error);
    }
  };
  document.addEventListener('click', onClick, true);

  // Typing in the panel's fields: kept in ui, Enter sends.
  const onInput = event => {
    const field = event.target?.dataset?.kuField;
    if (field === 'custom') ui.draft = event.target.value;
    if (field === 'event') ui.eventDraft = event.target.value;
    if (field === 'scene') ui.sceneDraft = event.target.value;
    if (field === 'note') ui.noteDraft = event.target.value;
    if (field === 'place') ui.placeDraft = event.target.value;
    if (field === 'song-find') { ui.songFind = event.target.value; rerender(); }
    if (field === 'dice-add') ui.diceDraft = event.target.value;
    if (field === 'stage-note') ui.stageNote = event.target.value;
    if (field === 'clock-time') clockDraft().time = event.target.value;
    if (field === 'clock-day') clockDraft().day = event.target.value;
    if (field === 'clock-label') clockDraft().label = event.target.value;
    if (field === 'place-id') {
      ui.placeId = event.target.value;
      const place = (lastView?.director?.places ?? []).find(item => item.id === ui.placeId);
      ui.placeDraft = place ? place.name : '';
      rerender();
    }
  };
  // Enter sends from one-line fields; the scene's text is a textarea, Enter there is a new line.
  const ENTER_ACTIONS = { custom: 'dir-custom', event: 'dir-event-custom', note: 'dir-note', 'dice-add': 'dir-dice-add-save', 'stage-note': 'dir-stage-note', 'clock-time': 'dir-clock-save', 'clock-day': 'dir-clock-save', 'clock-label': 'dir-clock-save' };
  const onKey = event => {
    const action = ENTER_ACTIONS[event.target?.dataset?.kuField];
    if (action && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      directorAction(action, {});
    }
  };
  // Alt+1…9: the n-th character on stage steps in (again: the kick is taken back).
  const onHotkey = event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const digit = /^Digit([1-9])$/.exec(event.code ?? '')?.[1];
    if (!digit || !lastView?.chips || !lastView.director?.hotkeys) return;
    const kickable = lastView.cast.filter(person => person.present && !person.persona);
    const person = kickable[Number(digit) - 1];
    if (!person) return;
    event.preventDefault();
    event.stopPropagation();
    const armed = (lastView.director.cues ?? []).find(cue => cue.kind === 'enter' && cue.entityId === person.id && !cue.used);
    if (armed) onRemoveCue?.(armed.id);
    else Promise.resolve(onCue?.({ kind: 'enter', entityId: person.id, wait: 0 })).catch(error => console.error('[Kulisy] Hotkey cue failed.', error));
  };
  document.addEventListener('keydown', onHotkey, true);

  function rerender() { if (lastView) renderChips(lastView); }

  function pill(text, title, tab = 'scene') {
    return chipButton(text, 'studio', { tab }, title, 'ku-chips-place');
  }

  function personChip(person, director) {
    const chip = chipButton('', 'dir-select', { entityId: person.id }, '', `ku-chip${person.present ? ' on' : ''}${ui.selected === person.id ? ' selected' : ''}`);
    chip.setAttribute('aria-pressed', String(ui.selected === person.id));
    chip.append(node('span', 'ku-chip-name', person.name));
    if (person.persona) chip.append(node('span', 'ku-chip-note', 'персона'));
    for (const cue of (director.cues ?? []).filter(item => item.entityId === person.id)) {
      const badge = node('span', `ku-chip-badge${cue.used ? ' used' : ''}`, `${cue.wait ? `⏳${cue.wait}` : ''}${cue.badge}`);
      badge.title = cue.used ? `${cue.label} — действует для свайпов этого ответа` : cue.label;
      chip.append(badge);
    }
    const sleepy = person.present && !person.persona && director.silenceAfter > 0 && person.silent >= director.silenceAfter;
    if (sleepy) {
      chip.classList.add('sleepy');
      chip.append(node('span', 'ku-chip-badge', `💤${person.silent}`));
    }
    chip.title = [
      person.present ? `${person.name}: на сцене` : `${person.name}: не на сцене`,
      sleepy ? `молчит уже ${person.silent} ${person.silent < 5 ? 'хода' : 'ходов'}` : '',
      'нажмите — что сделать',
    ].filter(Boolean).join(' · ');
    return chip;
  }

  function waitRow() {
    const row = node('div', 'ku-dir-row ku-dir-when');
    row.append(node('span', 'ku-dir-caption', 'Когда:'));
    for (const [value, text] of [[0, 'в этом ответе'], [1, 'через 1'], [2, 'через 2'], [3, 'через 3']]) {
      const button = chipButton(text, 'dir-wait', { wait: value }, value ? `Пропустить ${value} ${value === 1 ? 'ответ' : 'ответа'}, потом сработать` : 'В следующем ответе', `ku-dir-seg${ui.wait === value ? ' on' : ''}`);
      row.append(button);
    }
    return row;
  }

  function textField(field, value, placeholder) {
    const input = node('input', 'text_pole ku-dir-input');
    input.type = 'text';
    input.dataset.kuField = field;
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = 400;
    return input;
  }

  function characterMenu(director) {
    let info = null;
    try { info = describe?.(ui.selected) ?? null; } catch (error) { console.error('[Kulisy] Character menu failed.', error); }
    lastMenu = info;
    if (!info) { ui.selected = ''; return null; }
    const card = node('div', 'ku-dir-card');
    const head = node('div', 'ku-dir-card-head');
    head.append(node('b', null, info.name), node('span', 'ku-dir-caption', info.present ? 'на сцене' : 'не на сцене'));
    card.append(head);
    const presentToggle = chipButton(info.present ? '✖ Убрать тихо' : '➕ Отметить тихо', 'present', { entityId: ui.selected, present: info.present },
      info.present ? 'Просто снять с площадки, рассказчику ничего не говорить' : 'Просто отметить на площадке, рассказчику ничего не говорить');
    if (info.persona) {
      card.append(node('p', 'ku-dir-caption', 'Персону не пинают: за неё играешь ты.'), presentToggle);
      return card;
    }
    const row = node('div', 'ku-dir-row');
    if (info.present) {
      row.append(
        chipButton('👟 Вступить', 'dir-cue', { kind: 'enter' }, 'Сам заговорит или что-то сделает'),
        chipButton('💬 Отреагировать…', 'dir-pane', { pane: 'react' }, 'На кого-то из сцены или на последнюю реплику', `ku-dir-btn${ui.pane === 'react' ? ' on' : ''}`),
        chipButton('✍ Своё…', 'dir-pane', { pane: 'custom' }, 'Написать, что ему сделать', `ku-dir-btn${ui.pane === 'custom' ? ' on' : ''}`),
      );
      if (info.lines.length) row.append(chipButton('❤ Двинуть отношения…', 'dir-pane', { pane: 'factor' }, 'Поступок из факторов роста линии', `ku-dir-btn${ui.pane === 'factor' ? ' on' : ''}`));
      if (info.secrets.length) row.append(chipButton('🔒 На грани секрета…', 'dir-pane', { pane: 'secret' }, 'Почти проговорится, но не раскроет', `ku-dir-btn${ui.pane === 'secret' ? ' on' : ''}`));
      const quiet = node('div', 'ku-dir-row');
      quiet.append(
        chipButton('🤐 Молчит', 'dir-cue', { kind: 'hold' }, 'В сцене, но в этом ответе без реплик'),
        chipButton('🎯 Только он', 'dir-cue', { kind: 'focus' }, 'Ответ про него, остальные на фоне'),
        chipButton('🚪 Увести', 'dir-cue', { kind: 'leave' }, 'Уйдёт со сцены с понятной причиной'),
        presentToggle,
      );
      card.append(row, quiet);
    } else {
      row.append(chipButton('🚪 Позвать в сцену', 'dir-cue', { kind: 'call' }, 'Рассказчик введёт его и объяснит, откуда он взялся'), presentToggle);
      card.append(row);
    }
    if (ui.pane === 'react') {
      const targets = node('div', 'ku-dir-row ku-dir-sub');
      targets.append(chipButton('на последнее', 'dir-cue', { kind: 'react', target: 'last' }, 'На то, что только что произошло'));
      for (const target of info.reactTargets) targets.append(chipButton(target.name, 'dir-cue', { kind: 'react', target: target.id }));
      card.append(targets);
    }
    if (ui.pane === 'custom') {
      const sub = node('div', 'ku-dir-sub');
      const line = node('div', 'ku-dir-row ku-dir-field');
      line.append(textField('custom', ui.draft, 'пусть приревнует…'),
        chipButton('👟', 'dir-custom', {}, 'Пнуть с этим текстом (Enter)'),
        chipButton('⭐', 'dir-fav-save', {}, 'Сохранить в избранные'));
      sub.append(line);
      if (director.favorites?.length) {
        const favorites = node('div', 'ku-dir-row');
        for (const text of director.favorites) {
          const item = node('span', 'ku-dir-fav');
          item.append(chipButton(text, 'dir-custom', { text }, 'Пнуть с этим текстом', 'ku-dir-fav-text'), chipButton('×', 'dir-fav-del', { text }, 'Убрать из избранных', 'ku-dir-fav-del'));
          favorites.append(item);
        }
        sub.append(favorites);
      }
      card.append(sub);
    }
    if (ui.pane === 'factor') {
      const sub = node('div', 'ku-dir-sub');
      info.lines.forEach((line, lineIndex) => {
        sub.append(node('div', 'ku-dir-caption', line.side === 'out'
          ? `Его линия к ${line.targetName} — будет открыт к такому моменту:`
          : `Что он может сделать, чтобы сдвинулся ${line.targetName}:`));
        const row2 = node('div', 'ku-dir-row');
        line.factors.forEach((factor, index) => row2.append(chipButton(factor.label, 'dir-cue', { kind: 'factor', line: lineIndex, index }, factor.text)));
        sub.append(row2);
      });
      card.append(sub);
    }
    if (ui.pane === 'secret') {
      const sub = node('div', 'ku-dir-row ku-dir-sub');
      info.secrets.forEach((secret, index) => sub.append(chipButton(`🔒 ${secret.label}`, 'dir-cue', { kind: 'secret', index }, secret.text)));
      card.append(sub);
    }
    card.append(waitRow());
    return card;
  }

  function eventMenu() {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '⚡ Событие сцены'));
    const row = node('div', 'ku-dir-row');
    row.append(chipButton('🎲 Что-нибудь случится', 'dir-cue', { kind: 'event' }, 'Рассказчик сам выберет: звонок, гость, погода, шум, новость'));
    const genres = node('div', 'ku-dir-row ku-dir-genres');
    genres.append(node('span', 'ku-dir-caption', 'Жанр:'));
    for (const [id, genre] of Object.entries(EVENT_GENRES)) genres.append(chipButton(`${genre.icon} ${genre.label}`, 'dir-cue', { kind: 'event', genre: id }, `Пусть в сцене случится: ${genre.label.toLowerCase()}`));
    let ideas = [];
    try { ideas = eventIdeas?.() ?? []; } catch (error) { console.error('[Kulisy] Calendar ideas failed.', error); }
    for (const text of ideas) row.append(chipButton(`📅 ${text}`, 'dir-cue', { kind: 'event', text }, 'Из календаря на сегодня'));
    const field = node('div', 'ku-dir-row ku-dir-field');
    field.append(textField('event', ui.eventDraft, 'в дверь звонят…'), chipButton('⚡', 'dir-event-custom', {}, 'Пусть случится это (Enter)'));
    card.append(row, genres, field, waitRow());
    return card;
  }

  function sceneMenu(director) {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '🎬 Начать новую сцену'));
    const text = node('textarea', 'text_pole ku-dir-input ku-dir-textarea');
    text.dataset.kuField = 'scene';
    text.rows = 3;
    text.maxLength = 1200;
    text.placeholder = 'с чего начать: утро после драки, Зоро чинит катану на палубе, Нами ругается из-за долгов… (можно пусто — рассказчик решит сам)';
    text.value = ui.sceneDraft;
    const when = node('div', 'ku-dir-row');
    when.append(node('span', 'ku-dir-caption', 'Когда:'));
    for (const [value, label] of [['none', 'сразу'], ['hour', 'через час'], ['evening', 'вечером'], ['nextday', 'на следующий день'], ['week', 'неделю спустя']]) {
      when.append(chipButton(label, 'dir-skip', { skip: value }, '', `ku-dir-seg${ui.skip === value ? ' on' : ''}`));
    }
    const where = node('div', 'ku-dir-row ku-dir-field');
    where.append(node('span', 'ku-dir-caption', 'Где:'));
    if (director.places?.length) {
      const select = node('select', 'text_pole ku-dir-select');
      select.dataset.kuField = 'place-id';
      select.setAttribute('aria-label', 'Место из чата');
      select.append(node('option', null, '— место чата —'));
      select.firstChild.value = '';
      for (const place of director.places) {
        const option = node('option', null, place.name);
        option.value = place.id;
        option.selected = place.id === ui.placeId;
        select.append(option);
      }
      where.append(select);
    }
    where.append(textField('place', ui.placeDraft, 'или словами: камбуз «Санни»'));
    const who = node('div', 'ku-dir-row');
    who.append(node('span', 'ku-dir-caption', 'Кто:'));
    for (const person of director.people ?? []) {
      const on = ui.sceneCast.includes(person.id);
      const chip = chipButton(`${on ? '✓ ' : ''}${person.name}`, 'dir-cast', { entityId: person.id }, on ? 'Убрать из сцены' : 'Будет в сцене', `ku-chip${on ? ' on' : ''}`);
      chip.setAttribute('aria-pressed', String(on));
      who.append(chip);
    }
    who.append(node('span', 'ku-dir-caption', ui.sceneCast.length ? '' : '(не отмечено — решит рассказчик)'));
    const go = node('div', 'ku-dir-row');
    go.append(
      chipButton('🎬 С моим постом', 'dir-scene', { now: false }, 'Уйдёт вместе с твоим следующим постом'),
      chipButton('▶ Начать сейчас', 'dir-scene', { now: true }, 'Отправить сразу: с текстом из поля ввода, а если оно пустое — рассказчик начнёт сам', 'ku-dir-btn ku-dir-kick'),
    );
    card.append(text, when, where, who, go);
    return card;
  }

  function noteMenu() {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', '📝 Рассказчику'));
    card.append(node('div', 'ku-dir-caption', 'Указание на следующий ответ: «короче», «больше атмосферы, меньше диалогов», «пусть ночь будет дождливой».'));
    const field = node('div', 'ku-dir-row ku-dir-field');
    field.append(textField('note', ui.noteDraft, 'что сказать рассказчику…'), chipButton('📝', 'dir-note', {}, 'Добавить (Enter)'));
    card.append(field, waitRow());
    return card;
  }

  function othersMenu(director) {
    const card = node('div', 'ku-dir-card');
    card.append(node('div', 'ku-dir-card-head', 'Кого позвать'));
    const row = node('div', 'ku-dir-row');
    if (!director.others?.length) row.append(node('span', 'ku-dir-caption', 'Все известные персонажи уже здесь.'));
    for (const person of director.others ?? []) row.append(chipButton(person.name, 'dir-select', { entityId: person.id }, 'Выбрать'));
    card.append(row);
    return card;
  }

  /** The dice window's content: the ladder of the scene, the roll, the groups with their chips. */
  function diceCard(view) {
    const dice = view.dice ?? { groups: [], picks: [], locked: [], sent: false };
    const card = node('div', 'ku-dir-card ku-dir-dice');
    const ladderCol = node('div', 'ku-dice-ladder');
    const rollCol = node('div', 'ku-dice-rollcol');
    const foot = node('div', 'ku-dice-foot');
      // The ladder: where the scene stands. The narrator writes only that stage (core/intimacy-stage.js).
    if (dice.stage) {
      const stage = dice.stage;
      const ladder = node('div', 'ku-dir-row ku-stage-row');
      ladder.append(node('span', 'ku-dir-caption ku-dice-label', 'Стадия'));
      const chips = node('span', 'ku-dice-chips');
      for (const item of stage.stages) {
        const on = item.id === stage.id;
        const chip = chipButton(`${item.icon} ${item.label}`, 'dir-stage', { stage: item.id }, item.hint, `ku-dir-btn ku-stage-chip${on ? ' on' : ''}`);
        chip.setAttribute('aria-pressed', String(on));
        chips.append(chip);
      }
      ladder.append(chips);
      ladderCol.append(ladder);
      const moves = node('div', 'ku-dir-row');
      moves.append(
        chipButton('◂ Назад', 'dir-stage-step', { delta: -1 }, 'Стадия назад', 'ku-dir-btn'),
        chipButton('Дальше ▸', 'dir-stage-step', { delta: 1 }, 'Следующая стадия: рассказчик подводит к ней', 'ku-dir-btn ku-dir-kick'),
      );
      if (stage.id) {
        const hold = chipButton(stage.lock ? '🔒 Держу' : '🔓 Держать', 'dir-stage-lock', {}, stage.lock ? 'Летописец стадию не предлагает: нажми, чтобы отдать ему' : 'Не давать летописцу предлагать стадию', `ku-dir-btn${stage.lock ? ' on' : ''}`);
        hold.setAttribute('aria-pressed', String(Boolean(stage.lock)));
        moves.append(hold, chipButton('Сцена закончена', 'dir-stage-clear', {}, 'Снять лесенку: рассказчик пишет сцену как раньше'));
      }
      ladderCol.append(moves);
      rollCol.append(node('span', 'ku-dir-caption', stage.id ? `Рассказчик получает: ${stage.ru || stage.hint} Один шаг за ответ. Летописец сам предложит следующую стадию плашкой под ответом, а ты можешь нажать «Дальше».` : 'Лесенка не запущена: рассказчик пишет сцену как раньше. Выбери стадию или нажми «Дальше ▸».'));
    if (stage.id) {
      // The user's own line for the scene: it goes to the narrator with the stage until it is changed or emptied.
      const note = node('div', 'ku-dir-row ku-dir-field');
      note.append(textField('stage-note', ui.stageNote ?? stage.note ?? '', 'своя заметка к сцене: например, «пусть он замирает, когда она касается шеи»'), chipButton('Записать', 'dir-stage-note', {}, 'Заметка уйдёт рассказчику со стадией (Enter). Пустая снимает её'));
      rollCol.append(note);
    }
    }
    const top = node('div', 'ku-dir-row');
    top.append(
      chipButton(dice.picks.length ? '🎲 Перебросить' : '🎲 Бросить', 'dir-dice-roll', {}, 'Бросить заново всё, кроме закреплённого замком', 'ku-dir-btn ku-dir-kick'),
      chipButton(dice.sent ? '✓ Отправлено' : '▶ Отправить', 'dir-dice-send', {}, 'Поставить выбранное направлением на следующий ответ', `ku-dir-btn${dice.sent ? ' on' : ''}`),
      chipButton('Сбросить', 'dir-dice-clear', {}, 'Убрать выбранное и снять направление'),
    );
    // «Начало» has its own button unless the dice roll it by the stage.
    if (dice.rollMode !== 'stage' && dice.groups.some(group => group.id === 'start')) top.prepend(chipButton('✨ Начало', 'dir-dice-roll', { group: 'start' }, 'Бросить только «Начало»: как всё начинается', 'ku-dir-btn'));
    foot.append(top);
    // Picks from a later stage wait here: «сейчас» lets one through at once.
    const held = dice.picks.filter(pick => pick.ahead);
    if (held.length) {
      const waiting = node('div', 'ku-dir-row ku-dice-held');
      waiting.append(node('span', 'ku-dir-caption ku-dice-label', '⏳ В запасе'));
      const chips = node('span', 'ku-dice-chips');
      for (const pick of held) chips.append(chipButton(`${pick.text} · сейчас`, 'dir-dice-release', { group: pick.group, option: pick.id }, 'Это дальше текущей стадии, рассказчик только подводит к нему. Нажми, чтобы он писал это уже сейчас', 'ku-dir-btn'));
      waiting.append(chips);
      rollCol.append(waiting);
    }
    const burning = new Set(dice.picks.map(pick => `${pick.group}:${pick.id}`));
    const aheadKeys = new Set(dice.picks.filter(pick => pick.ahead).map(pick => `${pick.group}:${pick.id}`));
    for (const group of dice.groups) {
      const row = node('div', 'ku-dir-row ku-dir-dice-row');
      const locked = dice.locked.includes(group.id);
      row.append(node('span', 'ku-dir-caption ku-dice-label', `${group.icon} ${group.label}`));
      const chips = node('span', 'ku-dice-chips');
      for (const option of group.options) {
        const on = burning.has(`${group.id}:${option.id}`);
        const chip = chipButton(option.text, 'dir-dice-pick', { group: group.id, option: option.id }, aheadKeys.has(`${group.id}:${option.id}`) ? 'Впереди текущей стадии: в запасе, пока сцена не дойдёт' : group.multi ? 'Можно выбрать несколько' : 'Выбрать (ещё раз: снять)', `ku-dir-btn ku-dice-chip${on ? ' on' : ''}${on && aheadKeys.has(`${group.id}:${option.id}`) ? ' ahead' : ''}`);
        chip.setAttribute('aria-pressed', String(on));
        chips.append(chip);
      }
      chips.append(chipButton('+', 'dir-dice-add-open', { group: group.id }, 'Добавить свой вариант', `ku-dir-btn ku-dir-add${ui.diceAdd === group.id ? ' on' : ''}`));
      row.append(chips,
        chipButton(locked ? '🔒' : '🔓', 'dir-dice-lock', { group: group.id }, locked ? 'Закреплено: бросок это не меняет' : 'Закрепить: бросок это не меняет', `ku-dir-btn${locked ? ' on' : ''}`),
        chipButton('↻', 'dir-dice-roll', { group: group.id }, 'Бросить заново только эту группу'));
      rollCol.append(row);
      if (ui.diceAdd === group.id) {
        const add = node('div', 'ku-dir-row ku-dir-field');
        add.append(textField('dice-add', ui.diceDraft, 'свой вариант: например, «под дождём»'), chipButton('Добавить', 'dir-dice-add-save', {}, 'Добавить в группу и выбрать (Enter)'));
        rollCol.append(add);
      }
    }
    rollCol.append(node('span', 'ku-dir-caption', dice.sent ? 'Выбранное уже ушло: оно действует на следующий ответ и на его регенерации. Что поменяешь, уйдёт заново само.' : 'Выбери нажатием или брось: выбранное горит. «Отправить» ставит его направлением на следующий ответ.'));
    const cols = node('div', `ku-dice-cols${dice.stage ? ' with-ladder' : ''}`);
    cols.append(...(dice.stage ? [ladderCol] : []), rollCol);
    card.append(cols, foot);
    return card;
  }

  /**
   * The strip above the message box: what the scene is and what goes to the model with the next post
   * (time, place, who is on stage, the queued directions, the stage and the roll of the dice). One click opens the panel.
   */
  function renderStrip(view) {
    let strip = document.getElementById(STRIP_ID);
    const show = view.chips && (view.cast.length || view.director?.others?.length);
    if (!show) { strip?.remove(); return; }
    const form = document.getElementById('send_form');
    if (!form?.parentElement) return;
    if (!strip) {
      strip = chipButton('', 'dir-toggle', {}, 'Открыть панель сцены', 'ku-scene-strip');
      strip.id = STRIP_ID;
      form.parentElement.insertBefore(strip, form);
    }
    const director = view.director ?? {};
    const items = [];
    const add = (text, className = '') => items.push(node('span', `ku-ss-item${className ? ` ${className}` : ''}`, text));
    if (view.time) add(view.time);
    if (view.location) add(`📍 ${view.location}`);
    if (view.weather?.badge) add(view.weather.badge);
    if (view.sceneMode && view.sceneMode !== 'calm') add(`${MODE_MARK[view.sceneMode] ?? ''} ${MODE_LABEL[view.sceneMode] ?? view.sceneMode}`);
    if (view.secrets) add(`🔒 ${view.secrets}${view.waitingReveals ? ` · ждут ${view.waitingReveals}` : ''}`);
    const here = view.cast.filter(person => person.present);
    if (here.length) add(here.map(person => person.name).join(', '), 'ku-ss-cast');
    // What goes out with the next post.
    const out = [];
    const stage = view.dice?.stage;
    if (stage?.id) out.push(`${stage.label}: ${stage.ru || stage.hint}${stage.note ? ` · заметка: ${stage.note}` : ''}`);
    for (const cue of director.cues ?? []) out.push(`${cue.wait ? `⏳${cue.wait} ` : ''}${cue.badge} ${cue.label}${cue.used ? ' ✓' : ''}`);
    const picks = view.dice?.picks ?? [];
    // Sent, it already stands among the queued directions above; only a roll that has not gone out is listed here.
    if (picks.length && !view.dice?.sent) {
      const text = picks.map(pick => pick.text).join(' · ');
      out.push(`🎲 ${text.length > 90 ? `${text.slice(0, 89)}…` : text}${view.dice.sent ? '' : ' (не отправлен)'}`);
    }
    const sendLine = node('span', 'ku-ss-out');
    sendLine.append(node('b', null, 'Уйдёт модели: '));
    if (out.length) for (const text of out) sendLine.append(node('span', 'ku-ss-tag', text));
    else sendLine.append(node('span', 'ku-ss-none', 'ничего заготовленного'));
    const parts = [...items, sendLine];
    // What really went with the last request (read back from the prompt when it was built).
    if (view.lastSent) {
      const last = view.lastSent;
      const sent = [];
      if (last.stage) sent.push(`стадия «${last.stage.label}»${last.stage.note ? `, заметка «${last.stage.note}»` : ''}`);
      sent.push(...last.cues);
      const line = node('span', 'ku-ss-last');
      line.append(node('b', null, 'В последний запрос ушло: '), node('span', sent.length ? 'ku-ss-tag' : 'ku-ss-none', sent.length ? sent.join(' · ') : 'ничего от Кулис, кроме обычной сцены'));
      parts.push(line);
    }
    if (view.build) parts.push(node('span', 'ku-ss-ver', `Кулисы ${view.build}`));
    strip.replaceChildren(...parts);
  }

  /**
   * The reminder above the message box in a chat that Kulisy has not been set up for (view.setup = { due, done, total, chat }):
   * a link to the step-by-step guide, «Позже» (until the page is reloaded) and «Не напоминать в этом чате».
   */
  function renderSetupBanner(view) {
    let banner = document.getElementById(SETUP_ID);
    const setup = view.setup;
    if (!setup?.due || snoozed.has(setup.chat)) { banner?.remove(); return; }
    const form = document.getElementById('send_form');
    if (!form?.parentElement) return;
    if (!banner) {
      banner = node('div', 'ku-setup-banner');
      banner.id = SETUP_ID;
      form.parentElement.insertBefore(banner, form);
    }
    banner.replaceChildren(
      node('span', 'ku-sb-text', `Кулисы: этот чат ещё не настроен (обязательных шагов ${setup.done} из ${setup.total}).`),
      chipButton('Пошаговая инструкция', 'studio', { tab: 'setup' }, 'Открыть «Настройка чата»: что нажать и зачем', 'ku-dir-btn ku-sb-go'),
      chipButton('Позже', 'setup-later', { chat: setup.chat }, 'Скрыть до перезагрузки страницы'),
      chipButton('Не напоминать здесь', 'setup-off', {}, 'Больше не показывать плашку в этом чате'),
    );
  }

  /** The drawer: a slim bar when closed; opened, it stays until its arrow is clicked. */
  function renderChips(view) {
    let bar = document.getElementById(CHIPS_ID);
    const show = view.chips && (view.cast.length || view.director?.others?.length);
    if (!show) { bar?.remove(); return; }
    if (!bar) {
      bar = node('div', 'ku-director ku-side');
      bar.id = CHIPS_ID;
      bar.setAttribute('role', 'region');
      bar.setAttribute('aria-label', 'Сцена и режиссура');
      const panel = node('div', 'ku-panel');
      const headElement = node('div', 'ku-dir-head');
      const body = node('div', 'ku-dir-body');
      body.append(node('div', 'ku-dir-inner'));
      panel.append(headElement, body);
      bar.append(node('div', 'ku-rail'), panel);
      bar.addEventListener('input', onInput);
      bar.addEventListener('keydown', onKey);
      document.body.append(bar);
    }
    const director = { cues: [], others: [], favorites: [], silenceAfter: 0, ...(view.director ?? {}) };
    const open = Boolean(director.open);
    bar.classList.toggle('open', open);
    const focused = document.activeElement?.dataset?.kuField ?? '';
    const caret = focused ? document.activeElement.selectionStart : null;

    const headElement = bar.querySelector('.ku-dir-head');
    const places = [
      ...(view.time ? [pill(view.time, 'Время сцены — открыть пульт')] : []),
      ...(view.location ? [pill(`📍 ${view.location}`, 'Место сцены — открыть пульт')] : []),
      ...(view.weather?.badge ? [pill(view.weather.badge, 'Погода — открыть страницу «Погода»', 'weather')] : []),
      ...(view.sceneMode && view.sceneMode !== 'calm' ? [pill(`${MODE_MARK[view.sceneMode] ?? ''} ${MODE_LABEL[view.sceneMode] ?? view.sceneMode}`, 'Тип сцены: от него зависит, какие разделы анкет уходят модели')] : []),
      ...(view.secrets ? [pill(`🔒 ${view.secrets}${view.waitingReveals ? ` · ждут ${view.waitingReveals}` : ''}`, 'Секреты — кто что знает', 'secrets')] : []),
    ];
    const cast = [...view.cast].sort((left, right) => Number(right.present) - Number(left.present));
    const inner = bar.querySelector('.ku-dir-inner');
    const stage = node('div', 'ku-dir-row ku-dir-cast');
    stage.append(node('span', 'ku-dir-caption', 'На сцене:'));
    const here = cast.filter(item => item.present);
    if (!here.length) stage.append(node('span', 'ku-dir-caption', 'никого'));
    for (const person of here) stage.append(personChip(person, director));
    const nearby = cast.filter(item => !item.present);
    if (nearby.length) {
      stage.append(node('span', 'ku-dir-caption ku-dir-gap', 'Рядом:'));
      for (const person of nearby) stage.append(personChip(person, director));
    }
    stage.append(chipButton('+ Позвать', 'dir-pane', { pane: 'others' }, 'Позвать того, кого сейчас нет', `ku-dir-btn ku-dir-add${ui.pane === 'others' ? ' on' : ''}`));
    const pane = ui.pane || 'who';
    const mode = view.sceneMode || 'calm';
    const kindInfo = view.weather ? WEATHER_KINDS[view.weather.kind] : null;
    const tile = (icon, name, value, action, data, { on = false, kick = false, title = '' } = {}) => {
      const button = chipButton('', action, data, title, `ku-tile${on ? ' on' : ''}${kick ? ' kick' : ''}`);
      button.append(node('span', 'ku-tile-ico', icon), node('span', 'ku-tile-name', name), node('span', 'ku-tile-val', value));
      if (action === 'dir-pane') button.setAttribute('aria-pressed', String(on));
      return button;
    };
    // Time, place and secrets: one tile cut into thin strips (the first edits the clock, the others open their pages).
    const strip = (icon, value, action, data, { on = false, title = '' } = {}) => {
      const button = chipButton('', action, data, title, `ku-strip${on ? ' on' : ''}`);
      button.append(node('span', 'ku-strip-ico', icon), node('span', 'ku-strip-val', value));
      if (action === 'dir-pane') button.setAttribute('aria-pressed', String(on));
      return button;
    };
    const stack = node('div', 'ku-tile-stack');
    stack.append(
      strip('🕑', view.time || 'время', 'dir-pane', { pane: 'time' }, { on: pane === 'time', title: 'Время сцены: поправить' }),
      strip('📍', view.location || 'место', 'studio', { tab: 'places' }, { title: 'Место сцены: открыть локации' }),
      ...(view.secrets ? [strip('🔒', `${view.secrets}${view.waitingReveals ? ` · ждут ${view.waitingReveals}` : ''}`, 'studio', { tab: 'secrets' }, { title: 'Секреты: кто что знает' })] : []),
    );
    const grid = node('div', 'ku-dir-grid');
    grid.append(
      tile('👥', 'Кто', here.length ? `${here.length} на сцене` : 'никого', 'dir-pane', { pane: 'who' }, { on: pane === 'who' || Boolean(ui.selected), title: 'Кто на сцене: позвать, убрать, пнуть' }),
      stack,
      tile(kindInfo ? kindInfo.icon : '🌤', 'Погода', kindInfo ? `${view.weather.temp != null ? `${view.weather.temp}° ` : ''}${kindInfo.label.toLowerCase()}` : 'не задана', 'dir-pane', { pane: 'weather' }, { on: pane === 'weather', title: 'Погода: выбрать, держать, заготовки' }),
      tile(MODE_MARK[mode], 'Тип', MODE_LABEL[mode], 'dir-pane', { pane: 'mode' }, { on: pane === 'mode', title: 'Тип сцены: от него зависит, какие разделы анкет уходят модели' }),
      ...(mode === 'intim' || view.dice?.stage?.id ? [tile('🎲', 'Кубик', view.dice?.picks?.length ? (view.dice.sent ? 'отправлен' : 'выбрано') : (view.dice?.stage?.label || 'бросить'), 'dir-pane', { pane: 'dice' }, { on: pane === 'dice', title: 'Кубик близости: лесенка стадий, бросок, своя заметка' })] : []),
      tile('🔥', 'Накал', view.heat?.value ? `${view.heat.value} · ${view.heat.label}` : 'спокойно', 'dir-pane', { pane: 'heat' }, { on: pane === 'heat', title: 'Накал сцены: насколько она заряжена. Падает логично, поправить можно рукой' }),
      tile('🧭', 'Квесты', view.quests?.length ? `${view.quests.length} идут` : 'нет', 'dir-pane', { pane: 'quests' }, { on: pane === 'quests', title: 'Квесты: отметить шаг, ввести его в сюжет' }),
      tile('🎵', 'Песни', view.songs?.playing?.length ? `▶ ${view.songs.playing.length}` : view.songs?.found?.some(item => !item.muted) ? 'слышно' : 'тихо', 'dir-pane', { pane: 'songs' }, { on: pane === 'songs', title: 'Песни: что звучит, кто поёт, какая узнана в постах' }),
      tile('🎬', 'Сцена', 'новая', 'dir-pane', { pane: 'scene' }, { on: pane === 'scene', title: 'Начать новую сцену: с чего, когда, где и с кем' }),
      tile('⚡', 'Событие', 'случится', 'dir-pane', { pane: 'event' }, { on: pane === 'event', title: 'Пусть в сцене что-то случится' }),
      tile('📝', 'Рассказчику', 'указание', 'dir-pane', { pane: 'note' }, { on: pane === 'note', title: 'Указание на следующий ответ, без персонажа' }),
      tile('▶', 'Пнуть', 'сейчас', 'dir-kick', {}, { kick: true, title: director.canKick ? 'Отправить: с твоим текстом из поля, а если оно пустое — без поста' : 'Сейчас идёт генерация' }),
    );
    const modeCard = () => {
      const card = node('div', 'ku-dir-card ku-dir-mode');
      card.append(node('span', 'ku-dir-caption', 'Тип сцены:'));
      const row = node('div', 'ku-dir-row');
      for (const [id, label] of Object.entries(MODE_LABEL)) {
        const on = mode === id;
        const button = chipButton(`${MODE_MARK[id]} ${label}`, 'dir-mode', { mode: id }, MODE_HINT[id], `ku-dir-btn${on ? ' on' : ''}`);
        button.setAttribute('aria-pressed', String(on));
        row.append(button);
      }
      card.append(row, node('span', 'ku-dir-caption', MODE_HINT[mode]));
      return card;
    };
    const heatCard = () => {
      const heat = view.heat ?? { value: 0, label: 'спокойно', lock: false, why: '' };
      const card = node('div', 'ku-dir-card ku-dir-heat');
      card.append(node('div', 'ku-dir-card-head', `🔥 Накал сцены: ${heat.value} · ${heat.label}`));
      const bar = node('div', 'ku-heat-bar');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `Накал ${heat.value} из 100`);
      const fill = node('div', 'ku-heat-fill');
      fill.style.width = `${Math.max(0, Math.min(100, heat.value))}%`;
      bar.append(fill);
      card.append(bar);
      if (heat.why) card.append(node('span', 'ku-dir-caption', heat.why));
      const row = node('div', 'ku-dir-row');
      for (const delta of [-10, -5, 5, 10]) row.append(chipButton(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}`, 'dir-heat', { delta }, 'Поправить накал', 'ku-dir-btn'));
      for (const value of [0, 30, 60, 90]) row.append(chipButton(String(value), 'dir-heat', { value }, `Поставить ${value}`, 'ku-dir-btn'));
      card.append(row);
      const foot = node('div', 'ku-dir-row');
      const lock = chipButton(heat.lock ? '🔒 Держу' : '🔓 Держать', 'dir-heat-lock', {}, heat.lock ? 'Летописец накал не трогает: нажмите, чтобы отдать ему' : 'Не давать летописцу менять накал', `ku-dir-btn${heat.lock ? ' on' : ''}`);
      lock.setAttribute('aria-pressed', String(Boolean(heat.lock)));
      foot.append(lock, chipButton('Сбросить', 'dir-heat-clear', {}, 'Убрать накал и вернуть его летописцу'));
      card.append(foot, node('span', 'ku-dir-caption', 'Летописец сам оценивает накал после каждого ответа и снижает его только по причине в сюжете.'));
      return card;
    };
    const questsCard = () => {
      const card = node('div', 'ku-dir-card ku-dir-quests');
      card.append(node('div', 'ku-dir-card-head', '🧭 Квесты'));
      if (!view.quests?.length) card.append(node('span', 'ku-dir-caption', 'Сейчас ничего не идёт. Квесты добавляются на странице «Мир → Квесты».'));
      for (const quest of view.quests ?? []) {
        const row = node('div', 'ku-dir-quest');
        const title = node('div', 'ku-dir-quest-title');
        title.append(node('b', null, `${quest.secret ? '🔒 ' : ''}${quest.name}`), node('span', 'ku-dir-caption', [quest.progress, quest.due].filter(Boolean).join(' · ')));
        row.append(title);
        if (quest.step) row.append(node('span', 'ku-dir-quest-step', quest.step));
        const buttons = node('div', 'ku-dir-row');
        if (quest.stepId) buttons.append(chipButton('☑ Шаг выполнен', 'dir-quest-step', { questId: quest.id, stepId: quest.stepId }, 'Отметить текущий шаг сделанным', 'ku-dir-btn'));
        buttons.append(
          chipButton('▶ Ввести сейчас', 'dir-quest-push', { questId: quest.id }, 'Следующий ответ подаст этот шаг через сюжет', `ku-dir-btn${quest.pushed ? ' on' : ''}`),
          chipButton('Открыть', 'studio', { tab: 'quests' }, 'Страница квестов: закрыть, править, награда'),
        );
        row.append(buttons);
        card.append(row);
      }
      return card;
    };
    const songsCard = () => {
      const songs = view.songs ?? { enabled: false, playing: [], found: [], muted: [], library: [] };
      const card = node('div', 'ku-dir-card ku-dir-songs');
      card.append(node('div', 'ku-dir-card-head', '🎵 Песни'));
      if (!songs.enabled) card.append(node('span', 'ku-dir-caption', 'Песни выключены: включить можно на странице «Мир → Песни».'));
      const people = (director.people ?? []).slice(0, 10);
      const pressed = (button, on) => { button.setAttribute('aria-pressed', String(on)); return button; };
      for (const item of songs.playing) {
        const row = node('div', 'ku-dir-quest ku-dir-song');
        const title = node('div', 'ku-dir-quest-title');
        title.append(node('b', null, item.title), node('span', 'ku-dir-caption', item.artist));
        const how = node('div', 'ku-dir-row');
        how.append(pressed(chipButton('🔊 Звучит', 'dir-song-pin', { songId: item.songId, mode: 'sound' }, 'Песня играет в сцене: из колонки, на улице, по радио', `ku-dir-btn${item.mode === 'sound' ? ' on' : ''}`), item.mode === 'sound'));
        how.append(pressed(chipButton('🎤 Кто-то', 'dir-song-pin', { songId: item.songId, mode: 'sung', singerId: '' }, 'Её поёт кто-то из героев, модель решит кто', `ku-dir-btn${item.mode === 'sung' && !item.singerId ? ' on' : ''}`), item.mode === 'sung' && !item.singerId));
        for (const person of people) {
          const on = item.mode === 'sung' && item.singerId === person.id;
          how.append(pressed(chipButton(`🎤 ${person.name}`, 'dir-song-pin', { songId: item.songId, mode: 'sung', singerId: person.id }, `${person.name} поёт эту песню`, `ku-dir-btn${on ? ' on' : ''}`), on));
        }
        const foot = node('div', 'ku-dir-row');
        foot.append(chipButton('× Убрать', 'dir-song-unpin', { songId: item.songId }, 'Песня больше не звучит и не поётся', 'ku-dir-btn'));
        row.append(title, how, foot);
        card.append(row);
      }
      if (!songs.playing.length) card.append(node('span', 'ku-dir-caption', 'Сейчас ничего не закреплено. Песня подхватывается сама, когда в постах цитируют её строки или называют её; закрепить нужно, если она звучит или поётся без цитат.'));
      const WHY = { lyrics: 'по словам', title: 'по названию', key: 'по ключу' };
      if (songs.found.length) {
        card.append(node('span', 'ku-dir-caption', 'Узнаны в последних постах:'));
        for (const item of songs.found) {
          const row = node('div', 'ku-dir-row');
          row.append(node('span', `ku-dir-tag${item.muted ? ' used' : ''}`, `🎵 ${item.title} · ${WHY[item.why] ?? ''}${item.muted ? ' · заглушена' : ''}`));
          if (item.muted) row.append(chipButton('Вернуть', 'dir-song-unmute', { songId: item.songId }, 'Снова узнавать эту песню в этом чате', 'ku-dir-btn'));
          else row.append(
            chipButton('🔊 Звучит', 'dir-song-pin', { songId: item.songId, mode: 'sound' }, 'Закрепить: песня играет в сцене', 'ku-dir-btn'),
            chipButton('Не она', 'dir-song-mute', { songId: item.songId }, 'Это не та песня: не узнавать её в этом чате', 'ku-dir-btn'),
          );
          card.append(row);
        }
      }
      const silenced = songs.muted.filter(item => !songs.found.some(found => found.songId === item.songId));
      if (silenced.length) {
        card.append(node('span', 'ku-dir-caption', 'Заглушены в этом чате:'));
        for (const item of silenced) {
          const row = node('div', 'ku-dir-row');
          row.append(node('span', 'ku-dir-tag used', `🎵 ${item.title}`), chipButton('Вернуть', 'dir-song-unmute', { songId: item.songId }, 'Снова узнавать эту песню в этом чате', 'ku-dir-btn'));
          card.append(row);
        }
      }
      const find = textField('song-find', ui.songFind, 'Найти песню в библиотеке…');
      find.setAttribute('aria-label', 'Найти песню в библиотеке');
      card.append(find);
      const query = ui.songFind.trim().toLocaleLowerCase('ru-RU');
      const pinned = new Set(songs.playing.map(item => item.songId));
      const hits = query ? songs.library.filter(item => !pinned.has(item.songId) && `${item.title} ${item.artist}`.toLocaleLowerCase('ru-RU').includes(query)).slice(0, 8) : [];
      if (hits.length) {
        const row = node('div', 'ku-dir-row');
        for (const item of hits) row.append(chipButton(`＋ ${item.title}${item.artist ? ` — ${item.artist}` : ''}`, 'dir-song-pin', { songId: item.songId, mode: 'sound' }, 'Закрепить: песня играет в сцене (потом можно назначить, кто поёт)', 'ku-dir-btn'));
        card.append(row);
      } else if (query) card.append(node('span', 'ku-dir-caption', 'В библиотеке такой песни нет.'));
      const tools = node('div', 'ku-dir-row');
      tools.append(chipButton('Библиотека ▸', 'studio', { tab: 'songs' }, 'Страница песен: описания, слова, ключи', 'ku-dir-btn'));
      card.append(tools);
      return card;
    };
    const timeCard = () => {
      const draft = clockDraft();
      const card = node('div', 'ku-dir-card ku-dir-time');
      card.append(node('div', 'ku-dir-card-head', '🕑 Время сцены'));
      const fields = node('div', 'ku-dir-row ku-dir-field');
      const field = (name, value, placeholder, label, width) => {
        const input = textField(name, value, placeholder);
        input.setAttribute('aria-label', label);
        input.style.maxWidth = width;
        return input;
      };
      fields.append(
        field('clock-time', draft.time, '14:20', 'Время, часы и минуты', '6.5em'),
        field('clock-day', draft.day, 'день', 'Номер дня истории', '5.5em'),
        field('clock-label', draft.label, 'вторник, 8 апреля (если известно)', 'Дата или день недели', '100%'),
        chipButton('Сохранить', 'dir-clock-save', {}, 'Записать время (Enter)', 'ku-dir-btn ku-dir-kick'),
      );
      const quick = node('div', 'ku-dir-row');
      quick.append(node('span', 'ku-dir-caption', 'Сдвинуть:'));
      for (const [label, minutes] of [['+15 мин', 15], ['+30 мин', 30], ['+1 ч', 60], ['+3 ч', 180], ['+8 ч', 480]]) quick.append(chipButton(label, 'dir-clock-shift', { minutes }, `Сдвинуть время вперёд: ${label}`));
      card.append(fields, quick, node('span', 'ku-dir-caption', 'Время идёт вперёд само по ходу ответов. Здесь можно поправить его вручную.'));
      return card;
    };
    const weatherCard = () => {
      const card = node('div', 'ku-dir-card ku-dir-weather');
      card.append(node('span', 'ku-dir-caption', 'Погода на улице:'));
      const row = node('div', 'ku-dir-row');
      for (const id of WEATHER_KIND_IDS) {
        const on = view.weather?.kind === id;
        const button = chipButton(`${WEATHER_KINDS[id].icon} ${WEATHER_KINDS[id].label}`, 'dir-weather', { kind: id }, WEATHER_KINDS[id].label, `ku-dir-btn${on ? ' on' : ''}`);
        button.setAttribute('aria-pressed', String(on));
        row.append(button);
      }
      const tools = node('div', 'ku-dir-row');
      if (view.weather) {
        const locked = view.weather.source === 'lock';
        const lockButton = chipButton(locked ? '🔒 Держится' : '🔓 Держать', 'dir-weather-lock', {}, locked ? 'Погода держится: нажмите, чтобы отпустить' : 'Держать эту погоду: летописец и прогноз её не меняют', `ku-dir-btn${locked ? ' on' : ''}`);
        lockButton.setAttribute('aria-pressed', String(locked));
        tools.append(lockButton);
      }
      tools.append(chipButton('Заготовки ▸', 'studio', { tab: 'weather' }, 'Климат и сценарии: тайфун, дожди, жара…', 'ku-dir-btn'));
      card.append(row, tools);
      return card;
    };
    // The rail: always there, one button per tab; the first one folds and unfolds the panel.
    const pending = (director.cues ?? []).length;
    const toggle = chipButton(open ? '◂' : '▸', 'dir-toggle', {}, open ? 'Свернуть панель в рейку' : 'Развернуть панель сцены', 'ku-rail-toggle');
    toggle.setAttribute('aria-expanded', String(open));
    if (pending) toggle.append(node('span', 'ku-rail-badge', pending));
    bar.querySelector('.ku-rail').replaceChildren(toggle, ...grid.children);
    const TAB_TITLES = { who: 'Кто на сцене', others: 'Позвать', time: 'Время', weather: 'Погода', mode: 'Тип сцены', dice: 'Кубик близости', heat: 'Накал сцены', quests: 'Квесты', songs: 'Песни', scene: 'Новая сцена', event: 'Событие', note: 'Рассказчику' };
    headElement.replaceChildren(node('strong', 'ku-dir-title', ui.selected ? 'Персонаж' : (TAB_TITLES[pane] ?? 'Сцена')), ...places);
    if (!open) { inner.replaceChildren(); return; }
    const parts = [];
    if (ui.selected) {
      parts.push(stage);
      const menu = characterMenu(director);
      if (menu) parts.push(menu);
    } else if (pane === 'who') parts.push(stage);
    else if (pane === 'others') parts.push(stage, othersMenu(director));
    else if (pane === 'time') parts.push(timeCard());
    else if (pane === 'quests') parts.push(questsCard());
    else if (pane === 'songs') parts.push(songsCard());
    else if (pane === 'heat') parts.push(heatCard());
    else if (pane === 'dice') parts.push(diceCard(view));
    else if (pane === 'weather') parts.push(weatherCard());
    else if (pane === 'mode') parts.push(modeCard());
    else if (pane === 'event') parts.push(eventMenu());
    else if (pane === 'scene') parts.push(sceneMenu(director));
    else if (pane === 'note') parts.push(noteMenu());
    if (director.cues?.length) {
      const queue = node('div', 'ku-dir-row ku-dir-queue');
      queue.append(node('span', 'ku-dir-caption', 'Режиссура:'));
      for (const cue of director.cues) {
        const tag = node('span', `ku-dir-tag${cue.used ? ' used' : ''}`);
        tag.title = cue.used ? 'Уже в силе: действует для свайпов этого ответа, сгорит с твоим следующим постом'
          : cue.wait ? `Сработает через ${cue.wait}` : 'Уйдёт с твоим следующим постом';
        tag.append(node('span', null, `${cue.wait ? `⏳${cue.wait} ` : ''}${cue.badge} ${cue.label}${cue.used ? ' ✓' : ''}`), chipButton('×', 'dir-remove', { cueId: cue.id }, 'Снять', 'ku-dir-fav-del'));
        queue.append(tag);
      }
      parts.push(queue);
    }
    inner.replaceChildren(...parts);
    if (focused) {
      const field = inner.querySelector(`[data-ku-field="${focused}"]`);
      if (field) {
        field.focus();
        try { if (caret != null && typeof field.setSelectionRange === 'function') field.setSelectionRange(caret, caret); } catch { /* a select has no caret */ }
      }
    }
  }

  function renderLeaks(view) {
    for (const old of document.querySelectorAll(`#chat .${LEAK_CLASS}`)) old.remove();
    const byMessage = new Map();
    for (const leak of view.leaks) {
      if (!byMessage.has(leak.messageIndex)) byMessage.set(leak.messageIndex, []);
      byMessage.get(leak.messageIndex).push(leak);
    }
    for (const [messageIndex, leaks] of byMessage) {
      const block = document.querySelector(`#chat .mes[mesid="${messageIndex}"] .mes_block`);
      if (!block) continue; // not rendered (older messages are loaded on scroll)
      for (const leak of leaks) {
        const data = { messageIndex, entityId: leak.entityId, eventId: leak.eventId };
        const note = node('div', LEAK_CLASS);
        note.setAttribute('role', 'note');
        const text = node('div', 'ku-leak-text');
        text.append(
          node('i', 'fa-solid fa-triangle-exclamation'),
          node('b', null, ' Возможная утечка. '),
          `${leak.name} ведёт себя так, будто знает: «${leak.eventText}». В сцене этого не видел(а), и никто не рассказывал.`,
        );
        if (leak.quote) text.append(node('span', 'ku-leak-quote', ` «${leak.quote}»`));
        const actions = node('div', 'ku-leak-actions');
        if (leak.canSwipe) actions.append(actionButton('Свайп', 'swipe', data, 'Перегенерировать этот ответ'));
        actions.append(
          actionButton('Он знает', 'knows', data, 'Это не ошибка: записать, что он знает'),
          actionButton('Не утечка', 'dismiss', data, 'Убрать отметку, ничего не записывая'),
        );
        note.append(text, actions);
        const anchor = block.querySelector('.mes_text');
        if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
      }
    }
  }

  function renderSecretHints(view) {
    for (const old of document.querySelectorAll(`#chat .${SECRET_HINT_CLASS}`)) old.remove();
    for (const hint of view.secretHints ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${hint.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: hint.messageIndex, eventId: hint.eventId };
      const note = node('div', `${LEAK_CLASS} ${SECRET_HINT_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-user-secret'), node('b', null, ' Похоже на секрет: '), `«${hint.text}»`);
      if (hint.names) text.append(node('span', 'ku-leak-quote', ` Знают: ${hint.names}.`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton('Открыть в окне', 'secret-open', data, 'Составить секрет: проверишь текст и знающих, потом сохранишь. Без твоего «Сохранить» ничего не записывается'),
        actionButton('Это не секрет', 'secret-dismiss', data, 'Убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  function renderSlips(view) {
    for (const old of document.querySelectorAll(`#chat .${SLIP_CLASS}`)) old.remove();
    for (const slip of view.slips ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${slip.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: slip.messageIndex, slipIndex: slip.slipIndex };
      const note = node('div', `${LEAK_CLASS} ${SLIP_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-shirt'), node('b', null, ` Возможный ляп: ${slip.label}${slip.name ? ` — ${slip.name}` : ''}. `), `«${slip.quote}»`);
      if (slip.note) text.append(node('span', 'ku-leak-quote', ` ${slip.note}`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        slip.canSwipe ? actionButton('Свайп', 'slip-swipe', data, 'Перегенерировать этот ответ') : actionButton('Править', 'slip-edit', data, 'Открыть сообщение для правки'),
        actionButton('Так и есть', 'slip-accept', data, 'Текст верный: переписать запись под него'),
        actionButton('Не ляп', 'slip-dismiss', data, 'Убрать отметку, ничего не меняя'),
        actionButton('Напомнить', 'slip-remind', data, 'Текст не трогать, но в следующем ответе сказать рассказчику, как на самом деле'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  /** The chronicler's guesses about quests: a task taken up, a step done, a quest over. Only proposals. */
  function renderQuestHints(view) {
    for (const old of document.querySelectorAll(`#chat .${QUEST_HINT_CLASS}`)) old.remove();
    for (const hint of view.questHints ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${hint.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: hint.messageIndex, hintId: hint.id };
      const note = node('div', `${LEAK_CLASS} ${QUEST_HINT_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', `fa-solid ${hint.icon ?? 'fa-flag'}`), node('b', null, ` ${hint.title} `));
      if (hint.detail) text.append(node('span', 'ku-leak-quote', hint.detail));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton(hint.confirm, 'quest-confirm', data, hint.confirmTitle),
        actionButton('Нет', 'quest-dismiss', data, 'Убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  function renderDeaths(view) {
    for (const old of document.querySelectorAll(`#chat .${DEATH_CLASS}`)) old.remove();
    for (const death of view.deaths ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${death.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: death.messageIndex, entityId: death.entityId };
      const note = node('div', `${LEAK_CLASS} ${DEATH_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-cross'), node('b', null, ` Похоже, ${death.name} умирает${death.note ? `: ${death.note}` : ''}. `));
      if (death.quote) text.append(node('span', 'ku-leak-quote', `«${death.quote}»`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton('Отметить', 'death-confirm', data, 'Персонаж умер: уходит со сцены, модель больше не выводит его живым. Удаление или свайп этого ответа снимут отметку.'),
        actionButton('Нет', 'death-dismiss', data, 'Не умер: убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  function renderReveals(view) {
    for (const old of document.querySelectorAll(`#chat .${REVEAL_CLASS}`)) old.remove();
    for (const reveal of view.reveals ?? []) {
      const block = document.querySelector(`#chat .mes[mesid="${reveal.messageIndex}"] .mes_block`);
      if (!block) continue;
      const data = { messageIndex: reveal.messageIndex, entityId: reveal.entityId, eventId: reveal.eventId };
      const note = node('div', `${LEAK_CLASS} ${REVEAL_CLASS}`);
      note.setAttribute('role', 'note');
      const text = node('div', 'ku-leak-text');
      text.append(node('i', 'fa-solid fa-key'), node('b', null, ` Похоже, ${reveal.name} узнаёт секрет: `), `«${reveal.eventText}»`);
      if (reveal.how) text.append(node('span', 'ku-leak-quote', ` (${reveal.how})`));
      const actions = node('div', 'ku-leak-actions');
      actions.append(
        actionButton('Отметить', 'reveal-confirm', data, 'Да, теперь знает: дальше получает текст секрета. Удаление этого ответа снимет отметку.'),
        actionButton('Нет', 'reveal-dismiss', data, 'Не узнал(а): убрать отметку, ничего не записывая'),
      );
      note.append(text, actions);
      const anchor = block.querySelector('.mes_text');
      if (anchor?.nextSibling) block.insertBefore(note, anchor.nextSibling); else block.append(note);
    }
  }

  return {
    render(view) {
      lastView = view;
      try {
        renderSetupBanner(view);
        renderChips(view);
        renderStrip(view);
        renderLeaks(view);
        renderDeaths(view);
        renderQuestHints(view);
        renderReveals(view);
        renderSecretHints(view);
        renderSlips(view);
      } catch (error) {
        console.error('[Kulisy] Chat overlay render failed.', error);
      }
    },
    unmount() {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onHotkey, true);
      document.getElementById(CHIPS_ID)?.remove();
      document.getElementById(STRIP_ID)?.remove();
      for (const old of document.querySelectorAll(`.${LEAK_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${SLIP_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${DEATH_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${QUEST_HINT_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${REVEAL_CLASS}`)) old.remove();
      for (const old of document.querySelectorAll(`.${SECRET_HINT_CLASS}`)) old.remove();
    },
  };
}
