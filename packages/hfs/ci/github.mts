import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';
import type { ValidCiDeclaration, ValidCiEntry } from '../runtime/scripts/hfs/ci-declaration.mjs';

/** The scope options of a `starci app ci` command: one environment, or the Dependabot store, or (neither) the repository. */
export interface CiScope { env?: string | undefined; dependabot?: boolean | undefined }

/** The parsed options of a `starci app ci` command: the scope plus `--repo`, `--value` and `--execute`/`--json`. */
export interface CiOptions extends CiScope { repo?: string | undefined; value?: string | undefined; execute?: boolean | undefined; json?: boolean | undefined }

/** One declared CI secret or variable of a declaration without problems (runtime/scripts/hfs/ci-declaration.mjs readCiDeclaration). */
export type CiEntry = ValidCiEntry;

/** The CI declaration of the stack manifest, once its problems are refused: the secrets, Dependabot secrets and variables it names. */
export type CiDeclaration = ValidCiDeclaration;

/** The stdin seam of a value: text, or a function that answers it. */
export type StdinSource = string | (() => string | Promise<string>) | undefined;

/** The GitHub CLI seam: argument arrays in, captured text out. */
export interface Gh {
  run(args: string[], input?: string): string;
  json(args: string[]): any; // reason: the GitHub CLI answers JSON; each caller validates the fields it reads
  repository(explicit?: string): string;
}

/** A spawn seam with the signature of spawnSync (specs inject a fake). */
export type GhSpawn = (command: string, args: string[], options: SpawnSyncOptions) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout'>;

/** An error that carries a fixed public code. */
export interface CodedError extends Error { code: string }

/** Refusals carry only fixed public diagnostics, never child output or secret input. */
export function refuse(code: string, message: string): CodedError {
  const error = new Error(`${code}: ${message}`) as CodedError;
  error.code = code;
  return error;
}

/** All GitHub access uses argument arrays and captured output; secret bodies travel only on stdin. */
export function github({ cwd, spawn = spawnSync as unknown as GhSpawn, env = process.env }: { cwd: string; spawn?: GhSpawn | undefined; env?: NodeJS.ProcessEnv }): Gh {
  function run(args: string[], input?: string): string {
    let result: ReturnType<GhSpawn>;
    try { result = spawn('gh', args, { cwd, env, encoding: 'utf8', shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : { input }) }); }
    catch { throw refuse('CI_GITHUB_UNREADABLE', 'GitHub CLI could not run; check installation and authentication'); }
    if (result.error || result.status !== 0) throw refuse('CI_GITHUB_UNREADABLE', 'GitHub CLI failed; check authentication and repository access');
    return result.stdout;
  }
  function json(args: string[]): any { // reason: see Gh.json
    try { return JSON.parse(run(args)); }
    catch (error) {
      if ((error as Partial<CodedError>).code) throw error;
      throw refuse('CI_GITHUB_UNREADABLE', 'GitHub CLI returned invalid JSON');
    }
  }
  function repository(explicit?: string): string {
    const repo: unknown = explicit ?? json(['repo', 'view', '--json', 'nameWithOwner'])?.nameWithOwner;
    if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw refuse('CI_GITHUB_UNREADABLE', 'a repository owner/name is required');
    return repo;
  }
  return { run, json, repository };
}

/** Repository, environment and Dependabot stores are distinct even when their names coincide. */
export function scopeArgs(options: CiScope): string[] {
  return options.dependabot ? ['--app', 'dependabot'] : options.env ? ['--env', options.env] : [];
}

export function scopeName(options: CiScope): string {
  return options.dependabot ? 'dependabot' : options.env ? `environment:${options.env}` : 'repository';
}
