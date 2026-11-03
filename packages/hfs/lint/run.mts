// The linters of `starci app check --gate lint`: ESLint once per side (and once for the root workspace packages) and stylelint over the fe stylesheets, through the app's own install.
//
//   1. ESLint runs from the side folder with that side's eslint.config.mjs (be/ the be canon, fe/ the fe canon: the per-file rules and the
//      project-graph rules of the architecture machine, findings on the line of the offending TypeScript file); each side lints only its own
//      files, so the be rules never see fe/ and the fe rules never see be/;
//   1b. the root workspace packages (packages/<pkg>/src/**) are a third scope: ESLint runs from the app root with the managed root eslint.config.mjs (sync renders it), the files
//      app-relative, whole on every run (no result records), the project graph left to the sides;
//   2. stylelint judges the fe side's stylesheets (sync STYLE_GLOB) from fe/ with its stylelint.config.mjs.
// `cachedLinters` is the one entry of `app check`: per side it judges only what the records of `.starcistacks/cache/lint/<side>/` cannot
// vouch for (cache/lint-family.mjs, contexts/project/check-cache.md), and `eslintRepository` is the launcher it and the cacheless run share.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeTempDir } from '../runtime/scripts/api/fs/make-temp-dir.mjs';
import { completedNode, isHostHeld, isNodeExecutionRefusal, runHeavyNode, type HeavyNodeResult, type HeavyNodeRun } from '../runtime/scripts/api/node/run-node.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SIDES, appRelativeMessages, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { STYLE_GLOB } from '../sync/index.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { braceVariants, globExpression } from '../runtime/scripts/lib/glob.mjs';
import { grammarLintFor } from '../runtime/scripts/lib/grammar-lint.mjs';
import { mergeBase } from '../runtime/scripts/api/git/merge-base.mjs';
import { lintFamilyReport, lintSide, loadAppTypeScript, type CanonDeclarations, type EslintResult, type GraphSnapshot, type LintSideStats, type LinterOutcome, type StylelintResult } from '../cache/lint-family.mjs';
import type { CheckSession } from '../cache/types.mjs';

// reason: linter json output (eslint, stylelint), package.json and the installed canon config are parsed or imported from the app's own install; each reader checks the fields it uses
type Dynamic = any;

/**
 * The project-graph findings of one canon, as its `projectGraphSnapshot` answers them: by side-relative posix path.
 * The ESLint child builds this graph for the canon's graph rules, so it hands the snapshot out instead of the cache building the same graph again.
 */
export type GraphSnapshotParts = Readonly<Record<string, GraphSnapshot>>;
/** What a linter run answers: its json results, or why it could not complete (both when the run was partial), and the graph snapshots its child handed out, by canon name. */
export interface LinterRun { results?: Dynamic[]; error?: string; graph?: GraphSnapshotParts }
/**
 * What a linter run is asked for. `list` is the files an ESLint run lints (cwd-relative, posix) when they are named one by one: they go to the child
 * through a file, never the command line, and `args` then holds the options alone. `files` is the number of source files the child's work is made of,
 * which the heavy-command budget of the ESLint kind scales with: the typed program and the project graph of a side are built whole for a named list
 * too, so a list run of a side whose scope is known names the side's count; without `files` a list names its own count.
 */
export interface LinterSpec { cwd: string; pkg: string; bin: string; args: string[]; bound?: string | null; list?: readonly string[] | undefined; files?: number | undefined; graph?: readonly GraphCanon[] | undefined }
/** An installed canon whose graph snapshot the ESLint child hands out: its package name and the entry file the child imports. */
export interface GraphCanon { name: string; entry: string }
/** The seam that runs a linter through the app's own install from cwd. */
export type LinterRunner = (spec: LinterSpec) => Promise<LinterRun>;
/** One finding of the lint report. */
export interface LintFinding {
  engine: string; rule: string; code: string | null; severity: string; path: string | null; line: number | null; column: number | null; message: string;
}
/** The app declaration the slot machine returns (readRepoDeclaration): sides are present at an app root. */
type RepoDeclaration = Dynamic;
/** What an ESLint launch of one side records. */
interface EslintLaunch { side: string; skipped?: string; scopeError?: string; cwd?: string; expected?: string[]; run?: Promise<LinterRun> }

/** The side whose stylesheets stylelint judges. */
const STYLE_SIDE = 'fe';
const CODE_PREFIX = /^\[([A-Z][A-Z0-9_]+)\] /;
const posix = (file: unknown): string => String(file).replace(/\\/g, '/').replace(/^\.\//, '');
/** The typed ESLint run reads nothing above the app root: its TypeScript `sys` is bound by this preload (3.3, bound-sys.cjs). */
const BOUND_ENV = 'STARCI_LINT_BOUND';
const linterBoundArgs = () => ['--require', fileURLToPath(new URL('./bound-sys.cjs', import.meta.url))];
/**
 * The heap of the ESLint child in MiB: the starci CLI sets it from its one owner, the eslint memory of ops/liveness.yaml `heavy` (a typed whole-side
 * lint of a large app outgrows node's default heap). Unset, ESLint runs on node's default.
 */
export const ESLINT_HEAP_ENV = 'STARCI_ESLINT_HEAP_MB';
export function eslintHeapArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const mb = Number(env[ESLINT_HEAP_ENV]);
  return Number.isInteger(mb) && mb > 0 ? [`--max-old-space-size=${mb}`] : [];
}

/** The ESLint list runner (eslint-list.cts, built beside this file). */
const LIST_RUNNER = fileURLToPath(new URL('./eslint-list.cjs', import.meta.url));

/** The snapshots an ESLint child wrote, by canon name; undefined when it wrote none or a file that is not a snapshot list (the cache then builds the graph itself). */
function readGraphSnapshots(file: string): GraphSnapshotParts | undefined {
  try {
    const written: Dynamic = JSON.parse(fs.readFileSync(file, 'utf8'));
    const snapshots = written?.snapshots;
    if (snapshots === null || typeof snapshots !== 'object' || Array.isArray(snapshots)) return undefined;
    const sound = Object.values(snapshots).every((snapshot: Dynamic) => snapshot !== null && typeof snapshot === 'object' && snapshot.byFile !== null && typeof snapshot.byFile === 'object' && !Array.isArray(snapshot.byFile)
      && Object.values(snapshot.byFile).every((findings) => Array.isArray(findings)));
    return sound ? snapshots : undefined;
  } catch { return undefined; }
}

/** A linter's json results through the app's own install, run from `cwd` (a side folder): `{ results }` or `{ error }`. The child runs while the caller goes on. */
export async function runLinter({ cwd, pkg, bin, args, bound = null, list, files, graph }: LinterSpec, execute?: HeavyNodeRun): Promise<LinterRun> {
  let entry: string;
  try {
    const manifest = createRequire(path.join(cwd, 'package.json')).resolve(`${pkg}/package.json`);
    const declared = JSON.parse(fs.readFileSync(manifest, 'utf8')).bin;
    entry = path.join(path.dirname(manifest), typeof declared === 'string' ? declared : declared[bin]);
  } catch {
    return { error: `${pkg} is not installed for ${cwd}` };
  }
  const heap = pkg === 'eslint' ? eslintHeapArgs() : [];
  // A named list, or a run that hands its project graph out, goes through the list runner: the job is a file it reads (ESLint lints all of it in one
  // process, no command line holds a path), the whole side is the list `.`, and the graph snapshots come back in a file beside the job.
  const listed = pkg === 'eslint' && (list !== undefined || graph !== undefined) ? makeTempDir('starci-eslint-') : null;
  let childArgs: string[] = [entry, ...args];
  const snapshotFile = listed === null || graph === undefined ? null : path.join(listed, 'graph.json');
  if (listed !== null) {
    const job = path.join(listed, 'job.json');
    fs.writeFileSync(job, JSON.stringify({ files: list ?? ['.'], fix: args.includes('--fix'), ...(snapshotFile === null || graph === undefined ? {} : { graph: { out: snapshotFile, canons: graph } }) }));
    childArgs = [LIST_RUNNER, job];
  }
  const count = files ?? list?.length;
  let run: HeavyNodeResult;
  let handed: GraphSnapshotParts | undefined;
  try {
    run = completedNode(await runHeavyNode(execute, { kind: 'eslint', label: `app check ${pkg} ${path.basename(cwd)}`, args: [...heap, ...(bound ? linterBoundArgs() : []), ...childArgs], cwd, maxBuffer: 64 * 1024 * 1024, ...(count === undefined || pkg !== 'eslint' ? {} : { files: count }), ...(bound ? { env: { ...process.env, [BOUND_ENV]: bound } } : {}) }), pkg);
    handed = snapshotFile === null ? undefined : readGraphSnapshots(snapshotFile);
  } finally {
    if (listed !== null) fs.rmSync(listed, { recursive: true, force: true });
  }
  // ESLint prints its report on stdout; stylelint uses stderr. JSON does not prove a completed child: only exits 0/1
  // without a spawn error or signal are measurable, and exit 1 must carry findings.
  let results: Dynamic;
  try { results = JSON.parse(run.stdout.trim() || run.stderr); } catch { return { error: `${pkg} produced no json report in ${path.basename(cwd)}/ (exit ${run.status}): ${String(run.stderr || run.stdout).trim().split('\n').slice(0, 8).join(' | ')}` }; }
  if (!Array.isArray(results)) return { error: `${pkg} produced a report that is not a result list` };
  const completed = !run.error && !run.signal && [0, 1].includes(run.status as number)
    && (run.status === 0 || results.some((result: Dynamic) => result?.messages?.length || result?.warnings?.length));
  return { results, ...(handed === undefined || !completed ? {} : { graph: handed }), ...(completed ? {} : { error: `${pkg} could not complete in ${path.basename(cwd)}/ (exit ${run.status}, signal ${run.signal ?? 'none'}): ${String(run.error?.message || run.stderr || run.stdout || '').trim().split('\n')[0]}` }) };
}

const eslintFindings = (results: readonly Dynamic[], appRoot: string): LintFinding[] => results.flatMap((result) => (result.messages ?? []).map((message: Dynamic): LintFinding => ({
  engine: 'eslint', rule: message.ruleId ?? 'eslint-error', code: CODE_PREFIX.exec(message.message ?? '')?.[1] ?? null, severity: message.severity === 1 ? 'warning' : 'error',
  path: posix(path.relative(appRoot, result.filePath)), line: message.line ?? null, column: message.column ?? null, message: message.message,
})));

/** The files of `changed` (app-relative) below `side`/, relative to the side folder. */
const onSide = (changed: readonly string[], side: string): string[] => changed.filter((file) => file.startsWith(`${side}/`)).map((file) => file.slice(side.length + 1));

/**
 * The root workspace packages of an app (`packages/<pkg>/src/**`) are linted by the managed `eslint.config.mjs` of the app root, as a third scope beside
 * the two sides: its files are app-relative and its working directory is the app root. It has a scope only while the config is there.
 */
export const PACKAGES = 'packages';
export const PACKAGES_CONFIG = 'eslint.config.mjs';
const hasPackagesLint = (repoRoot: string): boolean => fs.existsSync(path.join(repoRoot, PACKAGES_CONFIG)) && fs.existsSync(path.join(repoRoot, PACKAGES));

/** The root config of the app, its default export awaited: the flat config the packages are linted by. */
async function packagesConfig(repoRoot: string): Promise<Dynamic[]> {
  const loaded = await import(`${pathToFileURL(path.join(repoRoot, PACKAGES_CONFIG)).href}?scope=${Date.now()}`);
  const config = await loaded.default;
  if (!Array.isArray(config)) throw new Error(`${PACKAGES_CONFIG} did not export a flat config`);
  return config;
}

/** The package sources the root config selects, app-relative: the walk stays below `packages/`, where the config's selectors point. */
async function packageSources(repoRoot: string): Promise<string[]> {
  const scope = canonScope(await packagesConfig(repoRoot));
  const files: string[] = [];
  const visit = (folder: string): void => {
    for (const child of fs.readdirSync(path.join(repoRoot, folder), { withFileTypes: true })) {
      const file = posix(path.join(folder, child.name));
      if (scope.ignored(file) || scope.ignored(`${file}/__starci_scope_probe__`)) continue;
      if (child.isSymbolicLink()) throw new Error(`cannot enumerate symlink ${file}`);
      if (child.isDirectory()) visit(file);
      else if (child.isFile() && scope.source(file)) files.push(file);
    }
  };
  visit(PACKAGES);
  return files.sort(byCodeUnit);
}

const fileKey = (file: string): string => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const inside = (root: string, file: string): boolean => { const rel = path.relative(root, file); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };

/**
 * The lint scope a flat config declares: `ignored(file)` for its global ignores (a block holding only `ignores` and `name`), which prune
 * the walk, and `source(file)` for a file some block's `files` select while that block's own `ignores` do not (standard flat-config
 * semantics: the Sonar-way block of the canons narrows itself to the scanned files). Negated or non-string selectors cannot prove a
 * scope and are refused.
 */
export function canonScope(config: readonly Dynamic[]): { ignored: (file: string) => boolean; source: (file: string) => boolean } {
  const blocks: { files: RegExp[]; ignores: RegExp[] }[] = [], ignored: RegExp[] = [];
  for (const block of config) {
    if (!block || typeof block !== 'object') throw new Error('the installed canon returned an invalid config block');
    for (const field of ['files', 'ignores']) {
      if (block[field] === undefined) continue;
      if (!Array.isArray(block[field]) || block[field].some((glob: unknown) => typeof glob !== 'string' || glob.startsWith('!'))) throw new Error(`unsupported canon ${field} selectors`);
    }
    const patterns = (globs: string[] | undefined): RegExp[] => (globs ?? []).flatMap((glob) => (braceVariants(glob) as string[]).map(globExpression));
    const global = block.ignores !== undefined && Object.keys(block).every((key) => ['ignores', 'name'].includes(key));
    if (global) ignored.push(...patterns(block.ignores));
    else if (block.files !== undefined) blocks.push({ files: patterns(block.files), ignores: patterns(block.ignores) });
  }
  if (!blocks.length) throw new Error('the installed canon has no source selectors');
  const matches = (list: readonly RegExp[], file: string): boolean => list.some((pattern) => pattern.test(file));
  return {
    ignored: (file) => matches(ignored, file),
    source: (file) => blocks.some((block) => matches(block.files, file) && !matches(block.ignores, file)),
  };
}

/** The conditions the import below resolves with: `node` and `import`, plus `default` as exports' terminal fallback. */
const IMPORT_CONDITIONS = new Set(['node', 'import', 'default']);

/** The first import target of an exports entry: a string, a fallback array, or a conditions object matched in its own key order. */
function exportsTarget(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = exportsTarget(item);
      if (target !== null) return target;
    }
  } else if (entry !== null && typeof entry === 'object') {
    for (const [condition, target] of Object.entries(entry as Record<string, unknown>)) {
      if (IMPORT_CONDITIONS.has(condition)) {
        const resolved = exportsTarget(target);
        if (resolved !== null) return resolved;
      }
    }
  }
  return null;
}

/** The import entry of a package found by the app's own node_modules lookup (the folders require.resolve.paths lists from cwd). */
function importEntry(require: NodeJS.Require, packageName: string): string {
  for (const dir of require.resolve.paths(packageName) ?? []) {
    const manifest = path.join(dir, packageName, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const published: Dynamic = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (published.exports === undefined) return path.join(dir, packageName, published.main ?? 'index.js');
    const exports = published.exports;
    const entry = exports !== null && typeof exports === 'object' && !Array.isArray(exports)
      && Object.keys(exports).some((key) => key.startsWith('.')) ? exports['.'] : exports;
    const target = exportsTarget(entry);
    if (target === null) throw new Error(`no "exports" import target for "." in ${manifest}`);
    const file = path.join(dir, packageName, target);
    if (!fs.existsSync(file)) throw new Error(`the "exports" import target of ${manifest} does not exist: ${target}`);
    return file;
  }
  throw new Error(`Cannot find package '${packageName}'`);
}

/** Resolve one canon from this app's install; a package from an enclosing repository cannot prove its lint contract. */
export function ownCanonEntry({ repoRoot, cwd }: { repoRoot: string; cwd: string }, packageName: string): string {
  const require = createRequire(path.join(cwd, 'package.json'));
  // The entry is imported below, so the package's import condition applies; require.resolve cannot be told so on every
  // supported Node (its registerHooks resolve hook skips require.resolve before Node 24), so "." is matched directly.
  const entry = importEntry(require, packageName);
  // The canon must be the app's own install: resolved inside the app root, or inside the app's node_modules when that folder is a link to the install
  // (the runtime's examples lint in a sealed copy whose node_modules links the example's own install, scripts/hfs/example-secrets.mjs).
  const ownInstall = [repoRoot, path.join(repoRoot, 'node_modules')].filter((dir) => fs.existsSync(dir)).map((dir) => fs.realpathSync(dir));
  if (!ownInstall.some((root) => inside(root, fs.realpathSync(entry)))) throw new Error('the installed canon is outside the app root');
  return entry;
}

/** Both installed FE canons supply the source config; family selection is explicit and an unavailable factory fails closed. */
export async function installedLintConfig({ repoRoot, cwd, side }: { repoRoot: string; cwd: string; side: string }): Promise<Dynamic[]> {
  const entry = ownCanonEntry({ repoRoot, cwd }, `@starci/eslint-canon-${side}`);
  const canon = await import(pathToFileURL(entry).href);
  const factory = side === 'be' ? canon.starciBeConfig : canon.starciFeConfig;
  if (typeof factory !== 'function' || typeof canon.loadHfs !== 'function') throw new Error('the installed canon has no supported config factory');
  const hfs = canon.loadHfs(pathToFileURL(path.join(cwd, 'eslint.config.mjs')).href);
  const config = await factory({ hfs });
  if (!Array.isArray(config)) throw new Error('the installed canon did not return a flat config');
  if (side !== 'fe') return config;
  const family = grammarLintFor(hfs.grammar);
  if (family.package === null) return config;
  const familyCanon = await import(pathToFileURL(ownCanonEntry({ repoRoot, cwd }, family.package)).href);
  if (typeof familyCanon[family.factory] !== 'function') throw new Error(`${family.package} has no supported ${family.factory} factory`);
  const familyConfig = await familyCanon[family.factory]({ hfs });
  if (!Array.isArray(familyConfig)) throw new Error(`${family.package} did not return a flat config`);
  return [...config, ...familyConfig];
}

/** Read both installed canons' source selectors, then enumerate that scope; unavailable selectors cannot prove coverage. */
async function sourceFiles({ repoRoot, cwd, side }: { repoRoot: string; cwd: string; side: string }): Promise<string[]> {
  const config = await installedLintConfig({ repoRoot, cwd, side });
  const scope = canonScope(config);
  const files: string[] = [];
  const visit = (folder: string): void => {
    for (const child of fs.readdirSync(path.join(cwd, folder), { withFileTypes: true })) {
      const file = posix(path.join(folder, child.name));
      // Ask the canon's global ignore patterns before entering output or installed-package trees.
      if (scope.ignored(file) || scope.ignored(`${file}/__starci_scope_probe__`)) continue;
      if (child.isSymbolicLink()) throw new Error(`cannot enumerate symlink ${file}`);
      if (child.isDirectory()) visit(file);
      else if (child.isFile() && scope.source(file)) files.push(file);
    }
  };
  visit('');
  return files.sort(byCodeUnit);
}

/** Every requested source needs an explicit, well-formed result; suppressed findings and foreign paths cannot witness a completed lint. */
function checkedEslintResults({ results, expected, cwd, changed }: { results: readonly Dynamic[]; expected: readonly string[]; cwd: string; changed: boolean }): { results: Dynamic[]; errors: string[] } {
  const required = new Set(expected.map((file) => fileKey(path.join(cwd, file))));
  const seen = new Set<string>(), valid: Dynamic[] = [], errors: string[] = [];
  for (const result of results) {
    if (!result || typeof result.filePath !== 'string' || !path.isAbsolute(result.filePath) || !Array.isArray(result.messages)
      || result.messages.some((message: Dynamic) => !message || typeof message.message !== 'string')
      || (result.suppressedMessages !== undefined && !Array.isArray(result.suppressedMessages))) {
      errors.push('eslint produced a malformed file result'); continue;
    }
    const key = fileKey(result.filePath);
    if (!inside(cwd, result.filePath) || (changed && !required.has(key))) {
      errors.push(`eslint produced a result outside the requested scope: ${result.filePath}`); continue;
    }
    if (seen.has(key)) errors.push(`eslint produced duplicate results for ${result.filePath}`);
    seen.add(key);
    if (result.suppressedMessages?.length) errors.push(`eslint suppressed findings for ${result.filePath}`);
    valid.push(result);
  }
  const missing = expected.filter((file) => !seen.has(fileKey(path.join(cwd, file))));
  if (missing.length) errors.push(`eslint produced no result for requested source files: ${missing.join(', ')}`);
  return { results: valid, errors };
}

/** A launch that threw instead of returning a record is a tool error of the run (exit 2), not a crash of the CLI. */
const spawnFailure = (error: unknown) => {
  if (isNodeExecutionRefusal(error)) throw error;
  return { error: `could not start eslint: ${String((error as Error | undefined)?.message ?? error)}` };
};

/** The installed canon of `side`, which publishes the project-graph rules, as the child imports it; undefined when it cannot be resolved (the cache then builds the graph itself). */
function graphCanonsOf(repoRoot: string, cwd: string, side: string): GraphCanon[] | undefined {
  const name = `@starci/eslint-canon-${side}`;
  try { return [{ name, entry: ownCanonEntry({ repoRoot, cwd }, name) }]; } catch { return undefined; }
}

/** Starts the ESLint child of every side that has work and returns one record per side: skipped, a scope error, or the running child. */
async function launchEslint({ app, repoRoot, opts, changed, existing, run = runLinter, scopes = {}, handOutGraph = false }: {
  app: RepoDeclaration; repoRoot: string; opts: { side?: string | undefined; fix?: boolean }; changed: unknown; existing: readonly string[]; run?: LinterRunner | undefined; scopes?: Readonly<Record<string, readonly string[]>>; handOutGraph?: boolean;
}): Promise<EslintLaunch[]> {
  const launches: EslintLaunch[] = [];
  const scopesToLint = app ? [...SIDES, ...(hasPackagesLint(repoRoot) ? [PACKAGES] : [])].filter((candidate: string) => opts.side === undefined || opts.side === candidate) : [];
  for (const side of scopesToLint) {
    const packages = side === PACKAGES;
    const sources = (packages ? existing.filter((file) => file.startsWith(`${PACKAGES}/`)) : onSide(existing, side)).filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
    if (changed !== null && !sources.length) { launches.push({ side, skipped: 'no changed source file' }); continue; }
    const cwd = packages ? repoRoot : path.join(repoRoot, side);
    let expected: string[];
    // a caller that enumerated the side's scope already (the cache) hands it over: the canon config is loaded and the folders walked once per run
    const known = scopes[side];
    try { expected = changed ? sources : known !== undefined ? [...known] : packages ? await packageSources(repoRoot) : await sourceFiles({ repoRoot, cwd, side }); }
    catch (error) { launches.push({ side, scopeError: `eslint source scope is unavailable in ${packages ? `${PACKAGES}/` : `${side}/`}: ${String((error as Error | undefined)?.message ?? error)}` }); continue; }
    // nothing the root config selects below packages/ is a scope with no file, not a run
    if (packages && !expected.length) { launches.push({ side, skipped: 'no package source' }); continue; }
    const head = ['--format', 'json', ...(opts.fix ? ['--fix'] : [])];
    // the child that builds the canon's project graph for its rules hands the snapshot out when the caller keeps the graph findings (the cache); the packages are no side folder and have no graph
    const graph = handOutGraph && !packages ? graphCanonsOf(repoRoot, cwd, side) : undefined;
    // The files of a diff go to ONE child through a file (a diff of hundreds of long paths outgrows the Windows command line, and each extra
    // child would build the whole TypeScript program again); the whole side is a single directory argument. Either child builds the typed program
    // and the project graph of the whole side, so its liveness budget scales with the side's scope when the caller knows it, never with the diff alone.
    const programFiles = known?.length ?? expected.length;
    const launch = Promise.resolve().then(() => run(changed ? { cwd, pkg: 'eslint', bin: 'eslint', args: head, list: sources, files: programFiles, bound: repoRoot, ...(graph === undefined ? {} : { graph }) } : { cwd, pkg: 'eslint', bin: 'eslint', args: [...head, packages ? PACKAGES : '.'], files: programFiles, bound: repoRoot, ...(graph === undefined ? {} : { graph }) }));
    launches.push({ side, cwd, expected, run: launch.catch(spawnFailure) });
  }
  return launches;
}

/** Execute each side's installed ESLint config once, whole or over a named list; the cached and the cacheless run share scope, coverage and tool-failure judgment. */
export async function eslintRepository({ repoRoot, app = readRepoDeclaration(loadSlotManifest(), repoRoot), opts = {}, changed = null, existing = [], run, scopes, handOutGraph }: {
  repoRoot: string; app?: RepoDeclaration; opts?: { side?: string | undefined; fix?: boolean }; changed?: readonly string[] | null; existing?: readonly string[]; run?: LinterRunner | undefined; scopes?: Readonly<Record<string, readonly string[]>> | undefined; handOutGraph?: boolean | undefined;
}): Promise<{ findings: LintFinding[]; errors: string[]; raw: Dynamic[]; engine: { sides: Record<string, { files: number; skipped?: string }> }; graphs: Record<string, GraphSnapshotParts> }> {
  const findings: LintFinding[] = [], errors: string[] = [], raw: Dynamic[] = [], graphs: Record<string, GraphSnapshotParts> = {};
  const engine: { sides: Record<string, { files: number; skipped?: string }> } = { sides: {} };
  if (!app.sides) throw new Error('ESLint runs at the app root, the folder of hfs.json');
  const launches = await launchEslint({ app, repoRoot, opts, changed, existing, run, ...(scopes === undefined ? {} : { scopes }), ...(handOutGraph === true ? { handOutGraph } : {}) });
  const settled = await Promise.allSettled(launches.map(launch => launch.run ?? null));
  const rejected = settled.filter((run): run is PromiseRejectedResult => run.status === 'rejected');
  const failed = rejected.find(run => isHostHeld(run.reason)) ?? rejected[0];
  if (failed !== undefined) throw failed.reason;
  const runs = settled.map(run => run.status === 'fulfilled' ? run.value : null) as (LinterRun | null)[];
  launches.forEach((launch, at) => {
    const { side } = launch;
    if (launch.skipped) { engine.sides[side] = { files: 0, skipped: launch.skipped }; return; }
    if (launch.scopeError) { errors.push(launch.scopeError); engine.sides[side] = { files: 0 }; return; }
    const linted = runs[at] as LinterRun;
    if (linted.error) errors.push(linted.error);
    if (linted.results) {
      const checked = checkedEslintResults({ results: linted.results, expected: launch.expected as string[], cwd: launch.cwd as string, changed: changed !== null });
      errors.push(...checked.errors);
      linted.results = checked.results;
      // the paths of a side's messages are side-relative and become app-relative; the packages' are app-relative already
      const appRelative = side === PACKAGES ? ((message: string): string => message) : appRelativeMessages(side, path.join(repoRoot, side));
      for (const result of linted.results) for (const message of result.messages ?? []) message.message = appRelative(message.message);
      raw.push(...linted.results);
      findings.push(...eslintFindings(linted.results, repoRoot));
    }
    engine.sides[side] = { files: linted.results?.length ?? 0 };
    if (linted.graph !== undefined) graphs[side] = linted.graph;
  });
  return { findings, errors, raw, engine, graphs };
}

// ------------------------------------------------------------------------------------------------ the cached lint

/** A `crossFileInputs` export that has the shape the cache reads, or null (an installed canon without it, or with a broken one, is linted whole). */
function declaredInputs(value: unknown): CanonDeclarations['crossFileInputs'] {
  if (!Array.isArray(value)) return null;
  const sound = value.every((entry: Dynamic) => entry && typeof entry.rule === 'string' && (entry.kind === 'content' || entry.kind === 'exists' || entry.kind === 'git') && (entry.relativeTo === 'file' || entry.relativeTo === 'side')
    && Array.isArray(entry.globs) && entry.globs.every((glob: unknown) => typeof glob === 'string') && Array.isArray(entry.appliesTo) && entry.appliesTo.every((glob: unknown) => typeof glob === 'string'));
  return sound ? value : null;
}

const declarationOf = (name: string, installed: Dynamic, graphRules: boolean): CanonDeclarations => ({
  name, crossFileInputs: declaredInputs(installed?.crossFileInputs), graphRules, projectGraph: graphRules && typeof installed?.projectGraph === 'function' ? installed.projectGraph : null,
});

/** What the cache reads of the canons a side lints with: the ESLint canon (which publishes the project-graph rules) and the grammar family of the fe side. */
export async function canonDeclarations({ repoRoot, cwd, side }: { repoRoot: string; cwd: string; side: string }): Promise<CanonDeclarations[]> {
  const name = `@starci/eslint-canon-${side}`;
  const canon = await import(pathToFileURL(ownCanonEntry({ repoRoot, cwd }, name)).href);
  const declarations = [declarationOf(name, canon, true)];
  if (side !== 'fe') return declarations;
  const family = grammarLintFor(canon.loadHfs(pathToFileURL(path.join(cwd, 'eslint.config.mjs')).href).grammar);
  if (family.package !== null) declarations.push(declarationOf(family.package, await import(pathToFileURL(ownCanonEntry({ repoRoot, cwd }, family.package)).href), false));
  return declarations;
}

/** The stylelint canon's declaration; one that cannot be imported has none, so every stylesheet is judged. */
async function styleDeclaration({ repoRoot, cwd }: { repoRoot: string; cwd: string }): Promise<CanonDeclarations> {
  const name = '@starci/stylelint-canon';
  try { return declarationOf(name, await import(pathToFileURL(ownCanonEntry({ repoRoot, cwd }, name)).href), false); }
  catch { return declarationOf(name, null, false); }
}

/** The stylesheets of the fe side (sync STYLE_GLOB), side-relative, from the disk. */
function stylesheetsOf(cwd: string): string[] {
  const patterns = (braceVariants(STYLE_GLOB) as string[]).map(globExpression);
  const found: string[] = [];
  const visit = (folder: string): void => {
    let children: fs.Dirent[];
    try { children = fs.readdirSync(path.join(cwd, folder), { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (child.name === 'node_modules' || child.name.startsWith('.git')) continue;
      const file = posix(path.join(folder, child.name));
      if (child.isDirectory()) visit(file);
      else if (child.isFile() && patterns.some((pattern) => pattern.test(file))) found.push(file);
    }
  };
  for (const container of ['apps', 'packages']) visit(container);
  return found.sort(byCodeUnit);
}

/**
 * What the size-growth rules compare an over-budget file with: the merge-base of HEAD with the base branch (STARCI_BASE_REF, origin/main, then
 * main), the same lookup the rules make. The cache keys the files those rules read history for on it, so a base that moved judges them again.
 */
export function gitBaseToken(repoRoot: string): string {
  const named = process.env['STARCI_BASE_REF'];
  for (const ref of named ? [named] : ['origin/main', 'main']) {
    const sha = mergeBase(repoRoot, 'HEAD', ref);
    if (sha) return sha;
  }
  return 'no-base';
}

/** What the cached linters answer: the ESLint answer in the shape of eslintRepository's, the stylelint results, and each side's counts. */
export interface CachedLinters {
  eslint: Omit<Awaited<ReturnType<typeof eslintRepository>>, 'graphs'>;
  stylelint: { results: Dynamic[]; errors: string[]; ran: boolean };
  sides: { side: string; stats: LintSideStats }[];
}

/**
 * A scope whose linter reached no complete measurement (a child ended by its liveness budget, a capture cut short) is a tool error of that scope, and the
 * next scope still runs: the root packages are judged whatever became of the back end. Nothing of the failed scope is recorded (its records are written
 * only after its child completed). A hold of the host (HOST_HELD, HEAVY_DEFERRED) still ends the run, since no scope would be admitted either.
 */
function scopeFailure(error: unknown, scope: string): string {
  if (!isNodeExecutionRefusal(error) || isHostHeld(error) || (error as { code?: unknown }).code === 'HEAVY_DEFERRED') throw error;
  return `eslint did not complete in ${scope}/: ${String((error as Error).message).split('\n')[0]}`;
}

/**
 * ESLint and stylelint through the result cache: per side, the files the records cannot vouch for go to the very launcher, chunking and result
 * validation of a full run (eslintRepository), the rest take their records; then the root packages, linted whole. Each scope runs on its own
 * (scopeFailure). The answer has the shape of eslintRepository's, plus the stylelint results, so the lint report is built the same way from either.
 */
export async function cachedLinters({ repoRoot, app, side: only, run, session }: {
  repoRoot: string; app: RepoDeclaration; side?: string | undefined; run?: LinterRunner | undefined; session: CheckSession;
}): Promise<CachedLinters> {
  const eslint: CachedLinters['eslint'] = { findings: [], errors: [], raw: [], engine: { sides: {} } };
  const style: CachedLinters['stylelint'] = { results: [], errors: [], ran: false };
  const sides: CachedLinters['sides'] = [];
  const decision = session.decide('lint');
  const full = decision.mode === 'full' ? decision.reason : null;
  const gitToken = gitBaseToken(repoRoot);
  for (const side of SIDES.filter((candidate: string) => only === undefined || only === candidate)) {
    const cwd = path.join(repoRoot, side);
    let scope: string[], canons: CanonDeclarations[];
    try { scope = await sourceFiles({ repoRoot, cwd, side }); canons = await canonDeclarations({ repoRoot, cwd, side }); }
    catch (error) { eslint.errors.push(`eslint source scope is unavailable in ${side}/: ${String((error as Error | undefined)?.message ?? error)}`); eslint.engine.sides[side] = { files: 0 }; continue; }
    const styled = side === STYLE_SIDE;
    let outcome: Awaited<ReturnType<typeof lintSide>>;
    try {
      outcome = await lintSide({
        session, side, sideRoot: cwd, scope, stylesheets: styled ? stylesheetsOf(cwd) : [],
        canons, styleCanon: styled ? await styleDeclaration({ repoRoot, cwd }) : null, typescript: () => loadAppTypeScript(cwd), extraKey: '', gitToken, full, write: true,
        eslint: async (files): Promise<LinterOutcome<EslintResult>> => {
          const listed = files === null ? null : files.map((file) => `${side}/${file}`);
          const sub = await eslintRepository({ repoRoot, app, opts: { side }, changed: listed, existing: listed ?? [], run, scopes: { [side]: scope }, handOutGraph: true });
          return { results: sub.raw as EslintResult[], errors: sub.errors, ...(sub.graphs[side] === undefined ? {} : { graph: sub.graphs[side] }) };
        },
        stylelint: styled ? async (files): Promise<LinterOutcome<StylelintResult>> => {
          const linted = await (run ?? runLinter)({ cwd, pkg: 'stylelint', bin: 'stylelint', args: [...(files ?? [STYLE_GLOB]), '--formatter', 'json'] });
          const appRelative = appRelativeMessages(STYLE_SIDE, cwd);
          for (const result of linted.results ?? []) for (const warning of result.warnings ?? []) warning.text = appRelative(warning.text);
          return { results: (linted.results ?? []) as StylelintResult[], errors: linted.error ? [linted.error] : [] };
        } : null,
      });
    } catch (error) {
      eslint.errors.push(scopeFailure(error, side));
      eslint.engine.sides[side] = { files: 0 };
      continue;
    }
    sides.push({ side, stats: outcome.stats });
    for (const message of outcome.errors) (message.startsWith('stylelint ') ? style.errors : eslint.errors).push(message);
    eslint.raw.push(...outcome.eslint);
    eslint.findings.push(...eslintFindings(outcome.eslint, repoRoot));
    eslint.engine.sides[side] = { files: outcome.eslint.length };
    if (styled) { style.results.push(...outcome.stylelint); style.ran = true; }
  }
  // The root packages are small and have no result records: they are linted whole on every run, through the same launcher.
  if ((only === undefined || only === PACKAGES) && hasPackagesLint(repoRoot)) {
    try {
      const linted = await eslintRepository({ repoRoot, app, opts: { side: PACKAGES }, run });
      eslint.errors.push(...linted.errors);
      eslint.raw.push(...linted.raw);
      eslint.findings.push(...linted.findings);
      eslint.engine.sides[PACKAGES] = linted.engine.sides[PACKAGES] ?? { files: 0 };
    } catch (error) {
      eslint.errors.push(scopeFailure(error, PACKAGES));
      eslint.engine.sides[PACKAGES] = { files: 0 };
    }
  }
  session.report(lintFamilyReport(sides));
  return { eslint, stylelint: style, sides };
}
