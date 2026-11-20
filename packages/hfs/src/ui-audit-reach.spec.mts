// proves: UI_AUDIT_STALE@lite
// The UI audit reach counts what can change a screen: the exported symbols that changed between the base and the head (symbol-diff.mts), the cause a stale audit names, and the check counts
// that keep a reported (cutover, local, report profile) finding apart from a blocking one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import { catalogDiff, readsChanged, usageOf } from '../cache/catalog-reach.mjs';
import { changedSymbols } from '../cache/symbol-diff.mjs';
import { judgedCounts } from '../runtime/scripts/hfs/check-results.mjs';
import { causeOf } from '../runtime/scripts/hfs/screen-yaml.mjs';

const BASE = `import { helper } from "./helper"
const LIMIT = 3
const twice = (n: number) => n * 2
export const a = (n: number) => twice(n) + LIMIT
export const b = (n: number) => helper(n)
export function c() { return 1 }
`;
const diff = (head: string, base: string | null = BASE, file = 'src/m.ts') => changedSymbols(ts, file, base, head);

test('a symbol changes only when its own declaration or a declaration it uses changes', () => {
  assert.deepEqual([...diff(BASE.replace('return 1', 'return 2')).names], ['c']);
  assert.deepEqual([...diff(BASE.replace('const LIMIT = 3', 'const LIMIT = 4')).names], ['a']);
  assert.deepEqual([...diff(BASE.replace('n * 2', 'n * 3')).names], ['a']);
  assert.deepEqual([...diff(BASE.replace('"./helper"', '"./other"')).names], ['b']);
});

test('formatting and comments change nothing; a new or removed export is a change', () => {
  assert.equal(diff(BASE.replace('export function c() { return 1 }', '// the one\nexport function c() {\n  return 1\n}')).names.size, 0);
  assert.deepEqual([...diff(`${BASE}export const d = 1\n`).names], ['d']);
  assert.deepEqual([...diff(BASE.replace('export function c() { return 1 }\n', '')).names], ['c']);
});

test('a file the base did not have adds nothing: only a changed file can import it', () => {
  const added = diff(BASE, null);
  assert.equal(added.all, false);
  assert.equal(added.names.size, 0);
});

test('a file the symbols cannot tell apart counts whole: parse error, export *, a script that is no module', () => {
  assert.equal(diff('export const = ').all, true);
  assert.equal(diff(`${BASE}export * from "./more"\n`).all, true);
  assert.equal(changedSymbols(ts, 'src/data.json', '{}', '{ }').all, true);
});

test('a stale audit names the first changed file that reaches the screen and how many more do', () => {
  assert.equal(causeOf(['fe/apps/app/src/hooks/x.ts']), ' (changed: fe/apps/app/src/hooks/x.ts)');
  assert.equal(causeOf(['fe/a.ts', 'fe/b.ts', 'fe/c.ts']), ' (changed: fe/a.ts and 2 more)');
  assert.equal(causeOf([]), '');
});

test('the counts split blocking errors from reported ones, per code', () => {
  const counts = judgedCounts([
    { code: 'X', level: 'error' }, { code: 'X', level: 'error', report: true }, { code: 'Y', level: 'error', report: true }, { code: 'Z', level: 'warning' },
  ]);
  assert.equal(counts.error, 3);
  assert.equal(counts.blocking, 1);
  assert.equal(counts.reportOnly, 2);
  assert.deepEqual(counts.byCode['X'], { level: 'error', count: 2, blocking: 1, reported: 1 });
  assert.deepEqual(counts.byCode['Y'], { level: 'error', count: 1, reported: 1 });
});

// ---- i18n catalog granularity (catalog-reach.mts): a catalog edit marks only the screens whose reached sources read a key that changed
const CATALOG = JSON.stringify({ orders: { title: 'Orders', body: 'Body', status: { open: 'Open' } }, other: { name: 'Name' } });
const read = (source: string) => usageOf(ts, 'src/Screen.tsx', source);
const SCREEN_ONE = `import { useTranslations } from "next-intl"\nexport const One = () => { const t = useTranslations("orders"); return t("title") }\n`;
const SCREEN_TWO = `import { useTranslations } from "next-intl"\nexport const Two = () => { const t = useTranslations("orders"); return t("body") }\n`;
const SCREEN_DYNAMIC = `import { useTranslations } from "next-intl"\nexport const Dyn = ({ s }: { s: string }) => { const t = useTranslations("orders"); return t(\`status.\${s}\`) }\n`;
const NO_TRANSLATOR = 'export const Plain = () => "orders.title"\n';

test('a changed key marks the screen that reads it and no other', () => {
  const diff = catalogDiff(CATALOG, CATALOG.replace('"Orders"', '"All orders"'));
  assert.deepEqual([...diff.keys], ['orders.title']);
  assert.equal(readsChanged(read(SCREEN_ONE), diff), true);
  assert.equal(readsChanged(read(SCREEN_TWO), diff), false);
  assert.equal(readsChanged(read(NO_TRANSLATOR), diff), true, 'a source with no translator is read by the canon\'s loose patterns');
});

test('an added key stalls only the screens that read it', () => {
  const grown = JSON.parse(CATALOG) as { orders: Record<string, unknown> };
  grown.orders['extra'] = 'E';
  const diff = catalogDiff(CATALOG, JSON.stringify(grown));
  assert.deepEqual([...diff.keys], ['orders.extra']);
  const used = `import { useTranslations } from "next-intl"\nexport const Used = () => { const t = useTranslations("orders"); return t("extra") }\n`;
  assert.equal(readsChanged(read(used), diff), true);
  assert.equal(readsChanged(read(SCREEN_ONE), diff), false);
  assert.equal(readsChanged(read(SCREEN_TWO), diff), false);
});

test('a key built dynamically counts for its whole namespace, and a catalog that does not parse counts for every screen', () => {
  const diff = catalogDiff(CATALOG, CATALOG.replace('"Orders"', '"All orders"'));
  assert.deepEqual(read(SCREEN_DYNAMIC).dynamic, ['orders']);
  assert.equal(readsChanged(read(SCREEN_DYNAMIC), diff), true, 'a template key reads any key of its namespace');
  assert.equal(readsChanged(read(SCREEN_DYNAMIC), catalogDiff(CATALOG, CATALOG.replace('"Name"', '"Other name"'))), false, 'another namespace is not read');
  assert.equal(readsChanged(read(SCREEN_TWO), catalogDiff(CATALOG, '{ not json')), true);
});
