// `starci app codemod explicit-surface`: the types the app's checker infers are written on the exports the classifier counts as open (R368), where they are short, named and sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explicitSurfaceMarkdown, migrateExplicitSurface } from '../codemod/explicit-surface.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const TSCONFIG = JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2022', jsx: 'react-jsx', noEmit: true, baseUrl: '.', paths: { '@/*': ['src/*'] } }, include: ['src'] });
const REACT = `export = React;
declare namespace React {
  interface ReactElement<P = unknown, T = unknown> { type: T; props: P; key: string | null }
  type ReactNode = ReactElement | string | null | undefined;
  namespace JSX { interface Element extends ReactElement<any, any> {} interface IntrinsicElements { [name: string]: any } }
}
`;
const RUNTIME = `import * as React from "react";
export namespace JSX { interface Element extends React.JSX.Element {} interface IntrinsicElements { [name: string]: any } }
export function jsx(type: unknown, props: unknown, key?: string): JSX.Element;
export function jsxs(type: unknown, props: unknown, key?: string): JSX.Element;
`;

/** A scratch app with a `src/` side, a tsconfig and a stand-in `react` package; `files` are written under it. */
function scratch(t: test.TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explicit-surface-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const all: Record<string, string> = {
    'tsconfig.json': TSCONFIG, 'node_modules/react/package.json': '{"name":"react","version":"19.0.0","types":"index.d.ts"}', 'node_modules/react/index.d.ts': REACT,
    'node_modules/react/jsx-runtime.d.ts': RUNTIME, ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
const read = (root: string, name: string): string => fs.readFileSync(path.join(root, name), 'utf8');
const TYPES = `export type Resp = { id: string; name: string }
export interface Box<T> { value: T }
export function makeBox<T>(value: T): Box<T> { return { value } }
export function load(): Promise<Resp> { return null as never }
type Hidden = { h: 1 }
export const hidden = (): Hidden => ({ h: 1 })
`;

test('1. a function declaration gets the return type the checker infers', async t => {
  const root = scratch(t, { 'src/a.ts': 'export function twice(x: number) { return [x, x] }\n' });
  const report = await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/a.ts'), 'export function twice(x: number): number[] { return [x, x] }\n');
  assert.deepEqual(report.changes.map(change => [change.code, change.name, change.to]), [['RETURN_TYPE', 'twice', 'number[]']]);
  assert.deepEqual(report.findings, []);
});

test('2. an async function gets its Promise', async t => {
  const root = scratch(t, { 'src/a.ts': 'export async function size(text: string) { return text.length }\n' });
  await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/a.ts'), 'export async function size(text: string): Promise<number> { return text.length }\n');
});

test('3. an arrow const gets its return type', async t => {
  const root = scratch(t, { 'src/a.ts': 'export const double = (x: number) => x * 2\nexport const pair = (x: number) => [x, x]\n' });
  await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/a.ts'), 'export const double = (x: number): number => x * 2\nexport const pair = (x: number): number[] => [x, x]\n');
});

test('4. an exported const from a call gets its variable type', async t => {
  const root = scratch(t, { 'src/types.ts': TYPES, 'src/a.ts': 'import { makeBox } from "./types"\nexport const box = makeBox(1)\n' });
  const report = await migrateExplicitSurface({ root, write: true });
  assert.match(read(root, 'src/a.ts'), /export const box: Box<number> = makeBox\(1\)/);
  assert.deepEqual(report.changes.map(change => change.code), ['VARIABLE_TYPE']);
});

test('5. a parameter whose default the emit cannot read gets its type', async t => {
  const root = scratch(t, { 'src/types.ts': TYPES, 'src/a.ts': 'import { makeBox } from "./types"\nexport function open(box = makeBox(2)): void { void box }\n' });
  await migrateExplicitSurface({ root, write: true });
  assert.match(read(root, 'src/a.ts'), /export function open\(box: Box<number> = makeBox\(2\)\): void/);
});

test('6. a component that returns a variable gets ReactElement, an async page Promise<ReactElement>, and the import comes with it', async t => {
  const root = scratch(t, { 'src/card.tsx': 'export function Card() { const body = <div />; return body }\nexport async function Page() { return <main /> }\nexport const Maybe = (props: { on: boolean }) => { const x = <i />; return props.on ? x : null }\n' });
  const report = await migrateExplicitSurface({ root, write: true });
  const text = read(root, 'src/card.tsx');
  assert.match(text, /export function Card\(\): ReactElement \{/);
  assert.match(text, /export async function Page\(\): Promise<ReactElement> \{/);
  assert.match(text, /export const Maybe = \(props: \{ on: boolean \}\): ReactElement \| null =>/);
  assert.match(text, /^import type \{ ReactElement \} from "react"/m);
  assert.doesNotMatch(text, /JSX\.Element/);
  assert.deepEqual(report.findings, []);
});

test('7. a type the program exports is used by name, even when the checker inferred its structure', async t => {
  const root = scratch(t, { 'src/types.ts': TYPES, 'src/a.ts': 'import { load, makeBox } from "./types"\nexport const a = () => load()\nexport const b = () => Promise.resolve(makeBox({ id: "a", name: "b" }))\n' });
  await migrateExplicitSurface({ root, write: true });
  const text = read(root, 'src/a.ts');
  assert.match(text, /export const a = \(\): Promise<Resp> => load\(\)/);
  assert.match(text, /export const b = \(\): Promise<Box<Resp>> =>/);
  assert.doesNotMatch(text, /\{ id: string/);
});

test('8. string | undefined is written exactly when that is the type', async t => {
  const root = scratch(t, { 'src/cn.ts': 'export const cn = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ") || undefined\n' });
  await migrateExplicitSurface({ root, write: true });
  assert.match(read(root, 'src/cn.ts'), /\): string \| undefined =>/);
});

test('9. an import is added after the existing ones, merged into a named import of the same module, and kept after a directive prologue', async t => {
  const root = scratch(t, {
    'src/types.ts': TYPES,
    'src/merge.ts': 'import { makeBox } from "./types"\nexport const a = () => makeBox("x")\n',
    'src/value.ts': 'import { type Box, makeBox } from "./types"\nimport type { Resp } from "./types"\nexport const a = () => makeBox({ id: "1", name: "n" })\n',
    'src/directive.tsx': '"use client"\n\nexport function View() { const body = <p />; return body }\n',
  });
  await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/merge.ts'), 'import { makeBox, type Box } from "./types"\nexport const a = (): Box<string> => makeBox("x")\n');
  assert.match(read(root, 'src/value.ts'), /^import \{ type Box, makeBox \} from "\.\/types"\nimport type \{ Resp \} from "\.\/types"\nexport const a = \(\): Box<Resp> =>/);
  assert.equal(read(root, 'src/directive.tsx'), '"use client"\n\nimport type { ReactElement } from "react"\n\nexport function View(): ReactElement { const body = <p />; return body }\n');
});

test('10. a destructured export is reported with a suggested fix and not edited', async t => {
  const source = 'declare function build(): { Alpha: string; Beta: number }\nexport const { Alpha, Beta } = build()\n';
  const root = scratch(t, { 'src/a.ts': source });
  const report = await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/a.ts'), source);
  assert.deepEqual(report.findings.map(finding => [finding.code, finding.name]), [['DESTRUCTURED_EXPORT', 'Alpha'], ['DESTRUCTURED_EXPORT', 'Beta']]);
  assert.match(report.findings[0]?.suggestion ?? '', /export const name: Type = source\.name/);
  assert.equal(await codemodMain(['explicit-surface'], { cwd: root, stdout: () => undefined }), 1);
});

test('11. an anonymous or too long type is reported and the export is not edited', async t => {
  const source = [
    'export const anonymous = (id: string) => ({ id, nested: { deep: true } })',
    'export const hidden = () => { type Local = { a: 1 }; const value: Local = { a: 1 }; return [value] }',
    `export const long = (x: number) => (x > 1 ? "${'a'.repeat(30)}" : x > 0 ? "${'b'.repeat(30)}" : "${'c'.repeat(30)}")`,
    'export const open = (value: unknown) => JSON.parse(String(value))',
  ].join('\n') + '\n';
  const root = scratch(t, { 'src/a.ts': source });
  const report = await migrateExplicitSurface({ root, write: true });
  const kept = read(root, 'src/a.ts');
  assert.match(kept, /export const hidden = \(\) =>/);
  assert.match(kept, /export const open = \(value: unknown\) =>/);
  assert.match(kept, /export const long = \(x: number\) =>/);
  const codes = Object.fromEntries(report.findings.map(finding => [finding.name, finding.code]));
  assert.equal(codes['anonymous'], 'TYPE_ANONYMOUS');
  assert.ok(['TYPE_ANONYMOUS', 'TYPE_UNNAMEABLE'].includes(codes['hidden'] ?? ''));
  assert.equal(codes['long'], 'TYPE_TOO_LONG');
  assert.equal(codes['open'], 'TYPE_ANY');
  assert.ok(report.findings.every(finding => finding.suggestion.length > 0));
  assert.match(explicitSurfaceMarkdown(report), /Left for a person/);
});

test('12. a second run changes nothing', async t => {
  const root = scratch(t, { 'src/types.ts': TYPES, 'src/a.ts': 'import { load } from "./types"\nexport const a = () => load()\nexport const b = async () => 1\n' });
  const first = await migrateExplicitSurface({ root, write: true });
  assert.equal(first.changes.length, 2);
  const after = read(root, 'src/a.ts');
  const second = await migrateExplicitSurface({ root, write: true });
  assert.deepEqual([second.changes, second.findings, second.filesChanged, second.filesOpen], [[], [], [], 0]);
  assert.equal(read(root, 'src/a.ts'), after);
});

test('13. a dry run reports the annotations and writes nothing', async t => {
  const source = 'export async function size(text: string) { return text.length }\n';
  const root = scratch(t, { 'src/a.ts': source });
  const report = await migrateExplicitSurface({ root });
  assert.equal(report.write, false);
  assert.deepEqual(report.filesChanged, ['src/a.ts']);
  assert.equal(report.changes.length, 1);
  assert.equal(read(root, 'src/a.ts'), source);
  assert.ok(CODEMODS.includes('explicit-surface'));
});

test('14. Next route conventions keep their framework types', async t => {
  const next = 'export interface Metadata { title?: string; description?: string }\nexport interface Viewport { width?: string }\n';
  const root = scratch(t, {
    'node_modules/next/package.json': '{"name":"next","version":"15.0.0","types":"index.d.ts"}', 'node_modules/next/index.d.ts': next,
    'src/page.tsx': 'const base = () => ({ title: "Home" })\nexport async function generateMetadata() { return { title: "Home" } }\nexport const metadata = base()\n',
  });
  await migrateExplicitSurface({ root, write: true });
  const text = read(root, 'src/page.tsx');
  assert.match(text, /export async function generateMetadata\(\): Promise<Metadata> \{/);
  assert.match(text, /export const metadata: Metadata = /);
  assert.match(text, /^import type \{ Metadata \} from "next"/m);
});

test('15. a type the signature cannot name, or an inferred type predicate, is reported and not written', async t => {
  const source = 'export function isText(value: unknown) { return typeof value === "string" }\nexport function make() { class Local { a = 1 } return new Local() }\n';
  const root = scratch(t, { 'src/a.ts': source });
  const report = await migrateExplicitSurface({ root, write: true });
  assert.equal(read(root, 'src/a.ts'), source);
  assert.equal(report.findings.find(finding => finding.name === 'isText')?.code, 'TYPE_PREDICATE');
  assert.ok(['TYPE_ANONYMOUS', 'TYPE_UNNAMEABLE', 'NOT_SOUND'].includes(report.findings.find(finding => finding.name === 'make')?.code ?? ''));
});

test('16. each side reads the tsconfig that owns it and the path alias it already uses', async t => {
  const root = scratch(t, {
    'fe/tsconfig.json': TSCONFIG,
    'fe/src/types.ts': TYPES, 'fe/src/lib/a.ts': 'import { makeBox } from "@/types"\nexport const a = () => makeBox(1)\nexport const b = () => import("@/types")\n',
  });
  const report = await migrateExplicitSurface({ root, write: true });
  assert.match(read(root, 'fe/src/lib/a.ts'), /^import \{ makeBox, type Box \} from "@\/types"/);
  assert.ok(report.changes.every(change => change.file.startsWith('fe/src/')));
  assert.equal(report.findings.find(finding => finding.name === 'b')?.code, 'TYPE_UNNAMEABLE');
});
