// parity-family.mts - the `build` and `audit` families of `starci app check` (R383): the commands of the app's own managed CI that no
// other family runs locally, run as CI runs them, so a green pre-push gate (`app check --fresh`) is never followed by a red CI on one of them. They are
// read from the app's rendered `.github/workflows/ci.yml`, never restated here, so the local run follows the workflow sync renders:
//   audit: the fast job's production dependency audit (`npm audit --omit=dev --audit-level=high`, or the app's quality declaration);
//   build: the fast job's typecheck script (build:modules, codegen and tsc, which the types family's tsc programs do not run), the build job's
//          `npm run build:be` and each `build fe` step (a `next build` per front-end app, its server prerender and route config included).
// A build runs under the heavy governor (`build` kind, sized by the memory plan) with its own SWC cache root (LOCALAPPDATA and XDG_CACHE_HOME under
// the app's untracked tool cache): Windows' hardened loader refuses the SWC binary that next build loads from a %LOCALAPPDATA%\swc the user does not
// own. The database step (`npm run db:lint`, `app db drift`) runs when the host has Docker or a `--db-url-env` database and is the warning CI_PARITY_DB_SKIPPED otherwise.
// A build step's verdict (green, or red with its finding) is a record of `check/build`, never an artifact, keyed on what the step builds from (`buildStepKey`):
// its command and environment, the Node major, the tracked files of what it builds and the root's, and the lockfile installs its manifests resolve. The
// database step's is keyed on the migration chain, the scratch image, the entity list's import closure and the packages it loads, the engine manifest, the
// db rules' baseline at the merge-base and the @starci/hfs that judges (`databaseStepKey`). An unchanged key reuses the verdict; a step killed, timed out or
// without a database stores none. The audit asks the registry's advisories, which change without the tree: it runs whole on every run that selects it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { loadTypescript } from '../runtime/scripts/lib/package-at.mjs';
import { ENTITY_LIST } from '../db/entity-list.mjs';
import { DB_IMAGE_CONTEXT } from '../db/image.mjs';
import { inCacheDir } from './content-index.mjs';
import { baseInputs, dbMergeBase, isDbInput } from './db-family.mjs';
import { combineHashes } from './hash.mjs';
import { compilerOptionsOf, resolveReferences } from './import-graph.mjs';
import { canonicalJson } from './jsonl.mjs';
import { lockClosure, lockClosureOf, readsContext } from './package-closure.mjs';
import { RecordSet } from './records.mjs';
import { toolCacheDir } from './run-log.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { CacheRecord, CheckSession, FamilyReport, JsonValue } from './types.mjs';

/** The rendered workflow the families read. */
export const CI_WORKFLOW = '.github/workflows/ci.yml';
/** The folder of the build family's verdicts, and the step of one. */
export const BUILD_FOLDER = 'check/build';
export const BUILD_STEP = 'ci-step';

/** One CI step the parity families run: its family, its job and step names, its command and the plain environment it sets. */
export interface ParityStep {
  readonly family: 'build' | 'audit';
  readonly job: string;
  readonly name: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
}

/** A command the families run: the governor's heavy command port when the CLI gives one (`stackIo.heavy`), else a plain child. */
export type ParityRun = (request: { readonly kind: 'build' | 'install'; readonly label: string; readonly cwd: string; readonly argv: readonly string[]; readonly env: NodeJS.ProcessEnv }) => Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: Error | undefined }>;

/** The build job's database step (`npm run db:lint`, and `app db drift` for an app with an entity list): the migrations applied to a scratch database and checked against the entity manifest. */
export const DATABASE_STEP = 'database migration checks';
/** The refusal `app db drift` gives a host with no Docker and no `--db-url-env` database: no verdict, never a green. */
export const NEEDS_DATABASE = 'DB_DRIFT_NEEDS_DATABASE';
/** A database step this host could not run: a warning, because CI judges it (the step needs a database this host does not have). */
export const DATABASE_SKIPPED = 'CI_PARITY_DB_SKIPPED';

/** Which family a step of the managed workflow belongs to, by its job and name; null for a step another family or CI alone runs. */
export function familyOfStep(job: string, name: string): ParityStep['family'] | null {
  if (job === 'fast' && name === 'production dependency audit') return 'audit';
  if (job === 'fast' && name === 'typecheck') return 'build';
  if (job === 'build' && (name === 'build be' || name === 'build fe' || name.startsWith('build fe '))) return 'build';
  if (job === 'build' && name === DATABASE_STEP) return 'build';
  return null;
}

interface WorkflowStep { readonly name?: unknown; readonly run?: unknown; readonly env?: unknown }

/**
 * The parity steps of the workflow text, in the order CI runs them. A step whose command reads a GitHub expression (`${{ ... }}`) is CI's alone; an
 * environment value that reads one is dropped, and so is NODE_OPTIONS (the memory plan sizes the heap locally).
 */
export function parityStepsOf(workflow: string): ParityStep[] {
  let parsed: unknown;
  try { parsed = parseYaml(workflow); } catch { return []; }
  const jobs = (parsed as { jobs?: Record<string, { steps?: readonly WorkflowStep[] }> } | null)?.jobs ?? {};
  const steps: ParityStep[] = [];
  for (const job of ['fast', 'build']) {
    for (const step of jobs[job]?.steps ?? []) {
      if (typeof step.name !== 'string' || typeof step.run !== 'string') continue;
      const family = familyOfStep(job, step.name);
      if (family === null || step.run.includes('${{')) continue;
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries((step.env ?? {}) as Record<string, unknown>)) {
        const text = String(value);
        if (key !== 'NODE_OPTIONS' && !text.includes('${{')) env[key] = text;
      }
      steps.push({ family, job, name: step.name, run: step.run.trim(), env });
    }
  }
  return steps;
}

/** The parity steps of the app at `repoRoot`; none when it has no managed workflow. */
export function parityStepsFor(repoRoot: string): ParityStep[] {
  try { return parityStepsOf(fs.readFileSync(path.join(repoRoot, CI_WORKFLOW), 'utf8')); } catch { return []; }
}

/**
 * The short folder Next's SWC native addon keeps its binding cache in (`SWC_NATIVE_BINDING_CACHE`), one per app, under the user profile.
 * It is short because the addon's lock (`swc\swc-native-<SID>\v1\<128 hex>.lock`) under the tool cache is longer than Windows' MAX_PATH
 * (ERR_SWC_NATIVE_CACHE, os error 3), and it is under the profile because a root outside it (a drive-root folder) fails the addon's DACL check
 * (a replacement right granted to the authenticated users). Deterministic per app: the first eight hex of the repo path's sha256.
 */
export function swcBindingCacheFor(repoRoot: string, env: NodeJS.ProcessEnv): string {
  const profile = env['USERPROFILE'] ?? env['HOME'] ?? os.homedir();
  return path.join(profile, 'sw', createHash('sha256').update(path.resolve(repoRoot)).digest('hex').slice(0, 8));
}

/**
 * The cache roots a build owns: the SWC cache root (LOCALAPPDATA, XDG_CACHE_HOME) under the app's untracked tool cache, never the user's shared one,
 * and on Windows `SWC_NATIVE_BINDING_CACHE` at a short, ACL-safe folder under the user profile (see `swcBindingCacheFor`). A value the caller
 * already set is kept.
 */
export function buildCacheEnv(repoRoot: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const root = path.join(toolCacheDir(repoRoot, env), 'build-cache');
  fs.mkdirSync(root, { recursive: true });
  const cache: Record<string, string> = { LOCALAPPDATA: root, XDG_CACHE_HOME: root };
  if (platform === 'win32' && (env['SWC_NATIVE_BINDING_CACHE'] ?? '') === '') {
    const binding = swcBindingCacheFor(repoRoot, env);
    fs.mkdirSync(binding, { recursive: true });
    cache['SWC_NATIVE_BINDING_CACHE'] = binding;
  }
  return cache;
}

/** The shell CI's `run:` lines need (`&&`): cmd on Windows, sh elsewhere. */
export function shellArgv(command: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  return platform === 'win32' ? [env['ComSpec'] ?? 'cmd.exe', '/d', '/s', '/c', command] : ['/bin/sh', '-c', command];
}

const tailOf = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-5).join(' | ').slice(0, 600);

/** The version of the @starci/hfs that runs: the db rules and `app db drift` it judges with. */
const HFS_VERSION = String((JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version?: unknown }).version ?? 'unknown');

/** What a step key is made of: the digest and the tracked files it holds (the ones a run must leave unedited for its verdict to be stored). */
export interface StepKey {
  readonly key: string;
  readonly inputs: readonly string[];
}

/** The key of one step from its command, its tracked files, the installs it resolves and its other parts. */
function keyOf(step: ParityStep, session: CheckSession, files: readonly string[], installs: readonly string[], extra: Readonly<Record<string, string>>): StepKey {
  const context = readsContext(session.root, (file) => session.index.hashOf(file));
  const parts: Record<string, string> = { ...extra, '#run': step.run, '#env': canonicalJson(step.env) };
  for (const file of files) parts[`file:${file}`] = session.index.hashOf(file) ?? 'absent';
  for (const install of installs) parts[`package:${install}`] = context.packageDigest(install);
  return { key: combineHashes(parts), inputs: files };
}

/** The folders a build step builds from: `build be` the back end, a `build fe` step the front end, the typecheck every workspace; each with the root packages. */
function buildScope(step: ParityStep): readonly string[] | null {
  if (step.name === 'build be') return ['be/', 'packages/'];
  if (step.name === 'build fe' || step.name.startsWith('build fe ')) return ['fe/', 'packages/'];
  return null;
}

/**
 * The key of a build step (the typecheck, `build be`, a `build fe`): its command and environment, the Node major, every tracked file of the folders it builds
 * (every tracked file for the typecheck) and of the app root but the lockfile, and the installs the lockfile resolves for the manifests among them. A package
 * bump the build does not resolve leaves the key; a source, config or argument change moves it.
 */
export function buildStepKey(session: CheckSession, step: ParityStep, nodeVersion: string = process.versions.node): StepKey {
  const scope = buildScope(step);
  const files = session.index.paths.filter((file) => !inCacheDir(file) && file !== 'package-lock.json' && (scope === null || !file.includes('/') || scope.some((prefix) => file.startsWith(prefix))));
  const manifests = files.filter((file) => path.posix.basename(file) === 'package.json' && !file.includes('node_modules/'));
  return keyOf(step, session, files, lockClosure(session.root, manifests), { '#node': nodeVersion.split('.')[0] ?? nodeVersion });
}

/** The back-end files the entity list reaches through its imports (side-relative resolution, app-relative paths) and the packages they import; every back-end file when the compiler is missing. */
function entityClosure(session: CheckSession): { files: string[]; packages: string[] } {
  const root = session.root;
  if (session.index.hashOf(ENTITY_LIST) === undefined) return { files: [], packages: [] };
  const beRoot = path.join(root, 'be');
  const ts = loadTypescript(beRoot, root);
  if (ts === null) return { files: session.index.paths.filter((file) => file.startsWith('be/')), packages: [] };
  const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
  const fileExists = (file: string): boolean => fs.existsSync(file) && fs.statSync(file).isFile();
  const host = { ts, sideRoot: beRoot, readText, fileExists, hashOf: () => null };
  const options = compilerOptionsOf(ts, beRoot, readText, fileExists);
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [ENTITY_LIST.slice('be/'.length)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readText(path.join(beRoot, file));
    if (text === null) continue;
    const found = resolveReferences(host, options, file, text);
    for (const name of found.packages) packages.add(name);
    for (const next of found.imports) if (!seen.has(next)) queue.push(next);
  }
  return { files: [...seen].map((file) => `be/${file}`).sort(), packages: [...packages].sort() };
}

/** The engine manifest hfs.json `sides.be.engineOwned.manifest` names, app-relative, when it names one. */
function engineManifest(session: CheckSession): string[] {
  try {
    const manifest = (JSON.parse(fs.readFileSync(path.join(session.root, 'hfs.json'), 'utf8')) as { sides?: { be?: { engineOwned?: { manifest?: unknown } } } }).sides?.be?.engineOwned?.manifest;
    return typeof manifest === 'string' ? [manifest] : [];
  } catch {
    return [];
  }
}

/**
 * The key of the database step (`npm run db:lint`, `app db drift`): its command and environment, the db rules' inputs (hfs.json, `db/` and its migration chain,
 * `supabase/`, every `.sql`) and their baseline at the merge-base, the scratch database image, the entity list's import closure and the engine manifest, the
 * installs the drift check loads (the closure's packages, typeorm, typescript, pg) and the @starci/hfs that judges.
 */
export function databaseStepKey(session: CheckSession, step: ParityStep, base: string = dbMergeBase(session.root)): StepKey {
  const entities = entityClosure(session);
  const manifest = engineManifest(session);
  const files = [...new Set([...session.index.paths.filter((file) => !inCacheDir(file) && (isDbInput(file) || file.startsWith(`${DB_IMAGE_CONTEXT}/`) || file === 'be/tsconfig.json' || manifest.includes(file))), ...entities.files])].sort();
  const installs = lockClosureOf(session.root, [...entities.packages, 'typeorm', 'typescript', 'pg']);
  return keyOf(step, session, files, installs, { '#hfs': HFS_VERSION, '#base-inputs': baseInputs(session.root, base) });
}

/** A verdict worth keeping: the step ran to its own exit (no spawn error, no signal or kill status), green or red. */
const settled = (result: { readonly status: number | null; readonly error?: Error | undefined }): boolean => result.error === undefined && result.status !== null && result.status >= 0 && result.status < 128;

/**
 * Runs the steps of `families` and reports each family; a failed step is CI_PARITY_STEP_FAILED with its last lines. A build step whose key matches its record
 * takes the recorded verdict; one that ran to its own exit records it, with the finding's message short of the output's last lines (they vary by run).
 */
export async function runParityFamilies(session: CheckSession, { repoRoot, families, env, run, steps = parityStepsFor(repoRoot) }: {
  repoRoot: string; families: ReadonlySet<ParityStep['family']>; env: NodeJS.ProcessEnv; run: ParityRun; steps?: readonly ParityStep[];
}): Promise<{ findings: CheckFinding[]; reports: FamilyReport[] }> {
  const findings: CheckFinding[] = [];
  const reports: FamilyReport[] = [];
  for (const family of ['audit', 'build'] as const) {
    if (!families.has(family)) continue;
    const mine = steps.filter((step) => step.family === family);
    const progress = session.progress.step(family, family === 'audit' ? 'dependency audit' : 'CI build steps', mine.length);
    const decision = family === 'build' ? session.decide('build') : undefined;
    const records = new RecordSet(family === 'build' ? session.records(BUILD_FOLDER) : []);
    const kept = new Set<string>();
    let failed = 0;
    let reused = 0;
    for (const [index, step] of mine.entries()) {
      const where = `${step.job}/${step.name}`;
      const key = family === 'build' ? (step.name === DATABASE_STEP ? databaseStepKey(session, step) : buildStepKey(session, step)) : undefined;
      kept.add(where);
      const held = key !== undefined && decision?.mode === 'diff' ? records.matching(where, BUILD_STEP, key.key) : undefined;
      if (held !== undefined) {
        reused += 1;
        failed += held.findings.length > 0 ? 1 : 0;
        findings.push(...held.findings.map((finding) => ({ code: finding.rule, level: 'error', engine: family, path: CI_WORKFLOW, message: `${finding.message} (the verdict recorded for this tree)` })));
        progress.tick(index + 1, reused, index + 1 - reused);
        continue;
      }
      const stepEnv = { ...env, ...step.env, ...(family === 'build' ? buildCacheEnv(repoRoot, env) : {}) };
      const result = await run({ kind: family === 'build' ? 'build' : 'install', label: `app check ${family} ${step.name}`, cwd: repoRoot, argv: shellArgv(step.run, process.platform, env), env: stepEnv });
      if (step.name === DATABASE_STEP && result.status === 2 && result.error === undefined && `${result.stdout}${result.stderr}`.includes(NEEDS_DATABASE)) {
        findings.push({ code: DATABASE_SKIPPED, level: 'warning', engine: family, path: CI_WORKFLOW, message: `${CI_WORKFLOW} ${step.job} / ${step.name} (${step.run}) was not run here: it applies the migrations to a scratch database and needs Docker (or an empty database named by --db-url-env), which this host lacks; CI runs it, and it is the step that finds BE_ENTITY_SCHEMA_DRIFT` });
        progress.tick(index + 1, reused, index + 1 - reused);
        continue;
      }
      const verdict = `${CI_WORKFLOW} ${step.job} / ${step.name} (${step.run}) failed locally as it would in CI`;
      const red = result.status !== 0 || result.error !== undefined;
      if (red) {
        failed += 1;
        const why = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
        findings.push({ code: 'CI_PARITY_STEP_FAILED', level: 'error', engine: family, path: CI_WORKFLOW, message: `${verdict} (${why}): ${tailOf(`${result.stdout}\n${result.stderr}`)}` });
      }
      if (key !== undefined && settled(result) && session.unchanged(key.inputs)) {
        const recorded: CacheRecord = { path: where, step: BUILD_STEP, hash: key.key, findings: red ? [{ path: CI_WORKFLOW, line: 0, column: 0, rule: 'CI_PARITY_STEP_FAILED', message: `${verdict} (exit ${String(result.status)})` }] : [], data: { verdict: red ? 'red' : 'green' } as JsonValue };
        records.put(recorded);
      }
      progress.tick(index + 1, reused, index + 1 - reused);
    }
    progress.end();
    if (family === 'build') {
      // A step the workflow no longer holds drops its verdict; a step without a database this run keeps the verdict a run with one recorded.
      records.retain(BUILD_STEP, kept);
      session.replace(BUILD_FOLDER, records.toArray().filter((record) => record.step === BUILD_STEP));
    }
    const reason = mine.length === 0 ? `${CI_WORKFLOW} has no ${family} step` : family === 'build' ? `${String(mine.length)} step(s) of ${CI_WORKFLOW}, ${decision?.reason ?? ''}` : `${String(mine.length)} step(s) of ${CI_WORKFLOW}, never cached`;
    const report: FamilyReport = { family, mode: decision?.mode ?? 'full', reason, checked: mine.length - reused, reused, newFindings: failed, knownFindings: 0, fixedFindings: 0 };
    session.report(report);
    reports.push(report);
  }
  return { findings, reports };
}
