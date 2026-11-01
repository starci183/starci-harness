import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CORE_TOKENS, OFFSET_POP_TOKENS, migrateThemeTokens, themeTokensMarkdown, transformThemeTokens } from '../codemod/theme-tokens.mjs';
import { codemodMain } from '../codemod/main.mjs';

const brand = (text: string) => transformThemeTokens({ text, file: 'fe/apps/web/src/modules/brand/brand.css' });

test('a Core brand layer moves from the private names and the family root onto HeroUI tokens on :root and .dark', () => {
  const input = [
    '[data-grammar-family="core"] {',
    '    --starci-core-canvas: #faf9f5;',
    '    --starci-core-accent: #141413;',
    '    --starci-core-accent-text: #141413;',
    '    --accent: var(--starci-core-accent);',
    '}',
    '[data-grammar-family="core"][data-grammar-theme="dark"] {',
    '    --starci-core-canvas: #1f1e1d;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '    [data-grammar-family="core"][data-grammar-theme="system"] {',
    '        --starci-core-canvas: #1f1e1d;',
    '    }',
    '}',
  ].join('\n');
  const result = brand(input);
  assert.deepEqual(result.findings, []);
  assert.equal(result.text, [
    ':root {',
    '    --background: #faf9f5;',
    '    --accent: #141413;',
    '    --accent-soft-foreground: #141413;',
    '    --accent: var(--accent);',
    '}',
    '.dark {',
    '    --background: #1f1e1d;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '    :root {',
    '        --background: #1f1e1d;',
    '    }',
    '}',
  ].join('\n'));
  assert.equal(brand(result.text).changes.length, 0, 'a second run changes nothing');
});

test('an Offset Pop palette becomes the status and ink tokens it was drawn from', () => {
  assert.deepEqual([OFFSET_POP_TOKENS['ink'], OFFSET_POP_TOKENS['pink'], OFFSET_POP_TOKENS['yellow'], OFFSET_POP_TOKENS['mint'], OFFSET_POP_TOKENS['critical']], ['foreground', 'accent', 'warning', 'success', 'danger']);
  const result = brand('.grammar-common-root[data-grammar-family="offset-pop"] {\n    --offset-pop-pink: #ff3593;\n    --offset-pop-shadow-ink: #1c1524;\n}');
  assert.match(result.text, /^:root \{\n    --accent: #ff3593;\n    --offset-pop-shadow-ink: #1c1524;/);
  assert.deepEqual(result.findings.map((finding) => finding.text), []);
});

test('what HeroUI has no token for, and a scope inside the page, stay in the report', () => {
  const result = brand('[data-grammar-family="core"] [data-grammar-family="core"] {\n    --starci-core-pill-radius: 9px;\n    --starci-core-canvas: #f0eee6;\n}');
  assert.deepEqual(result.findings.map((finding) => finding.code), ['THEME_SELECTOR', 'THEME_PRIVATE_TOKEN']);
  assert.match(result.text, /--background: #f0eee6/);
});

test('GrammarRoot theme is reported, never rewritten', () => {
  const tsx = '<CoreGrammarRoot theme="system" className="app-root">';
  const result = transformThemeTokens({ text: tsx, file: 'fe/apps/web/src/app/providers.tsx' });
  assert.equal(result.text, tsx);
  assert.deepEqual(result.findings.map((finding) => finding.code), ['THEME_ROOT_PROP']);
});

test('the mapping names only tokens HeroUI or the grammar publishes', () => {
  for (const to of new Set([...Object.values(CORE_TOKENS), ...Object.values(OFFSET_POP_TOKENS)])) assert.match(to, /^[a-z][a-z-]*$/);
  assert.equal(CORE_TOKENS['accent-text'], 'accent-soft-foreground');
});

test('the codemod runs through starci app codemod: a dry run reports, --execute writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-tokens-'));
  try {
    const file = path.join(root, 'fe/apps/web/src/modules/brand/brand.css');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[data-grammar-family="core"] {\n    --starci-core-accent: #141413;\n}\n');
    const printed: string[] = [];
    assert.equal(codemodMain(['theme-tokens'], { cwd: root, stdout: (text) => printed.push(String(text)) }), 0);
    assert.match(printed.join(''), /1 would change/);
    assert.match(fs.readFileSync(file, 'utf8'), /--starci-core-accent/);
    assert.equal(codemodMain(['theme-tokens', '--execute'], { cwd: root, stdout() {} }), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), ':root {\n    --accent: #141413;\n}\n');
    const report = migrateThemeTokens({ root });
    assert.match(themeTokensMarkdown(report), /0 rewrites, 0 left for a person/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
