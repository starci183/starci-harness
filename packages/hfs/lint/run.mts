// starci app lint - the ONE lint entry and the ONE report of a StarCi app.
//
//   starci app lint [--cwd <dir>] [--changed <file>...] [--workspace <dir>] [--side be|fe] [--fix] [--format text|json] [--sonar <file>]
//
// It runs at the app root (the folder of hfs.json), over the app (or over the app-relative files named by --changed):
//   1. ESLint once per side, from the side folder, through the app's own install and that side's eslint.config.mjs (be/ the be canon,
//      fe/ the fe canon: the per-file rules and the project-graph rules of the architecture machine, findings on the line of the
//      offending TypeScript file); each side lints only its own files, so the be rules never see fe/ and the fe rules never see be/;
//   2. `starci app check` for what has no TypeScript file to sit on (the tree, managed files, pins, CI, contracts, docs, .starciwork), root and sides;
//   3. stylelint over the fe side's stylesheets (sync STYLE_GLOB), from fe/ with its stylelint.config.mjs.
// Their findings become one list of one shape (`starci/lint@1`), every path app-relative. `--format json` prints that report on stdout;
// `--sonar <file>` writes the same findings as THE Sonar Generic Issue Import file (engine ids starci-hfs, eslint, stylelint in one
// document); the exit code is the land-gate input: 0 no finding, 1 at least one, 2 a tool could not run (never a pass).
// --changed restricts ESLint and stylelint to the listed files and keeps of the app findings only those on a listed file or on no file.
// --workspace scopes the same lint to one npm workspace of the fe side (fe/apps/<app> or fe/packages/<pkg>, app-relative): ESLint and
// stylelint over that folder only, and of the app findings only those inside it. It is the `lint` script of every fe workspace (the
// turbo `lint` task); the root `npm run lint` stays the whole app. There is no second linter: a workspace lint is this lint, scoped.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linterReport, mergeReports, sonarReport, sourceRootsOf } from '../report/sonar.mjs';
import { SIDES, appRelativeMessages, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { isSide } from '../runtime/scripts/hfs/slot-manifest-shape.mjs';
import { chunkByChars, mapBounded, mergeRuns } from './chunk.mjs';
import { STYLE_GLOB } from '../sync/index.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { braceVariants, globExpression } from '../runtime/scripts/lib/glob.mjs';
import { grammarLintFor } from '../runtime/scripts/lib/grammar-lint.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-threshold.mjs';

// reason: linter json output (eslint, stylelint), package.json and the installed canon config are parsed or imported from the app's own install; each reader checks the fields it uses
type Dynamic = any;

/** The parsed arguments of the lint verb. */
export interface LintOptions { changed: string[] | null; fix: boolean; format: string; sonar: string | undefined; workspace: string | undefined; side?: string }
/** What a linter run answers: its json results, or why it could not complete (both when the run was partial). */
export interface LinterRun { results?: Dynamic[]; error?: string }
/** The seam that runs a linter through the app's own install from cwd. */
export type LinterRunner = (spec: { cwd: string; pkg: string; bin: string; args: string[]; bound?: string | null }) => Promise<LinterRun>;
/** One finding of the lint report. */
export interface LintFinding {
  engine: string; rule: string; code: string | null; severity: string; path: string | null; line: number | null; column: number | null; message: string; titleVi?: string; nextStepVi?: string;
}
/** The app declaration the slot machine returns (readRepoDeclaration): sides are present at an app root. */
type RepoDeclaration = Dynamic;
/** What an ESLint launch of one side records. */
interface EslintLaunch { side: string; skipped?: string; scopeError?: string; cwd?: string; expected?: string[]; run?: Promise<LinterRun> }

// --side judges only that side; root HFS findings belong to be, its Sonar report stays on that side.
export const LINT_SCHEMA = 'starci/lint@1';
/** The side whose stylesheets stylelint judges. */
const STYLE_SIDE = 'fe';
const CODE_PREFIX = /^\[([A-Z][A-Z0-9_]+)\] /;
const posix = (file: unknown): string => String(file).replace(/\\/g, '/').replace(/^\.\//, '');
/** An npm workspace of the fe side, app-relative: one folder below fe/apps or fe/packages (the root package.json workspaces). */
const WORKSPACE = /^fe\/(?:apps|packages)\/[a-z0-9][a-z0-9-]*$/;

/** The app-relative workspace of `opts.workspace` (already app-relative), or a refusal when it is not one folder of fe/apps or fe/packages. */
export function workspaceOf(workspace: string): string {
  const rel = posix(workspace).replace(/\/+$/, '');
  if (!WORKSPACE.test(rel)) throw new Error(`--workspace ${workspace} is not an fe workspace (fe/apps/<app> or fe/packages/<pkg>, from the app root)`);
  return rel;
}

/** Side scopes partition the full lint; Sonar reports share that scope and a frontend workspace cannot belong to be. */
function validateSide(opts: { side?: string | undefined; workspace?: string | undefined }): void {
  if (opts.side === undefined) return;
  if (!isSide(opts.side)) throw new Error('LINT_SIDE_INVALID: --side is be or fe');
  if (opts.side === 'be' && opts.workspace !== undefined) throw new Error('LINT_SIDE_WORKSPACE_CONFLICT: --side be cannot judge a frontend workspace');
}

/** Side findings stay with their side; findings outside both sides belong to the backend lint. */
function findingOnSide(finding: { path?: string | null | undefined }, side: string | undefined): boolean {
  if (side === undefined) return true;
  const file = posix(finding.path ?? '');
  const owner = SIDES.find((candidate: string) => file === candidate || file.startsWith(`${candidate}/`));
  return (owner ?? 'be') === side;
}

/** The flags of `starci app lint`; `--changed` takes every argument up to the next flag, and a repeated `--changed` adds to the list (the
 *  catalog's list flag, `--changed a --changed b`, as the CLI dispatcher passes it through). */
export function parseLintArgs(argv: readonly string[]): LintOptions {
  const opts: LintOptions = { changed: null, fix: false, format: 'text', sonar: undefined, workspace: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--changed') {
      opts.changed ??= [];
      while (i + 1 < argv.length && !(argv[i + 1] as string).startsWith('--')) opts.changed.push(posix(argv[++i]));
    } else if (arg === '--fix') opts.fix = true;
    else if (arg === '--json') opts.format = 'json';
    else if (['--format', '--sonar', '--workspace', '--side'].includes(arg)) {
      if (arg === '--side' && (argv[i + 1] === undefined || (argv[i + 1] as string).startsWith('--'))) throw new Error('LINT_SIDE_INVALID: --side needs be or fe');
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      (opts as unknown as Record<string, unknown>)[arg.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${arg}`);
  }
  if (!['text', 'json'].includes(opts.format)) throw new Error('--format is text or json');
  if (opts.workspace !== undefined && opts.changed !== null) throw new Error('--workspace and --changed do not combine: a workspace lint judges the whole workspace');
  validateSide(opts);
  return opts;
}

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

/** The child `node` ran with `args` from `cwd`: its exit status, signal, spawn error and the text of both streams, once it closes. */
function runNode(args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<{ status: number | null; signal: NodeJS.Signals | null; error?: Error | undefined; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(process.execPath, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { resolve({ status: 2, signal: null, error: error as Error, stdout: '', stderr: String((error as Error | undefined)?.message ?? error) }); return; }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let failure: Error | undefined;
    (child.stdout as NodeJS.ReadableStream).on('data', (chunk: Buffer) => out.push(chunk));
    (child.stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => { failure = error; });
    child.on('close', (status, signal) => resolve({ status, signal, error: failure, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

/** A linter's json results through the app's own install, run from `cwd` (a side folder): `{ results }` or `{ error }`. The child runs while the caller goes on. */
export async function runLinter({ cwd, pkg, bin, args, bound = null }: { cwd: string; pkg: string; bin: string; args: string[]; bound?: string | null }): Promise<LinterRun> {
  let entry: string;
  try {
    const manifest = createRequire(path.join(cwd, 'package.json')).resolve(`${pkg}/package.json`);
    const declared = JSON.parse(fs.readFileSync(manifest, 'utf8')).bin;
    entry = path.join(path.dirname(manifest), typeof declared === 'string' ? declared : declared[bin]);
  } catch {
    return { error: `${pkg} is not installed for ${cwd}` };
  }
  const heap = pkg === 'eslint' ? eslintHeapArgs() : [];
  const run = await runNode([...heap, ...(bound ? linterBoundArgs() : []), entry, ...args], { cwd, ...(bound ? { env: { ...process.env, [BOUND_ENV]: bound } } : {}) });
  // ESLint prints its report on stdout; stylelint uses stderr. JSON does not prove a completed child: only exits 0/1
  // without a spawn error or signal are measurable, and exit 1 must carry findings.
  let results: Dynamic;
  try { results = JSON.parse(run.stdout.trim() || run.stderr); } catch { return { error: `${pkg} produced no json report in ${path.basename(cwd)}/ (exit ${run.status}): ${String(run.stderr || run.stdout).trim().split('\n').slice(0, 8).join(' | ')}` }; }
  if (!Array.isArray(results)) return { error: `${pkg} produced a report that is not a result list` };
  const completed = !run.error && !run.signal && [0, 1].includes(run.status as number)
    && (run.status === 0 || results.some((result: Dynamic) => result?.messages?.length || result?.warnings?.length));
  return { results, ...(completed ? {} : { error: `${pkg} could not complete in ${path.basename(cwd)}/ (exit ${run.status}, signal ${run.signal ?? 'none'}): ${String(run.error?.message || run.stderr || run.stdout || '').trim().split('\n')[0]}` }) };
}

const eslintFindings = (results: readonly Dynamic[], appRoot: string): LintFinding[] => results.flatMap((result) => (result.messages ?? []).map((message: Dynamic): LintFinding => ({
  engine: 'eslint', rule: message.ruleId ?? 'eslint-error', code: CODE_PREFIX.exec(message.message ?? '')?.[1] ?? null, severity: 'error',
  path: posix(path.relative(appRoot, result.filePath)), line: message.line ?? null, column: message.column ?? null, message: message.message,
})));

const stylelintFindings = (results: readonly Dynamic[], appRoot: string): LintFinding[] => results.flatMap((result) => (result.warnings ?? []).map((warning: Dynamic): LintFinding => ({
  engine: 'stylelint', rule: warning.rule || 'stylelint-error', code: null, severity: 'error',
  path: posix(path.relative(appRoot, result.source)), line: warning.line ?? null, column: warning.column ?? null, message: warning.text,
})));

const byLocation = (a: LintFinding, b: LintFinding): number => `${a.path ?? ''}:${String(a.line ?? 0).padStart(7, '0')}:${a.rule}`.localeCompare(`${b.path ?? ''}:${String(b.line ?? 0).padStart(7, '0')}:${b.rule}`);

/** The files of `changed` (app-relative) below `side`/, relative to the side folder. */
const onSide = (changed: readonly string[], side: string): string[] => changed.filter((file) => file.startsWith(`${side}/`)).map((file) => file.slice(side.length + 1));

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
async function sourceFiles({ repoRoot, cwd, side, scope: folderScope }: { repoRoot: string; cwd: string; side: string; scope: string | null }): Promise<string[]> {
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
  visit(folderScope ?? '');
  return files.sort(byCodeUnit);
}

/** Every requested source needs an explicit, well-formed result; suppressed findings and foreign paths cannot witness a completed lint. */
function checkedEslintResults({ results, expected, cwd, scope, changed }: { results: readonly Dynamic[]; expected: readonly string[]; cwd: string; scope: string | null; changed: boolean }): { results: Dynamic[]; errors: string[] } {
  const required = new Set(expected.map((file) => fileKey(path.join(cwd, file))));
  const seen = new Set<string>(), valid: Dynamic[] = [], errors: string[] = [];
  for (const result of results) {
    if (!result || typeof result.filePath !== 'string' || !path.isAbsolute(result.filePath) || !Array.isArray(result.messages)
      || result.messages.some((message: Dynamic) => !message || typeof message.message !== 'string')
      || (result.suppressedMessages !== undefined && !Array.isArray(result.suppressedMessages))) {
      errors.push('eslint produced a malformed file result'); continue;
    }
    const key = fileKey(result.filePath);
    if (!inside(cwd, result.filePath) || (scope && !inside(path.join(cwd, scope), result.filePath)) || (changed && !required.has(key))) {
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

const ESLINT_ARGV_BUDGET = 24_000;
const ESLINT_CONCURRENCY = 3;
/** A launch that threw instead of returning a record is a tool error of the run (exit 2), not a crash of the CLI. */
const spawnFailure = (error: unknown) => ({ error: `could not start eslint: ${String((error as Error | undefined)?.message ?? error)}` });

/** Starts the ESLint child of every side that has work and returns one record per side: skipped, a scope error, or the running child. */
async function launchEslint({ app, repoRoot, opts, changed, existing, workspace, onFe, run = runLinter }: {
  app: RepoDeclaration; repoRoot: string; opts: { side?: string | undefined; fix?: boolean }; changed: unknown; existing: readonly string[]; workspace: string | null; onFe: string | null; run?: LinterRunner | undefined;
}): Promise<EslintLaunch[]> {
  const launches: EslintLaunch[] = [];
  for (const side of app ? SIDES.filter((candidate: string) => opts.side === undefined || opts.side === candidate) : []) {
    if (workspace !== null && side !== STYLE_SIDE) { launches.push({ side, skipped: `outside --workspace ${workspace}` }); continue; }
    const sources = onSide(existing, side).filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
    if (changed !== null && !sources.length) { launches.push({ side, skipped: 'no changed source file' }); continue; }
    const cwd = path.join(repoRoot, side);
    let expected: string[];
    try { expected = changed ? sources : await sourceFiles({ repoRoot, cwd, side, scope: onFe }); }
    catch (error) { launches.push({ side, scopeError: `eslint source scope is unavailable in ${side}/: ${String((error as Error | undefined)?.message ?? error)}` }); continue; }
    const head = ['--format', 'json', ...(opts.fix ? ['--fix'] : [])];
    const launch = (files: string[]): Promise<LinterRun> => Promise.resolve().then(() => run({ cwd, pkg: 'eslint', bin: 'eslint', args: [...head, ...files], bound: repoRoot }));
    // A diff of hundreds of files exceeds the Windows command line: the sources go in chunks and the reports are merged.
    const chunks = changed ? chunkByChars(sources, ESLINT_ARGV_BUDGET) : [[onFe ?? '.']];
    launches.push({ side, cwd, expected, run: chunks.length === 1 ? launch(chunks[0] as string[]).catch(spawnFailure) : mapBounded(chunks, launch, ESLINT_CONCURRENCY).then(mergeRuns) });
  }
  return launches;
}

/** Execute each side's installed ESLint config once; check and lint share scope, coverage and tool-failure judgment. */
export async function eslintRepository({ repoRoot, app = readRepoDeclaration(loadSlotManifest(), repoRoot), opts = {}, changed = null, existing = [], workspace = null, onFe = null, run }: {
  repoRoot: string; app?: RepoDeclaration; opts?: { side?: string | undefined; fix?: boolean }; changed?: readonly string[] | null; existing?: readonly string[]; workspace?: string | null; onFe?: string | null; run?: LinterRunner | undefined;
}): Promise<{ findings: LintFinding[]; errors: string[]; raw: Dynamic[]; engine: { sides: Record<string, { files: number; skipped?: string }> } }> {
  const findings: LintFinding[] = [], errors: string[] = [], raw: Dynamic[] = [];
  const engine: { sides: Record<string, { files: number; skipped?: string }> } = { sides: {} };
  if (!app.sides) throw new Error('ESLint runs at the app root, the folder of hfs.json');
  const launches = await launchEslint({ app, repoRoot, opts, changed, existing, workspace, onFe, run });
  const runs = await Promise.all(launches.map(launch => launch.run ?? null)) as (LinterRun | null)[];
  launches.forEach((launch, at) => {
    const { side } = launch;
    if (launch.skipped) { engine.sides[side] = { files: 0, skipped: launch.skipped }; return; }
    if (launch.scopeError) { errors.push(launch.scopeError); engine.sides[side] = { files: 0 }; return; }
    const linted = runs[at] as LinterRun;
    if (linted.error) errors.push(linted.error);
    if (linted.results) {
      const checked = checkedEslintResults({ results: linted.results, expected: launch.expected as string[], cwd: launch.cwd as string, scope: onFe, changed: changed !== null });
      errors.push(...checked.errors);
      linted.results = checked.results;
      const appRelative = appRelativeMessages(side, path.join(repoRoot, side));
      for (const result of linted.results) for (const message of result.messages ?? []) message.message = appRelative(message.message);
      raw.push(...linted.results);
      findings.push(...eslintFindings(linted.results, repoRoot));
    }
    engine.sides[side] = { files: linted.results?.length ?? 0 };
  });
  return { findings, errors, raw, engine };
}

/** Starts stylelint over the fe stylesheets (the running child), or returns null when no stylesheet is in scope. */
function launchStylelint({ repoRoot, opts, changed, existing, onFe }: { repoRoot: string; opts: { side?: string | undefined; fix?: boolean }; changed: unknown; existing: readonly string[]; onFe: string | null }): Promise<LinterRun> | null {
  if (opts.side === 'be') return null;
  const styles = onSide(existing, STYLE_SIDE).filter((file) => file.endsWith('.css'));
  if (changed !== null && !styles.length) return null;
  return runLinter({ cwd: path.join(repoRoot, STYLE_SIDE), pkg: 'stylelint', bin: 'stylelint', args: [...(changed ? styles : [onFe ? `${onFe}/src/**/*.css` : STYLE_GLOB]), '--formatter', 'json', ...(opts.fix ? ['--fix'] : [])] });
}

/**
 * Run the whole lint of the app at `repoRoot`. `hfsCheck(repoRoot)` returns the `starci app check` result (`{ findings, tracked }`); the CLI
 * injects it. Returns `{ report, sonar, exit }`; `sonar` is the merged Generic Issue Import document.
 */
export async function lintRepository({ repoRoot, opts, hfsCheck, trackedFiles = () => [], runLinter: linter }: {
  repoRoot: string; opts: LintOptions; hfsCheck: (repoRoot: string) => Dynamic; trackedFiles?: (repoRoot: string) => string[]; runLinter?: LinterRunner | undefined;
}): Promise<{ report: Dynamic; sonar: Dynamic; exit: number }> {
  const changed = opts.changed === null ? null : new Set(opts.changed);
  const errors: string[] = [];
  let workspace: string | null = null;
  let validSide = true;
  try { validateSide(opts); } catch (error) { errors.push(String((error as Error | undefined)?.message ?? error)); validSide = false; }
  if (opts.workspace !== undefined) {
    try { workspace = workspaceOf(opts.workspace); } catch (error) { errors.push(String((error as Error | undefined)?.message ?? error)); }
  }
  /** Whether an app-relative path lies inside the scoped workspace. */
  const inWorkspace = (file: string): boolean => posix(file).startsWith(`${workspace}/`);
  const existing = changed ? [...changed].filter((file) => fs.existsSync(path.join(repoRoot, file))) : [];
  const findings: LintFinding[] = [];
  const raw: { eslint: Dynamic[]; stylelint: Dynamic[] } = { eslint: [], stylelint: [] };
  const engines: Record<string, unknown> = {};

  let app: RepoDeclaration = null;
  try { app = readRepoDeclaration(loadSlotManifest(), repoRoot); } catch (error) { errors.push(`starci app lint runs at the app root: ${String((error as Error | undefined)?.message ?? error)}`); }
  if (app && !app.sides) { errors.push(`${repoRoot} is the ${app.side} side of an app; starci app lint runs at the app root, the folder of hfs.json`); app = null; }
  if (!validSide || (opts.workspace !== undefined && workspace === null)) app = null;
  if (workspace !== null && !fs.existsSync(path.join(repoRoot, workspace, 'package.json'))) { errors.push(`--workspace ${workspace} holds no package.json; it is not a workspace of this app`); app = null; }
  /** The workspace folder relative to the fe side folder (apps/<app> or packages/<pkg>). */
  const onFe = workspace === null ? null : workspace.slice(STYLE_SIDE.length + 1);

  // The linters and the app check are independent: every child starts first, the app check runs while they work, and the results are read in a fixed order.
  const eslintRun = app ? eslintRepository({ app, repoRoot, opts, changed: changed ? [...changed] : null, existing, workspace, onFe, run: linter }) : null;
  const styleLaunch = app ? launchStylelint({ repoRoot, opts, changed, existing, onFe }) : null;
  const checkRun = app ? Promise.resolve().then(() => hfsCheck(repoRoot)).then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error })) : null;

  // 1. ESLint, once per side, from the side folder with that side's config.
  const eslint = eslintRun ? await eslintRun : { engine: { sides: {} }, errors: [], raw: [], findings: [] };
  engines.eslint = eslint.engine;
  errors.push(...eslint.errors);
  raw.eslint.push(...eslint.raw);
  findings.push(...eslint.findings);

  // 3. stylelint over the fe side's stylesheets.
  if (app) {
    if (styleLaunch) {
      const linted = await styleLaunch;
      if (linted.error) errors.push(linted.error);
      if (linted.results) {
        const appRelative = appRelativeMessages(STYLE_SIDE, path.join(repoRoot, STYLE_SIDE));
        for (const result of linted.results) for (const warning of result.warnings ?? []) warning.text = appRelative(warning.text);
        raw.stylelint = linted.results;
        findings.push(...stylelintFindings(linted.results, repoRoot));
      }
    }
    engines.stylelint = { side: STYLE_SIDE, files: raw.stylelint.length };
  }

  // 2. The app check: root and sides.
  let checked: Dynamic = { findings: [] };
  if (checkRun) {
    const settled = await checkRun;
    if (settled.error) errors.push(`starci app check could not run: ${String((settled.error as Error | undefined)?.message ?? settled.error)}`);
    else checked = settled.value;
  }
  const repoErrors = checked.findings.filter((finding: Dynamic) => finding.level === 'error' && findingOnSide(finding, opts.side));
  // A workspace lint keeps only the app findings inside the workspace; the rest belong to the root lint of the whole app.
  const kept = workspace !== null
    ? repoErrors.filter((finding: Dynamic) => finding.path && inWorkspace(finding.path))
    : changed === null ? repoErrors : repoErrors.filter((finding: Dynamic) => !finding.path || changed.has(posix(finding.path)));
  for (const finding of kept) {
    findings.push({ engine: 'hfs', rule: finding.code, code: finding.code, severity: 'error', path: finding.path ? posix(finding.path) : null, line: finding.line ?? null, column: finding.column ?? null, message: finding.message, titleVi: finding.titleVi, nextStepVi: finding.nextStepVi });
  }
  engines.hfs = { findings: kept.length };
  findings.sort(byLocation);

  let properties = '';
  try { properties = fs.readFileSync(path.join(repoRoot, 'sonar-project.properties'), 'utf8'); } catch { /* no properties: every finding keeps its own path */ }
  const sourceRoots = sourceRootsOf(properties).filter((root: string) => findingOnSide({ path: root }, opts.side));
  const tracked = sourceRoots.length ? trackedFiles(repoRoot) : [];
  const sonar = mergeReports([
    sonarReport(kept, { sourceRoots, tracked }),
    linterReport('eslint', raw.eslint, { root: repoRoot, sourceRoots, tracked }),
    linterReport('stylelint', raw.stylelint, { root: repoRoot, sourceRoots, tracked }),
  ]);
  // Green under the threshold (gate-threshold.mjs): every finding is still reported, only the verdict changes.
  const gate = gateVerdict(findings);
  const report = { schema: LINT_SCHEMA, ok: gate.pass && errors.length === 0, repoRoot, changed: changed ? [...changed].sort(byCodeUnit) : null, workspace, ...(opts.side === undefined ? {} : { side: opts.side }), counts: { error: findings.length }, engines, errors, findings, gate };
  return { report, sonar, exit: errors.length ? 2 : gate.pass ? 0 : 1 };
}

export function printLintText(report: Dynamic, out: (text: string) => unknown): void {
  for (const f of report.findings as LintFinding[]) out(`${f.path ?? '-'}${f.line ? `:${f.line}${f.column ? `:${f.column}` : ''}` : ''}  ${f.engine}/${f.rule}  ${f.message}\n`);
  for (const e of report.errors as string[]) out(`ERROR ${e}\n`);
  const per = Object.keys(report.engines).map((engine) => `${engine} ${report.findings.filter((f: LintFinding) => f.engine === engine).length}`).join(', ');
  out(`\nstarci app lint: ${report.counts.error} finding${report.counts.error === 1 ? '' : 's'} (${per})${report.errors.length ? `, ${report.errors.length} tool error${report.errors.length === 1 ? '' : 's'}` : ''}\n`);
  if (report.gate?.line) out(`${report.gate.line}\n`);
}
