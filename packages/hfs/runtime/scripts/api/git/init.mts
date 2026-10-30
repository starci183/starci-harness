// init.mjs — `git -c init.defaultBranch=<branch> init --quiet`: create an empty repository in `cwd` (the install sandbox's app repository).
import { gitRunner, type GitRun, type GitRunnerFn } from './lib.mjs';

/** {ok, stdout, stderr}. `env` replaces the process env (a sandbox's own home); git: the caller's runner or null. */
export function init(cwd: string, { branch = 'main', env = undefined, git = null }: { branch?: string; env?: NodeJS.ProcessEnv | undefined; git?: GitRunnerFn | null } = {}): GitRun {
  return gitRunner(git)(['-c', `init.defaultBranch=${branch}`, 'init', '--quiet'], env ? { cwd, env } : { cwd });
}
