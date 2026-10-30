// scripts/api/git/lib.mjs — the one place the runtime spawns git (RT_EXTERNAL_OWNER of scripts/hfs/runtime-rules/external-owner.mjs enforces it).
//
// Every caller spelt the same options by hand - encoding:'utf8', windowsHide:true, sometimes a timeout - with two shapes:
// `git args` in a cwd and `git -C dir args`. gitSpawn keeps the spawnSync(file, args, options) signature so an injected
// runner or a spec's fake takes the same three arguments; runGit is the `-C` / `-c` convenience; gitRunner folds any
// caller's runner into {ok, stdout, stderr}. Only the call files beside this one import it: each names one git verb
// (diff.mjs, ls-files.mjs, worktree-*.mjs, ...), and a caller folds the spawn result it gets back with the pure
// helpers of scripts/lib/git.mjs (gitResultOf, gitOutputOf).
import { assertMutationFence } from '../../lib/mutation-fence.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { withoutGitLocalEnv } from '../../lib/git.mjs';
import { withTempEnv } from '../../../engine/temp-root.mjs';

/** The spawnSync options a git call takes; encoding 'buffer' is a request for raw bytes (see gitSpawn). */
export type GitSpawnOptions = Omit<SpawnSyncOptions, 'encoding'> & { encoding?: BufferEncoding | 'buffer' | null };
/** What runGit takes on top of the spawn options: where (cwd, or `-C` dir), which binary, and `-c key=value` config. */
export type GitOptions = Omit<GitSpawnOptions, 'cwd'> & { cwd?: string | null; dir?: string | null; git?: string; config?: Record<string, string | number | boolean> | null };
/** The spawn result of a git call: {status, stdout, stderr, error}. */
export type GitResult = SpawnSyncReturns<string>;
/** A caller's git runner or a spec's fake: the result is {ok|status, stdout|out, stderr|err, error}. */
export interface GitRunnerResult { ok?: boolean; status?: number | null; stdout?: unknown; out?: unknown; stderr?: unknown; err?: unknown; error?: { message?: string } | string | null | undefined }
export type GitRunnerFn = (args: string[], opts: GitRunnerOptions) => GitRunnerResult | null | undefined;
/** The options of a folded runner call. */
export interface GitRunnerOptions extends GitOptions { timeout?: number; maxBuffer?: number }
/** The folded runner result. */
export interface GitRun { ok: boolean; stdout: string; stderr: string }
interface GitPathInputs { env: NodeJS.ProcessEnv; platform: string; home: string; exists: (file: string) => boolean }
/** gitExecutable's spec seams. */
export type GitExecutableOptions = Partial<GitPathInputs>;

/**
 * Spawn `file` (the git binary) once with `args`: utf8 text, a hidden window, never a shell.
 * Options pass through last, so cwd, timeout, input, env or maxBuffer land as given. encoding:'buffer'
 * is a request for raw bytes, not an encoding: spawnSync encodes a string `input` with it and throws
 * ERR_UNKNOWN_ENCODING, so it reaches spawnSync as encoding:null (Buffer output either way).
 */
const gitSpawn = (file: string, args: readonly string[], options: GitSpawnOptions = {}): SpawnSyncReturns<string> => {
  assertMutationFence({ kind: 'git-effect', args });
  const spawn: GitSpawnOptions = { encoding: 'utf8', windowsHide: true, ...options };
  if (spawn.encoding === 'buffer') spawn.encoding = null;
  // tempChildEnv copies the env (node adds NODE_V8_COVERAGE to the env object it is given: a frozen caller env must not throw under coverage) and points TEMP/TMP/TMPDIR at the temp root
  // reason: encoding:null (the former 'buffer') returns Buffers; callers of that mode read the result as raw bytes
  const spawnOptions = withTempEnv(spawn) as SpawnSyncOptionsWithStringEncoding;
  return spawnSync(file, args, spawnOptions);
};

/**
 * `git args` in `cwd`, or `git -C dir args` when `dir` is given. `git` overrides the binary; `config` ({key: value})
 * prefixes one `-c key=value` per entry (core.quotepath=off, a committer identity). Scoped calls discard ambient
 * hook repository variables; an explicit env remains authoritative, including an intentional temporary index.
 */
export const runGit = (args: readonly string[], { cwd = null, dir = null, git = 'git', config = null, ...options }: GitOptions = {}): GitResult =>
  gitSpawn(git, [...(dir ? ['-C', dir] : []), ...Object.entries(config ?? {}).flatMap(([key, value]) => ['-c', `${key}=${value}`]), ...args], {
    ...(cwd ? { cwd } : {}), ...options,
    ...((cwd || dir) && options.env === undefined ? { env: withoutGitLocalEnv(process.env) } : {}),
  });

/**
 * A caller's git runner folded to (args, opts) -> {ok, stdout, stderr}. `git`: the caller's runner (args, {cwd}) ->
 * {ok|status, stdout|out, stderr|err} (a spec's fake); null: runGit with a 5-minute timeout and a 64 MB buffer.
 */
export const gitRunner = (git: GitRunnerFn | null = null) => (args: string[], opts: GitRunnerOptions = {}): GitRun => {
  const r: GitRunnerResult | null | undefined = git ? git(args, opts) : runGit(args, { timeout: 300_000, maxBuffer: 64 * 1024 * 1024, ...opts });
  return { ok: r?.ok ?? (!r?.error && r?.status === 0), stdout: String(r?.stdout ?? r?.out ?? '').trim(), stderr: String(r?.stderr ?? r?.err ?? (typeof r?.error === 'object' ? r.error?.message : undefined) ?? r?.error ?? '').trim() };
};

let cachedGit: string | null | undefined;
const gitPathOf = ({ env, platform, home, exists }: GitPathInputs): string | null => {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const pathKey = Object.keys(env).find((name) => name.toLowerCase() === 'path');
  const shim = p.join(home, '.starci', 'bin');
  const same = (a: string, b: string): boolean => (platform === 'win32' ? p.resolve(a).toLowerCase() === p.resolve(b).toLowerCase() : p.resolve(a) === p.resolve(b));
  const binary = platform === 'win32' ? 'git.exe' : 'git';
  for (const raw of String(pathKey ? env[pathKey] : '').split(platform === 'win32' ? ';' : ':')) {
    const dir = raw.replace(/^"(.*)"$/, '$1');
    const file = dir && p.isAbsolute(dir) && !same(dir, shim) ? p.join(dir, binary) : null;
    if (file && exists(file)) return file;
  }
  return null;
};
/**
 * The absolute path of the real git binary, or null: the first PATH directory holding git (git.exe on Windows) that is not
 * the StarCi shim directory <home>/.starci/bin (a seat's guard shim is never the git the runtime itself runs). A bare name is never
 * spawned, so a writable directory cannot be reached by name lookup at spawn time. Resolved once per process; options (env,
 * platform, home, exists) are for a spec and bypass the cache.
 */
export const gitExecutable = (options: GitExecutableOptions | null = null): string | null => {
  if (!options && cachedGit !== undefined) return cachedGit;
  const { env = process.env, platform = process.platform, home = os.homedir(), exists = (file: string): boolean => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true } = options ?? {};
  const found = gitPathOf({ env, platform, home, exists });
  if (!options) cachedGit = found;
  return found;
};

/** The output ceiling of the whole-diff and `cat-file --batch` calls batch (a release diff is tens of megabytes). */
export const BATCH_MAX_BUFFER = 1024 * 1024 * 1024;
