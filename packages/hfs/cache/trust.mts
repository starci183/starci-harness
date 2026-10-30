// trust.mts - where the cache is trusted from. On a host the cache in the working tree is trusted (a local run is the developer's own
// view). In CI the cache is trusted only as it stands at the trusted base: the merge-base with the default branch for a pull request,
// the first parent for a push to the default branch. The change's own edits to the cache are never trusted: CI judges everything the base
// cache does not cover and then compares the committed cache with what it inherited or computed (verifyCommitted).
// No trusted base (a tag build, a schedule, an unreadable base) is a full run.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson } from './jsonl.mjs';
import { git, gitBytes } from './git.mjs';
import { CACHE_DIR, type CacheRecord, type Finding } from './types.mjs';

export const FORGED = 'HFS_CHECK_CACHE_FORGED';
export const STALE = 'HFS_CHECK_CACHE_STALE';
export const MISSING = 'HFS_CHECK_CACHE_MISSING';

/** The cache files a trust source holds: path under `.starcistacks/cache/` to text. */
export interface TrustSource {
  readonly kind: 'worktree' | 'base' | 'none';
  readonly reason: string;
  /** The commit the cache is read at, for `base`. */
  readonly base?: string | undefined;
  files(): ReadonlyMap<string, string>;
}

/** Every file under the cache folder of the work tree, keyed by its path under the folder. */
export function readCacheDir(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const top = path.join(root, ...CACHE_DIR.split('/'));
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else if (entry.isFile()) {
        try { files.set(rel, fs.readFileSync(path.join(dir, entry.name), 'utf8')); } catch { /* unreadable: absent */ }
      }
    }
  };
  walk(top, '');
  return files;
}

/** The cache folder of commit `rev`: one ls-tree and one cat-file --batch, however many files it holds. */
export function readCacheAt(root: string, rev: string): Map<string, string> | undefined {
  const listed = git(root, ['ls-tree', '-r', '-z', rev, '--', CACHE_DIR]);
  if (!listed.ok) return undefined;
  const entries = listed.stdout.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { sha: line.slice(0, tab).split(' ')[2] ?? '', file: line.slice(tab + 1) };
  }).filter((entry) => entry.sha !== '');
  const files = new Map<string, string>();
  if (entries.length === 0) return files;
  const blobs = gitBytes(root, ['cat-file', '--batch'], `${entries.map((entry) => entry.sha).join('\n')}\n`);
  if (!blobs.ok) return undefined;
  let at = 0;
  for (const entry of entries) {
    const eol = blobs.stdout.indexOf(0x0a, at);
    if (eol < 0) return undefined;
    const [, type, size] = blobs.stdout.subarray(at, eol).toString('utf8').split(' ');
    if (type !== 'blob' || size === undefined) return undefined;
    const start = eol + 1;
    const end = start + Number(size);
    files.set(entry.file.slice(CACHE_DIR.length + 1), blobs.stdout.subarray(start, end).toString('utf8'));
    at = end + 1;
  }
  return files;
}

export interface TrustInput {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Whether the run is in CI (the managed workflow, or any runner that sets CI). */
export const inCi = (env: NodeJS.ProcessEnv): boolean => env['CI'] === 'true' || env['GITHUB_ACTIONS'] === 'true';

const DEFAULT_BRANCHES = new Set(['main', 'master']);

/** The commit CI trusts the cache at, or why there is none. */
export function trustedBase(root: string, env: NodeJS.ProcessEnv): { base: string } | { reason: string } {
  const event = env['GITHUB_EVENT_NAME'];
  if (event === 'pull_request' || event === 'pull_request_target') {
    const target = env['GITHUB_BASE_REF'];
    if (!target) return { reason: 'a pull request with no base ref' };
    const merged = git(root, ['merge-base', 'HEAD', `origin/${target}`]);
    return merged.ok && merged.stdout.trim() !== '' ? { base: merged.stdout.trim() } : { reason: `no merge-base with origin/${target} (fetch it)` };
  }
  if (event === 'push') {
    const branch = (env['GITHUB_REF'] ?? '').replace(/^refs\/heads\//, '');
    if (!(DEFAULT_BRANCHES.has(branch) || branch === env['STARCI_DEFAULT_BRANCH'])) return { reason: `a push to ${branch || 'a non-branch ref'}, not the default branch` };
    const parent = git(root, ['rev-parse', '--verify', '-q', 'HEAD^1']);
    return parent.ok && parent.stdout.trim() !== '' ? { base: parent.stdout.trim() } : { reason: 'no first parent (fetch depth 1)' };
  }
  return { reason: `${event ?? 'an unknown CI event'} has no trusted base` };
}

/** The trust source of this run. */
export function resolveTrust({ root, env }: TrustInput): TrustSource {
  if (!inCi(env)) {
    let cached: Map<string, string> | undefined;
    return { kind: 'worktree', reason: 'the working tree', files: () => (cached ??= readCacheDir(root)) };
  }
  const found = trustedBase(root, env);
  if ('reason' in found) return { kind: 'none', reason: found.reason, files: () => new Map() };
  const files = readCacheAt(root, found.base);
  if (files === undefined) return { kind: 'none', reason: `the cache at ${found.base.slice(0, 12)} is unreadable`, files: () => new Map() };
  return { kind: 'base', reason: `the cache at ${found.base.slice(0, 12)}`, base: found.base, files: () => files };
}

const keyOf = (record: CacheRecord): string => `${record.path}\0${record.step}`;
const sameFindings = (a: readonly Finding[], b: readonly Finding[]): boolean => canonicalJson(a) === canonicalJson(b);

/** One verdict of the comparison of the change's committed cache with what CI inherited or computed. */
export interface CacheVerdict {
  readonly code: typeof FORGED | typeof STALE | typeof MISSING;
  readonly level: 'error' | 'warning';
  readonly path: string;
  readonly folder: string;
  readonly message: string;
}

export interface VerifyInput {
  /** The records CI trusts (the base cache), by folder. */
  readonly trusted: ReadonlyMap<string, readonly CacheRecord[]>;
  /** The records of this run (inherited and computed), by folder. */
  readonly computed: ReadonlyMap<string, readonly CacheRecord[]>;
  /** The records the change commits, by folder. */
  readonly committed: ReadonlyMap<string, readonly CacheRecord[]>;
}

/**
 * Compares the change's committed cache with what this run inherited or computed. A committed record whose key matches the tree and
 * whose findings differ from the computed one is FORGED (a hard blocker, whether it was edited by hand or a step is not deterministic
 * across hosts). A key the change touched (its record differs from the trusted one, or the trusted cache has none) that the committed
 * cache does not cover with a current record is STALE. A change that commits no cache at all while the run has computed one is MISSING.
 */
export function verifyCommitted({ trusted, computed, committed }: VerifyInput): CacheVerdict[] {
  const verdicts: CacheVerdict[] = [];
  let anyCommitted = false;
  let anyComputed = false;
  for (const [folder, records] of computed) {
    if (records.length === 0) continue;
    anyComputed = true;
    const own = new Map<string, CacheRecord>();
    for (const record of records) own.set(keyOf(record), record);
    const base = new Map((trusted.get(folder) ?? []).map((record) => [keyOf(record), record]));
    const mine = committed.get(folder) ?? [];
    if (mine.length > 0) anyCommitted = true;
    const byKey = new Map<string, CacheRecord[]>();
    for (const record of mine) byKey.set(keyOf(record), [...(byKey.get(keyOf(record)) ?? []), record]);
    for (const record of mine) {
      const truth = own.get(keyOf(record));
      if (truth === undefined || truth.hash !== record.hash) continue;
      if (!sameFindings(truth.findings, record.findings)) {
        verdicts.push({ code: FORGED, level: 'error', path: record.path, folder, message: `${folder}: the committed record of ${record.path} (${record.step}) matches the tree but its findings differ from what the check computes; regenerate the cache with starci app check` });
      }
    }
    for (const [key, truth] of own) {
      const before = base.get(key);
      const touched = before === undefined || before.hash !== truth.hash || !sameFindings(before.findings, truth.findings);
      if (!touched) continue;
      const held = (byKey.get(key) ?? []).some((record) => record.hash === truth.hash);
      if (!held) verdicts.push({ code: STALE, level: 'warning', path: truth.path, folder, message: `${folder}: ${truth.path} (${truth.step}) changed and the committed cache holds no current record of it; run starci app check and commit .starcistacks/cache` });
    }
  }
  if (anyComputed && !anyCommitted) {
    // One verdict for a change that commits no cache, not one stale key per file.
    verdicts.length = 0;
    verdicts.push({ code: MISSING, level: 'warning', path: CACHE_DIR, folder: '', message: `${CACHE_DIR} holds no records; run starci app check and commit the folder so later runs judge only what changed` });
  }
  return verdicts.sort((a, b) => (a.code + a.folder + a.path < b.code + b.folder + b.path ? -1 : 1));
}
