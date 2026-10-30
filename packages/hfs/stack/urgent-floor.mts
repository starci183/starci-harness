// urgent-floor.mjs - the safety floor of an urgent deploy (`starci app stack deploy --urgent`, owner ruling urgent-release 2026-10-29). An urgent
// release skips CI and the full gate, never this floor; each step that fails is a refusal with its own code, never a warning:
//   record     the commit carries a pushed URGENT record (release/urgent.mjs)                     STACK_URGENT_NO_RECORD, STACK_URGENT_NOT_PUSHED
//   backup     a fresh full database backup, encrypted to the app's age recipients (db dump)       STACK_URGENT_BACKUP_FAILED
//   verified   its receipt names this run, its size, age header and sha256 match the archive        STACK_URGENT_BACKUP_UNVERIFIED
//   decrypt    a test decrypt with the operator's age identity (SOPS_AGE_KEY_FILE) lists every part STACK_URGENT_DECRYPT_UNAVAILABLE, STACK_URGENT_DECRYPT_FAILED
//   render     the release renders locally (deploy.mjs inspectRendered)                           its own STACKS_/STACK_DEPLOY_ refusal
//   rollback   an accepted previous release exists, so a red deploy has somewhere to go back to    STACK_URGENT_NO_ROLLBACK_TARGET
//   migrate    db migrate previews the plan, then executes it                                     STACK_URGENT_MIGRATE_PREVIEW_RED, STACK_URGENT_MIGRATE_FAILED
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
// `deps` are the collaborators (backup, decrypt, migrate), each defaulting to the app's own db verbs; a spec injects stubs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDeclaration } from '../release/index.mjs';
import { releaseDir } from '../release/gate.mjs';
import { DEFAULT_DB_URL_ENV, dbTarget, inContainer, queryRows } from '../db/postgres.mjs';
import { readUrgent } from '../release/records.mjs';
import type { DeployConfig } from './config.mjs';
import { lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';

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

/** The receipt of a database backup (db/backup-receipt.mjs). */
export interface BackupReceipt { schemaOnly: boolean; at: string; file: string; bytes: number; sha256: string; parts: string[] }
/** What a backup hands back: where the receipt is and what it says. */
export interface BackupData { receiptPath: string; receipt?: BackupReceipt | undefined }
/** The database a floor step reaches (db/postgres.mjs). */
type DbTarget = Record<string, unknown>;
/** The verdict of one migrate pass. */
interface MigrateResult { ok: boolean; lines?: string[] | undefined }
/** Whether the database is empty, and why not. */
interface Emptiness { empty: boolean; history: boolean; publicTables: number }

/** The collaborators of the floor, each defaulting to the app's own db verbs. */
export interface FloorDeps {
  backup: (ctx: StackContext, args: { target: DbTarget; out: string }) => Promise<BackupData>;
  decrypt: (ctx: StackContext, args: { archive: string; identity: string | null; parts: string[] }) => Promise<{ parts: string[] }>;
  migrate: (ctx: StackContext, args: { target: DbTarget; execute: boolean }) => Promise<MigrateResult>;
  dbContainer: (ctx: StackContext, config: DeployConfig, args: { service: string; seconds: number }) => Promise<string | undefined>;
  emptiness: (ctx: StackContext, target: unknown) => Promise<Emptiness>;
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
}

/** The outcome of the `first-start` step. */
export interface FirstStartStepResult { ok: boolean; code?: string; lines: string[] }

const AGE_HEADER = 'age-encryption.org/v1\n';
const SHA = /^[a-f0-9]{64}$/u;

/** The code or message of a thrown value, for a refusal line. */
const reasonOf = (error: unknown): string => String((error as { code?: unknown } | undefined)?.code ?? (error as { message?: unknown } | undefined)?.message ?? error);
/** The message of a thrown value. */
const messageOf = (error: unknown): string => String((error as { message?: unknown } | undefined)?.message ?? error);

/** The database a floor step reaches: the connection named by --db-url-env (default DATABASE_URL). */
const targetOf = (options: FloorOptions): DbTarget => (options.dbUrlEnv ? { urlEnv: options.dbUrlEnv } : {});

/** The backups of an urgent deploy live outside every repository: --backup-out, else ~/.starci-backups/<project>. */
const backupDir = (config: DeployConfig, options: FloorOptions): string => options.backupOut ?? path.join(os.homedir(), '.starci-backups', config.project);

async function defaultBackup(ctx: StackContext, { target, out }: { target: DbTarget; out: string }): Promise<BackupData> {
  const { dumpDatabase } = await import('../db/dump.mjs');
  return dumpDatabase(ctx, { ...target, out }).data;
}

async function defaultDecrypt(ctx: StackContext, { archive, identity, parts }: { archive: string; identity: string | null; parts: string[] }): Promise<{ parts: string[] }> {
  const { backupTool } = await import('../db/backup-receipt.mjs');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-decrypt-'));
  try {
    backupTool(ctx, 'age', ['-d', '-i', identity as string, '-o', path.join(scratch, 'backup.tar'), archive]);
    const listed = String(backupTool(ctx, 'tar', ['-tf', 'backup.tar'], { cwd: scratch }).stdout ?? '').split(/\r?\n/u).map((line) => line.replace(/^\.\//u, '').trim());
    const missing = parts.filter((part) => !listed.includes(part));
    if (missing.length > 0) throw new Error(`the decrypted archive lacks ${missing.join(', ')}`);
    return { parts: listed.filter(Boolean) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function defaultMigrate(ctx: StackContext, { target, execute }: { target: DbTarget; execute: boolean }): Promise<MigrateResult> {
  const { loadDatabase, migrateDatabase } = await import('../db/migrate.mjs');
  // The urgent deploy's --execute is the arming of this one migration: the floor runs it, it never waits for a second switch.
  const armed = Object.create(ctx, { env: { value: { ...ctx.env, STARCI_DB_ARMED: '1' } } });
  return migrateDatabase(armed, loadDatabase(ctx.cwd), { ...target, execute });
}

/** How long a first start waits for the database service's container to accept connections. */
export const FIRST_START_WAIT_SECONDS = 180;

/** The running container of `service` whose server accepts connections (pg_isready), polled until `seconds` pass; undefined when none did. */
async function defaultDbContainer(ctx: StackContext, config: DeployConfig, { service, seconds }: { service: string; seconds: number }): Promise<string | undefined> {
  const deadline = ctx.now() + seconds * 1000;
  for (;;) {
    const found = tool(ctx, 'docker', ['ps', '-q', '--filter', `label=com.docker.swarm.service.name=${config.stack}_${service}`, '--filter', 'status=running']);
    const id = splitLines(found.stdout)[0];
    if (id && tool(ctx, 'docker', ['exec', id, 'pg_isready', '-q']).status === 0) return id;
    if (ctx.now() >= deadline) return undefined;
    await new Promise<void>((resolve) => { setTimeout(resolve, 3000); });
  }
}

/** Whether the target database is empty: no migration history table and no table in public. */
async function defaultEmptiness(ctx: StackContext, target: unknown): Promise<Emptiness> {
  const [row] = queryRows(ctx, target, "select to_regclass('supabase_migrations.schema_migrations') is not null as history, (select count(*)::int from pg_tables where schemaname = 'public') as public_tables", { withhold: true });
  return { empty: row?.history === false && row?.public_tables === 0, history: row?.history === true, publicTables: Number(row?.public_tables ?? -1) };
}

export const FLOOR_DEPS: Readonly<FloorDeps> = Object.freeze({ backup: defaultBackup, decrypt: defaultDecrypt, migrate: defaultMigrate, dbContainer: defaultDbContainer, emptiness: defaultEmptiness });

/** A refused floor step: the lines so far and the code; the CLI prints both and exits 2. */
const refused = (lines: string[], code: string, message: string, data: Record<string, unknown> = {}): ActionResult => ({ ok: false, refused: { code, message }, lines, data: { ...data, refused: code } });

/** Problems of the backup receipt against its archive: written by this run, a full backup, its size, age header and sha256 equal to the file's. */
function receiptProblems(receipt: BackupReceipt | undefined, archive: string, startedMs: number, sha256: (file: string) => string): string[] {
  const problems: string[] = [];
  if (!receipt || typeof receipt !== 'object') return ['no receipt'];
  if (receipt.schemaOnly !== false) problems.push('the backup is not a full (data) backup');
  if (!Number.isFinite(Date.parse(receipt.at)) || Date.parse(receipt.at) < startedMs - 1000) problems.push('the receipt is not from this run');
  if (!fs.existsSync(archive)) return [...problems, 'the archive is missing'];
  const size = fs.statSync(archive).size;
  const header = Buffer.alloc(AGE_HEADER.length);
  const fd = fs.openSync(archive, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  if (header.toString('ascii') !== AGE_HEADER) problems.push('the archive has no age header');
  if (size !== receipt.bytes) problems.push(`the archive is ${size} bytes, the receipt says ${receipt.bytes}`);
  if (!SHA.test(String(receipt.sha256 ?? '')) || sha256(archive) !== receipt.sha256) problems.push('the archive sha256 differs from the receipt');
  return problems;
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
  if (!identity || !fs.existsSync(identity)) throw refusal('STACK_URGENT_DECRYPT_UNAVAILABLE', 'the test decrypt of the backup reads the age identity named by SOPS_AGE_KEY_FILE, which is not set or not a file');
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
    return refused(lines, 'STACK_URGENT_BACKUP_FAILED', `the fresh database backup failed (${reasonOf(error)}); nothing was migrated or deployed`);
  }
  const archive = path.join(path.dirname(backup.receiptPath), backup.receipt?.file ?? '');
  const problems = receiptProblems(backup.receipt, archive, started, run.sha256);
  if (problems.length > 0) return refused(lines, 'STACK_URGENT_BACKUP_UNVERIFIED', `${problems.join('; ')}; nothing was migrated or deployed`);
  const receipt = backup.receipt as BackupReceipt; // receiptProblems reports 'no receipt' when it is absent
  lines.push(`floor: backup ${path.basename(archive)} (${receipt.bytes} bytes, sha256 ${receipt.sha256.slice(0, 12)}) receipt ${backup.receiptPath}`);
  try { await f.decrypt(ctx, { archive, identity, parts: receipt.parts }); } catch (error) {
    return refused(lines, 'STACK_URGENT_DECRYPT_FAILED', `the test decrypt of the backup failed (${reasonOf(error)}); nothing was migrated or deployed`);
  }
  lines.push(`floor: test decrypt listed ${receipt.parts.length} part(s)`);
  const { releaseId } = await run.render();
  lines.push(`floor: release ${releaseId} rendered`);
  const store = await run.openStore();
  if (!(await store.current())) return refused(lines, 'STACK_URGENT_NO_ROLLBACK_TARGET', 'no accepted previous release is stored on the manager, so a red urgent deploy could not roll back; nothing was migrated or deployed');
  let preview: MigrateResult;
  try { preview = await f.migrate(ctx, { target, execute: false }); } catch (error) { preview = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(preview.lines ?? []).map((line) => `floor: migrate preview: ${line}`));
  if (!preview.ok) return refused(lines, 'STACK_URGENT_MIGRATE_PREVIEW_RED', 'the migration preview is red; nothing was migrated or deployed');
  let applied: MigrateResult;
  try { applied = await f.migrate(ctx, { target, execute: true }); } catch (error) { applied = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(applied.lines ?? []).map((line) => `floor: migrate: ${line}`));
  if (!applied.ok) return refused(lines, 'STACK_URGENT_MIGRATE_FAILED', `the migration failed; nothing was deployed (restore from ${backup.receiptPath} if the database is half migrated)`);
  return null;
}

/**
 * The `first-start` step of a first start's deploy (between edge and converge): the database container, the proof it is empty, migrate preview
 * then execute inside it. Returns { ok, lines, code } where code names the failure.
 */
async function firstStartStep(ctx: StackContext, config: DeployConfig, options: FloorOptions, f: FloorDeps): Promise<FirstStartStepResult> {
  const service = `${config.stack}_${options.dbService}`;
  const container = await f.dbContainer(ctx, config, { service: options.dbService as string, seconds: FIRST_START_WAIT_SECONDS }); // preconditions required --db-service
  if (!container) return { ok: false, code: 'STACK_FIRST_START_NO_DATABASE', lines: [`first start: no running container of ${service} accepted connections within ${FIRST_START_WAIT_SECONDS}s`] };
  const target = inContainer(dbTarget(ctx, options.dbUrlEnv ?? DEFAULT_DB_URL_ENV), container);
  const state = await f.emptiness(ctx, target);
  if (!state.empty) {
    const found = state.history ? 'a migration history' : `${state.publicTables < 0 ? 'an unreadable count of' : state.publicTables} table(s) in public`;
    return { ok: false, code: 'STACK_FIRST_START_NOT_EMPTY', lines: [
      `first start refused: the database of ${service} holds ${found}; a database with data takes the plain urgent floor (backup first)`,
      // A first start that migrated and then rolled back leaves exactly this: a migrated volume and no serving release.
      `if an earlier first start migrated this volume and then rolled back, and the owner confirms it holds no data, remove that volume (docker volume rm on the server) and run the first start again`,
    ] };
  }
  const lines = [`first start: the database of ${service} is empty (no migration history, no table in public): nothing to back up`];
  for (const execute of [false, true]) {
    let result: MigrateResult;
    try { result = await f.migrate(ctx, { target: { target }, execute }); } catch (error) { result = { ok: false, lines: [messageOf(error)] }; }
    lines.push(...(result.lines ?? []).map((line) => `first start: migrate${execute ? '' : ' preview'}: ${line}`));
    if (!result.ok) return { ok: false, code: 'STACK_FIRST_START_MIGRATE_RED', lines: [...lines, `first start: the migration${execute ? '' : ' preview'} is red`] };
  }
  return { ok: true, lines };
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
