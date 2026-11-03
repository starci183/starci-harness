// freshness.mts - the push gate of the committed check cache (contexts/project/check-cache.md, "Every push carries a warm cache"). CI re-checks only what the
// committed cache does not cover, so a push whose cache records are missing or stale sends CI cold and past its ESLint budget. `starci app check --fresh` (the
// managed pre-push hook) runs every family diff-only against the cache in the tree and refuses the push when that run had to write or remove a cache file, or
// when the tree holds cache files git does not have committed: the records the push carries are then not the ones a real run on its tree produces.
import { git } from './git.mjs';
import { CACHE_DIR } from './types.mjs';

/** A push whose committed cache a real run on its tree changes (records missing, stale or never committed). */
export const UNWARMED = 'HFS_CHECK_CACHE_UNWARMED';
/** A push from a host that cannot write a portable cache (a linked or locally copied @starci package). */
export const UNPORTABLE = 'HFS_CHECK_CACHE_UNPORTABLE';

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
}

/** The cache paths git does not hold as committed: modified, added, deleted or untracked under the cache folder. */
export function uncommittedCacheFiles(root: string): string[] {
  const answer = git(root, ['status', '--porcelain', '--untracked-files=all', '--', CACHE_DIR]);
  if (!answer.ok) return [`${CACHE_DIR} (git status failed)`];
  return answer.stdout.split('\n').map((line) => line.slice(3).trim()).filter((line) => line !== '').sort();
}

/** The refusals of the push gate for one `--fresh` run; empty when the committed cache is what a real run on the tree produces. */
export function freshnessFindings(input: FreshnessInput): FreshnessFinding[] {
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
