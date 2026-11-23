# The branches of an app

An app repository has two long-lived branches and one way between them (PROJECT-BRANCH-1, PROJECT-BRANCH-2); the harness repository
itself has the same two lines under its own rule (PROJECT-BRANCH-3). This file owns the rules; every other page links to it.

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
   `starci app check --env prod` until it is green (the records the run wrote are left for `starci app push` to commit; `HFS_CHECK_CACHE_UNWARMED` is info), pushes
   its branch and registers that sha with `starci lane ready`; `starci lane gate --push --ready` runs those steps under the
   machine-wide slots ([authority/lanes.md](../authority/lanes.md)). A registration replaces the lane's earlier one.
2. One lander per lanes folder (`starci lane land`, the folder from `--dir` or `STARCI_LANES_DIR`) takes every ready lane at
   once and, in its own worktree reset to `origin/dev`, merges them one by one. A lane whose merge conflicts is left out and told
   whom it met: a batch-mate (it stays ready for the next batch) or `origin/dev` (it merges, re-gates and registers again). A
   conflict in `.starcistacks/cache` alone is no conflict: the batch keeps its own records and its gate rewrites what it re-checks.
3. The batch runs `npm ci` when the lockfile is not the one its `node_modules` came from, then codegen and `build:modules`, then
   one `app check --env prod` with the app's own pinned CLI. Green, `app push origin HEAD:dev` commits the cache records the run wrote
   and pushes, and every lane in the batch is landed at that commit. A tree that fails one of those prepare steps is judged like a red
   gate, so the same failing batch never forms again: each lane of a batch of several is prepared alone on `origin/dev`, and every lane
   that fails alone is rejected with the step's output (`LANE_LAND_PREPARE`); a batch whose lanes all pass alone but fail together
   rejects them all. When every lane fails alone (or the batch is one lane), `origin/dev` itself is prepared: a dev that fails too
   blames no lane, every lane stays ready and the lander waits a full poll before the next batch, as after any batch that failed
   before it judged its lanes (`harness/land-batch.ts` `judgePrepare`).
4. Red, each blocking finding is mapped to the lanes whose diff against the base names its file (the path itself, else a file its
   message cites, else a file under the folder it names). Those lanes are rejected with their findings and the gate runs once more
   on the rest. A second red run, a finding no lane's diff names, or a batch where every lane is named, lands nothing and rejects
   every lane with the findings. A red gate never splits a batch further: at most two gate runs.
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
8. Local first (owner 2026-11-22: "merge hết vô local dc không? pin 1 lần prod phát hành ntn kệ nó, và update .claude để tối đa hóa
   thời gian code local"): a lane that needs a harness change installs its local-registry build (`starci deps install-local`) and
   commits those pins when the app declares `deps.devAllowsLocalRegistry`; it lands on `dev` without waiting for npm. Only main and a
   prod cut need npm pins (`deps install-local --restore`, then each pin bumped to its npm version, once per release).

**Enforced by** `starci lane ready` (refuses a dirty tree, `LANE_READY_DIRTY`, and a sha that is not the pushed tip of its branch,
`LANE_READY_NOT_PUSHED`), `starci lane land` (one lander per folder, `LANE_LANDER_RUNNING`; the dev lock and the gate and npm slot files of the folder
taken under the lander's name, released only when they name it), `cli/src/harness/land-queue.ts` and `cli/src/harness/land-batch.ts`;
item 6 by `judgeRound` and `judgeWithOomRetry`, proven by `cli/src/harness/land-oom.test.ts`. That a lane gated before it registered is held by review: the batch gate catches what it skipped.

PROJECT-BRANCH-1 and PROJECT-BRANCH-2 are an app's: the harness repository has no managed app hook, and its own `dev` and `main` follow PROJECT-BRANCH-3.

## PROJECT-BRANCH-3 The harness repository itself has `dev` and `main` too

The owner's words (2026-11-22): "bản thân .claude cũng tách thành dev main được không? dev code xong merge nhanh để xài local", after "merge hết vô
local dc không? pin 1 lần prod phát hành ntn kệ nó, và update .claude để tối đa hóa thời gian code local" and "rules là k check nhánh khi dev, khi
nào push mới check tổng 1 lần sửa 1 lần vẫn hơn".

1. The harness repository has two long-lived branches: `dev`, where finished harness work lands at once and is used locally, and `main`, what is
   released to npm. `main` is always an ancestor of `dev`. Which branch the harness checkout (`D:/.claude`) has checked out is the owner's choice;
   today it runs on `dev`. No verb switches it.
2. Harness lanes fork from `origin/dev`, gate with `starci lane gate --push --ready` and land through the batch lander exactly as an app's lanes do
   (PROJECT-BRANCH-2: one commit per batch listing the lanes and their shas, a newer registration cancels the running gate, the same status
   files), under the **harness profile** (`cli/src/harness/land-profile.ts`), picked when the repository is the harness checkout (cli/,
   contexts/README.md and packages/, the marker `release push` reads) or by `--profile harness`:
   - the gate is the harness FAST gate, `starci release gate --level dev --base <dev commit>`: the install, build and typecheck of the packages the
     batch changed and of every package that needs one of them (`release affected`, CI's plan), the CLI and the desktop app when affected, and the
     cheap checks a publish needs (built declarations name `.js` only; `bundles:check` where a package has it). No test suite, no lint, no light
     gates, no sonar: dev only reaches the local registry, and the tests are the release line's (item 4). Owner: "dev và prod phân biệt rõ…
     grammar chưa lên prod chạy test chỉ bỏ vào verdaccio không được à?". A package's tests run on request (`npm test` in it) or at the train;
     a test suite in the landing gate takes gigabytes under the RAM governor and holds every app build behind it;
   - the push is `git push origin HEAD:dev` (there is no app hook);
   - one lanes folder serves every repository of the machine (its slots bound the machine): `lane ready` records the lane's origin URL and each
     lander takes only its own repository's lanes; the harness lander holds `_batch-lander-harness.lock` and `_dev-push-harness.lock` and works in
     `<lanes>/_batch-lander-harness`;
   - the harness lander runs in place, from the CLI it was started with (`node D:/.claude/cli/dist/main.js lane land`): an npm install of the
     same version would lack the dev code it lands with.
3. After each landed batch, when this machine's local settings say `devSync.publishLocal: true`, the harness lander publishes the **dev line** to the
   local registry (`starci deps publish-dev --execute`, also run by hand, dry until `--execute`, idempotent): every package changed since the last dev
   publish and every package that pins one of them in `dependencies`, `peerDependencies` or `optionalDependencies` (the Grammar family, gallery,
   eslint-grammar-*, jest-preset, hfs, the CLI: the real graph of the package.json files) as `X.Y.Z-dev.N`, X.Y.Z the package's next release and N
   one more than any dev build of it the registry lists or the machine counted. The publish copies carry those versions and pin each other exactly;
   no committed file changes, so `dev` never holds a `-dev` pin. Then `devSync.local` names exactly those versions (exact versions, since the `local`
   dist-tag moves), a dev build whose release npm now serves is dropped from it, and the after-land dev sync (`devSync.afterLand`) installs them into
   the app checkout `devSync.checkout` names.
4. A release train is a `dev` -> `main` move with the FULL gate: `starci release gate --level full` on the dev tip (every package and the CLI with
   lint and their test suites, then CI's light gates), `main` fast-forwarded to that commit, `starci release push --execute`, and publish.yml publishes the plain versions
   (`release publish`, never a `-dev` version). Then `starci release back-merge --execute` brings `main` back into `dev`, the cli-follow commit
   included: a fast-forward when dev is behind, else a merge commit, pushed under the harness lander's dev lock. `release push` of main and
   `release publish --execute` print that step; it runs only with `--execute`.
5. CI (`.github/workflows/ci.yml`) runs on pushes of and pull requests into both branches: the FAST level on `dev` (no sonar, no Grammar theme
   proof, no CLI lint), the FULL level on `main`; a newer push cancels the older run. publish.yml listens to the runs of `main` only, and a run
   that publishes is never cancelled.

**Enforced by** the harness profile of `starci lane land` and `starci lane gate` (`cli/src/harness/land-profile.ts`, proven by
`land-profile.test.ts`), `starci release gate` (`cli/src/core/release/gate.ts`, `gate.test.ts`), `starci deps publish-dev`
(`cli/src/core/deps/publish-dev.ts`, `publish-dev.test.ts`), `starci release back-merge` (`back-merge.test.ts`) and ci.yml. That `main` moves only by
a train is held by review: the harness has no pre-push hook.
