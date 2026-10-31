// The `--test` family of the app check cache: a spec re-runs when its closure changes and only then, the merged total equals a full run's, a failed spec is never
// stored, the per-file threshold is judged on the merged total, and the closure key comes from Jest's own resolver (the e2e test at the end runs a real Jest).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createFakeSession } from '../cache/fake-session.mjs';
import { hashText } from '../cache/hash.mjs';
import { serializeRecords, parseRecords } from '../cache/jsonl.mjs';
import { ALWAYS_FULL_PROJECTS, TEST_FOLDER, SPEC_STEP, createJestEnvironment, installedSpecMerge, runTestFamily, shardArgs, snapshotOf, sourcesOf, specKey } from '../cache/test-family.mjs';
import type { JestEnvironment, JudgeCoverage, MergeSpecRecords, SourceItems, SpecCoverageOutput, TestFamilyResult } from '../cache/test-family.mjs';
import type { CacheRecord } from '../cache/types.mjs';

/** A source of `lines` statements; `covered` of them covered by the spec that reports it. */
const source = (lines: number, covered: readonly number[]): SourceItems => ({
  s: Array.from({ length: lines }, (_, index) => [index + 1, 0, index + 1, 10, covered.includes(index + 1) ? 1 : 0]),
  f: [],
  b: [],
});

interface World {
  files: Record<string, string>;
  /** spec -> the closure Jest's resolver would answer. */
  closures: Record<string, string[]>;
  /** spec -> what the spec covers (source relative to the Jest root -> covered lines of `lines`); a spec in `failing` fails. */
  covers: Record<string, Record<string, { lines: number; covered: number[] }>>;
  failing: Set<string>;
  ran: string[][];
  /** Runs while the specs run (an edit made during the run). */
  duringRun?: (session: ReturnType<typeof createFakeSession>) => void;
}

const world = (): World => ({
  files: {
    'be/src/a.service.ts': 'export const a = 1;\n',
    'be/src/b.service.ts': 'export const b = 1;\n',
    'be/src/a.service.spec.ts': 'test("a", () => {});\n',
    'be/src/b.service.spec.ts': 'test("b", () => {});\n',
    'be/jest.config.js': 'module.exports = {};\n',
  },
  closures: { 'be/src/a.service.spec.ts': ['be/src/a.service.ts'], 'be/src/b.service.spec.ts': ['be/src/b.service.ts', 'be/src/a.service.ts'] },
  covers: {
    'be/src/a.service.spec.ts': { 'src/a.service.ts': { lines: 4, covered: [1, 2] } },
    'be/src/b.service.spec.ts': { 'src/a.service.ts': { lines: 4, covered: [3, 4] }, 'src/b.service.ts': { lines: 2, covered: [1, 2] } },
  },
  failing: new Set(),
  ran: [],
});

/** A Jest double over a world: the closures it is told, a run that reports each spec's coverage, and the config digest. */
function fakeJest(w: World, configHash = 'config-1', onRun: () => void = () => undefined): JestEnvironment & { outputs: Map<string, SpecCoverageOutput> } {
  const outputs = new Map<string, SpecCoverageOutput>();
  return {
    specs: Object.keys(w.closures).sort(),
    closureOf: (spec) => w.closures[spec] ?? [],
    configHash,
    outputs,
    run(specs, dir) {
      w.ran.push([...specs]);
      onRun();
      fs.mkdirSync(dir, { recursive: true });
      for (const spec of specs) {
        const rel = spec.replace(/^be\//u, '');
        const passed = !w.failing.has(spec);
        const sources = passed ? Object.fromEntries(Object.entries(w.covers[spec] ?? {}).map(([name, { lines, covered }]) => [name, source(lines, covered)])) : {};
        fs.writeFileSync(path.join(dir, `${hashText(rel).slice(0, 12)}.json`), JSON.stringify({ spec: rel, passed, sources }));
      }
      return { status: specs.some((spec) => w.failing.has(spec)) ? 1 : 0, output: specs.map((spec) => (w.failing.has(spec) ? `FAIL ${spec}` : `PASS ${spec}`)).join('\n') };
    },
    readCoverage(dir) {
      return fs.readdirSync(dir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as SpecCoverageOutput);
    },
  };
}

/** A merge that unions the flags per statement and writes an lcov (LF/LH per source) the judge below reads; it keeps what it was given. */
function fakeMerge(): MergeSpecRecords & { merged: Array<Record<string, SourceItems>> } {
  const merge = ((records, { outDir }) => {
    merge.merged = records.map((record) => ({ ...record }));
    const covered = new Map<string, Map<string, number>>();
    for (const record of records) {
      for (const [name, items] of Object.entries(record)) {
        const lines = covered.get(name) ?? new Map<string, number>();
        for (const item of items.s as number[][]) {
          const key = `${item[0]}`;
          lines.set(key, Math.max(lines.get(key) ?? 0, item[4] ?? 0));
        }
        covered.set(name, lines);
      }
    }
    fs.mkdirSync(outDir, { recursive: true });
    const text = [...covered].map(([name, lines]) => `SF:${name}\nLF:${lines.size}\nLH:${[...lines.values()].filter((flag) => flag === 1).length}\nend_of_record\n`).join('');
    fs.writeFileSync(path.join(outDir, 'lcov.info'), text);
  }) as MergeSpecRecords & { merged: Array<Record<string, SourceItems>> };
  merge.merged = [];
  return merge;
}

/** The per-file threshold of R273 over the fake lcov: every source at 100 lines. */
const judge: JudgeCoverage & { seen: string[] } = Object.assign((lcov: string) => {
  judge.seen.push(lcov);
  const findings = fs.readFileSync(lcov, 'utf8').split('end_of_record\n').filter(Boolean).flatMap((block) => {
    const name = /SF:(.*)/u.exec(block)?.[1] ?? '';
    const lf = Number(/LF:(\d+)/u.exec(block)?.[1]);
    const lh = Number(/LH:(\d+)/u.exec(block)?.[1]);
    return lh < lf ? [{ code: 'BE_COVERAGE_BELOW', path: name, message: `lines ${lh}/${lf}` }] : [];
  });
  return { ok: findings.length === 0, findings };
}, { seen: [] as string[] });

interface Run { session: ReturnType<typeof createFakeSession>; result: TestFamilyResult; merge: ReturnType<typeof fakeMerge> }

function runOnce(w: World, stored: readonly CacheRecord[], options: { mode?: 'full' | 'diff'; configHash?: string; root?: string } = {}): Run {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-test-'));
  const session = createFakeSession({ files: w.files, records: { [TEST_FOLDER]: stored }, mode: options.mode ?? 'diff' });
  const merge = fakeMerge();
  const jest = fakeJest(w, options.configHash, () => w.duringRun?.(session));
  const result = runTestFamily({ session: { ...session, root }, jest, side: 'be', merge, judge, scratch: fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-scratch-')) });
  return { session, result, merge };
}

const stored = (run: Run): CacheRecord[] => [...(run.session.replaced.get(TEST_FOLDER) ?? [])];

test('the first run runs every spec and stores one record per spec under its closure key; the total is judged once', () => {
  const w = world();
  const run = runOnce(w, []);
  assert.deepEqual(w.ran, [['be/src/a.service.spec.ts', 'be/src/b.service.spec.ts']]);
  assert.deepEqual(stored(run).map((record) => [record.path, record.step]), [['be/src/a.service.spec.ts', SPEC_STEP], ['be/src/b.service.spec.ts', SPEC_STEP]]);
  assert.deepEqual(Object.keys(sourcesOf(stored(run)[1] as CacheRecord)), ['be/src/a.service.ts', 'be/src/b.service.ts']);
  assert.equal(run.result.ok, true, JSON.stringify(run.result.threshold));
  assert.deepEqual(run.result.threshold?.findings, []);
  assert.equal(run.session.reports[0]?.checked, 2);
  assert.equal(run.session.reports[0]?.reused, 0);
});

test('a warm run with nothing changed runs no spec and reuses every record; the bytes it writes are the first run\'s', () => {
  const w = world();
  const first = runOnce(w, []);
  w.ran = [];
  const warm = runOnce(w, stored(first));
  assert.deepEqual(w.ran, []);
  assert.equal(warm.session.reports[0]?.reused, 2);
  assert.equal(warm.session.reports[0]?.checked, 0);
  assert.equal(serializeRecords(stored(warm)), serializeRecords(stored(first)));
  assert.deepEqual(parseRecords(serializeRecords(stored(first))).records, stored(first));
  assert.equal(warm.result.ok, true);
});

test('a spec re-runs when a file of its closure changes, and only the specs whose closure holds it', () => {
  const w = world();
  const first = runOnce(w, []);
  w.ran = [];
  w.files['be/src/b.service.ts'] = 'export const b = 2;\n';
  const second = runOnce(w, stored(first));
  assert.deepEqual(w.ran, [['be/src/b.service.spec.ts']]);
  assert.deepEqual(second.result.reused, ['be/src/a.service.spec.ts']);
  w.ran = [];
  w.files['be/src/a.service.ts'] = 'export const a = 2;\n';
  runOnce(w, stored(second));
  assert.deepEqual(w.ran, [['be/src/a.service.spec.ts', 'be/src/b.service.spec.ts']], 'a.service is in both closures');
});

test('the snapshot file, the project configuration and a deleted dependency all change the key', () => {
  const w = world();
  const hashOf = (file: string): string | undefined => (w.files[file] === undefined ? undefined : hashText(w.files[file]));
  const keyOf = (configHash = 'config-1'): string => specKey({ spec: 'be/src/a.service.spec.ts', closure: w.closures['be/src/a.service.spec.ts'] ?? [], configHash, hashOf });
  const base = keyOf();
  assert.equal(keyOf(), base);
  assert.notEqual(keyOf('config-2'), base);
  w.files[snapshotOf('be/src/a.service.spec.ts')] = 'exports[`a`] = 1;\n';
  const withSnapshot = keyOf();
  assert.notEqual(withSnapshot, base);
  delete w.files['be/src/a.service.ts'];
  assert.notEqual(keyOf(), withSnapshot);
  assert.equal(snapshotOf('be/src/a.service.spec.ts'), 'be/src/__snapshots__/a.service.spec.ts.snap');
});

test('a CRLF checkout and an LF checkout give one key', () => {
  const w = world();
  const lf = specKey({ spec: 'be/src/a.service.spec.ts', closure: ['be/src/a.service.ts'], configHash: 'c', hashOf: (file) => (w.files[file] === undefined ? undefined : hashText(w.files[file])) });
  const crlf = specKey({ spec: 'be/src/a.service.spec.ts', closure: ['be/src/a.service.ts'], configHash: 'c', hashOf: (file) => (w.files[file] === undefined ? undefined : hashText(w.files[file].replace(/\n/gu, '\r\n'))) });
  assert.equal(crlf, lf);
});

test('a configuration change re-runs every spec', () => {
  const w = world();
  const first = runOnce(w, []);
  w.ran = [];
  runOnce(w, stored(first), { configHash: 'config-2' });
  assert.deepEqual(w.ran, [['be/src/a.service.spec.ts', 'be/src/b.service.spec.ts']]);
});

test('the merged total equals the full run\'s, whichever specs were run now and whichever were kept', () => {
  const w = world();
  const full = runOnce(w, []);
  const fullMerged = full.merge.merged;
  w.ran = [];
  w.files['be/src/b.service.ts'] = 'export const b = 3;\n';
  const warm = runOnce(w, stored(full));
  assert.deepEqual(w.ran, [['be/src/b.service.spec.ts']]);
  const normalise = (merged: Array<Record<string, SourceItems>>): unknown => JSON.stringify(merged.map((record) => Object.keys(record).sort()).sort());
  assert.equal(normalise(warm.merge.merged), normalise(fullMerged));
  assert.equal(fs.readFileSync(warm.result.lcov as string, 'utf8'), fs.readFileSync(full.result.lcov as string, 'utf8'));
});

test('the threshold is judged on the merged total: a file no single spec covers in full passes when the specs together do', () => {
  const w = world();
  const run = runOnce(w, []);
  const lcov = fs.readFileSync(run.result.lcov as string, 'utf8');
  assert.match(lcov, /SF:be\/src\/a\.service\.ts\nLF:4\nLH:4/u, 'a.service is covered 2+2 lines by two specs, 4 of 4 together');
  assert.equal(run.result.threshold?.ok, true);
  // The same file with a line neither spec reaches is below the threshold, and the finding names it.
  const w2 = world();
  w2.covers['be/src/b.service.spec.ts'] = { 'src/a.service.ts': { lines: 4, covered: [3] }, 'src/b.service.ts': { lines: 2, covered: [1, 2] } };
  const below = runOnce(w2, []);
  assert.equal(below.result.ok, false);
  assert.deepEqual(below.result.threshold?.findings.map((finding) => [finding.code, finding.path]), [['BE_COVERAGE_BELOW', 'be/src/a.service.ts']]);
  assert.equal(below.session.reports[0]?.newFindings, 1);
});

test('a failed spec is never stored; the others are, and the threshold waits for a total with every spec', () => {
  const w = world();
  w.failing.add('be/src/b.service.spec.ts');
  judge.seen.length = 0;
  const run = runOnce(w, []);
  assert.deepEqual(run.result.failed, ['be/src/b.service.spec.ts']);
  assert.deepEqual(stored(run).map((record) => record.path), ['be/src/a.service.spec.ts']);
  assert.equal(run.result.ok, false);
  assert.equal(run.result.threshold, undefined);
  assert.deepEqual(judge.seen, []);
  assert.match(run.result.output, /FAIL be\/src\/b\.service\.spec\.ts/u);
  // Fixed, it runs again on the next run (it has no record) and the other keeps its own.
  w.failing.clear();
  w.ran = [];
  const next = runOnce(w, stored(run));
  assert.deepEqual(w.ran, [['be/src/b.service.spec.ts']]);
  assert.equal(next.result.ok, true);
});

test('a spec that fails after it once passed loses its record', () => {
  const w = world();
  const first = runOnce(w, []);
  w.files['be/src/a.service.ts'] = 'export const a = "broken";\n';
  w.failing.add('be/src/a.service.spec.ts');
  const second = runOnce(w, stored(first));
  // a.service.ts is in both closures: both specs ran, b passed and is stored under its new key, a failed and has no record at all.
  assert.deepEqual(stored(second).map((record) => record.path), ['be/src/b.service.spec.ts']);
  assert.deepEqual(second.result.failed, ['be/src/a.service.spec.ts']);
});

test('a spec that did not report, and a file edited while the specs ran, are not stored', () => {
  const w = world();
  w.duringRun = (session) => { session.setFile('be/src/a.service.ts', 'export const a = "edited during the run";\n'); };
  const run = runOnce(w, []);
  // `a.service.ts` is in both closures, so neither spec's key survived the edit.
  assert.deepEqual(stored(run), []);
  assert.deepEqual([...run.result.failed].sort(), ['be/src/a.service.spec.ts', 'be/src/b.service.spec.ts']);
});

test('--full runs every spec and ignores the records; a deleted spec drops its record', () => {
  const w = world();
  const first = runOnce(w, []);
  w.ran = [];
  const full = runOnce(w, stored(first), { mode: 'full' });
  assert.deepEqual(w.ran, [['be/src/a.service.spec.ts', 'be/src/b.service.spec.ts']]);
  assert.equal(full.session.reports[0]?.mode, 'full');
  w.closures = { 'be/src/a.service.spec.ts': ['be/src/a.service.ts'] };
  w.ran = [];
  const shrunk = runOnce(w, stored(full));
  assert.deepEqual(stored(shrunk).map((record) => record.path), ['be/src/a.service.spec.ts']);
  assert.deepEqual(w.ran, []);
});

test('the integration, e2e and contract projects are never the cache\'s, and a shard records nothing', () => {
  assert.deepEqual([...ALWAYS_FULL_PROJECTS], ['integration', 'e2e', 'contract']);
  assert.deepEqual(shardArgs(2, 5), { args: ['--shard=2/5', '--coverage', '--ci', '--selectProjects', 'unit'], env: { STARCI_COVERAGE_SHARD: '1' } });
  assert.throws(() => shardArgs(0, 3), /--shard needs/u);
  assert.throws(() => shardArgs(4, 3), /--shard needs/u);
});

// ---- the real Jest ---------------------------------------------------------------------------------------------------------------------------------------

const presetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'jest-preset');
const presetBuilt = fs.existsSync(path.join(presetRoot, 'dist', 'spec-coverage.js')) && fs.existsSync(path.join(presetRoot, 'node_modules', 'jest'));

const SOURCES: Record<string, string> = {
  'be/src/modules/domain/alpha/alpha.service.ts': 'export class AlphaService {\n  pick(value: number): string {\n    if (value > 0) return "positive";\n    return value < 0 ? "negative" : "zero";\n  }\n}\n',
  'be/src/modules/domain/alpha/alpha.service.spec.ts': 'import { AlphaService } from "./alpha.service";\ntest("pick", () => {\n  const alpha = new AlphaService();\n  expect([alpha.pick(1), alpha.pick(-1), alpha.pick(0)]).toEqual(["positive", "negative", "zero"]);\n});\n',
  'be/src/modules/domain/beta/beta.service.ts': 'import { AlphaService } from "@modules/domain/alpha/alpha.service";\nexport class BetaService {\n  private readonly alpha = new AlphaService();\n  run(flag: boolean): string {\n    return flag ? this.alpha.pick(1) : "off";\n  }\n}\n',
  'be/src/modules/domain/beta/beta.service.spec.ts': 'import { BetaService } from "./beta.service";\ntest("run", () => {\n  const beta = new BetaService();\n  expect([beta.run(true), beta.run(false)]).toEqual(["positive", "off"]);\n});\n',
  'be/src/modules/domain/gamma/gamma.service.ts': 'export class GammaService {\n  id(): string {\n    return "gamma";\n  }\n}\n',
  'be/src/modules/domain/gamma/gamma.service.spec.ts': 'import { GammaService } from "./gamma.service";\ntest("id", () => expect(new GammaService().id()).toBe("gamma"));\n',
  'be/src/tests/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'es2022', isolatedModules: true } }),
  'hfs.json': JSON.stringify({ edition: 'lite' }),
};
const SCOPE = { coverage: { roots: ['src/modules/domain/*/'], roles: ['service'], excludes: [] } };

function realApp(): string {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-real-'));
  for (const [file, text] of Object.entries(SOURCES)) {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), text);
  }
  fs.mkdirSync(path.join(app, 'be', 'apps'), { recursive: true });
  fs.writeFileSync(path.join(app, 'be', 'jest.config.js'), `const config = require(${JSON.stringify(path.join(presetRoot, 'dist', 'index.js'))}).starciJestConfig(${JSON.stringify(SCOPE)})
for (const project of config.projects) {
  delete project.preset
  for (const entry of Object.values(project.transform)) entry[0] = require.resolve(entry[0], { paths: [${JSON.stringify(path.join(presetRoot, 'node_modules'))}] })
}
module.exports = config
`);
  return app;
}

/** The unsharded unit run of the same app, for its lcov. */
function fullRunLcov(app: string): string {
  const jestBin = path.join(presetRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const result = spawnSync(process.execPath, [jestBin, '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--coverageThreshold={}', '--coverageDirectory', path.join(app, 'be', 'coverage-whole')], { cwd: path.join(app, 'be'), encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(presetRoot, 'node_modules') } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return fs.readFileSync(path.join(app, 'be', 'coverage-whole', 'lcov.info'), 'utf8');
}

function totalsOf(lcov: string): Record<string, string> {
  return Object.fromEntries(lcov.split('end_of_record').filter((block) => block.includes('SF:')).map((block) => {
    const name = /SF:(.*)/u.exec(block)?.[1]?.trim().replaceAll('\\', '/') ?? '';
    return [name, ['LF', 'LH', 'FNF', 'FNH', 'BRF', 'BRH'].map((tag) => `${tag}=${new RegExp(`^${tag}:(\\d+)`, 'mu').exec(block)?.[1]}`).join(' ')];
  }));
}

test('with a real Jest: closures come from its resolver and mapper, warm runs re-run only the changed closure, and the merged total equals the full run', { skip: presetBuilt ? false : 'jest-preset is not built or installed' }, async () => {
  const app = realApp();
  try {
    const env = await createJestEnvironment({ appRoot: app, side: 'be', jestFrom: path.join(presetRoot, 'package.json') });
    assert.deepEqual(env.specs, ['alpha', 'beta', 'gamma'].map((name) => `be/src/modules/domain/${name}/${name}.service.spec.ts`));
    // beta imports alpha through the @modules alias of the project's moduleNameMapper: alpha is in beta's closure.
    assert.ok(env.closureOf(env.specs[1] as string).includes('be/src/modules/domain/alpha/alpha.service.ts'));
    assert.ok(!env.closureOf(env.specs[2] as string).some((file) => file.includes('alpha')));
    assert.ok(env.closureOf(env.specs[0] as string).includes('be/src/modules/domain/alpha/alpha.service.spec.ts') === false);
    assert.ok(env.closureOf(env.specs[0] as string).some((file) => file.endsWith('matchers.js')), 'the setup file of the unit project is in every closure');
    assert.ok(env.closureOf(env.specs[0] as string).every((file) => !file.includes('node_modules')));
    assert.match(env.configHash, /^[0-9a-f]{64}$/u);

    const files = (): Record<string, string> => Object.fromEntries(Object.entries(SOURCES).map(([file]) => [file, fs.readFileSync(path.join(app, file), 'utf8')]));
    const merge = installedSpecMerge(app, path.join(presetRoot, 'package.json'));
    const proof: JudgeCoverage = (lcov) => {
      const bad = Object.entries(totalsOf(fs.readFileSync(lcov, 'utf8'))).filter(([, line]) => /LF=(\d+) LH=(?!\1\b)/u.test(line));
      return { ok: bad.length === 0, findings: bad.map(([name, line]) => ({ code: 'BE_COVERAGE_BELOW', path: name, message: line })) };
    };
    const runReal = (records: readonly CacheRecord[]): Run['session'] & { result: TestFamilyResult } => {
      const session = createFakeSession({ files: files(), records: { [TEST_FOLDER]: records } });
      const result = runTestFamily({ session: { ...session, root: app }, jest: env, side: 'be', merge, judge: proof });
      return Object.assign(session, { result });
    };

    const first = runReal([]);
    assert.deepEqual(first.result.failed, []);
    assert.deepEqual(first.result.ran, env.specs);
    const whole = totalsOf(fullRunLcov(app));
    const merged = totalsOf(fs.readFileSync(first.result.lcov as string, 'utf8'));
    assert.deepEqual(merged, whole, 'the merged total of the per-spec records equals the unsharded run, per file');
    assert.equal(first.result.threshold?.ok, true, JSON.stringify(first.result.threshold));

    const records = first.replaced.get(TEST_FOLDER) ?? [];
    const warm = runReal(records);
    assert.deepEqual(warm.result.ran, []);
    assert.deepEqual(totalsOf(fs.readFileSync(warm.result.lcov as string, 'utf8')), whole);

    // Touch alpha's source (a comment): alpha's and beta's specs re-run, gamma's does not.
    fs.appendFileSync(path.join(app, 'be/src/modules/domain/alpha/alpha.service.ts'), '// touched\n');
    const touched = runReal(records);
    assert.deepEqual(touched.result.ran, env.specs.slice(0, 2));
    assert.deepEqual(touched.result.reused, [env.specs[2]]);
    assert.deepEqual(totalsOf(fs.readFileSync(touched.result.lcov as string, 'utf8')), totalsOf(fullRunLcov(app)), 'the partial run merged with the kept records equals a full run of the touched tree');

    // A spec that fails stores nothing and the total is not judged.
    fs.writeFileSync(path.join(app, 'be/src/modules/domain/gamma/gamma.service.spec.ts'), 'import { GammaService } from "./gamma.service";\ntest("id", () => expect(new GammaService().id()).toBe("other"));\n');
    const broken = runReal(records);
    assert.deepEqual(broken.result.failed, [env.specs[2]]);
    assert.ok(!(broken.replaced.get(TEST_FOLDER) ?? []).some((record) => record.path === env.specs[2]));
    assert.equal(broken.result.threshold, undefined);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
  }
});

test('the installed preset merge names the package when it is missing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'check-cache-nopreset-'));
  try {
    const merge = installedSpecMerge(empty);
    assert.throws(() => merge([], { outDir: path.join(empty, 'out'), reportRoot: empty, recordRoot: empty }), /@starci\/jest-preset\/spec-coverage is not installed/u);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
