// backup-receipt.mjs - encrypted database backup custody of `starci app db dump`; tool output never enters diagnostics.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { failure, refusal } from '../stack/errors.mjs';
import { DEFAULT_DB_URL_ENV, dbTarget, pgTool, queryRows as psqlRows } from './postgres.mjs';
import type { SpawnResult, VerbContext } from '../release/index.mjs';

export const RECEIPT_SCHEMA = 'starci/db-backup@1';
export function sha256(file: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    let bytes: number;
    while ((bytes = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, bytes));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
/** A database session a backup runs in: the context, the target and the project name the archive carries. */
export interface BackupSession { ctx: VerbContext; target: ReturnType<typeof dbTarget>; project: string }

const inside = (root: string, file: string): boolean => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };

/** Backup SQL can hold row values, so a client tool's stderr is withheld whole. */
export function runPgTool(session: BackupSession, command: string, args: readonly string[]): { stdout: string; text: string } {
  return pgTool(session.ctx, session.target, command, args, { withhold: true, code: 'DB_BACKUP_CLI_FAILED' });
}

/** Resolves existing ancestors before checking containment, including symlinked output directories and Git worktree marker files. */
export function outsideRepository(root: string, output: string): string {
  let ancestor = path.resolve(output);
  const tail: string[] = [];
  while (!fs.existsSync(ancestor)) { tail.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const resolved = path.join(fs.realpathSync(ancestor), ...tail);
  if (inside(fs.realpathSync(root), resolved)) throw refusal('DB_DUMP_INSIDE_REPO', '--out must be outside the app repository and every Git worktree');
  for (let dir = resolved; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) throw refusal('DB_DUMP_INSIDE_REPO', '--out must be outside every Git worktree');
    if (dir === path.dirname(dir)) break;
  }
  return resolved;
}

/** The database of `--url-env` (default DATABASE_URL) and the project name the archive carries. */
export function backupSession(ctx: VerbContext, options: { urlEnv?: string | undefined }): BackupSession {
  const target = dbTarget(ctx, options.urlEnv ?? DEFAULT_DB_URL_ENV);
  const project = path.basename(ctx.cwd).replace(/[^A-Za-z0-9_-]/gu, '-') || 'database';
  return { ctx, target, project };
}

/** One read-only query through psql; failures and malformed output are withheld. */
export function queryRows(session: BackupSession, sql: string): Record<string, any>[] { // reason: rows are JSON psql printed; callers read the columns they selected
  try { return psqlRows(session.ctx, session.target, sql, { withhold: true }); }
  catch { throw failure('DB_BACKUP_QUERY_FAILED', 'database inventory query failed; output withheld'); }
}

/** Executes local tar/age through ctx.spawn, the same seam used by the stack's age installer; never relays tool errors containing data. */
export function backupTool(ctx: VerbContext, command: string, args: readonly string[], options: Record<string, unknown> = {}): SpawnResult {
  const result = ctx.spawn(command, args, { cwd: ctx.cwd, env: ctx.env, ...options });
  if (result.error || result.status !== 0) throw failure('DB_BACKUP_TOOL_FAILED', `${command} failed; output withheld`);
  return result;
}

/** Reads public recipients only from creation_rules age fields, including nested SOPS key_groups. */
export function backupRecipients(root: string): string[] {
  let rules: unknown;
  try { rules = parseYaml(fs.readFileSync(path.join(root, '.sops.yaml'), 'utf8')).creation_rules; } catch { rules = []; }
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'age') found.push(...(JSON.stringify(item).match(/age1[0-9a-z]{50,}/gu) ?? []));
      else if (typeof item === 'object') visit(item);
    }
  };
  visit(rules);
  if (!found.length) throw refusal('DB_BACKUP_NO_RECIPIENT', 'no age recipient in .sops.yaml creation_rules');
  return [...new Set(found)];
}

/** Header and size checks prove an age envelope exists; proving decryption requires the owner's identity separately. */
function checkArchive(file: string): number {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(22);
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  if (size < 100 || !header.toString('ascii').startsWith('age-encryption.org/v1\n')) throw failure('DB_BACKUP_ARCHIVE_INVALID', 'encrypted archive has no valid age header or payload');
  return size;
}

export function encryptFile(ctx: VerbContext, input: string, output: string, recipients: readonly string[]): number {
  backupTool(ctx, 'age', [...recipients.flatMap((recipient) => ['-r', recipient]), '-o', output, input]);
  return checkArchive(output);
}

