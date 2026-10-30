// Entry for the sync-side commands behind `starci app sync` and `starci app hygiene`.
import { runSync } from './index.mjs';
import { runWorkHygiene } from './hygiene.mjs';

/** The usage of each command; `starci app` prints these lines (--cwd is its global flag). Hygiene takes no argument. */
export const SYNC_USAGE = Object.freeze({ sync: 'starci app sync (--check | --write)', hygiene: 'starci app hygiene' });

export async function main(argv, { cwd = process.cwd(), stdout = (text) => process.stdout.write(text) } = {}) {
  const out = line => stdout(`${line}\n`);
  const [command, ...rest] = argv;
  if (command === 'sync') return runSync(rest, { cwd, out });
  if (command === 'hygiene' && rest.length === 0) return runWorkHygiene({ cwd, out });
  out(`usage: ${SYNC_USAGE.sync} [--cwd <dir>] | ${SYNC_USAGE.hygiene} [--cwd <dir>]`);
  return 2;
}
