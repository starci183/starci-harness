// switch.mts — `git switch <args>`: check out a branch (`-c <name>` creates it at HEAD first).
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git switch ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const switchBranch = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['switch', ...args], options);
