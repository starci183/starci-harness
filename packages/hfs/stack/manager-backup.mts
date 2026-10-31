// manager-backup.mjs - the database backup of a deploy whose database runs in the stack (database.target: stack): the dump is made ON the
// manager from the database container (pg_dumpall roles, pg_dump schema and data, per-table row counts), tarred and encrypted with age to the
// .sops.yaml recipients plus the server's own, and kept on the manager beside the volume backups (deploy.backup.dir, else /var/backups/<stack>/db).
// No plaintext leaves a root-private scratch directory that a trap removes, no database URL or password exists on the machine that runs the
// deploy (the container reads its own POSTGRES_PASSWORD_FILE), and the receipt is written next to the archive. The archive stays on the manager;
// copying it to another failure domain remains the owner's job. Every remote command is composed only from validated names and quoted values.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { OWN_PASSWORD_SHELL, DB_IDENT } from '../db/postgres.mjs';
import { RECEIPT_SCHEMA } from '../db/backup-receipt.mjs';
import type { BackupReceipt } from './db-phases.mjs';
import type { DeployConfig } from './config.mjs';
import type { StackContext } from './context.mjs';
import { failure, refusal } from './errors.mjs';
import { shellQuote } from './remote.mjs';
import type { Runner } from './remote.mjs';
import { AS_ROOT, SERVER_AGE_IDENTITY } from './server-key.mjs';

/** What was measured on an archive: whether it exists, its size, whether it starts with the age header and its sha256. */
export interface ArchiveFacts { exists: boolean; size: number; header: boolean; sha256: string }
/** A dump the manager made: where the archive and its receipt are, the receipt and the measurements taken after it was written. */
export interface ManagerBackup { receiptPath: string; receipt: BackupReceipt; archive: string; facts: ArchiveFacts }

/** The parts of the archive, in tar order. */
export const BACKUP_PARTS = Object.freeze(['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']);

const BASE = /^\/[A-Za-z0-9._/-]+$/u;
const CONTAINER = /^[0-9a-f]{12,64}$/u;
const RECIPIENT = /^age1[0-9a-z]{50,}$/u;
const AGE_HEADER = 'age-encryption.org/v1';

/** Row counts of every ordinary table but the catalogs' (auth included), one JSON array, computed inside the database. */
const ROWCOUNTS_SQL = "select coalesce(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'count', (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text) order by schemaname, tablename), '[]'::json) from pg_catalog.pg_tables where schemaname not in ('pg_catalog', 'information_schema')";

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

/** What the dump script is given. */
export interface DumpInput { dir: string; file: string; container: string; url: string; recipients: readonly string[] }

/** The one-line shell script that dumps, tars and encrypts; its stdout is: the archive sha256, its byte size, then the row counts JSON. */
export function dumpScript({ dir, file, container, url, recipients }: DumpInput): string {
  if (!CONTAINER.test(container)) throw refusal('STACK_DEPLOY_BACKUP_FAILED', 'the database container id is not a plain id');
  if (recipients.length === 0 || recipients.some((recipient) => !RECIPIENT.test(recipient))) throw refusal('STACK_DEPLOY_BACKUP_FAILED', 'the backup needs at least one age recipient, each a plain age1... key');
  const final = `${dir}/${file}`;
  const partial = `${final}.partial`;
  const [archive, tmp] = [shellQuote(final), shellQuote(partial)];
  const dx = (...args: string[]): string => `dx ${args.join(' ')}`;
  const dump = [
    dx('pg_dumpall', '--roles-only', '--no-role-passwords', '--dbname', shellQuote(url), '>', '"$S/roles.sql"'),
    dx('pg_dump', '--schema-only', '--dbname', shellQuote(url), '>', '"$S/schema.sql"'),
    dx('pg_dump', '--data-only', '--dbname', shellQuote(url), '>', '"$S/data.sql"'),
    dx('psql', '-X', '-q', '-A', '-t', '-d', shellQuote(url), '-c', shellQuote(ROWCOUNTS_SQL), '>', '"$S/rowcounts.json"'),
    `tar -cf "$S/backup.tar" -C "$S" ${BACKUP_PARTS.join(' ')}`,
    `age ${recipients.map((recipient) => `-r ${shellQuote(recipient)}`).join(' ')} -o ${tmp} "$S/backup.tar"`,
    `mv ${tmp} ${archive}`,
  ].join(' && ');
  return [
    'set -o pipefail', 'umask 077', `mkdir -p ${shellQuote(dir)}`,
    `S=$(mktemp -d ${shellQuote(`${dir}/.plain.XXXXXX`)})`, "trap 'rm -rf \"$S\"' EXIT",
    `PW=${shellQuote(OWN_PASSWORD_SHELL)}`,
    `dx() { docker exec ${container} sh -c "$PW" sh "$@" </dev/null; }`,
    `{ ${dump}; } || { rm -f ${tmp}; exit 1; }`,
    `sha256sum ${archive} | cut -d' ' -f1`, `stat -c %s ${archive}`, 'cat "$S/rowcounts.json"',
  ].join('; ');
}

/** The script that measures an archive: `exists`, `bytes`, `sha256` and `header` lines. */
export function measureScript(archive: string): string {
  const file = shellQuote(archive);
  return [
    `[ -f ${file} ] || { echo exists=0; exit 0; }`, 'echo exists=1', `echo "bytes=$(stat -c %s ${file})"`, `echo "sha256=$(sha256sum ${file} | cut -d' ' -f1)"`,
    `if [ "$(head -c ${AGE_HEADER.length} ${file})" = ${shellQuote(AGE_HEADER)} ]; then echo header=1; else echo header=0; fi`,
  ].join('; ');
}

/** The root script of the test decrypt: the manager's own identity opens the archive in a private scratch directory and tar lists it. */
export function decryptScript(archive: string): string {
  return [
    'set -e', 'umask 077', 'PATH="$PATH:/usr/local/bin:/usr/bin:/bin"', 't=$(mktemp -d)', "trap 'rm -rf \"$t\"' EXIT",
    `age -d -i ${shellQuote(SERVER_AGE_IDENTITY)} -o "$t/backup.tar" ${shellQuote(archive)}`, 'tar -tf "$t/backup.tar"',
  ].join('\n');
}

const sh = (script: string): string => `bash -c ${shellQuote(script)}`;
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
export async function managerBackup(_ctx: StackContext, config: DeployConfig, { run, container, url, recipients, at }: { run: Runner; container: string; url: string; recipients: string[]; at: string }): Promise<ManagerBackup> {
  if (!DB_IDENT.test(new URL(url).username)) throw refusal('STACK_DEPLOY_BACKUP_FAILED', 'the database role is not a plain identifier');
  const dir = backupFolder(config);
  const name = `${projectName(config)}-${stamp(at)}`;
  const file = `${name}.tar.age`;
  const archive = `${dir}/${file}`;
  const receiptPath = `${dir}/${name}.receipt.json`;
  const dumped = run(sh(dumpScript({ dir, file, container, url, recipients })));
  if (dumped.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the dump on the manager failed; output withheld');
  const [sha256 = '', bytes = '', ...rest] = dumped.stdout.split('\n');
  if (!/^[a-f0-9]{64}$/u.test(sha256.trim()) || !/^\d+$/u.test(bytes.trim())) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the dump on the manager printed no archive size or hash');
  const receipt = {
    schema: RECEIPT_SCHEMA, project: projectName(config), target: 'container', ref: `${config.stack}`, at, file, bytes: Number(bytes.trim()), sha256: sha256.trim(),
    parts: [...BACKUP_PARTS], rowcounts: summarize(rest.join('\n')), schemaOnly: false,
  };
  const written = run(sh(`umask 077; cat > ${shellQuote(receiptPath)}`), { input: `${JSON.stringify(receipt, null, 2)}\n` });
  if (written.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the receipt could not be written on the manager');
  const measured = run(sh(measureScript(archive)));
  if (measured.status !== 0) throw failure('STACK_DEPLOY_BACKUP_FAILED', 'the archive could not be measured on the manager');
  const reading = Object.fromEntries(measured.stdout.split('\n').map((line) => line.trim().split('=')).filter((pair) => pair.length === 2) as [string, string][]);
  const facts: ArchiveFacts = { exists: reading.exists === '1', size: Number(reading.bytes ?? 0), header: reading.header === '1', sha256: reading.sha256 ?? '' };
  return { receiptPath, receipt, archive, facts };
}

/** Opens the archive on the manager with the manager's own identity and lists its parts. Throws when the identity cannot open it. */
export async function managerDecrypt(_ctx: StackContext, { run, archive }: { run: Runner; archive: string }): Promise<string[]> {
  if (!BASE.test(archive)) throw refusal('STACK_DEPLOY_BACKUP_DECRYPT_FAILED', 'the archive path is not a plain absolute path');
  const result = run(AS_ROOT, { input: `${decryptScript(archive)}\n` });
  if (result.status !== 0) throw failure('STACK_DEPLOY_BACKUP_DECRYPT_FAILED', `the manager's identity could not open the archive (is the server recipient in .sops.yaml?); output withheld`);
  return result.stdout.split('\n').map((line) => line.replace(/^\.\//u, '').trim()).filter(Boolean);
}
