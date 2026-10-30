// git.mts - the few git questions the cache asks, through the runtime's one git owner (runtime/scripts/api/git/lib.mts).
import { runGit } from '../runtime/scripts/api/git/lib.mjs';

export interface GitAnswer {
  readonly ok: boolean;
  readonly stdout: string;
}

/** `git args` in `root`: ok only on a clean exit; stdout is text. */
export function git(root: string, args: readonly string[], input?: string): GitAnswer {
  const run = runGit(args, { dir: root, maxBuffer: 256 * 1024 * 1024, ...(input === undefined ? {} : { input }) });
  return { ok: !run.error && run.status === 0, stdout: run.stdout ?? '' };
}

/** `git args` in `root` as raw bytes. */
export function gitBytes(root: string, args: readonly string[], input?: string): { ok: boolean; stdout: Buffer } {
  const run = runGit(args, { dir: root, maxBuffer: 1024 * 1024 * 1024, encoding: 'buffer', ...(input === undefined ? {} : { input }) });
  const out: unknown = run.stdout;
  return { ok: !run.error && run.status === 0, stdout: Buffer.isBuffer(out) ? out : Buffer.from(String(out ?? '')) };
}
