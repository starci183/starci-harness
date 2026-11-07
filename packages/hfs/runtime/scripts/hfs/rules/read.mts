// read.mts - what the tree checks of hfs-check.mjs share: one bounded text read and the shape of a finding.
import fs from 'node:fs';
import path from 'node:path';
import type { Finding, Parsed } from './rule-types.mjs';

/** Files above this size are not read by a tree check (a tracked binary or a generated dump is no source of these laws). */
const MAX_READ_BYTES = 1024 * 1024;

/**
 * The budget of a SQL migration (`db/migrations/*.sql`, the bootstrap). A migration is source of the database laws and may be large by
 * design: a baseline reset is ONE file that replaces the whole history, and an app with hundreds of tables reaches megabytes. Reading it
 * with the generic budget would make every database rule see "nothing" and report the file unreadable (and every queue, role and
 * header it declares as missing). The explicit budget is 16 MiB, above any baseline the canon allows and far below a generated dump.
 */
export const MAX_MIGRATION_READ_BYTES = 16 * 1024 * 1024;

/** True for the SQL files of the schema tree: the active migrations, the archive and the bootstrap. */
const isMigrationSql = (rel: string): boolean => /^db[/\\](?:migrations[/\\](?:archive[/\\])?[^/\\]+|bootstrap)\.sql$/.test(rel);

/** The read budget of `rel`: the migration budget for the SQL of the schema tree, the generic one for everything else. */
export const readBudgetOf = (rel: string): number => (isMigrationSql(rel) ? MAX_MIGRATION_READ_BYTES : MAX_READ_BYTES);

/** Who is told which file a rule reads: the result cache records the read set of a cross-file rule through it. */
type ReadSink = (repoRoot: string, rel: string) => void;
let sink: ReadSink | null = null;

/** Runs `run` with every `readText` / `readJson` it makes reported to `onRead` (before the read), and returns its value. */
export function recordReads<T>(onRead: ReadSink, run: () => T): T {
  const before = sink;
  sink = onRead;
  try { return run(); } finally { sink = before; }
}

/** The text of `rel` under `repoRoot`, or null when it is absent, unreadable, over its budget (`readBudgetOf`) or binary. */
export function readText(repoRoot: string, rel: string): string | null {
  sink?.(repoRoot, rel);
  try {
    const target = path.join(repoRoot, rel);
    if (fs.statSync(target).size > readBudgetOf(rel)) return null;
    const text = fs.readFileSync(target, 'utf8');
    return text.includes('\0') ? null : text;
  } catch {
    return null;
  }
}

/** The JSON of `rel`, or null when it is absent or not JSON. */
export function readJson(repoRoot: string, rel: string): Parsed | null {
  const text = readText(repoRoot, rel);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** One error finding of `code` on `file`; `extra` carries the finding's own fields. */
export const found = (code: string, file: string, message: string, extra: Record<string, unknown> = {}): Finding => ({ code, level: 'error', path: file, ...extra, message });
