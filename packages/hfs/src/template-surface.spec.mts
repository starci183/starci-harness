// Every TypeScript template the harness ships is held to the two source laws the canons enforce on an app, so no template can carry a finding again:
// R368 (an exported declaration states its type, judged by the one classifier the lint cache and the explicit-export-surface rule read) and R369
// (a "use client" or "use server" directive is the first statement of its module). A `.tpl` is rendered the way the scaffolders fill it: a
// placeholder that stands for a name becomes an identifier, a placeholder that stands for a whole line is dropped. The front-end units
// (`fe/units/**`) are filled by structure (shapes, tabs, forms), so they are rendered by their generators and linted with the canons in
// fe-unit-shape-slot.spec.mts, which this spec requires to exist and to name every unit directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { declarationSurface } from '../runtime/scripts/lib/declaration-surface.mjs';
import { TEMPLATES_DIR } from '../sync/index.mjs';

const SOURCE = /\.(?:tsx?|mts|cts)(?:\.tpl)?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
const UNITS = 'fe/units/';

const walk = (folder: string): string[] =>
  fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? walk(file) : SOURCE.test(entry.name) && !DECLARATION.test(entry.name) ? [file] : [];
  });

/** The text a scaffolder writes, with each placeholder standing for a name made an identifier and each line-wide placeholder dropped. */
const rendered = (text: string): string =>
  text
    .replace(/^[ \t]*\{\{[^{}\n]*\}\}[ \t]*\r?\n/gm, '')
    .replace(/\{\{[#/^>!][^}]*\}\}/g, '')
    .replace(/\{\{[A-Za-z0-9_.]+\}\}/g, 'Sample')
    .replace(/@@[A-Za-z0-9]+@@/g, 'Sample');

const templates = walk(TEMPLATES_DIR).map((file) => ({ file, relative: path.relative(TEMPLATES_DIR, file).split(path.sep).join('/') }));

/** The directive strings of a module that sit below another statement. */
function misplacedDirectives(source: ts.SourceFile): string[] {
  const found: string[] = [];
  let prologue = true;
  for (const statement of source.statements) {
    const directive = ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) ? statement.expression.text : null;
    if (directive === null) prologue = false;
    else if (!prologue && (directive === 'use client' || directive === 'use server')) found.push(directive);
  }
  return found;
}

test('the templates are found', () => {
  assert.ok(templates.length > 300, `${templates.length} TypeScript templates`);
});

/** A tool config at the root of an app (`next.config.ts`) is outside the lint scope of the canons, which judge `src/`. */
const isRootConfig = (relative: string): boolean => /\.config\.ts$/.test(relative) && !relative.includes('/src/');

test('R368: no template exports a type the declaration emit cannot write', () => {
  const findings: string[] = [];
  for (const { file, relative } of templates) {
    if (relative.startsWith(UNITS) || isRootConfig(relative)) continue;
    const text = rendered(fs.readFileSync(file, 'utf8'));
    const kind = /x(?:\.tpl)?$/.test(relative) ? 'template.tsx' : 'template.ts';
    const surface = declarationSurface(ts, kind, text);
    assert.ok(surface, 'the compiler has transpileDeclaration');
    const syntax = ts.transpileDeclaration(text, { fileName: kind, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } }).diagnostics?.some((diagnostic) => diagnostic.code < 9000);
    assert.notEqual(syntax, true, `${relative} renders to source TypeScript can read`);
    for (const problem of surface.problems) findings.push(`${relative}:${text.slice(0, problem.start).split('\n').length} ${problem.name} (${problem.annotate}: ${problem.reason})`);
  }
  assert.deepEqual(findings, []);
});

test('R368: the front-end units are judged by their generators in fe-unit-shape-slot.spec.mts', () => {
  const generated = fs.readFileSync(new URL('./fe-unit-shape-slot.spec.mts', import.meta.url), 'utf8');
  const kinds = new Set(templates.filter(({ relative }) => relative.startsWith(UNITS)).map(({ relative }) => relative.slice(UNITS.length).split('/')[0]));
  assert.ok(kinds.size > 0);
  for (const kind of kinds) assert.match(generated, new RegExp(`\\b${kind === 'frame' ? 'frame' : kind}\\b`), `${kind} units are added and linted there`);
});

test('R369: no template places a module directive below another statement', () => {
  const misplaced: string[] = [];
  for (const { file, relative } of templates) {
    const text = rendered(fs.readFileSync(file, 'utf8'));
    if (!/use (?:client|server)/.test(text)) continue;
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, /x(?:\.tpl)?$/.test(relative) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const directive of misplacedDirectives(source)) misplaced.push(`${relative}: "${directive}"`);
  }
  assert.deepEqual(misplaced, []);
});
