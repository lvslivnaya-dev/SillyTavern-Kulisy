# Architecture

## Layers

### `src/core`

Pure, SillyTavern-independent relationship state and transactions. This layer owns schema validation, directed pairs, metrics, journal entries, snapshots, rollback, and compact prompt selection.

### `src/integration`

The adapter for SillyTavern 1.19.0. It owns global settings, per-chat metadata, generation prompt injection, event payloads, optional analysis requests, and extension conflict detection.

### `src/ui`

DOM components that receive state and callbacks. The Studio and widget never call SillyTavern APIs directly.

- `theme.js` — the `--k-*` design tokens, built only from SillyTavern theme variables. UI code uses no colour of its own (`tests/theme.test.js`).
- `layout.js` — menu groups (Сцена / Отношения / Система), window vs docked mode, dock width rules. Pure data, no DOM.
- `icons.js` — line icons drawn with `currentColor`.
- `studio.js` — the frame only: header, menu, docked rail and width handle, open/close, keys, the factors layer.
- `pages/*.js` — one module per page group. Each exports `create…(ctx)`; `ctx` carries the frame's functions and objects, and the frame state (`ctx.snapshot`, `ctx.tab`, …) through getters. A page keeps its own UI state (folds, editors, filters) in its module.

`tests/studio-smoke.test.js` renders every tab in both modes in jsdom and fails on any error.

### `index.js`

Composition root and lifecycle controller. It wires SillyTavern events to the store, refreshes UI, and guarantees cleanup/idempotent activation.

## Character cards

The library (`settings.locationLibrary`) has a third shelf, `characters`: cards of `{ id, folderId, name, aliases, sections[], image? }` (`core/character-cards.js`, stored by `core/location-library.js`). A section is `{ id, kind, title, text, when?, keys? }`; `kind` is one of the gate's sections, so a card follows the same rules as a lorebook sheet.

A card meets a chat through `state.ui.cards = { cardId: entityId }` (`integration/card-links.js`, not journaled; the entity it creates or renames goes through the journal as an `entity.upsert`). The persona never gets one.

Songs (`core/song-library.js`, page `ui/pages/songs.js`, prompt key `kulisy-songs`) live in `settings.songLibrary`, shared by all chats, like the name library. `planSongs` decides what goes out: the songs pinned in the chat (`state.ui.songs = { playing: [{ songId, mode: 'sound' | 'sung', singerId }], muted: [songId] }`, not journaled, edited from the drawer) and the songs that `findSongs` notices in the last `lookback` posts (`recentText`): `minWords` words of the lyrics in a row (normalized by `songWords`: case, punctuation, «ё», stretched letters), a title (one word only in quotes or between ♪) or a key. Noticing is stateless, so swipes and deletions need no rollback; the last quoted lyric line (`lyricsHit`) goes into the block so the singing can continue from the next line.

A card holds one text per section and says which language it is in (`lang: 'en'` once translated). Cards loaded from Obsidian notes carry `source = { path, hash, stale? }`: the hash covers the name and the Russian sections only (`character-import.js`), so `checkCardSources` marks a card stale only when the Russian original changed; `refreshLibraryCharacter` loads it again (Russian) keeping section ids and own rules. The folder handle for re-reading notes lives in IndexedDB (`ui/notes-folder.js`, File System Access API); translation is `integration/card-translate.js`, one model request per section (aux purpose `translation`).

`integration/card-prompt.js` decides which sections go out (`planCards`, built on `decideSection` shared with `planGate`) and writes the `kulisy-cards` block; `planSheetDrops` takes the same character's «[ Name ] - Section» entries out of the lorebook lists so nothing is sent twice. `digestFor` gives the cards to the models that analyse or generate (never the NSFW section).

## Persistence

The authoritative state lives in the active chat's metadata under a versioned namespace. Global extension settings contain preferences only. A long-lived reference to `chatMetadata` is never retained because SillyTavern replaces that object when switching chats.

## Narrator identity

The active SillyTavern card is a controller and is never automatically added as a relationship participant. Participants are extension registry records with stable IDs and aliases. A lorebook source identifier can be attached when available, but manually created characters work without one.

## Reversibility

Every analyzed assistant message produces a transaction with:

- message index and text fingerprint;
- swipe identity when available;
- operations and reasons;
- state snapshot or inverse information;
- transaction identifier and schema version.

Reprocessing first removes the previous transaction for the message and then applies the selected result. Deleting messages removes transactions at or beyond the new chat length.

## Prompt strategy

The engine uses a unique `setExtensionPrompt` key at system-role `IN_CHAT`, depth 1. Only focused or scene-active pairs are included. The prompt describes behavioral continuity and explicitly prevents the Narrator controller from becoming a participant.

Full history, UI settings, and inactive pairs are never injected.

## Analysis strategy

Automatic analysis is opt-in. The analyzer returns strict JSON operations. Code validates character IDs, metric names, bounds, and duplicate transaction IDs before changing state. Large changes can require confirmation.

Failures leave relationship state unchanged.

## Knowledge (Kulisy)

`src/core/knowledge.js` owns `state.knowledge`: events with witnesses, who learned what later (told / rumor, from whom), acquaintances per pair (`known` / `seen` / `strangers`, absent = default) and the current scene (who is present, where). It is journaled like relationships: every change is an operation (`event.*`, `learned.*`, `knowledge.toggle`, `acquaintance.set`, `scene.set`), so a swipe or a deleted reply rolls it back through the same replay.

- Replay never fails on history: an operation pointing at an event or character that a rollback removed is a no-op; unknown character IDs are dropped from lists.
- `replayBase` (operations.js) is the single place that materialises the baseline for any rebuild; `OPERATION_TYPES` (schema.js) is the single list of operation types.
- Acquaintance default: an explicit value wins; then the engine's old `ui.strangerPairs`; then nobody knows the user's persona; otherwise nothing is assumed (canon decides).
- States from Relationship Engine have no knowledge; `importState` adds an empty one.

### The chronicler

`src/integration/knowledge-analysis.js` adds knowledge to reply analysis, in the same request as relationships (or in its own when `knowledgeSeparateRequest` is on). The analyzer is shown the scene before the reply, the events some character of the reply does not know (`selectKnowledgeCandidates`: by meaning with embeddings when there are more than fit, else secrets first, then newest) and the pairs not introduced yet. It returns `knowledge: { scene, events, learned, met, leaks }`.

The model only proposes: `materializeKnowledge` resolves names, drops "learned" for anyone who already knows, moves introductions only forward (strangers → seen → known; pairs without a record are left to canon), and keeps a leak only if the character still cannot know after this reply's own learning. Everything but leaks becomes journal operations with the reply's metadata; leaks go to the message marker (`extra.kulisyV1.leaks`).

A reply is analysed against the state without its own earlier result, so a re-check does not skip records as "already known" and then roll them back.

### The knowledge prompt

`src/core/knowledge-prompt.js` builds the "who knows what" block, injected under its own key (`kulisy-knowledge`) next to the relationship block, so it can be switched off and budgeted separately (`sendKnowledge`, `knowledgePromptCharacters`). Only the coming scene's cast gets lines: who is present plus anyone the last two messages mention. Lines, in order of importance: `scene:`, `strangers[A & B]` (the persona's pairs first), `unknown[A]` (secrets first, then newest), `seen[A & B]`, `heard[A]` (told by / rumour). Under a tight budget long lists lose their last items first; rumours go before meetings and secrets. The persona gets no `unknown` line: what the user's character knows is the user's to play. The strangers rule moved here from the relationship block.

### Knowledge UI

- `src/ui/pages/knowledge.js` — the Сцена pages: «Сейчас в сцене» (place, presence switches, what the model gets), «Персонажи» (cards; a dossier with what they know and how, what they do not know, acquaintances per character; the lorebook acquaintance scan), «Лента событий» (add, edit witnesses and secret, switch off, remove), «Утечки» (open leaks with swipe / he knows / dismiss). Every control calls a handler in index.js that journals a manual operation.
- `src/integration/chat-overlay.js` — in ST's own DOM: who-is-on-stage chips above the message box and leak notes under replies. textContent only; styled in style.css with ST variables.
- `src/integration/acquaintance-scan.js` — which characters already know each other by the lore; proposals are confirmed, hand-set pairs untouched.
