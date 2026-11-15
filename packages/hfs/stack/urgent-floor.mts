// urgent-floor.mts - the safety floor of an urgent deploy (`starci app stack deploy --urgent`). An urgent
// release skips CI and the full gate, never this floor; each step that fails is a refusal with its own code, never a warning.
// Nature: a deploy's safety steps run where the data is, whichever path triggered the deploy. So the floor adds only what an urgent release lacks
// (its record and a rollback target) and then runs the deploy's own database phases (db-phases.mts), seed step and contract pass, in the same
// place and with the same guarantees as the automatic path; its one difference is that the backup is never skipped (alwaysBackup):
//   record     the commit carries a pushed URGENT record (release/urgent.mts)                     STACK_URGENT_NO_RECORD, STACK_URGENT_NOT_PUSHED
//   render     the release renders locally (deploy.mts inspectRendered)                           its own STACKS_/STACK_DEPLOY_ refusal
//   rollback   an accepted previous release exists, so a red deploy has somewhere to go back to    STACK_URGENT_NO_ROLLBACK_TARGET
//   preview    db migrate preview (inside the database container for database.target: stack)      STACK_DEPLOY_MIGRATE_PREVIEW_RED, STACK_DEPLOY_DB_FOREIGN_CHAIN
//   backup     a fresh full encrypted backup, receipt verified, test decrypt, ALWAYS: for a `stack`  STACK_DEPLOY_BACKUP_FAILED, STACK_DEPLOY_BACKUP_UNVERIFIED,
//              database made, kept and test-decrypted on the manager through the deploy's own ssh  STACK_DEPLOY_BACKUP_DECRYPT_FAILED
//              runner with the server's identity (nothing on the operator's machine: no database
//              client, no route to the database, no SOPS_AGE_KEY_FILE); for an `external` one made
//              where the deploy runs and test-decrypted with SOPS_AGE_KEY_FILE                     STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE
//   migrate    the expand migrations; the contract ones after the accept                           STACK_DEPLOY_MIGRATE_FAILED
//   deploy     the release, converge, the seed step (seeds.mts), readiness verify; red rolls back  STACK_URGENT_RED_ROLLED_BACK, STACK_URGENT_ROLLBACK_FAILED,
//                                                                                                 STACK_URGENT_DEPLOY_NOT_STARTED (red before the stack deploy)
// A refusal of a shared step keeps that step's code. The public-host checks are never skipped (STACK_URGENT_SKIP_PUBLIC). A rollback cannot
// undo the migrations: the backup above is their way back.
// An empty `stack` database takes the deploy's own first start by itself (db-phases.mts firstStartReason). `--first-start` names it explicitly
// (`--db-service <service>`, which a `stack` database may omit: its declared service): the release is first deployed with every service but the
// database at 0 replicas (a global-mode service is held off every node by an unsatisfiable placement constraint), so no app starts against an
// empty schema; then the floor waits for the database service's container to accept connections, proves the database empty (no migration
// history, no table in public), runs migrate preview then execute inside that container (db/bootstrap.sql first) and gives the app role its
// sealed password (database.appPassword, exactly as the automatic first start); then the real stack is deployed, converged and seeded.
// Each failure is its own code: STACK_FIRST_START_USAGE (no --db-service for an external database, or one that is not the declared service),
// STACK_FIRST_START_NO_DATABASE, STACK_FIRST_START_NOT_EMPTY (use the plain urgent floor), STACK_FIRST_START_MIGRATE_RED,
// STACK_FIRST_START_APP_ROLE; each rolls the release back to the previous one.
// `deps` are the collaborators (db-phases.mts FloorDeps), each defaulting to the app's own db verbs; a spec injects stubs.
import fs from 'node:fs';
import { readDeclaration } from '../release/index.mjs';
import { releaseDir } from '../release/gate.mjs';
import { DEFAULT_DB_URL_ENV, dbTarget, inContainer } from '../db/postgres.mjs';
import { readUrgent } from '../release/records.mjs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import { FIRST_START_WAIT_SECONDS, FLOOR_DEPS, appRoleOf, declaredDatabase, firstStartHooks, firstStartStep as sharedFirstStartStep, refused } from './db-phases.mjs';
import type { BackupData, BackupReceipt, DeployDatabase, FirstStartStepResult, FloorDeps } from './db-phases.mjs';
import type { ActionResult } from './remote.mjs';

export { FIRST_START_WAIT_SECONDS, FLOOR_DEPS };
export type { BackupData, BackupReceipt, FirstStartStepResult, FloorDeps };

/** The options of an urgent deploy the floor reads. */
export interface FloorOptions {
  skipPublic?: boolean | undefined;
  sourceSha: string;
  firstStart?: boolean | undefined;
  dbService?: string | undefined;
  dbUrlEnv?: string | undefined;
  backupOut?: string | undefined;
  execute?: boolean | undefined;
}

/** The data a deploy result carries that the floor reads. */
export interface DeployData {
  steps?: { step: string }[];
  rolledBack?: boolean;
  previous?: string | null;
  [key: string]: unknown;
}
/** The result of the release's deploy as the floor sees it. */
export type DeployOutcome = ActionResult<DeployData>;

/** The urgent record of a commit (release/records.mts). */
interface UrgentRecord { tag: string; role: string; reason: string; pushed?: boolean }

/** The steps of a deploy the floor drives, handed over by deploy.mts. */
export interface UrgentRun {
  render(): Promise<{ releaseId: string }>;
  openStore(): Promise<{ current(): Promise<string> }>;
  deployExecute(hooks?: { firstStartStep?: () => Promise<FirstStartStepResult>; firstStartDb?: string }): Promise<DeployOutcome>;
  dryRun(): Promise<ActionResult>;
  /** Hands the urgent record (tag, role, reason) to the deploy journal once the floor has read it. */
  note?(record: { tag: string; role: string; reason: string }): void;
}

/** What the floor needs before anything runs: the pushed urgent record, a declared database, the identity a local test decrypt reads, the full public verify. */
async function preconditions(ctx: StackContext, config: DeployConfig, options: FloorOptions): Promise<{ record: UrgentRecord; database: DeployDatabase }> {
  if (options.skipPublic) throw refusal('STACK_URGENT_SKIP_PUBLIC', 'an urgent deploy verifies the public hosts and accepts the release: drop --skip-public');
  const record: UrgentRecord | undefined = readUrgent(releaseDir(ctx), options.sourceSha);
  if (!record) throw refusal('STACK_URGENT_NO_RECORD', `${options.sourceSha} has no urgent record: push it with starci app release push --urgent --reason "<text>" --execute first`);
  if (record.pushed !== true) throw refusal('STACK_URGENT_NOT_PUSHED', `the urgent release ${record.tag} of ${options.sourceSha.slice(0, 10)} was never pushed`);
  const root = config.repoRoot ?? ctx.cwd;
  if (!readDeclaration(root).database) throw refusal('STACK_URGENT_NO_DATABASE', 'the floor backs up and migrates the database the `database:` block declares, and this app declares none');
  const database = await declaredDatabase(ctx, { repoRoot: root }) as DeployDatabase; // the block exists (above)
  if (options.firstStart === true) {
    // A first start backs nothing up; it needs the service its database runs as: a `stack` database declares it, an external one names it.
    if (database.target === 'stack' && options.dbService && options.dbService !== database.service) throw refusal('STACK_FIRST_START_USAGE', `--db-service ${options.dbService} is not the database service the database: block declares (${database.service}): drop --db-service or name ${database.service}`);
    if (database.target !== 'stack' && !options.dbService) throw refusal('STACK_FIRST_START_USAGE', '--first-start names the stack service of the database it bootstraps: add --db-service <service>');
    return { record, database };
  }
  // A `stack` database is backed up and test-decrypted on the manager with the server's identity; only an external one is decrypted here.
  const identity = ctx.env.SOPS_AGE_KEY_FILE;
  if (database.target === 'external' && (!identity || !fs.existsSync(identity))) throw refusal('STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE', 'the test decrypt of an external database\'s backup reads the age identity named by SOPS_AGE_KEY_FILE, which is not set or not a file');
  return { record, database };
}

/**
 * The `first-start` step of an urgent first start (between the hold deploy and the real one): the deploy's own step (db-phases.mts), app role
 * password included. A `stack` database is reached inside its container with the credentials that container holds; an external one by the
 * operator's --db-url-env, inside the named container.
 */
function firstStartOf(ctx: StackContext, config: DeployConfig, options: FloorOptions, database: DeployDatabase, f: FloorDeps): { service: string; step: () => Promise<FirstStartStepResult> } {
  if (database.target === 'stack') {
    const hooks = firstStartHooks({ ctx, config, database, f, run: null }, 'the operator named --first-start under the urgent floor');
    return { service: hooks.service, step: hooks.step };
  }
  const service = options.dbService as string; // preconditions required --db-service for an external database
  return {
    service,
    step: () => sharedFirstStartStep(ctx, config, {
      service,
      targetFor: (container) => inContainer(dbTarget(ctx, options.dbUrlEnv ?? DEFAULT_DB_URL_ENV), container),
      hint: 'a database with data takes the plain urgent floor (backup first)',
      appRole: appRoleOf(config, database),
    }, f),
  };
}

/** What a dry run of the floor plans, before the deploy's own plan. */
function floorPlan(config: DeployConfig, options: FloorOptions, database: DeployDatabase): string {
  const where = database.target === 'stack' ? 'made and test-decrypted on the manager' : 'made where the deploy runs and test-decrypted with SOPS_AGE_KEY_FILE';
  if (options.firstStart === true) {
    const service = database.target === 'stack' ? database.service : options.dbService;
    return `floor (never skipped), first start of ${config.stack}_${service}: rollback target, hold deploy (every service but the database at 0 replicas, global services held off every node), wait for the database, prove it empty, migrate preview then execute inside its container, the app role's sealed password, then the real deploy; converge, seed, readiness verify and automatic rollback`;
  }
  return `floor (never skipped): rollback target, migrate preview, a fresh encrypted database backup ${where} with its receipt verified, expand migrations, deploy, converge, seed, readiness verify, automatic rollback, contract migrations after the accept; an empty stack database takes the first start`;
}

/**
 * An urgent deploy: the floor's preconditions, then (with execute) the local render and the rollback target, then `deployExecute` (the deploy's
 * database phases with the backup always taken, the release, converge, seed, readiness verify, the automatic rollback, the contract pass).
 * `run` = { render(), openStore(), deployExecute(), dryRun() }. Returns { ok, lines, data } or a refused result whose data names the urgent release.
 */
export async function urgentDeploy(ctx: StackContext, config: DeployConfig, options: FloorOptions, run: UrgentRun, deps: Partial<FloorDeps> = {}): Promise<ActionResult> {
  const f: FloorDeps = { ...FLOOR_DEPS, ...deps };
  const { record, database } = await preconditions(ctx, config, options);
  run.note?.(record);
  const lines = [`urgent         ${record.tag} (${options.sourceSha.slice(0, 10)}) by ${record.role}: ${record.reason}`];
  const marks = { urgent: record.tag, ...(options.firstStart === true ? { firstStart: true } : {}) };
  if (options.execute !== true) {
    const plan = await run.dryRun();
    return { ...plan, lines: [...lines, floorPlan(config, options, database), ...plan.lines], data: { ...plan.data, ...marks } };
  }
  const { releaseId } = await run.render();
  lines.push(`floor: release ${releaseId} rendered`);
  const store = await run.openStore();
  if (!(await store.current())) return refused(lines, 'STACK_URGENT_NO_ROLLBACK_TARGET', 'no accepted previous release is stored on the manager, so a red urgent deploy could not roll back; nothing was backed up, migrated or deployed', marks);
  const first = options.firstStart === true ? firstStartOf(ctx, config, options, database, f) : null;
  let firstCode: string | null = null; // the code of a red first-start step, kept when the deploy reports only its rollback
  const firstStartStep = async (): Promise<FirstStartStepResult> => { const step = await (first as NonNullable<typeof first>).step(); firstCode = step.code ?? null; return step; };
  const deployed = await (first ? run.deployExecute({ firstStartDb: first.service, firstStartStep }) : run.deployExecute());
  const all = [...lines, ...deployed.lines];
  const data = { ...deployed.data, ...marks };
  if (deployed.ok) return { ...deployed, lines: all, data };
  if (!deployed.refused && firstCode) deployed.refused = { code: firstCode, message: 'the first start failed' };
  const started = (deployed.data?.steps ?? []).some((step: { step: string }) => step.step === 'deploy' || step.step === 'deploy-hold');
  const back = deployed.data?.rolledBack ? `the release was rolled back to ${deployed.data.previous}` : 'the rollback did not converge: follow the stack runbook, Rollback';
  // A shared step's refusal keeps its own code (STACK_DEPLOY_BACKUP_*, STACK_DEPLOY_MIGRATE_*, STACK_DEPLOY_DB_*, STACK_FIRST_START_*).
  if (deployed.refused) return refused(all, deployed.refused.code, started ? `${deployed.refused.message}; ${back}` : deployed.refused.message, data);
  if (!started) return refused(all, 'STACK_URGENT_DEPLOY_NOT_STARTED', 'the release failed before the stack deploy, so the services are untouched; the migrations stay (backup above)', data);
  if (deployed.data?.rolledBack) return refused(all, 'STACK_URGENT_RED_ROLLED_BACK', `the release failed its deploy or readiness verify and was rolled back to ${deployed.data.previous}; the migrations stay (backup above)`, data);
  return refused(all, 'STACK_URGENT_ROLLBACK_FAILED', 'the release is red and the automatic rollback did not converge: follow the stack runbook, Rollback', data);
}
