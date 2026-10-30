// show.mjs — `git show <args>`: an object of a repository - a file at a revision (`<rev>:<path>`), or a commit's
// header and message (-s --format=...).
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git show ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const show = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['show', ...args], options);
