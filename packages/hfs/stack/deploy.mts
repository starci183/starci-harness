// deploy.mjs - the whole release (deployRelease) and the redeploy of a stored release (rollbackRelease).
// deploy: render, provision, store the release record, pre-pull, `docker stack deploy`, converge, post-deploy tasks (deploy.postDeploy, when declared), verify, accept, prune. A failure at or
// after the stack deploy redeploys the previous accepted release from its STORED bytes; a failure before it leaves the services untouched.
// Without `execute` a deploy renders locally and prints the plan: NO remote call at all. A rollback cannot undo data effects.
// An app that declares the `database:` block gets the database phases of db-phases.mjs in every deploy (owner approval 2026-10-31): migrate preview, a
// verified backup only when something is pending, the expand migrations inside the database container before the stack deploy, the contract migrations
// after accept, and an automatic first start when no release was ever accepted. An app without the block deploys exactly as before.
// An urgent deploy (`urgent`, owner ruling urgent-release 2026-10-29) runs the safety floor of urgent-floor.mjs first (fresh verified encrypted
// backup with a test decrypt, rollback target, migrate preview then execute) and refuses with the floor's own code when a step of it fails; its
// first start (`firstStart`) deploys the stack with only the database running (the `deploy-hold` step), proves the database empty and migrates it inside its own
// container (the `first-start` step), then deploys the real stack and converges.
// Every execute run is one recorded ATTEMPT (journal.mjs): the deploy lock of the manager (shared with the owner's urgent deploy), the deploy journal written at
// every phase boundary, the skip when the accepted release already runs this commit, and the live services snapshotted after converge, after a rollback and on accept
// (status.mjs; `stack status` and `stack verify` judge them). Preflight also pulls the images of the rollback target, so a registry clean-up cannot strand a rollback.
//
// `deps` are the collaborators, all factories or functions with the signature of their module, defaulting to lazy dynamic imports so this
// module never needs render.mjs / provision.mjs / remote.mjs at load time (the specs inject stubs):
//   renderRelease, provisionRelease, convergeStack, verifyStack, pruneStack     (ctx, config, options) -> { ok, lines, data }
//   releaseStore  (config, ssh) -> store          ssh  (ctx, config, { sshCmd }) -> runner(command, { input })
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findInOrder } from '../runtime/scripts/lib/in-order.mjs';
import { convergeStack } from './converge.mjs';
import type { DeployConfig } from './config.mjs';
import { describeClash, edgeCollisions, reconcileEdgeAliases } from './edge-alias.mjs';
import { firstLine, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { hasPlaceholderDigest, isReleaseId } from './digest.mjs';
import { contractPhase, declaredDatabase, expandPhase, firstStartHooks, FLOOR_DEPS, unknownDatabaseService } from './db-phases.mjs';
import type { PhaseInput } from './db-phases.mjs';
import { failure, refusal } from './errors.mjs';
import { recordedAttempt } from './journal.mjs';
import type { AttemptMeta, Recorder } from './journal.mjs';
import { postDeployStack } from './post-deploy.mjs';
import { pruneStack } from './prune.mjs';
import type { ProvisionOptions } from './provision.mjs';
import { compareWithRelease, observedServices, stackImages } from './status.mjs';
import type { ObservedService } from './status.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import type { ActionResult, Runner, SshOptions } from './remote.mjs';
import type { RenderOptions } from './render.mjs';
import { createReleaseStore } from './release-store.mjs';
import type { ReleaseStore } from './release-store.mjs';
import { urgentDeploy } from './urgent-floor.mjs';
import type { DeployData, DeployOutcome, FirstStartStepResult, FloorDeps } from './urgent-floor.mjs';
import { verifyStack } from './verify.mjs';

/** What a deploy takes (the CLI's flags, see cli.mjs OPTIONS). */
export interface DeployOptions {
  images?: Record<string, string> | undefined;
  sourceSha?: string | undefined;
  execute?: boolean | undefined;
  out?: string | null | undefined;
  timeoutSeconds?: number | undefined;
  retrySeconds?: number | undefined;
  skipPublic?: boolean | undefined;
  sshCmd?: string | null | undefined;
  urgent?: boolean | undefined;
  dbUrlEnv?: string | undefined;
  backupOut?: string | undefined;
  firstStart?: boolean | undefined;
  dbService?: string | undefined;
  reason?: string | undefined;
  remote?: string | undefined;
  /** The id of the CI run that is deploying (digits): the attempt's trigger is `ci` and its journal names the run. The evidence check is the CLI's (`--ci-run`). */
  ciRun?: string | undefined;
  /** Deploys even when the accepted release already runs this commit (the dispatch `redeploy`). */
  redeploy?: boolean | undefined;
  /** How long to wait for a held deploy lock, in seconds (default 600). */
  lockWaitSeconds?: number | undefined;
  /** The `first-start` step the urgent floor adds between edge and converge. */
  firstStartStep?: (() => Promise<FirstStartStepResult>) | undefined;
  /** The stack service of the database a first start bootstraps: the one service its hold deploy leaves running. */
  firstStartDb?: string | undefined;
}

/** What a rollback takes. */
export interface RollbackOptions { release?: string | null | undefined; execute?: boolean | undefined; timeoutSeconds?: number | undefined; sshCmd?: string | null | undefined; lockWaitSeconds?: number | undefined }

/** What an accept takes. */
export interface AcceptOptions { release?: string | null | undefined; execute?: boolean | undefined; retrySeconds?: number | undefined; sshCmd?: string | null | undefined; lockWaitSeconds?: number | undefined; dbUrlEnv?: string | undefined }

/** The collaborators of a deploy (see the header); the specs inject stubs. */
export interface DeployDeps {
  renderRelease: (ctx: StackContext, config: DeployConfig, options: RenderOptions) => Promise<ActionResult>;
  provisionRelease: (ctx: StackContext, config: DeployConfig, options: ProvisionOptions) => Promise<ActionResult>;
  convergeStack: (ctx: StackContext, config: DeployConfig, options: { since: string; timeoutSeconds?: number | undefined }) => Promise<ActionResult>;
  reconcileEdge: (ctx: StackContext, config: DeployConfig, file: string) => ActionResult | Promise<ActionResult>;
  postDeployStack: (ctx: StackContext, config: DeployConfig) => Promise<ActionResult>;
  verifyStack: (ctx: StackContext, config: DeployConfig, options: { retrySeconds?: number | undefined; skipPublic?: boolean; stackFile?: string }) => Promise<ActionResult>;
  pruneStack: (ctx: StackContext, config: DeployConfig, options: { keepFiles: string[]; execute: boolean }) => Promise<ActionResult>;
  releaseStore: (config: DeployConfig, ssh: Runner) => ReleaseStore;
  observedServices: (ctx: StackContext, config: DeployConfig) => ObservedService[];
  ssh: (ctx: StackContext, config: DeployConfig, options: SshOptions) => Runner | Promise<Runner>;
  floor: Partial<FloorDeps>;
}

/** The record of one step of a deploy. */
interface StepRecord { step: string; ok: boolean }
/** A step: its name and what it runs. */
type Step = [string, () => ActionResult | Promise<ActionResult>];
/** Closers of the runners a verb opened. */
type Cleanups = (() => unknown)[];

/** Loads `file` (relative to this module). Split out so a spec can load a real sibling module through `lazy`. */
// reason: a dynamic import by string; the module's shape is known only to its caller (`lazy`)
export const importModule = (file: string): Promise<any> => import(file);

/** A function that imports `file` on first call and forwards its arguments to the export `name`. */
export const lazy = <Args extends unknown[], Result>(file: string, name: string) => async (...args: Args): Promise<Result> => (await importModule(file))[name](...args);

export const DEFAULT_DEPS: Readonly<DeployDeps> = Object.freeze({
  renderRelease: lazy<Parameters<DeployDeps['renderRelease']>, ActionResult>('./render.mjs', 'renderRelease'),
  provisionRelease: lazy<Parameters<DeployDeps['provisionRelease']>, ActionResult>('./provision.mjs', 'provisionRelease'),
  convergeStack,
  reconcileEdge: reconcileEdgeAliases,
  postDeployStack,
  verifyStack,
  pruneStack,
  releaseStore: createReleaseStore,
  observedServices,
  ssh: lazy<Parameters<DeployDeps['ssh']>, Runner>('./remote.mjs', 'ownerSshRunner'),
  floor: {},
});

const fileSha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const IMAGE_LINE = /^[ \t]+image:[ \t]*(\S+)[ \t]*$/gmu;
const QUOTE = /^["']|["']$/gu;
const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9./_:@-]*$/u;

/** Every network alias the services of a rendered stack claim: [{ service, alias }]. */
function stackAliases(bytes: string): { service: string; alias: string }[] {
  // reason: the rendered stack, parsed YAML read defensively
  const services: Record<string, any> = parseYaml(bytes)?.services ?? {};
  return Object.entries(services).flatMap(([service, entry]) => Object.values<any>(entry?.networks ?? {}).flatMap((network) => (network?.aliases ?? []).map((alias: string) => ({ service, alias }))));
}

/**
 * A swarm service must never claim an alias that a live (compose) upstream of the declared ingress still answers to: on the shared overlay both would
 * share the name and the old route would round-robin into the new service BEFORE the routes are published. Refused before anything is changed.
 */
function refuseSharedAliases(config: DeployConfig, bytes: string): void {
  const live = new Map((config.ingress?.upstreams ?? []).filter((upstream) => upstream.container !== null).flatMap((upstream) => upstream.aliases.map((alias): [string, string] => [alias, upstream.name])));
  const clash = stackAliases(bytes).find(({ alias }) => live.has(alias));
  if (clash) throw refusal('STACK_DEPLOY_ALIAS_SHARED', `service ${clash.service} claims the network alias ${clash.alias}, which the live upstream ${live.get(clash.alias)} of deploy.ingress.upstreams still answers to: give the swarm service its own alias (for example ${clash.alias}-swarm) and point the published routes at it; nothing was changed`);
}

/**
 * Read-only preflight on the live edge networks: the implicit short name of a service (`api` for shop_api) must not equal a name another container or
 * service of the same external network resolves (docker stack deploy adds it as an alias, and the other tenant's `http://api` would reach this stack).
 */
async function refuseEdgeCollisions(run: Runner, config: DeployConfig, bytes: string): Promise<void> {
  const { clashes } = await edgeCollisions(run, config, bytes);
  const [first] = clashes;
  if (first) throw refusal('STACK_DEPLOY_ALIAS_SHARED', describeClash(first));
}

/** The release id (first 16 hex of the sha256 of the rendered stack bytes) and the distinct images of a rendered release. */
function inspectRendered(out: string, config: DeployConfig): { releaseId: string; images: string[]; bytes: string } {
  const bytes = fs.readFileSync(path.join(out, 'stack.yaml'), 'utf8');
  refuseSharedAliases(config, bytes);
  if (hasPlaceholderDigest(bytes)) throw refusal('STACK_DEPLOY_PLACEHOLDER', 'the rendered stack still carries a placeholder digest; nothing was changed');
  const images = [...new Set([...bytes.matchAll(IMAGE_LINE)].map((match) => (match[1] as string).replaceAll(QUOTE, '')))];
  const unsafe = images.find((image) => !IMAGE_REF.test(image));
  if (unsafe) throw refusal('STACK_DEPLOY_IMAGE', `the rendered stack names an image that is not a plain reference (${unsafe}); nothing was changed`);
  return { releaseId: createHash('sha256').update(bytes).digest('hex').slice(0, 16), images, bytes };
}

function renderOptions(options: DeployOptions, out: string, previous: string | null): RenderOptions {
  return { images: options.images ?? {}, sourceSha: options.sourceSha, previous, out, allowUnpinned: false, extraCompose: [] };
}

/** A step that returns { ok, lines } whatever happens: an exception becomes a failed step (used once the services may have changed). */
async function attempt(action: () => ActionResult | Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await action();
  } catch (error) {
    return { ok: false, lines: [String((error as Error).message)] };
  }
}

/** `docker stack deploy` of a stored or rendered file (`overrides`: compose files merged over it, in order). */
function stackDeploy(ctx: StackContext, config: DeployConfig, file: string, overrides: string[] = []): ActionResult {
  const files = [file, ...overrides].flatMap((one) => ['-c', one]);
  const run = tool(ctx, 'docker', ['stack', 'deploy', '--prune', '--with-registry-auth', '--resolve-image', 'always', '--detach=true', ...files, config.stack]);
  if (run.status !== 0) return { ok: false, lines: [`docker stack deploy failed: ${firstLine(run.stderr)}`] };
  return { ok: true, lines: [`deploy: requested ${config.stack} from ${path.basename(path.dirname(file))}/${path.basename(file)}`] };
}

/** The node label no node carries: a global service constrained to it has no node to run on, so none of its tasks start. */
const HOLD_LABEL = 'node.labels.starci-first-start-hold == 1';

/**
 * The compose override of a first start's hold deploy, written beside the stack: every service except the database at 0 replicas, a global-mode
 * service (it has no replica count) constrained to a node label no node carries. Merged over the rendered stack by `docker stack deploy -c`, so the
 * release's own bytes (and id) stay untouched and the real deploy that follows is the stored stack.yaml.
 */
function writeHoldOverride(config: DeployConfig, out: string, database: string): string {
  // reason: the rendered stack, parsed YAML read defensively
  const stack = parseYaml(fs.readFileSync(path.join(out, 'stack.yaml'), 'utf8'));
  const services: Record<string, any> = stack?.services ?? {};
  if (!Object.hasOwn(services, database)) throw refusal('STACK_FIRST_START_USAGE', `--db-service ${database} is not a service of the stack ${config.stack}; nothing was deployed`);
  const held = Object.fromEntries(Object.entries(services).filter(([name]) => name !== database).map(([name, entry]): [string, unknown] => [
    name,
    entry?.deploy?.mode === 'global' ? { deploy: { placement: { constraints: [HOLD_LABEL] } } } : { deploy: { replicas: 0 } },
  ]));
  const file = path.join(out, 'stack.first-start-hold.yaml');
  fs.writeFileSync(file, `${JSON.stringify({ version: stack?.version ?? '3.8', services: held }, null, 2)}
`);
  return file;
}

/** Runs [name, action] steps in order until one fails; records { step, ok } and collects the lines; each step is also a phase of the journal. Returns the failed step name or ''. */
async function runSteps(plan: Step[], lines: string[], steps: StepRecord[], rec: Recorder): Promise<string> {
  const failed = await findInOrder(plan, async ([step, action]: Step) => {
    const result = await rec.phase(step, () => attempt(action), (done) => done.ok);
    lines.push(...result.lines);
    steps.push({ step, ok: result.ok });
    return !result.ok;
  });
  return failed ? failed[0] : '';
}

const isoBefore = (ctx: Pick<StackContext, 'now'>, seconds: number): string => new Date(ctx.now() - seconds * 1000).toISOString();

/** Opens the release store over the ssh runner of this invocation; the runner's cleanup is queued on `cleanups` (sealed session files). */
async function openRunner(ctx: StackContext, config: DeployConfig, options: SshOptions, d: DeployDeps, cleanups: Cleanups): Promise<Runner> {
  const run = await d.ssh(ctx, config, { sshCmd: options.sshCmd ?? null });
  cleanups.push(() => run.cleanup?.());
  return run;
}

const openStore = async (ctx: StackContext, config: DeployConfig, options: SshOptions, d: DeployDeps, cleanups: Cleanups): Promise<ReleaseStore> => d.releaseStore(config, await openRunner(ctx, config, options, d, cleanups));

/** Redeploys a stored release after a failed deploy: fetch, stack deploy, converge. Returns the lines to print. */
async function redeployStored(ctx: StackContext, config: DeployConfig, d: DeployDeps, store: ReleaseStore, previous: string, out: string, steps: StepRecord[], rec: Recorder): Promise<{ lines: string[]; ok: boolean }> {
  const dir = path.join(out, 'previous');
  const lines = [`ROLLING BACK to the previous accepted release ${previous}`];
  const failed = await runSteps([
    ['rollback-fetch', async () => { await store.fetch(previous, dir); return { ok: true, lines: [] }; }],
    ['rollback-deploy', () => stackDeploy(ctx, config, path.join(dir, 'stack.yaml'))],
    ['rollback-edge', async () => d.reconcileEdge(ctx, config, path.join(dir, 'stack.yaml'))],
    ['rollback-converge', async () => { const converged = await d.convergeStack(ctx, config, { since: isoBefore(ctx, 30), timeoutSeconds: 600 }); snapshot(ctx, config, d, rec, 'rollback'); return converged; }],
  ], lines, steps, rec);
  lines.push(failed ? 'ROLLBACK DID NOT CONVERGE: follow the stack runbook, Rollback' : `rolled back to ${previous}`);
  return { lines, ok: !failed };
}

/** After the accept: prune with both release records (non-fatal) and drop dangling images (failure ignored). */
async function housekeeping(ctx: StackContext, config: DeployConfig, d: DeployDeps, store: ReleaseStore, { previous, out }: { previous: string | null; out: string }, lines: string[]): Promise<void> {
  const outcome = await attempt(async () => {
    const keepFiles = [path.join(out, 'release.json')];
    if (previous) {
      await store.fetch(previous, path.join(out, 'previous'));
      keepFiles.push(path.join(out, 'previous', 'release.json'));
    }
    return d.pruneStack(ctx, config, { keepFiles, execute: true });
  });
  lines.push(...outcome.lines);
  if (!outcome.ok) lines.push('prune failed (non-fatal; superseded objects stay until the next release)');
  tool(ctx, 'docker', ['image', 'prune', '-f']);
}

function prePull(ctx: StackContext, images: string[]): string[] {
  const lines: string[] = [];
  for (const image of images) {
    const run = tool(ctx, 'docker', ['pull', '--quiet', image]);
    if (run.status !== 0) throw failure('STACK_DEPLOY_PULL', `docker pull ${image} failed: ${firstLine(run.stderr)}`);
    lines.push(`pulled ${image}`);
  }
  return lines;
}

/**
 * Pulls the images of the rollback target (the release accepted at the start of the deploy) that the new release does not already name: a registry clean-up
 * must not strand a rollback, so a target whose images no longer pull refuses the deploy before the services are touched.
 */
async function prePullRollbackTarget(ctx: StackContext, store: ReleaseStore, previous: string, pulled: string[]): Promise<string[]> {
  const target = await store.read(previous);
  const images = [...new Set(Object.values(stackImages(target.stackYaml)))].filter((image) => IMAGE_REF.test(image) && !pulled.includes(image));
  const lines: string[] = [];
  for (const image of images) {
    const run = tool(ctx, 'docker', ['pull', '--quiet', image]);
    if (run.status !== 0) throw failure('STACK_DEPLOY_ROLLBACK_PULL', `the rollback target ${previous} names ${image}, which no longer pulls (${firstLine(run.stderr)}): a failed deploy could not go back; nothing was changed`);
    lines.push(`pulled ${image} (rollback target ${previous})`);
  }
  return lines;
}

/** The live services into the recorder under `moment`; null (and no snapshot) when docker cannot be asked: a snapshot never fails a deploy. */
function snapshot(ctx: StackContext, config: DeployConfig, d: DeployDeps, rec: Recorder, moment: string): ObservedService[] | null {
  try {
    const services = d.observedServices(ctx, config);
    rec.snapshot(moment, services);
    return services;
  } catch {
    return null;
  }
}

/**
 * Accepts `releaseId`: stamps the services observed now into its release record (`observed.accept`, what `stack status` compares against), stores it
 * again, and moves the pointers. Without a snapshot the release is accepted as before.
 */
async function acceptObserved(ctx: StackContext, config: DeployConfig, d: DeployDeps, store: ReleaseStore, rec: Recorder, { out, releaseId }: { out: string; releaseId: string }): Promise<void> {
  const services = snapshot(ctx, config, d, rec, 'accept');
  if (services) {
    try {
      const file = path.join(out, 'release.json');
      const record = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      fs.writeFileSync(file, `${JSON.stringify({ ...record, observed: { at: new Date(ctx.now()).toISOString(), accept: services } }, null, 2)}
`);
      await store.store(out, releaseId);
    } catch (error) {
      rec.warnings.push(`journal: the observed services were not stored in the release record (${firstLine((error as Error).message)})`);
    }
  }
  await store.accept(releaseId);
}

/**
 * The accepted release when it already runs this commit and its services still match it (nothing to deploy), else null. A same-commit release whose
 * services drifted (Swarm rolled one back, a manual update) is deployed again; an unreadable swarm is deployed too.
 */
async function alreadyLive(ctx: StackContext, config: DeployConfig, d: DeployDeps, store: ReleaseStore, sourceSha: string, lines: string[]): Promise<string | null> {
  const current = await store.current();
  if (!current) return null;
  try {
    const stored = await store.read(current);
    if (stored.release.sourceSha !== sourceSha) return null;
    const drift = compareWithRelease(stored, d.observedServices(ctx, config));
    if (drift.length === 0) return current;
    lines.push(`release ${current} runs this commit, but ${drift.map((entry) => `${entry.service} (${entry.kind})`).join(', ')} differ: deploying again`);
  } catch {
    lines.push(`release ${current} could not be compared with the live services: deploying`);
  }
  return null;
}

/** True when the deploy names the commit it deploys. */
const hasSourceSha = (options: DeployOptions): options is DeployOptions & { sourceSha: string } => Boolean(options.sourceSha);

/** Everything before the stack deploy: any failure here leaves the services untouched. Returns { ok, lines, releaseId, images, previous }. */
async function prepareRelease(ctx: StackContext, config: DeployConfig, options: DeployOptions, d: DeployDeps, out: string, seams: { run: Runner; store: ReleaseStore; rec: Recorder }): Promise<{ ok: boolean; lines: string[]; releaseId: string; previous: string; stepsDone: StepRecord[] }> {
  const { run, store, rec } = seams;
  const previous = await store.current();
  rec.note({ previous: previous || null });
  const prepared = await rec.phase('render', async () => {
    const rendered = await d.renderRelease(ctx, config, renderOptions(options, out, previous || null));
    const inspected = inspectRendered(out, config);
    await refuseEdgeCollisions(run, config, inspected.bytes);
    return { rendered, ...inspected };
  });
  const { releaseId, images } = prepared;
  rec.note({ releaseId });
  const lines = [...(prepared.rendered.lines ?? [])];
  const provisioned = await rec.phase('provision', () => d.provisionRelease(ctx, config, { execute: true, out, releaseFile: path.join(out, 'release.json') }), (done) => done.ok !== false);
  lines.push(...(provisioned.lines ?? []));
  if (provisioned.ok === false) return { ok: false, lines, releaseId, previous, stepsDone: [{ step: 'render', ok: true }, { step: 'provision', ok: false }] };
  await rec.phase('store', () => store.store(out, releaseId));
  lines.push(...await rec.phase('pre-pull', async () => [...prePull(ctx, images), ...(previous ? await prePullRollbackTarget(ctx, store, previous, images) : [])]));
  return { ok: true, lines, releaseId, previous, stepsDone: [{ step: 'render', ok: true }, { step: 'provision', ok: true }, { step: 'store', ok: true }, { step: 'pre-pull', ok: true }] };
}

async function deployExecute(ctx: StackContext, config: DeployConfig, options: DeployOptions, d: DeployDeps, out: string, seams: { run: Runner; store: ReleaseStore; rec: Recorder }): Promise<DeployOutcome> {
  const { store, rec, run } = seams;
  const prepared = await prepareRelease(ctx, config, options, d, out, seams);
  const { releaseId, previous } = prepared;
  const lines = [...prepared.lines];
  const steps = [...prepared.stepsDone];
  const data: DeployData = { releaseId, previous: previous || null, steps, rolledBack: false };
  if (!prepared.ok) return { ok: false, lines: [...lines, 'deploy not started; the services are untouched'], data };
  const since = isoBefore(ctx, 60);
  const { skipPublic } = options;
  const stackFile = path.join(out, 'stack.yaml');
  // The first start of a self-hosted database (urgent-floor.mjs): the services that need its schema must not start against an empty one (their
  // healthchecks fail and update_config rolls them back), so the stack is first deployed with only the database running, the schema is
  // bootstrapped and migrated, and then the real stack is deployed.
  // An app that declares the `database:` block migrates in every deploy (db-phases.mjs); with no accepted release the first start is chosen by itself.
  const database = options.urgent === true ? null : await declaredDatabase(ctx, config);
  const phase: PhaseInput | null = database ? { ctx, config, database, f: { ...FLOOR_DEPS, ...d.floor }, run, dbUrlEnv: options.dbUrlEnv, backupOut: options.backupOut } : null;
  const unknown = database ? unknownDatabaseService(config, database) : null;
  if (unknown) return { ok: false, refused: unknown, lines: [...lines, 'deploy not started; the services are untouched'], data: { ...data, refused: unknown.code } };
  let first = options.firstStartStep && options.firstStartDb ? { step: options.firstStartStep, service: options.firstStartDb } : null;
  let firstCode: string | null = null;
  if (phase && !first && phase.database.target === 'stack' && !previous) {
    const automatic = firstStartHooks(phase);
    first = { service: automatic.service, step: async () => { const outcome = await automatic.step(); firstCode = outcome.code ?? null; return outcome; } };
  }
  if (phase && !first) {
    const expanded = await rec.phase('migrate', () => expandPhase(phase), (done) => done.ok);
    rec.note({ backup: expanded.record.backup, migrations: expanded.record.applied });
    lines.push(...expanded.lines);
    steps.push(...expanded.steps);
    data.migrations = expanded.record;
    if (!expanded.ok) return { ok: false, refused: expanded.refused, lines: [...lines, 'deploy not started; the services are untouched'], data: { ...data, refused: expanded.refused?.code } };
  }
  const hold = first ? writeHoldOverride(config, out, first.service) : null;
  const failed = await runSteps([
    ...(hold ? [['deploy-hold', () => stackDeploy(ctx, config, stackFile, [hold])] satisfies Step] : []),
    ...(first ? [['first-start', first.step] satisfies Step] : []),
    ['deploy', () => stackDeploy(ctx, config, stackFile)],
    ['edge', async () => d.reconcileEdge(ctx, config, stackFile)],
    ['converge', async () => { const converged = await d.convergeStack(ctx, config, { since, timeoutSeconds: options.timeoutSeconds }); snapshot(ctx, config, d, rec, 'converge'); return converged; }],
    ...(config.postDeploy.length > 0 ? [['post-deploy', () => d.postDeployStack(ctx, config)] satisfies Step] : []),
    ['verify', () => d.verifyStack(ctx, config, { retrySeconds: options.retrySeconds, skipPublic: skipPublic === true, stackFile: path.join(out, 'stack.yaml') })],
    ...(skipPublic ? [] : [['accept', async () => { await acceptObserved(ctx, config, d, store, rec, { out, releaseId }); return { ok: true, lines: [`accepted release ${releaseId}`] }; }] satisfies Step]),
  ], lines, steps, rec);
  if (!failed && skipPublic) {
    data.pendingAccept = true;
    return { ok: true, lines: [...lines, ...(phase && !first ? ['db: the contract migrations (if any) run when the release is accepted'] : []), `deployed release ${releaseId}: converged and verified inside the stack; the public hosts were NOT checked and the release is NOT accepted yet`, `next: starci app stack ingress publish --env ${config.env} --execute, then starci app stack accept --env ${config.env} --release ${releaseId} --execute`], data };
  }
  if (!failed) {
    await housekeeping(ctx, config, d, store, { previous, out }, lines);
    // The contract migrations run only now, with the release accepted and serving: the previous release is no longer the one the stack runs.
    const contract = phase && !first ? await rec.phase('contract', () => contractPhase(phase), (done) => done.ok) : null;
    if (contract) {
      lines.push(...contract.lines);
      rec.note({ migrations: [...((data.migrations as { applied?: string[] } | undefined)?.applied ?? []), ...contract.applied] });
      steps.push({ step: 'contract', ok: contract.ok });
      data.migrations = { ...(data.migrations as object), contractApplied: contract.applied };
    }
    if (contract && !contract.ok) return { ok: false, lines: [...lines, `release ${releaseId} is accepted and serving; its contract migration is red: the owner decides`], data: { ...data, accepted: true, contractFailed: true } };
    return { ok: true, lines: [...lines, `deployed release ${releaseId}`], data };
  }
  lines.push(`deploy failed at ${failed}`);
  const migrations = data.migrations as { applied?: string[]; backup?: { receiptPath?: string } | null } | undefined;
  if (migrations?.applied?.length) lines.push(`db: the ${migrations.applied.length} expand migration(s) this deploy applied stay (the previous release keeps working on the expanded schema; a rollback restores services, never data); the backup ${migrations.backup?.receiptPath ?? ''} is the way back for data`);
  const stopped = firstCode ? { refused: { code: firstCode, message: 'the first start failed' } } : {};
  if (!previous) return { ok: false, lines: [...lines, 'no previous accepted release; services were rolled back by update_config where they had a previous spec'], data, ...stopped };
  const back = await redeployStored(ctx, config, d, store, previous, out, steps, rec);
  data.rolledBack = back.ok;
  return { ok: false, lines: [...lines, ...back.lines], data, ...stopped };
}

/** What starts an attempt: the owner's urgent deploy, a CI run (`--ci-run`) or a manual dispatch. */
const triggerOf = (options: Pick<DeployOptions, 'urgent' | 'ciRun'>): AttemptMeta['trigger'] => (options.urgent === true ? 'urgent' : options.ciRun ? 'ci' : 'dispatch');

/**
 * Deploys a release: `options` = { images, sourceSha, execute, out, timeoutSeconds, retrySeconds, skipPublic, sshCmd, urgent, dbUrlEnv, backupOut, ciRun, redeploy }.
 * skipPublic (the first deploy into a shared ingress, whose public routes exist only after `ingress publish`): the verification checks only what runs
 * inside the stack, and the release stays PENDING (stored and deployed, pointer not moved) until `acceptRelease` has verified it in full.
 * With `execute` the run is one recorded attempt under the deploy lock (journal.mjs); the accepted release that already runs this commit ends it green
 * as `already-current` unless `redeploy` is set.
 * Returns { ok, lines, data: { releaseId, previous, steps: [{ step, ok }], rolledBack, attempt } }.
 */
export async function deployRelease(ctx: StackContext, config: DeployConfig, options: DeployOptions = {}, deps: Partial<DeployDeps> = {}): Promise<ActionResult> {
  const d: DeployDeps = { ...DEFAULT_DEPS, ...deps };
  if (!hasSourceSha(options)) throw refusal('STACK_DEPLOY_SOURCE_SHA', '--sha is required (the git commit being deployed)');
  const made = options.out ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'stack-release-'));
  const out = (options.out ?? made) as string; // made exists whenever options.out is absent
  const cleanups: Cleanups = [];
  try {
    // The local render and its inspection: a release that cannot render is refused before anything remote happens.
    const render = async () => {
      const rendered = await d.renderRelease(ctx, config, renderOptions(options, out, null));
      return { rendered, releaseId: inspectRendered(out, config).releaseId };
    };
    const dryRun = async () => {
      const { rendered, releaseId } = await render();
      const post = config.postDeploy.length > 0 ? ` post-deploy tasks (${config.postDeploy.join(', ')}),` : '';
      const database = options.urgent === true ? null : await declaredDatabase(ctx, config);
      const databasePlan = database ? `; database (${database.target === 'stack' ? `inside the ${database.service} container, no URL held` : 'external, by --db-url-env'}): migrate preview, a verified backup only when a migration is pending, the expand migrations before the deploy, the contract migrations after the accept, and an automatic first start when no release was ever accepted` : '';
      const plan = options.skipPublic
        ? `dry run: release ${releaseId} would be provisioned, stored, pre-pulled, deployed, converged,${post} and verified inside the stack (public hosts skipped); it would stay pending until ingress publish and stack accept${databasePlan}`
        : `dry run: release ${releaseId} would be provisioned, stored, pre-pulled, deployed, converged,${post} verified, accepted${databasePlan}`;
      return { ok: true, lines: [...(rendered.lines ?? []), plan], data: { releaseId, steps: [{ step: 'render', ok: true }], executed: false } };
    };
    if (options.execute !== true) {
      if (options.urgent !== true) return await dryRun();
      const never = (what: string) => () => Promise.reject(new Error(`a dry run ${what}`));
      return await urgentDeploy(ctx, config, options, { render, dryRun, openStore: never('opens no store'), deployExecute: never('deploys nothing'), sha256: fileSha256 }, d.floor);
    }
    if (options.urgent !== true) await render();
    const run = await openRunner(ctx, config, options, d, cleanups);
    const store = d.releaseStore(config, run);
    const meta: AttemptMeta = {
      kind: 'deploy', trigger: triggerOf(options), sourceSha: options.sourceSha, ciRun: options.ciRun,
      urgent: options.urgent === true ? { role: ctx.env.STARCI_ROLE ?? 'unknown', reason: options.reason ?? '' } : undefined,
    };
    return await recordedAttempt(ctx, config, store, meta, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      const notes: string[] = [];
      const current = options.redeploy === true ? null : await rec.phase('idempotence', () => alreadyLive(ctx, config, d, store, options.sourceSha, notes));
      if (current) {
        rec.note({ releaseId: current });
        return { ok: true, lines: [`already current: release ${current} runs commit ${options.sourceSha.slice(0, 10)} and its services match it; nothing to deploy`], data: { releaseId: current, previous: null, steps: [], rolledBack: false, alreadyCurrent: true } };
      }
      const seams = { run, store, rec };
      const done = options.urgent === true
        ? await urgentDeploy(ctx, config, options, {
          render, dryRun, openStore: async () => store, sha256: fileSha256,
          deployExecute: (extra: Pick<DeployOptions, 'firstStartStep' | 'firstStartDb'> = {}) => deployExecute(ctx, config, { ...options, ...extra }, d, out, seams),
          note: (record) => rec.note({ urgent: record }),
        }, d.floor)
        : await deployExecute(ctx, config, options, d, out, seams);
      return { ...done, lines: [...notes, ...done.lines] };
    });
  } finally {
    cleanups.forEach((close) => close());
    if (made) fs.rmSync(made, { recursive: true, force: true });
  }
}

/**
 * Redeploys a stored release (default: the `previous` pointer): `options` = { release, execute, timeoutSeconds, sshCmd }.
 * `release` is read from `options` only and must be null or 16 lowercase hex. With `execute` it is one recorded attempt under the deploy lock.
 */
export async function rollbackRelease(ctx: StackContext, config: DeployConfig, options: RollbackOptions = {}, deps: Partial<DeployDeps> = {}): Promise<ActionResult> {
  const d: DeployDeps = { ...DEFAULT_DEPS, ...deps };
  const release = options.release ?? null;
  if (release !== null && !isReleaseId(release)) throw refusal('STACK_RELEASE_ID', 'the release must be 16 lowercase hex characters');
  const cleanups: Cleanups = [];
  const store = await openStore(ctx, config, options, d, cleanups);
  try {
    const target = release ?? await store.previous();
    if (!target) throw refusal('STACK_ROLLBACK_NO_TARGET', 'no previous accepted release is recorded; name one with --release');
    if (options.execute !== true) return { ok: true, lines: [`dry run: would redeploy release ${target}`], data: { release: target, executed: false } };
    return await recordedAttempt(ctx, config, store, { kind: 'rollback', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-rollback-'));
      try {
        rec.note({ releaseId: target, previous: await store.current() || null });
        const lines: string[] = [];
        const steps: StepRecord[] = [];
        const since = isoBefore(ctx, 30);
        const stackFile = path.join(scratch, 'stack.yaml');
        const failed = await runSteps([
          ['fetch', async () => { await store.fetch(target, scratch); return { ok: true, lines: [] }; }],
          ['deploy', () => stackDeploy(ctx, config, stackFile)],
          ['edge', async () => d.reconcileEdge(ctx, config, stackFile)],
          ['converge', async () => { const converged = await d.convergeStack(ctx, config, { since, timeoutSeconds: options.timeoutSeconds ?? 600 }); snapshot(ctx, config, d, rec, 'converge'); return converged; }],
          ['verify', () => d.verifyStack(ctx, config, { retrySeconds: 180, stackFile })],
          ['accept', async () => { await acceptObserved(ctx, config, d, store, rec, { out: scratch, releaseId: target }); return { ok: true, lines: [] }; }],
        ], lines, steps, rec);
        lines.push(failed ? `rollback to ${target} failed at ${failed}` : `rolled back to release ${target}; a rollback cannot undo data effects`);
        return { ok: !failed, lines, data: { release: target, executed: true, steps } };
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
      }
    });
  } finally {
    cleanups.forEach((close) => close());
  }
}

/**
 * Accepts a release that a `skipPublic` deploy left pending: the FULL verification (public hosts and checks inside the stack) must pass first, then the
 * pointer moves and the superseded secrets and configs are pruned. `options` = { release, execute, retrySeconds, sshCmd }. With `execute` it is one recorded
 * attempt under the deploy lock.
 */
export async function acceptRelease(ctx: StackContext, config: DeployConfig, options: AcceptOptions = {}, deps: Partial<DeployDeps> = {}): Promise<ActionResult> {
  const d: DeployDeps = { ...DEFAULT_DEPS, ...deps };
  const release = options.release ?? null;
  if (!isReleaseId(release)) throw refusal('STACK_RELEASE_ID', 'accept needs --release <16 lowercase hex characters> (the id the deploy printed)');
  const cleanups: Cleanups = [];
  const store = await openStore(ctx, config, options, d, cleanups);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-accept-'));
  try {
    try { await store.fetch(release, out); } catch { throw refusal('STACK_ACCEPT_UNKNOWN', `release ${release} has no stored record on the manager`); }
    const previous = await store.current();
    if (previous === release) return { ok: true, lines: [`release ${release} is already the accepted release`], data: { release, accepted: true, executed: options.execute === true } };
    if (options.execute !== true) return { ok: true, lines: [`dry run: would run the full verification (public hosts and checks inside the stack) and then accept release ${release}`], data: { release, accepted: false, executed: false } };
    return await recordedAttempt(ctx, config, store, { kind: 'accept', trigger: 'dispatch' }, { waitSeconds: options.lockWaitSeconds }, async (rec) => {
      rec.note({ releaseId: release, previous: previous || null });
      const verified = await rec.phase('verify', () => d.verifyStack(ctx, config, { retrySeconds: options.retrySeconds, stackFile: path.join(out, 'stack.yaml') }), (done) => done.ok);
      const lines = [...(verified.lines ?? [])];
      if (!verified.ok) return { ok: false, lines: [...lines, `release ${release} is NOT accepted: the full verification failed`], data: { release, accepted: false, executed: true } };
      await rec.phase('accept', () => acceptObserved(ctx, config, d, store, rec, { out, releaseId: release }));
      lines.push(`accepted release ${release}`);
      await housekeeping(ctx, config, d, store, { previous: previous || null, out }, lines);
      const database = await declaredDatabase(ctx, config);
      const contract = database ? await rec.phase('contract', () => contractPhase({ ctx, config, database, f: { ...FLOOR_DEPS, ...d.floor }, run: null, dbUrlEnv: options.dbUrlEnv }), (done) => done.ok) : null;
      if (contract) { lines.push(...contract.lines); rec.note({ migrations: contract.applied }); }
      if (contract && !contract.ok) return { ok: false, lines: [...lines, `release ${release} is accepted and serving; its contract migration is red: the owner decides`], data: { release, accepted: true, executed: true, contractFailed: true } };
      return { ok: true, lines, data: { release, accepted: true, executed: true, ...(contract ? { contractApplied: contract.applied } : {}) } };
    });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    cleanups.forEach((close) => close());
  }
}
