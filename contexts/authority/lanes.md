# Lanes

A lane is one session (a chat agent or an Orca seat) working one branch `lane/<lane>` in its own worktree of an app, cut from the
app's integration branch (`dev`, [project/branches.md](../project/branches.md) PROJECT-BRANCH-1). Many lanes share one host and one
lanes folder. A lane brief is this file plus the task: read it, then call the verbs below. A lane never writes its own lock,
slot or landing script; every step that coordinates with other lanes is a verb.

## The lane's name and its folder

- **Name.** Set `STARCI_LANE=<lane>`, or work on the branch `lane/<lane>`; every verb below reads it from there (`--lane` overrides).
  A verb that cannot tell the lane refuses `SLOT_LANE_UNSET`, so no slot names a lane that does not exist.
- **The lanes folder** (land status, the dev lock, run records, and the foreign slot lock files older copies left): `--dir`, else `STARCI_LANES_DIR`, else
  `slots.root` of `ops/slots.yaml` (`starci config set slots.root <dir>`), else `<harness state>/slots`. The coordinator sets it once per host. The slots
  themselves are rows of the host store, the same from every folder.
- **The CLI** is the worktree's own, `node_modules/.bin/starci` after its install, so the judge is the harness the app pins. A
  global or another checkout's CLI reports false pin drift. `HFS_CLI_HFS_SKEW` means reinstall, never `STARCI_ALLOW_CLI_SKEW`. A harness
  lane is gated by the CLI build the coordinator names (a `_cli-<sha>` worktree of the harness); `lane gate` warns at its start when that build
  lacks commits of dev that change cli/, ops/ or policy/, since it would judge by rules dev no longer holds.

## Slots

The owner's rule, in his words:

> "phải nhả slot khi xong việc, phải mapping 1-1 để kill process nếu cần biện pháp mạnh tay"

Every slot maps 1-1 to the OS process doing the work, is released the moment that work ends, and can be killed through, its whole process tree, as a last
resort. Every slot of the host is a row of ONE store, machine.sqlite, that every CLI copy resolves alike from any folder ([cli/README.md](../../cli/README.md)
"Machine-wide slots"), so `slot list` shows the same slots from a lane, the lanes folder or an app.

Two layers bound the host's work. The heavy-command governor ([cli/README.md](../../cli/README.md) "Heavy-command governor") is the owner's
rule (2026-11-26), in his words:

> "bỏ mấy luật như còn trống bao nhiêu, đơn giản có 16 slots cứ chiếm được và làm xong trả job thế thôi, vì chắc chắn sẽ dư ram"

and of the commit floor: "bỏ cái này đi, đang chiếm thì chạy luôn"; of the weights, his choice: "Theo độ nặng 1/2/3". The host has one heavy slot unit
per `gbPerSlot` GB of its physical RAM (`heavy.gbPerSlot` of the host's config.yaml, absent 4: 16 on a 64 GB host, 32 on 128 GB), never a fixed number,
and each heavy command holds its weight while it runs, whichever checkout or installed CLI starts it, and gives it back when it ends: an install or a
build 1 unit, a tsc or an ESLint chunk 2, a test run or an app build 3 (its planned MB in units, at most 3), so the units bound the planned memory of all
that runs; admission is enough free units, first come, first served. A gate that runs several in turn takes each step's units as it starts, and a
running web or api server takes none. No free-RAM, free-commit or seat-memory rule holds anything. The one floor
kept: nothing starts while the drive has under the host's disk floor free (`host.diskFloorMb` of config.yaml, else `heavy.diskFloorMb`), since a full drive
corrupts git and the sqlite stores; the per-kind heap caps stay too, as process limits (`--max-old-space-size`), never admission. The lane slots of
`ops/slots.yaml` coordinate the lanes themselves: `npm` (an install), `gate` (a full `app check` or a push), `shoot` (a shot or a look), `stack` (the shared
stack and its main checkout). Early in every `lane gate`, while the drive still has room, a warning shows when the lanes
drive has under `host.diskWarnMb` free (config.yaml, else `heavy.diskWarnMb` of ops/liveness.yaml, 50 GB; never under the floor): it lists the landed lanes whose
worktrees can be removed and the command that removes each, and deletes nothing (cli/src/harness/disk-warning.ts). Each kind has a count, every slot of it open whatever
the host's free memory.

| verb | does |
|---|---|
| `starci slot run <kind> -- <command...>` | holds a slot for exactly the command's life, recording this process and the command's own pid as its child; npm and npx run through the governor |
| `starci slot take <kind> --pid <pid>` | holds a slot until released; `--pid` names the long-lived process it belongs to (in Git Bash, `$(cat /proc/$$/winpid)`) |
| `starci slot release <kind>` | releases the lane's own slots, each only once read and found to name the lane |
| `starci slot list [kind\|heavy] [--events N]` | every lane slot (lane, pid, child, age, command, alive, state, reclaimable) and every heavy slot (id, units, pid, child, age, command), from any folder |
| `starci slot release <kind\|all> --stale` | reclaims every slot whose holder is proven gone |
| `starci slot kill <kind> <n> [--execute]`, `starci slot kill heavy <id> [--execute]` | the last resort: kills the process tree of the one process the slot maps to and frees the slot |

- **Prefer `slot run`.** A slot held by a command cannot outlive it; `slot take` is for a step that spans several commands.
- **Release only your own.** A slot is removed only after it is read and names your lane; another lane's slot is never deleted by hand.
- **Every slot records its process.** A row names the lane, the pid it lives as long as and that process's start, the host boot, the command and, once
  spawned, the child doing the work. A take refuses (`SLOT_PID_REQUIRED`, `SLOT_START_UNKNOWN`) without a live pid whose start the OS reports; `slot take`
  needs `--pid`. A script of an app never writes a `_npm-slot-*.lock` itself: it calls `starci slot run npm -- <command>`.
- **Released when the work ends.** A slot held by `slot run`, `lane gate`, `gallery shoot` or `app look` is deleted in a `finally`, on SIGINT, SIGBREAK, SIGHUP
  and SIGTERM and on `process.exit`, step by step: `lane gate` takes its npm slot for the install and its gate slot for the check, never across steps. On
  Windows a process killed outright (`taskkill /F`, `process.kill`, a dead parent) runs nothing: its row records its pid, and the next take or list reclaims it
  as `dead` at once.
- **Reclaim only on evidence.** A take, or `slot release --stale`, reclaims a slot only when its holder is proven gone: its pid is not alive, its pid runs a
  process started at another time, or the host booted after it was taken. Each reclaim is logged with its evidence in `slot_events` (`slot list --events N`).
  Age is never evidence: a slot past its kind's `warnMinutes` is listed `old`, and the coordinator asks its holder.
- **Kill by slot, as a last resort.** `slot kill <kind> <n>` (a lane slot: its holder's tree) and `slot kill heavy <id>` (the heavy command's tree, else its
  holder's) print what they would kill; `--execute` kills it, frees the slot and logs the pid, child, command and evidence in `slot_events`. They refuse a free
  slot, a pid that now runs another program (`SLOT_KILL_REUSED`) and a holder whose recorded start cannot be matched (`SLOT_KILL_UNPROVEN`); a holder already
  dead is not killed, its slot is reclaimed. Kill only a slot whose work must stop; never one of a live lane you were not asked to stop.
- **One slot per lane per kind.** `slot take`, `slot run` and `lane gate` return the slot the lane already holds when its process is the taker or one the taker
  runs under, so a retried gate never takes a second one; while another live process of the lane holds it, the take waits.
- **Foreign lock files.** A lock file in a lanes folder (`<root>/_npm-slot-1.lock` and the like), written by a CLI copy older than the store or by a script, is
  foreign: never written, read in every lanes folder any CLI copy of the host was named (so from any working folder alike), honoured as holding its
  number for every taker while its holder is not proven gone, listed with its path, released with its lane
  and reclaimed on proof. A line with no pid (`<lane> <time>`) is reclaimable (`gone`) once its lane is proven gone: the process table is
  read, and no process works inside the lane's worktree (its working folder or command line lies in it) or names the holder in its command line, and either no worktree
  of the repositories under the lanes folder exists on disk whose folder is `<lane>` or which has `lane/<lane>` checked out (where the lanes folder holds no repository,
  `_land-status/<lane>.json` saying `landed` stands in) or that worktree has no live process. A holder name ending in `-<pid>` whose pid is alive and started before
  the lock keeps it held; a dead suffix pid proves nothing (a lane may be named `h-x-390`). Taken before this boot is `rebooted`. Otherwise the lock is held,
  `slot list` prints `not reclaimable: <why>` for it (the process that works there, or that nothing was read about its lane), and it is `old` past `warnMinutes`.
- **A lane lets go of its slots.** `starci lane remove` releases every slot the lane holds, of any kind, as part of the removal (its dry run lists them;
  `--dir` names the lanes folder whose foreign locks of the lane go too). Each release is logged in `slot_events`.
- **Never hold a slot while you wait** for a review, an audit or another lane; take it for the run, then let it go.

## The shared stack

The shared stack of an app (its dev database, its running api, its main checkout) belongs to the coordinator and the dev refresh.
A lane never runs `stack up`, never applies a migration to the shared database, never edits or installs the main checkout, and
never starts a second api against the shared database. The one exception is a coordinator hotfix ("Hotfix" below), which edits the main checkout in place
while it holds the dev lock. Whoever is allowed to touch it holds the `stack` slot for the whole of it
(`starci slot run stack -- <command>`), leaves the main checkout fast-forwarded to the remote integration branch, never to an
unpushed lane commit, and releases. A migration a lane adds is additive and applied by the refresh once landed.

## Gate and land

The gate judges the tree once per push, never the branch while a lane works, and a newer push cancels the older run.

A lane lands on dev, so every gate of this section is the FAST level, `app check --env prod --level dev`, once per push: the deps
check (local-registry pins allowed where hfs.json declares `deps.devAllowsLocalRegistry`), types with its package builds and codegen,
the lane's own tests (the unit specs its diff touches and the ones whose closure reaches a changed file), and db (a screen's design needs no
owner approval, owner decision 2026-11-25). The hfs rule sweep, the rule-188 first audits, the ui-audit
stale and missing blocks, the nivoos package checks, the whole test suite, sonar and coverage run once at the main cut
(`--level full`); a red full run is fixed in a hardening lane before the cut. screen.yaml and audit records may be completed there.

One verb gates and lands (PROJECT-BRANCH-2):

1. `starci lane gate --push --land` in the worktree, tree committed: it merges `origin/dev`, installs under an `npm` slot when
   the merge changed a manifest or lockfile (`--install` forces a full `npm ci`; a fresh worktree is installed by the shared install below), runs `codegen` (and `build:modules` after an install), then
   under a `gate` slot the app's own `app push origin HEAD:lane/<lane>`, whose pre-push hook runs the fast level once. Without `--push`
   it runs `app check --env prod --level dev` only and reports the findings. A new `lane gate` of the same lane first cancels the lane's
   running gate: its process tree is killed, its slot released, and the new gate prints `superseded by <sha>`. A merge conflict refuses
   `LANE_GATE_CONFLICT` with its files: resolve, commit, run it again.
2. Green and pushed, `--land` lands the lane at once as ONE squashed commit on `dev`, under the repository's dev lock, re-checked only when
   dev moved since the gate, never forced: the rule, its refusals (`LANE_LAND_CONFLICT`, `LANE_LAND_RED`, `LANE_LAND_PUSH`) and its enforcer are
   [project/branches.md](../project/branches.md) PROJECT-BRANCH-2, stated there once.
3. After the push the landing stands, and what follows is reported, never thrown: the lane's status file (`<lanes>/_land-status/<lane>.json`,
   `starci lane status <lane>`) reads `landed` with the dev `sha` and the `migrations` it added; a harness landing that changed a published
   package publishes the dev line (`deps publish-dev`); and the app's dev checkout (`devSync.repos`), or after a harness publish every app's, is
   marked for its debounced sync (`starci dev sync-runner`, [project/cicd.md](../project/cicd.md) "The debounced dev sync"). A lane never runs
   the sync of the shared checkout itself.
4. The landing starts the watch of the pushed sha's GitHub CI, detached so nothing waits for it (`starci lane ci-watch <sha>`,
   cli/src/harness/dev-ci-watch.ts). The watcher reads the push runs of the sha
   (`gh run list --commit`) until they settle or `ciWatch.minutes` (45) of the local settings passes, and writes the verdict (`green`, `red`,
   `superseded` when a newer push cancelled the run, `pending` past the limit, `none`, `unreadable`) into `<lanes>/_land-status/_dev-ci/<sha>.json`
   and the `ci` of each landed lane's status. A red verdict is printed loudly in its log (`_dev-ci/<sha>.log`) and sent to the coordinator
   session `ciWatch.notifySession` names (`claude -p --resume <session>`) when one is set. It never reverts, blocks or pushes dev: a red dev
   is fixed by a lane. The watcher stands in the repository's main checkout, never in the lane's worktree.
5. Last, once dev is pushed, the lane's worktree is removed to save disk, the branch kept, local and remote
   (`cli/src/harness/land-cleanup.ts`): the same removal as `starci lane remove` (its removal lock, links unlinked as links, a lstat-checked
   delete) behind the install janitor's in-use guard, and only when the push succeeded. The command runs inside the worktree, and Windows cannot
   delete a folder a live process stands in, so it first leaves for the main checkout (`process.chdir`) and removes in-process. The guard keeps
   the worktree when a removal lock, a slot of the lane or a git operation holds it, a process works inside it, it holds uncommitted work or its
   branch has commits after the landed sha; the check-cache records under `.starcistacks/cache/` are no work and are discarded. `--keep` skips the
   removal (a lane that keeps its worktree to look at dev removes it afterwards with `starci lane remove <worktree> --execute`; an app lane and a harness lane are
   treated alike, and a worktree kept only because a process of the moment works in it leaves a marker too). Stale generated contexts files are no work; a worktree with
   other uncommitted changes is kept, and the printed line names the files and the path. A node_modules delete that hits EBUSY, EPERM or ENOTEMPTY (an antivirus scan, a shell standing in the folder) is retried with
   backoff (6 attempts, 0.5 s doubling to 8 s); if it still fails the verb leaves a marker (`<lanes>/_land-cleanup/<lane>.json`), the landing
   stands, and the next `starci lane remove <worktree> --execute` (which clears it) or `starci lane prune-installs --execute` (the janitor sweeps
   the markers with the same guard) finishes it. The verb prints one line, `worktree removed` or `kept: <reason>`; it never changes the exit code.

`starci lane status` prints the dev lock and each lane's landing status.

**A harness lane** (a worktree of the harness repository itself, [project/branches.md](../project/branches.md) PROJECT-BRANCH-3) runs the same verb.
`lane gate` picks the harness profile there (or `--profile harness`): it merges `origin/dev`, installs nothing at the root, runs under the
gate slot the harness FAST gate `starci check --level dev` (the install, build and typecheck of the packages the lane changed and of their
dependents, the CLI and the desktop app when affected, the publish checks, and the `npm test` of each of those packages that declares one, as CI's
`package (...)` jobs run it; the typechecks of those folders run together, each `tsc` on its own heavy slot, and each package test takes a heavy `test` slot; the CLI's
own suite runs only in the train's full gate: [project/branches.md](../project/branches.md) PROJECT-BRANCH-3 item 2). A red package test refuses the gate with
`HARNESS_GATE_TEST`, the failing test names and the run's last lines, before anything is pushed; with `--push`
pushes `lane/<lane>` with git once it is green (first committing the harness check cache records the gate wrote, [harness/check-cache.md](../harness/check-cache.md), so a re-gate or another lane reuses them), and with `--land` lands it on the harness's `dev` with `git push`. Before that gate the lane's own tree is brought up to the generator: `lane gate` regenerates the
generated contexts files (`contexts/project/index.md`, anatomy.md's block and slices, every `*-sections.md`: what `starci contexts anatomy --execute` writes, and
what the train's full gate compares) and commits those that changed with the lane (cli/src/harness/lane-generated.ts), so a lane that edits a page never lands a
stale size line. `contexts anatomy --execute` writes into the harness of `--cwd` (else of the working folder), never into the checkout the CLI was built in.

**The install of a fresh lane is shared.** When the lane's lockfiles and manifests equal those of a reference install, its `node_modules` is made
by hard links from the repository's install cache (`<lanes>/_install-cache/<repo>/<key>`, keyed by the bytes of every lockfile, manifest and
`.npmrc` and by the Node and npm versions) instead of `npm ci`: the entry is filled once per key by COPYING the app's dev checkout's install when that
checkout holds a finished one with the same key, else from the first lane's own `npm ci` of the dev line's lockfile. The dev checkout is never a link
source (the running dev stack serves from it, and a write through a hard link would change a served file), and a later `npm ci` there removes names, so
no lane or entry is touched. npm's record (`node_modules/.package-lock.json`) and the `.bin` shims, which npm rewrites in place, are copied; a tool's
`node_modules/.cache` is not shared; the workspace links are junctions re-made to the lane's own folders and unlinked first when the worktree is removed.
The root lifecycle scripts of `npm ci` (`prepare` for husky and the like) run after the links. A differing lockfile, a node_modules already there, a
workspace member with an install script, a link or a removal lock on the worktree, a failed link or a failed check of the result send the lane to
`npm ci` and leave nothing behind. `STARCI_SHARED_INSTALL=off` turns it off, `copy` fills by copying. The gate prints where `node_modules` came from
and the seconds each phase took.

A lane never adds an hfs exception (that needs the owner: stop and report), never uses `--no-verify` and never force-pushes; the
pre-push hook needs `.husky/_` present. Before every commit run `git diff --cached --stat`.

## Hotfix

The owner's rule, in his words:

> ".claude thêm 1 phần là hot fix, ví dụ không cần mở lane thì fix thẳng ở chat và restart dev lại luôn hiểu không? trừ khi việc fix quá nặng. xác định rõ scope."

> "hotfix là sửa xong chạy lại luôn, không gate gì hết"

A hotfix is a small fix the **coordinator** makes directly in the app's dev checkout from the chat, with no lane and no worktree, landed on dev and restarted at
once. It is coordinator-only (`owner`, `coordinator`): a subagent, a worker or an Orca seat never runs `starci hotfix`; it works in a lane.

| | a hotfix | a lane |
|---|---|---|
| who | the coordinator, in the chat | any lane agent, in its own worktree |
| where | the app's dev checkout, edited in place | `lane/<lane>`, a worktree |
| size | at most 5 files and 200 changed lines (added plus deleted), one repository | no limit |
| gate | none: no typecheck, hfs, secrets or spec | `lane gate`, the fast level |
| lands | one `Hotfix:` commit pushed to dev at once | `lane gate --push --land` |
| dev | restarts right away | the debounced sync |

**Scope.** The limits are `ops/hotfix.yaml` (`maxFiles`, `maxLines`), the owner's. Adding, editing and deleting files, a migration, a lockfile and a schema are all
allowed inside them. A change over either limit is refused `HOTFIX_SCOPE` with "quá lớn cho hotfix (N file / M dòng), mở lane" and goes through a lane. Typical
hotfixes: a copy or i18n string, a CSS value, a one-line logic bug, a seed typo, a config value. A hotfix is the wrong tool when the fix needs thought: open a lane.

**Use.** Edit the files in the dev checkout (an app's main checkout, or `D:/.claude` on `dev` for the harness; the CLI that runs it is the machine's
`_cli-current`, never the checkout's own build), then:

1. `starci hotfix status [--only <path>...]` (reads only): the files and lines against the limits, tracked changes outside the hotfix, whether the restart is light or full, the dev lock and whether a dev sync runs.
2. `starci hotfix land --message "<what it fixes>" [--only <path>...] [--health-url <url>] [--dry-run] [--profile harness]`.
3. `starci hotfix abort [--only <path>...] [--execute]` gives the checkout its HEAD back instead (tracked files restored, named new files deleted; dry until `--execute`).

`--only` names the hotfix's paths (a folder ends with a slash). Without it every tracked change is the hotfix and no untracked file is: a stray file of the checkout is
never swept in, so a NEW file lands only when `--only` names it. With it, a tracked change outside the list refuses `HOTFIX_FOREIGN` (nothing is committed) and a named
path with no change refuses `HOTFIX_ONLY_UNCHANGED`. The harness checkout holds other work, so `--only` is required there (`HOTFIX_ONLY_REQUIRED`). The files dev sync's local overlay rewrote (the manifests
its `install-local.json` record names and their lockfiles) are sync-owned: a hotfix neither takes them nor refuses them as foreign, and never commits them.

`hotfix land` judges only the size. Under the dev lock (the one `lane gate --land` takes) it refuses `HOTFIX_SYNC_BUSY` while a dev sync of the
checkout runs, makes ONE commit with a `Hotfix:` trailer, rebases it onto the newest `origin/dev` (a conflict puts the edit back and lands nothing) and pushes
`dev`, never forced. Then the stack restarts through `dev sync` told where the checkout was before the hotfix: **light** (only the api and/or web the change
reaches, no install and no prepare) or, when a lockfile or manifest, a migration, a schema or a workspace package changed, the **full sync steps** (npm ci,
build, migrate); the output says which and why. It waits for `--health-url` to answer 200 (without it, the restart's own health wait stands) and starts the CI
watch, which judges the commit after the fact; a red CI is the cost of skipping the gate and is fixed forward, never reverted. A failed restart or health wait
does not undo the landing: it is reported and the exit is red.

**What follows the push depends on the repository kind** (`--profile`, by default `harness` in the harness checkout, else `app`):

| | an app repo (NIVO, StarCi Next, ...) | the harness (`D:/.claude`, `--profile harness`) |
|---|---|---|
| the checkout | the app's main dev checkout, on `dev` | `D:/.claude` on `dev`; the commit is rebased onto `origin/dev` first |
| after the push | an immediate `dev sync` of the checkout, light or the full steps | nothing is a dev server, so: (1) the CLI copy is rebuilt |
| | | (2) `deps publish-dev` when the hotfix changes a package the apps consume |
| | | (3) every app of `devSync.repos` syncs at once, after a publish only |
| health | `--health-url`, else the restart's own wait | each app's sync prints its restart and health |

*App repo.* The restart is `dev sync` told where the checkout was before the hotfix (`since`): light, or the full sync steps when a lockfile or manifest, a migration, a
schema or a workspace package changed, the output saying which.

*Harness.* (1) When the hotfix touches `cli/`, `ops/`, `policy/`, `contexts/` or `skills/`, a new `<lanes>/_cli-<sha9>` worktree of the pushed commit is made (`git worktree
add --detach`, `npm ci` and `npm run build` in its `cli/`, under the heavy governor) and the junction `<lanes>/_cli-current` is repointed to it by renaming a new junction
into place, so the next command of the machine runs the hotfix; a failed build leaves the junction where it was and the exit is red, and old copies stay for the janitor.
(2) When the hotfix's own files change a package the apps consume (a package folder, `cli/`, `ops/` or `policy/`; never `contexts/`, `skills/` or Markdown, which
no app runs), the dev line is published (`deps publish-dev`: `X.Y.Z-dev.N` of each changed package and of every package that pins one, never a committed pin); a docs
or contexts hotfix publishes nothing and restarts and syncs no app, and says so. A package whose dev build fails is printed with its cause and the exit is red, while
the packages published beside it still reach the apps. (3) After a
publish, every app checkout of `devSync.repos` gets an IMMEDIATE sync with no debounce, the same marking `--land` makes after a harness publish; each app's machine
overlay (`devSync.local`) installs the new dev build, so the change shows on every app's dev within minutes without changing any app's committed pins. The output lists
each app's sync and its restart result.

**The dev checkout stays sync-owned** (only `dev sync` and a landing move it), **except during a coordinator hotfix**, which holds the dev lock from its first
step to the end of the restart and is the only thing that edits the checkout in place.

**Hotfix is the only path that skips the pre-push gate.** The skip lives in the CLI: while `hotfix land` pushes its one commit it writes a pass beside the
repository's git objects (`core/hotfix/pass.ts`), and the fast-level check the pre-push hook runs reads it. The pass covers exactly the push of that commit to `dev`
alone, while that `hotfix land` process lives and for at most 10 minutes; there is no flag, variable or setting for anything else, and an agent never skips a
gate any other way. An app whose pinned `starci-harness` predates this build still runs the fast level on a hotfix push, which is slow but correct: bump the pin.

## Shots and looks: the one web and one api server of the app

The owner's rule, in his words:

> "chốt vậy chỉ có 1 next server fe chạy thôi, lane xong f5 lại, chấp nhận giật ở fe"

> "Tương tự 1 be server"

Each app runs ONE web (Next) server and ONE api server (with its workers, one stack): the shared dev stack's. A lane never starts a web or api
server of its own to look or to shoot. It lands, the dev sync brings the change into the shared checkout, and the lane looks at the running
dev stack: `starci app look` (PROJECT-GALLERY-7 step 2b, real data, a `shoot` slot) or `starci gallery shoot --port <the dev stack's web port>
[--ready-url <api health>] -- <the app's capture command, {url}>`, which waits for the api and a `shoot` slot, refuses when nothing listens on
the port (`GALLERY_SHOOT_NO_SERVER`) and never starts a server. The owner refreshes the page (F5) after a land and accepts a brief flicker.
Shoot every screen you need in one go. Screens, sizes (1440 and 390) and what a shot records are the app's gallery rules
([project/gallery.md](../project/gallery.md)). A shoot or look is recorded as a harness run, so one whose caller died is stopped by the reaper
with its browser.

A back-end change that truly cannot wait for a land to be seen runs its api only under `starci slot run stack -- <the api command>`, a job of
its own, recorded and reaped with its caller; a lane never runs a second web server. On the stack itself, `app stack up` keeps one copy of each
process: a recorded process whose port went silent is stopped before a fresh start, a port some other process already listens on refuses
`STACK_LOCAL_SECOND_COPY`, and the on-demand processes (the gallery, or any process declaring `onDemand: true`, a landing) start only with
`--with <name>`. `starci dev sync` builds the changed side and restarts it (`next start`, `node dist/...`), so each land restarts the changed side once.

`starci app look --env dev --paths <route,…> [--workspace <id>] [--widths 1440,390] [--out <dir>]` is the step 2b look of
PROJECT-GALLERY-7: against the RUNNING dev stack (it starts no server and refuses LOOK_DEV_DOWN when the declared web or api does not answer),
under a `shoot` slot, signed in as the app's seed owner the way the app's `gallery/look.json` declares (the password read from the app's
secret custody, never printed), in the installed Chrome. It writes the PNGs and `index.json` (route, width, time, the sha the dev checkout
runs) into `.starciwork/evidence/look/<stamp>-<env>/` of the app (git-ignored), or `--out`; a shot that landed on the sign-in page or
answered 4xx/5xx is listed and the verb exits 1.

## Processes and cleanup

- Kill only processes you started, by the pid you recorded; never by a command-line pattern (`node`, `next`, a script name),
  which other lanes run too. The verbs above stop what they start.
- **Orphans are reaped.** A run the harness starts for you (`slot run`, `lane gate`, `gallery shoot`, `app look`, `app check`) records its
  launchers in `<lanes>/_runs/`; once its launcher (your shell, or the agent above it) has been gone `reap.graceMinutes` of `ops/slots.yaml`,
  `starci ops reap --execute` stops its process tree and logs it in `<lanes>/_reap.log`. Keep the launching shell alive
  for the run's life; a run started detached on purpose is reaped too. A process the harness did not record is never touched.
- **Installs go back to the drive.** `starci lane prune-installs` deletes the reinstallable folders of a landed lane's worktree
  (`janitor.dirs` of `ops/slots.yaml`: node_modules, .next, dist, .turbo, and a failed safe install's `.starci-trash-` folders), links unlinked
  first and never deleted through, the worktree, its branch and its tracked files kept, unless the worktree is live (a slot of the lane, a
  removal lock, a git operation, a process working inside it, uncommitted work, commits on its branch after the landed sha because the lane moved on to a follow-up, or a touch within `janitor.touchedMinutes`, default 60). `starci lane prune-installs [--idle-hours N] [--execute]` does the same for every
  lane worktree idle that long (dry run first: it prints what and how many MB). The next `lane gate` installs again.
- Code first: no new unit specs, existing specs stay green; integration and e2e suites run only when asked (R12).
- At the end stop every process you started and remove the worktree with `starci lane remove <worktree> --execute` (it unlinks each
  install link first, never deletes through it, and takes the install with the worktree); keep the branch. Report what landed (the dev sha), what is open, and what needs
  the owner.
  A lane that changed a visible screen reports done only with its step 2b shots of [../project/gallery.md](../project/gallery.md)
  PROJECT-GALLERY-7 (`starci app look` on dev with real data, at 1440 and 390); without them it reports "chưa xem trên dev", never "done".
