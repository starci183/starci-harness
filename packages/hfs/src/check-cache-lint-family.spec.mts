// The lint family of the app check cache: what is reused, what is judged again, and that the cached answer is the one a full run gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import type { TestContext } from 'node:test';
import { createFakeSession } from '../cache/fake-session.mjs';
import { lintSide, type CanonDeclarations, type CrossFileInput, type EslintResult, type GraphSnapshot, type LintSideOutcome, type StylelintResult } from '../cache/lint-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const SIDE = 'be';

/** A side on disk and the fake linters that read it: a `type-aware` rule (a file is bad when anything it imports is), a graph rule (two files
 *  holding DUP are duplicates, each reported on the other's account), and a rule that reads the `.txt` files beside a file. */
class World {
  readonly root: string;
  readonly eslintCalls: (string[] | null)[] = [];
  readonly styleCalls: (string[] | null)[] = [];
  /** Edits the tree while the linter runs (the edit-during-run case). */
  onLint: (() => void) | null = null;

  constructor(context: TestContext) {
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-lint-'));
    context.after(() => fs.rmSync(this.root, { recursive: true, force: true }));
    this.write('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true } }));
  }

  write(file: string, text: string): void {
    fs.mkdirSync(path.dirname(path.join(this.root, file)), { recursive: true });
    fs.writeFileSync(path.join(this.root, file), text);
  }

  remove(file: string): void {
    fs.rmSync(path.join(this.root, file));
  }

  walk(): string[] {
    const out: string[] = [];
    const visit = (folder: string): void => {
      for (const entry of fs.readdirSync(path.join(this.root, folder), { withFileTypes: true })) {
        const rel = folder === '' ? entry.name : `${folder}/${entry.name}`;
        if (entry.isDirectory()) visit(rel);
        else out.push(rel);
      }
    };
    visit('');
    return out.sort();
  }

  get scope(): string[] {
    return this.walk().filter((file) => /\.ts$/.test(file));
  }

  get stylesheets(): string[] {
    return this.walk().filter((file) => /\.css$/.test(file));
  }

  text(file: string): string {
    return fs.readFileSync(path.join(this.root, file), 'utf8');
  }

  /** The local files `file` reaches through imports, by the fake rule's own reading (a regex over the text, independent of the cache). */
  closure(file: string): Set<string> {
    const seen = new Set<string>();
    const queue = [file];
    while (queue.length) {
      const current = queue.pop() as string;
      const text = this.text(current);
      for (const match of text.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
        const target = path.posix.join(path.posix.dirname(current), match[1] as string);
        const found = [target, `${target}.ts`, `${target}/index.ts`].find((candidate) => this.scope.includes(candidate));
        if (found !== undefined && !seen.has(found)) { seen.add(found); queue.push(found); }
      }
    }
    return seen;
  }

  graph(): GraphSnapshot {
    const dup = this.scope.filter((file) => this.text(file).includes('DUP'));
    const byFile: Record<string, { rule: string; code: string; line: number; column: number; message: string }[]> = {};
    if (dup.length > 1) for (const file of dup) byFile[file] = [{ rule: 'starci-be/duplicate-code', code: 'HFS_DUPLICATE_CODE', line: 1, column: 1, message: `DUP also in ${dup.filter((other) => other !== file).join(', ')}` }];
    return { byFile };
  }

  lintOne(file: string): EslintResult {
    const messages: EslintResult['messages'] = [];
    for (const reached of [file, ...this.closure(file)]) if (this.text(reached).includes('BAD')) messages.push({ ruleId: 'fake/no-bad', message: `BAD in ${reached}`, line: 1, column: 1, endLine: 2 });
    for (const finding of this.graph().byFile[file] ?? []) messages.push({ ruleId: finding.rule, message: `[${finding.code}] ${finding.message}`, line: finding.line, column: finding.column });
    const beside = this.walk().filter((entry) => path.posix.dirname(entry) === path.posix.dirname(file) && entry.endsWith('.txt'));
    for (const entry of beside) if (this.text(entry).includes('NO')) messages.push({ ruleId: 'fake/sibling', message: `${entry} says NO`, line: 3, column: 2 });
    return { filePath: path.join(this.root, file), messages };
  }

  canon(overrides: Partial<CanonDeclarations> = {}): CanonDeclarations {
    const sibling: CrossFileInput = { rule: 'fake/sibling', kind: 'content', relativeTo: 'file', globs: ['*.txt'], appliesTo: ['**/*.ts'] };
    return { name: 'fake-canon', crossFileInputs: [sibling], graphRules: true, projectGraph: () => this.graph(), ...overrides };
  }

  styleCanon(overrides: Partial<CanonDeclarations> = {}): CanonDeclarations {
    const tokens: CrossFileInput = { rule: 'starci/token-only', kind: 'content', relativeTo: 'side', globs: ['**/globals.css'], appliesTo: ['**/*.css'] };
    return { name: 'fake-style', crossFileInputs: [tokens], graphRules: false, projectGraph: null, ...overrides };
  }

  /** Runs the family once over this tree against `records` and answers the outcome with the records it wrote. */
  async run(records: readonly CacheRecord[], options: { full?: string | null; canon?: CanonDeclarations; write?: boolean; report?: ((file: string) => boolean) | null; style?: boolean; styleCanon?: CanonDeclarations } = {}): Promise<{ outcome: LintSideOutcome; written: readonly CacheRecord[] | undefined }> {
    const files: Record<string, string> = {};
    for (const file of this.walk()) files[`${SIDE}/${file}`] = this.text(file);
    const session = createFakeSession({ files, records: { [`lint/${SIDE}`]: records } });
    const style = options.style === true;
    const outcome = await lintSide({
      session, side: SIDE, sideRoot: this.root, scope: this.scope, stylesheets: style ? this.stylesheets : [],
      report: options.report ?? null, canons: [options.canon ?? this.canon()], styleCanon: style ? (options.styleCanon ?? this.styleCanon()) : null,
      typescript: () => ts, extraKey: '', full: options.full ?? null, write: options.write ?? true,
      eslint: async (list) => {
        this.eslintCalls.push(list === null ? null : [...list]);
        const results = (list ?? this.scope).map((file) => this.lintOne(file));
        this.onLint?.();
        return { results, errors: [] };
      },
      stylelint: style ? async (list) => {
        this.styleCalls.push(list === null ? null : [...list]);
        const results: StylelintResult[] = (list ?? this.stylesheets).map((file) => ({
          source: path.join(this.root, file),
          warnings: this.text(file).includes('!important') ? [{ rule: 'starci/no-important', text: `${file} uses !important`, line: 1, column: 1, endLine: 1 }] : [],
        }));
        return { results, errors: [] };
      } : null,
    });
    return { outcome, written: session.replaced.get(`lint/${SIDE}`) };
  }

  /** Every result of the world judged in full, for comparison. */
  async full(): Promise<LintSideOutcome> {
    return (await this.run([], { full: 'compare', write: false })).outcome;
  }
}

const shape = (results: readonly EslintResult[]): string[] => results.map((result) => `${path.basename(result.filePath)}|${result.messages.map((message) => `${message.ruleId}:${message.line}:${message.column}:${message.endLine ?? ''}:${message.message}`).join('~')}`).sort();

function seed(world: World): void {
  world.write('src/a.ts', "import { b } from './b';\nexport const a = b;\n");
  world.write('src/b.ts', "import { c } from './c';\nexport const b = c;\n");
  world.write('src/c.ts', 'export const c = 1;\n');
  world.write('src/d.ts', 'export const d = 2;\n');
  world.write('other/e.ts', 'export const e = 3;\n');
}

test('a first run judges everything and writes; the next run on an unchanged tree judges nothing', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  assert.equal(first.outcome.stats.mode, 'full');
  assert.equal(first.outcome.stats.checked, 5);
  assert.ok(first.written);
  const second = await world.run(first.written);
  assert.equal(second.outcome.stats.mode, 'diff');
  assert.equal(second.outcome.stats.reason, 'the side key is unchanged');
  assert.deepEqual([second.outcome.stats.checked, second.outcome.stats.reused], [0, 5]);
  assert.equal(second.written, undefined);
  assert.deepEqual(shape(second.outcome.eslint), shape(first.outcome.eslint));
});

test('a changed file is judged again with the files that reach it through imports, and nothing else', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/c.ts', 'export const c = "BAD";\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
  assert.equal(second.outcome.stats.checked, 3);
  assert.equal(second.outcome.stats.reused, 2);
  assert.equal(second.outcome.stats.newFindings, 3);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
});

test('type-only imports, re-exports and dynamic imports carry a change to their importers', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/t.ts', 'export type T = number;\n');
  world.write('src/x.ts', "import type { T } from './t';\nexport const x: T = 1;\n");
  world.write('src/y.ts', "export * from './t';\n");
  world.write('src/z.ts', "export const z = () => import('./t');\n");
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/t.ts', 'export type T = "BAD";\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['src/t.ts', 'src/x.ts', 'src/y.ts', 'src/z.ts']]);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
});

test('a file that stopped importing a changed file is judged again with the importers of the new graph', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/a.ts', 'export const a = 0;\n');
  world.write('src/c.ts', 'export const c = "BAD";\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
});

test('a new duplicate judges an unchanged file again, because its project-graph findings changed', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/d.ts', 'export const d = "DUP";\n');
  const first = await world.run([]);
  assert.equal(first.outcome.eslint.every((result) => result.messages.length === 0), true);
  world.eslintCalls.length = 0;
  world.write('other/e.ts', 'export const e = "DUP";\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['other/e.ts', 'src/d.ts']]);
  assert.ok(shape(second.outcome.eslint).some((line) => line.startsWith('d.ts|starci-be/duplicate-code')));
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
  // and the duplicate going away judges the survivor again
  world.eslintCalls.length = 0;
  world.write('other/e.ts', 'export const e = 3;\n');
  const third = await world.run(second.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['other/e.ts', 'src/d.ts']]);
  assert.equal(third.outcome.stats.fixedFindings, 2);
  assert.deepEqual(shape(third.outcome.eslint), shape((await world.full()).eslint));
});

test('adding a path resolves the side again: a file that now resolves to the new module is judged again', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/m/index.ts', 'export const m = 1;\n');
  world.write('src/u.ts', "import { m } from './m';\nexport const u = m;\n");
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/m.ts', 'export const m = "BAD";\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.ok(world.eslintCalls[0]?.includes('src/u.ts'));
  assert.equal(second.outcome.stats.reused > 0, true);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
  // removing it again resolves back
  world.eslintCalls.length = 0;
  world.remove('src/m.ts');
  const third = await world.run(second.written as CacheRecord[]);
  assert.ok(world.eslintCalls[0]?.includes('src/u.ts'));
  assert.deepEqual(shape(third.outcome.eslint), shape((await world.full()).eslint));
});

test('a removed file judges the files that imported it, from the recorded graph', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.remove('src/c.ts');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['src/a.ts', 'src/b.ts']]);
  assert.equal(second.written?.some((record) => record.path === 'src/c.ts'), false);
});

test('a change to a file that declares globals judges the whole side', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/globals.d.ts', 'declare const FLAG: number;\n');
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/globals.d.ts', 'declare const FLAG: string;\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [null]);
  assert.equal(second.outcome.stats.mode, 'full');
  assert.match(second.outcome.stats.reason, /declares globals/);
  // a module with `declare global` counts too
  world.write('src/aug.ts', "export {};\ndeclare global { interface Window { x: number } }\n");
  const third = await world.run(second.written as CacheRecord[]);
  world.eslintCalls.length = 0;
  world.write('src/aug.ts', "export {};\ndeclare global { interface Window { y: number } }\n");
  const fourth = await world.run(third.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [null]);
  assert.match(fourth.outcome.stats.reason, /src\/aug\.ts declares globals/);
});

test('a file read beside the linted file is a declared input: its change judges the files that declare it', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/notes.txt', 'fine\n');
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/notes.txt', 'NO\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']]);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint));
  // an added listing entry counts as well
  world.eslintCalls.length = 0;
  world.write('other/more.txt', 'NO\n');
  const third = await world.run(second.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, [['other/e.ts']]);
  assert.deepEqual(shape(third.outcome.eslint), shape((await world.full()).eslint));
});

test('a canon without the crossFileInputs declaration makes every change a whole-side lint; so does one without projectGraph', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/d.ts', 'export const d = 4;\n');
  const second = await world.run(first.written as CacheRecord[], { canon: world.canon({ crossFileInputs: null }) });
  assert.deepEqual(world.eslintCalls, [null]);
  assert.match(second.outcome.stats.reason, /declares no crossFileInputs/);
  world.eslintCalls.length = 0;
  world.write('src/d.ts', 'export const d = 5;\n');
  const third = await world.run(first.written as CacheRecord[], { canon: world.canon({ projectGraph: null }) });
  assert.deepEqual(world.eslintCalls, [null]);
  assert.match(third.outcome.stats.reason, /exports no projectGraph/);
});

test('a change outside every lint scope judges nothing, and a cache of another side key is not trusted past its hashes', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('README.md', 'one\n');
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('README.md', 'two\n');
  const second = await world.run(first.written as CacheRecord[]);
  assert.deepEqual(world.eslintCalls, []);
  assert.equal(second.outcome.stats.checked, 0);
  assert.ok(second.written, 'the new side key is stored');
  assert.equal(second.written?.find((record) => record.step === 'meta')?.hash === first.written?.find((record) => record.step === 'meta')?.hash, false);
});

test('a record whose file differs is judged for real, and a record outside the scope is dropped', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  const tampered = (first.written as CacheRecord[]).map((record) => (record.step === 'eslint' && record.path === 'src/d.ts' ? { ...record, hash: 'f'.repeat(64) } : record));
  world.eslintCalls.length = 0;
  const second = await world.run(tampered);
  assert.deepEqual(world.eslintCalls, [['src/d.ts']]);
  world.remove('src/d.ts');
  const third = await world.run(second.written as CacheRecord[]);
  assert.equal(third.written?.some((record) => record.path === 'src/d.ts'), false);
});

test('--full ignores the records and rewrites them', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  const second = await world.run(first.written as CacheRecord[], { full: '--full' });
  assert.deepEqual(world.eslintCalls, [null]);
  assert.equal(second.outcome.stats.mode, 'full');
  assert.equal(second.outcome.stats.reason, '--full');
  assert.ok(second.written);
});

test('a partial (workspace) run reads the records, reports only its files and writes nothing', async (context) => {
  const world = new World(context);
  seed(world);
  const first = await world.run([]);
  world.eslintCalls.length = 0;
  world.write('src/c.ts', 'export const c = "BAD";\n');
  const second = await world.run(first.written as CacheRecord[], { write: false, report: (file) => file.startsWith('src/') });
  assert.deepEqual(world.eslintCalls, [['src/a.ts', 'src/b.ts', 'src/c.ts']]);
  assert.equal(second.written, undefined);
  assert.deepEqual(shape(second.outcome.eslint), shape((await world.full()).eslint.filter((result) => result.filePath.includes(`${path.sep}src${path.sep}`))));
  const outside = await world.run(first.written as CacheRecord[], { report: (file) => file.startsWith('other/') });
  assert.equal(outside.written, undefined, 'a run that reports part of a side never writes');
});

test('a file edited while the linter ran gets no record: nothing is stored', async (context) => {
  const world = new World(context);
  seed(world);
  world.onLint = () => world.write('src/d.ts', 'export const d = "edited during the run";\n');
  const first = await world.run([]);
  assert.equal(first.written, undefined);
});

test('a linter that cannot complete stores nothing and reports its error', async (context) => {
  const world = new World(context);
  seed(world);
  const session = createFakeSession({ files: Object.fromEntries(world.walk().map((file) => [`${SIDE}/${file}`, world.text(file)])) });
  const outcome = await lintSide({
    session, side: SIDE, sideRoot: world.root, scope: world.scope, stylesheets: [], report: null, canons: [world.canon()], styleCanon: null,
    typescript: () => ts, extraKey: '', full: null, write: true,
    eslint: async () => ({ results: [], errors: ['eslint could not complete'] }), stylelint: null,
  });
  assert.deepEqual(outcome.errors, ['eslint could not complete']);
  assert.equal(session.replaced.size, 0);
});

test('stylelint: an unchanged stylesheet is reused, a changed one judged, and the stylesheet set changing judges them all', async (context) => {
  const world = new World(context);
  seed(world);
  world.write('src/one.css', 'a { color: red; }\n');
  world.write('src/two.css', 'b { color: blue; }\n');
  const first = await world.run([], { style: true });
  world.styleCalls.length = 0;
  world.write('src/two.css', 'b { color: blue !important; }\n');
  const second = await world.run(first.written as CacheRecord[], { style: true });
  assert.deepEqual(world.styleCalls, [['src/two.css']]);
  assert.equal(second.outcome.stylelint.length, 2);
  assert.equal(second.outcome.stylelint.find((result) => result.source.endsWith('two.css'))?.warnings.length, 1);
  assert.equal(second.outcome.stylelint.find((result) => result.source.endsWith('one.css'))?.warnings.length, 0);
  world.styleCalls.length = 0;
  world.write('src/three.css', 'c { color: green; }\n');
  const third = await world.run(second.written as CacheRecord[], { style: true });
  assert.deepEqual(world.styleCalls, [['src/one.css', 'src/three.css', 'src/two.css']]);
  // a globals.css is a declared input of every stylesheet
  world.styleCalls.length = 0;
  world.write('src/globals.css', ':root { --x: 1; }\n');
  const fourth = await world.run(third.written as CacheRecord[], { style: true });
  assert.equal(world.styleCalls[0]?.length, 4);
  world.styleCalls.length = 0;
  world.write('src/globals.css', ':root { --x: 2; }\n');
  const fifth = await world.run(fourth.written as CacheRecord[], { style: true });
  assert.equal(world.styleCalls[0]?.length, 4);
  void fifth;
});

test('the records are byte-stable: two runs over one tree write the same records', async (context) => {
  const world = new World(context);
  seed(world);
  const one = await world.run([]);
  const two = await world.run([], { full: 'again' });
  assert.deepEqual(one.written, two.written);
});
