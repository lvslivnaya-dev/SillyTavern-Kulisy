import { shieldKeys } from './key-shield.js';
import {
  button, characterId, characterName, createFacade, dispatch, element,
  ensureContainer, getPair, nextControlId, normalizeSnapshot, pairId, pairLabel, pairSource, pairTarget,
} from './helpers.js';
import { hostThemeCss } from './theme.js';
import { icon } from './icons.js';
import { looksIssues } from '../integration/world-prompt.js';
import { DOCK_WIDTH, NAV_GROUPS, NAV_TABS, PENDING_TABS, RELATION_TABS, clampDockWidth, effectiveMode, normalizeLayout } from './layout.js';
import { createDialogs } from './pages/dialogs.js';
import { createCharactersPage } from './pages/characters.js';
import { createOverviewPage } from './pages/overview.js';
import { createRecordsPage } from './pages/records.js';
import { createHeadcanonsPage } from './pages/headcanons.js';
import { createTrianglesPage } from './pages/triangles.js';
import { SETTINGS_STYLE, createSystemPages } from './pages/system.js';
import { KNOWLEDGE_STYLE, createKnowledgePages } from './pages/knowledge.js';
import { WORLD_STYLE, createWorldPages } from './pages/world.js';
import { WARDROBE_STYLE, createWardrobePages } from './pages/wardrobe.js';
import { LIBRARY_STYLE, createLibraryPages } from './pages/library.js';
import { CALENDAR_STYLE, createCalendarPages } from './pages/calendar.js';
import { CALENDAR_BUILDER_STYLE } from './pages/calendar-builder.js';
import { NAMES_STYLE, createNamesPages } from './pages/names.js';
import { SONGS_STYLE, createSongsPages } from './pages/songs.js';
import { WEATHER_STYLE, createWeatherPages } from './pages/weather.js';
import { DICE_STYLE, createDicePages } from './pages/dice.js';
import { QUESTS_STYLE, createQuestsPages } from './pages/quests.js';

const STYLE = `
${hostThemeCss('--rs-bg:var(--k-bg);--rs-panel:var(--k-panel);--rs-inset:var(--k-inset);--rs-track:var(--k-track);--rs-line:var(--k-line);--rs-text:var(--k-text);--rs-muted:var(--k-muted);--rs-accent:var(--k-accent);--rs-danger:var(--k-danger);--rs-backdrop:var(--k-backdrop)')}
*,*:before,*:after{box-sizing:border-box}.backdrop{position:fixed;inset:0;z-index:2147483000;background:var(--rs-backdrop);display:grid;place-items:center;padding:clamp(8px,2vw,28px)}.backdrop[hidden]{display:none}.studio{width:min(1640px,100%);height:min(980px,100%);background:var(--rs-bg);backdrop-filter:blur(var(--k-blur));border:1px solid var(--rs-line);border-radius:18px;box-shadow:0 30px 90px var(--k-shadow);display:grid;grid-template-columns:240px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);overflow:hidden}.header{grid-column:1/-1;min-height:72px;border-bottom:1px solid var(--rs-line);display:flex;align-items:center;gap:14px;padding:14px 18px}.brand{margin-right:auto}.brand strong{display:block;font:700 20px/1.1 var(--k-font)}.brand span,.muted{color:var(--rs-muted);font-size:12px}.sidebar{border-right:1px solid var(--rs-line);padding:16px;overflow:auto}.content{min-width:0;overflow:auto;padding:clamp(16px,3vw,34px)}button,input,select,textarea{font:inherit}.btn,.nav button,.icon{border:1px solid var(--rs-line);background:var(--rs-panel);color:var(--rs-text);border-radius:9px;min-height:40px;padding:8px 12px;cursor:pointer}.btn:hover,.nav button:hover,.nav button.active{border-color:var(--rs-accent);background:color-mix(in srgb,var(--rs-panel) 86%,var(--rs-accent))}.btn.primary{background:color-mix(in srgb,var(--rs-accent) 30%,var(--rs-panel));border-color:var(--rs-accent);color:var(--rs-text);font-weight:700}.icon{width:42px;padding:6px;font-size:20px}.nav{display:grid;gap:7px;margin-bottom:24px}.nav button{text-align:left}.section-title{font:700 11px/1.2 inherit;letter-spacing:.13em;text-transform:uppercase;color:var(--rs-muted);margin:0 0 9px}.characters{display:grid;gap:7px}.character{display:flex;align-items:center;gap:9px;padding:8px;border-radius:9px;background:var(--rs-inset)}.avatar{width:30px;height:30px;border-radius:50%;object-fit:cover;background:color-mix(in srgb,var(--rs-line) 70%,var(--rs-bg));display:grid;place-items:center;font-weight:700}.character span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:26px}.field{display:grid;gap:6px;min-width:160px}.field.grow{flex:1}.field label{font-size:12px;color:var(--rs-muted)}select,input,textarea{width:100%;color:var(--rs-text);background:color-mix(in srgb,var(--rs-inset) 70%,var(--SmartThemeChatTintColor));border:1px solid var(--rs-line);border-radius:8px;padding:9px}textarea{min-height:90px;resize:vertical}.hero{margin-bottom:24px}.hero h2{font:700 clamp(24px,4vw,42px)/1.1 var(--k-font);margin:0 0 7px}.grid{display:grid;grid-template-columns:repeat(2,minmax(240px,1fr));gap:14px}.card{background:var(--rs-panel);border:1px solid var(--rs-line);border-radius:13px;padding:16px}.card h3{margin:0 0 14px;font-size:15px}.metric{display:grid;grid-template-columns:minmax(110px,1fr) minmax(150px,2fr) 58px;gap:12px;align-items:center;margin:13px 0}.metric output{text-align:right;font-variant-numeric:tabular-nums;color:var(--rs-accent);font-weight:700}input[type=range]{padding:0;accent-color:var(--rs-accent)}.stack{display:grid;gap:10px}.item{border:1px solid var(--rs-line);border-radius:10px;padding:12px;background:color-mix(in srgb,var(--rs-inset) 80%,var(--rs-bg))}.item-head{display:flex;gap:10px;justify-content:space-between;margin-bottom:6px}.item p{margin:0;white-space:pre-wrap;color:color-mix(in srgb,var(--rs-text) 85%,transparent)}.item time{color:var(--rs-muted);font-size:11px}.empty{border:1px dashed var(--rs-line);border-radius:10px;padding:28px;text-align:center;color:var(--rs-muted)}.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.journal-row{display:grid;grid-template-columns:150px minmax(120px,1fr) 2fr;gap:13px;border-bottom:1px solid var(--rs-line);padding:12px 3px}.settings{max-width:760px}.settings .field{margin:14px 0}.danger{color:var(--rs-danger)}.status{min-height:18px;color:var(--rs-muted);font-size:12px;margin-left:auto}
@media(max-width:760px){.backdrop{padding:0}.studio{height:100dvh;border-radius:0;grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.header{min-height:62px}.sidebar{border-right:0;border-bottom:1px solid var(--rs-line);padding:8px 12px;overflow-x:auto;-webkit-overflow-scrolling:touch}.nav{display:flex;margin:0}.nav button{white-space:nowrap;min-height:44px}.characters,.sidebar .section-title{display:none}.content{padding:16px;-webkit-overflow-scrolling:touch}.grid{grid-template-columns:1fr}.metric{grid-template-columns:90px minmax(100px,1fr) 48px}.journal-row{grid-template-columns:1fr}.header{gap:8px;padding:10px 12px}.brand span{display:none}.btn,.nav button{min-height:44px;font-size:14px}.header .btn:not(.primary){display:none}.mobile-tools{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:flex-end}.mobile-tools .btn{display:inline-flex;min-height:36px;font-size:12px;padding:6px 10px}.mobile-tools .icon{width:36px;min-height:36px;font-size:16px}.busy-pill{max-width:100%;overflow:hidden;text-overflow:ellipsis}}
`;

const TABS = NAV_TABS;
/** Page headings; tabs not listed (memories, tensions, triangles) show the selected pair. */
const PAGE_TITLES = Object.freeze({
  scene: 'Сейчас', characters: 'Персонажи', persona: 'Персона', leaks: 'Проверка ответов', events: 'Лента событий', secrets: 'Секреты',
  chronicle: 'Хроника', places: 'Локации', items: 'Вещи', cards: 'Карточки персонажей', wardrobe: 'Гардероб', calendar: 'Календарь',
  weather: 'Погода', dice: 'Кубик близости', names: 'Имена', songs: 'Песни', quests: 'Квесты',
  overview: 'Все отношения', headcanons: 'Хедканоны отношений',
  journal: 'История изменений', lorebooks: 'Подключённые лорбуки', settings: 'Настройки',
});

export function createRelationshipStudio(options = {}) {
  const facade = createFacade(options);
  const host = element('div', { className: 'kulisy-studio-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  const cleanups = [shieldKeys(shadow)];
  let snapshot = normalizeSnapshot(options.initialState || facade.read());
  let selectedPairId = options.activePairId || snapshot.activePairId || pairId(snapshot.activePair);
  // Window or docked panel, and the last tab: kept in extension settings via onLayoutChange.
  const layout = normalizeLayout({ tab: options.initialTab, ...options.layout });
  let tab = layout.tab;
  let isOpen = false;
  let resizing = false; // the dock width handle is being dragged
  let renderDeferred = false; // a render() arrived mid-drag and runs when it ends
  let returnFocus = null;
  let factorsPairId = null;
  let toolsOpen = false; // phone only: persona/pair block is collapsible
  let triangleSetupId = null; // triangle whose setup sheet is open in the factors layer
  const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;

  const style = element('style', { text: STYLE + KNOWLEDGE_STYLE + SETTINGS_STYLE + WORLD_STYLE + WARDROBE_STYLE + LIBRARY_STYLE + CALENDAR_STYLE + CALENDAR_BUILDER_STYLE + NAMES_STYLE + SONGS_STYLE + WEATHER_STYLE + DICE_STYLE + QUESTS_STYLE + `
    .relationship-card{min-width:0;overflow:hidden}.relationship-card .grid{display:flex;flex-direction:column;gap:14px}.relationship-card .card{min-width:0;width:100%;position:static;grid-area:auto}.relationship-card .metric{grid-template-columns:minmax(80px,110px) minmax(0,1fr) 42px}.relationship-card input[type=range]{min-width:0;width:100%}.item p{overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chips .active{border-color:var(--rs-accent)}.triangle-edges{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px}.header{flex-wrap:wrap}
    input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:20px;background:transparent;cursor:pointer;accent-color:var(--rs-accent)}
    input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:4px;background:var(--rs-track);border:1px solid var(--rs-line)}
    input[type=range]::-moz-range-track{height:6px;border-radius:4px;background:var(--rs-track);border:1px solid var(--rs-line)}
    input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;border-radius:50%;background:var(--rs-accent);border:2px solid var(--rs-bg);margin-top:-6px;box-shadow:0 1px 4px var(--k-shadow)}
    input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--rs-accent);border:2px solid var(--rs-bg);box-shadow:0 1px 4px var(--k-shadow)}
    input[type=range]:focus-visible{outline:2px solid var(--rs-accent);outline-offset:2px}
    input[type=checkbox]{accent-color:var(--rs-accent)}
    .recent-context summary::-webkit-details-marker{display:none}
    .recent-context summary::before{content:'▸';display:inline-block;transition:transform .15s}
    .recent-context[open] summary::before{transform:rotate(90deg)}
    *{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--rs-accent) 45%,var(--rs-line)) transparent}
    *::-webkit-scrollbar{width:10px;height:10px}
    *::-webkit-scrollbar-track{background:color-mix(in srgb,var(--rs-bg) 70%,transparent)}
    *::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--rs-accent) 40%,var(--rs-line));border-radius:8px;border:2px solid transparent;background-clip:content-box}
    *::-webkit-scrollbar-thumb:hover{background:var(--rs-accent);background-clip:content-box}
    *::-webkit-scrollbar-corner{background:transparent}
    input[type=text],input[type=number],input[type=file],select,textarea{background:color-mix(in srgb,var(--rs-inset) 70%,var(--rs-bg));color:var(--rs-text);border:1px solid var(--rs-line);border-radius:8px;padding:8px 10px;width:100%}
    input:focus-visible,select:focus-visible,textarea:focus-visible{border-color:var(--rs-accent);outline:none}
    @keyframes rs-spin{to{transform:rotate(360deg)}}
    .busy-pill{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border:1px solid var(--rs-accent);border-radius:999px;background:color-mix(in srgb,var(--rs-accent) 18%,var(--rs-panel));font-size:12px;font-weight:600;white-space:nowrap}
    .busy-pill[hidden]{display:none}
    .busy-pill .dot{width:12px;height:12px;border-radius:50%;border:2px solid color-mix(in srgb,var(--rs-accent) 40%,transparent);border-top-color:var(--rs-accent);animation:rs-spin .8s linear infinite;flex:0 0 auto}
    .fold{border:1px solid var(--rs-line);border-radius:13px;background:var(--rs-panel)}
    .fold>summary{cursor:pointer;list-style:none;padding:14px 16px;font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px}
    .fold>summary::-webkit-details-marker{display:none}
    .fold>summary::before{content:'▸';display:inline-block;transition:transform .15s;color:var(--rs-muted)}
    .fold[open]>summary::before{transform:rotate(90deg)}
    .fold>summary .muted{font-weight:400}
    .fold-body{padding:0 16px 16px}
    .fold .fold-body>.card{border:0;padding:0;background:none}
    .triangle-list{display:grid;gap:16px}
    .triangle-form{display:grid;gap:10px}
    .triangle-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}
    .triangle-head h3{margin:0}
    .triangle-goal{margin:-6px 0 14px;font-size:13px;line-height:1.45;overflow-wrap:anywhere}
    .sheet-section{margin:16px 0 6px;font-size:13px}
    .trope-hint{font-size:12px;margin:6px 0 0;line-height:1.4}
    .factor-origin{font-size:11px;color:var(--rs-accent)}
    .pace-box{display:flex;flex-direction:column;gap:6px;align-items:flex-start;font-size:12px;margin:10px 0 0}
    .pace-box:empty{display:none}
    .pace-box .btn,.pace-line .btn{min-height:30px;padding:4px 10px;font-size:12px}
    .pace-line{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;margin:4px 0}
    .pace-editor{width:100%}
    .factor-hits{font-size:11px;opacity:.65}
    .factor-analysis{margin:0 0 10px;font-size:12px}
    .factor-analysis summary{cursor:pointer;font-weight:600}
    .factor-analysis p{margin:6px 0 0;line-height:1.45}
    .factor-hits.on{opacity:1;font-weight:600}
    .pace-editor summary{cursor:pointer;font-weight:600}
    .pace-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 12px;margin:6px 0}
    .pace-cell{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:12px}
    .pace-cell select{min-width:0;max-width:110px}
    .sheet-section:first-child{margin-top:0}
    .relationship-card>details+details{margin-top:12px;padding-top:12px;border-top:1px solid var(--rs-line)}
    .relationship-card>details>summary{cursor:pointer;font-weight:600;margin-bottom:6px}
    .pair-swap{justify-self:center;display:grid;place-items:center;width:30px;height:30px;min-height:30px;padding:0;font-size:15px;line-height:1;border-radius:8px}
    .pair-swap:disabled{opacity:.4;cursor:default}
    .pair-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px}
    .pair-card-head h3{margin:0;min-width:0;overflow-wrap:anywhere}
    .pair-flags{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px}
    .alias-edit{flex:0 0 26px;width:26px;height:26px;min-height:26px;padding:0;font-size:12px;line-height:1;border-radius:6px;display:grid;place-items:center}
    .alias-editor{grid-column:1/-1;display:grid;gap:6px;padding:10px;border:1px solid var(--rs-accent);border-radius:8px;background:var(--rs-inset)}
    .prompt-section{border-top:1px solid var(--rs-line);padding:8px 0}
    .prompt-section>summary{cursor:pointer;font-weight:600;font-size:13px}
    .prompt-section .btn{min-height:30px;padding:4px 10px;font-size:12px;margin:2px 0 6px}
    .prompt-lines{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 0;max-height:220px;overflow:auto;font-size:11px}
    .card-corner{position:absolute;top:10px;right:10px;display:flex;gap:6px}
    .card-corner .icon{width:32px;height:32px;min-height:32px;padding:0;font-size:15px;display:grid;place-items:center;line-height:1}
    .card-corner .remove-line:hover{border-color:var(--rs-danger);color:var(--rs-danger)}
    .eye-toggle{position:relative}
    .eye-toggle.off{opacity:.55}
    .eye-toggle.off::after{content:'';position:absolute;left:6px;right:6px;top:50%;height:2px;background:currentColor;transform:rotate(-35deg)}
    .relationship-card{position:relative}
    .relationship-card .pair-card-head{padding-right:78px}
    .headcanon-pairs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:10px}
    .headcanon-pair{display:grid;gap:4px;text-align:left;padding:12px 14px;border:1px solid var(--rs-line);border-radius:10px;background:var(--rs-inset);color:var(--rs-text);cursor:pointer;font:inherit}
    .headcanon-pair:hover,.headcanon-pair:focus-visible{border-color:var(--rs-accent);outline:none}
    .headcanon-pair .muted{font-size:12px}
    .headcanon-auto{font-size:11px;color:var(--rs-muted)}
    .headcanon-auto.on{color:var(--rs-accent)}
    .headcanon-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .headcanon-head h3{margin:0}
    .headcanon-view{margin:0 0 10px;padding:0 0 10px;border-bottom:1px dashed var(--rs-line);line-height:1.45;overflow-wrap:anywhere}
    .headcanon-view.off{opacity:.45}
    .pair-title{display:flex;align-items:flex-start;gap:8px;min-width:0;cursor:pointer}
    .pair-title input{width:15px;height:15px;margin:2px 0 0;flex:0 0 auto}
    .relationship-card.selected{border-color:var(--rs-danger)}
    .fold-actions{margin-left:auto;display:flex;align-items:center}
    .bulk-trash{width:auto;min-width:40px;min-height:34px;padding:4px 10px;font-size:15px}
    .bulk-trash:not(:disabled):hover{border-color:var(--rs-danger);color:var(--rs-danger)}
    .bulk-trash:disabled{opacity:.4;cursor:default}
    .strangers-toggle{display:flex;align-items:center;gap:6px;flex:0 0 auto;font-size:12px;color:var(--rs-muted);cursor:pointer;white-space:nowrap}
    .strangers-toggle input{width:14px;height:14px;margin:0}
    .tselect{position:relative;min-width:0}
    .tselect-trigger{width:100%;min-height:40px;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;padding:8px 10px;border:1px solid var(--rs-line);border-radius:8px;background:color-mix(in srgb,var(--rs-inset) 70%,var(--rs-bg));color:var(--rs-text);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tselect-trigger::after{content:'▾';flex:0 0 auto;color:var(--rs-muted)}
    .tselect-trigger[aria-expanded=true],.tselect-trigger:focus-visible{border-color:var(--rs-accent);outline:none}
    .tselect-list{position:absolute;z-index:20;left:0;right:0;top:calc(100% + 4px);max-height:260px;overflow-y:auto;overscroll-behavior:contain;padding:4px;border:1px solid var(--rs-accent);border-radius:9px;background:var(--rs-bg);box-shadow:0 12px 32px var(--k-shadow)}
    .tselect-list[hidden]{display:none}
    .tselect-option{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:var(--rs-text);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tselect-option:hover,.tselect-option:focus-visible{background:color-mix(in srgb,var(--rs-panel) 70%,var(--rs-accent));outline:none}
    .tselect-option[aria-selected=true]{color:var(--rs-accent);font-weight:700}
    .records-view{display:grid;gap:16px}
    .record-form{display:grid;gap:10px}
    .record-list-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px}
    .record-list-head h3{margin:0}
    .record-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px;margin-bottom:14px}
    .record-list{display:grid;gap:10px}
    .record{border:1px solid var(--rs-line);border-left:3px solid var(--rs-accent);border-radius:10px;padding:12px 14px;background:color-mix(in srgb,var(--rs-inset) 80%,var(--rs-bg));display:grid;gap:8px}
    .record.off{opacity:.5;border-left-color:var(--rs-line)}
    .record.editing{border-left-color:var(--rs-accent);background:var(--rs-panel)}
    .record-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .record-head time{margin-left:auto;color:var(--rs-muted);font-size:11px}
    .record-intensity{color:var(--rs-accent);letter-spacing:2px;font-size:12px}
    .record-badge{font-size:11px;padding:1px 8px;border:1px solid var(--rs-line);border-radius:999px;color:var(--rs-muted)}
    .record-badge.pinned{border-color:var(--rs-accent);color:var(--rs-text)}
    .record-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.45}
    .record-people{display:flex;flex-wrap:wrap;gap:6px}
    .record-people .chip{font-size:11px;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--rs-panel) 80%,var(--rs-accent));border:1px solid var(--rs-line)}
    .record-secret{margin:0;font-size:11px;color:var(--rs-accent)}
    .record-actions{display:flex;gap:6px;flex-wrap:wrap}
    .record-actions .btn{min-height:30px;padding:4px 10px;font-size:12px}
    .roster{border:1px solid var(--rs-line);border-radius:8px;padding:8px 10px}
    .roster-legend{font-size:11px;margin:0 0 6px}
    .roster-list{max-height:150px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,170px),1fr));gap:4px;padding-right:4px}
    .roster-item{display:flex;align-items:center;gap:8px;margin:0;cursor:pointer;padding:2px 0;min-width:0}
    .roster-item input{width:14px;height:14px;flex:0 0 auto;margin:0}
    .scale-editor-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px}
    .scale-editor-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--rs-line);border-radius:8px;cursor:pointer;font-size:13px}
    .scale-editor-item input{width:14px;height:14px;margin:0;flex:0 0 auto}
    .mobile-tools{display:none}
    .sidebar-tools>summary{display:none}
    .factors-layer{position:fixed;left:0;right:0;top:0;height:100%;z-index:2147483001;display:grid;place-items:center;padding:16px;background:var(--k-backdrop)}
    .factors-layer[hidden]{display:none}
    .factors-sheet{width:min(680px,100%);max-height:min(88vh,100%);display:flex;flex-direction:column;background:var(--rs-bg);color:var(--rs-text);border:1px solid var(--rs-line);border-radius:12px;box-shadow:0 20px 60px var(--k-shadow);overflow:hidden;font-family:var(--k-font)}
    .factors-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--rs-line);flex:0 0 auto}
    .factors-head h3{flex:1;min-width:0;margin:0;font-size:15px;overflow-wrap:anywhere}
    .factors-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 14px;-webkit-overflow-scrolling:touch}
    .factors-foot{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--rs-line);flex:0 0 auto}
    .factors-foot .btn{flex:1}
    .factor-row{display:grid;gap:6px;margin:0 0 12px;padding-bottom:12px;border-bottom:1px dashed var(--rs-line)}
    .factor-controls{display:flex;gap:6px;align-items:center}
    .factor-controls select{flex:1 1 0;min-width:0}
    .factor-controls .icon{flex:0 0 40px;width:40px;min-height:40px}
    .factor-row textarea{width:100%;min-height:44px;resize:vertical;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.35}
    .factors-generate{border-top:1px solid var(--rs-line);margin:14px 0 0;padding-top:12px}
    .factors-generate-row{display:flex;gap:6px;flex-wrap:wrap}
    .factors-generate-row select,.factors-generate-row input{flex:1 1 180px;min-width:0}
    .factors-status{min-height:0;font-size:12px}
    /* Grouped menu: Сцена / Отношения / Система */
    .ku-ico{display:inline-grid;place-items:center;width:18px;height:18px;flex:0 0 auto}
    .ku-ico svg{width:18px;height:18px}
    .nav{gap:2px}
    .nav-group{font:700 11px/1.2 var(--k-font);letter-spacing:.1em;text-transform:uppercase;color:var(--k-muted);margin:16px 6px 5px}
    .nav-group:first-child{margin-top:0}
    .nav button.nav-fold{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:0;padding:4px 6px;margin:12px 0 2px;border-radius:8px;font:700 11px/1.2 var(--k-font);letter-spacing:.1em;text-transform:uppercase;color:var(--k-muted);cursor:pointer}
    .nav button.nav-fold:first-child{margin-top:0}
    .nav button.nav-fold:hover{color:var(--k-text);background:var(--k-panel)}
    .nav button.nav-fold .ku-ico,.nav button.nav-fold .ku-ico svg{width:14px;height:14px;transition:transform .15s}
    .nav button.nav-fold.folded .ku-ico{transform:rotate(-90deg)}
    .nav button{display:flex;align-items:center;gap:10px;min-height:38px;border-color:transparent;background:transparent}
    .nav button .ku-ico{color:var(--k-muted)}
    .nav button:hover{border-color:var(--k-line);background:var(--k-panel)}
    .nav button.active{border-color:var(--k-accent-line);background:var(--k-accent-soft);color:var(--k-accent);font-weight:700}
    .nav button.active .ku-ico{color:var(--k-accent)}
    .nav-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .nav .soon{font-size:10px;color:var(--k-faint);font-weight:400}
    .header .icon{display:inline-grid;place-items:center}
    .pending{display:grid;gap:8px;max-width:560px}
    /* Docked panel: sits beside the chat under SillyTavern's top bar, chat stays usable. */
    .backdrop.docked{background:transparent;pointer-events:none;display:block;padding:0}
    /* «display:block» above outranked [hidden]: the docked panel stayed on screen after ✕ while the Studio thought it was closed. */
    .backdrop.docked[hidden]{display:none}
    .backdrop.docked .studio{pointer-events:auto;position:fixed;top:calc(var(--topBarBlockSize,0px) + 10px);right:10px;bottom:10px;width:min(var(--ku-dock-width,520px),calc(100vw - 330px));min-width:min(360px,calc(100vw - 20px));height:auto;border-radius:18px;border-width:1px;grid-template-columns:58px minmax(0,1fr);box-shadow:-18px 0 50px var(--k-shadow)}
    .dock .header{min-height:56px;padding:8px 12px;gap:8px;flex-wrap:nowrap}
    .dock .brand span{display:none}
    .dock .brand strong{font-size:17px}
    .dock .header .status{display:none}
    .dock .sidebar{padding:10px 8px;overflow-y:auto;overflow-x:hidden}
    .dock .nav{justify-items:center;margin:0}
    .dock .nav button{width:42px;min-height:42px;padding:0;justify-content:center}
    .dock .nav-label,.dock .nav .soon,.dock .sidebar-tools{display:none}
    .dock .nav-group{width:24px;height:1px;margin:8px auto;background:var(--k-line);font-size:0;overflow:hidden}
    .dock .nav-group:first-child{display:none}
    .dock .content{padding:14px 16px}
    .dock .hero{margin-bottom:14px}
    .dock .hero h2{font-size:22px}
    .dock .grid{grid-template-columns:minmax(0,1fr)}
    .dock-tools{margin:0 0 14px;padding:0 12px;border:1px solid var(--k-line);border-radius:10px;background:var(--k-panel)}
    .dock-tools>summary{cursor:pointer;padding:10px 0;font-size:13px;font-weight:600}
    /* Width handle on the docked panel's left edge */
    .dock-resize{display:none}
    .dock .dock-resize{display:block;position:absolute;left:0;top:0;bottom:0;width:8px;z-index:3;cursor:ew-resize;touch-action:none;background:transparent;border:0;padding:0}
    .dock .dock-resize::after{content:"";position:absolute;left:3px;top:50%;width:2px;height:44px;margin-top:-22px;border-radius:2px;background:var(--k-line);transition:background .15s}
    .dock .dock-resize:hover::after,.dock .dock-resize:focus-visible::after,.dock .dock-resize.dragging::after{background:var(--k-accent)}
    .dock .dock-resize:focus-visible{outline:none}
    .studio.resizing{user-select:none}
    @media(max-width:760px){
      .mobile-tools{display:flex}
      /* One scroll container for the whole studio: nothing scrolls sideways,
         the tab strip stays pinned, the content gets the full screen. */
      .studio{display:flex;flex-direction:column;height:100dvh;max-height:100dvh;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .header{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;min-height:0}
      .header .brand{order:0;flex:1 1 calc(100% - 104px);min-width:0;margin:0}
      .header .brand strong{font-size:18px}
      .header>.icon{order:1;width:40px;min-height:40px;flex:0 0 auto}
      .header>.busy-pill{order:2;flex:1 1 100%}
      .header>.btn.primary{order:3;flex:1 1 140px;min-height:40px;padding:6px 8px;font-size:13px;white-space:normal;line-height:1.2}
      .header>.mobile-tools{order:4;flex:1 1 100%;margin:0;justify-content:flex-start}
      .header>.status{order:5;flex:1 1 100%;margin:0;min-height:0}
      .header>.status:empty{display:none}
      .sidebar{display:contents}
      .nav{position:sticky;top:0;z-index:5;display:flex;flex-wrap:nowrap;gap:6px;margin:0;padding:8px 12px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;background:var(--rs-bg);border-bottom:1px solid var(--rs-line);flex:0 0 auto}
      .nav::-webkit-scrollbar{display:none}
      .nav button{flex:0 0 auto;min-height:40px;padding:6px 12px;font-size:14px}
      .sidebar-tools{flex:0 0 auto;margin:10px 12px 0;padding:0 12px;border:1px solid var(--rs-line);border-radius:10px;background:var(--rs-panel)}
      .sidebar-tools>summary{display:block;cursor:pointer;padding:11px 0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;list-style:none}
      .sidebar-tools>summary::-webkit-details-marker{display:none}
      .sidebar-tools>summary::before{content:'▸';display:inline-block;margin-right:6px;transition:transform .15s}
      .sidebar-tools[open]>summary::before{transform:rotate(90deg)}
      .sidebar-tools[open]{padding-bottom:10px}
      .sidebar-tools .field{min-width:0}
      .content{flex:0 0 auto;overflow:visible;padding:12px;min-width:0}
      .hero{margin-bottom:12px}
      .hero h2{font-size:22px}
      .card{padding:12px;border-radius:11px}
      .relationship-cards{gap:12px!important}
      .relationship-card .card{padding:0;border:0;background:none}
      .relationship-card .card h3{font-size:13px;color:var(--rs-muted);margin:0 0 4px}
      .metric,.relationship-card .metric{grid-template-columns:minmax(84px,104px) minmax(0,1fr) 40px;gap:8px;margin:8px 0;font-size:14px}
      .metric label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .grid{grid-template-columns:minmax(0,1fr)}
      .field{min-width:0}
      .toolbar{margin-bottom:0}
      .chips{flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}
      .chips .btn{flex:0 0 auto;min-height:34px;font-size:12px;padding:4px 10px}
      .item-head{flex-wrap:wrap}
      .factors-layer{padding:0;place-items:stretch}
      .factors-sheet{width:100%;height:100%;max-height:none;border-radius:0;border:0}
      .factors-generate-row .btn{flex:1 1 100%}
      /* vertical swipes over sliders scroll the page instead of yanking values */
      input[type=range]{touch-action:pan-y}
    }
  ` });
  const backdrop = element('div', { className: 'backdrop', hidden: true });
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', options.label || 'Кулисы');
  const panel = element('section', { className: 'studio', tabIndex: -1 });
  backdrop.append(panel);
  const resizeHandle = createResizeHandle();
  const factorsLayer = element('div', { className: 'factors-layer', hidden: true });
  factorsLayer.addEventListener('click', event => { if (event.target === factorsLayer) closeFactors(); });
  shadow.append(style, backdrop, factorsLayer);
  ensureContainer(options.container).append(host);

  function emit(name, detail) {
    dispatch(host, `kulisy-studio:${name}`, detail);
  }

  function act(name, payload, eventName = name) {
    const result = facade.invoke(name, payload);
    emit(eventName, payload);
    if (result?.then) result.catch((error) => setStatus(error?.message || String(error), true));
    return result;
  }

  // The status line outlives a re-render (an action ends with one); a new page clears it.
  let lastStatus = { message: '', danger: false };
  function setStatus(message, danger = false) {
    lastStatus = { message: message || '', danger };
    const status = shadow.querySelector('.status');
    if (status) {
      status.textContent = message || '';
      status.classList.toggle('danger', danger);
    }
  }

  function isDocked() {
    return effectiveMode(layout.mode, isPhone()) === 'dock';
  }

  function saveLayout() {
    try { facade.invoke('onLayoutChange', { mode: layout.mode, tab, width: layout.width, open: isOpen, folded: layout.folded }); }
    catch (error) { console.error('[Kulisy] Could not save the Studio layout.', error); }
  }

  function setTab(id) {
    if (id !== tab) lastStatus = { message: '', danger: false };
    tab = id;
    saveLayout();
    render();
  }

  function setMode(mode) {
    layout.mode = mode;
    saveLayout();
    applyMode();
    render();
    requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  }

  /** Window: modal over a dimmed page. Dock: a panel beside the chat, the page stays usable. */
  function applyMode() {
    const docked = isDocked();
    panel.classList.toggle('dock', docked);
    backdrop.classList.toggle('docked', docked);
    panel.style.setProperty('--ku-dock-width', `${layout.width}px`);
    resizeHandle.setAttribute('aria-valuenow', String(layout.width));
    backdrop.setAttribute('aria-modal', String(!docked));
  }

  function setDockWidth(width, persist) {
    layout.width = clampDockWidth(width, window.innerWidth);
    panel.style.setProperty('--ku-dock-width', `${layout.width}px`);
    resizeHandle.setAttribute('aria-valuenow', String(layout.width));
    if (persist) saveLayout();
  }

  /**
   * Built once and re-attached on every render(). Detaching an element drops its
   * pointer capture, so render() waits while a drag is on (see resizing) and
   * catches up when it ends. Mouse/pen/touch drag, arrow keys, double click = default.
   */
  function createResizeHandle() {
    const handle = element('button', {
      type: 'button', className: 'dock-resize', title: 'Потяните, чтобы изменить ширину. Двойной клик — ширина по умолчанию',
      'aria-label': 'Ширина панели', role: 'separator', 'aria-orientation': 'vertical',
      'aria-valuemin': String(DOCK_WIDTH.min), 'aria-valuemax': String(DOCK_WIDTH.max),
    });
    let dragging = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragging = { pointerId: event.pointerId };
      try { handle.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      handle.classList.add('dragging');
      panel.classList.add('resizing');
      resizing = true;
    });
    handle.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      // The panel is pinned to the right edge: its width is the distance to it.
      setDockWidth(window.innerWidth - event.clientX, false);
    });
    const finish = event => {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      dragging = null;
      resizing = false;
      handle.classList.remove('dragging');
      panel.classList.remove('resizing');
      saveLayout();
      if (renderDeferred) { renderDeferred = false; if (isOpen) render(); }
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('dblclick', () => setDockWidth(DOCK_WIDTH.default, true));
    handle.addEventListener('keydown', event => {
      // The handle sits on the left: ← widens the panel, → narrows it.
      const delta = event.key === 'ArrowLeft' ? DOCK_WIDTH.step : event.key === 'ArrowRight' ? -DOCK_WIDTH.step : 0;
      if (!delta) return;
      event.preventDefault();
      setDockWidth(layout.width + delta, true);
    });
    return handle;
  }

  /** Replace a button's text with an icon; its title and aria-label stay as the accessible name. */
  function iconOnly(node, iconName) {
    node.replaceChildren(icon(iconName));
    return node;
  }

  function render() {
    if (resizing) { renderDeferred = true; return; }
    applyMode();
    const pair = getPair(snapshot, selectedPairId);
    if (pair) selectedPairId = pairId(pair);
    // Keep the reader where they were: re-rendering replaces the scroll
    // containers' contents, which can snap them back to the top.
    const scrollState = [panel, panel.querySelector('.content'), panel.querySelector('.sidebar'), panel.querySelector('.nav')]
      .map(node => node ? { top: node.scrollTop, left: node.scrollLeft } : null);
    panel.replaceChildren(renderHeader(), renderSidebar(), renderContent(pair), resizeHandle);
    [panel, panel.querySelector('.content'), panel.querySelector('.sidebar'), panel.querySelector('.nav')].forEach((node, index) => {
      const saved = scrollState[index];
      if (node && saved) { node.scrollTop = saved.top; node.scrollLeft = saved.left; }
    });
    // The factors dialog lives in its own layer and is NOT rebuilt here:
    // rebuilding it on every state update threw away what the user typed.
    if (factorsPairId && !(snapshot.pairs || []).some(item => pairId(item) === factorsPairId)) closeFactors();
    if (triangleSetupId && !(snapshot.ui?.triangles ?? []).some(item => item.id === triangleSetupId)) closeFactors();
  }

  function openFactors(id) {
    const pair = getPair(snapshot, id);
    if (!pair) return;
    triangleSetupId = null;
    factorsPairId = pairId(pair);
    const sheet = renderFactorsDialog(pair);
    factorsLayer.replaceChildren(sheet);
    factorsLayer.hidden = false;
    fitFactorsToViewport();
    requestAnimationFrame(() => sheet.querySelector('.factors-close')?.focus({ preventScroll: true }));
  }

  function closeFactors() {
    factorsPairId = null;
    triangleSetupId = null;
    factorsLayer.hidden = true;
    factorsLayer.replaceChildren();
    factorsLayer.style.top = '';
    factorsLayer.style.height = '';
  }

  // On phones the on-screen keyboard shrinks only the *visual* viewport; pin the
  // sheet to it so the title and the Save/Close buttons stay on screen.
  function fitFactorsToViewport() {
    if (factorsLayer.hidden) return;
    const viewport = window.visualViewport;
    if (isPhone() && viewport) {
      factorsLayer.style.top = `${Math.round(viewport.offsetTop)}px`;
      factorsLayer.style.height = `${Math.round(viewport.height)}px`;
    } else {
      factorsLayer.style.top = '';
      factorsLayer.style.height = '';
    }
  }

  function openTriangleSetup(id) {
    const triangle = (snapshot.ui?.triangles ?? []).find(item => item.id === id);
    if (!triangle) return;
    let lines;
    try { lines = facade.invoke('onTriangleLines', { id }) ?? []; }
    catch (error) { setStatus(error?.message || 'Не удалось открыть треугольник', true); return; }
    factorsPairId = null;
    triangleSetupId = id;
    const sheet = renderTriangleDialog(triangle, lines);
    factorsLayer.replaceChildren(sheet);
    factorsLayer.hidden = false;
    fitFactorsToViewport();
    requestAnimationFrame(() => sheet.querySelector('.factors-close')?.focus({ preventScroll: true }));
  }

  function renderHeader() {
    const brand = element('div', { className: 'brand' }, [
      element('strong', { text: options.title || 'Кулисы' }),
      element('span', { text: options.subtitle || 'Кто на сцене, кто что знает и что чувствует' }),
    ]);
    const docked = isDocked();
    const historyButton = button('Проанализировать историю', 'btn primary', async () => {
      historyButton.disabled = true;
      try {
        await act('onAnalyzeHistory', {
          onProgress(message) { setStatus(message); },
        }, 'analyze-history');
        setStatus('История чата проанализирована');
      } catch (error) { setStatus(error?.message || 'Не удалось проанализировать историю', true); }
      finally { historyButton.disabled = false; }
    });
    const analyzeButton = button('Проверить последний ответ', 'btn primary', async () => {
      try {
        await act('onAnalyzeCurrent', {}, 'analyze-current');
        setStatus('Анализ завершён');
      } catch (error) { setStatus(error?.message || 'Не удалось проанализировать ответ', true); }
    });
    if (snapshot.modelBusy) {
      historyButton.disabled = true;
      analyzeButton.disabled = true;
    }
    const busyPill = element('span', { className: 'busy-pill', role: 'status', 'aria-live': 'polite',
      title: 'Расширение отправило запрос модели и ждёт ответа' });
    if (snapshot.modelBusy) {
      busyPill.append(element('span', { className: 'dot' }), element('span', { text: `Модель думает: ${snapshot.modelBusyLabel || 'запрос к модели…'}` }));
    } else {
      busyPill.hidden = true;
    }
    if (docked) {
      // No room for two long labels beside the chat: icons with the same titles.
      iconOnly(historyButton, 'history');
      iconOnly(analyzeButton, 'scan');
      historyButton.className = analyzeButton.className = 'icon';
    }
    const modeButton = iconOnly(button('', 'icon mode-toggle', () => setMode(docked ? 'window' : 'dock'),
      docked ? 'Развернуть в окно' : 'Пристегнуть к краю: чат останется виден'), docked ? 'expand' : 'dock');
    // A phone has no room beside the chat, so it never docks.
    modeButton.hidden = isPhone();
    return element('header', { className: 'header' }, [
      brand, busyPill, historyButton, analyzeButton,
      element('span', { className: `status${lastStatus.danger ? ' danger' : ''}`, role: 'status', 'aria-live': 'polite', text: lastStatus.message }),
      modeButton,
      iconOnly(button('', 'icon', close, 'Закрыть Кулисы'), 'close'),
    ]);
  }

  function renderSidebar() {
    const nav = element('nav', { className: 'nav', 'aria-label': 'Разделы Кулис' });
    for (const group of NAV_GROUPS) {
      // Folding is for the wide menu only: the narrow dock shows icons and a hairline between groups.
      const foldable = !isDocked();
      const folded = foldable && layout.folded.includes(group.id);
      if (foldable) {
        const head = button('', `nav-group nav-fold${folded ? ' folded' : ''}`, () => {
          layout.folded = folded ? layout.folded.filter(id => id !== group.id) : [...layout.folded, group.id];
          saveLayout();
          render();
        }, folded ? `Развернуть «${group.title}»` : `Свернуть «${group.title}»`);
        head.append(element('span', { text: group.title }), icon('chevron'));
        head.setAttribute('aria-expanded', String(!folded));
        nav.append(head);
      } else {
        nav.append(element('p', { className: 'nav-group', text: group.title, 'aria-hidden': 'true' }));
      }
      for (const [id, label, iconName] of group.items) {
        // A folded group still shows the page that is open, so the menu never loses your place.
        if (folded && id !== tab) continue;
        const pending = PENDING_TABS.has(id);
        const item = button('', id === tab ? 'active' : '', () => setTab(id), pending ? `${label} — раздел в работе` : label);
        item.append(icon(iconName), element('span', { className: 'nav-label', text: label }));
        if (pending) item.append(element('span', { className: 'soon', text: 'скоро' }));
        const leakCount = id === 'leaks' ? (snapshot.leaks?.length ?? 0) + (snapshot.slips?.length ?? 0) + looksIssues(snapshot.looksFit).length : 0;
        if (leakCount) item.append(element('span', { className: 'badge', text: String(leakCount), 'aria-label': `открыто проверок (утечки, ляпы, одежда): ${leakCount}` }));
        item.setAttribute('aria-current', id === tab ? 'page' : 'false');
        nav.append(item);
      }
    }
    return element('aside', { className: 'sidebar' }, isDocked() ? [nav] : [nav, renderTools()]);
  }

  /** «Персона»: which SillyTavern persona this chat is, and her hidden character for the factor analysis. */
  function renderPersonaPage() {
    const view = element('div', { className: 'records-view' });
    const binding = element('div', { className: 'card' }, [element('h3', { text: 'Персона этого чата' }), personaBinding()]);
    view.append(binding);
    const card = element('div', { className: 'card' }, [element('h3', { text: 'Скрытый характер' })]);
    if (!snapshot.personaAvatar) {
      card.append(element('p', { className: 'muted', text: 'Сначала привяжите персону: характер хранится у персоны SillyTavern и подходит ко всем её чатам.' }));
    } else {
      const field = element('textarea', { rows: 10, maxlength: 4000, value: snapshot.personaPrivate ?? '', 'aria-label': 'Скрытый характер персоны', placeholder: 'Какая она на самом деле: характер, привычки, что прячет, на что реагирует. Например: колючая и насмешливая, но теряется от прямой нежности; ненавидит, когда её жалеют; прячет шрамы под длинными рукавами.' });
      const save = button('Сохранить', 'btn primary', () => act('onSetPersonaPrivate', { text: field.value }, 'persona-private'));
      card.append(
        element('p', { className: 'muted', style: { fontSize: '12px', margin: '0 0 8px' }, text: `Для «${snapshot.personaBoundName}», во всех её чатах. Рассказчик и анализатор этого НЕ получают, поэтому персонажи не «знают» её характер с первой секунды знакомства. Читается только при разборе персонажей для факторов роста и тропов: модель понимает, какие поступки персоны тронут персонажа и как она себя поведёт. В текст факторов попадают только видимые поступки, а не черты.` }),
        field,
        element('div', { className: 'row', style: { marginTop: '8px' } }, [save, element('span', { className: 'muted', style: { fontSize: '11px' }, text: `${(snapshot.personaPrivate ?? '').length} / 4000` })]),
      );
    }
    view.append(card);
    return view;
  }

  /** Which SillyTavern persona this chat is: the select, «Привязать», «Отвязать» and the warnings. */
  function personaBinding() {
    const personaForm = element('div', { className: 'field' });
    const tavernPersonas = snapshot.tavernPersonas || [];
    const personaSelect = element('select', { 'aria-label': 'Персона SillyTavern для этого чата' });
    personaSelect.append(element('option', { value: '', text: tavernPersonas.length ? 'Выберите персону' : 'Персон в Tavern не найдено' }));
    for (const persona of tavernPersonas) personaSelect.append(element('option', {
      value: persona.avatarId,
      text: persona.lockedToChat ? `${persona.name} (привязана к чату)` : persona.name,
      selected: Boolean(snapshot.personaBoundName && persona.name.toLocaleLowerCase('ru-RU') === snapshot.personaBoundName.toLocaleLowerCase('ru-RU')),
    }));
    personaForm.append(
      element('label', { text: 'Персона SillyTavern' }),
      personaSelect,
      button('Привязать', 'btn', () => {
        if (personaSelect.value) act('onSetTavernPersona', { avatarId: personaSelect.value }, 'persona-set');
        else setStatus('Сначала выберите персону из списка', true);
      }),
      ...(snapshot.personaBoundName ? [button('Отвязать', 'btn', () => act('onSetTavernPersona', { avatarId: '' }, 'persona-clear'))] : []),
    );
    if (snapshot.personaBoundName) {
      personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Привязана: ${snapshot.personaBoundName}. Исходящие линии персоны скрыты.` }));
      if (snapshot.personaMismatch) personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px', color: 'var(--k-warn)' }, text: `Внимание: персона чата в Tavern — «${snapshot.chatPersonaName}», а привязана «${snapshot.personaBoundName}». Проверьте выбор.` }));
    } else if (snapshot.chatPersonaName) {
      personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: `Персона этого чата в Tavern — «${snapshot.chatPersonaName}». Нажмите «Привязать» с выбранным именем, чтобы скрыть её исходящие линии.` }));
    }
    personaForm.append(element('p', { className: 'muted', style: { fontSize: '11px' }, text: 'Её исходящие чувства не отслеживаются, входящие к ней — отслеживаются.' }));
    return personaForm;
  }

  /** The edited pair (and a link to the persona page): under the menu in the window, atop the page when docked. */
  function renderTools() {
    const personaForm = element('div', { className: 'field' }, [
      button(snapshot.personaBoundName ? `Персона: ${snapshot.personaBoundName}` : 'Персона не привязана', `btn small${snapshot.personaMismatch ? ' danger' : ''}`, () => setTab('persona'), 'Привязка персоны и её скрытый характер'),
    ]);
    const pairForm = element('div', { className: 'field', style: { borderTop: '1px solid var(--rs-line)', marginTop: '12px', paddingTop: '12px' } });
    const pair = getPair(snapshot, selectedPairId);
    pairForm.append(element('p', { className: 'section-title', style: { margin: '0 0 4px' }, text: 'Редактируемая пара' }), pairToolbar(pair));
    // On phones this block collapses so the selected tab is visible right away
    // instead of being pushed below half a screen of form controls.
    const tools = element('details', { className: 'sidebar-tools' });
    tools.open = !isPhone() || toolsOpen;
    const summaryText = pair ? `Персона и пара: ${pairLabel(snapshot, pair)}` : 'Персона и редактируемая пара';
    tools.append(
      element('summary', { text: summaryText }),
      personaForm,
      pairForm,
    );
    tools.addEventListener('toggle', () => { if (isPhone()) toolsOpen = tools.open; });
    if (isDocked()) {
      // The rail has no room for forms: the same block, folded, above the page.
      tools.className = 'dock-tools';
      tools.open = toolsOpen;
      tools.addEventListener('toggle', () => { toolsOpen = tools.open; });
    }
    return tools;
  }

  function pairToolbar(pair) {
    const personaId = snapshot.personaId || snapshot.ui?.personaId || '';
    const characters = snapshot.characters || [];
    const sourceCharacters = characters.filter(character => characterId(character) !== personaId);
    const currentPair = getPair(snapshot, selectedPairId);
    const sourceSelect = characterSelect('Кто испытывает', currentPair ? pairSource(currentPair) : '', sourceCharacters);
    const targetSelect = characterSelect('К кому', currentPair ? pairTarget(currentPair) : '', characters);
    const apply = () => {
      if (!sourceSelect.select.value || !targetSelect.select.value || sourceSelect.select.value === targetSelect.select.value) return;
      const found = (snapshot.pairs || []).find((candidate) => pairSource(candidate) === sourceSelect.select.value && pairTarget(candidate) === targetSelect.select.value);
      selectedPairId = found ? pairId(found) : `${sourceSelect.select.value}->${targetSelect.select.value}`;
      act('onSelectPair', { pairId: selectedPairId, sourceId: sourceSelect.select.value, targetId: targetSelect.select.value }, 'pair-select');
      render();
    };
    sourceSelect.select.addEventListener('change', apply);
    targetSelect.select.addEventListener('change', apply);
    // Reverse direction: B → A is a separate line, created on demand like any selected pair.
    const swap = button('⇅', 'icon pair-swap', () => {
      const from = sourceSelect.select.value;
      const to = targetSelect.select.value;
      if (!from || !to) return;
      sourceSelect.select.value = to;
      targetSelect.select.value = from;
      apply();
    }, 'Поменять местами: кто испытывает и к кому');
    const targetIsPersona = Boolean(personaId && currentPair && pairTarget(currentPair) === personaId);
    if (!currentPair || targetIsPersona) swap.disabled = true;
    if (targetIsPersona) swap.title = 'Исходящие чувства персоны не отслеживаются';
    return element('div', { className: 'toolbar', style: { display: 'grid', gap: '8px' } }, [sourceSelect.field, swap, targetSelect.field]);
  }

  function characterSelect(label, value, characters) {
    const select = element('select', { id: nextControlId('rs-character'), 'aria-label': label });
    select.append(element('option', { value: '', text: 'Выберите персонажа' }));
    for (const character of characters) select.append(element('option', {
      value: characterId(character), text: characterName(character), selected: characterId(character) === value,
    }));
    return { select, field: element('div', { className: 'field' }, [element('label', { text: label, htmlFor: select.id }), select]) };
  }

  function renderContent(pair) {
    const content = element('main', { className: 'content' });
    const hero = element('div', { className: 'hero' }, [
      // Above a page's own title stands its menu group («Сцена»), not the same word twice.
      element('p', { className: 'section-title', text: PAGE_TITLES[tab] ? (NAV_GROUPS.find(group => group.items.some(([id]) => id === tab))?.title ?? '') : (TABS.find(([id]) => id === tab)?.[1] || tab) }),
      element('h2', { text: PAGE_TITLES[tab] ?? pairLabel(snapshot, pair) }),
      ...(tab === 'overview' ? [element('span', { className: 'muted', text: 'Направление важно: обратная связь редактируется отдельно.' })] : []),
    ]);
    content.append(hero);
    const knowledgePage = { scene: renderNow, characters: renderCharacters, events: renderEvents, secrets: renderSecrets, persona: renderPersonaPage, leaks: renderChecks, chronicle: renderChronicle, places: renderPlaces, items: renderItems, cards: renderCards, wardrobe: renderWardrobe, calendar: renderCalendar, names: renderNames, songs: renderSongs, weather: renderWeather, dice: renderDice, quests: renderQuests }[tab];
    if (knowledgePage) {
      content.append(knowledgePage());
      return content;
    }
    if (PENDING_TABS.has(tab)) {
      content.append(element('div', { className: 'empty pending' }, [
        element('strong', { text: 'Раздел в работе' }),
        element('span', { text: 'Он появится в одном из следующих шагов разработки Кулис.' }),
      ]));
      return content;
    }
    if (isDocked() && RELATION_TABS.has(tab)) content.append(renderTools());
    if (!pair && !['overview', 'journal', 'settings', 'lorebooks', 'memories', 'tensions', 'triangles', 'headcanons'].includes(tab)) {
      content.append(element('div', { className: 'empty', text: 'Для начала выберите двух разных персонажей.' }));
      return content;
    }
    const view = tab === 'overview' ? renderAllRelationships()
      : tab === 'memories' ? renderCollection(pair, 'memories')
        : tab === 'tensions' ? renderCollection(pair, 'tensions')
          : tab === 'journal' ? renderJournal()
            : tab === 'lorebooks' ? renderLorebooks()
              : tab === 'triangles' ? renderTriangles()
                : tab === 'headcanons' ? renderHeadcanons()
            : renderSettings();
    content.append(view);
    return content;
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backdrop.hidden = false;
    document.documentElement.classList.add('kulisy-studio-open');
    render();
    requestAnimationFrame(() => panel.focus());
    saveLayout();
    emit('open', { pairId: selectedPairId });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    closeFactors();
    backdrop.hidden = true;
    document.documentElement.classList.remove('kulisy-studio-open');
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
    saveLayout();
    emit('close', {});
  }

  function onKeyDown(event) {
    if (!isOpen) return;
    // Docked, the chat is in use too: keys typed there (Esc in the message box,
    // Tab between fields) are not the Studio's business.
    const insideStudio = event.composedPath?.().includes(host);
    if (isDocked() && !insideStudio && factorsLayer.hidden) return;
    if (event.key === 'Escape') { if (!factorsLayer.hidden) closeFactors(); else close(); }
    if (event.key === 'Tab' && !isDocked()) {
      const focusable = [...shadow.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && !node.hidden);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && shadow.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && shadow.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }

  // Shared context of the page modules (src/ui/pages): frame functions and
  // objects, plus the frame state they read or change, through getters/setters.
  const ctx = {
    facade, options, shadow, factorsLayer,
    act, emit, render, setStatus, setTab, closeFactors, openFactors, openTriangleSetup, fitFactorsToViewport, characterSelect,
    get snapshot() { return snapshot; },
    get tab() { return tab; },
    get factorsPairId() { return factorsPairId; },
    set factorsPairId(value) { factorsPairId = value; },
    get triangleSetupId() { return triangleSetupId; },
    set triangleSetupId(value) { triangleSetupId = value; },
  };
  for (const create of [createDialogs, createCharactersPage, createOverviewPage, createRecordsPage, createHeadcanonsPage, createTrianglesPage, createSystemPages, createKnowledgePages, createWorldPages, createWardrobePages, createLibraryPages, createCalendarPages, createNamesPages, createSongsPages, createWeatherPages, createDicePages, createQuestsPages]) Object.assign(ctx, create(ctx));
  cleanups.push(() => ctx.destroyWardrobe?.(), () => ctx.destroyLibrary?.());
  const {
    renderFactorsDialog, renderTriangleDialog, renderAllRelationships, renderCollection, renderJournal,
    renderLorebooks, renderTriangles, renderHeadcanons, renderSettings,
    renderCharacters, renderEvents, renderSecrets,
    renderNow, renderPlaces, renderItems, renderCards, renderChronicle, renderChecks, renderWardrobe, renderCalendar, renderNames, renderSongs, renderWeather, renderDice, renderQuests,
  } = ctx;

  document.addEventListener('keydown', onKeyDown);
  cleanups.push(() => document.removeEventListener('keydown', onKeyDown));
  // Re-render when crossing the phone breakpoint (rotation, split screen), so
  // the collapsible persona/pair block is never left closed on a wide layout.
  const phoneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 760px)') : null;
  const onLayoutChange = () => { applyMode(); if (isOpen) render(); fitFactorsToViewport(); };
  window.visualViewport?.addEventListener('resize', fitFactorsToViewport);
  window.visualViewport?.addEventListener('scroll', fitFactorsToViewport);
  cleanups.push(() => {
    window.visualViewport?.removeEventListener('resize', fitFactorsToViewport);
    window.visualViewport?.removeEventListener('scroll', fitFactorsToViewport);
  });
  phoneQuery?.addEventListener?.('change', onLayoutChange);
  cleanups.push(() => phoneQuery?.removeEventListener?.('change', onLayoutChange));
  backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop && !isDocked() && options.closeOnBackdrop !== false) close(); });
  cleanups.push(facade.subscribe((value) => { snapshot = value; if (isOpen) render(); }));
  render();
  if (options.open !== false) open();

  return {
    element: host,
    open,
    close,
    toggle: () => isOpen ? close() : open(),
    /** Open on one page; `entityId` focuses the things page (or the dossier) on a character. */
    show(id, { entityId } = {}) {
      if (id === 'items') ctx.focusItems?.(entityId);
      if (id === 'characters' && entityId) { ctx.openDossier?.(entityId, 'items'); }
      else if (TABS.some(([tabId]) => tabId === id)) { tab = id; saveLayout(); }
      if (isOpen) render(); else open();
    },
    isOpen: () => isOpen,
    /** Open a section of the settings, optionally showing one field (see system.js openSettingsSection). */
    openSettings(section, options) { if (!isOpen) open(); ctx.openSettingsSection?.(section, options); },
    update(value) { snapshot = normalizeSnapshot(value || facade.read()); facade.setLocal(snapshot); if (isOpen) render(); },
    selectPair(value) { selectedPairId = typeof value === 'string' ? value : pairId(value); if (isOpen) render(); },
    destroy() { close(); cleanups.splice(0).forEach((cleanup) => cleanup()); host.remove(); emit('destroy', {}); },
  };
}

export default createRelationshipStudio;
