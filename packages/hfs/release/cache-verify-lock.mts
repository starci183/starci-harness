// cache-verify-lock.mts - the verify lock of the release gate. The release gate trusts the
// warm committed cache: it runs diff-only at the release commit, whose cache main's CI already verified. The managed cache-verify.yml (sharded like ci.yml, one job per
// family, each `app check --fresh --gate <family>`) proves that trust: nightly on the default branch, and on `workflow_dispatch` on any branch, for that branch's head.
// The gate reads the verify runs that speak for the release: those of the default branch and those of the release's own sha (any branch). The newest finished one decides:
//   open      it is green (a green verify of this very sha, dispatched on `dev` or a candidate, outranks an older red run of main), or the app has none yet
//   locked    it is red: HFS_CHECK_CACHE_VERIFY_LOCKED, naming its run, until a newer green one (a newer red verify of main locks again)
//   unread    GitHub could not be read: HFS_CHECK_CACHE_VERIFY_LOCKED too, since a release never proceeds blind
// A full release gate (`starci app release gate --full`, an owner's explicit opt-in) never reads the cache and so passes a lock.
import type { SpawnResult, VerbContext } from './index.mjs';

/** The code of a release refused by a red or unreadable nightly verify. */
export const VERIFY_LOCKED = 'HFS_CHECK_CACHE_VERIFY_LOCKED';
/** The managed workflow of the nightly verify. */
export const VERIFY_WORKFLOW = 'cache-verify.yml';

const FIELDS = 'databaseId,status,conclusion,url,createdAt,headSha';

/** A run of the verify workflow as `gh run list --json` answers it. */
export interface VerifyRun { databaseId?: number | string; status?: string; conclusion?: string; url?: string; createdAt?: string; headSha?: string }

/** Where the lock stands, and the line the gate prints. */
export interface VerifyLock { readonly state: 'open' | 'locked' | 'unread'; readonly line: string }

/**
 * The lock over the runs `gh` listed: `main` are the runs of the default branch, `sameSha` the runs of the release's own sha on any branch. A cancelled, skipped or
 * running run is no verdict; the newest finished run of both lists decides. Pure.
 */
export function lockOf(main: readonly VerifyRun[] | null, sameSha: readonly VerifyRun[] = [], sha?: string): VerifyLock {
  if (main === null) return { state: 'unread', line: `${VERIFY_LOCKED}: the runs of ${VERIFY_WORKFLOW} cannot be read; a release never proceeds without the cache verify (gh auth status)` };
  const ids = new Set<string>();
  const finished = [...main, ...sameSha].filter((row) => row.status === 'completed' && row.conclusion !== 'cancelled' && row.conclusion !== 'skipped')
    .filter((row) => row.databaseId === undefined || !ids.has(String(row.databaseId)) && ids.add(String(row.databaseId)))
    .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || Number(b.databaseId) - Number(a.databaseId));
  const newest = finished[0];
  if (newest === undefined) return { state: 'open', line: `cache verify   no finished ${VERIFY_WORKFLOW} run yet: the gate trusts the cache main's CI verified` };
  const own = sha !== undefined && newest.headSha === sha ? ' for this sha' : '';
  if (newest.conclusion === 'success') return { state: 'open', line: `cache verify   green${own} (${newest.url ?? String(newest.databaseId)})` };
  return { state: 'locked', line: `${VERIFY_LOCKED}: the newest cache verify${own} concluded ${newest.conclusion ?? 'unknown'} (${newest.url ?? String(newest.databaseId)}); fix the record it names and dispatch ${VERIFY_WORKFLOW} on the release branch until it is green for this sha (or a newer verify of main is), or run the full gate (--full)` };
}

/** gh's answer for a workflow file the default branch does not hold yet: HTTP 404 naming the workflow, on its error stream or in its output. */
function isWorkflowNotOnDefaultBranch(answer: Partial<SpawnResult> & { status: number | null }): boolean {
  if (answer.status === 0) return false;
  const text = `${String(answer.stderr ?? '')}\n${String(answer.stdout ?? '')}`;
  return /HTTP 404\b/u.test(text) && text.includes(`workflow ${VERIFY_WORKFLOW} not found on the default branch`);
}

/** The runs `gh run list` answered for `args`, or null when gh could not answer. */
function listRuns(ctx: VerbContext, args: readonly string[]): VerifyRun[] | null {
  let answer: Partial<SpawnResult> & { status: number | null };
  try { answer = ctx.spawn('gh', ['run', 'list', '--workflow', VERIFY_WORKFLOW, ...args, '--limit', '20', '--json', FIELDS], { cwd: ctx.cwd, env: ctx.env }); } catch { answer = { status: null }; }
  // GitHub answers 404 for a workflow its default branch does not hold yet (an app whose first release brings cache-verify.yml to main):
  // no verify has run, which is the "none yet" case, not an unreadable one.
  if (!answer.error && isWorkflowNotOnDefaultBranch(answer)) return [];
  if (answer.error || answer.status !== 0) return null;
  try {
    const rows: unknown = JSON.parse(String(answer.stdout));
    return Array.isArray(rows) ? (rows as VerifyRun[]) : null;
  } catch {
    return null;
  }
}

/** The lock of a release: the verify runs of the app's default branch and, with `sha`, those of the release's own sha on any branch. */
export function readVerifyLock(ctx: VerbContext, defaultBranch: string, sha?: string): VerifyLock {
  const main = listRuns(ctx, ['--branch', defaultBranch]);
  if (main === null) return lockOf(null);
  // A sha whose runs cannot be read speaks for nothing: the default branch alone decides.
  const own = sha === undefined ? [] : listRuns(ctx, ['--commit', sha]) ?? [];
  return lockOf(main, own, sha);
}
