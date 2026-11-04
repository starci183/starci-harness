// freshness.mts - the push gate of the committed check cache (contexts/project/check-cache.md, "Every push carries a warm cache"). CI re-checks only what the
// committed cache does not cover, so a push whose cache records are missing or stale sends CI cold and past its ESLint budget. `starci app check --fresh` (the
// managed pre-push hook) runs every family diff-only against the cache in the tree and refuses the push when that run had to write or remove a cache file, or
// when the tree holds cache files git does not have committed: the records the push carries are then not the ones a real run on its tree produces.
import fs from 'node:fs';
import path from 'node:path';
import { git } from './git.mjs';
import { RECORD_FILE_MAX_BYTES } from './jsonl.mjs';
import { CACHE_DIR } from './types.mjs';

/** A push whose committed cache a real run on its tree changes (records missing, stale or never committed). */
export const UNWARMED = 'HFS_CHECK_CACHE_UNWARMED';
/** A push from a host that cannot write a portable cache (a linked or locally copied @starci package). */
export const UNPORTABLE = 'HFS_CHECK_CACHE_UNPORTABLE';

/** A push that carries a cache file a git host refuses or times out on (GitHub refuses a file over 100 MB, GH001). */
export const TOO_LARGE = 'HFS_CHECK_CACHE_FILE_TOO_LARGE';
/** The largest cache file a push may carry, in MB: STARCI_CACHE_FILE_MAX_MB, else 90. */
export const cacheFileLimitMb = (env: NodeJS.ProcessEnv = process.env): number => {
  const configured = Number(env.STARCI_CACHE_FILE_MAX_MB);
  return Number.isFinite(configured) && configured > 0 ? configured : 90;
};

/** The cache files over the limit, app-relative, with their size in MB, largest first. */
export function oversizedCacheFiles(root: string, limitMb: number): Array<{ file: string; mb: number }> {
  const base = path.join(root, ...CACHE_DIR.split('/'));
  if (!fs.existsSync(base)) return [];
  const out: Array<{ file: string; mb: number }> = [];
  for (const name of fs.readdirSync(base, { recursive: true, encoding: 'utf8' })) {
    const file = path.join(base, name);
    const stat = fs.statSync(file);
    if (stat.isFile() && stat.size > limitMb * 1024 * 1024) out.push({ file: `${CACHE_DIR}/${name.split(path.sep).join('/')}`, mb: Math.round((stat.size / 1048576) * 10) / 10 });
  }
  return out.sort((a, b) => b.mb - a.mb);
}

/** One refusal of the push gate, shaped like a check finding. */
export interface FreshnessFinding {
  readonly code: string;
  readonly level: 'error';
  readonly path: string;
  readonly message: string;
}

export interface FreshnessInput {
  readonly root: string;
  /** Whether the run had a portable fingerprint, and why not. */
  readonly portable: boolean;
  readonly localReasons: readonly string[];
  /** What the run's flush wrote and removed in the cache folder (app-relative). */
  readonly written: readonly string[];
  readonly removed: readonly string[];
  /** The cache files `git status` reports changed after the run; read from git when not given. */
  readonly uncommitted?: readonly string[] | undefined;
  /** The largest cache file a push may carry, in MB (cacheFileLimitMb when not given). */
  readonly limitMb?: number | undefined;
}

/** The cache paths git does not hold as committed: modified, added, deleted or untracked under the cache folder. */
export function uncommittedCacheFiles(root: string): string[] {
  const answer = git(root, ['status', '--porcelain', '--untracked-files=all', '--', CACHE_DIR]);
  if (!answer.ok) return [`${CACHE_DIR} (git status failed)`];
  return answer.stdout.split('\n').map((line) => line.slice(3).trim()).filter((line) => line !== '').sort();
}

/** The refusals of the push gate for one `--fresh` run; empty when the committed cache is what a real run on the tree produces. */
export function freshnessFindings(input: FreshnessInput): FreshnessFinding[] {
  const limitMb = input.limitMb ?? cacheFileLimitMb();
  // Before anything else: a file the host refuses fails the push after its upload started, whatever else holds.
  const oversized = oversizedCacheFiles(input.root, limitMb).map((entry): FreshnessFinding => ({
    code: TOO_LARGE, level: 'error', path: entry.file,
    message: `${entry.file} is ${String(entry.mb)} MB, over the ${String(limitMb)} MB a push may carry (a git host refuses a file over 100 MB); run \`starci app check\` with this @starci/hfs, which splits the records into files under ${String(Math.round(RECORD_FILE_MAX_BYTES / 1048576))} MB, commit ${CACHE_DIR} and push`,
  }));
  if (oversized.length > 0) return oversized;
  if (!input.portable) {
    return [{
      code: UNPORTABLE, level: 'error', path: CACHE_DIR,
      message: `this host cannot write a cache CI can trust (${input.localReasons[0] ?? 'a local package'}); run \`starci deps source --npm\`, then \`starci app check\`, commit ${CACHE_DIR} and push`,
    }];
  }
  const changed = [...new Set([...input.written, ...input.removed, ...(input.uncommitted ?? uncommittedCacheFiles(input.root))])].sort();
  if (changed.length === 0) return [];
  const listed = changed.slice(0, 5).join(', ') + (changed.length > 5 ? `, and ${changed.length - 5} more` : '');
  return [{
    code: UNWARMED, level: 'error', path: CACHE_DIR,
    message: `the pushed cache is not the one a run on this tree writes (${listed}); commit ${CACHE_DIR} as this run left it and push again`,
  }];
}
