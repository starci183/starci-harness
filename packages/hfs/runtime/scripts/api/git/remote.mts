// remote.mjs — `git remote <args>`: the configured remotes (get-url <name>).
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git remote ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const remote = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['remote', ...args], options);
