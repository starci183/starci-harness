// Entry for the sync-side command behind `starci app sync` (the pre-commit guard behind `starci app check --staged` is sync/hygiene.mjs).
import { runSync } from './index.mjs';

/** The usage of the command; `starci app` prints it (--cwd is its global flag). */
export const SYNC_USAGE = Object.freeze({ sync: 'starci app sync [--execute]' });

export async function main(argv: string[], { cwd = process.cwd(), stdout = (text: string): unknown => process.stdout.write(text) }: { cwd?: string; stdout?: (text: string) => unknown } = {}): Promise<number> {
  const out = (line: string): unknown => stdout(`${line}\n`);
  const [command, ...rest] = argv;
  if (command === 'sync') return runSync(rest, { cwd, out });
  out(`usage: ${SYNC_USAGE.sync} [--cwd <dir>]`);
  return 2;
}
