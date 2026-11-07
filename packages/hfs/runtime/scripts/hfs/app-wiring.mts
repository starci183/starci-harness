// R272: compile the actual Nest AppModule in a child, with explicit infrastructure doubles.
// Dynamic roots need public fixture options: src/tests/fixtures/builders/<app>.builder.ts may export
// buildWiringProof(AppModule) => { options, overrides: [{ token, value }], request? }. The runner always chooses
// the real root; a fixture cannot substitute an empty module. No environment parser or main.ts runs.
// The proof worker has its own budget, counted from its spawn: STARCI_BOOT_PROOF_TIMEOUT_MS, which the starci CLI sets from ops/liveness.yaml
// (heavy.bootProofTimeoutSeconds). A worker that runs out of it reached no verdict: it is retried once, and a second timeout is reported as
// BOOT_PROOF_TIMEOUT (a warning: the host was too loaded to judge), never as the proof failing (BE_APP_BOOT_PROOF_MISSING).
// The worker reports what the boot loaded (its CommonJS module cache: the root folder of each installed package, every other file, absolute), which the check
// cache keys the proof on (cache/wiring-family.mts); a worker that reports no list leaves the run's `loaded` null.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runNode, runHeavyNode, type HeavyNodeRun, type HeavyNodeResult } from '../api/node/run-node.mjs';
import { fileURLToPath } from 'node:url';
import { invocationDir } from '../lib/roots.mjs';
import { isMain } from '../lib/is-main.mjs';
import { readJson } from './rules/read.mjs';

export const BOOT_PROOF_CODE = 'BE_APP_BOOT_PROOF_MISSING';
export const BOOT_PROOF_TIMEOUT = 'BOOT_PROOF_TIMEOUT';
export const BOOT_PROOF_TIMEOUT_ENV = 'STARCI_BOOT_PROOF_TIMEOUT_MS';
const WORKER = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT = 15000;
const DI_FAILURES = new Map([
  ['UnknownDependenciesException', 'unresolved DI provider'],
  ['CircularDependencyException', 'circular DI dependency'],
  ['UndefinedModuleException', 'undefined or circular module import'],
  ['WiringTimeout', 'DI compilation timed out'],
]);
const COMPILATION_FAILURE = 'module or proof could not be compiled';
const WORKER_FAILURE = 'proof worker failed or timed out';
const SAFE_REASONS = new Set([...DI_FAILURES.values(), COMPILATION_FAILURE]);
const modulePath = (app: string): string => `apps/${app}/src/app.module.ts`;
export const wiringFixturePath = (app: string): string => `src/tests/fixtures/builders/${app}.builder.ts`;

/** What the proof worker's spawn returns (spawnSync-shaped); `run` seams may return it or nothing. */
export type WorkerResult = { status?: number | null; signal?: string | null; error?: HeavyNodeResult['error']; stdout?: string } | null | undefined;
/** The injectable spawn seam of the worker. */
export type WorkerRun = (command: string, args: string[], options: object) => WorkerResult;
/** The public fixture contract: what buildWiringProof(AppModule) returns. */
export interface WiringProof { options?: unknown; overrides?: { token: unknown; value: unknown }[]; request?: unknown }
/** The repository descriptor (hfs.json) fields this check reads. */
export interface WiringRepo { edition?: string | undefined; profile?: string | undefined; kind?: string | undefined; sides?: { be?: { apps?: readonly { name: string }[] | undefined } | undefined }; apps?: readonly { name: string }[] | undefined }
/** The shape of an appWiring run. */
export interface WiringResult {
  ok: boolean; status: string; findings: WiringFinding[]; apps: string[];
  /** What every proof worker of the run loaded (absolute paths, sorted), or null when a worker reported no list (it did not run or did not answer). */
  loaded: string[] | null;
}

/** One boot-proof finding: a refusal (error) or a timeout (warning). */
export type WiringFinding = { code: string; level: 'error' | 'warning'; path: string; message: string; reason: string };

const refusal = (file: string, reason: string): WiringFinding => ({ code: BOOT_PROOF_CODE, level: 'error', path: file,
  message: `${file}: lite boot proof failed (${reason}); compile the real AppModule with explicit fixture options and infrastructure doubles using starci app check --gate wiring`, reason });

const timedOut = (file: string, budget: number): WiringFinding => ({ code: BOOT_PROOF_TIMEOUT, level: 'warning', path: file, reason: 'proof worker timed out',
  message: `${file}: the lite boot proof reached no verdict: its worker ran out of its ${Math.round(budget / 1000)} s budget twice (the host is loaded); this is no failure of the proof, rerun starci app check --gate wiring when the host is quieter` });

/** The worker's budget in ms, from its spawn: the CLI's STARCI_BOOT_PROOF_TIMEOUT_MS, else four compile deadlines (at least a minute). */
export function workerBudget(timeout: number, env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env[BOOT_PROOF_TIMEOUT_ENV]);
  return Number.isInteger(configured) && configured > 0 ? configured : Math.max(60000, timeout * 4) + 2000;
}

/** True when the worker was stopped by its budget (spawnSync's ETIMEDOUT, or the kill signal it sends), not when it ended by itself. */
const isTimeout = (result: WorkerResult): boolean => result?.error?.code === 'ETIMEDOUT' || (result?.status === null && result?.signal != null);

/** Stable diagnostics never forward exception text, source values or child output. */
function failureReason(error: unknown): string {
  // Nest exceptions inherit Error.name; their constructor identifies the refusal.
  const loose = error as { constructor?: { name?: string }; name?: string } | null | undefined;
  return DI_FAILURES.get(loose?.constructor?.name as string) ?? DI_FAILURES.get(loose?.name as string) ?? COMPILATION_FAILURE;
}

/** Nest bootstrap defers request/transient trees: prove them in their original module's scope too. */
// reason: the Nest testing builder, Nest core and compiled container are dynamically required third-party objects.
async function compileGraph(builder: any, Nest: any, request: unknown): Promise<void> {
  const compiled = await builder.compile();
  const { ContextIdFactory, ModuleRef } = Nest;
  const contextId = ContextIdFactory.create();
  compiled.registerRequestByContextId(request, contextId);
  const resolutions: (() => Promise<unknown>)[] = [];
  // Read the actual compiled container, not an application provider claiming to be ModulesContainer.
  for (const module of compiled.container.getModules().values()) {
    // Native REQUEST/INQUIRER factories belong to Nest itself; their empty result is intentional.
    if (module === compiled.container.getInternalCoreModuleRef()) continue;
    const moduleRef = module.providers.get(ModuleRef)?.instance;
    for (const wrappers of [module.providers, module.controllers, module.injectables]) {
      for (const wrapper of wrappers.values()) {
        if (wrapper.isTransient || !wrapper.isDependencyTreeStatic()) {
          resolutions.push(() => moduleRef.resolve(wrapper.token, contextId, { strict: true }));
        }
      }
    }
  }
  await Promise.all(resolutions.map(resolve => resolve()));
}

/** Compile a real root, with overrides of existing tokens only; never auto-mock an unresolved dependency. */
interface CompileInput {
  // reason: AppModule, Test and Nest are dynamically required from the app's own installed packages.
  AppModule: any; options?: unknown; overrides?: { token: unknown; value: unknown }[]; request?: unknown; Test: any; Nest: any; timeout?: number
}

async function compileAppModule({ AppModule, options, overrides = [], request = {}, Test, Nest, timeout = DEFAULT_TIMEOUT }: CompileInput): Promise<void> {
  if (typeof AppModule !== 'function') throw new Error('the actual AppModule is missing');
  if (typeof AppModule.register === 'function' && options === undefined) throw new Error('dynamic AppModule needs fixture options');
  const root = typeof AppModule.register === 'function' ? await AppModule.register(options) : AppModule;
  if (root?.module && root.module !== AppModule) throw new Error('registration must return the actual AppModule');
  const builder = Test.createTestingModule({ imports: [root] });
  for (const override of overrides) {
    if (!override || !Object.hasOwn(override, 'token') || !Object.hasOwn(override, 'value')) throw new Error('an infrastructure double needs a token and value');
    builder.overrideProvider(override.token).useValue(override.value);
  }
  let deadline: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => { deadline = setTimeout(() => {
    const error = new Error('compilation deadline'); error.name = 'WiringTimeout'; reject(error);
  }, timeout); });
  try {
    // compile proves DI. Neither init nor close runs: both invoke application lifecycle hooks.
    // The isolated worker exits naturally once every infrastructure resource has a double.
    await Promise.race([compileGraph(builder, Nest, request), expired]);
  } finally { clearTimeout(deadline); }
}

/** The strict in-memory TS loader uses this app's installed compiler and Nest, including inherited aliases. */
// reason: returns the app's own CommonJS require, whose modules are untyped.
function sourceLoader(repoRoot: string, entry: string, fixture: string | null): NodeJS.Require {
  const require = createRequire(path.join(repoRoot, 'package.json'));
  const ts = require('typescript') as typeof import('typescript'); // reason: the app's installed compiler, not this package's
  const config = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tsconfig.json'), {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => { throw new Error('invalid TypeScript project'); } });
  if (!config || config.errors.length) throw new Error('invalid TypeScript project');
  const options = { ...config.options, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    experimentalDecorators: true, emitDecoratorMetadata: true, noEmit: false, noEmitOnError: false,
    declaration: false, declarationMap: false, sourceMap: false, inlineSourceMap: false,
    incremental: false, composite: false, tsBuildInfoFile: undefined, outDir: undefined, rootDir: undefined } as unknown as import('typescript').CompilerOptions; // exactOptionalPropertyTypes rejects the explicit undefineds that reset the project's output options
  const program = ts.createProgram({ rootNames: [entry, ...(fixture ? [fixture] : [])], options });
  if (program.getSyntacticDiagnostics().length) throw new Error('invalid TypeScript source');
  const outputs = new Map<string, string>();
  program.emit(undefined, (file, text, _bom, _error, sources) => {
    if (file.endsWith('.js')) for (const source of sources ?? []) outputs.set(path.resolve(source.fileName), text);
  });
  // reason: Module._resolveFilename is a private Node internal with no declared type; `require` answers any, so the shape is stated by the declaration.
  const NodeModule: ResolverInternals = require('node:module');
  const resolve = NodeModule._resolveFilename;
  NodeModule._resolveFilename = function resolveSource(this: unknown, request: string, parent: { filename?: string } | undefined, ...rest: unknown[]) {
    if (parent?.filename && (request.startsWith('.') || Object.keys(options.paths ?? {}).some((alias) => request.startsWith(alias.replace(/\*$/, ''))))) {
      const resolved = ts.resolveModuleName(request, parent.filename, options, ts.sys).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith('.d.ts')) return resolved.resolvedFileName;
    }
    return resolve.call(this, request, parent, ...rest);
  };
  // reason: Module#_compile is a private Node internal with no declared type.
  require.extensions['.ts'] = (loaded: NodeJS.Module, file: string) => {
    const output = outputs.get(path.resolve(file));
    if (output === undefined) throw new Error('source is outside the compiled graph');
    (loaded as NodeJS.Module & CompilableModule)._compile(output, file);
  };
  require('reflect-metadata');
  return require;
}

/** A loaded CommonJS module with the private `_compile` the source loader runs the emitted JavaScript through. */
interface CompilableModule { _compile(code: string, filename: string): void }

/** Node's private module resolver hook, as far as the source loader overrides it. */
interface ResolverInternals { _resolveFilename(request: string, parent: { filename?: string } | undefined, ...rest: unknown[]): string }

interface WorkerInput { repoRoot: string; app: string; fixture: string | null; timeout: number }

async function wiringWorker({ repoRoot, app, fixture, timeout }: WorkerInput): Promise<void> {
  // Disable network entry points before loading application source. A forgotten resource double is a refusal.
  const systemRequire = createRequire(import.meta.url);
  const patched: [string, string[]][] = [['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
    ['node:http', ['request', 'get']], ['node:https', ['request', 'get']]];
  for (const [packageName, methods] of patched) {
    const api = systemRequire(packageName) as Record<string, unknown>;
    for (const method of methods) api[method] = () => { throw new Error('wiring needs an infrastructure double'); };
  }
  systemRequire('node:net').Socket.prototype.connect = () => { throw new Error('wiring needs an infrastructure double'); };
  systemRequire('node:net').Server.prototype.listen = () => { throw new Error('wiring needs an infrastructure double'); };
  globalThis.fetch = () => { throw new Error('wiring needs an infrastructure double'); };
  const entry = path.join(repoRoot, modulePath(app));
  const fixtureFile = fixture ? path.join(repoRoot, fixture) : null;
  const require = sourceLoader(repoRoot, entry, fixtureFile);
  const { AppModule } = require(entry);
  const proof = fixtureFile ? await require(fixtureFile).buildWiringProof(AppModule) : {};
  if (!proof || typeof proof !== 'object') throw new Error('invalid wiring fixture');
  await compileAppModule({ AppModule, options: proof.options, overrides: proof.overrides, request: proof.request,
    Test: require('@nestjs/testing').Test, Nest: require('@nestjs/core'), timeout });
}

function wiringApps(repo: WiringRepo, files: string[] | undefined, prefix: string): string[] {
  const declared = (repo.sides?.be?.apps ?? repo.apps ?? []).map((app) => app.name);
  const observed = (files ?? []).flatMap((file) => {
    const match = file.match(new RegExp(String.raw`^${prefix}apps/([^/]+)/src/app\.module\.ts$`));
    return match?.[1] !== undefined ? [match[1]] : [];
  });
  return [...new Set([...declared, ...observed])];
}

interface FindingInput { repoRoot: string; beRoot: string; prefix: string; app: string; files: string[] | undefined; fixtures: Record<string, string>; timeout: number }

interface WorkerCommand { args: string[]; options: { cwd: string; encoding: 'utf8'; env: NodeJS.ProcessEnv; windowsHide: boolean; timeout: number; maxBuffer: number } }

/** What the worker's module cache held: the root folder of each installed package (through its last `node_modules/<name>` or `node_modules/@scope/name`) and every other file, absolute, sorted. */
export function loadedModules(paths: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const file of paths) {
    if (!path.isAbsolute(file)) continue;
    const parts = file.split(/[\\/]/u);
    const at = parts.lastIndexOf('node_modules');
    out.add(at < 0 ? file : parts.slice(0, at + ((parts[at + 1] ?? '').startsWith('@') ? 3 : 2)).join(path.sep));
  }
  return [...out].sort();
}

/** One app's proof: its finding (null when it booted) and what its worker loaded (null when the worker reported nothing). */
interface AppProof { finding: WiringFinding | null; loaded: string[] | null }

function* appWiringFinding({ repoRoot, beRoot, prefix, app, files, fixtures, timeout }: FindingInput): Generator<WorkerCommand, AppProof, WorkerResult> {
  const file = `${prefix}${modulePath(app)}`;
  if (!/^[a-z][a-z0-9-]*$/.test(app) || !fs.existsSync(path.join(repoRoot, file)) || (files && !files.includes(file))) {
    return { finding: refusal(file, 'app module is missing'), loaded: [] };
  }
  const fixture = fixtures[app] ?? wiringFixturePath(app);
  const fixtureExists = fs.existsSync(path.join(beRoot, fixture)) && (!files || files.includes(`${prefix}${fixture}`));
  const args = [WORKER, '--worker', JSON.stringify({ repoRoot: beRoot, app, fixture: fixtureExists ? fixture : null, timeout })];
  const budget = workerBudget(timeout);
  const options = { cwd: beRoot, encoding: 'utf8' as const, env: {}, windowsHide: true, timeout: budget, maxBuffer: 1024 * 1024 };
  let result = yield { args, options };
  if (isTimeout(result)) result = yield { args, options };
  if (isTimeout(result)) return { finding: timedOut(file, budget), loaded: null };
  let proof: { ok?: boolean; reason?: string; loaded?: unknown } | undefined;
  try { proof = JSON.parse(result?.stdout ?? ''); } catch { /* Output from app source cannot serve as a proof. */ }
  const loaded = Array.isArray(proof?.loaded) && proof.loaded.every((entry) => typeof entry === 'string') ? proof.loaded as string[] : null;
  if (result?.status !== 0 || proof?.ok !== true) return { finding: refusal(file, SAFE_REASONS.has(proof?.reason as string) ? (proof?.reason as string) : WORKER_FAILURE), loaded };
  return { finding: null, loaded };
}

/** Synchronous check seam for the dispatcher and content finder. Paths in findings are relative to repoRoot. */
export interface AppWiringInput { repoRoot: string; repo?: WiringRepo; files?: string[]; fixtures?: Record<string, string>; timeout?: number; run?: WorkerRun }

function* wiringProgram({ repoRoot, repo = readJson(repoRoot, 'hfs.json'), files, fixtures = {}, timeout = DEFAULT_TIMEOUT }: AppWiringInput): Generator<WorkerCommand, WiringResult, WorkerResult> {
  if (repo?.edition !== 'lite' || repo?.profile === 'fe' || repo?.kind === 'fe') return { ok: true, status: 'skipped', findings: [], apps: [], loaded: [] };
  const appRoot = Boolean(repo.sides);
  const beRoot = appRoot ? path.join(repoRoot, 'be') : repoRoot;
  const prefix = appRoot ? 'be/' : '';
  const apps = wiringApps(repo, files, prefix);
  const findings: WiringFinding[] = [];
  let loaded: Set<string> | null = new Set();
  for (const app of apps) {
    const proof = yield* appWiringFinding({ repoRoot, beRoot, prefix, app, files, fixtures, timeout });
    if (proof.finding) findings.push(proof.finding);
    loaded = loaded === null || proof.loaded === null ? null : new Set([...loaded, ...proof.loaded]);
  }
  return { ok: findings.length === 0, status: 'checked', apps, findings, loaded: loaded === null ? null : [...loaded].sort() };
}

/** The synchronous finder and its existing worker doubles drive the same proof program as app check. */
export function appWiring(input: AppWiringInput): WiringResult {
  const program = wiringProgram(input);
  let step = program.next();
  while (!step.done) {
    const { args, options } = step.value;
    step = program.next(input.run ? input.run(process.execPath, args, options) : runNode(args, options));
  }
  return step.value;
}

/** The cache's asynchronous execution seam admits each boot attempt, with the same validation, timeout retry and result judgement. */
export async function appWiringAsync(input: Omit<AppWiringInput, 'run'> & { execute?: HeavyNodeRun | undefined }): Promise<WiringResult> {
  const program = wiringProgram(input);
  let step = program.next();
  while (!step.done) {
    const { args, options } = step.value;
    const result = await runHeavyNode(input.execute, { kind: 'test', label: 'app check wiring boot proof', args, cwd: options.cwd, env: options.env, timeoutMs: options.timeout, maxBuffer: options.maxBuffer });
    step = program.next(result);
  }
  return step.value;
}

/** Optional standalone entry; coordinator connects the same seam to app check --gate wiring. */
export interface AppWiringMainIo { cwd?: string; stdout?: (text: string) => unknown; stderr?: (text: string) => unknown }

export function appWiringMain(argv: string[], { cwd = invocationDir(), stdout = (text: string) => process.stdout.write(text), stderr = (text: string) => process.stderr.write(text) }: AppWiringMainIo = {}): number {
  let directory = cwd, json = false;
  for (let at = 0; at < argv.length; at += 1) {
    const argument = argv[at];
    const next = argv[at + 1];
    if (argument === '--cwd' && next && !next.startsWith('--')) { directory = path.resolve(cwd, next); at += 1; }
    else if (argument?.startsWith('--cwd=') && argument.length > '--cwd='.length) directory = path.resolve(cwd, argument.slice('--cwd='.length));
    else if (argument === '--json') json = true;
    else if (argument === '--gate' && next === 'wiring') at += 1;
    else if (argument !== '--gate=wiring') { stderr('usage: starci app check --gate wiring [--cwd <dir>] [--json]\n'); return 2; }
  }
  const repo = readJson(directory, 'hfs.json');
  if (!repo) { stderr('wiring needs a readable hfs.json\n'); return 2; }
  const result = appWiring({ repoRoot: directory, repo });
  const trailingNewline = result.findings.length ? '\n' : '';
  const report = `${result.status}: ${result.apps.length} app(s), ${result.findings.length} boot proof failure(s)\n${result.findings.map(f => f.message).join('\n')}${trailingNewline}`;
  stdout(json ? `${JSON.stringify(result)}\n` : report);
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  if (process.argv[2] === '--worker') {
    const loaded = (): string[] => loadedModules(Object.keys(createRequire(import.meta.url).cache));
    try { await wiringWorker(JSON.parse(process.argv[3] as string)); process.stdout.write(JSON.stringify({ ok: true, loaded: loaded() })); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, reason: failureReason(error), loaded: loaded() })); }
  } else process.exitCode = appWiringMain(process.argv.slice(2));
}
