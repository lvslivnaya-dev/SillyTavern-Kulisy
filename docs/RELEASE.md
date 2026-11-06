# Release checklist

1. Make sure the version in `manifest.json` and `package.json` match and the CHANGELOG section of that version has a date instead of "не выпущено".
2. Run `npm ci` and `npm run check`. Every test must pass.
3. Complete `docs/MANUAL-TESTS.md` on the current SillyTavern release, on a PC.
4. Create the public GitHub repository `SillyTavern-Kulisy` (once) and push `main`; `homePage` in `manifest.json` already points to it.
5. Tag the release commit `vX.Y.Z` and push the tag.
6. Run `npm run pack:zip`, check that `manifest.json` sits at the archive root, attach `dist/SillyTavern-Kulisy.zip` to the GitHub release.
7. Install the repository URL through SillyTavern's extension manager in a clean profile and check that it loads.

Do not commit chat metadata, API keys, local SillyTavern settings or exported chat states.
