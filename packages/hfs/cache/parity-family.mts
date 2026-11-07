// parity-family.mts - the `build` and `audit` families of `starci app check` (R383): the commands of the app's own managed CI that no
// other family runs locally, run as CI runs them, so a green pre-push gate (`app check --fresh`) is never followed by a red CI on one of them. They are
// read from the app's rendered `.github/workflows/ci.yml`, never restated here, so the local run follows the workflow sync renders:
//   audit: the fast job's production dependency audit (`npm audit --omit=dev --audit-level=high`, or the app's quality declaration);
//   build: the fast job's typecheck script (build:modules, codegen and tsc, which the types family's tsc programs do not run), the build job's
//          `npm run build:be` and each `build fe` step (a `next build` per front-end app, its server prerender and route config included).
// A build runs under the heavy governor (`build` kind, sized by the memory plan) with its own SWC cache root (LOCALAPPDATA and XDG_CACHE_HOME under
// the app's untracked tool cache): Windows' hardened loader refuses the SWC binary that next build loads from a %LOCALAPPDATA%\swc the user does not
// own. The database step (`npm run db:lint`, `app db drift`) runs when the host has Docker or a `--db-url-env` database and is the warning CI_PARITY_DB_SKIPPED otherwise. Nothing is cached:
// each runs whole on every run that selects it.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { toolCacheDir } from './run-log.mjs';
import type { CheckFinding } from '../runtime/scripts/hfs/check.mjs';
import type { HeavyAdmission } from '../runtime/scripts/api/node/run-node.mjs';
import type { CheckSession, FamilyReport } from './types.mjs';

/** The rendered workflow the families read. */
export const CI_WORKFLOW = '.github/workflows/ci.yml';

/** One CI step the parity families run: its family, its job and step names, its command and the plain environment it sets. */
export interface ParityStep {
  readonly family: 'build' | 'audit';
  readonly job: string;
  readonly name: string;
  readonly run: string;
  readonly env: Readonly<Record<string, string>>;
}

/** A command the families run: the governor's heavy command port when the CLI gives one (`stackIo.heavy`), else a plain child. */
export type ParityRun = (request: { readonly kind: 'build' | 'install'; readonly label: string; readonly cwd: string; readonly argv: readonly string[]; readonly env: NodeJS.ProcessEnv; readonly onAdmit?: ((admitted: HeavyAdmission) => void) | undefined }) => Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: Error | undefined; readonly peakMb?: number | undefined }>;

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

/** Runs the steps of `families` and reports each family; a failed step is CI_PARITY_STEP_FAILED with its last lines. */
export async function runParityFamilies(session: CheckSession, { repoRoot, families, env, run, steps = parityStepsFor(repoRoot) }: {
  repoRoot: string; families: ReadonlySet<ParityStep['family']>; env: NodeJS.ProcessEnv; run: ParityRun; steps?: readonly ParityStep[];
}): Promise<{ findings: CheckFinding[]; reports: FamilyReport[] }> {
  const findings: CheckFinding[] = [];
  const reports: FamilyReport[] = [];
  for (const family of ['audit', 'build'] as const) {
    if (!families.has(family)) continue;
    const mine = steps.filter((step) => step.family === family);
    const progress = session.progress.step(family, family === 'audit' ? 'dependency audit' : 'CI build steps', mine.length);
    let failed = 0;
    for (const [index, step] of mine.entries()) {
      const stepEnv = { ...env, ...step.env, ...(family === 'build' ? buildCacheEnv(repoRoot, env) : {}) };
      const result = await run({ kind: family === 'build' ? 'build' : 'install', label: `app check ${family} ${step.name}`, cwd: repoRoot, argv: shellArgv(step.run, process.platform, env), env: stepEnv });
      if (step.name === DATABASE_STEP && result.status === 2 && result.error === undefined && `${result.stdout}${result.stderr}`.includes(NEEDS_DATABASE)) {
        findings.push({ code: DATABASE_SKIPPED, level: 'warning', engine: family, path: CI_WORKFLOW, message: `${CI_WORKFLOW} ${step.job} / ${step.name} (${step.run}) was not run here: it applies the migrations to a scratch database and needs Docker (or an empty database named by --db-url-env), which this host lacks; CI runs it, and it is the step that finds BE_ENTITY_SCHEMA_DRIFT` });
        progress.tick(index + 1, 0, index + 1);
        continue;
      }
      if (result.status !== 0 || result.error !== undefined) {
        failed += 1;
        const why = result.error === undefined ? `exit ${String(result.status)}` : result.error.message;
        findings.push({ code: 'CI_PARITY_STEP_FAILED', level: 'error', engine: family, path: CI_WORKFLOW, message: `${CI_WORKFLOW} ${step.job} / ${step.name} (${step.run}) failed locally as it would in CI (${why}): ${tailOf(`${result.stdout}\n${result.stderr}`)}` });
      }
      progress.tick(index + 1, 0, index + 1);
    }
    progress.end();
    const report: FamilyReport = { family, mode: 'full', reason: mine.length === 0 ? `${CI_WORKFLOW} has no ${family} step` : `${String(mine.length)} step(s) of ${CI_WORKFLOW}, never cached`, checked: mine.length, reused: 0, newFindings: failed, knownFindings: 0, fixedFindings: 0 };
    session.report(report);
    reports.push(report);
  }
  return { findings, reports };
}
