// check-ignore.mjs — `git check-ignore <args>`: whether paths are ignored (-q exits 0 for an ignored path).
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git check-ignore ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const checkIgnore = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['check-ignore', ...args], options);
