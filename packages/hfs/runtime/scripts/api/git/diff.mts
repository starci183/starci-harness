// diff.mjs — `git diff <args>`: the changes between commits, the index and the working tree.
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git diff ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const diff = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['diff', ...args], options);
