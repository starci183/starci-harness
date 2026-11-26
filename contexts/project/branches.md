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

## PROJECT-BRANCH-2 A lane lands on `dev` itself: one squashed commit, right after its gate

1. A lane merges `origin/dev` into its branch and runs its own gate until it is green: `starci lane gate --push --land` runs it under the
   machine-wide slots ([authority/lanes.md](../authority/lanes.md)) and pushes the lane's branch (the app's `app push`, whose pre-push hook runs
   the fast level once; the records the run wrote are committed by it).
2. Green and pushed, the lane lands at once. Under the repository's dev lock (`<lanes>/_dev-push.lock`; the harness's `_dev-push-harness.lock`),
   it fetches and merges the newest `origin/dev` into the lane. When dev moved since the gate's merge, the merged tree is re-checked fast: the
   app's own `starci app check --gate types --env prod` (codegen and the tsc programs; the harness: the CLI's typecheck under the heavy governor);
   the whole gate never runs twice. When dev did not move, nothing is re-checked.
3. The lane is squashed into ONE commit on `dev`: the lane's merged tree with `origin/dev` as its parent, its message naming the lane with its
   branch and sha and carrying one `Landed-lane: <lane> <sha>` trailer. It is pushed as a fast-forward of `dev` (an app's through `app push`, the
   harness's with `git push`), never forced; the lock is released whatever happens.
4. A conflict with the newest dev refuses `LANE_LAND_CONFLICT` with its files and lands nothing: the lane merges `origin/dev`, resolves, commits
   and runs the verb again. A red re-check refuses `LANE_LAND_RED`, a failed push `LANE_LAND_PUSH`, both landing nothing.
5. The lane's status (`<lanes>/_land-status/<lane>.json`, `starci lane status`) reads `landed` with `sha`, the dev commit, and `migrations`, the
   files under `db/migrations/` it added, applied by the dev sync. The landing then marks the app's dev checkout (`devSync.repos` of
   `.runtime/local-settings.json`) for its debounced sync ([cicd.md](cicd.md) "The debounced dev sync"); a repository with sync turned off
   says so in the verb's output.
6. Local first: a lane that needs a harness change installs its local-registry build (`starci deps install-local`) and
   commits those pins when the app declares `deps.devAllowsLocalRegistry`; it lands on `dev` without waiting for npm. Only main and a
   prod cut need npm pins (`deps install-local --restore`, then each pin bumped to its npm version, once per release).

**Enforced by** `starci lane gate --land` (`cli/src/core/lane/land-direct.ts`, proven by `land-direct.test.ts`: the squash on the dev it landed on,
the re-check only after dev moved, the conflict that lands nothing, the lock released) and the dev lock (`takeDevLock`). That a lane ran its gate before `--land` is the verb's own order: `--land` runs only after a green `--push`.

PROJECT-BRANCH-1 and PROJECT-BRANCH-2 are an app's: the harness repository has no managed app hook, and its own `dev` and `main` follow PROJECT-BRANCH-3.

## PROJECT-BRANCH-3 The harness repository itself has `dev` and `main` too

1. The harness repository has two long-lived branches: `dev`, where finished harness work lands at once and is used locally, and `main`, what is
   released to npm. `main` is always an ancestor of `dev`. Which branch the harness checkout (`D:/.claude`) has checked out is the owner's choice;
   today it runs on `dev`. No verb switches it.
2. Harness lanes fork from `origin/dev` and land with `starci lane gate --push --land` exactly as an app's lanes do (PROJECT-BRANCH-2: one
   squashed commit per lane, a newer push cancels the running gate, the same status files), under the **harness profile** (`cli/src/harness/land-profile.ts`), picked when the repository is the harness checkout (cli/,
   contexts/README.md and packages/, the marker `release push` reads) or by `--profile harness`:
   - the gate is the harness FAST gate, `starci check --level dev --base <dev commit>`: the install, build and typecheck of the packages the
     batch changed and of every package that needs one of them (`release affected`, CI's plan), the CLI and the desktop app when affected, and the
     cheap checks a publish needs (built declarations name `.js` only; `bundles:check` where a package has it), then the **package tests**: the
     `npm test` of each of those packages that declares one, the same packages and the same command as CI's `package (...)` jobs on the push to
     `dev`, each on a heavy `test` slot. A package spec the lane breaks is red in the gate, which refuses with the failing test names and the run's
     last lines (`HARNESS_GATE_TEST`), and never first in dev's CI. The scope is the lane's diff and the packages that need a touched one, never every
     package; a package without a `test` script is built and typechecked only, and a package's `test` script is its whole CI test command (the
     Grammar's is its static checks, with no specs and no Storybook plays). The CLI's own suite, lint, the light gates and sonar stay at the train
     (item 4): dev only reaches the local registry, and the CLI suite takes gigabytes under the RAM governor. Hotfix has no gate at all
     ([authority/lanes.md](../authority/lanes.md) "Hotfix"), so it runs no package test. Every step that keeps a verdict (build, declarations,
     typecheck, bundles, lint, test) reuses a green record of the harness check cache whose key the tree computes now and runs only what changed; the
     records the gate writes are committed with the lane before its push ([harness/check-cache.md](../harness/check-cache.md));
   - the push of the squashed commit is `git push origin <sha>:dev` (there is no app hook);
   - one lanes folder serves every repository of the machine (its slots bound the machine), and each repository has its own dev lock (the harness's
     `_dev-push-harness.lock`).
3. After each landing that changed a published package, `lane gate --land` publishes the **dev line** to the
   local registry (`starci deps publish-dev --execute`, also run by hand, dry until `--execute`, idempotent): every package changed since the last dev
   publish and every package that pins one of them in `dependencies`, `peerDependencies` or `optionalDependencies` (the Grammar family, gallery,
   eslint-grammar-*, jest-preset, hfs, the CLI: the real graph of the package.json files) as `X.Y.Z-dev.N`, X.Y.Z the package's next release and N
   one more than any dev build of it the registry lists or the machine counted. The publish copies carry those versions and pin each other exactly;
   no committed file changes, so `dev` never holds a `-dev` pin. Then `devSync.local` names exactly those versions (exact versions, since the `local`
   dist-tag moves), a dev build whose release npm now serves is dropped from it, and every app's dev checkout of `devSync.repos` is marked for its
   debounced sync, which installs them.
4. A release train is a `dev` -> `main` move with the FULL gate: `starci check --release` (the same as `--level full`) on the dev tip (every package and the CLI with
   lint and their test suites, then CI's light gates; each step with a committed green record under its key is reused while the nightly
   `cache-verify.yml` is green, [harness/check-cache.md](../harness/check-cache.md)), `main` fast-forwarded to that commit, `starci release push --execute`, and publish.yml publishes the plain versions
   (`release publish`, never a `-dev` version). Then `starci release back-merge --execute` brings `main` back into `dev`, the cli-follow commit
   included: a fast-forward when dev is behind, else a merge commit, pushed under the harness's dev lock. `release push` of main and
   `release publish --execute` print that step; it runs only with `--execute`. **Cadence:** one harness train per day, batching the Grammar and canon
   fixes that landed on `dev` since the last one; an extra train only for a fix that blocks a prod deploy. A train costs the full gate (about 40 minutes), and
   the coordinator runs it, never a lane.
5. CI (`.github/workflows/ci.yml`) runs on pushes of and pull requests into both branches: the FAST level on `dev` (no sonar, no Grammar theme
   proof, no CLI lint), the FULL level on `main`; a newer push cancels the older run. publish.yml listens to the runs of `main` only, and a run
   that publishes is never cancelled.

**Enforced by** the harness profile of `starci lane gate` (`cli/src/harness/land-profile.ts`, proven by
`land-profile.test.ts`), `starci check` (`cli/src/core/release/gate.ts`, `gate.test.ts`, `check-rename.test.ts`; `starci release gate` is its deprecated spelling, which prints `renamed: use starci check [--release]` and runs the same check), `starci deps publish-dev`
(`cli/src/core/deps/publish-dev.ts`, `publish-dev.test.ts`), `starci release back-merge` (`back-merge.test.ts`) and ci.yml. That `main` moves only by
a train is held by review: the harness has no pre-push hook.
