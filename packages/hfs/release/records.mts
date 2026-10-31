// records.mjs - the release records of an app, all under <git common dir>/starci-release (gate.mjs releaseDir):
//   <head>.l4.json        the L4 record: every gate of the release gate passed on a clean HEAD (gate.mjs writes it)
//   <head>.urgent.json    the URGENT record (owner ruling urgent-release, 2026-10-29): `release push --urgent` tagged and pushed HEAD after the
//                         fast local checks alone; it names who (role), why (reason), the checks with their verdicts and the commit, and
//                         carries the back-fill verdict once `release gate --backfill <tag>` has run the full gate on the same commit
//   <head12>/rows.json    every gate row run on that head (name, command, verdict, log and its sha256), so a later urgent push reuses a green
//                         row whose command and log are unchanged instead of running it again
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const URGENT_SCHEMA = 'starci-app-urgent-record/1';
/** The owner's ruling an urgent record cites: CI and the full gate wait for the back-fill, the safety floor of the deploy never does. */
export const URGENT_RULING = 'owner ruling urgent-release 2026-10-29: an urgent release ships after the fast local checks; the full gate runs later on the same tag (release gate --backfill) and the deploy safety floor is never skipped';

// reason: release records are JSON parsed from disk; each reader checks the fields it uses
type Json = any;

const readJson = (file: string): Json => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const writeJson = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** The sha256 of a file, or null when it cannot be read. */
export const fileSha256 = (file: string): string | null => {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};

export const l4Path = (dir: string, head: string): string => path.join(dir, `${head}.l4.json`);
export const urgentPath = (dir: string, head: string): string => path.join(dir, `${head}.urgent.json`);
const rowsPath = (dir: string, head: string): string => path.join(dir, head.slice(0, 12), 'rows.json');

/** The urgent record of `head`, or null when there is none or it is not an urgent record of that head. */
export function readUrgent(dir: string, head: string): Json {
  const record = readJson(urgentPath(dir, head));
  return record?.schema === URGENT_SCHEMA && record.head === head ? record : null;
}

export const writeUrgent = (dir: string, record: Json): void => writeJson(urgentPath(dir, record.head), record);

/** Appends a gate row to the rows of `head` (a row of the same name is replaced). */
export function recordRow(dir: string, head: string, row: { name: string }): void {
  const file = rowsPath(dir, head);
  const rows = (readJson(file) ?? []).filter((known: { name?: string } | null) => known?.name !== row.name);
  writeJson(file, [...rows, row]);
}

/** The recorded green row of `head` whose name and command match and whose log still has the recorded sha256, or null. */
export function greenRow(dir: string, head: string, name: string, command: string): Json {
  const rows = readJson(rowsPath(dir, head)) ?? [];
  const row = rows.find((known: Json) => known?.name === name && known.command === command && known.pass === true);
  return row && row.log && fileSha256(row.log) === row.logSha256 ? row : null;
}

/** The trailer keys an urgent release writes into its tag annotation (WP3 of contexts/project/cicd.md): the tag's CI run reads them to back-fill the record. */
export const URGENT_TRAILER = 'Starci-Urgent';
export const URGENT_REASON_TRAILER = 'Starci-Urgent-Reason';

/** What the trailers of an urgent tag say: who released it and why. */
export interface UrgentTrailers { role: string; reason: string }

/** The role as a trailer value: the caller's role name (letters, digits, dot, dash, underscore); anything else becomes a dash. */
const trailerRole = (role: string): string => role.replaceAll(/[^\w.-]/gu, '-');

/** The trailer block of an urgent tag annotation: one `Starci-Urgent: <role>` and one `Starci-Urgent-Reason: <text>` line (the reason is one line, so it cannot forge a trailer). */
export function urgentTrailerBlock(role: string, reason: string): string {
  return `${URGENT_TRAILER}: ${trailerRole(role)}\n${URGENT_REASON_TRAILER}: ${reason.replaceAll(/\s+/gu, ' ').trim()}`;
}

/**
 * The urgent trailers of a tag annotation, read from its last paragraph (the place `git interpret-trailers` reads), or null when it has none.
 * Both keys must be there; the last occurrence of a key wins, like git's own parse.
 */
export function parseUrgentTrailers(message: string): UrgentTrailers | null {
  const last = message.replaceAll('\r\n', '\n').trim().split(/\n\s*\n/u).at(-1) ?? '';
  const found = new Map<string, string>();
  for (const line of last.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*)$/u.exec(line.trimEnd());
    if (match) found.set(match[1] as string, (match[2] as string).trim());
  }
  const role = found.get(URGENT_TRAILER);
  const reason = found.get(URGENT_REASON_TRAILER);
  return role && reason ? { role, reason } : null;
}
