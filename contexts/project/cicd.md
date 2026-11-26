# The delivery pipeline of an app

Every StarCi app gets one delivery pipeline in its `.github/`, rendered by `starci app sync` from the `@starci/hfs`
templates: a release push builds the release's images and pushes them to the registry the app declares, and once every
required check of that commit is green it deploys them to the app's Docker Swarm environments, verifies the release and
rolls it back by itself when the verification fails. It builds on the committed check cache of [check-cache.md](check-cache.md) and
on the Swarm verbs of `starci app stack`, and it changes neither: it adds the order they run in.

## Dev and prod

An app has two delivery flows, and neither waits for the other. The owner's rules, verbatim:

> ".claude nói rõ tách biệt quy trình dev (đưa lên cloudflare) và prod riêng biệt ko đợi nhau. npm cũng vào local và dev server mở thẳng lun"

> "prod tối cũng dc, tập trung dev cho thầy trc!!!"

> "dev thì chạy trên nhánh dev, code xong cứ merge vào dev, mở server local ra test (build từ code dev hiện tại và chạy để tránh hot-reload), trong quá trình làm có thể upgrade grammars,hfs,... nhưng mà đơn giản là publish local nên dev trơn tru. và cứ từ từ đưa lên .claude các bản vá, đưa lên code, check kĩ, build docker, app check,.. để dần dần lên prod sau dev"

> "merge hết vô local dc không? pin 1 lần prod phát hành ntn kệ nó, và update .claude để tối đa hóa thời gian code local"

Dev is the fast path and comes first; prod is the slow, careful path and may run later the same day. They share no
checkout and no lock: prod work never moves the dev checkout, and a dev batch never waits for a release.

| | dev | prod |
|---|---|---|
| source | each lane lands itself: `lane gate --push --land` -> `dev` ([branches.md](branches.md) PROJECT-BRANCH-2) | one fixed release sha on `main` |
| harness packages | local first: every harness change goes to the local registry at once (`starci deps publish-local --execute` in the harness); the app adopts it on dev at once (`deps install-local` in a lane, `devSync.local` on the dev checkout); a lane never waits for npm | npm, published once per release train for prod only (`release push`, CI publish); the cut pins npm versions ONCE: `deps install-local --restore`, then each local pin bumped to its npm version |
| local pins | committed on `dev` and lane branches when `hfs.json` declares `deps.devAllowsLocalRegistry` (the default for an app on local-first dev) (`deps check` accepts the local-registry codes there, [authority/packages.md](../authority/packages.md) "Dev-only local pins") | refused: `release push`, `release cut`, `app release`, a prod deploy and a push of main hold npm versions |
| checks | the lane's own fast gate, and a fast re-check (codegen, typecheck) when dev moved before it landed | the full checks, docker images built, `app check --env prod`, staging, the tag, CI (below) |
| runs on | the app's main dev checkout and its dev stack (`starci app stack up --env dev`), exposed through the dev tunnel (Cloudflare, PROJECT-STACKS-15) | staging, then prod (Docker Swarm, below) |
| moves by | `starci dev sync --execute`: by its debounced runner after a landing (`dev sync-runner`), or by hand | `starci release cut --from <sha> --execute`, then the tag's CI and deploy |

**`starci dev sync [--local <pkg>]... [--dir <checkout>] [--env <env>] [--no-restart] --execute`** brings an app's main dev checkout
to `origin/dev` and its running dev stack onto that code:

1. It refuses a tracked change that is not a local overlay's (`DEV_SYNC_DIRTY`) and a checkout that is not on `dev` (`DEV_SYNC_NOT_DEV`);
   a checkout holding commits `origin/dev` lacks is `DEV_SYNC_DIVERGED`. Work reaches dev through a lane, never through this checkout.
2. A recorded overlay (`deps install-local`) is put back to the committed pins first, so the overlay never survives a sync
   that does not name it again; then the checkout fast-forwards to `origin/dev` and `npm ci` runs (skipped when the lockfile did
   not change and no overlay was dropped). A sync that names exactly the overlay already installed (each package at the same
   version), whose commits move no pinned manifest and no lockfile and which no failed swap marked, keeps it: nothing is restored, installed,
   stopped or restarted for it, so the web the owner has open keeps running and only the side a commit changed restarts. Every sync that
   installs `node_modules` again installs the overlay `devSync.local` names with it, so the overlay stays in effect while the setting names it.
   **The pins always match the install.** The manifests and lockfiles in the checkout name exactly what its `node_modules` holds, with the overlay
   or without it: a swapped install brings its own (below), and an install that fails before the new `node_modules` is in place keeps the
   previous commit with the previous overlay's manifests, lockfiles and record.
3. Each `--local <pkg>` is installed from the local registry through the `deps install-local` machinery.
   **Build first.** When the sync installs, the new tree is installed and built before anything stops (`core/dev/stage.ts`): a staging
   worktree of the checkout's repository at the new commit, `<parent>/.<checkout>.starci-next`, gets the `npm ci`, the `--local` packages and the
   app's `codegen` and `build:modules`, each under the heavy governor, while the running api and web keep serving the old tree. A failure there is
   `DEV_SYNC_BUILD` with nothing stopped or moved. The staged install is then smoke-checked where it was made (`cli/src/core/dev/smoke.ts`): from the
   root and each workspace, a few declared packages and `next`, `postcss`, `picocolors`, and the dependencies of each down three levels, resolved
   by file the way Node does. A miss is `DEV_SYNC_SMOKE` with nothing stopped or moved. A miss counts only when `package-lock.json` installs that
   package where Node looks for it; a dependency the lockfile itself places nowhere on that chain (npm left a peer cycle's package out of it) is a
   lockfile gap, the same in every `npm ci` of that lockfile, staged or in place: it is said once, with "fix the lockfile on a lane", and never
   reinstalled for. Then the processes stop, the checkout fast-forwards, and the staged outputs (git's ignored
   entries of the staging tree, each folder whole and nothing inside a listed folder: every `node_modules`, every `dist`, generated files such as husky's `.husky/_`) are moved in by rename on the same volume, the workspace
   links npm made into the staging tree (absolute junctions on Windows) are re-pointed at the checkout, the staging tree's manifests and lockfiles
   are copied (each one its install changed and each one the previous overlay had changed), and what they replaced is left aside as
   `<entry>.starci-old`, deleted without blocking only once the stack runs again (a `node_modules` delete takes many minutes on Windows and is no part of the
   downtime); an entry still held then is deleted by the next sync before it stops anything. A move that fails puts every move back (`DEV_SYNC_SWAP`), and the checkout goes back to the commit it was on with
   the previous overlay, so the stopped processes restart on the code and the install that belong together; only when git cannot move it back is
   it marked (`<git dir>/starci-dev-sync-unswapped`) so the next sync installs, builds, migrates and restarts whole. The runner retries a refused
   swap once after 20 s. The swapped install is smoke-checked again; a repairable miss there, though the staged one resolved, replaces it with a clean
   `npm ci` in place (the overlay and the prepare scripts again) before anything restarts, under the mark; when that install fails, the swapped
   install of the new commit, which came with its own pins, is put back and runs. After any failed sync the runner checks every declared process
   and runs `app stack up` for those nothing listens for. So the downtime of a sync is the swap and the restart. The in-place install below is the
   fallback for a copy an interrupted in-place sync left aside.
   Before anything writes `node_modules` (steps 2 and 3), before the checkout moves, the dev stack processes the environment's
   local state records (read through the app's pinned CLI, `starci --json app stack status --env <env>`) are ended with their
   children and seen gone: on Windows a running process that loaded a `.node` file makes `npm ci` die halfway with EPERM. A
   stop that fails, or a record that cannot be read, is `DEV_SYNC_STOP`, and nothing installs or moves. `npm ci` runs with every
   `node_modules` it replaces (the root's and each workspace's) renamed aside first, on the same volume: a folder a process still
   holds refuses the rename at once, one retry follows a short pause, then `DEV_SYNC_BUSY` with nothing deleted. A failed
   install puts every copy back and keeps the previous commit, as a refused swap does: new code never runs on an old install. The
   copies are removed only once it passed, and a copy left aside by a sync that died is moved back by the next sync, which installs again.
   A failed `npm ci` says on the first line of its refusal how it ended and why (`DEPS_INSTALL_FAILED`: the exit code, a kill past
   the install budget of `heavy.timeoutMinutes`, npm's first error line, or that it printed nothing), then the tail of its output and
   the error lines of npm's debug log, secrets redacted; the runner's status keeps that line and its log the whole refusal. Then the tree is prepared as the lane gate and the
   lane gate prepares its own (`harness/prepare-tree.ts`): the app's `codegen` and `build:modules` (its workspace packages, whose `main`
   is their `dist`), each it declares, whenever the sync installed or a running process reads a changed file. A step that fails is
   `DEV_SYNC_BUILD` with its output; the next sync builds again and restarts both sides though the checkout has not moved. The
   stopped processes restart after the install and the build, with the changed ones, even under `--no-restart`, and alone when the
   install or the build failed (after a failed install, on the previous commit).
4. When the fast-forward brought files under `db/migrations/` (`MIGRATIONS_FOLDER`), the database is migrated before anything restarts
   on that code, by the stack's own migrate step and its receipt: `starci app stack up --env <env> --execute` with the app's pinned
   CLI (idempotent: what runs is kept, and the processes stopped for the install start again on the new code). A migration that
   fails is `DEV_SYNC_MIGRATE` with its output: no process restarts on the new code (only the stopped ones come back), and the next
   sync migrates again and restarts both sides though the checkout has not moved.
5. The changed side restarts: a change under `be/` restarts the api, under `fe/` the web, anything else a process reads (the root
   manifests, `packages/`, `db/`, the stack declaration, an overlay) both; docs and cache records restart nothing. It runs the app's
   own pinned CLI: `starci app stack restart --env <env> --process <names> --execute`, which **builds** each process from the
   checkout's code and runs the built artifact (the process's `serve` block: `next build` then `next start`, the api build then
   `node dist/...`), never a watcher, waits for its health on the loopback and over each tunnel hostname that routes its port, and
   keeps the database, the storage, their volumes and the tunnel up ([stacks.md](stacks.md) PROJECT-STACKS-6). A web the tunnel
   publishes runs behind its edge, which keeps answering the tunnel with a page saying the app is updating (reloading itself) from
   the stop before the install until the new web's page and its Grammar CSS answer, so the owner never loads a page with no Grammar
   CSS; and a start first ends any earlier tree of the same command from the checkout, so one api watcher runs per checkout
   ([stacks.md](stacks.md) "The edge of a dev web").
6. It prints the local overlay in effect (or "none"). Without `--execute` it fetches and prints the plan.

Hot reload is opt-in for live coding: `starci app stack up --env dev --execute --watch` (or `stack restart --watch`) runs the
process's own watcher argv.

**The debounced dev sync.** A landing never syncs by itself: `lane gate --land` marks its app's dev checkout as wanting a sync, and one runner per
checkout (`starci dev sync-runner`, started through a relay so that no terminal tab or agent owns it) waits until no landing marked it for
`debounceSeconds` (120 s), stops the checkout's stray dev servers (a process run from inside the checkout that is a dev server or listens on a port
the environment declares, and that its stack does not record: neither a recorded process, one of its children, nor a web's edge; an earlier hand
run, or a copy a moved checkout left, which `stack up` refuses as STACK_LOCAL_SECOND_COPY; nothing else), runs `dev sync
--execute` once to the newest `origin/dev`, brings the stack up (`app stack up --execute`) when a declared process has nothing listening after it,
and syncs again only when a landing marked the checkout during that sync. `npm ci` that dies on a held file (ENOTEMPTY, EPERM, EBUSY: an antivirus
scanning a large file) runs again up to four times, its `node_modules` removed with retries before each try. Its files are in the checkout's git folder, the same for every CLI copy of the machine: `<git common dir>/starci-dev-sync/` holds the mark
(`wanted.json`), the status (`status.json`: `waiting`, `syncing`, `synced`, or `failed` with the refusal's code and message), the runner's lock
(its pid) and its log. `starci dev sync-runner --status --dir <checkout>` prints the status and the pending mark; `--request` marks and starts it
by hand. The runner's lock and the sync's own lock per checkout keep two syncs of a checkout from ever running at once. **The watchdog.** While a sync holds
stack processes stopped, no line said for `devSync.stallMinutes` (20) ends it as `failed` with `DEV_SYNC_STALLED` and the step that stalled; the runner then
brings the stack up as after any failed sync, marks the checkout to sync whole (the unswapped and unmigrated marks) and exits, so the stuck step never runs on beside
the next sync, which `--request` or the next landing starts. A wait outside that window (the heavy queue while the stack still serves) is never judged.

**Warming the cache after a pin move (a design, not built).** A pin or lockfile move that changes a part of the check cache fingerprint
([check-cache.md](check-cache.md) "The fingerprint") leaves the committed records cold, and the next gate pays for the full run (NIVO's: `hfs structure reused 0 checked 12868`,
8m25s). The one data file such a move touched without cause, `canon-pins.yaml`, is now a part of its own and costs nothing. For the moves that do invalidate (an hfs rule change,
a lint package, Jest, TypeScript), the sync-runner could warm the cache once, and lanes.md permits only this shape of it:
1. **Never in the dev checkout.** It is sync-owned, and its overlay (`devSync.local`) installs local dev builds, whose fingerprint is unportable
   (`HFS_CHECK_CACHE_UNPORTABLE`: the run writes no record), so a run there warms nothing and leaves the checkout dirty for the next sync. The run belongs to a lane worktree
   cut from the new `origin/dev`, installed from the committed lockfile (the shared install of `lane gate`), where the fingerprint is the portable one CI judges.
2. **The trigger** is the runner's own sync result: it already knows whether the sync moved the lockfile, a manifest or an `@starci` pin (the `npm ci` decision). Only then
   does it start the warm lane, once per sync, detached (the relay that started the runner), never waiting on it.
3. **The lane** runs `app check --env prod --level full` in its worktree (no `--fresh`); when records changed, `app push` commits them as `chore(cache): warm the check cache for <sha>`
   (the round [check-cache.md](check-cache.md) "The operating procedure" describes) and `lane gate --push --land` lands that one commit on dev under the dev lock like any lane,
   so dev never receives a hand commit. A run that wrote nothing lands nothing and removes its worktree.
4. **It terminates:** the landing marks the checkout for a sync, but a `chore(cache)` commit moves no pin and no lockfile, so that sync starts no warm lane. A lane that is
   already landing waits on the same dev lock; a conflict in the cache folder is resolved by discarding the lane's records and running again, never by merging them (a record is a function of its key).
5. **What is not settled and keeps it unbuilt:** the lanes rules define no unattended lane (who owns its slot, what notifies the coordinator when its full run is red, how it
   yields to a coordinator hotfix or a train that holds the dev lock), a full run takes 8 minutes and 2 of the 16 heavy slots at the moment two apps deploy, and a warm commit lands
   on every sync that moves a pin, so the coordinator's release trains would race it. The owner decides those, by CONTRIB-21, before the sync-runner starts lanes of its own.
Until then the warm commit is made by the lane that needs it (`lane gate --push` runs the `app push` round, above) or by `starci app push` on a branch.

Its settings are this machine's alone, in `<harness>/.runtime/local-settings.json` (git-ignored; the state base `STARCI_LOCAL_ROOT` when set; a CLI
installed in an app's `node_modules` reads the same file through the harness home above its working folder), schema `starci/local-settings@1`:

```json
{
  "devSync": {
    "afterLand": true,
    "checkout": "D:/Repositories/<app>",
    "env": "dev",
    "debounceSeconds": 120,
    "local": [],
    "processes": { "be": ["api"], "fe": ["web"] }
  }
}
```

**One entry per app.** The file is machine-wide but a landing marks only its own repository's dev checkout: `devSync.repos` maps the repository
a lane lands in to its checkout (and optional `afterLand`, `landInto`, `env`, `debounceSeconds`, `processes`; `landInto` names the integration branch
its lanes land into instead of dev, which marks no sync until `starci dev promote` moves dev, [branches.md](branches.md) PROJECT-BRANCH-4). With any entry listed, a repository without one syncs
nothing; with none listed the top-level `checkout` is a one-app machine's. And two syncs of one checkout never run together: `dev sync --execute` takes
a lock per checkout (temp folder, by path) and a second one waits for the first (`DEV_SYNC_BUSY` after 30 minutes; a dead holder is reclaimed).

```json
{ "devSync": { "afterLand": true, "repos": {
  "D:/Repositories/nivoos-lite": { "checkout": "D:/Repositories/nivoos-lite" },
  "D:/Repositories/starci-next-app": { "checkout": "D:/starci-lanes/_next/devstack" } } } }
```

`devSync.local` is this machine's standing overlay and the default way dev runs harness builds: the builds that dev keeps running from the
local registry (e.g. `["grammar@X.Y.Z-dev.N", "eslint-grammar-core@X.Y.Z-dev.N"]`). Every sync installs it, the debounced runner's and a
plain `starci dev sync` alike, until the setting is emptied, so dev runs the newest harness without waiting for npm. An app without
`deps.devAllowsLocalRegistry` keeps its committed pins on npm (its push gate refuses `DEPS_LOCAL_REGISTRY_COMMITTED`); with it, `dev` and lane
branches carry the local pins too. `--local` on the verb overrides it for one sync.

A harness landing that changed a published package runs `starci deps publish-dev --execute` in the lane's worktree (the changed packages and every
package that pins one of them, as `X.Y.Z-dev.N`, their publish copies pinning each other exactly), sets `local` to exactly those versions and marks
every app checkout of `devSync.repos` for its sync ([branches.md](branches.md) PROJECT-BRANCH-3).

`afterLand` (default `true` in a `repos` entry, `false` at the top level) lets a landing mark `checkout` (default: the repository's main checkout);
landings inside `debounceSeconds` of each other give one sync after the last. `local` keeps those packages on the local registry across syncs;
empty restores the registry versions. `processes` names the stack processes of each side; a sync restarts the processes the app declares
(`environments.<env>.local.processes` of its application-stacks.yaml, each by the side its `cwd` is under, `core/dev/declared.ts`) whenever the
setting names one the app does not declare, so the default `api`/`web` never reaches an app whose processes are `core`, `app`, `landing`. A sync
that is refused or fails is written to the runner's status with its reason, and the next landing (or `--request`) tries again.

**The harness's own dev and main.** The harness repository has the same two lines ([branches.md](branches.md) PROJECT-BRANCH-3; owner:
"bản thân .claude cũng tách thành dev main được không? dev code xong merge nhanh để xài local"). Harness lanes land on its `dev` with
`lane gate --push --land` under the harness profile (the FAST gate `starci check --level dev`: builds, typechecks, publish checks and the
`npm test` of each affected package, as CI's package jobs, never the CLI's suite; then the squashed commit with `git push`), and each landing that changed a published package goes to the local registry as the dev line and
into the apps' dev checkouts by their debounced syncs. npm sees only the
train: the dev tip passes `starci check --release`, `main` moves to it, `release push` and publish.yml publish the plain versions, and
`starci release back-merge --execute` brings `main` (the cli-follow commit) back into `dev`. CI runs the FAST level on `dev` and the FULL level on
`main`. The harness checkout's branch (`D:/.claude`, on `dev` today) is the owner's choice.

**Prod** is slow and careful, in this order: harness fixes go to npm (the harness's own release), then the app code is pushed
with its full checks, the docker images are built, `app check --env prod`, staging, the tag, CI, prod (the sections below).
`starci release cut --from <sha>` cuts the release from that fixed sha in a temporary worktree of its own, removed after the cut,
so the release never checks out, moves or dirties the dev checkout; without `--from` it cuts the clean checkout's HEAD.

## Triggers and what runs

Every push to an app's `main` already carries a release tag: the canon pre-push hook lets `main` and `v*` through only
for a commit on `dev` that is the checked-out HEAD, with its annotated tag, judged as `main` by the full gate
([branches.md](branches.md) PROJECT-BRANCH-1), and `release push` sends both in one atomic push. So "on push" means
on the release tag; the tag run is the release run, and the pipeline keys every decision on the commit sha.

| event | checks | images | deploy |
|---|---|---|---|
| `pull_request` to `main` (Dependabot, an owner branch) | diff-only against the merge-base cache | built, not pushed (proves the Dockerfiles) | never |
| push of `main` whose sha a `v*` tag points at | skipped: the `plan` job sees the tag and defers to the tag run | none | none |
| push of `main` with no tag (only when the hook was bypassed) | the plan refuses a commit that is not on `origin/dev` (PROJECT-BRANCH-1); then diff-only against the first parent, the full gate | none | none |
| push of a branch with a branch profile (`dev`, [lint.md](lint.md) PROJECT-LINT-2) | the checks under the profile: a reported lint lists its findings and fails only on `LINT_RATCHET_RAISED`; a reported Sonar analysis and Codecov upload run, and no quality gate judges them | none | none |
| push of `release/candidate-<version>` (apps with `release.requireCi: true`) | the release checks, diff-only against the cache at its merge-base with `main` | built and pushed under `sha-<sha>` | none; the candidate verdict is reused by the tag run |
| push of tag `v<version>` | the release checks, diff-only against the cache at its merge-base with `main` (check-cache.md "Trust"), or reused from a green candidate run of the same sha | built once, pushed with SBOM and provenance | every environment with `deploy.auto: true`, in declared order, after every required job is green |
| push of tag `v<version>` whose annotation carries `Starci-Urgent:` | the release checks: this run is the back-fill | built and pushed | skipped when the environment's accepted release already has this sha (the urgent deploy did it); otherwise as a normal tag |
| schedule (nightly, `main`) and `workflow_dispatch` of `cache-verify.yml` on any branch | one job per family, each `app check --fresh --gate <family>`: the family recomputed, red when the committed records differ; red makes the release check (`app check --release`) run fresh instead of reusing the cache, a green run for the release's sha clears it | none | none |
| `workflow_dispatch` of `stack-deploy.yml` | none; it requires a tag whose CI run is green (or an urgent annotation) | reused by digest from that run | `deploy`, `redeploy` or `rollback` of one environment |

`pull_request` is a new trigger for app workflows (R251 admits only tags, candidate branches, `main` and the
branches with a branch profile for `ci.yml`, and dispatch); a pull request targets `main` alone, so it always runs the full gate. It runs with read-only permissions, no environment and no secret; a fork's or Dependabot's run
gets none anyway. `pull_request_target`, `workflow_run` and path filters stay refused, and so does every schedule but the nightly `cache-verify.yml`.

**Integration and e2e run on request only, and are no part of CI (R12, CI standard item `no-world-layers`).** The integration,
e2e and contract specs need the test world, so they run only when a person asks for them, on a local machine: by hand
(`npm run test:integration`, `npm run test:e2e`, `npm run test:contract`). Nothing starts them on its own: no workflow, no
husky hook, no coverage run, no default row of the release gate and no agent or lane (an agent proves its change by the
typecheck and the gates its contract declares, and runs a world suite only when its task or the owner names it). No job or
step of any workflow runs them, under any trigger, a manual dispatch included, and `starci app check` runs none of them: its `test` family is the unit specs. The boot proof CI keeps is the wiring gate (`app check --gate wiring`,
R272), never the e2e suite. An app tracks no `.github/workflows/e2e.yml`: slot `app.ci-e2e` is forbidden and `starci app sync
--execute` removes the file. `HFS_E2E_IN_AUTOMATIC_GATE` refuses a hook, a coverage run or a workflow that runs one, and R301
`CI_STANDARD` refuses a `run` step that does (jest `--selectProjects integration|e2e|contract`, a `*.integration-spec` or
`*.e2e-spec` path, `test:e2e`, `test:integration`, `test:contract` or an `e2e` npm script).
When a person asks for one, it runs on the world slots `.starcistacks/application-stacks.yaml` declares (`tests.<kind>.workers`, one file at a time when absent), exclusive
specs alone, and skips a file whose inputs are unchanged since its last green run (`starci test integration|e2e`, `--full` ignores the cache;
[code/be/test.md](../code/be/test.md) BE-TEST-17): the records are committed under `.starcistacks/cache/test/` and are no part of any gate.

**One sha is judged once.** The first job, `plan`, reads the event and the refs and decides: `full` (the release checks of a
candidate or tag, Sonar included, still diff-only against the trusted cache), `diff` (with its trusted base, per check-cache.md "Trust"), `defer` (main push of a tagged sha) or `reuse` (a successful `ci.yml` run of
the same sha on its candidate branch, found through the API, whose run id becomes the evidence). Its outputs drive every
other job's `if:`; a skipped check job never means a green one, because the deploy gate below reads the evidence, not
the job graph.

**Concurrency.** A newer commit cancels the run it supersedes (many changes are gathered into one commit, and a newer push cancels the older run). The run is grouped `ci-${{ github.ref }}` with
`cancel-in-progress: ${{ !startsWith(github.ref, 'refs/tags/') }}`: a pull request, main, dev, every profile branch and a
release candidate cancel their older run; `cache-verify.yml` does the same. The one exception is a run that deploys or
publishes, because a half-done deploy or publish is worse than a stale run: a release tag run carries the deploy jobs and
GitHub cancels a whole run (a job's own group cannot shield it from the workflow's), so a tag run is never cancelled; a tag
takes no new commit, so no newer run supersedes it anyway. `stack-deploy.yml`,
`desktop-release.yml` and the harness's `publish.yml` keep `cancel-in-progress: false`. `images.yml` has no trigger of its
own and is cancelled with the `ci.yml` run that calls it. Each deploy job has its own group `deploy-<app>-<env>`,
`cancel-in-progress: false`: at most one deploy runs per environment, and a newer waiting release replaces an older
waiting one, which is the behaviour a deploy wants (the latest green release wins; [concurrency]). The Actions group
does not cover the owner's urgent deploy from his machine, so the deploy verb also takes a lock on the manager (below).

## The pipeline graph

```text
plan ──► fast ─┐
     ├─► lint (be, fe) ─┐
     ├─► test (shards) ─► coverage ─┐
     ├─► build ─────────────────────┼─► sonar ─┐
     ├─► images (matrix, push) ─────┘          ├─► verdict ─► deploy <env 1> ─► deploy <env 2> ...
     └───────────────────────────────────────────┘
```

**Checks.** The jobs stay the CI standard's shape (`fast`, `lint`, `test`, `coverage`, `build`, `sonar`; ci-standard.yaml
`jobs`). Every run judges `app check` (the `lint` job: `--gate lint` per side) against the trusted base cache, never with
a cold run, and the test shards run only the specs whose closure changed; under the `plan` job's `full` mode (the release
checks; which check families then run in full and which diff-only is [check-cache.md](check-cache.md#when-a-run-is-full)'s)
the units are sharded (`--gate test --shard <i>/<n>`) and the coverage job judges the merged report with `--coverage-from`. Sonar and the
Codecov upload run on every `full` run, so a release is analysed before it ships rather than only on tags after the fact,
and the quality gate's verdict, never the scanner's exit, is the job's result (PROJECT-STACKS-8). In the verdicts,
`app check` is green only with zero error findings; typecheck, build,
tests, coverage and the Sonar gate are binary.

**Root packages are built before they are read.** An app's root workspace packages (`packages/*`) are imported by their package name, which resolves into their `dist`. Every job that reads their
types or compiles code importing them builds them first with the app's managed `build:modules` script (`npm run
build:modules`): the `fast` job before its boot proof, every side of the `lint` matrix in its "build the lint inputs"
step, a multi-front-end build, the `sonar` job before its scan and the nightly `cache-verify`;
the managed `typecheck`, `lint`, `test`, `build:be` and `build:fe` scripts already run it first. A check that finds a
package unbuilt reads each import as nothing: the boot proof cannot compile the modules (`BE_APP_BOOT_PROOF_MISSING`), the
typed lint reads them as `any` (`no-unsafe-*`), and both disagree with the cache records made with the packages built
(`HFS_CHECK_CACHE_FORGED`). The managed ci.yml builds the root packages before it checks; an
app without root packages renders no such step.

**Images.** One job per declared image (`deploy.images` of every environment, merged by app), in parallel with the
checks, so the deploy waits for `max(checks, images)` instead of their sum. Each builds with `docker/setup-buildx-action`
and `docker/build-push-action` and pushes to the declared registry (`services.registry`, GHCR by default, logged in
with the job's `GITHUB_TOKEN` and `packages: write`):

- tags `sha-<40 hex>` always, `v<version>` on a tag run; no mutable environment tag is ever deployed or written (the
  release record holds the digests, and a moving `production` tag would be a second, unverified source of truth);
- `sbom: true` and `provenance: mode=max`, pushed as the image's attestations, so the deployed digest is the attested one
  and `images.yml`'s OCI tarballs go away; build arguments are public values only (secret build inputs are BuildKit
  `secrets:` mounts and never reach the provenance);
- platforms from `deploy.platforms` (default `[linux/amd64]`, the VPS's architecture); a multi-architecture build (QEMU
  or a native arm runner) only when an environment declares a node of another architecture; the release record keeps
  the index digest and each platform's;
- cache `type=gha,scope=<image>,mode=max` per image ([buildx gha]), and `type=registry,ref=<repo>:buildcache,mode=max` when
  the manifest says `ci.imageCache: registry` (several large Next.js images can exceed the repository's Actions cache);
- the builder is the hosted runner's own, unless the manifest says `ci.imageBuilder: remote`: then each image job first tries the
  rootless BuildKit of a managed VPS over ssh with the repository secrets `starci vps build-key add` sets, and builds on the runner
  when they are absent or it does not answer within 60 s ([harness/managed-vps.md](../harness/managed-vps.md#remote-buildkit));
- the job's outputs are `<service>=<repo>@sha256:<digest>` per image, the only form the deploy accepts.

**One image per sha, configured at runtime.** The digest a release record names is the same in staging and production; only the
environment differs. The rule, the `runtimePublicEnv` declaration and the browser read are [stacks.md](stacks.md) PROJECT-STACKS-22.

Pushing before the checks are green is deliberate (the owner's order: build, push, all pass, deploy): an image under
`sha-<sha>` is immutable and inert until a release record names it. On a pull request the images build with
`push: false` and no attestations.

**Verdict.** One job, `verdict`, needs every check job and the images and fails unless each required job succeeded or
`plan` reused a green run. It is the single check name branch protection requires and the only job a deploy needs.

**Deploy.** One `deploy-<env>` job per environment with `deploy.auto`, `needs: verdict`, calling the reusable `stack-deploy.yml`
(`workflow_call`, which also keeps its `workflow_dispatch` for the owner's manual operations) with `with.environment`. A job that calls a reusable
workflow cannot bind a GitHub Environment, so the called job binds it (restricted to `v*` tags), reads that environment's `SOPS_AGE_KEY` and
opens the transport; R251 judges both halves. The deployment record sets no environment URL. The job assembles arguments only; the verb does the work:

```text
starci app stack deploy --env <env> --image <svc>=<ref>@sha256:<digest> ... --sha <sha> --ci-run <run id> --execute
```

`--ci-run` replaces the `requireCi` lookup inside a run that is still in progress: the CLI reads that run's jobs through
the API with the job's token and accepts only when every job the CI standard requires concluded `success` for this sha
(or the reused run named by `plan` is green), so editing the workflow to skip a check gains nothing. A job the app's own declaration idles is not required: the commit's
`.starcistacks/application-stacks.yaml` `gates` block, with `{run: off, reason}` for every gate of the job (`lint`, `test`, `coverage` with
`codecov`), is the same table the renderer idles the job by, so an app that declares those gates off is deployable from its own CI run. An
idled job that is in the run may not be red. A gate declared on stays required (missing or red blocks), and the floor stays
required whatever the declaration says: `plan`, `fast`, `build`, `verdict` (the harness's own gates hfs, secrets and db are never
switchable). The verb then runs
its phases, each one a recorded step:

| phase | does | on failure |
|---|---|---|
| lock | takes `/srv/<stack>/deploy.lock` on the manager (flock, held for the run; the owner's urgent deploy takes the same) | waits up to 10 minutes, then refuses `STACK_DEPLOY_LOCKED`; nothing changed |
| preflight | render and inspect locally, provision, store the release, pre-pull its images, and confirm the rollback target's images still pull | refuses; services untouched |
| idempotence | when the accepted release already has this `sourceSha`, prints `already current` and ends green | none |
| backup | when the migrate preview has pending migrations (always under the urgent floor): a fresh encrypted dump of the database, receipt verified, a test decrypt on the manager with its own identity (as root, over passwordless sudo where the login has it, else, for a deploy user with the docker group and no sudo, in a one-off container of the database image that sees only the identity, the archive and age, read-only and with no network: `manager-backup.mts` `decryptCommand`); the urgent path takes the same step in the same place | refuses; services untouched |
| migrate | `app db migrate` preview, then execute, inside the database service's own container through the Docker transport (expand migrations only) | refuses; services untouched; the applied part stays and the backup is its way back |
| deploy | `docker stack deploy` of the stored bytes; Swarm's `update_config` rolls a failing service back on its own | stack rollback |
| converge | desired against running, update state `completed`, no failed task of the new spec, twice | stack rollback |
| post-deploy | the declared idempotent release tasks | stack rollback |
| verify | the declared HTTP journeys and in-task checks (`deploy.verify`), health and readiness first | stack rollback |
| accept | moves `current`, keeps `previous`, prunes superseded secrets and configs | none (verified already) |
| contract | the release's `*_contract_*` migrations, only after accept (below) | red job, the release stays accepted; the owner decides |

**Rollback.** Two layers, because each catches what the other cannot. Swarm's own (`update_config: {failure_action:
rollback, monitor, max_failure_ratio: 0}`, required on every service by R266 and R294) acts within a service's monitor
window when a new task fails to start or its healthcheck fails ([deploy spec], [swarm services]); it restores only that
service's previous spec, one service at a time. The stack rollback restores consistency across services: it redeploys
the previous accepted release from its stored `stack.yaml` (with the secret and config versions it named), converges and
verifies it; a failure in functional verification, where every container is healthy but the journey is wrong, is caught
only here. The job ends red either way, and the record says `rolled-back` or `rollback-failed`.

**Rollback target.** The accepted release at the start of the deploy (the `current` pointer, never moved for a release
that did not verify). Preflight proves its images still pull, so a registry clean-up cannot strand a rollback. A manual
`rollback --release <id>` to an older one is refused when the database has applied a contract migration after that
release was accepted (the record knows both), unless the owner passes `--data-acknowledged`. Each attempt document carries `contract`, the
contract migrations that attempt applied; `stack rollback` (also as a dry run) refuses `STACK_ROLLBACK_CONTRACT` for a target older than the
previous release of an attempt that applied one, or that the journal never saw once any is recorded. The workflow's `rollback` dispatch has no
such input, so that case runs from the owner's machine.

**Notification.** The deploy job writes the outcome to the run's summary (release id, digests, each phase with its
verdict and time, rollback) and uploads `release.json` as an artifact. GitHub's own notification of a failed run reaches
the pusher. `deploy.notify` is per environment: `notify: {webhook: {member, key}, on?: [...]}` names a key of a sealed member holding an https
URL, and is off unless declared. After the journal closes it sends one JSON message (`text`, `content` and the facts as fields: outcome,
environment, stack, commit, tag, release, attempt, CI run URL, failure code) for `accepted`, `rolled-back`, `rollback-failed` and `failed` by
default (`refused` only when listed). A failing webhook is a line of the result, never a failed deploy, and the URL is never printed.
**The brake is a step.** An environment variable is not readable in a job's `if` before the job is bound to its environment, so
`STARCI_DEPLOY_PAUSED` is read by the first step of the bound deploy job; the later steps wait for it and the job ends green with a
notice in the run summary.
A red run is a red CI for the harness, which opens the fix (authority/ci.md).

**Strategy.** Rolling, health-gated, `start-first` for stateless services and `stop-first` for a service that mounts a
single-host volume, exactly as the stacks declare today. Blue/green is not adopted: Swarm has no native traffic switch,
and on a single VPS it doubles memory for the whole stack; `start-first` already gives an overlap with no dropped
requests for stateless services, and the stack rollback is the fast way back.

## Database migrations

The migration moves into the deploy, before the services update, under three rules.

- **Expand before deploy, contract after accept.** A release's ordinary migrations only add (tables, nullable or
  defaulted columns, indexes built concurrently, new functions): the previous release keeps working on the expanded
  schema, so a stack rollback after a migration is safe. Destructive DDL already lives only in `*_contract_*`
  migrations after the code stops using the target (BE-PERSISTENCE-19); the deploy applies them in the `contract` phase,
  after accept, and only when the previous accepted release's code no longer uses the target, which `app check --gate db`
  proves by refusing a contract migration that lands in the same release as the code change it depends on (a new
  migration finding, so an error finding).
- **No down migration runs by default.** A rollback restores service specs, never data (PROJECT-STACKS-6). An app has no
  down migrations. The backup taken before the migration, with its receipt, is the
  way back for data, and restoring it waits for the owner's yes, given with its loss window.
- **Backup only when something will change.** The preview runs first; with nothing pending there is no backup and the
  record says so. With something pending, the backup, its verified receipt and its test decrypt run under the
  `STACK_DEPLOY_BACKUP_*` codes. The archive stays on the manager, encrypted to the `.sops.yaml` recipients; copying it off
  the host remains the owner's job.
- **The safety steps run where the data is, whichever path triggered the deploy.** The urgent path runs these same
  database phases, the seed step and the contract pass, in the same place and under the same codes: a `stack` database is
  previewed and migrated inside its container and backed up, receipted and test-decrypted on the manager through the
  deploy's own ssh runner, so the operator's machine needs nothing beyond what the stack tooling already needs (no
  PostgreSQL client, no route to the database, no `DATABASE_URL`, no `SOPS_AGE_KEY_FILE`). Its one difference is the
  floor: the backup is taken even when nothing is pending. An `external` database is backed up where the deploy runs on
  either path.

The migration runs inside the database service's container through the Docker transport, the way the first start already
does (`inContainer`), so the database never listens beyond its stack network and CI never holds a `DATABASE_URL`. An app
whose database is outside the stack declares `database.target: external` and keeps `--db-url-env` with a sealed URL.

**First start.** A deploy of a `database.target: stack` database runs the first start when the database is empty: no
release was ever accepted, or the running database holds no migration history and no table in `public`, whatever release
was accepted before (`firstStartReason` in `stack/db-phases.mts`). The stack is deployed with every service but the database
at 0 replicas (a global-mode service held off every node), so no app service starts against the empty schema; the database
is proved empty again and migrated inside its own container (`db/bootstrap.sql` first); when the `database:` block names
`appPassword: { member, key }`, the app role (hfs.json `db.appRole`, default `app_be`), which the migrations create without a
password, gets that sealed value through psql on stdin inside the container, never in argv, a file or a printed line
(`STACK_FIRST_START_APP_ROLE` when it cannot, the value redacted); then the real stack is deployed and converged, with the
record, the rollback target, the readiness verify and the automatic rollback holding. A database that is not empty with no
accepted release is refused (`STACK_FIRST_START_NOT_EMPTY`), and a database whose recorded history the app's migration chain
does not explain, such as the chain an app replaced by a declared `db.baselineReset`, is refused at the preview
(`STACK_DEPLOY_DB_FOREIGN_CHAIN`). Emptying a database is the app's own operation, never a harness verb: an app may run
several databases, and the owner confirms it holds no data to keep; the next deploy then takes the first start.

## Secrets and access

- **Server key.** Each environment's server identity is the `SOPS_AGE_KEY` of its GitHub Environment (PROJECT-STACKS-5);
  only jobs bound to that environment read it. The images and check jobs read no secret beyond the Sonar token.
- **Transport.** The CI transport lives in one place, the sealed member of the environment
  `.starcistacks/<env>/secrets/vps-ci.enc.yaml` (`VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `VPS_HOST`, `VPS_USER`), opened with the server
  key the job already holds; GitHub keeps only `SOPS_AGE_KEY`, and the pinned host keys are reviewed in git. It is a key of its
  own and a member of its own, never the operator's `deploy.remote.sealed` member (`vps`) and never the owner's ops key: the two
  are separate SSH identities by design, and one member would hand the CI key the owner's. Both carry the SSH group keys
  (`VPS_HOST`, `VPS_USER`), which is no duplicate: transport members never reach an app container, so `ENV_DUPLICATE` judges app
  env only and exempts exactly those keys in exactly those two members (R248). The CI key is named by its comment so it can be
  revoked alone. `StrictHostKeyChecking yes` always; CI never accepts a new host key. `stack connect` masks the host, the account and the
  releases root in the log, and a missing member is refused `STACK_CONNECT_MISSING`.
- **Least privilege, honestly.** Access to the Docker socket is root on that host, so the CI key's line in
  `authorized_keys` is `restrict` plus a forced command, the managed `starci-ssh-gate`, that admits only
  `docker system dial-stdio` and the release store's fixed scripts. That narrows what a stolen key can run without a
  shell; it does not make Docker access less than root, and the runbook says so. Key creation and rotation stay
  owner-run steps. The release store's remote operations (`stack/ssh-gate.mts`) are named scripts (`pointer`, `list`, `read`, `store`, `accept`,
  `lock-acquire`, `lock-refresh`, `lock-release`, `journal-write`, `journal-index`, `journal-read`), each with arguments of a closed alphabet. The
  key's line is `restrict,command="starci-ssh-gate",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc <key>`; the gate admits
  `docker system dial-stdio` and `starci-op <name> <args>` and refuses everything else with exit 126 and no echo. The owner's key runs the same
  bodies through `sh -c`, so the gate admits no script the store does not run. `starci app stack ci-key --env <env>` prints the owner-run steps,
  `--print-gate` the gate text and `--public-key <file> --print-authorized-keys` the line. The gate is used only when the sealed `vps-ci` member says
  `VPS_GATE: "1"` (`connect` then exports `STARCI_SSH_GATE=1`). Not admitted by the gate: the post-deploy tasks (`task.mts`) and the manager backup
  and test decrypt of a `database.target: stack` database (`manager-backup.mts`) run `docker exec`-style scripts over ssh, so an environment that
  uses them keeps an ungated key until they are named operations.
- **Public repository.** GitHub-hosted runners only, never self-hosted. A sealed `.enc` is public ciphertext: the age keys and the CI private key
  never enter the repository. No secret is baked into an image (build arguments are public values), `main` is protected, the `v*` tags are
  protected and never moved or deleted, and `pull_request_target` never runs a pull request's code.
- **Registry.** Pushes use the job's `GITHUB_TOKEN` with `packages: write` on the images job only; the manager pulls
  with `--with-registry-auth`, which forwards the deploy job's short-lived login, so no registry credential lives on the
  server. A private registry other than GHCR is a declared service with its credential as a CI secret of the environment.
- **Nothing is printed.** Every value reaches a step through `env:`, members are materialized into a private temporary
  directory removed on exit, post-deploy and verify output carries names and counts only; the existing R251, R296 to
  R298 checks keep holding.
- **GitHub Environments.** Each deployed environment restricts its deployment refs to tags `v*`. Required reviewers are
  not part of the default: the deploy follows the green pipeline, and on the Free, Pro and Team plans
  a private repository cannot have required reviewers or a wait timer at all ([environments]). An environment variable
  `STARCI_DEPLOY_PAUSED=true` stops automatic deploys of that environment without a code change, and the dispatch still
  works; an app that wants a human gate sets `deploy.approval: reviewers` and the environment's reviewers.

## Gates

### Gate levels

The owner's rule: "rules là k check nhánh khi dev, khi nào push mới check tổng 1 lần sửa 1 lần vẫn hơn". A landing on dev runs the FAST level once per push. The main cut runs the FULL level once,
and what it finds is fixed once, in a hardening lane before the cut. `app check --level dev|full` (default full) picks the
level; the target decides which one a push gets.

| Level | Runs on | Gates | Skips |
|---|---|---|---|
| dev (fast) | a push whose every ref is `dev` or `lane/*` (the managed pre-push hook), `app push` of such a target, `lane gate` (and its `--land` re-check after dev moved: codegen and typecheck only) | the deps check (dev-local pins allowed where declared), types with its package builds and codegen, the lane's own tests (the changed specs and those whose closure reaches a changed file), db | the hfs rule sweep (structure, machine, unused-symbol, contract-emit, secrets), the rule-188 first audits and the ui-audit stale and missing blocks, the project and nivoos package checks, the whole test suite and coverage, lint, format, wiring, sonar, the CI build and the audit |
| full | a push of `main` or a `v*` tag, any other branch, `release cut`, `release push`, `app release` (its `app-check` row) | every gate: every hfs rule, the first audits of every screen changed since the last main, the full test suite and coverage, sonar, the CI parity families | nothing |

The fast level prints one line first naming what it skips and that those gates run at the main cut. One pass per push: a green
fast run on a clean tree is remembered by its content (outside `.starcistacks/cache`), the env, the harness version and
`origin/dev`, beside the repository's git objects, so the hook of the push that follows a gate (the lane's push, then its landing's push of dev) does not run it again.
The design approval stays at dev because it is a product decision. screen.yaml and audit records may be completed at the main cut.

Each landing is ONE commit on dev, and a newer push of a lane cancels the lane's
running local gate (the new gate prints `superseded by <sha>`).

- **Branch and tag rules.** `main`: no force push, no deletion, updates only by the owner and the release push; a pull
  request needs the `verdict` check. Tags `v*`: creation only by the same, never moved or deleted. The canon pre-push hook
  stays the local guard; the rules are the server's.
- **Required to deploy.** The `verdict` job: every required check job green for the sha (or the reused candidate run),
  the images pushed, and `--ci-run` evidence accepted by the CLI. Any error finding (plaintext secret, boot proof, migration
  finding, a forged cache record) fails its job.
- **The urgent path.** `starci app stack deploy --env <env> --urgent --reason "<text>" --execute` from the owner's machine
  is the urgent release, a feature: no CI, only the checks that can break production, and a safety floor that is never
  skipped. With no `--image` and no `--sha` it releases HEAD, adopting a tag already on it, unless HEAD already has a pushed
  urgent record: it runs typecheck and the build (the release gates `typecheck`, `build`, `build-be`, `build-fe` the
  app declares; a green row already recorded for the commit is reused), and only once they pass tags, pushes and writes the
  URGENT record (the role, the reason, each check's verdict, the commit); a tag pushed by hand carries none, and a record is
  never written by hand. It builds and pushes the images on the operator's machine before the transport reaches the server
  and deploys their digests. `app check`, lint and the tests wait for the back-fill. The record satisfies `requireCi` for
  `deploy.prod` and `release.cut` when the caller passes `--urgent`; the floor still runs and refuses with its own code when
  a step fails: the rollback target, then the deploy's own database phases (Database migrations below) with a fresh
  encrypted backup taken always, made, receipted and test-decrypted on the manager for a `stack` database (or, on an
  empty database or under `--first-start`, the first start: the proof that the database is empty, every migration and the
  app role's sealed password), the expand migrations, the seed step after convergence (PROJECT-STACKS-12), the readiness
  verify, the automatic rollback and the contract migrations after the accept. It is auditable on the server side too: the tag annotation carries `Starci-Urgent: <role>` and
  `Starci-Urgent-Reason: <text>` trailers (written by `release push --urgent`), the manager's deploy record carries the
  same, and the back-fill runs the full gate on the same commit, as the tag's CI run or `starci app check --release --backfill
  <tag>`: green promotes the record to a normal L4 with no re-release, red opens a `verify` ticket (a red CI the harness
  fixes) and changes nothing on production, and the tag run's deploy job finds the sha already current and does nothing.
  The manager lock serialises the urgent deploy with any CI deploy.
- **Owner approval.** Deploying waits for the owner's yes (hard rule 5): for an environment with
  `deploy.auto: true`, the owner's yes is given once, by that setting, and each release push that turns green deploys.

## Records

Today the manager holds `releases/<id>/{stack.yaml,release.json}` and the `current` and `previous` pointers, and nothing
else: a failed deploy leaves no trace there, a service that Swarm rolled back by itself still reads as the new release,
and a manual `docker service update` is invisible. The fix:

- **A deploy journal.** `/srv/<stack>/deploys/<attempt>.json`, one per attempt (time, trigger `ci|dispatch|urgent`,
  sha, tag, CI run URL or urgent role and reason, release id, previous, each phase with start, end and verdict, the
  backup receipt and migrations applied, outcome `accepted|rolled-back|rollback-failed|refused`), plus an append-only
  `deploys.jsonl` index. Written at every phase boundary, so a cancelled job still leaves its last phase.
- **What runs.** After converge, after a rollback and on accept, the verb snapshots `docker service inspect` of every
  service of the stack (spec image digest, update state, task template hash) into the attempt, and `release.json` gains
  `observed`. `starci app stack status --env <env>` (read-only) compares the live services with the accepted release and
  prints drift per service (`rolled back by swarm`, `updated outside a release`), which `stack verify` also fails on.
- **Pinned digests.** The release record and its stored `stack.yaml` name every image by digest, the third-party ones from
  the stack file and the built ones from the images job; the tracked `release/images.lock.yaml` keeps listing which are
  bound per release.
- **Retention.** The manager keeps the last 10 attempts' releases and every accepted one in the last 30 days; the registry
  keeps every digest a kept release names (a managed clean-up job deletes other `sha-*` versions older than 30 days).

## Sources

- [deploy spec]: Compose deploy specification, `update_config` and `rollback_config`, https://docs.docker.com/reference/compose-file/deploy/
- [swarm services]: Deploy services to a swarm, rolling updates and rollback, https://docs.docker.com/engine/swarm/services/
- [buildx gha]: GitHub Actions cache backend, https://docs.docker.com/build/cache/backends/gha/
- [environments]: Deployments and environments, https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- [concurrency]: Control the concurrency of workflows and jobs, https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

## Read with

[check-cache.md](check-cache.md) (which run is diff-only and which full, and the trusted base), [stacks.md](stacks.md)
(environments, custody, the operations and their safety rules), [authority/ci.md](../authority/ci.md), the `app stack`
and `app release` usage of `@starci/hfs`, and [policy/quality.yaml](../../policy/quality.yaml) (`requireCi`).
