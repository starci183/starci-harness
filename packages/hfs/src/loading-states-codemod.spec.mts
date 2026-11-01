import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { loadingStatesMarkdown, migrateLoadingStates, transformLoadingStates } from '../codemod/loading-states.mjs';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';

const GRAMMAR = '@starci/grammar/core';
const run = (names: string, body: string, file = 'src/components/View.tsx') => transformLoadingStates({ ts, text: `import { ${names} } from '${GRAMMAR}';\n${body}`, file });
const plain = (body: string, file = 'src/components/View.tsx') => transformLoadingStates({ ts, text: body, file });
const codes = (result: { findings: { code: string }[] }) => result.findings.map(finding => finding.code);
const changeCodes = (result: { changes: { code: string }[] }) => result.changes.map(item => item.code);

test('RENAME_IS_SKELETON: isSkeleton becomes isLoading on every Grammar element, through an alias and a namespace', () => {
  const result = transformLoadingStates({ ts, text: `import { Section, SurfaceCard as Card, Badge, Text } from '${GRAMMAR}';\nimport * as G from '@starci/grammar/offset-pop';\nimport { Other } from 'another-ui';\nconst A = () => <><Section isSkeleton /><Card isSkeleton={busy} /><Badge isSkeleton /><G.Button isSkeleton={a.b} /><Text isSkeleton>x</Text><Other isSkeleton /></>;` });
  assert.ok(result.text.includes("<Section isLoading /><Card isLoading={busy} /><Badge isLoading /><G.Button isLoading={a.b} /><Text isLoading>x</Text><Other isSkeleton />"));
  assert.deepEqual(changeCodes(result), ['RENAME_IS_SKELETON', 'RENAME_IS_SKELETON', 'RENAME_IS_SKELETON', 'RENAME_IS_SKELETON', 'RENAME_IS_SKELETON']);
});

test('LOADING_NAME_CONFLICT: an element with both isSkeleton and isLoading is reported and kept', () => {
  const result = run('Badge', 'const A = () => <Badge isSkeleton isLoading={x} />;');
  assert.deepEqual(codes(result), ['LOADING_NAME_CONFLICT']);
  assert.ok(result.text.includes("<Badge isSkeleton isLoading={x} />"));
  assert.deepEqual(result.changes, []);
});

test('RENAME_IS_SKELETON: an isSkeleton key inside a Grammar attribute is renamed; a shorthand is reported (IS_SKELETON_KEY)', () => {
  const result = run('Breadcrumbs', 'const A = () => <><Breadcrumbs items={[{ label: "a", isSkeleton: true }, { label: "b", isSkeleton }]} /><Other items={[{ isSkeleton: true }]} /></>; const free = { isSkeleton: true };');
  assert.ok(result.text.includes("{ label: \"a\", isLoading: true }, { label: \"b\", isSkeleton }"));
  assert.ok(result.text.includes("<Other items={[{ isSkeleton: true }]} />"));
  assert.ok(result.text.includes("const free = { isSkeleton: true };"));
  assert.deepEqual(codes(result), ['IS_SKELETON_KEY']);
  assert.deepEqual(changeCodes(result), ['RENAME_IS_SKELETON']);
});

test('REMOVE_LOADING_ROWS: loadingRows goes from the five components, a spread does not block it', () => {
  const result = run('Section, SurfaceCard, ListBox, Timeline, DataTable, Badge', 'const A = () => <><Section loadingRows={3} title="t" /><SurfaceCard {...p} loadingRows={2} /><ListBox\n  items={i}\n  loadingRows={4}\n/><Timeline loadingRows={1} /><DataTable loadingRows /><Badge loadingRows={2} /></>;');
  assert.match(result.text, /<Section title="t" \/><SurfaceCard \{\.\.\.p\} \/><ListBox\n {2}items=\{i\}\n\/><Timeline \/><DataTable \/><Badge loadingRows=\{2\} \/>/);
  assert.equal(changeCodes(result).filter(code => code === 'REMOVE_LOADING_ROWS').length, 5);
});

test('REMOVE_BUBBLE_ROWS: a skeleton MessageBubble loses rows with the rename', () => {
  const result = run('MessageBubble', 'const A = () => <><MessageBubble isSkeleton rows={3} hasAvatar /><MessageBubble rows={3} side="in" /></>;');
  assert.match(result.text, /<MessageBubble isLoading hasAvatar \/><MessageBubble rows=\{3\} side="in" \/>/);
  assert.deepEqual(changeCodes(result), ['RENAME_IS_SKELETON', 'REMOVE_BUBBLE_ROWS']);
});

test('slot flag reads stay as they are: isLoading, isError and isForbidden are still valid', () => {
  const text = 'let events: DataSlot<number[]>;\nconst a = events.isLoading === true; const b = !events.isError; const c = events?.isForbidden;';
  const result = plain(text);
  assert.equal(result.text, text);
  assert.deepEqual([result.changes, result.findings], [[], []]);
});

test('SLOT_ITEMS_ACCESS: items outside a narrowing is reported, inside one it is not', () => {
  const result = plain('let events: DataSlot<number[]>;\nconst a = events.items;\nconst b = "items" in events ? events.items : [];\nif (!events.isLoading && !events.isError) { use(events.items); }\nconst c = "items" in events && events.items.length;');
  assert.deepEqual(codes(result), ['SLOT_ITEMS_ACCESS']);
  assert.equal(result.findings[0]?.line, 2);
  assert.match(result.findings[0]?.reason ?? '', /only on the ready member/);
});

test('SLOT_LITERAL_FLAGS: an undefined-items literal in a slot context becomes its flag member', () => {
  const result = plain([
    'const a: DataSlot<number> = { items: undefined, isLoading: true };',
    'const b: DataSlot<number> = { items: undefined, isError: true };',
    'const c: DataSlot<number> = { isForbidden: true, items: undefined };',
    'const d: DataSlot<number> = { items: undefined };',
    'const e: DataSlot<number> = { items: 4 };',
    'function f(): DataSlot<number> { return { items: undefined }; }',
    'const g = (): DataSlot<number> => ({ items: undefined, isLoading: true });',
    'function make(): DataSlot<number> { return build(); }',
    'const h = make({ items: undefined });',
    'const other = { items: undefined };',
  ].join('\n'));
  assert.deepEqual(result.text.split('\n'), [
    'const a: DataSlot<number> = { isLoading: true };',
    'const b: DataSlot<number> = { isError: true };',
    'const c: DataSlot<number> = { isForbidden: true };',
    'const d: DataSlot<number> = { isEmpty: true };',
    'const e: DataSlot<number> = { items: 4 };',
    'function f(): DataSlot<number> { return { isEmpty: true }; }',
    'const g = (): DataSlot<number> => ({ isLoading: true });',
    'function make(): DataSlot<number> { return build(); }',
    'const h = make({ isEmpty: true });',
    'const other = { items: undefined };',
  ]);
  assert.equal(changeCodes(result).filter(code => code === 'SLOT_LITERAL_FLAGS').length, 7);
  assert.deepEqual(result.findings, []);
});

test('SLOT_LITERAL: a spread, a conditional items, a non-true flag and a legacy-shaped literal are reported', () => {
  const result = plain([
    'const a: DataSlot<number> = { ...slot, items: 2 };',
    'const b: DataSlot<number> = { items: ok ? 1 : undefined };',
    'const c: DataSlot<number> = { items: undefined, isLoading: busy };',
    'const d: DataSlot<number> = { items: 1, isLoading: false };',
    'const e = { items: [], isLoading: true };',
    'const f: DataSlot<number> = { isLoading: true };',
  ].join('\n'));
  assert.deepEqual(codes(result), ['SLOT_LITERAL', 'SLOT_LITERAL', 'SLOT_LITERAL', 'SLOT_LITERAL', 'SLOT_LITERAL']);
  assert.deepEqual(result.findings.map(finding => finding.line), [1, 2, 3, 4, 5]);
  assert.match(result.findings[0]?.reason ?? '', /one flag member/);
  assert.deepEqual(result.changes, []);
});

test('LOADING_CONTENT: loadingContent on a Grammar DataTable is reported and kept', () => {
  const result = run('DataTable', 'const A = () => <><DataTable loadingContent={<Spin />} /><Other loadingContent={x} /></>;');
  assert.deepEqual(codes(result), ['LOADING_CONTENT']);
  assert.match(result.text, /loadingContent=\{<Spin \/>\}/);
  assert.equal(result.findings[0]?.component, 'DataTable');
});

test('HAND_SKELETON: Skeleton, ChatBubbleSkeletons and MessageBubbleSkeletons are reported wherever they come from', () => {
  const result = plain('import { Skeleton } from "elsewhere";\nconst A = () => <><Skeleton h={2} /><ChatBubbleSkeletons count={3} /><ui.MessageBubbleSkeletons /><Skeletons /></>;');
  assert.deepEqual(codes(result), ['HAND_SKELETON', 'HAND_SKELETON', 'HAND_SKELETON']);
  assert.match(result.findings[0]?.reason ?? '', /pass the status/);
});

test('SWR_DEFAULT_ARRAY: a hook folding a read to [] without its status is reported; one reading the status is not', () => {
  const folded = plain('export function useX() { const read = useSWR("k"); return { rows: read.data ?? [], names: read.data?.map(r => r.n) ?? [] }; }', 'src/hooks/useX.ts');
  assert.deepEqual(codes(folded), ['SWR_DEFAULT_ARRAY', 'SWR_DEFAULT_ARRAY']);
  const bare = plain('export function useX() { const { data } = useSWR("k"); return data ?? []; }', 'src/hooks/useX.ts');
  assert.deepEqual(codes(bare), ['SWR_DEFAULT_ARRAY']);
  const withStatus = plain('export function useX() { const read = useSWR("k"); return { rows: read.data ?? [], isLoading: read.isLoading }; }', 'src/hooks/useX.ts');
  assert.deepEqual(withStatus.findings, []);
  const elsewhere = plain('export function useX() { const read = useSWR("k"); return read.data ?? []; }', 'src/hooks/swr/useX.ts');
  assert.deepEqual(elsewhere.findings, []);
  assert.deepEqual(plain('const r = read.data ?? [];', 'src/components/View.tsx').findings, []);
});

test('PLACEHOLDER_OBJECT: a ...Placeholder object with a [] field is reported; a lowercase placeholder is not', () => {
  const result = plain('const listPlaceholder = { rows: [], title: "t" };\nconst view = { detailPlaceholder: { chips: [] }, placeholder: { rows: [] }, inputPlaceholder: "x" };\nconst okPlaceholder = { title: "t" };');
  assert.deepEqual(codes(result), ['PLACEHOLDER_OBJECT', 'PLACEHOLDER_OBJECT']);
  assert.deepEqual(result.findings.map(finding => finding.line), [1, 2]);
});

test('VALIDATING_AS_LOADING: isValidating inside a loading flag or status is reported', () => {
  const result = plain('const isLoading = read.isLoading || read.isValidating;\nconst v = { loading: read.isValidating, status: busy ? "a" : isValidating, ok: read.isValidating };\nconst fine = read.isValidating;');
  assert.deepEqual(codes(result), ['VALIDATING_AS_LOADING', 'VALIDATING_AS_LOADING', 'VALIDATING_AS_LOADING']);
  assert.deepEqual(result.findings.map(finding => finding.line), [1, 2, 2]);
});

test('FOREIGN_SLOT_STATUS: a property taking the same status from another slot is reported', () => {
  const result = plain('const a = { isLoading: listSlot.isLoading, isError: props.threadSlot.isError, error: listSlot.error, other: listSlot.isLoading, isLoading2: x.isLoading };\nconst b = { isLoading: read.isLoading, error: listSlot.isError };');
  assert.deepEqual(codes(result), ['FOREIGN_SLOT_STATUS', 'FOREIGN_SLOT_STATUS', 'FOREIGN_SLOT_STATUS']);
});

test('report-only codes skip spec and test files; the safe rewrites still apply there', () => {
  const body = 'import { Section } from "@starci/grammar/core";\nconst A = () => <><Section isSkeleton /><ChatBubbleSkeletons /></>; const listPlaceholder = { rows: [] };';
  const result = plain(body, 'src/View.spec.tsx');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(changeCodes(result), ['RENAME_IS_SKELETON']);
});

test('nothing to do: unrelated source, Section from another module, and a shadowed name are untouched', () => {
  const text = `import { Section } from 'another-ui';\nconst A = ({ Section: S }) => <><Section isSkeleton loadingRows={2} /><S isSkeleton /></>;\nconst value = query.isLoading;`;
  const result = plain(text);
  assert.equal(result.text, text);
  assert.deepEqual([result.changes, result.findings], [[], []]);
  const plainText = 'export const x = 1;\n';
  assert.deepEqual(plain(plainText), { text: plainText, changes: [], findings: [] });
});

test('a parse error keeps the file and reports PARSE_ERROR', () => {
  const result = run('Section', 'const A = () => <Section isSkeleton>');
  assert.deepEqual(codes(result), ['PARSE_ERROR']);
});

function fixture(t: TestContext, body = 'export const View = () => <><Section isSkeleton loadingRows={3} /><DataTable loadingContent={x} /></>;') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loading-states-codemod-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/components'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/x/index.tsx'), 'const a = <Skeleton />;');
  const file = path.join(root, 'src/components/View.tsx');
  const text = `import { Section, DataTable } from '${GRAMMAR}';\n${body}`;
  fs.writeFileSync(file, text);
  return { root, file, text };
}

test('dry run writes nothing, --execute writes the safe rewrites, and a second run finds nothing to change', t => {
  const { root, file, text } = fixture(t);
  const preview = migrateLoadingStates({ root, ts });
  assert.equal(preview.schema, 'starci/loading-states-report@1');
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.deepEqual(preview.filesChanged, ['src/components/View.tsx']);
  assert.equal(preview.filesScanned, 1);
  const written = migrateLoadingStates({ root, write: true, ts });
  const migrated = fs.readFileSync(file, 'utf8');
  assert.match(migrated, /<Section isLoading \/><DataTable loadingContent=\{x\} \/>/);
  assert.deepEqual(written.findings.map(finding => finding.code), ['LOADING_CONTENT']);
  const again = migrateLoadingStates({ root, write: true, ts });
  assert.deepEqual([again.changes, again.filesChanged], [[], []]);
  assert.equal(fs.readFileSync(file, 'utf8'), migrated);
  assert.match(loadingStatesMarkdown(written), /LOADING_CONTENT/);
});

test('codemodMain loading-states exits 1 while findings remain and 0 when none do', t => {
  const { root, file } = fixture(t);
  const output: string[] = [];
  const io = { cwd: root, stdout: (value: string) => output.push(value) };
  assert.ok(CODEMODS.includes('loading-states'));
  assert.equal(codemodMain(['loading-states', '--json'], io), 1);
  assert.equal(JSON.parse(output.pop() ?? '{}').write, false);
  assert.match(fs.readFileSync(file, 'utf8'), /isSkeleton/);
  assert.equal(codemodMain(['loading-states', '--execute', '--out', 'report.json', '--format', 'json'], io), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8')).changes.length, 2);
  assert.match(fs.readFileSync(file, 'utf8'), /isLoading/);
  fs.writeFileSync(file, `import { Section } from '${GRAMMAR}';\nexport const View = () => <Section isLoading />;`);
  assert.equal(codemodMain(['loading-states'], io), 0);
  assert.match(output.pop() ?? '', /0 left for a person/);
  assert.throws(() => codemodMain(['loading-states', '--bogus'], io), /unknown codemod option/);
});
