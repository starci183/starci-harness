// rev-parse-query.mjs — `git rev-parse <args>`: one rev-parse query (--show-toplevel, --git-common-dir, --git-path, a ref): the text it prints.
import { runGit, type GitOptions, type GitResult } from './lib.mjs';

/** The spawn result {status, stdout, stderr, error} of `git rev-parse ...args`; options are runGit's (cwd or dir, config, timeout, maxBuffer, input, encoding, env, git). */
export const revParseQuery = (args: readonly string[] = [], options: GitOptions = {}): GitResult => runGit(['rev-parse', ...args], options);
