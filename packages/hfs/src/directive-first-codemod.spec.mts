// `starci app codemod directive-first`: a "use client" / "use server" directive below another statement becomes the first statement of its module (R369, FE_DIRECTIVE_FIRST).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { directiveFirstMarkdown, migrateDirectiveFirst, transformDirectiveFirst } from '../codemod/directive-first.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const run = (text: string, file = 'fe/apps/web/a.tsx') => transformDirectiveFirst({ ts, text, file });

test('1. a directive below the imports moves above them, with one blank line after it', () => {
  const result = run('import { A } from "a"\nimport { B } from "b"\n"use client"\n\nexport const C = () => <A b={B} />\n');
  assert.equal(result.text, '"use client"\n\nimport { A } from "a"\nimport { B } from "b"\n\nexport const C = () => <A b={B} />\n');
  assert.deepEqual(result.changes.map(change => [change.code, change.line, change.from]), [['DIRECTIVE_BELOW_STATEMENT', 3, 'after 2 statements']]);
  assert.deepEqual(result.findings, []);
});

test('2. the form Prettier writes, ("use client") after the imports, is moved and the stray semicolon goes with it', () => {
  const result = run('import { A } from "a"\n;("use client")\n\nexport const C = () => <A />\n');
  assert.equal(result.text, '"use client"\n\nimport { A } from "a"\n\nexport const C = () => <A />\n');
  assert.deepEqual(result.changes.map(change => change.code), ['DIRECTIVE_PARENTHESIZED']);
  const semicolons = run('import { A } from "a";\n("use client");\nexport const C = 1;\n');
  assert.equal(semicolons.text, '"use client";\n\nimport { A } from "a";\nexport const C = 1;\n');
});

test('3. a directive that is already first, and a module without one, are left as they are', () => {
  for (const text of ['"use client"\n\nimport { A } from "a"\nexport const C = A\n', '\'use server\'\nimport { A } from "a"\n', 'import { A } from "a"\nexport const C = "use strict"\n', '// header\n"use client"\nexport const C = 1\n']) {
    const result = run(text);
    assert.equal(result.text, text);
    assert.deepEqual([result.changes, result.findings], [[], []]);
  }
});

test('4. "use server" moves too, keeps its quotes, and a comment above the first statement stays above the directive', () => {
  const result = run('// actions\nimport { db } from "./db"\n\nexport async function save() {}\n\'use server\'\n', 'be/actions.ts');
  assert.equal(result.text, '// actions\n\'use server\'\n\nimport { db } from "./db"\n\nexport async function save() {}\n');
  assert.deepEqual(result.changes.map(change => change.code), ['DIRECTIVE_BELOW_STATEMENT']);
});

test('5. a directive repeated below a first one is only removed, and both kinds in one module are left for a person', () => {
  const repeated = run('"use client"\nimport { A } from "a"\n"use client"\nexport const C = A\n');
  assert.equal(repeated.text, '"use client"\nimport { A } from "a"\nexport const C = A\n');
  const both = run('"use client"\nimport { A } from "a"\n"use server"\nexport const C = A\n');
  assert.equal(both.text, '"use client"\nimport { A } from "a"\n"use server"\nexport const C = A\n');
  assert.deepEqual(both.findings.map(finding => finding.code), ['CONFLICTING_DIRECTIVES']);
});

test('6. the app is migrated file by file: a dry run writes nothing, --execute writes, the second run changes nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directive-first-'));
  try {
    const file = path.join(root, 'fe/apps/web/a.tsx');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const source = 'import { A } from "a"\n("use client")\nexport const C = A\n';
    fs.writeFileSync(file, source);
    fs.writeFileSync(path.join(root, 'fe/apps/web/b.ts'), 'export const B = 1\n');
    fs.mkdirSync(path.join(root, 'fe/node_modules/x'), { recursive: true });
    fs.writeFileSync(path.join(root, 'fe/node_modules/x/c.js'), 'import "a"\n"use client"\n');
    const dry = migrateDirectiveFirst({ root, ts });
    assert.deepEqual([dry.schema, dry.filesScanned, dry.filesChanged, dry.write], ['starci/directive-first-report@1', 2, ['fe/apps/web/a.tsx'], false]);
    assert.equal(fs.readFileSync(file, 'utf8'), source);
    const out: string[] = [];
    assert.equal(codemodMain(['directive-first', '--execute'], { cwd: root, stdout: text => out.push(text) }), 0);
    assert.match(out.join(''), /1 directives moved/);
    assert.equal(fs.readFileSync(file, 'utf8'), '"use client"\n\nimport { A } from "a"\nexport const C = A\n');
    assert.deepEqual(migrateDirectiveFirst({ root, ts }).changes, []);
    assert.match(directiveFirstMarkdown(dry), /# directive-first/);
    assert.ok(CODEMODS.includes('directive-first'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
