import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The usable runtime linked for `home`, or null with a diagnostic in `skipped` for a stale or unreadable record. */
export function readRuntimeRecord({ home = os.homedir(), exists = existsSync, read = readFileSync, skipped = [] } = {}) {
  const record = path.join(home, '.starci', 'runtime.json');
  if (!exists(record)) return null;
  let candidate;
  try { candidate = JSON.parse(read(record, 'utf8'))?.root; }
  catch {
    skipped.push(`${record} is not valid JSON`);
    return null;
  }
  if (typeof candidate === 'string' && candidate) {
    const root = path.resolve(candidate);
    if (exists(path.join(root, 'scripts', 'cli', 'main.mjs'))) return { root, source: record };
  }
  skipped.push(`${record} points at ${JSON.stringify(candidate ?? null)}, which has no scripts/cli/main.mjs (stale record)`);
  return null;
}
