// update-ref.mjs — `git update-ref [-m <message>] <ref> <sha> [<old>]`: point a ref at a commit (a preserved worktree's
// refs/heads/preserved/<name>); with `old`, a compare-and-swap that fails when the ref no longer names `old`.
import { gitRunner, type GitRun, type GitRunnerFn } from './lib.mjs';

/** {ok, stdout, stderr}. message: the reflog line; old: the sha the ref must still name. git: the caller's runner or null. */
export function updateRef(repoRoot: string, ref: string, sha: string, { message = null, old = null, git = null }: { message?: string | null; old?: string | null; git?: GitRunnerFn | null } = {}): GitRun {
  return gitRunner(git)(['update-ref', ...(message ? ['-m', message] : []), ref, sha, ...(old ? [old] : [])], { cwd: repoRoot });
}
