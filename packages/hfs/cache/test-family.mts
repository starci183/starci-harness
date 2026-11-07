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
import { completedNode, runHeavyNode, type HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { combineHashes, hashFile } from './hash.mjs';
import { canonicalJson, recordLine, toLazyRecord } from './jsonl.mjs';
import type { CacheRecord, CheckSession, FamilyReport, JsonValue } from './types.mjs';

/** The folder of the session that holds the records of this family. */
export const TEST_FOLDER = 'test-coverage';
/** The step of a unit spec's record. */
export const SPEC_STEP = 'unit-spec';
/** How often the spec coverage a running Jest has written is journaled, in ms. */
export const DRAIN_MS = 10_000;
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
  /** The name of the file the reporter wrote it to, when the environment tells (what a drain of a running Jest skips the next time). */
  readonly file?: string;
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
  run(specs: readonly string[], coverageDir: string): RunOutcome | Promise<RunOutcome>;
  /**
   * Reads what the reporter wrote into `coverageDir`. With `skip` (the names of files already read) it is a drain of a Jest still running: it reads only the
   * other files and leaves a file the reporter has not finished writing for the next drain.
   */
  readCoverage(coverageDir: string, skip?: ReadonlySet<string>): readonly SpecCoverageOutput[];
}

/** The union of the stored records, written as the lcov and coverage-final.json of the Jest root (`<root>/coverage`). */
export type MergeSpecRecords = (records: Iterable<Readonly<Record<string, SourceItems>>>, args: { outDir: string; reportRoot: string; recordRoot: string }) => void;
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
  /** How often the coverage a running Jest wrote is journaled, in ms (DRAIN_MS). */
  readonly drainMs?: number;
}

/** The outcome of the family. `ok` is false when a spec failed or the merged total is below the threshold. */
export interface TestFamilyResult {
  readonly ok: boolean;
  readonly ran: readonly string[];
  readonly reused: readonly string[];
  /** Specs that failed, did not report, or whose inputs changed: nothing of theirs is stored. A run whose runner died leaves its unreported specs out. */
  readonly failed: readonly string[];
  /** The part of `failed` whose closure changed on disk during the run (a merge or a codegen mid-run): not a failure of the spec itself. */
  readonly changed: readonly string[];
  /**
   * The runner's death (runnerDeath): its fatal line (a V8 heap limit) or its exit, when Jest ended before every spec it ran reported. Its specs that
   * never reported are counted in `unreported`, never in `failed`: one runner failure, not one per spec.
   */
  readonly died: { readonly line: string; readonly unreported: number } | undefined;
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
  // A source is relative to the Jest root; a root package's (`../packages/<name>/...`) is outside it, so the joined path is normalised to the app root.
  for (const [source, items] of Object.entries(sources)) prefixed[side === '' || side === '.' ? source : path.posix.normalize(`${side}/${source}`)] = items;
  return { path: spec, step: SPEC_STEP, hash: key, findings: [], data: { sources: prefixed as unknown as JsonValue } };
}

/** The line a V8 heap exhaustion prints (`FATAL ERROR: Reached heap limit ...`, `JavaScript heap out of memory`, the last Mark-Compact). */
const HEAP_LINE = /^.*(?:FATAL ERROR:.*heap|JavaScript heap out of memory|Reached heap limit).*$/mu;

/**
 * Whether the runner itself died rather than a spec failing: its output carries a V8 heap exhaustion, or it exited non-zero with specs that
 * never reported. Returns the line that says so, or undefined when every spec ran to its own verdict.
 */
export function runnerDeath(outcome: RunOutcome, unreported: number): string | undefined {
  const heap = HEAP_LINE.exec(outcome.output)?.[0]?.trim();
  if (heap !== undefined && unreported > 0) return heap;
  if (outcome.status !== 0 && unreported > 0 && /\b(?:SIGABRT|SIGKILL|SIGSEGV|exit(?:ed)? (?:with )?code 13[47])\b|Aborted|Segmentation fault/u.test(outcome.output)) {
    return outcome.output.split(/\r?\n/u).find((line) => /SIGABRT|SIGKILL|SIGSEGV|13[47]|Aborted|Segmentation fault/u.test(line))?.trim();
  }
  return undefined;
}

/**
 * Runs the unit specs against the cache. Diff mode runs the specs with no current record, full mode all of them; a passing spec's coverage is stored under its key,
 * a failing one's is not, and the folder is replaced with exactly the current specs' records. The merged total is written to `<side>/coverage/lcov.info` and judged.
 */
export async function runTestFamily(options: TestFamilyOptions): Promise<TestFamilyResult> {
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
  const changed: string[] = [];
  let output = '';
  let died: TestFamilyResult['died'];
  if (toRun.length > 0) {
    const scratch = options.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), 'starci-spec-coverage-'));
    try {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.mkdirSync(scratch, { recursive: true });
      // A spec's coverage is journaled as the reporter writes it (journal.mts): a Jest killed after most of its specs keeps theirs.
      const journal = session.journal?.(TEST_FOLDER, 'rec');
      const drained = new Set<string>();
      const journaled = new Set<string>();
      const bySideRelative = new Map(toRun.map((spec) => [posix(path.relative(path.join(session.root, side), path.join(session.root, spec))), spec] as const));
      const drain = (): void => {
        if (journal === undefined) return;
        try {
          for (const file of jest.readCoverage(scratch, drained)) {
            if (file.file !== undefined) drained.add(file.file);
            const spec = bySideRelative.get(file.spec);
            const key = spec === undefined ? undefined : keys.get(spec);
            if (spec === undefined || key === undefined || !file.passed || journaled.has(spec)) continue;
            journaled.add(spec);
            journal.append([recordLine(toLazyRecord(recordOf(spec, key, file.sources, side)))]);
          }
        } catch { /* a drain that cannot read now is tried again; the family reads everything when Jest ends */ }
      };
      const timer = journal === undefined ? undefined : setInterval(drain, options.drainMs ?? DRAIN_MS);
      timer?.unref();
      let outcome: RunOutcome;
      try {
        outcome = await jest.run(toRun, scratch);
      } finally {
        if (timer !== undefined) clearInterval(timer);
      }
      drain();
      output = outcome.output;
      const reported = new Map(jest.readCoverage(scratch).map((file) => [file.spec, file]));
      const reportOf = (spec: string) => reported.get(posix(path.relative(path.join(session.root, side), path.join(session.root, spec))));
      const silent = toRun.filter((spec) => reportOf(spec) === undefined);
      const line = runnerDeath(outcome, silent.length);
      if (line !== undefined) died = { line, unreported: silent.length };
      for (const spec of toRun) {
        const file = reportOf(spec);
        const key = keys.get(spec);
        // Held as its line from here on (memory plan, streaming): a full run of a large app holds every spec's coverage until the cache is written.
        if (file?.passed === true && key !== undefined) fresh.push(toLazyRecord(recordOf(spec, key, file.sources, side)));
        else if (file !== undefined || died === undefined) failed.push(spec);
      }
    } finally {
      if (options.scratch === undefined) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  // Recheck every candidate against disk, including a reused spec whose inputs another running spec could change.
  const records = [...kept, ...fresh].filter((record) => {
    const key = specKey({ spec: record.path, closure: jest.closureOf(record.path), configHash: jest.configHash, hashOf: (file) => hashFile(path.join(session.root, file)) });
    if (key === keys.get(record.path)) return true;
    failed.push(record.path);
    changed.push(record.path);
    return false;
  });
  const settled = new Set(records.map((record) => record.path));
  const reused = kept.filter((record) => settled.has(record.path));
  progress.tick(jest.specs.length, reused.length, toRun.length);
  progress.end();

  session.replace(TEST_FOLDER, records);

  let lcov: string | undefined;
  let threshold: TestFamilyResult['threshold'];
  if (records.length > 0) {
    const rootDir = path.join(session.root, side);
    const outDir = path.join(rootDir, 'coverage');
    merge((function* sources() { for (const record of records) yield sourcesOf(record); })(), { outDir, reportRoot: rootDir, recordRoot: session.root });
    lcov = path.join(outDir, 'lcov.info');
    // A failed spec leaves its sources short in the total, so the threshold is judged only when every spec reported.
    if (failed.length === 0 && died === undefined) threshold = judge(lcov);
  }
  const thresholdFindings = threshold?.findings.length ?? 0;
  const report: FamilyReport = {
    family: 'test',
    mode: decision.mode,
    reason: decision.reason,
    checked: toRun.length,
    reused: reused.length,
    newFindings: failed.length + (died === undefined ? 0 : 1) + thresholdFindings,
    knownFindings: 0,
    fixedFindings: 0,
  };
  session.report(report);
  return { ok: failed.length === 0 && died === undefined && (threshold?.ok ?? records.length === 0), ran: toRun, reused: reused.map((record) => record.path), failed, changed, died, lcov, threshold, report, output };
}

// ---- the real Jest of an app ------------------------------------------------------------------------------------------------------------------------------

/** The part of a Jest project config the closure needs. A project's `roots` are where its haste map finds its files. */
interface ProjectConfigLike {
  readonly rootDir: string;
  readonly displayName?: { readonly name?: string };
  readonly setupFiles?: readonly string[];
  readonly setupFilesAfterEnv?: readonly string[];
  readonly [key: string]: unknown;
}
interface JestContextLike {
  readonly hasteFS: { matchFiles(pattern: RegExp | string): string[]; exists(file: string): boolean };
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
export async function createJestEnvironment({ appRoot, side, jestFrom, project = 'unit', execute }: { appRoot: string; side: string; jestFrom?: string; project?: string; execute?: HeavyNodeRun | undefined }): Promise<JestEnvironment> {
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

  // The preset's config reads the working directory (the back end it describes), so it is read from the Jest root. Several projects may carry the name
  // (the back end's unit project and the one of the app's root packages, rooted at the app root): each keeps its own haste map and resolver.
  const previous = process.cwd();
  const projects: { config: ProjectConfigLike; resolver: DependencyResolverLike; hasteFS: JestContextLike['hasteFS'] }[] = [];
  try {
    process.chdir(root);
    const { configs } = await readConfigs({ $0: 'jest', _: [], selectProjects: [project] }, [root]);
    for (const config of configs.filter((entry) => entry.displayName?.name === project)) {
      const context = await Runtime.createContext(config, { maxWorkers: 1, watchman: false, console: { log: () => undefined, warn: () => undefined, error: () => undefined } });
      projects.push({ config, resolver: new DependencyResolver(context.resolver, context.hasteFS, undefined), hasteFS: context.hasteFS });
    }
    if (projects.length === 0) throw new Error(`the Jest config under ${side} has no project named ${project}`);
  } finally {
    process.chdir(previous);
  }
  const tracked = (file: string): boolean => !file.split(/[\\/]/u).includes('node_modules');
  /** The project whose haste map holds `file`: a module is resolved the way the project that runs its spec resolves it. */
  const projectOf = (file: string): (typeof projects)[number] => projects.find((entry) => entry.hasteFS.exists(file)) ?? (projects[0] as (typeof projects)[number]);
  const closureFrom = (roots: readonly string[], owner: (typeof projects)[number]): string[] => {
    const seen = new Set<string>();
    const queue = roots.filter(tracked);
    while (queue.length > 0) {
      const file = queue.pop();
      if (file === undefined || seen.has(file)) continue;
      seen.add(file);
      for (const next of owner.resolver.resolve(file)) if (tracked(next) && !seen.has(next)) queue.push(next);
    }
    return [...seen];
  };
  const relative = (file: string): string => posix(path.relative(appRoot, file));
  const setupClosures = new Map(projects.map((entry) => [entry, closureFrom([...(entry.config.setupFiles ?? []), ...(entry.config.setupFilesAfterEnv ?? [])], entry).map(relative)]));

  const listed = completedNode(await runHeavyNode(execute, { kind: 'test', label: `app check jest ${project} discovery`, args: [jestBin, '--selectProjects', project, '--listTests'], cwd: root, maxBuffer: 64 * 1024 * 1024 }), 'jest discovery');
  if (listed.status !== 0) throw new Error(`jest --listTests failed under ${side}: ${(listed.stderr || listed.stdout).split('\n')[0]}`);
  const specs = listed.stdout.split(/\r?\n/u).map((line) => line.trim()).filter((line) => path.isAbsolute(line)).map((line) => relative(path.resolve(line))).sort();
  const closures = new Map<string, readonly string[]>();

  return {
    specs,
    configHash: projects.length === 1 ? projectConfigHash((projects[0] as (typeof projects)[number]).config) : combineHashes(Object.fromEntries(projects.map((entry, index) => [String(index), projectConfigHash(entry.config)]))),
    closureOf(spec) {
      const cached = closures.get(spec);
      if (cached !== undefined) return cached;
      const file = path.resolve(appRoot, spec);
      const owner = projectOf(file);
      const own = closureFrom([file], owner).map(relative).filter((entry) => entry !== spec);
      const closure = [...new Set([...own, ...(setupClosures.get(owner) ?? [])])].sort();
      closures.set(spec, closure);
      return closure;
    },
    async run(toRun, coverageDir) {
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
        const result = completedNode(await runHeavyNode(execute, { kind: 'test', label: `app check jest ${project} coverage`, args, cwd: root, env: { ...process.env, STARCI_SPEC_COVERAGE_DIR: coverageDir }, maxBuffer: 256 * 1024 * 1024 }), 'jest coverage');
        status = status || (result.status ?? 1);
        output += `${result.stdout}${result.stderr}`;
      }
      return { status, output };
    },
    readCoverage(coverageDir, skip) {
      // Each file's sources are read again when asked for and never kept here (memory plan, streaming): the files of a full run are the size of the
      // whole coverage, and only the spec and its verdict are needed to sort them.
      const out: SpecCoverageOutput[] = [];
      for (const name of fs.readdirSync(coverageDir).filter((entry) => entry.endsWith('.json') && skip?.has(entry) !== true)) {
        const file = path.join(coverageDir, name);
        const read = (): SpecCoverageOutput => JSON.parse(fs.readFileSync(file, 'utf8')) as SpecCoverageOutput;
        try {
          const { spec, passed } = read();
          out.push({ file: name, spec, passed, get sources() { return read().sources; } });
        } catch (error) {
          // A drain meets the file the reporter is still writing; the end-of-run read never skips one.
          if (skip === undefined) throw error;
        }
      }
      return out;
    },
  };
}

/** The istanbul file coverage the preset's `mergeSourceCoverage` returns per source (`CoverageMap.fileCoverageFor(file).toJSON()`). */
interface IstanbulRange { readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } }
interface IstanbulFile {
  readonly statementMap: Readonly<Record<string, IstanbulRange>>;
  readonly fnMap: Readonly<Record<string, { readonly name: string; readonly decl: IstanbulRange; readonly loc: IstanbulRange }>>;
  readonly branchMap: Readonly<Record<string, { readonly type: string; readonly loc: IstanbulRange; readonly locations: readonly IstanbulRange[] }>>;
  readonly s: Readonly<Record<string, number>>;
  readonly f: Readonly<Record<string, number>>;
  readonly b: Readonly<Record<string, readonly number[]>>;
}
interface IstanbulMap { files(): string[]; fileCoverageFor(file: string): { toJSON(): IstanbulFile } }
interface SpecCoverageModule {
  mergeSpecCoverage(args: { records: Iterable<unknown>; outDir: string; projectRoot: string; recordRoot: string }): { files: number };
  mergeSourceCoverage?: (records: Iterable<Readonly<Record<string, SourceItems>>>) => IstanbulMap;
}

const rangeOf = (loc: IstanbulRange): [number, number, number, number] => [loc.start.line, loc.start.column, loc.end.line, loc.end.column];

/**
 * The union of the per-spec records as ONE record, folded one record at a time through the preset's own `mergeSourceCoverage` (istanbul's merge,
 * so the total is the one the preset computes), with each item's merged count in place of a flag (memory plan, streaming): the merge then holds
 * the union, never every record at once. The preset's `fileCoverageOf` reads the record back with the same item order and counts, so the lcov and
 * coverage-final.json are the bytes the merge of every record writes.
 */
export function unionOfRecords(records: Iterable<Readonly<Record<string, SourceItems>>>, mergeSourceCoverage: NonNullable<SpecCoverageModule['mergeSourceCoverage']>): Readonly<Record<string, SourceItems>> {
  const map = mergeSourceCoverage(records);
  const union: Record<string, SourceItems> = {};
  for (const source of map.files()) {
    const data = map.fileCoverageFor(source).toJSON();
    union[source] = {
      s: Object.entries(data.statementMap).map(([id, loc]) => [...rangeOf(loc), data.s[id] ?? 0]),
      f: Object.entries(data.fnMap).map(([id, meta]) => [meta.name, rangeOf(meta.decl), rangeOf(meta.loc), data.f[id] ?? 0]),
      b: Object.entries(data.branchMap).map(([id, meta]) => [meta.type, rangeOf(meta.loc), meta.locations.map((loc, index) => [rangeOf(loc), data.b[id]?.[index] ?? 0])]),
    };
  }
  return union;
}

/** The installed preset's union merge (resolved like the shard merge of `app coverage`): the records in, the lcov and coverage-final.json out. */
export function installedSpecMerge(appRoot: string, from?: string): MergeSpecRecords {
  return (records, { outDir, reportRoot, recordRoot }) => {
    let load: SpecCoverageModule;
    try {
      load = createRequire(from ?? path.join(appRoot, 'package.json'))('@starci/jest-preset/spec-coverage') as typeof load;
    } catch (error) {
      throw new Error(`@starci/jest-preset/spec-coverage is not installed under ${appRoot} (${(error as { code?: string }).code ?? (error as Error).message}); install the canon @starci/jest-preset`);
    }
    // A preset without `mergeSourceCoverage` takes the records as they come (it holds them all).
    const merged = load.mergeSourceCoverage === undefined ? records : [unionOfRecords(records, load.mergeSourceCoverage)];
    load.mergeSpecCoverage({ records: merged, outDir, projectRoot: reportRoot, recordRoot });
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
