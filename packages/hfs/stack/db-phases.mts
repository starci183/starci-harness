// db-phases.mjs - the database steps a deploy takes from the urgent safety floor (urgent-floor.mjs) into every deploy
// (docs: contexts/project/cicd.md, Database migrations; owner approval 2026-10-31). One module owns the steps, so the urgent path and the
// automatic path run the same backup verification, test decrypt, migrate preview and first start, under the same codes:
//   STACK_DEPLOY_BACKUP_FAILED, STACK_DEPLOY_BACKUP_UNVERIFIED, STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE, STACK_DEPLOY_BACKUP_DECRYPT_FAILED,
//   STACK_DEPLOY_MIGRATE_PREVIEW_RED, STACK_DEPLOY_MIGRATE_FAILED (urgent: formerly STACK_URGENT_BACKUP_*, _DECRYPT_*, _MIGRATE_*).
// The automatic path of a deploy (an app that declares the `database:` block of application-stacks.yaml):
//   before the stack deploy   db-preview   migrate preview of every pending migration; red refuses (STACK_DEPLOY_MIGRATE_PREVIEW_RED)
//                             backup       ONLY when something is pending: a fresh age-encrypted dump on the manager, receipt verified, test decrypt
//                                          with the manager's own identity (STACK_DEPLOY_BACKUP_*); nothing pending means no backup and the record says so
//                             migrate      the EXPAND migrations (everything but `*_contract_*`), inside the database container (STACK_DEPLOY_MIGRATE_FAILED)
//   after accept              contract     the `*_contract_*` migrations; red leaves the release accepted (STACK_DEPLOY_CONTRACT_FAILED)
//   no accepted release       first start  hold deploy with only the database running, prove it empty, migrate everything inside the container,
//                                          then the real deploy; a database that is not empty is refused (STACK_FIRST_START_NOT_EMPTY)
// `database.target: stack` (default) reaches the database inside its own container with the credentials that container holds
// (db/postgres.mjs ownContainerTarget), so the deploy never holds a DATABASE_URL. `database.target: external` keeps `--db-url-env`.
// A refusal before the stack deploy leaves the services untouched. Every collaborator is a FloorDeps member, replaceable by a spec.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupRecipients } from '../db/backup-receipt.mjs';
import { readDeclaration } from '../release/index.mjs';
import { DEFAULT_DB_URL_ENV, dbTarget, ownContainerTarget, queryRows } from '../db/postgres.mjs';
import type { DbTarget as PostgresTarget } from '../db/postgres.mjs';
import { isContractMigration } from '../db/migrate.mjs';
import type { DatabaseDecl, DatabaseTarget, MigrationPhase } from '../db/migrate.mjs';
import type { DeployConfig } from './config.mjs';
import { lines as splitLines, tool } from './context.mjs';
import type { StackContext } from './context.mjs';
import { refusal } from './errors.mjs';
import type { ArchiveFacts, ManagerBackup } from './manager-backup.mjs';
import type { ActionResult, Runner } from './remote.mjs';

/** The receipt of a database backup (db/backup-receipt.mjs). */
export interface BackupReceipt { schemaOnly: boolean; at: string; file: string; bytes: number; sha256: string; parts: string[] }
/** What a backup hands back: where the receipt is and what it says. */
export interface BackupData { receiptPath: string; receipt?: BackupReceipt | undefined }
/** The database a floor step reaches (db/postgres.mjs): `{ urlEnv }`, `{}` or `{ target }`, spread into the migrate options. */
export type DbTarget = Record<string, unknown>;
/** The verdict of one migrate pass; `data` is migrate's (`done`, `push`, `pushFiles`, `pushed`). */
export interface MigrateResult { ok: boolean; lines?: string[] | undefined; data?: Record<string, unknown> | undefined }
/** Whether the database is empty, and why not. */
export interface Emptiness { empty: boolean; history: boolean; publicTables: number }
/** The outcome of the `first-start` step. */
export interface FirstStartStepResult { ok: boolean; code?: string; lines: string[] }

/** The collaborators of the database steps, each defaulting to the app's own db verbs; a spec injects stubs. */
export interface FloorDeps {
  backup: (ctx: StackContext, args: { target: DbTarget; out: string }) => Promise<BackupData>;
  decrypt: (ctx: StackContext, args: { archive: string; identity: string | null; parts: string[] }) => Promise<{ parts: string[] }>;
  migrate: (ctx: StackContext, args: { target: DbTarget; execute: boolean; phase?: MigrationPhase | undefined }) => Promise<MigrateResult>;
  dbContainer: (ctx: StackContext, config: DeployConfig, args: { service: string; seconds: number }) => Promise<string | undefined>;
  emptiness: (ctx: StackContext, target: PostgresTarget) => Promise<Emptiness>;
  /** The database of a running container, reached with the credentials that container holds. */
  containerTarget: (ctx: StackContext, container: string) => PostgresTarget;
  /** The encrypted dump of a `stack` database, made and kept on the manager. */
  managerBackup: (ctx: StackContext, config: DeployConfig, args: { run: Runner; container: string; url: string; recipients: string[]; at: string }) => Promise<ManagerBackup>;
  /** The test decrypt of that dump on the manager with its own identity: the parts it lists. */
  managerDecrypt: (ctx: StackContext, args: { run: Runner; archive: string }) => Promise<string[]>;
}

/** The code or message of a thrown value, for a refusal line. */
export const reasonOf = (error: unknown): string => String((error as { code?: unknown } | undefined)?.code ?? (error as { message?: unknown } | undefined)?.message ?? error);
/** The message of a thrown value. */
export const messageOf = (error: unknown): string => String((error as { message?: unknown } | undefined)?.message ?? error);

/** A refused step: the lines so far and the code; the CLI prints both and exits 2. */
export const refused = (lines: string[], code: string, message: string, data: Record<string, unknown> = {}): ActionResult => ({ ok: false, refused: { code, message }, lines, data: { ...data, refused: code } });

export const AGE_HEADER = 'age-encryption.org/v1\n';
const SHA = /^[a-f0-9]{64}$/u;

/** Problems of a backup receipt against the facts measured on its archive: a full backup written by this run, size, age header and sha256 equal. */
export function backupProblems(receipt: BackupReceipt | undefined, facts: ArchiveFacts, startedMs: number): string[] {
  const problems: string[] = [];
  if (!receipt || typeof receipt !== 'object') return ['no receipt'];
  if (receipt.schemaOnly !== false) problems.push('the backup is not a full (data) backup');
  if (!Number.isFinite(Date.parse(receipt.at)) || Date.parse(receipt.at) < startedMs - 1000) problems.push('the receipt is not from this run');
  if (!facts.exists) return [...problems, 'the archive is missing'];
  if (!facts.header) problems.push('the archive has no age header');
  if (facts.size !== receipt.bytes) problems.push(`the archive is ${facts.size} bytes, the receipt says ${receipt.bytes}`);
  if (!SHA.test(String(receipt.sha256 ?? '')) || facts.sha256 !== receipt.sha256) problems.push('the archive sha256 differs from the receipt');
  return problems;
}

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

async function defaultMigrate(ctx: StackContext, { target, execute, phase }: { target: DbTarget; execute: boolean; phase?: MigrationPhase | undefined }): Promise<MigrateResult> {
  const { loadDatabase, migrateDatabase } = await import('../db/migrate.mjs');
  // The deploy's --execute is the arming of this one migration: the step runs it, it never waits for a second switch.
  const armed = Object.create(ctx, { env: { value: { ...ctx.env, STARCI_DB_ARMED: '1' } } });
  return migrateDatabase(armed, loadDatabase(ctx.cwd), { ...target, execute, ...(phase ? { phase } : {}) });
}

/** How long a first start waits for the database service's container to accept connections. */
export const FIRST_START_WAIT_SECONDS = 180;
/** How long a deploy of a running stack waits for the database service's container to accept connections. */
export const DB_WAIT_SECONDS = 60;

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
async function defaultEmptiness(ctx: StackContext, target: PostgresTarget): Promise<Emptiness> {
  const [row] = queryRows(ctx, target, "select to_regclass('supabase_migrations.schema_migrations') is not null as history, (select count(*)::int from pg_tables where schemaname = 'public') as public_tables", { withhold: true });
  return { empty: row?.history === false && row?.public_tables === 0, history: row?.history === true, publicTables: Number(row?.public_tables ?? -1) };
}

const DEFAULT_FLOOR: FloorDeps = {
  backup: defaultBackup, decrypt: defaultDecrypt, migrate: defaultMigrate, dbContainer: defaultDbContainer, emptiness: defaultEmptiness,
  containerTarget: ownContainerTarget,
  managerBackup: async (ctx, config, args) => (await import('./manager-backup.mjs')).managerBackup(ctx, config, args),
  managerDecrypt: async (ctx, args) => (await import('./manager-backup.mjs')).managerDecrypt(ctx, args),
};
export const FLOOR_DEPS: Readonly<FloorDeps> = Object.freeze(DEFAULT_FLOOR);

/**
 * The `first-start` step of a first start's deploy (between the hold deploy and the real one): the database container, the proof it is empty,
 * migrate preview then execute (every migration, contract ones included: no release runs yet) inside it. `targetFor` reaches the container's
 * database; `hint` ends the not-empty message with what the operator does next. Returns { ok, lines, code } where code names the failure.
 */
export async function firstStartStep(ctx: StackContext, config: DeployConfig, input: { service: string; targetFor: (container: string) => PostgresTarget; hint: string }, f: FloorDeps): Promise<FirstStartStepResult> {
  const service = `${config.stack}_${input.service}`;
  const container = await f.dbContainer(ctx, config, { service: input.service, seconds: FIRST_START_WAIT_SECONDS });
  if (!container) return { ok: false, code: 'STACK_FIRST_START_NO_DATABASE', lines: [`first start: no running container of ${service} accepted connections within ${FIRST_START_WAIT_SECONDS}s`] };
  const target = input.targetFor(container);
  const state = await f.emptiness(ctx, target);
  if (!state.empty) {
    const found = state.history ? 'a migration history' : `${state.publicTables < 0 ? 'an unreadable count of' : state.publicTables} table(s) in public`;
    return { ok: false, code: 'STACK_FIRST_START_NOT_EMPTY', lines: [
      `first start refused: the database of ${service} holds ${found}; ${input.hint}`,
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

/* ---- the automatic path of a deploy */

/** The database a deploy migrates: the `database:` block of application-stacks.yaml. */
export interface DeployDatabase { decl: DatabaseDecl; target: DatabaseTarget; service: string }

/** The `database:` block of the app, or null when it declares none (then a deploy has no database phase at all). */
export async function declaredDatabase(ctx: Pick<StackContext, 'cwd'>, config: Pick<DeployConfig, 'repoRoot'>): Promise<DeployDatabase | null> {
  const root = config.repoRoot ?? ctx.cwd;
  if (typeof root !== 'string' || !readDeclaration(root).database) return null;
  const { loadDatabase } = await import('../db/migrate.mjs');
  const decl = loadDatabase(root);
  return { decl, target: decl.target, service: decl.service };
}

/** What the phases of one deploy are given. */
export interface PhaseInput {
  ctx: StackContext;
  config: DeployConfig;
  database: DeployDatabase;
  f: FloorDeps;
  /** The manager's runner (a `stack` database's backup is made and kept there). */
  run: Runner | null;
  dbUrlEnv?: string | undefined;
  backupOut?: string | undefined;
}

/**
 * A `stack` database must be a service of the stack the deploy renders: an app whose `database:` block exists but whose database is not one of its
 * services declares `target: external`. Returns the refusal, or null when the service is there (or the stack's services are not known).
 */
export function unknownDatabaseService(config: Pick<DeployConfig, 'stack' | 'services'>, database: DeployDatabase): { code: string; message: string } | null {
  if (database.target !== 'stack' || !(config.services instanceof Set) || config.services.has(database.service)) return null;
  return { code: 'STACK_DEPLOY_DB_SERVICE_UNKNOWN', message: `database.service ${database.service} is not a service of the stack ${config.stack}: name the stack service that runs the database, or declare database.target: external for a database outside the stack; nothing was migrated or deployed` };
}

/** One recorded step of a deploy. */
export interface PhaseStep { step: string; ok: boolean }
/** What the deploy keeps of its migrations (the deploy result's `data.migrations`; WP1's journal records it). */
export interface MigrationRecord {
  /** Something was pending before the deploy. */
  pending: boolean;
  /** The file names of the expand and of the contract migrations that were pending. */
  expand: string[];
  contract: string[];
  /** The verified backup taken because something was pending, else null (nothing pending: no backup). */
  backup: { receiptPath: string; file: string; bytes: number; sha256: string; where: 'manager' | 'local' } | null;
  /** The versions the expand pass and the contract pass applied. */
  applied: string[];
  contractApplied: string[];
}
/** The result of a phase: ok, or the refusal that stopped it; the steps it ran and the lines it printed either way. */
export interface PhaseResult { ok: boolean; refused?: { code: string; message: string } | undefined; lines: string[]; steps: PhaseStep[]; record: MigrationRecord }

const emptyRecord = (): MigrationRecord => ({ pending: false, expand: [], contract: [], backup: null, applied: [], contractApplied: [] });
const pending = (result: MigrateResult): boolean => result.data?.done !== true;
const filesOf = (result: MigrateResult): string[] => (Array.isArray(result.data?.pushFiles) ? (result.data.pushFiles as unknown[]).map(String) : []);
const versionsOf = (result: MigrateResult): string[] => (Array.isArray(result.data?.pushed) ? (result.data.pushed as unknown[]).map(String) : []);

/** The way into the database and how migrate is told about it. */
interface Reached { pg: PostgresTarget; migrate: DbTarget; backupTarget: DbTarget; container: string | null }

/** Reaches the database: a `stack` one inside its own container, an `external` one by the URL `--db-url-env` names. */
async function reach(p: PhaseInput, seconds: number): Promise<Reached> {
  const { ctx, config, database, f } = p;
  if (database.target === 'external') {
    const urlEnv = p.dbUrlEnv ?? DEFAULT_DB_URL_ENV;
    return { pg: dbTarget(ctx, urlEnv), migrate: { urlEnv }, backupTarget: { urlEnv }, container: null };
  }
  if (p.dbUrlEnv) throw refusal('STACK_DEPLOY_DB_URL_UNEXPECTED', `database.target is stack: migrations run inside the database container and hold no URL; --db-url-env belongs to database.target: external`);
  const container = await f.dbContainer(ctx, config, { service: database.service, seconds });
  if (!container) throw refusal('STACK_DEPLOY_DB_UNAVAILABLE', `no running container of ${config.stack}_${database.service} accepts connections; nothing was migrated or deployed`);
  const pg = f.containerTarget(ctx, container);
  return { pg, migrate: { target: pg }, backupTarget: {}, container };
}

/** The backup of a `stack` database: made and kept on the manager, verified, test-decrypted. Returns the backup or the refusal. */
async function stackBackup(p: PhaseInput, reached: Reached, lines: string[], started: number): Promise<{ backup: MigrationRecord['backup'] } | { code: string; message: string }> {
  const { ctx, config, f } = p;
  if (!p.run || reached.container === null) return { code: 'STACK_DEPLOY_BACKUP_FAILED', message: 'the backup is made on the manager and no connection to it is open; nothing was migrated or deployed' };
  const recipients = [...new Set([...backupRecipients(config.repoRoot), ...(config.remote.serverRecipient ? [config.remote.serverRecipient] : [])])];
  let made: ManagerBackup;
  try { made = await f.managerBackup(ctx, config, { run: p.run, container: reached.container, url: reached.pg.url, recipients, at: new Date(ctx.now()).toISOString() }); } catch (error) {
    return { code: 'STACK_DEPLOY_BACKUP_FAILED', message: `the fresh database backup failed (${reasonOf(error)}); nothing was migrated or deployed` };
  }
  const problems = backupProblems(made.receipt, made.facts, started);
  if (problems.length > 0) return { code: 'STACK_DEPLOY_BACKUP_UNVERIFIED', message: `${problems.join('; ')}; nothing was migrated or deployed` };
  lines.push(`db: backup ${path.posix.basename(made.archive)} on the manager (${made.receipt.bytes} bytes, sha256 ${made.receipt.sha256.slice(0, 12)}) receipt ${made.receiptPath}`);
  try {
    const listed = await f.managerDecrypt(ctx, { run: p.run, archive: made.archive });
    const missing = made.receipt.parts.filter((part) => !listed.includes(part));
    if (missing.length > 0) throw new Error(`the decrypted archive lacks ${missing.join(', ')}`);
  } catch (error) {
    return { code: 'STACK_DEPLOY_BACKUP_DECRYPT_FAILED', message: `the test decrypt of the backup on the manager failed (${reasonOf(error)}); nothing was migrated or deployed` };
  }
  lines.push(`db: test decrypt on the manager listed ${made.receipt.parts.length} part(s)`);
  return { backup: { receiptPath: made.receiptPath, file: made.receipt.file, bytes: made.receipt.bytes, sha256: made.receipt.sha256, where: 'manager' } };
}

/** The backup of an `external` database: dumped where the deploy runs (`--backup-out`, else ~/.starci-backups/<project>), verified, test-decrypted. */
async function externalBackup(p: PhaseInput, reached: Reached, lines: string[], started: number): Promise<{ backup: MigrationRecord['backup'] } | { code: string; message: string }> {
  const { ctx, config, f } = p;
  const identity = ctx.env.SOPS_AGE_KEY_FILE;
  if (!identity || !fs.existsSync(identity)) return { code: 'STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE', message: 'the test decrypt of the backup reads the age identity named by SOPS_AGE_KEY_FILE, which is not set or not a file' };
  let backup: BackupData;
  try { backup = await f.backup(ctx, { target: reached.backupTarget, out: p.backupOut ?? path.join(os.homedir(), '.starci-backups', config.project) }); } catch (error) {
    return { code: 'STACK_DEPLOY_BACKUP_FAILED', message: `the fresh database backup failed (${reasonOf(error)}); nothing was migrated or deployed` };
  }
  const receipt = backup.receipt;
  const archive = path.join(path.dirname(backup.receiptPath), receipt?.file ?? '');
  const { localFacts } = await import('./manager-backup.mjs');
  const problems = backupProblems(receipt, localFacts(archive), started);
  if (problems.length > 0 || !receipt) return { code: 'STACK_DEPLOY_BACKUP_UNVERIFIED', message: `${problems.join('; ')}; nothing was migrated or deployed` };
  lines.push(`db: backup ${path.basename(archive)} (${receipt.bytes} bytes, sha256 ${receipt.sha256.slice(0, 12)}) receipt ${backup.receiptPath}`);
  try { await f.decrypt(ctx, { archive, identity, parts: receipt.parts }); } catch (error) {
    return { code: 'STACK_DEPLOY_BACKUP_DECRYPT_FAILED', message: `the test decrypt of the backup failed (${reasonOf(error)}); nothing was migrated or deployed` };
  }
  lines.push(`db: test decrypt listed ${receipt.parts.length} part(s)`);
  return { backup: { receiptPath: backup.receiptPath, file: receipt.file, bytes: receipt.bytes, sha256: receipt.sha256, where: 'local' } };
}

/**
 * Before the stack deploy: preview, backup only when something is pending, then the expand migrations. Any refusal leaves the services untouched
 * and carries its code; the migrations an execute applied before failing stay (the backup is their way back).
 */
export async function expandPhase(p: PhaseInput): Promise<PhaseResult> {
  const { ctx, f } = p;
  const lines: string[] = [];
  const steps: PhaseStep[] = [];
  const record = emptyRecord();
  const stop = (step: string, code: string, message: string): PhaseResult => { steps.push({ step, ok: false }); return { ok: false, refused: { code, message }, lines, steps, record }; };
  const started = ctx.now();
  let reached: Reached;
  try { reached = await reach(p, DB_WAIT_SECONDS); } catch (error) { return stop('db-preview', (error as { code?: string }).code ?? 'STACK_DEPLOY_DB_UNAVAILABLE', messageOf(error).replace(/^[A-Z_]+: /u, '')); }
  let preview: MigrateResult;
  try { preview = await f.migrate(ctx, { target: reached.migrate, execute: false, phase: 'all' }); } catch (error) { preview = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(preview.lines ?? []).map((line) => `db: migrate preview: ${line}`));
  if (!preview.ok) return stop('db-preview', 'STACK_DEPLOY_MIGRATE_PREVIEW_RED', 'the migration preview is red; nothing was backed up, migrated or deployed');
  steps.push({ step: 'db-preview', ok: true });
  record.pending = pending(preview);
  const files = filesOf(preview);
  record.contract = files.filter(isContractMigration);
  record.expand = files.filter((file) => !record.contract.includes(file));
  if (!record.pending) {
    lines.push('db: no migration is pending: no backup was taken and nothing is migrated');
    return { ok: true, lines, steps, record };
  }
  // The contract migrations count: they destroy data after accept, so a release that only carries them still gets its backup first.
  const made = await (p.database.target === 'external' ? externalBackup(p, reached, lines, started) : stackBackup(p, reached, lines, started));
  if ('code' in made) return stop('backup', made.code, made.message);
  record.backup = made.backup;
  steps.push({ step: 'backup', ok: true });
  let applied: MigrateResult;
  try { applied = await f.migrate(ctx, { target: reached.migrate, execute: true, phase: 'expand' }); } catch (error) { applied = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(applied.lines ?? []).map((line) => `db: migrate: ${line}`));
  if (!applied.ok) return stop('migrate', 'STACK_DEPLOY_MIGRATE_FAILED', `the migration failed; nothing was deployed (what it applied stays; restore from ${record.backup?.receiptPath ?? 'the backup'} if the database is half migrated)`);
  record.applied = versionsOf(applied);
  steps.push({ step: 'migrate', ok: true });
  if (record.contract.length > 0) lines.push(`db: ${record.contract.length} contract migration(s) wait for the accept: ${record.contract.join(', ')}`);
  return { ok: true, lines, steps, record };
}

/**
 * After the accept: the `*_contract_*` migrations. A red contract leaves the release accepted (it is serving and verified); the caller reports a
 * red job and the owner decides. Nothing pending is a green no-op without a database call beyond the preview.
 */
export async function contractPhase(p: PhaseInput): Promise<{ ok: boolean; lines: string[]; applied: string[]; skipped: boolean }> {
  const { ctx, f } = p;
  const lines: string[] = [];
  const fail = (text: string): { ok: boolean; lines: string[]; applied: string[]; skipped: boolean } => ({ ok: false, lines: [...lines, text], applied: [], skipped: false });
  let reached: Reached;
  try { reached = await reach(p, DB_WAIT_SECONDS); } catch (error) { return fail(`contract: ${messageOf(error)}; the release stays accepted`); }
  let preview: MigrateResult;
  try { preview = await f.migrate(ctx, { target: reached.migrate, execute: false, phase: 'contract' }); } catch (error) { preview = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(preview.lines ?? []).map((line) => `db: contract preview: ${line}`));
  if (!preview.ok) return fail('contract: the preview is red; nothing was applied and the release stays accepted');
  if (!pending(preview)) return { ok: true, lines: [...lines, 'db: no contract migration is pending'], applied: [], skipped: true };
  let applied: MigrateResult;
  try { applied = await f.migrate(ctx, { target: reached.migrate, execute: true, phase: 'contract' }); } catch (error) { applied = { ok: false, lines: [messageOf(error)] }; }
  lines.push(...(applied.lines ?? []).map((line) => `db: contract: ${line}`));
  if (!applied.ok) return fail('contract: the migration failed; the release stays accepted and serving; the owner decides (the backup taken before this deploy is the way back for the data)');
  return { ok: true, lines: [...lines, `db: ${versionsOf(applied).length} contract migration(s) applied after the accept`], applied: versionsOf(applied), skipped: false };
}

/** The first-start hooks of a `stack` database on an environment with no accepted release (the deploy's `deploy-hold` and `first-start` steps). */
export function firstStartHooks(p: PhaseInput): { step: () => Promise<FirstStartStepResult>; service: string } {
  const { ctx, config, f, database } = p;
  return {
    service: database.service,
    step: () => firstStartStep(ctx, config, {
      service: database.service,
      targetFor: (container) => f.containerTarget(ctx, container),
      hint: 'no release was ever accepted here, so a database that already holds data needs the owner: accept or restore its state deliberately, then deploy again',
    }, f),
  };
}
