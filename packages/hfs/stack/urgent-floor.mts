// urgent-floor.mjs - the safety floor of an urgent deploy (`starci app stack deploy --urgent`, owner ruling urgent-release 2026-10-29). An urgent
// release skips CI and the full gate, never this floor; each step that fails is a refusal with its own code, never a warning:
//   record     the commit carries a pushed URGENT record (release/urgent.mjs)                     STACK_URGENT_NO_RECORD, STACK_URGENT_NOT_PUSHED
//   backup     a fresh full database backup, encrypted to the app's age recipients (db dump)       STACK_DEPLOY_BACKUP_FAILED
//   verified   its receipt names this run, its size, age header and sha256 match the archive        STACK_DEPLOY_BACKUP_UNVERIFIED
//   decrypt    a test decrypt with the operator's age identity (SOPS_AGE_KEY_FILE) lists every part STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE, STACK_DEPLOY_BACKUP_DECRYPT_FAILED
//   render     the release renders locally (deploy.mjs inspectRendered)                           its own STACKS_/STACK_DEPLOY_ refusal
//   rollback   an accepted previous release exists, so a red deploy has somewhere to go back to    STACK_URGENT_NO_ROLLBACK_TARGET
//   migrate    db migrate previews the plan, then executes it                                     STACK_DEPLOY_MIGRATE_PREVIEW_RED, STACK_DEPLOY_MIGRATE_FAILED
//   deploy     the release with its readiness verify (deploy.verify); red rolls back by itself    STACK_URGENT_RED_ROLLED_BACK, STACK_URGENT_ROLLBACK_FAILED,
//                                                                                                 STACK_URGENT_DEPLOY_NOT_STARTED (red before the stack deploy)
// The public-host checks are never skipped (STACK_URGENT_SKIP_PUBLIC). A rollback cannot undo the migrations: the backup above is their way back.
// The first start (`--first-start --db-service <service>`, owner ruling 2026-10-29) is the floor of a self-hosted database the release itself
// starts: there is nothing to back up and nothing reaches it before the stack runs it, so instead of backup, decrypt and migrate before the deploy
// the release is first deployed with every service but the database at 0 replicas (a global-mode service is held off every node by an
// unsatisfiable placement constraint), so no app starts against an empty schema (its healthcheck would fail and update_config would roll it
// back); then the floor waits for the database service's container to accept connections, proves the database empty (no migration history, no
// table in public) and runs migrate preview then execute inside that container (db/bootstrap.sql first, as the --db-url-env role); then the real
// stack is deployed and converged. Every other step holds: record, rollback target, readiness verify, automatic rollback. Each failure is its own code:
//   STACK_FIRST_START_USAGE (no --db-service), STACK_FIRST_START_NO_DATABASE (no container accepted connections in time),
//   STACK_FIRST_START_NOT_EMPTY (a history or a public table: use the plain urgent floor), STACK_FIRST_START_MIGRATE_RED (preview or execute red);
// each rolls the release back to the previous one; the migrations a red first start applied stay in a database no release used before.
// The backup, decrypt, migrate and first-start steps are shared with the automatic deploy (db-phases.mjs), under the same STACK_DEPLOY_* codes; the
// urgent path keeps its operator-held --db-url-env and its always-on backup (the floor is never skipped). `deps` are the collaborators (backup,
// decrypt, migrate), each defaulting to the app's own db verbs; a spec injects stubs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDeclaration } from '../release/index.mjs';
import { releaseDir } from '../release/gate.mjs';
import { DEFAULT_DB_URL_ENV, dbTarget, inContainer } from '../db/postgres.mjs';
import { readUrgent } from '../release/records.mjs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import { FIRST_START_WAIT_SECONDS, FLOOR_DEPS, backupProblems, firstStartStep as sharedFirstStartStep, messageOf, reasonOf, refused } from './db-phases.mjs';
import type { BackupData, BackupReceipt, DbTarget, FirstStartStepResult, FloorDeps, MigrateResult } from './db-phases.mjs';
import { localFacts } from './manager-backup.mjs';
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

/** The urgent record of a commit (release/records.mjs). */
interface UrgentRecord { tag: string; role: string; reason: string; pushed?: boolean }

/** The steps of a deploy the floor drives, handed over by deploy.mjs. */
export interface UrgentRun {
  render(): Promise<{ releaseId: string }>;
  openStore(): Promise<{ current(): Promise<string> }>;
  deployExecute(hooks?: { firstStartStep?: () => Promise<FirstStartStepResult>; firstStartDb?: string }): Promise<DeployOutcome>;
  dryRun(): Promise<ActionResult>;
  sha256(file: string): string;
  /** Hands the urgent record (tag, role, reason) to the deploy journal once the floor has read it. */
  note?(record: { tag: string; role: string; reason: string }): void;
}

/** The database a floor step reaches: the connection named by --db-url-env (default DATABASE_URL). */
const targetOf = (options: FloorOptions): DbTarget => (options.dbUrlEnv ? { urlEnv: options.dbUrlEnv } : {});

/** The backups of an urgent deploy live outside every repository: --backup-out, else ~/.starci-backups/<project>. */
const backupDir = (config: DeployConfig, options: FloorOptions): string => options.backupOut ?? path.join(os.homedir(), '.starci-backups', config.project);

/** Problems of the backup receipt against its archive: written by this run, a full backup, its size, age header and sha256 equal to the file's. */
function receiptProblems(receipt: BackupReceipt | undefined, archive: string, startedMs: number, sha256: (file: string) => string): string[] {
  const facts = localFacts(archive);
  return backupProblems(receipt, facts.exists ? { ...facts, sha256: sha256(archive) } : facts, startedMs);
}

/** What the floor needs before anything runs: the pushed urgent record, a declared database, the identity of the test decrypt, the full public verify. */
function preconditions(ctx: StackContext, config: DeployConfig, options: FloorOptions): { record: UrgentRecord; identity: string | null } {
  if (options.skipPublic) throw refusal('STACK_URGENT_SKIP_PUBLIC', 'an urgent deploy verifies the public hosts and accepts the release: drop --skip-public');
  const record: UrgentRecord | undefined = readUrgent(releaseDir(ctx), options.sourceSha);
  if (!record) throw refusal('STACK_URGENT_NO_RECORD', `${options.sourceSha} has no urgent record: push it with starci app release push --urgent --reason "<text>" --execute first`);
  if (record.pushed !== true) throw refusal('STACK_URGENT_NOT_PUSHED', `the urgent release ${record.tag} of ${options.sourceSha.slice(0, 10)} was never pushed`);
  if (!readDeclaration(config.repoRoot ?? ctx.cwd).database) throw refusal('STACK_URGENT_NO_DATABASE', 'the floor backs up and migrates the database the `database:` block declares, and this app declares none');
  if (options.firstStart === true) {
    // A first start backs nothing up, so it needs no identity for a test decrypt; it needs the service its database runs as.
    if (!options.dbService) throw refusal('STACK_FIRST_START_USAGE', '--first-start names the stack service of the database it bootstraps: add --db-service <service>');
    return { record, identity: null };
  }
  const identity = ctx.env.SOPS_AGE_KEY_FILE;
  if (!identity || !fs.existsSync(identity)) throw refusal('STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE', 'the test decrypt of the backup reads the age identity named by SOPS_AGE_KEY_FILE, which is not set or not a file');
  return { record, identity };
}

/**
 * The floor's steps before the deploy: backup, verify and test decrypt (before anything remote), the local render, the rollback target, migrate
 * preview and execute. Returns null when all passed, else the refused result.
 */
async function guard(ctx: StackContext, config: DeployConfig, options: FloorOptions, { f, run, identity, lines }: { f: FloorDeps; run: UrgentRun; identity: string | null; lines: string[] }): Promise<ActionResult | null> {
  const target = targetOf(options);
  const started = ctx.now();
  let backup: BackupData;
  try { backup = await f.backup(ctx, { target, out: backupDir(config, options) }); } catch (error) {
    return refused(lines, 'STACK_DEPLOY_BACKUP_FAILED', `the fresh database backup failed (${reasonOf(error)}); nothing was migrated or deployed`);
  }
  const archive = path.join(path.dirname(backup.receiptPath), backup.receipt?.file ?? '');
  const problems = receiptProblems(backup.receipt, archive, started, run.sha256);
  if (problems.length > 0) return refused(lines, 'STACK_DEPLOY_BACKUP_UNVERIFIED', `${problems.join('; ')}; nothing was migrated or deployed`);
  const receipt = backup.receipt as BackupReceipt; // receiptProblems reports 'no receipt' when it is absent
  lines.push(`floor: backup ${path.basename(archive)} (${receipt.bytes} bytes, sha256 ${receipt.sha256.slice(0, 12)}) receipt ${backup.receiptPath}`);
  try { await f.decrypt(ctx, { archive, identity, parts: receipt.parts }); } catch (error) {
    return refused(lines, 'STACK_DEPLOY_BACKUP_DECRYPT_FAILED', `the test decrypt of the backup failed (${reasonOf(error)}); nothing was migrated or deployed`);
  }
  lines.push(`floor: test decrypt listed ${receipt.parts.length} part(s)`);
  const { releaseId } = await run.render();
  lines.push(`floor: release ${releaseId} rendered`);
  const store = await run.openStore();
  if (!(await store.current())) return refused(lines, 'STACK_URGENT_NO_ROLLBACK_TARGET', 'no accepted previous release is stored on the manager, so a red urgent deploy could not roll back; nothing was migrated or deployed');
  let preview: MigrateResult;
  try { preview = await f.migrate(ctx, { target, execute: false }); } catch (error) { preview = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(preview.lines ?? []).map((line) => `floor: migrate preview: ${line}`));
  if (!preview.ok) return refused(lines, 'STACK_DEPLOY_MIGRATE_PREVIEW_RED', 'the migration preview is red; nothing was migrated or deployed');
  let applied: MigrateResult;
  try { applied = await f.migrate(ctx, { target, execute: true }); } catch (error) { applied = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(applied.lines ?? []).map((line) => `floor: migrate: ${line}`));
  if (!applied.ok) return refused(lines, 'STACK_DEPLOY_MIGRATE_FAILED', `the migration failed; nothing was deployed (restore from ${backup.receiptPath} if the database is half migrated)`);
  return null;
}

/**
 * The `first-start` step of an urgent first start (between the hold deploy and the real one): the shared step (db-phases.mjs) against the database
 * the operator's --db-url-env names, reached inside its container. Returns { ok, lines, code } where code names the failure.
 */
function firstStartStep(ctx: StackContext, config: DeployConfig, options: FloorOptions, f: FloorDeps): Promise<FirstStartStepResult> {
  return sharedFirstStartStep(ctx, config, {
    service: options.dbService as string, // preconditions required --db-service
    targetFor: (container) => inContainer(dbTarget(ctx, options.dbUrlEnv ?? DEFAULT_DB_URL_ENV), container),
    hint: 'a database with data takes the plain urgent floor (backup first)',
  }, f);
}

/**
 * A first start: the rollback target, then the deploy whose `first-start` step bootstraps and migrates the empty database. Returns the dry-run
 * plan or a refused result, or { deployed } for the verdicts it shares with the plain floor.
 */
async function firstStartDeploy(ctx: StackContext, config: DeployConfig, options: FloorOptions, run: UrgentRun, f: FloorDeps, lines: string[]): Promise<(ActionResult & { deployed?: undefined }) | { deployed: DeployOutcome }> {
  if (options.execute !== true) {
    const plan = await run.dryRun();
    return { ...plan, lines: [...lines, `floor (never skipped), first start of ${config.stack}_${options.dbService}: rollback target, hold deploy (every service but the database at 0 replicas, global services held off every node), wait for the database, prove it empty, migrate preview then execute inside its container, then the real deploy; converge, readiness verify and automatic rollback`, ...plan.lines] };
  }
  const { releaseId } = await run.render();
  lines.push(`floor: release ${releaseId} rendered`);
  const store = await run.openStore();
  if (!(await store.current())) return refused(lines, 'STACK_URGENT_NO_ROLLBACK_TARGET', 'no accepted previous release is stored on the manager, so a red first start could not roll back; nothing was deployed');
  let code = null as string | null; // assigned by the step below
  const deployed = await run.deployExecute({
    firstStartDb: options.dbService as string, // preconditions required --db-service
    firstStartStep: async () => {
      const step = await firstStartStep(ctx, config, options, f);
      code = step.code ?? null;
      return step;
    },
  });
  if (!deployed.ok && code) {
    return refused([...lines, ...deployed.lines], code, `the first start failed; ${deployed.data?.rolledBack ? `the release was rolled back to ${deployed.data.previous}` : 'the rollback did not converge: follow the stack runbook, Rollback'}`, deployed.data);
  }
  return { deployed };
}

/**
 * An urgent deploy: the floor's preconditions, then (with execute) its guard steps, then `deployExecute` (the release, its readiness verify and the
 * automatic rollback). `run` = { render(), openStore(), deployExecute(), dryRun(), sha256 }. Returns { ok, lines, data } or a refused result whose
 * data names the urgent release.
 */
export async function urgentDeploy(ctx: StackContext, config: DeployConfig, options: FloorOptions, run: UrgentRun, deps: Partial<FloorDeps> = {}): Promise<ActionResult> {
  const f: FloorDeps = { ...FLOOR_DEPS, ...deps };
  const { record, identity } = preconditions(ctx, config, options);
  run.note?.(record);
  const lines = [`urgent         ${record.tag} (${options.sourceSha.slice(0, 10)}) by ${record.role}: ${record.reason}`];
  let deployed: DeployOutcome;
  if (options.firstStart === true) {
    const first = await firstStartDeploy(ctx, config, options, run, f, lines);
    if (first.deployed === undefined) return { ...first, data: { ...first.data, urgent: record.tag, firstStart: true } };
    deployed = first.deployed;
  } else {
    if (options.execute !== true) {
      const plan = await run.dryRun();
      return { ...plan, lines: [...lines, 'floor (never skipped): fresh encrypted database backup, receipt verify, test decrypt, rollback target, migrate preview then execute, deploy with readiness verify and automatic rollback', ...plan.lines] };
    }
    const stop = await guard(ctx, config, options, { f, run, identity, lines });
    if (stop) return { ...stop, data: { ...stop.data, urgent: record.tag } };
    deployed = await run.deployExecute();
  }
  const all = [...lines, ...deployed.lines];
  if (deployed.ok) return { ...deployed, lines: all, data: { ...deployed.data, urgent: record.tag } };
  const data = { ...deployed.data, urgent: record.tag };
  if (!(deployed.data?.steps ?? []).some((step: { step: string }) => step.step === 'deploy' || step.step === 'deploy-hold')) return refused(all, 'STACK_URGENT_DEPLOY_NOT_STARTED', 'the release failed before the stack deploy, so the services are untouched; the migrations stay (backup above)', data);
  if (deployed.data?.rolledBack) return refused(all, 'STACK_URGENT_RED_ROLLED_BACK', `the release failed its deploy or readiness verify and was rolled back to ${deployed.data.previous}; the migrations stay (backup above)`, data);
  return refused(all, 'STACK_URGENT_ROLLBACK_FAILED', 'the release is red and the automatic rollback did not converge: follow the stack runbook, Rollback', data);
}
