// What a change dirties in a lint side: a body-only edit lints that file alone, a changed signature its direct importers, an inferred type one
// more level at a time; and the cases around it (added, deleted, renamed files, declared inputs, an edit during the run, globals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import type { TestContext } from 'node:test';
import { createFakeSession } from '../cache/fake-session.mjs';
import { lintSide, type CanonDeclarations, type EslintResult, type LintSideOutcome } from '../cache/lint-family.mjs';
import type { CacheRecord, JsonValue } from '../cache/types.mjs';

const SIDE = 'be';

class World {
  readonly root: string;
  readonly calls: (string[] | null)[] = [];
  onLint: (() => void) | null = null;

  constructor(context: TestContext) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-diff-'));
    context.after(() => fs.rmSync(this.root, { recursive: true, force: true }));
    this.write('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true, jsx: 'preserve' } }));
  }

  write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(path.join(this.root, file)), { recursive: true });
    fs.writeFileSync(path.join(this.root, file), text);
  }

  remove(file: string): void { fs.rmSync(path.join(this.root, file)); }
  rename(from: string, to: string): void { fs.renameSync(path.join(this.root, from), path.join(this.root, to)); }

  walk(): string[] {
    const out: string[] = [];
    const visit = (folder: string): void => {
      for (const entry of fs.readdirSync(path.join(this.root, folder), { withFileTypes: true })) {
        const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
        if (entry.isDirectory()) visit(rel); else out.push(rel);
      }
    };
    visit('');
    return out.sort();
  }

  get scope(): string[] { return this.walk().filter((file) => /\.tsx?$/.test(file)); }

  canon(): CanonDeclarations {
    return { name: 'fake-canon', graphRules: false, projectGraph: null, crossFileInputs: [{ rule: 'fake/sibling', kind: 'content', relativeTo: 'file', globs: ['*.txt'], appliesTo: ['**/*.ts'] }] };
  }

  async run(records: readonly CacheRecord[]): Promise<{ outcome: LintSideOutcome; written: readonly CacheRecord[] | undefined }> {
    const files: Record<string, string> = {};
    for (const file of this.walk()) files[`${SIDE}/${file}`] = fs.readFileSync(path.join(this.root, file), 'utf8');
    const session = createFakeSession({ files, records: { [`lint/${SIDE}`]: records } });
    const outcome = await lintSide({
      session, side: SIDE, sideRoot: this.root, scope: this.scope, stylesheets: [], report: null, canons: [this.canon()], styleCanon: null,
      typescript: () => ts, extraKey: '', gitToken: '', full: null, write: true,
      eslint: async (list) => {
        this.calls.push(list === null ? null : [...list]);
        this.onLint?.();
        return { results: (list ?? this.scope).map((file): EslintResult => ({ filePath: path.join(this.root, file), messages: [] })), errors: [] };
      },
      stylelint: null,
    });
    return { outcome, written: session.replaced.get(`lint/${SIDE}`) };
  }

  /** The ESLint calls of the next run, from the records of the last. */
  async next(records: readonly CacheRecord[] | undefined): Promise<{ called: (string[] | null)[]; written: readonly CacheRecord[] | undefined; outcome: LintSideOutcome }> {
    this.calls.length = 0;
    const result = await this.run(records ?? []);
    return { called: [...this.calls], written: result.written, outcome: result.outcome };
  }
}

/**
 * lib -> mid -> top is a chain of explicit signatures: nothing an importer reads of a file is inferred from the files that file imports.
 * base -> inferred -> consumer is a chain of inferred types: `inferred` has no annotation, so its type is whatever `base()` returns.
 */
function seed(world: World): void {
  world.write('src/lib.ts', 'export function lib(x: number): number {\n  return x + 1;\n}\n');
  world.write('src/mid.ts', "import { lib } from './lib';\nexport function mid(): number {\n  return lib(1);\n}\n");
  world.write('src/top.ts', "import { mid } from './mid';\nexport function top(): number {\n  return mid();\n}\n");
  world.write('src/base.ts', 'export function base(): number {\n  return 1;\n}\n');
  world.write('src/inferred.ts', "import { base } from './base';\nexport const inferred = base();\n");
  world.write('src/consumer.ts', "import { inferred } from './inferred';\nexport function consumer(): number {\n  return inferred;\n}\n");
  world.write('src/solo.ts', 'export const solo: number = 1;\n');
  world.write('docs/guide.ts', 'export const guide: string = "guide";\n');
  world.write('docs/note.txt', 'fine\n');
}

async function warm(world: World): Promise<readonly CacheRecord[]> {
  const first = await world.run([]);
  assert.ok(first.written);
  return first.written;
}

test('a cold run judges every file and writes the records, with the type surface of each file', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  assert.equal(first.outcome.stats.mode, 'full');
  assert.equal(first.outcome.stats.checked, 8);
  const written = first.written ?? [];
  assert.equal(written.filter((record) => record.step === 'eslint').length, 8);
  assert.equal(written.filter((record) => record.step === 'imports').length, 8);
  assert.equal(written.filter((record) => record.step === 'meta').length, 1);
  const surface = (file: string): { api?: string; open?: boolean } => (written.find((record) => record.step === 'imports' && record.path === file)?.data ?? {}) as { api?: string; open?: boolean };
  assert.match(surface('src/lib.ts').api ?? '', /^[0-9a-f]{64}$/);
  assert.equal(surface('src/lib.ts').open, false);
  assert.equal(surface('src/mid.ts').open, false, 'a signature that names no other file is closed');
  assert.equal(surface('src/inferred.ts').open, true, 'a type inferred from another file is open');
});

test('a warm run over an unchanged tree lints nothing', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  const second = await world.next(records);
  assert.deepEqual(second.called, []);
  assert.deepEqual([second.outcome.stats.checked, second.outcome.stats.reused], [0, 8]);
});

test('a body-only edit lints that file alone, though files reach it through three levels', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.write('src/lib.ts', 'export function lib(x: number): number {\n  return x + 2; // changed\n}\n');
  const second = await world.next(records);
  assert.deepEqual(second.called, [['src/lib.ts']]);
  // a comment appended at the end of the file is no part of its surface either
  world.write('src/lib.ts', 'export function lib(x: number): number {\n  return x + 2; // changed\n}\n// appended\n');
  const third = await world.next(second.written);
  assert.deepEqual(third.called, [['src/lib.ts']]);
});

test('an exported signature change lints the direct importers and stops there when their own surface is explicit', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.write('src/lib.ts', 'export function lib(x: number): string {\n  return String(x);\n}\n');
  const second = await world.next(records);
  assert.deepEqual(second.called, [['src/lib.ts', 'src/mid.ts']]);
});

test('an export whose type is inferred from another file carries the change one more level', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.write('src/base.ts', 'export function base(): string {\n  return "1";\n}\n');
  const second = await world.next(records);
  assert.deepEqual(second.called, [['src/base.ts', 'src/consumer.ts', 'src/inferred.ts']]);
  // and a body-only edit of the open file itself still lints it and the files that read its inferred type
  world.write('src/inferred.ts', "import { base } from './base';\nexport const inferred = base() + '';\n");
  const third = await world.next(second.written);
  assert.deepEqual(third.called, [['src/consumer.ts', 'src/inferred.ts']]);
});

test('a file whose explicit surface names a type of another file carries a change of that type, and no edit of its body', async (context) => {
  const world = new World(context);
  world.write('src/user.ts', 'export interface User {\n  name: string;\n}\n');
  world.write('src/service.ts', "import type { User } from './user';\nexport function find(): User {\n  return { name: 'a' };\n}\n");
  world.write('src/page.ts', "import { find } from './service';\nexport function page(): string {\n  return find().name;\n}\n");
  const records = await warm(world);
  const surface = (written: readonly CacheRecord[], file: string): { open?: boolean; refs?: string[] } => (written.find((record) => record.step === 'imports' && record.path === file)?.data ?? {}) as { open?: boolean; refs?: string[] };
  assert.equal(surface(records, 'src/service.ts').open, false);
  assert.deepEqual(surface(records, 'src/service.ts').refs, ['src/user.ts']);
  world.write('src/service.ts', "import type { User } from './user';\nexport function find(): User {\n  return { name: 'b' };\n}\n");
  const body = await world.next(records);
  assert.deepEqual(body.called, [['src/service.ts']]);
  world.write('src/user.ts', 'export interface User {\n  name: string;\n  age?: number;\n}\n');
  const type = await world.next(body.written);
  assert.deepEqual(type.called, [['src/page.ts', 'src/service.ts', 'src/user.ts']]);
});

test('a component that returns only JSX has the surface its props give, whatever its body reads; one that returns something else is inferred', async (context) => {
  const world = new World(context);
  world.write('src/card.tsx', 'export const Card = (props: { title: string }) => <div>{props.title}</div>;\n');
  world.write('src/screen.tsx', "import { Card } from './card';\nexport const Screen = () => <Card title=\"x\" />;\n");
  world.write('src/app.tsx', "import { Screen } from './screen';\nexport function App() {\n  return <main><Screen /></main>;\n}\n");
  world.write('src/picked.tsx', "export function Picked(props: { items: string[] }) {\n  const first = props.items[0];\n  return first;\n}\n");
  world.write('src/use-picked.tsx', "import { Picked } from './picked';\nexport function UsePicked() {\n  return <Picked items={[]} />;\n}\n");
  const records = await warm(world);
  const open = (file: string): boolean | undefined => ((records.find((record) => record.step === 'imports' && record.path === file)?.data ?? {}) as { open?: boolean }).open;
  assert.deepEqual(['card', 'screen', 'app', 'picked'].map((name) => open(`src/${name}.tsx`)), [false, false, false, true]);
  world.write('src/card.tsx', 'export const Card = (props: { title: string }) => <section>{props.title}</section>;\n');
  const body = await world.next(records);
  assert.deepEqual(body.called, [['src/card.tsx']]);
  world.write('src/card.tsx', 'export const Card = (props: { title: string; tone: string }) => <section>{props.title}</section>;\n');
  const props = await world.next(body.written);
  assert.deepEqual(props.called, [['src/card.tsx', 'src/screen.tsx']]);
  world.write('src/picked.tsx', "export function Picked(props: { items: string[] }) {\n  const first = props.items[1];\n  return first;\n}\n");
  const inferred = await world.next(props.written);
  assert.deepEqual(inferred.called, [['src/picked.tsx', 'src/use-picked.tsx']]);
});

test('an added file is linted alone; the files that did not change keep their results', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.write('src/added.ts', "import { lib } from './lib';\nexport const added: number = lib(1);\n");
  const second = await world.next(records);
  assert.deepEqual(second.called, [['src/added.ts']]);
  assert.equal(second.written?.filter((record) => record.step === 'eslint').length, 9);
});

test('a deleted file drops its records and lints the files that imported it', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.remove('src/solo.ts');
  const unimported = await world.next(records);
  assert.deepEqual(unimported.called, []);
  assert.equal(unimported.written?.some((record) => record.path === 'src/solo.ts'), false);
  world.remove('src/mid.ts');
  const imported = await world.next(unimported.written);
  assert.deepEqual(imported.called, [['src/top.ts']]);
});

test('a renamed file is a deleted and an added file: its importers and the new name are linted', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.rename('src/mid.ts', 'src/mid2.ts');
  const second = await world.next(records);
  assert.deepEqual(second.called, [['src/mid2.ts', 'src/top.ts']]);
  assert.equal(second.written?.some((record) => record.path === 'src/mid.ts'), false);
});

test('a change to a declared cross-file input lints only the files that declare it', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  world.write('docs/note.txt', 'NO\n');
  const second = await world.next(records);
  assert.deepEqual(second.called, [['docs/guide.ts']]);
});

test('a file edited while the linter ran loses only its own record and is linted again by the next run', async (context) => {
  const world = new World(context);
  seed(world);
  world.onLint = () => world.write('src/solo.ts', 'export const solo: number = 2;\n');
  const first = await world.run([]);
  assert.ok(first.written);
  assert.equal(first.written.some((record) => record.path === 'src/solo.ts'), false);
  assert.equal(first.written.filter((record) => record.step === 'eslint').length, 7);
  world.onLint = null;
  const second = await world.next(first.written);
  assert.deepEqual(second.called, [['src/solo.ts']]);
});

test('a file that declares globals makes the whole side', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/globals.d.ts', 'declare const FLAG: number;\n');
  const records = await warm(world);
  world.write('src/globals.d.ts', 'declare const FLAG: string;\n');
  const second = await world.next(records);
  assert.deepEqual(second.called, [null]);
  assert.match(second.outcome.stats.reason, /declares globals/);
});

test('records from before the type surface was kept are read as changed, never as unchanged', async (context) => {
  const world = new World(context);
  seed(world);
  const records = await warm(world);
  const old = records.map((record) => {
    if (record.step !== 'imports') return record;
    const { api: _api, open: _open, ...rest } = record.data as { [key: string]: unknown };
    return { ...record, data: rest as JsonValue };
  });
  world.write('src/lib.ts', 'export function lib(x: number): number {\n  return x + 3;\n}\n');
  const second = await world.next(old);
  // nothing is known of the surface of mid either, so the change is carried on through it
  assert.deepEqual(second.called, [['src/lib.ts', 'src/mid.ts', 'src/top.ts']]);
});
