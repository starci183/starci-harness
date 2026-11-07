// The journal of the app check cache (contexts/project/check-cache.md, "The journal"): what a family judges is appended while it runs, so a run killed at any moment keeps
// it, and the next run reads it back like records when its fingerprint and content key still match. A torn last line is dropped, writers never share a file, a run that
// ends compacts the journal into the committed files byte for byte as a run without one, and CI neither writes nor reads a journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createFakeSession } from '../cache/fake-session.mjs';
import { createSink, journaledRaw, journaledRecords, journalFolders, writeAtomic } from '../cache/journal.mjs';
import { createDiskSession } from '../cache/session.mjs';
import { silentProgress } from '../cache/progress.mjs';
import { hashText } from '../cache/hash.mjs';
import { recordLine } from '../cache/jsonl.mjs';
import { lintSide, type CanonDeclarations, type EslintResult } from '../cache/lint-family.mjs';
import { runTestFamily, TEST_FOLDER, type JestEnvironment, type SpecCoverageOutput } from '../cache/test-family.mjs';
import { readCacheDir } from '../cache/trust.mjs';
import type { CacheRecord, FingerprintPart } from '../cache/types.mjs';

const parts = (prettier: string): FingerprintPart[] => [{ name: 'cache-format', sha256: 'f1' }, { name: 'file:.prettierrc', sha256: prettier }];
const fingerprint = (prettier = 'p1') => ({ parts: parts(prettier), portable: true, localReasons: [] });
const rec = (file: string, text: string, step = 'prettier', findings: CacheRecord['findings'] = []): CacheRecord => ({ path: file, step, hash: hashText(text), findings });

/** A work tree on disk and a journal folder beside it, both removed at the end of the test. */
function world(t: test.TestContext, files: Record<string, string> = { 'a.ts': 'x\n', 'b.ts': 'y\n' }): { root: string; journal: string; open: (extra?: object) => ReturnType<typeof createDiskSession> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-journal-root-'));
  const journal = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-journal-dir-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(journal, { recursive: true, force: true });
  });
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const open = (extra: object = {}): ReturnType<typeof createDiskSession> => createDiskSession({ root, tracked: Object.keys(files), env: {}, progress: silentProgress, fingerprint: fingerprint(), journalRoot: journal, ...extra });
  return { root, journal, open };
}

test('a torn last line, a foreign fingerprint and a damaged header are never read; the lines before the tear stand', (t) => {
  const { journal } = world(t);
  const dir = path.join(journal, 'check', 'format');
  const sink = createSink(path.join(dir, 'run1-inc.jsonl'), { journal: 1, kind: 'rec', fp: 'fp1', ctx: '' });
  const [one, two] = [rec('a.ts', 'x\n'), rec('b.ts', 'y\n')];
  sink.append([recordLine(one)]);
  sink.append([recordLine(two)]);
  fs.appendFileSync(sink.file, recordLine(rec('c.ts', 'z\n')).slice(0, 20));
  assert.deepEqual(journaledRecords(dir, 'fp1', false).map((record) => record.path), ['a.ts', 'b.ts'], 'the torn third line is dropped');
  assert.deepEqual(journaledRecords(dir, 'fp2', false), [], 'entries written under other fingerprint parts are not read');
  fs.writeFileSync(path.join(dir, 'run0-inc.jsonl'), '{"journal":1,"kind":"re');
  assert.equal(journaledRecords(dir, 'fp1', false).length, 2, 'a file whose header was torn is skipped whole');
  const raw = createSink(path.join(dir, 'run2-raw-x.jsonl'), { journal: 1, kind: 'raw', fp: 'fp1', ctx: 'c1' });
  raw.append(['{"key":"a.ts","messages":[]}']);
  fs.appendFileSync(raw.file, '{"key":"b.ts","mess');
  assert.deepEqual(journaledRaw(dir, 'fp1', 'c1'), [{ key: 'a.ts', messages: [] }]);
  assert.deepEqual(journaledRaw(dir, 'fp1', 'c2'), [], 'another content key is another tree');
});

test('parallel writers append to files of their own, and the reader serves both, later after earlier', (t) => {
  const { journal } = world(t);
  const dir = path.join(journal, 'check', 'types');
  const first = createSink(path.join(dir, 'run1-inc.jsonl'), { journal: 1, kind: 'rec', fp: 'fp', ctx: '' });
  const second = createSink(path.join(dir, 'run2-inc.jsonl'), { journal: 1, kind: 'rec', fp: 'fp', ctx: '' });
  for (let at = 0; at < 20; at += 1) {
    first.append([recordLine(rec(`one-${String(at)}.ts`, `one ${String(at)}`, 'tsc'))]);
    second.append([recordLine(rec(`two-${String(at)}.ts`, `two ${String(at)}`, 'tsc'))]);
  }
  second.append([recordLine({ ...rec('one-3.ts', 'newer', 'tsc') })]);
  const read = journaledRecords(dir, 'fp', false);
  assert.equal(read.length, 41);
  assert.equal(read.filter((record) => record.path.startsWith('one-')).length, 21);
  assert.equal(read.at(-1)?.hash, hashText('newer'), 'the later run is read after the earlier');
  assert.deepEqual(journalFolders(journal), ['check/types']);
});

test('a run killed after a family finished keeps its records: the next plain run is diff against them and the committed folder was never touched', (t) => {
  const { root, open } = world(t);
  const killed = open();
  assert.deepEqual(killed.decide('format'), { mode: 'full', reason: 'no cache in the tree' });
  killed.replace('check/format', [rec('a.ts', 'x\n'), rec('b.ts', 'y\n')], { depth: 3 });
  assert.equal(fs.existsSync(path.join(root, '.starcistacks')), false, 'nothing reached the cache folder before the flush');
  const next = open();
  const decision = next.decide('format');
  assert.equal(decision.mode, 'diff');
  assert.match(decision.reason, /interrupted run/u);
  assert.deepEqual(next.records('check/format').map((record) => record.path), ['a.ts', 'b.ts']);
  assert.equal(next.decide('wiring').mode, 'full', 'a family the killed run never reached still runs in full');
});

test('a run killed in the middle of a family keeps what it had judged, and the half-written line is ignored', (t) => {
  const { open } = world(t);
  const killed = open();
  const journal = killed.journal?.('check/types', 'rec');
  assert.ok(journal !== undefined);
  journal.append([recordLine(rec('be', 'program one', 'tsc'))]);
  journal.append([recordLine(rec('fe/apps/web', 'program two', 'tsc'))]);
  fs.appendFileSync(journal.file, recordLine(rec('packages/x', 'program three', 'tsc')).slice(0, 30));
  const next = open();
  assert.equal(next.decide('types').mode, 'diff');
  assert.deepEqual(next.records('check/types').map((record) => record.path).sort(), ['be', 'fe/apps/web']);
});

test('entries journaled under other fingerprint parts are not served, and a committed cache from other parts is replaced by the entries of the parts now', (t) => {
  const { root, journal, open } = world(t);
  const seed = open({ fingerprint: fingerprint('p1') });
  seed.replace('check/format', [rec('a.ts', 'old\n')], { depth: 3 });
  seed.flush();
  fs.rmSync(journal, { recursive: true, force: true });
  const killed = open({ fingerprint: fingerprint('p2') });
  assert.equal(killed.decide('format').mode, 'full', 'the part the family reads differs: full');
  killed.replace('check/format', [rec('a.ts', 'x\n')], { depth: 3 });
  const rescued = open({ fingerprint: fingerprint('p2') });
  assert.equal(rescued.decide('format').mode, 'diff');
  assert.deepEqual(rescued.records('check/format'), [rec('a.ts', 'x\n')], 'only the entries computed under the parts now: the committed record is of the old parts');
  const stale = open({ fingerprint: fingerprint('p3') });
  assert.equal(stale.decide('format').mode, 'full', 'a third set of parts reads neither');
  assert.ok(fs.existsSync(path.join(root, '.starcistacks/cache/check/format')));
});

test('at the end of a run the journal is compacted into the committed files, byte for byte what a run without one writes, and removed', (t) => {
  const journaled = world(t);
  const plain = world(t);
  const records = [rec('a.ts', 'x\n'), rec('b.ts', 'y\n', 'prettier', [{ path: 'b.ts', line: 1, column: 1, rule: 'HFS_FORMAT', message: 'm' }])];
  const killed = journaled.open();
  killed.journal?.('check/format', 'rec')?.append(records.map(recordLine));
  const finishing = journaled.open();
  finishing.replace('check/format', finishing.records('check/format'), { depth: 3 });
  const flushed = finishing.flush();
  assert.deepEqual(flushed.warnings, []);
  assert.deepEqual(journalFolders(journaled.journal), [], 'the journal of a committed folder is removed');
  const normal = plain.open({ journalRoot: false });
  normal.replace('check/format', records, { depth: 3 });
  normal.flush();
  const files = (root: string): Array<[string, string]> => [...readCacheDir(root)].sort(([a], [b]) => (a < b ? -1 : 1));
  assert.deepEqual(files(journaled.root), files(plain.root));
  assert.equal(files(journaled.root).some(([file]) => file.includes('.tmp-')), false, 'no temp file of the atomic writes is left');
  assert.ok(flushed.written.includes('.starcistacks/cache/fingerprint.jsonl'), 'what the run wrote is still reported, for the cache verdict');
});

test('the files of the cache are written by a temp file and a rename: a kill between them leaves the old file, and the next flush sweeps the temp', (t) => {
  const { root, open } = world(t);
  const target = path.join(root, '.starcistacks/cache/check/format/root.jsonl');
  writeAtomic(target, 'one\n');
  assert.equal(fs.readFileSync(target, 'utf8'), 'one\n');
  fs.writeFileSync(`${target}.tmp-4242`, 'half');
  const session = open({ journalRoot: false });
  session.replace('check/format', [rec('a.ts', 'x\n')], { depth: 3 });
  session.flush();
  assert.equal(fs.existsSync(`${target}.tmp-4242`), false);
});

test('CI neither writes nor reads a journal: only the cache at the trusted base is trusted', (t) => {
  const { journal, open } = world(t);
  const host = open();
  host.replace('check/format', [rec('a.ts', 'x\n')], { depth: 3 });
  assert.equal(journalFolders(journal).length, 1);
  const trust = { kind: 'base' as const, reason: 'the cache at abc', base: 'abc', files: (): ReadonlyMap<string, string> => new Map() };
  const ci = open({ trust, env: { CI: 'true' } });
  assert.equal(ci.journal?.('check/format', 'rec'), undefined, 'no journal is opened');
  assert.deepEqual(ci.journaled?.('check/format', ''), [], 'nothing is read back');
  assert.deepEqual(ci.records('check/format'), [], 'the journaled records are not the base cache');
  assert.equal(ci.decide('format').mode, 'full');
});

test('a forged record that reaches the committed cache through a journal is caught like any forged record: CI recomputes and compares', (t) => {
  const { open } = world(t);
  const host = open();
  const forged = rec('a.ts', 'x\n', 'prettier');
  host.journal?.('check/format', 'rec')?.append([recordLine(forged)]);
  const next = open();
  next.replace('check/format', next.records('check/format'), { depth: 3 });
  next.flush();
  const trust = { kind: 'base' as const, reason: 'the cache at abc', base: 'abc', files: (): ReadonlyMap<string, string> => new Map() };
  const ci = open({ trust, env: { CI: 'true' }, journalRoot: false });
  ci.replace('check/format', [rec('a.ts', 'x\n', 'prettier', [{ path: 'a.ts', line: 1, column: 1, rule: 'HFS_FORMAT', message: 'real finding' }])], { depth: 3 });
  const flushed = ci.flush();
  assert.deepEqual(flushed.written, [], 'CI writes nothing');
  assert.equal(ci.verdicts().some((verdict) => verdict.code === 'HFS_CHECK_CACHE_FORGED'), true, 'the committed record that says clean where the check finds something is forged');
});

// ------------------------------------------------------------------------------------------------ the lint family resumes

const canon: CanonDeclarations = { name: 'fake-canon', crossFileInputs: [], graphRules: false, projectGraph: null };

function side(t: test.TestContext): { root: string; files: string[]; run: (options?: { eslint?: (list: readonly string[] | null, stream?: { file: string }) => Promise<{ results: EslintResult[]; errors: string[] }>; full?: string | null }) => Promise<Awaited<ReturnType<typeof lintSide>>>; session: ReturnType<typeof createFakeSession>; journalDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-journal-lint-'));
  const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-journal-lint-dir-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(journalDir, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler', target: 'es2022', strict: true } }));
  const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'];
  for (const file of files) fs.writeFileSync(path.join(root, file), `export const ${file[0] ?? 'x'} = ${file === 'c.ts' ? 'BAD' : '1'}\n`);
  const tree = Object.fromEntries(files.map((file) => [`be/${file}`, fs.readFileSync(path.join(root, file), 'utf8')]));
  const session = createFakeSession({ files: tree, root });
  const fp = 'lint-fp';
  session.journal = (folder, kind, ctx = '') => createSink(path.join(journalDir, ...folder.split('/'), `run1-${kind}-${hashText(ctx).slice(0, 8)}.jsonl`), { journal: 1, kind, fp, ctx });
  session.journaled = (folder, ctx) => journaledRaw(path.join(journalDir, ...folder.split('/')), fp, ctx);
  const lintOne = (file: string): EslintResult => ({ filePath: path.join(root, file), messages: fs.readFileSync(path.join(root, file), 'utf8').includes('BAD') ? [{ ruleId: 'fake/no-bad', message: `BAD in ${file}`, line: 1, column: 1, severity: 2 }] : [] });
  const run: ReturnType<typeof side>['run'] = (options = {}) => lintSide({
    session, side: 'be', sideRoot: root, scope: files, stylesheets: [], canons: [canon], styleCanon: null, typescript: () => ts, extraKey: '', full: options.full ?? null, write: true,
    eslint: options.eslint ?? (async (list) => ({ results: (list ?? files).map(lintOne), errors: [] })),
    stylelint: null,
  });
  return { root, files, run, session, journalDir };
}

test('a lint run killed at file 4 of 6 keeps the results it had judged: the next run lints only the rest and writes the records a full run writes', async (t) => {
  const world = side(t);
  const lintOne = (file: string): string => JSON.stringify({ key: file, messages: world.files.includes(file) && file === 'c.ts' ? [{ ruleId: 'fake/no-bad', message: 'BAD in c.ts', line: 1, column: 1, severity: 2 }] : [] });
  await assert.rejects(world.run({
    eslint: async (list, stream) => {
      assert.ok(stream !== undefined, 'the family hands the child its journal file');
      // The child judges its list in batches and appends each; it dies after the second batch (4 of 6 files) with a line half written.
      fs.appendFileSync(stream.file, `${(list ?? []).slice(0, 4).map(lintOne).join('\n')}\n{"key":"e.ts","mess`);
      throw new Error('killed');
    },
  }), /killed/u);
  assert.equal(world.session.replaced.size, 0, 'a killed run replaced no record');

  const asked: (readonly string[] | null)[] = [];
  const resumed = await world.run({ eslint: async (list, stream) => { asked.push(list); assert.ok(stream !== undefined); return { results: (list ?? []).map((file) => ({ filePath: path.join(world.root, file), messages: [] })), errors: [] }; } });
  assert.deepEqual(asked, [['e.ts', 'f.ts']], 'only the two files the killed run had not judged are linted');
  assert.deepEqual(resumed.errors, []);
  assert.match(resumed.stats.reason, /4 of them already judged by an interrupted run/u);
  const messages = resumed.eslint.flatMap((result) => result.messages.map((message) => `${path.basename(result.filePath)}: ${message.message}`));
  assert.deepEqual(messages, ['c.ts: BAD in c.ts'], 'the journaled finding is reported as a full run reports it');

  const plain = side(t);
  const full = await plain.run({ full: 'compare' });
  const withoutJournal = (records: readonly CacheRecord[] | undefined): string[] => (records ?? []).map((record) => `${record.path}|${record.step}|${record.hash}|${JSON.stringify(record.findings)}`).sort();
  assert.deepEqual(withoutJournal(world.session.replaced.get('lint/be')), withoutJournal(plain.session.replaced.get('lint/be')), 'the records equal those of a run that was never interrupted');
  assert.equal(resumed.eslint.length, full.eslint.length);
});

test('a lint journal of another tree is not resumed: an edited file changes the content key', async (t) => {
  const world = side(t);
  await assert.rejects(world.run({
    eslint: async (_list, stream) => {
      assert.ok(stream !== undefined);
      fs.appendFileSync(stream.file, '{"key":"a.ts","messages":[]}\n{"key":"b.ts","messages":[]}\n');
      throw new Error('killed');
    },
  }), /killed/u);
  fs.writeFileSync(path.join(world.root, 'f.ts'), 'export const f = 2\n');
  const edited = createFakeSession({ files: Object.fromEntries(world.files.map((file) => [`be/${file}`, fs.readFileSync(path.join(world.root, file), 'utf8')])), root: world.root });
  edited.journal = world.session.journal;
  edited.journaled = world.session.journaled;
  const asked: (readonly string[] | null)[] = [];
  await lintSide({
    session: edited, side: 'be', sideRoot: world.root, scope: world.files, stylesheets: [], canons: [canon], styleCanon: null, typescript: () => ts, extraKey: '', full: null, write: true,
    eslint: async (list) => { asked.push(list); return { results: (list ?? world.files).map((file) => ({ filePath: path.join(world.root, file), messages: [] })), errors: [] }; }, stylelint: null,
  });
  assert.equal(asked.flat().length, 6, 'every file is linted again');
});

// ------------------------------------------------------------------------------------------------ the test family journals each spec

test('a Jest killed after some specs reported keeps their coverage: the next run runs only the specs that had not', async (t) => {
  const files = { 'be/src/a.spec.ts': 'test("a", () => {})\n', 'be/src/b.spec.ts': 'test("b", () => {})\n', 'be/jest.config.js': 'module.exports = {}\n' };
  const { root, open } = world(t, files);
  const items = { s: [[1, 0, 1, 5, 1]], f: [], b: [] };
  const jest = (dying: boolean, ran: string[][]): JestEnvironment => ({
    specs: ['be/src/a.spec.ts', 'be/src/b.spec.ts'],
    closureOf: () => [],
    configHash: 'config',
    async run(specs, dir) {
      ran.push([...specs]);
      fs.mkdirSync(dir, { recursive: true });
      for (const spec of specs) {
        fs.writeFileSync(path.join(dir, `${hashText(spec).slice(0, 8)}.json`), JSON.stringify({ spec: spec.replace(/^be\//u, ''), passed: true, sources: { 'src/x.ts': items } }));
        if (dying) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          throw new Error('killed after the first spec');
        }
      }
      return { status: 0, output: '' };
    },
    readCoverage(dir, skip) {
      return fs.readdirSync(dir).filter((name) => name.endsWith('.json') && skip?.has(name) !== true).map((name): SpecCoverageOutput => ({ file: name, ...(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as SpecCoverageOutput) }));
    },
  });
  const merge = (_records: Iterable<unknown>, { outDir }: { outDir: string }): void => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'lcov.info'), '');
  };
  const judge = (): { ok: boolean; findings: never[] } => ({ ok: true, findings: [] });
  const firstRan: string[][] = [];
  await assert.rejects(runTestFamily({ session: open(), jest: jest(true, firstRan), side: 'be', merge, judge, scratch: path.join(root, '..', `scratch-${String(process.pid)}-a`), drainMs: 20 }), /killed after the first spec/u);
  assert.deepEqual(firstRan, [['be/src/a.spec.ts', 'be/src/b.spec.ts']]);
  assert.equal(fs.existsSync(path.join(root, '.starcistacks')), false, 'the killed run committed nothing');
  const secondRan: string[][] = [];
  const next = open();
  const result = await runTestFamily({ session: next, jest: jest(false, secondRan), side: 'be', merge, judge, scratch: path.join(root, '..', `scratch-${String(process.pid)}-b`), drainMs: 20 });
  assert.deepEqual(result.reused, ['be/src/a.spec.ts'], 'the spec the killed run had journaled is reused');
  assert.deepEqual(secondRan, [['be/src/b.spec.ts']]);
  assert.equal(next.records(TEST_FOLDER).length, 2);
  fs.rmSync(path.join(root, '..', `scratch-${String(process.pid)}-a`), { recursive: true, force: true });
  fs.rmSync(path.join(root, '..', `scratch-${String(process.pid)}-b`), { recursive: true, force: true });
});
