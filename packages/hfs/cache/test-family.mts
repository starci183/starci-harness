// test-family.mts - the `--test` family of the app check cache (contexts/project/check-cache.md, "Unit coverage"). Each unit spec has a closure key: the sha256 of
// the spec, every module Jest's own resolver reaches from it (with the project's moduleNameMapper, jest.mock targets and setup files), its snapshot file and its
// project's configuration. A warm run runs only the specs whose key changed and keeps the records of the rest. The coverage of each spec is stored per source as
// covered or not covered items (never hit counts), a failed spec stores nothing, and the per-file threshold is judged on the merged total of every record, never on
// the partial run Jest itself saw. The lcov written is that merged total, the one Codecov and Sonar read. Integration, e2e and contract specs are not this family's:
// they always run in full (ALWAYS_FULL_PROJECTS).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { combineHashes, hashFile } from './hash.mjs';
import { canonicalJson } from './jsonl.mjs';
import type { CacheRecord, CheckSession, FamilyReport, JsonValue } from './types.mjs';

/** The folder of the session that holds the records of this family. */
export const TEST_FOLDER = 'test-coverage';
/** The step of a unit spec's record. */
export const SPEC_STEP = 'unit-spec';
/** The Jest projects a warm run never skips: they reach services, data and time a key cannot hold. */
export const ALWAYS_FULL_PROJECTS = ['integration', 'e2e', 'contract'] as const;

/** One source's items as the preset's reporter writes them: statements `[sl, sc, el, ec, flag]`, functions `[name, decl, loc, flag]`, branches `[type, loc, [[loc, flag]...]]`. */
export interface SourceItems {
  readonly s: JsonValue;
  readonly f: JsonValue;
  readonly b: JsonValue;
}

/** What the reporter of @starci/jest-preset wrote for one spec (`SpecCoverageFile`), with source paths relative to the Jest root. */
export interface SpecCoverageOutput {
  readonly spec: string;
  readonly passed: boolean;
  readonly sources: Readonly<Record<string, SourceItems>>;
}

/** What a Jest run of some specs came to. */
export interface RunOutcome {
  /** The process exit status (non-zero when any spec failed; the records, not the status, say which). */
  readonly status: number;
  /** Jest's own output, for the diagnosis of a failed spec. */
  readonly output: string;
}

/** What the family needs of Jest: the specs, each spec's closure, the project's configuration, and a way to run specs. All paths are app-relative posix. */
export interface JestEnvironment {
  /** Every unit spec. */
  readonly specs: readonly string[];
  /** Every local module the spec loads, transitively, the setup files of the project included. Never a path under `node_modules`. */
  closureOf(spec: string): readonly string[];
  /** The digest of the unit project's configuration, free of host paths. */
  readonly configHash: string;
  /** Runs `specs` (all of them when `specs` is every spec) writing the per-spec coverage into `coverageDir`. */
  run(specs: readonly string[], coverageDir: string): RunOutcome;
  /** Reads what the reporter wrote into `coverageDir`. */
  readCoverage(coverageDir: string): readonly SpecCoverageOutput[];
}

/** The union of the stored records, written as the lcov and coverage-final.json of the Jest root (`<root>/coverage`). */
export type MergeSpecRecords = (records: ReadonlyArray<Readonly<Record<string, SourceItems>>>, args: { outDir: string; reportRoot: string; recordRoot: string }) => void;
/** The per-file threshold (R273) judged on a report; `starci app check --coverage-from` is this judgement. */
export type JudgeCoverage = (lcov: string) => { readonly ok: boolean; readonly findings: ReadonlyArray<{ readonly code?: string; readonly path?: string; readonly message?: string }> };

export interface TestFamilyOptions {
  readonly session: CheckSession;
  readonly jest: JestEnvironment;
  /** The Jest root, app-relative posix (`be`). Source paths in the records are app-relative, so they carry it. */
  readonly side: string;
  readonly merge: MergeSpecRecords;
  readonly judge: JudgeCoverage;
  /** Where the temporary per-spec coverage goes; defaults to a fresh folder of the OS temp dir. */
  readonly scratch?: string;
}

/** The outcome of the family. `ok` is false when a spec failed or the merged total is below the threshold. */
export interface TestFamilyResult {
  readonly ok: boolean;
  readonly ran: readonly string[];
  readonly reused: readonly string[];
  /** Specs that failed or did not report: nothing of theirs is stored. */
  readonly failed: readonly string[];
  /** The merged lcov, or undefined when no spec has a record. */
  readonly lcov: string | undefined;
  readonly threshold: ReturnType<JudgeCoverage> | undefined;
  readonly report: FamilyReport;
  /** Jest's output of the specs that ran, kept for the diagnosis of failures. */
  readonly output: string;
}

const posix = (file: string): string => file.split(path.sep).join('/');

/** The snapshot file Jest keeps beside a spec. */
export function snapshotOf(spec: string): string {
  return `${path.posix.dirname(spec)}/__snapshots__/${path.posix.basename(spec)}.snap`;
}

/**
 * The closure key of a spec: the spec, each module of its closure and its snapshot by content hash (`absent` for one the work tree lacks, so a deleted dependency
 * changes the key), and the project configuration. The same files give the same key on every host.
 */
export function specKey({ spec, closure, configHash, hashOf }: { spec: string; closure: readonly string[]; configHash: string; hashOf: (file: string) => string | undefined }): string {
  const parts: Record<string, string> = { '#config': configHash };
  for (const file of [spec, snapshotOf(spec), ...closure]) parts[file] = hashOf(file) ?? 'absent';
  return combineHashes(parts);
}

function isSourceItems(value: unknown): value is SourceItems {
  return typeof value === 'object' && value !== null && 's' in value && 'f' in value && 'b' in value;
}

/** The sources a stored record holds (app-relative paths), empty for a record that does not hold any. */
export function sourcesOf(record: CacheRecord): Record<string, SourceItems> {
  const data = record.data;
  const sources = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as { readonly [key: string]: JsonValue })['sources'] : undefined;
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) return {};
  const out: Record<string, SourceItems> = {};
  for (const [source, items] of Object.entries(sources)) if (isSourceItems(items)) out[source] = items;
  return out;
}

function recordOf(spec: string, key: string, sources: Readonly<Record<string, SourceItems>>, side: string): CacheRecord {
  const prefixed: Record<string, SourceItems> = {};
  for (const [source, items] of Object.entries(sources)) prefixed[side === '' || side === '.' ? source : `${side}/${source}`] = items;
  return { path: spec, step: SPEC_STEP, hash: key, findings: [], data: { sources: prefixed as unknown as JsonValue } };
}

/**
 * Runs the unit specs against the cache. Diff mode runs the specs with no current record, full mode all of them; a passing spec's coverage is stored under its key,
 * a failing one's is not, and the folder is replaced with exactly the current specs' records. The merged total is written to `<side>/coverage/lcov.info` and judged.
 */
export function runTestFamily(options: TestFamilyOptions): TestFamilyResult {
  const { session, jest, side, merge, judge } = options;
  const decision = session.decide('test');
  const hashOf = (file: string): string | undefined => session.index.hashOf(file) ?? hashFile(path.join(session.root, file));
  const keys = new Map(jest.specs.map((spec) => [spec, specKey({ spec, closure: jest.closureOf(spec), configHash: jest.configHash, hashOf })]));
  const stored = new Map(session.records(TEST_FOLDER).filter((record) => record.step === SPEC_STEP).map((record) => [record.path, record]));
  const reusable = (spec: string): CacheRecord | undefined => {
    const record = stored.get(spec);
    return decision.mode === 'diff' && record !== undefined && record.hash === keys.get(spec) ? record : undefined;
  };
  const toRun = jest.specs.filter((spec) => reusable(spec) === undefined);
  const kept = jest.specs.flatMap((spec) => reusable(spec) ?? []);

  const progress = session.progress.step('test', 'unit specs', jest.specs.length);
  progress.tick(kept.length, kept.length, 0);
  const fresh: CacheRecord[] = [];
  const failed: string[] = [];
  let output = '';
  if (toRun.length > 0) {
    const scratch = options.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'starci-spec-coverage-'));
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(scratch, { recursive: true });
      output = jest.run(toRun, scratch).output;
      const reported = new Map(jest.readCoverage(scratch).map((file) => [file.spec, file]));
      for (const spec of toRun) {
        const file = reported.get(posix(path.relative(path.join(session.root, side), path.join(session.root, spec))));
        const key = specKey({ spec, closure: jest.closureOf(spec), configHash: jest.configHash, hashOf });
        // A spec that failed, did not report, or whose files changed while it ran stores nothing.
        if (file?.passed === true && key === keys.get(spec)) fresh.push(recordOf(spec, key, file.sources, side));
        else failed.push(spec);
      }
    } finally {
      if (options.scratch === undefined) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  progress.tick(jest.specs.length, kept.length, toRun.length);
  progress.end();

  const records = [...kept, ...fresh];
  session.replace(TEST_FOLDER, records);

  let lcov: string | undefined;
  let threshold: TestFamilyResult['threshold'];
  if (records.length > 0) {
    const rootDir = path.join(session.root, side);
    const outDir = path.join(rootDir, 'coverage');
    merge(records.map(sourcesOf), { outDir, reportRoot: rootDir, recordRoot: session.root });
    lcov = path.join(outDir, 'lcov.info');
    // A failed spec leaves its sources short in the total, so the threshold is judged only when every spec reported.
    if (failed.length === 0) threshold = judge(lcov);
  }
  const thresholdFindings = threshold?.findings.length ?? 0;
  const report: FamilyReport = {
    family: 'test',
    mode: decision.mode,
    reason: decision.reason,
    checked: toRun.length,
    reused: kept.length,
    newFindings: failed.length + thresholdFindings,
    knownFindings: 0,
    fixedFindings: 0,
  };
  session.report(report);
  return { ok: failed.length === 0 && (threshold?.ok ?? records.length === 0), ran: toRun, reused: kept.map((record) => record.path), failed, lcov, threshold, report, output };
}

// ---- the real Jest of an app ------------------------------------------------------------------------------------------------------------------------------

/** The part of a Jest project config the closure needs. */
interface ProjectConfigLike {
  readonly rootDir: string;
  readonly displayName?: { readonly name?: string };
  readonly setupFiles?: readonly string[];
  readonly setupFilesAfterEnv?: readonly string[];
  readonly [key: string]: unknown;
}
interface JestContextLike {
  readonly hasteFS: { matchFiles(pattern: RegExp | string): string[] };
  readonly resolver: unknown;
}
interface RuntimeLike { createContext(config: ProjectConfigLike, options: Record<string, unknown>): Promise<JestContextLike> }
interface DependencyResolverLike { resolve(file: string, options?: unknown): string[] }
interface ReadConfigsResult { readonly configs: readonly ProjectConfigLike[] }

/** The digest of a project config with host paths turned into `<root>` and the keys that differ per host dropped. */
export function projectConfigHash(config: ProjectConfigLike): string {
  const root = config.rootDir;
  const variants = [root, root.split(path.sep).join('/')].filter((value, index, all) => value !== '' && all.indexOf(value) === index);
  const strip = (value: unknown): unknown => {
    if (typeof value === 'string') return variants.reduce((text, variant) => text.split(variant).join('<root>'), value).split('\\').join('/');
    if (Array.isArray(value)) return value.map(strip);
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).filter(([key]) => !['cacheDirectory', 'id', 'cwd'].includes(key)).map(([key, item]) => [key, strip(item)]));
    return value;
  };
  return combineHashes({ config: canonicalJson(strip(config)) });
}

/**
 * The app's own Jest, resolved from `jestFrom` (a package.json or folder inside the app's install): its unit project's configuration, its haste map and resolver
 * (so `moduleNameMapper`, `jest.mock` targets and setup files count as Jest sees them), and its binary to run specs. `side` is the Jest root, app-relative.
 */
export async function createJestEnvironment({ appRoot, side, jestFrom, project = 'unit' }: { appRoot: string; side: string; jestFrom?: string; project?: string }): Promise<JestEnvironment> {
  const root = path.resolve(appRoot, side);
  const fromApp = createRequire(jestFrom ?? path.join(root, 'package.json'));
  const jestPackage = fromApp.resolve('jest/package.json');
  const fromJest = createRequire(jestPackage);
  const fromCore = createRequire(fromJest.resolve('@jest/core'));
  const { readConfigs } = fromCore('jest-config') as { readConfigs(argv: Record<string, unknown>, paths: string[]): Promise<ReadConfigsResult> };
  const runtimeModule = fromCore('jest-runtime') as { default: RuntimeLike };
  const Runtime = runtimeModule.default;
  const { DependencyResolver } = fromCore('jest-resolve-dependencies') as { DependencyResolver: new (resolver: unknown, hasteFS: unknown, snapshotResolver: unknown) => DependencyResolverLike };
  const jestBin = path.join(path.dirname(jestPackage), 'bin', 'jest.js');

  // The preset's config reads the working directory (the back end it describes), so it is read from the Jest root.
  const previous = process.cwd();
  let config: ProjectConfigLike | undefined;
  let context: JestContextLike | undefined;
  try {
    process.chdir(root);
    const { configs } = await readConfigs({ $0: 'jest', _: [], selectProjects: [project] }, [root]);
    config = configs.find((entry) => entry.displayName?.name === project);
    if (config === undefined) throw new Error(`the Jest config under ${side} has no project named ${project}`);
    context = await Runtime.createContext(config, { maxWorkers: 1, watchman: false, console: { log: () => undefined, warn: () => undefined, error: () => undefined } });
  } finally {
    process.chdir(previous);
  }
  const resolver = new DependencyResolver(context.resolver, context.hasteFS, undefined);
  const tracked = (file: string): boolean => !file.split(/[\\/]/u).includes('node_modules');
  const closureFrom = (roots: readonly string[]): string[] => {
    const seen = new Set<string>();
    const queue = roots.filter(tracked);
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      for (const next of resolver.resolve(file)) if (tracked(next) && !seen.has(next)) queue.push(next);
    }
    return [...seen];
  };
  const relative = (file: string): string => posix(path.relative(appRoot, file));
  const setup = (name: 'setupFiles' | 'setupFilesAfterEnv'): string[] => [...(config[name] ?? [])];
  const setupClosure = closureFrom([...setup('setupFiles'), ...setup('setupFilesAfterEnv')]).map(relative);

  const listed = spawnSync(process.execPath, [jestBin, '--selectProjects', project, '--listTests'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (listed.status !== 0) throw new Error(`jest --listTests failed under ${side}: ${(listed.stderr || listed.stdout).split('\n')[0]}`);
  const specs = listed.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => path.isAbsolute(line)).map((line) => relative(path.resolve(line))).sort();
  const closures = new Map<string, readonly string[]>();

  return {
    specs,
    configHash: projectConfigHash(config),
    closureOf(spec) {
      const cached = closures.get(spec);
      if (cached !== undefined) return cached;
      const own = closureFrom([path.resolve(appRoot, spec)]).map(relative).filter((file) => file !== spec);
      const closure = [...new Set([...own, ...setupClosure])].sort();
      closures.set(spec, closure);
      return closure;
    },
    run(toRun, coverageDir) {
      const base = [jestBin, '--selectProjects', project, '--coverage', '--ci'];
      const everything = toRun.length === specs.length;
      const sideRelative = toRun.map((spec) => posix(path.relative(root, path.resolve(appRoot, spec))));
      // One process for all of them; a command line that would not fit (Windows) goes in several.
      const chunks: string[][] = everything ? [[]] : [];
      for (const spec of everything ? [] : sideRelative) {
        const last = chunks[chunks.length - 1];
        if (last !== undefined && last.join(' ').length + spec.length < 24000) last.push(spec);
        else chunks.push([spec]);
      }
      let status = 0;
      let output = '';
      for (const chunk of chunks) {
        const args = chunk.length > 0 ? [...base, '--runTestsByPath', ...chunk] : base;
        const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, STARCI_SPEC_COVERAGE_DIR: coverageDir }, maxBuffer: 256 * 1024 * 1024 });
        status = status || (result.status ?? 1);
        output += `${result.stdout}${result.stderr}`;
      }
      return { status, output };
    },
    readCoverage(coverageDir) {
      return fs.readdirSync(coverageDir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(fs.readFileSync(path.join(coverageDir, name), 'utf8')) as SpecCoverageOutput);
    },
  };
}

/** The installed preset's union merge (resolved like the shard merge of `app coverage`): the records in, the lcov and coverage-final.json out. */
export function installedSpecMerge(appRoot: string, from?: string): MergeSpecRecords {
  return (records, { outDir, reportRoot, recordRoot }) => {
    let load: { mergeSpecCoverage(args: { records: unknown[]; outDir: string; projectRoot: string; recordRoot: string }): { files: number } };
    try {
      load = createRequire(from ?? path.join(appRoot, 'package.json'))('@starci/jest-preset/spec-coverage') as typeof load;
    } catch (error) {
      throw new Error(`@starci/jest-preset/spec-coverage is not installed under ${appRoot} (${(error as { code?: string }).code ?? (error as Error).message}); install the canon @starci/jest-preset`);
    }
    load.mergeSpecCoverage({ records: [...records], outDir, projectRoot: reportRoot, recordRoot });
  };
}

/**
 * The sharded full run of CI (`--test --full --shard i/n`): the shard's Jest run in the shape the shard merge reads, `coverage-final.json` of the files it loads,
 * and nothing recorded. The merge job joins the shards (`starci app coverage merge`) and judges the merged report with `--coverage-from`.
 */
export function shardArgs(index: number, total: number): { args: string[]; env: Record<string, string> } {
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || total < index) throw new Error(`--shard needs <i>/<n> with 1 <= i <= n, got ${index}/${total}`);
  return { args: [`--shard=${index}/${total}`, '--coverage', '--ci', '--selectProjects', 'unit'], env: { STARCI_COVERAGE_SHARD: '1' } };
}
