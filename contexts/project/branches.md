# The branches of an app

An app repository (never the harness repository itself) has two long-lived branches and one way between them. This file owns the
rule; every other page links to it.

## PROJECT-BRANCH-1 An app has exactly two long-lived branches, `main` and `dev`

1. An app repository must have exactly two long-lived branches: `main` and `dev`.
2. `main` is what is released on git. It moves only by a release (the annotated `v*` tag through `release push`), and only by
   fast-forward to a commit that is on `dev`.
3. `dev` is the working branch, forked from `main`, and always at or ahead of `main`: `main` is always an ancestor of `dev`, and
   the two never diverge. `starci app scaffold` makes the app the first commit of `main` and checks out `dev` at it
   (`settleScaffoldBranches`, `packages/hfs/scaffold/app.mts`); when git refuses the commit (no identity), it leaves every file staged on
   unborn `main` and its output names the two steps left.
4. Lane and feature branches fork from `dev` and merge back into `dev`. Nobody commits on `main` directly.
5. Promoting `dev` to `main` passes the full `starci app check` gate. The branch profile of `dev`
   ([lint.md](lint.md) PROJECT-LINT-2) never applies to `main` (the gates an app switches off for the whole app, [lint.md](lint.md) PROJECT-LINT-4, are off on `main` too): a push of `main` or of a release tag is judged as `main` whatever branch
   is checked out, and a merge of `dev` into `main` cannot skip `app check`.

**Enforced by** (R388):

- the managed `.husky/pre-push` hook (`packages/hfs/templates/app/hooks/husky/pre-push`, rendered by `app sync`) through the bundled
  push gate (`scripts/guards/release-push-gate.mts`): a push of `main` is refused unless the pushed commit is reachable from `dev`,
  the local one and the remote-tracking one (or the dev pushed with it): `BRANCH_MAIN_NOT_ON_DEV`; unless it is the checked-out
  `HEAD`, the tree the hook's check judges: `BRANCH_MAIN_NOT_CHECKED_OUT`; and a push of `dev` is refused when it deletes `dev` or when
  `main` (local, remote-tracking or pushed with it) is not its ancestor: `BRANCH_DEV_NOT_ON_MAIN`. The one bootstrap path is the first push into
  an empty remote: it must push `main` and `dev` together, both at the same commit (`git push origin main dev`), and the scaffold's first commit passes the hook as it is
  (it carries no check cache, [check-cache.md](check-cache.md) "Scaffold"); `main` alone into an
  empty remote is refused `BRANCH_MAIN_NOT_ON_DEV`.
- the same hook runs `starci app check --env prod` with `STARCI_JUDGED_BRANCH=main` for a push of `main` or of a `v*` tag, so the full gate
  runs and the profile of the checked-out branch is ignored ([lint.md](lint.md) PROJECT-LINT-2 "Which profile a run is under").
- CI: a pull request into `main` and every push of `main` run the full gate ([cicd.md](cicd.md) "Triggers and what runs").
- a whole `starci app check` fails with the error `HFS_DEV_BRANCH_MISSING`, in `--env local` and `--env prod` alike, when the repository has no `dev` branch,
  locally or on `origin`: an app must keep both branches.

## PROJECT-BRANCH-2 Lanes land on `dev` in batches, through one lander

1. A lane never pushes `dev` and never holds the dev lock. It merges `origin/dev` into its branch, runs its own
   `starci app check --env prod` until it is green except `HFS_CHECK_CACHE_UNWARMED`, commits the cache as the run left it, pushes
   its branch and registers that sha with `starci lane ready`; `starci lane gate --push --ready` runs those steps under the
   machine-wide slots ([authority/lanes.md](../authority/lanes.md)). A registration replaces the lane's earlier one.
2. One lander per lanes folder (`starci lane land`, the folder from `--dir` or `STARCI_LANES_DIR`) takes every ready lane at
   once and, in its own worktree reset to `origin/dev`, merges them one by one. A lane whose merge conflicts is left out and told
   whom it met: a batch-mate (it stays ready for the next batch) or `origin/dev` (it merges, re-gates and registers again). A
   conflict in `.starcistacks/cache` alone is no conflict: the batch keeps its own records and its gate rewrites what it re-checks.
3. The batch runs `npm ci` when the lockfile is not the one its `node_modules` came from, then codegen and `build:modules`, then
   one `app check --env prod` with the app's own pinned CLI. Green except the cache, `app push origin HEAD:dev` commits the cache
   and pushes, and every lane in the batch is landed at that commit.
4. Red, each blocking finding is mapped to the lanes whose diff against the base names its file (the path itself, else a file its
   message cites, else a file under the folder it names). Those lanes are rejected with their findings and the gate runs once more
   on the rest. A second red run, a finding no lane's diff names, or a batch where every lane is named, lands nothing and rejects
   every lane with the findings. A batch is never split further: at most two gate runs.
5. Each lane reads its outcome from `<lanes>/_land-status/<lane>.json`: `queued`, `landed` (`sha` the dev commit, `migrations`
   the files under `db/migrations/` it added, applied once landed), `conflict` (`reason`, `files`, `requeued`) or `rejected`
   (`findings`). A gate that gives no verdict (no report) or a failed push blames no lane: every lane stays ready.
6. A gate that ran out of memory blames no lane: exit 134, 137 or `0xC0000409`, a V8 heap message, the harness's heap-cap note or
   `ENOMEM`, from the gate itself or from a check one of its findings reports. The round waits until the host has `OOM_FREE_MB` free
   and runs again, at most `OOM_RETRIES` more times; a round that still runs out of memory parks its lanes (`parked`, with the
   evidence in `reason`), never rejects them, and each registers again once the host has RAM. A push whose check ran out of memory, or a batch whose
   install, codegen or module build ran out of memory, waits for the same RAM before the next batch; its lanes stay ready.
7. When this machine's local settings turn it on (`devSync.afterLand` in `.runtime/local-settings.json`, git-ignored, off by
   default), a landed batch is followed by `starci dev sync --execute` on the app's main dev checkout, debounced over consecutive
   batches: it fast-forwards that checkout, installs, and rebuilds and restarts only the changed api or web of the running dev stack
   ([cicd.md](cicd.md) "Dev and prod"). A refused or failed sync is logged and never stops the lander.

**Enforced by** `starci lane ready` (refuses a dirty tree, `LANE_READY_DIRTY`, and a sha that is not the pushed tip of its branch,
`LANE_READY_NOT_PUSHED`), `starci lane land` (one lander per folder, `LANE_LANDER_RUNNING`; the dev lock and the gate and npm slot files of the folder
taken under the lander's name, released only when they name it), `cli/src/harness/land-queue.ts` and `cli/src/harness/land-batch.ts`;
item 6 by `judgeRound` and `judgeWithOomRetry`, proven by `cli/src/harness/land-oom.test.ts`. That a lane gated before it registered is held by review: the batch gate catches what it skipped.

The harness repository has no managed app hook and no `dev` branch; this rule never applies to it.
