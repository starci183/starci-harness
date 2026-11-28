// manager-backup.mts - the database backup of a deploy whose database runs in the stack (database.target: stack): the dump is made ON the
// manager from the database container (pg_dumpall roles, pg_dump schema and data, per-table row counts), tarred and encrypted with age to the
// .sops.yaml recipients plus the server's own, and kept on the manager beside the volume backups (deploy.backup.dir, else /var/backups/<stack>/db).
// No plaintext leaves a root-private scratch directory that a trap removes, no database URL or password exists on the machine that runs the
// deploy (the container reads its own POSTGRES_PASSWORD_FILE), and the receipt is written next to the archive. The archive stays on the manager;
// copying it to another failure domain remains the owner's job. The four remote steps are the named operations of backup-ops.mts (db-dump,
// db-receipt, db-measure, db-decrypt): through the CI key's gate as `starci-op <name> <args>` when STARCI_SSH_GATE=1, else the same bodies under
// `sh -c`, every argument checked against its closed alphabet first (ssh-gate.mts).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DB_IDENT } from '../db/postgres.mjs';
import { RECEIPT_SCHEMA } from '../db/backup-receipt.mjs';
import type { BackupReceipt } from './db-phases.mjs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { AGE_HEADER, BACKUP_PARTS } from './backup-ops.mjs';
import { failure, refusal } from './errors.mjs';
import type { Runner } from './remote.mjs';
import { gateIsOn, gatedCommand, inlineCommand } from './ssh-gate.mjs';

export { BACKUP_PARTS };

/** What was measured on an archive: whether it exists, its size, whether it starts with the age header and its sha256. */
export interface ArchiveFacts { exists: boolean; size: number; header: boolean; sha256: string }
/** A dump the manager made: where the archive and its receipt are, the receipt and the measurements taken after it was written. */
export interface ManagerBackup { receiptPath: string; receipt: BackupReceipt; archive: string; facts: ArchiveFacts }

const BASE = /^\/[A-Za-z0-9._/-]+$/u;
const CONTAINER = /^[0-9a-f]{12,64}$/u;
const RECIPIENT = /^age1[0-9a-z]{50,}$/u;
/** An archive of this module: <folder>/<name>.tar.age. */
const ARCHIVE = /^(\/[A-Za-z0-9._/-]+)\/([A-Za-z0-9_-]+-[0-9]{8}T[0-9]{9}Z)\.tar\.age$/u;

/** The folder of the database backups on the manager. */
export function backupFolder(config: Pick<DeployConfig, 'backup' | 'stack'>): string {
  const base = config.backup?.dir ?? `/var/backups/${config.stack}`;
  const dir = `${base}/db`;
  if (!BASE.test(dir) || dir.split('/').includes('..')) throw refusal('STACK_DEPLOY_BACKUP_DIR', `the backup folder ${dir} must be an absolute path without ..`);
  return dir;
}

/** The measurements of a local archive (an external database's backup, made where the deploy runs). */
export function localFacts(archive: string): ArchiveFacts {
  if (!fs.existsSync(archive)) return { exists: false, size: 0, header: false, sha256: '' };
  const bytes = fs.readFileSync(archive);
  return { exists: true, size: bytes.length, header: bytes.subarray(0, AGE_HEADER.length + 1).toString('ascii') === `${AGE_HEADER}\n`, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** The name of one backup operation. */
export type BackupOp = 'db-dump' | 'db-receipt' | 'db-measure' | 'db-decrypt';

/** The remote command of one backup operation: gated (`starci-op ...`) when the key has the gate, else the same body under `sh -c`. */
export function backupCommand(ctx: Pick<StackContext, 'env'> | undefined, name: BackupOp, args: readonly string[]): string {
  return gateIsOn(ctx?.env) ? gatedCommand(name, args) : inlineCommand(name, args);
}

/** What the dump is given. */
export interface DumpInput { dir: string; name: string; container: string; url: string; recipients: readonly string[] }

/** The arguments of db-dump: the folder, the name, the container, the role and database of the container's own URL, the recipients joined by commas. */
export function dumpArguments({ dir, name, container, url, recipients }: DumpInput): string[] {
  if (!CONTAINER.test(container)) throw refusal('STACK_DEPLOY_BACKUP_FAILED', 'the database container id is not a plain id');
  if (recipients.length === 0 || recipients.some((recipient) => !RECIPIENT.test(recipient))) throw refusal('STACK_DEPLOY_BACKUP_FAILED', 'the backup needs at least one age recipient, each a plain age1... key');
  const parsed = new URL(url);
  const [role, database] = [decodeURIComponent(parsed.username), decodeURIComponent(parsed.pathname.slice(1))];
  // The URL is the container's own (db/postgres.mts ownContainerTarget): a role and a database on its loopback, never a password.
  if (parsed.password !== '' || parsed.host !== '127.0.0.1:5432' || !DB_IDENT.test(role) || !DB_IDENT.test(database)) throw refusal('STACK_DEPLOY_BACKUP_FAILED', "the database URL is not the container's own (a plain role and database on 127.0.0.1:5432, no password)");
  return [dir, name, container, role, database, recipients.join(',')];
}

const stamp = (at: string): string => at.replaceAll(/[-:.]/gu, '');
const projectName = (config: Pick<DeployConfig, 'project'>): string => config.project.replaceAll(/[^A-Za-z0-9_-]/gu, '-') || 'database';

/** The rows of rowcounts.json as the receipt's summary: table count and total rows. */
function summarize(text: string): { tables: number; rows: string } {
  let counts: unknown;
  try { counts = JSON.parse(text.trim() || '[]'); } catch { throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the row counts of the dump are unreadable; output withheld'); }
  if (!Array.isArray(counts)) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the row counts of the dump are not a list');
  return { tables: counts.length, rows: counts.reduce<bigint>((sum, row) => sum + BigInt(/^\d+$/u.test(String((row as { count?: unknown })?.count)) ? String((row as { count: unknown }).count) : '0'), 0n).toString() };
}

/**
 * Dumps the database of `container` on the manager and writes the receipt beside the archive. Returns the receipt and what the manager measures on
 * the archive afterwards (a second reading, so the receipt is judged against the file, not against the script that wrote it).
 */
export async function managerBackup(ctx: Pick<StackContext, 'env'>, config: DeployConfig, { run, container, url, recipients, at }: { run: Runner; container: string; url: string; recipients: string[]; at: string }): Promise<ManagerBackup> {
  const dir = backupFolder(config);
  const name = `${projectName(config)}-${stamp(at)}`;
  const file = `${name}.tar.age`;
  const archive = `${dir}/${file}`;
  const receiptPath = `${dir}/${name}.receipt.json`;
  const dumped = run(backupCommand(ctx, 'db-dump', dumpArguments({ dir, name, container, url, recipients })));
  if (dumped.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the dump on the manager failed; output withheld');
  const [sha256 = '', bytes = '', ...rest] = dumped.stdout.split('\n');
  if (!/^[a-f0-9]{64}$/u.test(sha256.trim()) || !/^\d+$/u.test(bytes.trim())) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the dump on the manager printed no archive size or hash');
  const receipt = {
    schema: RECEIPT_SCHEMA, project: projectName(config), target: 'container', ref: `${config.stack}`, at, file, bytes: Number(bytes.trim()), sha256: sha256.trim(),
    parts: [...BACKUP_PARTS], rowcounts: summarize(rest.join('\n')), schemaOnly: false,
  };
  const written = run(backupCommand(ctx, 'db-receipt', [dir, name]), { input: `${Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`).toString('base64')}\n` });
  if (written.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the receipt could not be written on the manager');
  const measured = run(backupCommand(ctx, 'db-measure', [dir, name]));
  if (measured.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the archive could not be measured on the manager');
  const reading = Object.fromEntries(measured.stdout.split('\n').map((line) => line.trim().split('=')).filter((pair) => pair.length === 2) as [string, string][]);
  const facts: ArchiveFacts = { exists: reading.exists === '1', size: Number(reading.bytes ?? 0), header: reading.header === '1', sha256: reading.sha256 ?? '' };
  return { receiptPath, receipt, archive, facts };
}

/**
 * Opens the archive on the manager with the manager's own identity and lists its parts (db-decrypt: as root, else in a container of the
 * database's image). Throws when the identity cannot open it.
 */
export async function managerDecrypt(ctx: Pick<StackContext, 'env'>, { run, archive, container }: { run: Runner; archive: string; container: string }): Promise<string[]> {
  const parts = ARCHIVE.exec(archive);
  if (!parts || archive.includes('..')) throw refusal('STACK_DEPLOY_BACKUP_DECRYPT_FAILED', 'the archive path is not a plain absolute path to a backup of this module');
  if (!CONTAINER.test(container)) throw refusal('STACK_DEPLOY_BACKUP_DECRYPT_FAILED', 'the database container id is not a plain id');
  const result = run(backupCommand(ctx, 'db-decrypt', [parts[1] as string, parts[2] as string, container]));
  if (result.status !== 0) throw failure('STACK_DEPLOY_BACKUP_DECRYPT_FAILED', `the manager's identity could not open the archive (is the server recipient in .sops.yaml?); output withheld`);
  return result.stdout.split('\n').map((line) => line.replace(/^\.\//u, '').trim()).filter(Boolean);
}
