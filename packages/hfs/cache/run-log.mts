// run-log.mts - the timings of a run. They change every run, so they are host state and stay out of git: `last-run.json` and `runs.jsonl`
// (the last 100 runs) in the untracked tool cache of slot app.tool-cache,
// `${STARCI_CACHE_HOME:-%LOCALAPPDATA%/StarCi/cache}/<repo>/app-check/`, where <repo> is the app folder's name and the first 12 hex digits of
// the sha256 of its real path.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FamilyReport } from './types.mjs';

export const RUN_LOG_LIMIT = 100;

/** One step or family of a run: how long it took. */
export interface TimedFamily extends FamilyReport {
  readonly seconds: number;
}

/** One run. */
export interface RunEntry {
  readonly command: string;
  readonly seconds: number;
  readonly exit: number;
  readonly families: readonly TimedFamily[];
}

/** The folder of the untracked tool cache for the app at `root`. */
export function toolCacheDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env['STARCI_CACHE_HOME'] ?? (process.platform === 'win32' ? path.join(env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'StarCi', 'cache') : path.join(env['XDG_CACHE_HOME'] ?? path.join(os.homedir(), '.cache'), 'starci'));
  let real = path.resolve(root);
  try { real = fs.realpathSync(real); } catch { /* the given path names the app */ }
  const id = `${path.basename(real)}-${createHash('sha256').update(real).digest('hex').slice(0, 12)}`;
  return path.join(home, id, 'app-check');
}

/** Writes `last-run.json` and appends to `runs.jsonl`, keeping the last 100 runs. A disk error is no failure of the run. */
export function writeRunLog(root: string, entry: RunEntry, env: NodeJS.ProcessEnv = process.env): void {
  try {
    const dir = toolCacheDir(root, env);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'last-run.json'), `${JSON.stringify(entry, null, 2)}\n`);
    const file = path.join(dir, 'runs.jsonl');
    let lines: string[] = [];
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* the first run */ }
    lines.push(JSON.stringify(entry));
    fs.writeFileSync(file, `${lines.slice(-RUN_LOG_LIMIT).join('\n')}\n`);
  } catch { /* host state only */ }
}
