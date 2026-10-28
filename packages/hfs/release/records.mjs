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

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** The sha256 of a file, or null when it cannot be read. */
export const fileSha256 = (file) => {
  try { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};

export const l4Path = (dir, head) => path.join(dir, `${head}.l4.json`);
export const urgentPath = (dir, head) => path.join(dir, `${head}.urgent.json`);
const rowsPath = (dir, head) => path.join(dir, head.slice(0, 12), 'rows.json');

/** The urgent record of `head`, or null when there is none or it is not an urgent record of that head. */
export function readUrgent(dir, head) {
  const record = readJson(urgentPath(dir, head));
  return record?.schema === URGENT_SCHEMA && record.head === head ? record : null;
}

export const writeUrgent = (dir, record) => writeJson(urgentPath(dir, record.head), record);

/** Appends a gate row to the rows of `head` (a row of the same name is replaced). */
export function recordRow(dir, head, row) {
  const file = rowsPath(dir, head);
  const rows = (readJson(file) ?? []).filter((known) => known?.name !== row.name);
  writeJson(file, [...rows, row]);
}

/** The recorded green row of `head` whose name and command match and whose log still has the recorded sha256, or null. */
export function greenRow(dir, head, name, command) {
  const rows = readJson(rowsPath(dir, head)) ?? [];
  const row = rows.find((known) => known?.name === name && known.command === command && known.pass === true);
  return row && row.log && fileSha256(row.log) === row.logSha256 ? row : null;
}
