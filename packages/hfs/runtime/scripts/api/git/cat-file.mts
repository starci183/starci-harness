// cat-file.mjs — `git cat-file <args>`: the type, size or content of repository objects (-e, -p, --batch).
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git cat-file ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const catFile = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['cat-file', ...args], options);
