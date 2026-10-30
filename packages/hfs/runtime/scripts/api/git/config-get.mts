// config-get.mjs — `git config [--local] --get <key>`: one configuration value of a checkout (empty when unset).
import { gitRunner, type GitRun, type GitRunnerFn } from './lib.mjs';

/**
 * {ok, stdout, stderr}; `local` reads the repository's own config only; `env` replaces the process env (a caller drops
 * git's repository-local variables). git: the caller's runner or null.
 */
export function configGet(cwd: string, key: string, { local = false, env = undefined, git = null }: { local?: boolean; env?: NodeJS.ProcessEnv | undefined; git?: GitRunnerFn | null } = {}): GitRun {
  return gitRunner(git)(['config', ...(local ? ['--local'] : []), '--get', key], env ? { cwd, env } : { cwd });
}
