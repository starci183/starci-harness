// The one classifier of an exported type surface: the ESLint result cache (surfaceOf: `open`) and the explicit-export-surface rule of both lint canons
// (explicitSurfaceRule) read src/fixtures/explicit-surface-cases.json and must agree on every case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import ts from 'typescript';
import { surfaceOf, type GraphHost } from '../cache/import-graph.mjs';
import { declarationSurface } from '../runtime/scripts/lib/declaration-surface.mjs';
import { explicitSurfaceRule, type SurfaceContext } from '../runtime/scripts/hfs/explicit-surface-rule.mjs';

interface Case { name: string; code: string; open: boolean; annotate: string[] }
const { cases } = JSON.parse(readFileSync(new URL('./fixtures/explicit-surface-cases.json', import.meta.url), 'utf8')) as { cases: Case[] };

const host = (compiler: typeof ts = ts): GraphHost => ({ ts: compiler, sideRoot: os.tmpdir(), readText: () => null, fileExists: () => false, hashOf: () => null });

interface Reported { line: number; column: number; endLine: number; endColumn: number; message: string }

/** The rule run over `code` the way ESLint runs it: one visit of the Program, a report per problem. */
function reportsOf(code: string, filename: string, compiler: typeof ts = ts): Reported[] {
  const starts = [0];
  for (let at = 0; at < code.length; at += 1) if (code[at] === '\n') starts.push(at + 1);
  const locate = (index: number): { line: number; column: number } => {
    let line = starts.length - 1;
    while ((starts[line] as number) > index) line -= 1;
    return { line: line + 1, column: index - (starts[line] as number) };
  };
  const reported: Reported[] = [];
  const context: SurfaceContext = {
    filename, sourceCode: { text: code, getLocFromIndex: locate },
    report: ({ loc, data }) => {
      const message = `HFS_EXPLICIT_EXPORT_SURFACE: \`${data['name']}\` ${data['reason']} annotate ${data['annotate']}`;
      reported.push({ line: loc.start.line, column: loc.start.column, endLine: loc.end.line, endColumn: loc.end.column, message });
    },
  };
  explicitSurfaceRule({ ts: compiler }).create(context).Program();
  return reported;
}

for (const fixture of cases) {
  test(`the cache and the rule agree: ${fixture.name}`, () => {
    const surface = surfaceOf(host(), {}, 'src/a.tsx', fixture.code);
    assert.equal(surface.open, fixture.open, 'surfaceOf open');
    const classified = declarationSurface(ts, 'src/a.tsx', fixture.code);
    assert.deepEqual(classified?.problems.map((problem) => problem.annotate), fixture.annotate, 'the classifier');
    const reported = reportsOf(fixture.code, 'src/a.tsx');
    assert.equal(reported.length, fixture.annotate.length, 'one report per problem');
    assert.equal(reported.length > 0, surface.open, 'the rule reports exactly the files the cache counts as open');
    for (const [at, problem] of (classified?.problems ?? []).entries()) {
      const place = reported[at] as Reported;
      const lines = fixture.code.slice(0, problem.start).split('\n');
      assert.deepEqual([place.line, place.column], [lines.length, (lines.at(-1) as string).length], 'the report sits on the offending span');
    }
  });
}

test('a report names the export, TypeScript\'s reason and what to annotate', () => {
  const [hook] = reportsOf('export const useAvatar = () => useUpload()\n', 'src/hook.ts');
  assert.match((hook as Reported).message, /`useAvatar`/);
  assert.match((hook as Reported).message, /Function must have an explicit return type annotation/);
  assert.match((hook as Reported).message, /return type/);
  const [parameter] = reportsOf('export function twice(value): number { return 1 }\n', 'src/twice.ts');
  assert.match((parameter as Reported).message, /`value`|`twice`/);
  assert.match((parameter as Reported).message, /parameter type/);
});

test('a declaration file and a script are not TypeScript sources the emit reads', () => {
  const inferred = 'export const a = make()\n';
  assert.deepEqual(reportsOf(inferred, 'src/a.d.ts'), []);
  assert.deepEqual(reportsOf(inferred, 'src/a.js'), []);
  assert.deepEqual(reportsOf(inferred, 'src/a.mjs'), []);
  assert.equal(reportsOf(inferred, 'src/a.mts').length, 1);
  assert.equal(reportsOf(inferred, 'src/a.cts').length, 1);
});

test('a compiler without transpileDeclaration cannot read a file: the cache counts it open and the rule says so once', () => {
  const old = { ...ts, transpileDeclaration: undefined } as unknown as typeof ts;
  assert.deepEqual(surfaceOf(host(old), {}, 'src/a.ts', 'export const a: number = 1\n'), { api: undefined, open: true, refs: undefined });
  const reported = reportsOf('export const a: number = 1\n', 'src/a.ts', old);
  assert.equal(reported.length, 1);
  assert.deepEqual([reported[0]?.line, reported[0]?.column], [1, 0]);
});
