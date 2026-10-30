// R272: compile the actual Nest AppModule in a child, with explicit infrastructure doubles.
// Dynamic roots need public fixture options: src/tests/fixtures/builders/<app>.builder.ts may export
// buildWiringProof(AppModule) => { options, overrides: [{ token, value }], request? }. The runner always chooses
// the real root; a fixture cannot substitute an empty module. No environment parser or main.ts runs.
// The proof worker has its own budget, counted from its spawn: STARCI_BOOT_PROOF_TIMEOUT_MS, which the starci CLI sets from ops/liveness.yaml
// (heavy.bootProofTimeoutSeconds). A worker that runs out of it reached no verdict: it is retried once, and a second timeout is reported as
// BOOT_PROOF_TIMEOUT (a warning: the host was too loaded to judge), never as the proof failing (BE_APP_BOOT_PROOF_MISSING).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runNode } from '../api/node/run-node.mjs';
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
export type WorkerResult = { status?: number | null; signal?: string | null; error?: NodeJS.ErrnoException; stdout?: string } | null | undefined;
/** The injectable spawn seam of the worker. */
export type WorkerRun = (command: string, args: string[], options: object) => WorkerResult;
/** The public fixture contract: what buildWiringProof(AppModule) returns. */
export interface WiringProof { options?: unknown; overrides?: { token: unknown; value: unknown }[]; request?: unknown }
/** The repository descriptor (hfs.json) fields this check reads. */
export interface WiringRepo { edition?: string | undefined; profile?: string | undefined; kind?: string | undefined; sides?: { be?: { apps?: readonly { name: string }[] | undefined } | undefined }; apps?: readonly { name: string }[] | undefined }
/** The shape of an appWiring run. */
export interface WiringResult { ok: boolean; status: string; findings: WiringFinding[]; apps: string[] }

/** One boot-proof finding: a refusal (error) or a timeout (warning). */
export type WiringFinding = { code: string; level: 'error' | 'warning'; path: string; message: string; reason: string };

const refusal = (file: string, reason: string): WiringFinding => ({ code: BOOT_PROOF_CODE, level: 'error', path: file,
  message: `${file}: lite boot proof failed (${reason}); compile the real AppModule with explicit fixture options and infrastructure doubles using starci app check --wiring`, reason });

const timedOut = (file: string, budget: number): WiringFinding => ({ code: BOOT_PROOF_TIMEOUT, level: 'warning', path: file, reason: 'proof worker timed out',
  message: `${file}: the lite boot proof reached no verdict: its worker ran out of its ${Math.round(budget / 1000)} s budget twice (the host is loaded); this is no failure of the proof, rerun starci app check --wiring when the host is quieter` });

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
  // reason: Module._resolveFilename and Module#_compile are private Node internals with no declared types.
  const NodeModule = require('node:module') as any;
  const resolve = NodeModule._resolveFilename;
  NodeModule._resolveFilename = function resolveSource(this: unknown, request: string, parent: { filename?: string } | undefined, ...rest: unknown[]) {
    if (parent?.filename && (request.startsWith('.') || Object.keys(options.paths ?? {}).some((alias) => request.startsWith(alias.replace(/\*$/, ''))))) {
      const resolved = ts.resolveModuleName(request, parent.filename, options, ts.sys).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith('.d.ts')) return resolved.resolvedFileName;
    }
    return resolve.call(this, request, parent, ...rest);
  };
  // reason: Module#_compile is a private Node internal with no declared type.
  require.extensions['.ts'] = (loaded: any, file: string) => {
    const output = outputs.get(path.resolve(file));
    if (output === undefined) throw new Error('source is outside the compiled graph');
    loaded._compile(output, file);
  };
  require('reflect-metadata');
  return require;
}

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

interface FindingInput { repoRoot: string; beRoot: string; prefix: string; app: string; files: string[] | undefined; fixtures: Record<string, string>; timeout: number; run: WorkerRun | undefined }

function appWiringFinding({ repoRoot, beRoot, prefix, app, files, fixtures, timeout, run }: FindingInput): WiringFinding | null {
  const file = `${prefix}${modulePath(app)}`;
  if (!/^[a-z][a-z0-9-]*$/.test(app) || !fs.existsSync(path.join(repoRoot, file)) || (files && !files.includes(file))) {
    return refusal(file, 'app module is missing');
  }
  const fixture = fixtures[app] ?? wiringFixturePath(app);
  const fixtureExists = fs.existsSync(path.join(beRoot, fixture)) && (!files || files.includes(`${prefix}${fixture}`));
  const args = [WORKER, '--worker', JSON.stringify({ repoRoot: beRoot, app, fixture: fixtureExists ? fixture : null, timeout })];
  const budget = workerBudget(timeout);
  const options = { cwd: beRoot, encoding: 'utf8' as const, env: {}, windowsHide: true, timeout: budget, maxBuffer: 1024 * 1024 };
  const spawnWorker = () => (run ? run(process.execPath, args, options) : runNode(args, options));
  let result = spawnWorker();
  if (isTimeout(result)) result = spawnWorker();
  if (isTimeout(result)) return timedOut(file, budget);
  let proof: { ok?: boolean; reason?: string } | undefined;
  try { proof = JSON.parse(result?.stdout ?? ''); } catch { /* Output from app source cannot serve as a proof. */ }
  if (result?.status !== 0 || proof?.ok !== true) return refusal(file, SAFE_REASONS.has(proof?.reason as string) ? (proof?.reason as string) : WORKER_FAILURE);
  return null;
}

/** Synchronous check seam for the dispatcher and content finder. Paths in findings are relative to repoRoot. */
export interface AppWiringInput { repoRoot: string; repo?: WiringRepo; files?: string[]; fixtures?: Record<string, string>; timeout?: number; run?: WorkerRun }

export function appWiring({ repoRoot, repo = readJson(repoRoot, 'hfs.json'), files, fixtures = {}, timeout = DEFAULT_TIMEOUT, run }: AppWiringInput): WiringResult {
  if (repo?.edition !== 'lite' || repo?.profile === 'fe' || repo?.kind === 'fe') return { ok: true, status: 'skipped', findings: [], apps: [] };
  const appRoot = Boolean(repo.sides);
  const beRoot = appRoot ? path.join(repoRoot, 'be') : repoRoot;
  const prefix = appRoot ? 'be/' : '';
  const apps = wiringApps(repo, files, prefix);
  const findings: WiringFinding[] = [];
  for (const app of apps) {
    const finding = appWiringFinding({ repoRoot, beRoot, prefix, app, files, fixtures, timeout, run });
    if (finding) findings.push(finding);
  }
  return { ok: findings.length === 0, status: 'checked', apps, findings };
}

/** Optional standalone entry; coordinator connects the same seam to app check --wiring. */
export interface AppWiringMainIo { cwd?: string; stdout?: (text: string) => unknown; stderr?: (text: string) => unknown }

export function appWiringMain(argv: string[], { cwd = invocationDir(), stdout = (text: string) => process.stdout.write(text), stderr = (text: string) => process.stderr.write(text) }: AppWiringMainIo = {}): number {
  let directory = cwd, json = false;
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--cwd' && argv[at + 1]) directory = path.resolve(cwd, argv[++at] as string);
    else if (argv[at] === '--json') json = true;
    else if (argv[at] !== '--wiring') { stderr('usage: starci app check --wiring [--cwd <dir>] [--json]\n'); return 2; }
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
    try { await wiringWorker(JSON.parse(process.argv[3] as string)); process.stdout.write(JSON.stringify({ ok: true })); }
    catch (error) { process.stdout.write(JSON.stringify({ ok: false, reason: failureReason(error) })); }
  } else process.exitCode = appWiringMain(process.argv.slice(2));
}
