/**
 * Kulisy design tokens.
 *
 * Every colour, font and shadow is derived from SillyTavern's own theme
 * variables (--SmartTheme*, --mainFontFamily, …) — there is no colour of our
 * own anywhere in the UI. Custom properties inherit through shadow roots even
 * under `:host{all:initial}`, so a theme change in SillyTavern repaints the
 * Studio and the widget at once, without a reload.
 *
 * Rules for UI code:
 * - use only var(--k-*) for colours; tests/theme.test.js fails on any hex/rgb literal;
 * - never put text on a solid accent fill: themes pick accents freely, so
 *   contrast is only guaranteed for text over --k-bg/--k-panel/--k-inset.
 *   Highlight with accent borders, accent text and --k-accent-soft instead.
 */
export const THEME_TOKENS = [
  '--k-text:var(--SmartThemeBodyColor)',
  '--k-muted:color-mix(in srgb,var(--SmartThemeBodyColor) 64%,transparent)',
  '--k-faint:color-mix(in srgb,var(--SmartThemeBodyColor) 40%,transparent)',
  // Surfaces: the theme's panel tint, lifted slightly towards the text colour.
  '--k-bg:color-mix(in srgb,var(--SmartThemeBlurTintColor) 94%,var(--SmartThemeBodyColor) 6%)',
  '--k-panel:color-mix(in srgb,var(--SmartThemeBlurTintColor) 88%,var(--SmartThemeBodyColor) 12%)',
  '--k-inset:color-mix(in srgb,var(--SmartThemeChatTintColor) 55%,var(--SmartThemeBlurTintColor))',
  '--k-line:color-mix(in srgb,var(--SmartThemeBodyColor) 18%,transparent)',
  '--k-track:color-mix(in srgb,var(--SmartThemeBodyColor) 22%,transparent)',
  '--k-accent:var(--SmartThemeQuoteColor)',
  '--k-accent-soft:color-mix(in srgb,var(--SmartThemeQuoteColor) 16%,transparent)',
  '--k-accent-line:color-mix(in srgb,var(--SmartThemeQuoteColor) 55%,transparent)',
  // Status colours lean on ST's own palette, pulled towards the text colour so
  // they stay readable on light and dark themes alike.
  '--k-ok:var(--SmartThemeUnderlineColor)',
  '--k-ok-soft:color-mix(in srgb,var(--SmartThemeUnderlineColor) 16%,transparent)',
  '--k-warn:color-mix(in srgb,var(--golden) 60%,var(--SmartThemeBodyColor))',
  '--k-warn-soft:color-mix(in srgb,var(--golden) 14%,transparent)',
  '--k-danger:color-mix(in srgb,var(--warning) 70%,var(--SmartThemeBodyColor))',
  '--k-danger-soft:color-mix(in srgb,var(--warning) 14%,transparent)',
  '--k-shadow:var(--SmartThemeShadowColor)',
  '--k-backdrop:color-mix(in srgb,var(--SmartThemeShadowColor) 80%,transparent)',
  '--k-blur:var(--SmartThemeBlurStrength)',
  '--k-font:var(--mainFontFamily)',
  '--k-mono:var(--monoFontFamily)',
].join(';');

/**
 * `:host{…}` block for a shadow root: tokens plus the theme font and text colour.
 * `all:initial` is an author rule, so it beats the browser's `[hidden]{display:none}`:
 * the host would stay visible when hidden (the widget switched off still showed).
 */
export function hostThemeCss(extra = '') {
  return `:host{all:initial;${THEME_TOKENS};font-family:var(--k-font);color:var(--k-text)${extra ? `;${extra}` : ''}}:host([hidden]){display:none!important}`;
}
