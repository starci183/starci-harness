// cache-verify-lock.mts - the nightly verify lock of the release gate (OWNER RULING release-gate-warm-cache, 2026-11-04). The release gate trusts the
// warm committed cache: it runs diff-only at the release commit, whose cache main's CI already verified. A scheduled CI job (the managed
// cache-verify.yml) runs STARCI_APP_CHECK_CACHE=verify on the default branch every night: diff-only, then full, compared. A red verify run locks
// releases until a green verify run clears it: the gate reads the newest finished run of that workflow on the default branch.
//   open      the newest finished verify run is green, or the app has none yet (the first night has not come)
//   locked    the newest finished verify run is red: HFS_CHECK_CACHE_VERIFY_LOCKED, naming its run, until a green one
//   unread    GitHub could not be read: HFS_CHECK_CACHE_VERIFY_LOCKED too, since a release never proceeds blind
// A full release gate (`starci app release gate --full`, an owner's explicit opt-in) never reads the cache and so passes a lock.
import type { SpawnResult, VerbContext } from './index.mjs';

/** The code of a release refused by a red or unreadable nightly verify. */
export const VERIFY_LOCKED = 'HFS_CHECK_CACHE_VERIFY_LOCKED';
/** The managed workflow of the nightly verify. */
export const VERIFY_WORKFLOW = 'cache-verify.yml';

const FIELDS = 'databaseId,status,conclusion,url,createdAt';

/** A run of the verify workflow as `gh run list --json` answers it. */
export interface VerifyRun { databaseId?: number | string; status?: string; conclusion?: string; url?: string; createdAt?: string }

/** Where the lock stands, and the line the gate prints. */
export interface VerifyLock { readonly state: 'open' | 'locked' | 'unread'; readonly line: string }

/** The lock over the runs `gh` listed (newest first or not): a cancelled or running run is no verdict. Pure. */
export function lockOf(rows: readonly VerifyRun[] | null): VerifyLock {
  if (rows === null) return { state: 'unread', line: `${VERIFY_LOCKED}: the runs of ${VERIFY_WORKFLOW} cannot be read; a release never proceeds without the nightly verify (gh auth status)` };
  const finished = rows.filter((row) => row.status === 'completed' && row.conclusion !== 'cancelled' && row.conclusion !== 'skipped')
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || Number(b.databaseId) - Number(a.databaseId));
  const newest = finished[0];
  if (newest === undefined) return { state: 'open', line: `cache verify   no finished ${VERIFY_WORKFLOW} run yet: the gate trusts the cache main's CI verified` };
  if (newest.conclusion === 'success') return { state: 'open', line: `cache verify   green (${newest.url ?? String(newest.databaseId)})` };
  return { state: 'locked', line: `${VERIFY_LOCKED}: the newest nightly verify concluded ${newest.conclusion ?? 'unknown'} (${newest.url ?? String(newest.databaseId)}); fix the record it names and dispatch ${VERIFY_WORKFLOW} until it is green, or run the full gate (--full)` };
}

/** The lock of the app's default branch, read through `gh run list`. */
export function readVerifyLock(ctx: VerbContext, defaultBranch: string): VerifyLock {
  let answer: Partial<SpawnResult> & { status: number | null };
  try { answer = ctx.spawn('gh', ['run', 'list', '--workflow', VERIFY_WORKFLOW, '--branch', defaultBranch, '--limit', '20', '--json', FIELDS], { cwd: ctx.cwd, env: ctx.env }); } catch { answer = { status: null }; }
  if (answer.error || answer.status !== 0) return lockOf(null);
  try {
    const rows: unknown = JSON.parse(String(answer.stdout));
    return lockOf(Array.isArray(rows) ? (rows as VerifyRun[]) : null);
  } catch {
    return lockOf(null);
  }
}
