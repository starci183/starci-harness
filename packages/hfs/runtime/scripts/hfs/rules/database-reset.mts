// A declared one-time baseline reset (hfs.json db.baselineReset): an owner ruling replaces the whole migration history of an app that keeps
// no data worth migrating (a clean database) with ONE new active baseline file. While the baseline is not yet on the base branch the reset
// is pending: the immutability checks (R213 removed/ordering, R257 archive immutability) accept the removal of every older active and
// archived file, because the declared baseline is the new base chain. Once the baseline is on the base branch the declaration is spent and
// every old rule applies to it like to any landed migration. Without the declaration nothing here runs and the old behaviour stays.
import { isPlainObject } from '../../../engine/plain-object.mjs';
import { found } from './read.mjs';
import { DB_BASELINE_SHAPE, DB_MIGRATION_SHAPE } from './database-constants.mjs';
import type { Parsed } from './rule-types.mjs';

/** The declaration: the one active baseline file, the owner ruling that allows the reset, the day it was ruled and why. */
export interface BaselineReset {
  baseline: string;
  ruling: string;
  date: string;
  reason: string;
}

const BASELINE_FILE = /^db\/migrations\/(\d{14})_[a-z0-9][a-z0-9_-]*\.sql$/;
const RULING = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True for an absent declaration or a well-formed one: {baseline: db/migrations/<ts14>_<name>.sql, ruling: an id, date: YYYY-MM-DD, reason}. */
export const baselineResetOk = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isPlainObject(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).sort().join() === 'baseline,date,reason,ruling'
    && typeof entry.baseline === 'string' && BASELINE_FILE.test(entry.baseline)
    && typeof entry.ruling === 'string' && RULING.test(entry.ruling)
    && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    && typeof entry.reason === 'string' && entry.reason.trim() !== '';
};

/** The declaration of an hfs.json `db` block, or null when absent or malformed (the declaration shape reports a malformed one). */
export const baselineResetOf = (db: Parsed): BaselineReset | null => (baselineResetOk(db?.baselineReset) && db?.baselineReset !== undefined ? db.baselineReset as BaselineReset : null);

/** The rulings named by `-- starci:baseline-reset <ruling>` lines of a file's header comments. */
export function resetMarkers(text: string): string[] {
  const header: string[] = [];
  for (const line of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    if (line.trim() && !/^\s*--/.test(line)) break;
    header.push(line);
  }
  return header.flatMap((line) => {
    const marker = /^\s*--\s*starci:baseline-reset\s+(\S+)\s*$/.exec(line);
    return marker ? [marker[1]!] : [];
  });
}

/** Whether the reset is pending: the declared baseline is not yet on the base branch, so the older chain may go. */
export const resetPending = (reset: BaselineReset | null, baseFiles: readonly string[]): boolean => reset !== null && !baseFiles.includes(reset.baseline);

/**
 * The findings of a declared reset over the active migrations: the baseline exists and carries the ruling's marker, no other file claims to
 * be a baseline reset, and while the reset is pending no older active file stays and every other new migration sorts after the baseline.
 */
export function baselineResetFindings({ migrations, read, reset, baseFiles }: { migrations: string[]; read: (file: string) => string | null; reset: BaselineReset; baseFiles: readonly string[] }) {
  const findings = [];
  if (!migrations.includes(reset.baseline)) {
    findings.push(found(DB_BASELINE_SHAPE, reset.baseline, `hfs.json db.baselineReset names ${reset.baseline}, which is not an active migration here; the reset needs its one baseline file`));
    return findings;
  }
  if (!resetMarkers(read(reset.baseline) ?? '').includes(reset.ruling)) {
    findings.push(found(DB_BASELINE_SHAPE, reset.baseline, `the baseline must carry a header line "-- starci:baseline-reset ${reset.ruling}" naming the ruling hfs.json db.baselineReset declares`));
  }
  for (const file of migrations.filter((entry) => entry !== reset.baseline)) {
    if (resetMarkers(read(file) ?? '').length > 0) findings.push(found(DB_BASELINE_SHAPE, file, `${file} claims to be a baseline reset, but ${reset.baseline} is the one declared baseline; a reset has exactly one baseline file`));
  }
  if (!resetPending(reset, baseFiles)) return findings;
  const stamp = BASELINE_FILE.exec(reset.baseline)?.[1] ?? '';
  const onBase = new Set(baseFiles);
  for (const file of migrations.filter((entry) => entry !== reset.baseline)) {
    if (onBase.has(file)) findings.push(found(DB_MIGRATION_SHAPE, file, `${file} is on the base branch but stays beside the declared baseline ${reset.baseline}; the reset replaces the whole older chain, so delete it`));
    else if ((/^db\/migrations\/(\d{14})_/.exec(file)?.[1] ?? '') <= stamp) findings.push(found(DB_MIGRATION_SHAPE, file, `${file} is stamped at or before the declared baseline ${reset.baseline}; a migration after a reset sorts after the baseline`));
  }
  return findings;
}
