import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_TOKENS, hostThemeCss } from '../src/ui/theme.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(js|css)$/.test(name)) out.push(path);
  }
  return out;
}

// Everything that draws UI: shadow-root styles, inline styles, the global stylesheet.
const UI_FILES = [
  ...files(join(ROOT, 'src', 'ui')),
  join(ROOT, 'src', 'integration', 'shell.js'),
  join(ROOT, 'src', 'integration', 'message-buttons.js'),
  join(ROOT, 'index.js'),
  join(ROOT, 'style.css'),
];

const COLOR_LITERALS = [
  // #rgb … #rrggbbaa used as a value (after ':', ',', '(' or a space), not '#chat' selectors or '#12' text.
  { name: 'hex', pattern: /[:,(\s]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![0-9a-zA-Z_-])/g },
  { name: 'rgb/hsl', pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g },
  { name: 'named colour', pattern: /(?:color|background|border(?:-[a-z]+)?|fill|stroke|outline|box-shadow)\s*:\s*[^;"'`}]*\b(?:white|black|red|green|blue|gray|grey|yellow|orange|pink|purple)\b/gi },
];

test('no UI file contains a colour of its own — all colours come from the SillyTavern theme', () => {
  const found = [];
  for (const file of UI_FILES) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      for (const { name, pattern } of COLOR_LITERALS) {
        for (const match of line.matchAll(pattern)) found.push(`${relative(ROOT, file)}:${index + 1} ${name}: ${match[0].trim()}`);
      }
    });
  }
  assert.deepEqual(found, [], `colour literals found:\n${found.join('\n')}`);
});

test('every token is built from SillyTavern variables only', () => {
  const allowed = /^--(?:SmartTheme[A-Za-z]+|mainFontFamily|monoFontFamily|golden|warning)$/;
  for (const declaration of THEME_TOKENS.split(';')) {
    const [name, value] = declaration.split(/:(.*)/s);
    assert.match(name, /^--k-[a-z-]+$/, `token name ${name}`);
    for (const [, variable] of value.matchAll(/var\((--[A-Za-z-]+)\)/g)) {
      assert.match(variable, allowed, `${name} uses ${variable}`);
    }
  }
});

test('host block sets tokens, the theme font and the theme text colour', () => {
  const css = hostThemeCss('--x:var(--k-bg)');
  assert.match(css, /^:host\{all:initial;/);
  assert.match(css, /font-family:var\(--k-font\)/);
  assert.match(css, /color:var\(--k-text\)/);
  assert.match(css, /--x:var\(--k-bg\)\}:host\(\[hidden\]\)/);
});
