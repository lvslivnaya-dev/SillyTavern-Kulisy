# Contributing

Kulisy is made of dependency-free browser ES modules; jsdom is used only by the tests.

1. Fork and clone the repository.
2. Use Node.js 20 or newer, run `npm ci`.
3. Run `npm test` before submitting a change.
4. Keep SillyTavern-specific APIs inside `src/integration` and `index.js`.
5. Keep state changes in `src/core` pure and covered by tests. Anything derived from a reply must be a journal operation with the reply's metadata, so swipe, edit and delete roll it back.
6. Use colours only through the `--k-*` tokens (`src/ui/theme.js`) or SillyTavern theme variables; `tests/theme.test.js` rejects colour literals.
7. Do not store API keys or chat histories in global settings.

Bug reports should include the SillyTavern version, the browser, the relevant console lines (`[Kulisy]`), the diagnostics log (Настройки → Диагностика) and which other extensions that track relationships, memory or secrets were enabled.
