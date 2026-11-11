// commit.mts — `git commit <args>`: the staged index recorded as a commit on the checked-out branch.
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git commit ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const commit = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['commit', ...args], options);
