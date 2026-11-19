// R448: a back-end app that declares a boot entry (hfs.json sides.be.apps[].boot) composes that entry for real, without listening: the worker
// loads the entry's module from source and runs NestFactory.createApplicationContext(root, { abortOnError: false }), then closes it. The proof
// of R272 compiles the AppModule with fixture options and doubles; this one runs the composition a command of the app boots (a seed, a job, the
// server), so a provider a module injects and another module does not export, which the doubles and the type check both pass, fails the gate
// instead of the bring-up. Lifecycle hooks (onModuleInit and the rest) never run and the network is shut, so only the wiring is judged; the child
// gets NODE_ENV=test and the declared stub env, never the host's. cache/boot-entry-check.mts runs it in the `checks` step of the hfs gate and caches its verdict. A Nest wiring exception is BE_BOOT_ENTRY_FAILED with Nest's own message
// (redacted: the declared values masked, URL credentials and secret-named pairs blanked); any other failure (an import that throws, a config
// parser the stub env does not satisfy) is the warning BE_BOOT_ENTRY_UNJUDGED naming it, since it says nothing of the wiring.
import fs from 'node:fs';
import path from 'node:path';
import { runHeavyNode, type HeavyNodeRun } from '../api/node/run-node.mjs';
import { fileURLToPath } from 'node:url';
import { isMain } from '../lib/is-main.mjs';
import { maskValues } from '../lib/error-tail.mjs';
import { redactText } from '../lib/redact.mjs';
import { blockNetwork, BOOT_PROOF_TIMEOUT, loadedModules, sourceLoader, workerBudget, type WiringFinding } from './app-wiring.mjs';

export const BOOT_ENTRY_FAILED = 'BE_BOOT_ENTRY_FAILED';
export const BOOT_ENTRY_UNJUDGED = 'BE_BOOT_ENTRY_UNJUDGED';
const WORKER = fileURLToPath(import.meta.url);
const DEFAULT_TIMEOUT = 15000;
/** The most characters of a Nest message a finding carries (Nest's "Potential solutions" block is about 900). */
const MESSAGE_LIMIT = 2000;
/** The hooks of Nest's application context that run lifecycle callbacks; they are replaced by no-ops so only the wiring runs. */
const HOOKS = ['callInitHook', 'callBootstrapHook', 'callDestroyHook', 'callBeforeShutdownHook', 'callShutdownHook'];
/** The exceptions Nest throws for a composition that cannot be built, by class name. */
const WIRING_ERRORS = new Set(['UnknownDependenciesException', 'UndefinedDependencyException', 'UnknownExportException', 'UnknownModuleException', 'UndefinedModuleException', 'InvalidModuleException', 'InvalidClassModuleException', 'InvalidClassException', 'CircularDependencyException']);
const WIRING_MESSAGE = /Nest (?:can't|cannot|could not) (?:resolve dependencies|export|find)|circular dependency|undefined module/iu;

/** One boot entry a back-end app declares. */
export interface BootEntry { readonly app: string; readonly module: string; readonly export: string; readonly factory: string | undefined; readonly env: Readonly<Record<string, string>> }
/** The repository fields the boot check reads. */
export interface BootRepo { sides?: { be?: { apps?: readonly { name: string; boot?: unknown }[] | undefined } | undefined } | undefined }
/** What a run of the boot check answers: its findings, the apps it ran with the state of each, and what its workers loaded (null when a worker reported nothing). */
export interface BootResult { ok: boolean; status: string; findings: WiringFinding[]; apps: string[]; loaded: string[] | null; states: { app: string; state: 'green' | 'red' | 'not judged' }[] }

/** The default module file of an app's boot entry, relative to the back-end root. */
export const defaultBootModule = (app: string): string => `apps/${app}/src/app.module.ts`;

/** The boot entries `repo` declares, in declaration order; the shape is judged with the rest of hfs.json (declaration-shape.mts), so a malformed one is skipped here. */
export function bootEntries(repo: BootRepo | undefined): BootEntry[] {
  return (repo?.sides?.be?.apps ?? []).flatMap((app) => {
    const boot = app.boot as Record<string, unknown> | undefined;
    if (typeof boot !== 'object' || boot === null || Array.isArray(boot)) return [];
    const env = Object.fromEntries(Object.entries((boot.env ?? {}) as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
    return [{ app: app.name, module: typeof boot.module === 'string' ? boot.module : defaultBootModule(app.name), export: typeof boot.export === 'string' ? boot.export : 'AppModule', factory: typeof boot.factory === 'string' ? boot.factory : undefined, env }];
  });
}

const finding = (entry: BootEntry, prefix: string, code: string, level: 'error' | 'warning', reason: string, message: string): WiringFinding =>
  ({ code, level, path: `${prefix}${entry.module}`, reason, message });

/** `work`, refused as a timeout when it has not settled after `timeout` ms. */
async function within<T>(work: Promise<T>, timeout: number): Promise<T> {
  let deadline: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => { deadline = setTimeout(() => { const error = new Error('boot deadline'); error.name = 'BootTimeout'; reject(error); }, timeout); });
  try { return await Promise.race([work, expired]); } finally { clearTimeout(deadline); }
}

interface WorkerInput { repoRoot: string; module: string; export: string; factory: string | undefined; timeout: number }
interface WorkerAnswer { ok: boolean; wiring?: boolean; name?: string; message?: string; loaded: string[] }

/** Writes the worker's one answer and ends the process once it is flushed: a handle the app left open must not hold the check. */
const reply = (text: string): void => { process.stdout.write(text, () => process.exit(0)); };

/** The worker: composes the entry's root and closes it. Lifecycle hooks are replaced by no-ops and the network is shut before any app source loads. */
// reason: Nest, the entry's module and its exports are dynamically required from the app's own installed packages and source.
async function bootWorker({ repoRoot, module, export: exportName, factory, timeout }: WorkerInput): Promise<void> {
  blockNetwork();
  const entry = path.join(repoRoot, module);
  const require = sourceLoader(repoRoot, entry, null);
  const Nest = require('@nestjs/core');
  for (const hook of HOOKS) if (typeof Nest.NestApplicationContext?.prototype?.[hook] === 'function') Nest.NestApplicationContext.prototype[hook] = async () => undefined;
  const loaded = (): string[] => loadedModules(Object.keys(require.cache));
  try {
    const exported = require(entry);
    const root = factory === undefined ? exported[exportName] : await exported[factory]?.();
    if (root === undefined || root === null) throw new Error(`${module} exports no ${factory === undefined ? exportName : `${factory}()`} root`);
    const context = await within<{ close(): Promise<void> }>(Nest.NestFactory.createApplicationContext(root, { abortOnError: false, logger: false }), timeout);
    await within(context.close(), timeout);
    reply(JSON.stringify({ ok: true, loaded: loaded() } satisfies WorkerAnswer));
  } catch (error) {
    const cause = error as { constructor?: { name?: string }; name?: string; message?: unknown } | null;
    const name = String(cause?.constructor?.name ?? cause?.name ?? 'Error');
    const message = String(cause?.message ?? error);
    reply(JSON.stringify({ ok: false, wiring: WIRING_ERRORS.has(name) || WIRING_MESSAGE.test(message), name: name === 'Error' ? String(cause?.name ?? name) : name, message, loaded: loaded() } satisfies WorkerAnswer));
  }
}

/** The message a finding carries: the declared stub values masked, the shared redaction run, cut to MESSAGE_LIMIT. */
function safeMessage(message: string, entry: BootEntry): string {
  const clean = redactText(maskValues(message, Object.values(entry.env))).trim();
  return clean.length > MESSAGE_LIMIT ? `${clean.slice(0, MESSAGE_LIMIT)}...` : clean;
}

/** The finding of one entry's worker answer, or none when it composed. */
function findingOf(entry: BootEntry, prefix: string, answer: WorkerAnswer | null, exitOk: boolean): WiringFinding[] {
  const where = `${prefix}${entry.module}`;
  if (answer === null) return [finding(entry, prefix, BOOT_ENTRY_UNJUDGED, 'warning', 'boot worker answered nothing', `${where}: the boot entry of the ${entry.app} app reached no verdict (its worker ${exitOk ? 'answered nothing readable' : 'failed'}); rerun starci app check`)];
  if (answer.ok) return [];
  const message = safeMessage(answer.message ?? '', entry);
  if (answer.wiring === true) return [finding(entry, prefix, BOOT_ENTRY_FAILED, 'error', 'Nest refused the composition', `${where}: the boot entry of the ${entry.app} app does not compose (${answer.name ?? 'Error'}): ${message}\nthe stack seed and every command that boots this entry fail with it; the proof of R272 compiles the AppModule with doubles and does not run this composition`)];
  return [finding(entry, prefix, BOOT_ENTRY_UNJUDGED, 'warning', 'boot failed outside the wiring', `${where}: the boot entry of the ${entry.app} app failed before its wiring was judged (${answer.name ?? 'Error'}: ${message}); stub what it reads in hfs.json sides.be.apps[].boot.env, or fix the import`)];
}

/** Runs every declared boot entry in its own child (the heavy governor admits each) and answers the findings and what the children loaded. */
export async function appBootAsync({ repoRoot, repo, execute, timeout = DEFAULT_TIMEOUT }: { repoRoot: string; repo: BootRepo; execute?: HeavyNodeRun | undefined; timeout?: number }): Promise<BootResult> {
  const entries = bootEntries(repo);
  if (entries.length === 0) return { ok: true, status: 'skipped', findings: [], apps: [], loaded: [], states: [] };
  const appRoot = Boolean(repo.sides);
  const beRoot = appRoot ? path.join(repoRoot, 'be') : repoRoot;
  const prefix = appRoot ? 'be/' : '';
  const findings: WiringFinding[] = [];
  const states: BootResult['states'] = [];
  /** Records the state of `entry` from the findings its run added. */
  const settle = (entry: BootEntry, added: readonly WiringFinding[]): void => { states.push({ app: entry.app, state: added.some((item) => item.level === 'error') ? 'red' : added.length > 0 ? 'not judged' : 'green' }); };
  let loaded: Set<string> | null = new Set();
  for (const entry of entries) {
    if (!fs.existsSync(path.join(beRoot, entry.module))) {
      findings.push(finding(entry, prefix, BOOT_ENTRY_FAILED, 'error', 'boot module is missing', `${prefix}${entry.module}: the boot entry of the ${entry.app} app names a module file the app does not hold; restore it or fix hfs.json sides.be.apps[].boot.module`));
      settle(entry, findings.slice(-1));
      continue;
    }
    const budget = workerBudget(timeout);
    const args = [WORKER, '--worker', JSON.stringify({ repoRoot: beRoot, module: entry.module, export: entry.export, factory: entry.factory, timeout } satisfies WorkerInput)];
    const env = { NODE_ENV: 'test', ...entry.env };
    const run = async () => runHeavyNode(execute, { kind: 'test', label: 'app check boot entry', workers: 1, args, cwd: beRoot, env, timeoutMs: budget, maxBuffer: 1024 * 1024 });
    let result = await run();
    if (result?.error?.code === 'ETIMEDOUT') result = await run();
    if (result?.error?.code === 'ETIMEDOUT') {
      findings.push(finding(entry, prefix, BOOT_PROOF_TIMEOUT, 'warning', 'proof worker timed out', `${prefix}${entry.module}: the boot entry check reached no verdict: its worker ran out of its ${Math.round(budget / 1000)} s budget twice (the host is loaded); rerun starci app check when the host is quieter`));
      settle(entry, findings.slice(-1));
      loaded = null;
      continue;
    }
    let answer: WorkerAnswer | null = null;
    try { answer = JSON.parse(result?.stdout ?? '') as WorkerAnswer; } catch { /* output from app source cannot serve as a verdict */ }
    if (answer !== null && (typeof answer !== 'object' || typeof answer.ok !== 'boolean')) answer = null;
    const added = findingOf(entry, prefix, answer, result?.status === 0);
    findings.push(...added);
    settle(entry, added);
    loaded = loaded === null || !Array.isArray(answer?.loaded) ? null : new Set([...loaded, ...answer.loaded]);
  }
  return { ok: findings.every((item) => item.level !== 'error'), status: 'checked', apps: entries.map((entry) => entry.app), findings, loaded: loaded === null ? null : [...loaded].sort(), states };
}

if (isMain(import.meta.url) && process.argv[2] === '--worker') {
  try { await bootWorker(JSON.parse(process.argv[3] as string) as WorkerInput); } catch (error) { reply(JSON.stringify({ ok: false, wiring: false, name: 'BootWorker', message: String((error as Error)?.message ?? error), loaded: [] } satisfies WorkerAnswer)); }
}
