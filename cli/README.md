# The starci CLI

The npm package `starci-harness` is the `starci` command (its bins `starci` and `starci-harness` are one entry,
`dist/main.js`): one TypeScript source on `commander`, built with `tsc` into `dist/`, which git never tracks. `npm ci`
in a checkout builds it (`prepare`, which builds nothing where no `src/` is, as in an installed package);
`prepublishOnly` gates on typecheck and lint. `npm pack` and `npm publish` build in `prepack` instead (their `prepare`
builds nothing, as it would run after the copies and index them), which then copies the runtime's `ops/`, `policy/`,
`contexts/`, `skills/starci/`, the harness documents and `LICENSE` into the package (`files` of
[package.json](package.json)), with the repository's README as the package's own and this file as `cli/README.md`; `postpack` puts this README back and removes the copies. A published CLI therefore carries its data,
resolves every `harness:` context file of the op files from itself, and holds the very corpus its search index was
built from, so `contexts search --check` is green in an installed package too. The checks a change must pass are in
[CONTRIBUTING.md](../CONTRIBUTING.md); publishing is CI's, on every push to main (CONTRIB-20). The CLI runs the
`@starci` packages its lockfile installs, so `check pins` (`core/check/cli-pins.ts`, a CI gate) and `release publish`
refuse a CLI whose requirement or locked copy of one differs from its pin in `contexts/stack/pins.yaml` (`CLI_PIN_SKEW`).

## Source layout

```text
src/
  main.ts                 builds the commander program for the tree of the working directory; prints the envelope
  registry.ts             every verb, core first, then each edition; which verbs a tree offers
  shared/                 verb, errors, output, tree, exec, git, role, secrets, workspace
  harness/                ledger and host store, contracts, tasks, settle, router, workflow graph, seats, liveness, uat, settings, secret loader
  core/<group>/<verb>.ts  verbs of both editions (the harness verbs among them)
  lite/<group>/<verb>.ts  verbs of lite apps
```

## The verb standard

- **One definition.** A verb is one `defineVerb({...})` in its own file, listed in `registry.ts`: path, summary,
  editions, effect (`read`, `local-write`, `host`, `remote`, `publish`), roles, json schema, typed flags and the
  handler. Help and `starci explain` are generated from it; no YAML or table restates it.
- **Which verbs a tree sees.** `locateTree` reads the nearest `hfs.json`. A lite or full app sees the verbs of its
  edition (core verbs serve both); the runtime and a folder outside any StarCi tree see every verb.
- **Output.** With `--json` every verb prints one envelope, `{schema, ok, data}`, or
  `{schema: "starci/refusal@1", ok: false, code, message}`. Exit 0 is done, 1 is refused or red (nothing moved),
  2 is bad usage. A refusal is thrown as `Refusal(code, message)`.
- **The app commands.** `core/app/hfs.ts` runs the `starci app` verbs that `@starci/hfs` implements in-process in the
  app's directory: each verb file maps its typed flags to the hfs arguments (`hfsArgv`, values checked by zod first) and
  `runHfs` streams hfs's output in human mode (the verb's message is empty) or, under `--json`, passes `--json` to a verb
  that prints a report and carries it in the envelope; the exit code is hfs's, 3 included (a database mutation not
  armed). `core/app/input-bounds.ts` is the package export `starci-harness/input-bounds` an app's codegen loads.
- **Roles.** A verb lists the roles that may run it. They are enforced when `STARCI_ROLE` names the caller's role: a
  role the verb does not list refuses `ROLE_REFUSED`, a value that is no role is usage (`ROLE_UNKNOWN`), and unset
  means not enforced. Orca's `worker-start` cannot set a worker's environment, so the rendered brief names the role
  (`supervisor`, `kernel`, `worker` for Orca seats, `agent` for an inline task) and tells the agent to set it.
- **Context search.** `build` (and `prepack`) ends with `core/contexts/search-build.ts`, which chunks the corpus and
  writes `dist/contexts-search.json`, embedding it on CPU with the pinned model of `core/contexts/search-embed.ts`
  (optional dependency `@huggingface/transformers`, weights downloaded once into `.runtime/models` and hash-checked;
  `STARCI_SEARCH_MODEL=off` builds BM25 only) for `contexts search`, which fuses BM25 and cosine, falls back to BM25
  when the model is absent, fails `--check` on a stale index and measures `--eval` on `core/contexts/search-eval.json`.
- **Host processes** run without a shell (`shared/exec.ts`; npm through the running Node), so no quoting breaks on
  Windows; git goes through `shared/git.ts`.

## The harness inside the CLI

### Ledgers

[contexts/harness/state.md](../contexts/harness/state.md) says where the files are; `harness/ledger.ts` owns
every path. A project ledger (`runtime.sqlite`) holds `workflows`; `plan_nodes`, `edges` and `graph_versions` (each
graph version's nodes with contract hash, node hash, routing hints and retry round, and why the version was recorded);
`tasks`; `attempts` (one per dispatch, with the router's pick record); `results` (immutable, one per attempt);
`check_runs` (every check of every verify with its status, exit code and detail: the tail of its output, at most `EVIDENCE_LINES` of `shared/output.ts` per tool run, with every value `redactSecrets` of `shared/secrets.ts` recognises redacted, which `task status` prints for the red checks of the newest verify); `seats`; `messages`; `events` (append-only); `prior_work`, which indexes by workflow, plan key, contract hash,
attempt and sha256 the one patch a key keeps for its next attempt (a KEEP or REPAIR settle, "Settling an attempt") in the
project's `prior/<sha256>.patch` store, deleted when that attempt settles (`harness/prior.ts`); `check_rows`, the green
check steps by input digest (`harness/check-reuse.ts`); and `meta`. The host's `machine.sqlite` holds only host-wide state:
`ledgers` (the registry keyed by the git common dir), `provider_health`, `provider_events`, `pool_quota`,
`pool_concurrency`, `route_picks`, `budgets`, `budget_raises`, `host_events`, `owner_requests`, the heavy-command
governor's `heavy_slots`, `cpu_samples`, `managed_cpu_samples` and `heavy_meta` (`harness/heavy.ts`), `project_supervisors`, one live
Supervisor row per project key (`harness/machine.ts`, `harness/supervisor.ts`), `supervisor_workers`, each `[Worker]` a
Supervisor dispatched (`harness/project-workers.ts`), and the Telegram channel's
`telegram_channel`, `telegram_notices` and `telegram_inbound` (`harness/telegram.ts`) with the ticket cards' `telegram_files`,
`telegram_mutes` and `telegram_pending` (`harness/telegram-tickets.ts`), and `tickets` and `ticket_waiters`
("Tickets" below, `harness/tickets.ts`).
A Kernel is a `seats` row of its workflow (role `kernel`); every seat holds a TTL lease (`lease_until`); `commands`
and `decisions` hold the coordinator protocol; `workflows.worktree` names a workflow's worktree and `tasks.worktree` a task's
own checkout. Seats stay in the project ledger.
Additive migrations bump the corresponding machine schema version or `LEDGER_VERSION`; migrations never drop. Every
store is opened through one function (`connect` in `harness/ledger.ts`), which reads its header first: a file that is
no SQLite database or a damaged one is refused `LEDGER_CORRUPT`, naming the file and its recovery, and is never written.

### Task states

`TRANSITIONS` in `harness/tasks.ts` is the one state machine, changed only through `setStatus`, a
compare-and-swap on the status it read (the loser of a race is refused `TASK_STATUS_RACE`):
`queued → running → reported → verifying → done | failed | awaiting_owner | cancelled`, plus `effect_unknown` (a
launch Orca could not confirm or deny, or a running task whose worker Orca reported gone). A launch that certainly
failed returns the task to `queued`; a red wave verify returns a `done` task to `failed`, and a wave whose deferred live
suite lacks a custody key, or declares keys the harness cannot read, leaves it `awaiting_owner` (its only ways out; it holds nothing either way); a verify with no verdict returns it to `reported` with no try spent, until one
result has reached no verdict `settleNoVerdictMax` times ([ops/liveness.yaml](../ops/liveness.yaml)): then the failure is
persistent and the task ends `awaiting_owner` with the last reason (`noVerdict` in `core/task/verify.ts`). A command
with side effects claims an intent on the task first: `cancelling` before a cancel stops seats or resets paths (a
verify or result arriving later is refused `TASK_INTENT_HELD`; a cancel refused half-way keeps it and resumes when run
again), `repair` when a preserve saved the work but could not put every path back (a held file on Windows); a task
with an intent keeps its worktree, and `task verify --recover` finishes the reset from the preserve's `manifest.json`.
Each task records its checkout (its Op worktree, else the one it was sent from), and verify, cancel and a failed result
act there whatever checkout the caller is in.

### Op worktrees

Every task of a workflow, under either runner, works in a git worktree of its own,
`<project state>/worktrees/<workflow>.ops/<task>` on branch `starci/<workflow>.ops/<task>`, cut when its seat starts (or
its inline step hands it out) from the head of the branch its workflow's worktree has checked out (an inline workflow
without one: the checkout it runs in), once that head declares the opt-in patterns its `allowPaths` need ("Opt-in patterns"), beside that worktree rather than inside it, since git keeps no branch below another
branch's name and a nested checkout would sit in the workflow's tree. It gets the product's hooks and, for each
node_modules folder of that checkout and each lockfile folder of its own, an install without npm: from the install cache
(below) when it holds the key of that folder's install inputs, else a link to the checkout's own folder when it has one (a
junction on Windows), always the link in local package mode (`ensureOpWorktree` and `linkInstall` in `harness/land.ts`).
Before the Op's work is checked (at seat start, once its prior work is applied, and in the worker's dry replay `task verify
--contract`), `refreshOpInstall` replaces every install that no longer satisfies the worktree's own lockfile (a task that
added a dependency) by the install of its own inputs, from the cache or by `npm ci` (below), recorded `op-install-refreshed`.
No path is held while a task works: two tasks may write the same file at once. Under the orca
runner the worktree is listed in Orca under the workflow's worktree as `[Op] <workflow>: <task>`, and the workflow's
worktree under the project's main checkout as `[Kernel] <workflow>` (`orca worktree set --parent-worktree`), so
Orca's worktree tree shows Supervisor, Kernel and Op whichever worktree each terminal runs in. A start sets it whether its
launch ends ready or unknown, and every `supervisor tick` lists each repository's worktrees in Orca once and re-applies the
lineage of any harness worktree of an orca workflow listed without its parent, recording `orca-lineage-set`, or Orca's
refusal with its reason as `orca-lineage-refused` once per reason (`reconcileLineage` in `harness/orca/lineage.ts`).
Concurrent starts of one task make its Op worktree one at a time, under a ledger lock per task. Every worktree the
harness made is removed once its owner's work ends ([contexts/authority/README.md](../contexts/authority/README.md)
"Worktrees"): an Op's by verify, cancel and a failed result at once, and by every `workflow step` for a task a fence,
a stall or a crash ended (`sweepOpWorktrees`); every other kind, and any orphan, by the collector `worktree gc`, which
`supervisor tick`, `supervisor accept` and `reject`, and a workflow step of a done or stopped workflow run
(`harness/worktree-gc.ts`). Removal preserves uncommitted work first, then reaps the worktree before it removes it
(`removeWorktreeFolder` in `harness/land.ts`, `reapWorktree` in `harness/reap.ts`), in this order: it reads the process
table, closes every Orca terminal working there (each tab, then Orca's forced close `orca terminal close --worktree
path:<folder> --all`, which also stops a terminal no list shows), unlinks the install links with a plain unlink (never a
recursive delete through a link), has Orca forget the worktree when the run is an orca one or Orca lists it (`orca worktree
rm`, waited for until Orca no longer lists it or records the removal failed, since Orca's own watcher and terminal host hold a
workspace it lists), and then, for a folder under the harness's state, ends the processes that are the harness's there:
those it recorded starting in the Op worktree (`op_processes` of the host store: every run, detached and served program
the CLI starts there, git aside, through the spawn observer of `shared/exec.ts`, and the seat's shell and agent found working
in the folder right after Orca starts the seat, since Orca names no pid for a terminal), the heavy commands working there
(`heavy_slots`), every process whose working folder lies inside it (read from the process itself: its PEB on Windows,
`/proc` or `lsof` elsewhere, `harness/process-table.ts`) and every process under one of those, each hop started after its
parent so a reused pid never makes a stranger a child. Each is ended by pid (`taskkill /F`, or SIGTERM then SIGKILL after
a grace), a second read ends what the first kill left or started, and the reap is recorded `worktree-reaped`. Nothing is
chosen by its name; this process, its ancestors and Orca are never ended. Orca forgets a removal it could not finish once the
processes are gone, git removes what is left and prunes, and a removed worktree Orca still lists (a "Delete failed") is
dropped from Orca's list. A folder still held is never a failure of the settle: it is recorded `worktree-held` with its
holder (the processes still working in it, Orca still listing it, a handle tool's answer, or what was tried), retried by
`worktree gc` with backoff and reaped again each time, ticketed for Debug at the attempt cap (`harness/worktree-busy.ts`),
and listed by `worktree gc` and `host load`. An Op's worktree and its branch go together, only after its attempt is
settled ("Settling an attempt"), whatever the branch carries; every other branch is kept.

### Settling

`task verify` first stops the task's worker seats (refused `VERIFY_WORKER_LIVE`, nothing changed, when
Orca cannot confirm the stop), then builds a candidate from HEAD of the task's checkout plus its work under its
`allowPaths`, rebases it onto the head of the branch it lands on without a work tree (`git merge-tree --write-tree` with
the candidate's parent as the base, `rebaseCandidate` in `harness/land.ts`), and replays every check on a clean checkout
of that rebased commit, never in the worker's environment (a workflow task's heavy checks wait for its wave, below), so
what is verified is what lands; what the candidate misses
is read against the same staged snapshot. A textual conflict is never resolved by the harness: no check runs, the work
is preserved, the attempt ends `conflict` and the task fails without a verdict, and the Kernel gets a `conflict`
decision to amend the node on the new head, whose retry starts from the preserved work when the Kernel settles it `repair`. A task working in a checkout it
shares (one sent from the owner's checkout) records its checkout's tree as its baseline when its work begins
(`beginWork` in `harness/baseline.ts`), and a dirty file unchanged since then is left out of its candidate, its
`paths-only` stray files, the lint and typecheck of its `check run --task`, and its preserve and reset; an Op worktree
holds only its task's work and records none. Every candidate also meets the `lands` check, red when work under its `allowPaths` would not land
through the harness (a dirty file missing from the candidate, a commit without the `Starci-Task:` trailer made under
them while the task ran, as a worker that commits itself leaves, or a result naming files under them while the candidate
changes none, as a worker that wrote outside its checkout leaves; a worker's brief names its Op worktree as its repository,
`renderBrief` in `harness/brief.ts`), and the `secrets` and `loosening` gates of the
project's runtime tier ([policy/quality.yaml](../policy/quality.yaml)) on the files it changes, whatever its contract
says (`harness/clean-verify.ts`). Its scoped `starci check` runs over what the candidate changes, or, when it changes
nothing, over the tracked files under the `allowPaths` (`runScopedCheck` in `harness/run-checks.ts`), red when no step
ran; `check run` first builds the workspace dependencies whose entries the clean checkout lacks, or restores them from
the build cache (`core/check/workspace-deps.ts`, cache path in `harness/ledger.ts`), as
[contexts/project/lint.md](../contexts/project/lint.md) states. Green commits only those paths (never pushed; a candidate that changes nothing commits nothing and its result hash
reads the tree of its `allowPaths` at the head it settled on) and makes the task done and records its settle commit
(`tasks.settle_commit`) in one transaction; red preserves and resets its paths and fails it, but a red that names an opt-in slot
of a pattern the branch lacks is the harness's ("Opt-in patterns"): it declares the pattern and verifies again on the new head; either way the task's Op
worktree is removed once its attempt is settled ("Settling an attempt"). Every ending of an Op's task, under the land lock, also preserves as the task's work whatever sits
dirty under its `allowPaths` in the checkout it lands on and puts that checkout back (`land-escaped`, `preserveEscaped` in
`core/task/verify.ts`), so the fast-forward never meets it and a retry starts from it: green lands on the branch or the task
returns with its work preserved, never done with its work left beside the branch. A done task an older verify settled with
nothing while its result names files is returned by `task verify --recover`: its work is preserved from that checkout and
it fails `land-orphaned`, a harness cause (below), reopening its workflow when that had ended done. A verify holds its task's verifier lock throughout, and the land lock of the branch it lands on
(one per branch, `landLockKey` in `harness/land.ts`) only while its verified commit is integrated: an Op's lands by
`git merge --ff-only` in the target checkout, which moves branch, index and work tree together and refuses rather than
overwrite a local edit, a task in the checkout it lands on by moving the ref. Verifies of one workflow run side by side;
when another task landed between a verify's rebase and its landing, it verifies again on the new head under the land
lock, so each lands on the head the previous one left. A lock's holder stamps a heartbeat, so a dead holder whose pid
Windows reused is taken over once the beat goes stale (`withSettleLock` in `harness/settle.ts`), and holds a lock at most
`verifyDeadlineMinutes` ([ops/liveness.yaml](../ops/liveness.yaml)), counted over the time its heavy commands ran and never
the time they waited in the heavy queue (`queuedSince` of `harness/heavy.ts`, which the beat stamps as `queuedMs`): at the deadline the holder gives it up itself
(`VERIFY_DEADLINE`, no verdict, back to reported, and work that resumes later lands nothing), and a holder still listed
past it counts as gone though it beats. A tool run ends at most a few seconds after its process exited or was killed even
when a grandchild keeps its output pipes open (`shared/exec.ts`). Git is the authority for landed: a task left verifying
by a verifier that no longer holds its verifier lock (dead, its beat stale, or past the deadline) is reconciled by `task
verify --recover`, which the settling half of every `workflow step` (`settleWorkflow`, so `kernel next`) runs on such a
task before it settles, and which `supervisor tick` and `supervisor next` run for every workflow the Supervisor
coordinates, so a filed result is verified and its worker's seat closed with no Kernel turn: done when the branch it lands on carries the settle commit (its message and `Starci-Task:` trailer after the head
the verify started from), else back to `reported`, which the same step verifies. Git runs through one runner (`captureGit` in
`shared/git.ts`) with `core.quotePath` off and `core.longpaths` on, and every path listing the harness parses is
NUL-separated (`-z`), so a non-ASCII or deep path is never quoted or cut.

### Settling an attempt

An Op reports, the harness verifies, and each ended attempt is settled once in its status by one of four decisions (owner
decision `op-settle-merge-or-discard`; `settleDue` and `settleWork` in `harness/prior.ts`, recorded `op-settled`): MERGE,
a green verify that landed it; KEEP, a stop the harness owes a continuation (custody's `awaiting_owner`, a cause
`harnessCause` of `harness/revive.ts` names, a verify the host held, a waiter parked on a shared need); and, for a red the
task caused, its Kernel's decision, the `settle` of the command answering its red, question, check-premise or conflict
decision: `discard` (the default) or `repair` (`recordSettles` in `core/kernel/driver.ts`; refused `COMMAND_INVALID` on a
command that answers no such decision, or holds it). A task with no Kernel (outside a workflow), or cancelled with no harness
cause, is DISCARD, and one whose Kernel answered nothing is DISCARD once its workflow ended or its key went on to a later
task. Until its decision nothing of the attempt is removed: its preserve folder, Op worktree and branch stay
(`removeOpWorktree` in `harness/land.ts` and `worktree gc` wait for it). KEEP and REPAIR store one patch for the key, the
attempt's newest preserve (with the commits its Op branch carried past its fork) under its `allowPaths`, and drop every
other patch of the key; MERGE and DISCARD drop the key's patch, since the attempt that applied it settled. Every settle then
deletes the attempt's preserve folders, so no partial work stays beside the store, and its Op worktree and branch go. The
next attempt of the key first settles any earlier one whose decision is due, then applies the kept patch at launch
(`applyPriorWork`, through `beginWork` in `harness/baseline.ts`), and its own settle deletes it: a key keeps at most one
patch, for one attempt. A cancel of a task whose worktree is already gone (removed out of band) has nothing to preserve: it
is cancelled at once, recorded `task-discarded`, and spends no try (`tryAfter` in `harness/tasks.ts`). `worktree gc`
drops every stored patch that is not its key's one kept patch (`pruneUnkeptPrior`, a `prior-dropped` event per row).

### Wave verify

The tiers are [contexts/authority/](../contexts/authority/README.md)'s; policy/quality.yaml `verify.tier`
picks where a workflow task's heavy checks run. In `wave` (the default) `task verify` splits the contract's checks
(`splitChecks` in `harness/wave.ts`): the heavy ones, a scoped `starci check` verb or any command check (typecheck, lint,
tests, a suite), are left to the wave and recorded `wave-due` when the task settles; the rest run in its own verify, and
a task left with no tool-running check gets no install or setup at all. A Supervisor's `[Worker]` leaves them the same way,
to Debug's round after it lands the worker's branch; a task sent alone (`task send`), or the `task` tier, runs every check
itself. `workflow step` (so `kernel next`, inline and orca alike) runs the wave (`runWave`) once the
batch in flight has landed (no task of the workflow live) and nothing more can be dispatched without it (no ready node,
or every ready node depends on a task of the wave); a ready node depending on a due task waits for it, and a workflow is
never done while a wave is due (`derivedStatus` of `harness/workflow.ts`). The wave writes its scope decision first
(`wave-scope`: the diff from the oldest settle parent of its tasks to HEAD, the changed files, the commands, what it
skips), then, on one clean checkout of the workflow's HEAD, prepares one install and every contract's setup, runs each
scoped check once over the union and each command once per cwd and argv (per task when it reads the task's result or
coverage). A red that names an opt-in slot of a pattern the branch lacks is the harness's: it declares the pattern and judges
the wave again on the new head ("Opt-in patterns"). Any other red check belongs to the tasks whose landed files its output names (every task that left it when it names
none): those tasks go `done → failed` with the red rows on their attempt (`wave-returned`), back to the Kernel like any
red verify, and every task of the wave is judged (`wave-judged`, `wave-verified`). `workflow wave <id>` runs a due wave by
hand, and `workflow wave <id> --final` a due final verify. A coordinator's turn (`kernel next`, `kernel submit`, `supervisor
next`, `supervisor tick`: `refuseHeavyWaits` of `harness/heavy.ts`) never runs heavy work itself: its step starts the due
wave, the verify of a reported task whose own checks run a tool (`verifyIsHeavy`) and the final verify as detached jobs
(`starci workflow wave`, `starci task verify`, `starci workflow wave --final`), one per job row (`harness/jobs.ts`: a job is
busy while its lock is held or its process lives), and a later step reads their verdicts.

### Install cache

A clean checkout and an Op worktree never run their own `npm ci` when the shared install exists: `cachedInstall`
(`harness/install-cache.ts`) keys an install by its inputs (`installKey`: the path and bytes of the lockfile, manifest and
.npmrc of the install folder and of each workspace member its lockfile names), Node's version and npm's
(`<state base>/cache/installs/<key>`, path in `harness/ledger.ts`), so a candidate whose lockfile or any manifest changed is
never served the base's entry. A miss runs `npm ci` in the checkout under a heavy-command slot, one fill per key across the
host, and copies its
node_modules into the cache (staged, then renamed into place), recording the links npm made to the checkout's own folders
(workspace members) relative to the install folder; a hit gives the checkout a real node_modules whose every package is a
link into the cache (a junction on Windows), those workspace links re-made to the checkout, and a marker. A repository in
local package mode gets a copy instead, then the same `reapplyLocal`. Before a checkout is removed, and when a leftover
one is pruned, every install link it holds (a node_modules that is itself a link, and every link inside a real one) is removed with a
plain unlink (`unlinkInstallLinks`), never a recursive delete through it.

### Heavy-command governor

Every heavy command the harness spawns (tsc, eslint, a command check, a workspace or package
build, `npm ci` or `npm install`, a contract's setup, a uat container) runs through `withHeavySlot` of
`harness/heavy.ts`: one slot of a host-wide semaphore (`heavy_slots` in the machine.sqlite of the harness's main checkout,
or of `STARCI_LOCAL_ROOT` when set: `governorStorePath` of `harness/ledger.ts`, so every worktree of the harness shares
it) while it runs, admitted dynamically at every poll: free RAM less a reserve must cover the RAM estimate of every running
command plus its own, and fewer than floor(logical cores / 2) may run. The CPU ceiling governs the harness's own
contribution: while the CPU average over a window (samples in `cpu_samples`) is above it, `managedCpuPercent` reads the share
of the host's CPU the running heavy commands and their process trees burn over the same window (`managedCpuTimes` of
`harness/host-holders.ts`, the Windows process table's kernel and user time or `/proc` on Linux, readings in
`managed_cpu_samples`, one process host-wide taking one per `MANAGED_SAMPLE_MS`). Under `managedCpuFloorPercent` the load is foreign:
holding the harness back would not lower it, so up to `underForeignPressureSlots` commands run under it (`cpuRuleOf`). At or
above the floor, or with the table unreadable, none starts until the queue admitted nothing for `cpuStarveMinutes`
(`last-admit-ms` in `heavy_meta`): then its first command RAM admits starts anyway, one at a time, so a hot CPU slows the
queue and never stops it. The CPU never lifts a RAM rule. The queue is served by age, a project (the repository of a command's folder, `repositoryKeyOf`) with fewer commands
running first, and a project running `projectSlots` commands is passed over while another project's command waits under
its own cap (`servingOrder`). The reserve, estimates, per-kind timeouts, memory caps and seat floor are
the `heavy` block of [ops/liveness.yaml](../ops/liveness.yaml). A command's timeout starts at its admission, never in the
queue. A command not admitted waits in the queue, says so on stderr and records a `heavy-wait` host event; waiting never
fails it: a coordinator's turn is refused `HEAVY_DEFERRED` at once instead of waiting, and a command of `task verify` (or a
process it started) still in the queue at the verify's timeout, its contract budget (`withHeavyBound`), is refused
`HOST_HELD` (exit 75): a host-held verify reached no verdict and records `verify-host-held` on the task's attempt, whichever
way it ran; the settling one returns its task to reported with no try spent and no count toward `settleNoVerdictMax`, and the
next step verifies it again. An attempt whose verify the host held and whose worker then filed blocked or failed is
harness-held (`hostHeldAttempt` of `harness/tasks.ts`): its retry spends no try and the decision on it no route of
[ops/routes.yaml](../ops/routes.yaml), whose limit never closes on it. A verify or wave stopped by the harness reaches no verdict (VERIFY_INFRA, `assertNoInfraFailure` of
`harness/clean-verify.ts`): an install or setup out of time, or an install red although the work changed no file an install
reads (package.json, package-lock.json, npm-shrinkwrap.json, .npmrc), which also opens one harness-defect ticket
(`INSTALL_RED_HARNESS`, every repeat landing on it). No try is spent, a wave fails, returns and revives no task (they stay
due, `wave-infra`), and the next step verifies again, going on once the install is green. Each child runs below normal priority, a node tool under
its kind's `--max-old-space-size`, a uat container under `--memory`, a jest or vitest run with `--maxWorkers` (1 under
pressure), and inherits `STARCI_HEAVY_HELD`, so a `starci check run` it starts runs under its slot instead of waiting on
it. `check heavy-sites` (a CI gate) is red for a spawn site in `cli/src` that runs a heavy command outside the governor.
`seat start` refuses `SEAT_RAM_LOW` while free memory is under the seat floor, which `workflow step` reports as a wait, and
records the hold (`seat_holds`: since when, on what memory) until the task launches or the floor admits again.
`workflow status` names why a node stands still instead of a bare state: a queued task the floor holds ("held: free RAM
2.6 GB below seat floor 6 GB (since 21:02Z)"), a verify waiting for a heavy slot ("held: heavy-command slot for test, free
RAM 2.6 GB below reserve 8 GB (since …)"), a task awaiting the owner with the reason its verify recorded.
`host load` prints the load with the CPU rule that applied ("CPU 94% is foreign (managed 3%, under
heavy.managedCpuFloorPercent 25%): 2 slots under foreign pressure, 0 in use"), the slots in use with each child's pid and RSS, the queue with how long each command waited
and why, the seat holds, and who holds the memory (`harness/host-holders.ts`): the top processes by working set, managed
(a recorded heavy command or seat, a process under one, or one working in the harness's state folder) or unmanaged (other
node, WSL and Docker, IDEs, agents, the rest), each command line clipped and redacted. Another app's `starci app` run is
unmanaged: the CLI alone makes nothing the harness's. When heavy admission or a seat launch has been held without a break
for more than `heavy.starvedTicketMinutes`, `supervisor tick` opens one `harness-defect` ticket per episode
(`HOST_STARVED`, `harness/starvation.ts`) naming how long each was held and the top unmanaged holders, for Debug; it is
never an owner question and the governor's rules do not change for it.
On Windows `host load` also reads the CPU of Defender's real-time scan (MsMpEng) and, at `scannerCpuPercent` or more,
prints the owner's `Add-MpPreference -ExclusionPath` command for the state base and every registered repository, which the
harness never runs.

### Custody into a live suite

A command check whose scoped jest run holds an opt-in live suite (a spec calling `useSandbox(...)` or
`useSandbox<Client>(...)`, named by the task's command or its own changed spec), and a worker's own run of one through `starci test live <spec...> [--run
<suite>]` (`core/test/live.ts`, made by the same `prepareSuite` of `harness/run-checks.ts` under a heavy-command slot,
the worker seeing only key names), reads the keys the suite's world declares from the app's
custody, the sealed members of `.starcistacks/<env>/secrets` (`dev`, else the one environment that has secrets) in the
checkout the run executes (a wave's branch head, a verify's candidate, the worker's worktree), so a member sealed on a
workflow's branch is found before it reaches main, opened with the @starci/hfs code `app secret materialize` decrypts with
and the age identity of the app's main checkout, and
hands them to that test run's child environment alone (`harness/custody.ts`): never a file, an argument or a log, and
every handed value is scrubbed from the run's output before it becomes evidence. The keys are read from each
`useSandbox(...)` call's options with the TypeScript compiler (the app's, else the CLI's): a literal array of strings, or
a `const` holding one in the spec or in a relative module it imports it from (`as const`, a type annotation or
`ReadonlyArray` alike), spreads included; an object element (`{ alias, resolve }`, a pool key the spec resolves itself)
is no custody name. A declared key no member holds, or holds empty or blank, refuses `CUSTODY_KEY_MISSING` ("custody lacks
OPENROUTER_API_KEY in dev"), one custody cannot open here `CUSTODY_UNREADABLE`, and a call whose keys reduce to anything
but string literals `CUSTODY_KEYS_UNRESOLVED` naming its `spec:line`, before the suite runs; each ends the task
`awaiting_owner` (from `verifying` in its verify, from `done` in the wave that runs its deferred tests), never red, its
try unspent, and the tick files it as the owner's blocking `question:business` on credentials, an unresolved declaration
as one blocking `harness-defect` (code `CUSTODY_KEYS_UNRESOLVED`) every such task waits on. A failed test run that still
reports a key custody holds as `TEST_WORLD_NOT_DECLARED` is the harness's failure, not the task's: `VERIFY_INFRA`, no
verdict and no try, and one blocking `harness-defect` ticket deduped by `CUSTODY_KEY_NOT_HANDED` (`assertKeysHanded`).
A worker's report is never the verdict of a run custody stopped: a `failed` or `blocked` result (no `--needs`) whose
output shows `TEST_WORLD_NOT_DECLARED` or a custody refusal (`custodyEvidence`) leaves the task `reported`, its work kept,
with a `custody-recheck` event on its attempt (`core/task/result.ts`); its node stays `reported`, not returned, so the
next step verifies it, and the verify runs the contract's checks with custody as above, the result's verdict keys set
aside (`recheckOf`, `ResultSource.setAside`): the suite's own exit is the verdict, in the task's verify and in the wave
alike. Green settles it, a genuine red fails it, and a key custody lacks ends it `awaiting_owner` as above.

### Result reuse

`check run` keys each typecheck and lint step by the digest of its inputs (`checkDigest` in
`harness/check-reuse.ts`: the gate, the judged files, the content of the package and the workspace packages it reaches
and of the repository's root files, dirty files hashed as they stand, Node's version and the tool's) and keeps green
steps in the project ledger's `check_rows`; a step whose digest has a green row is that row, reused and never rerun, in a
wave, in Debug's scoped round and before a push alike.

### Workflow graph

A workflow file (`starci/workflow@1`) is recorded as graph versions (`harness/graph.ts`) built for
a goal version (`harness/goal.ts`): goal text, acceptance ids and a scope ceiling (path prefixes, max tasks). Goal 1 is
the file's; `workflow regoal` (owner, Supervisor) records goal n+1 from a `starci/goal-change@1` file, based on goal n
(`STALE` otherwise) and idempotent by its cmdId. A node's hash is its contract hash and retry round; its dependencies
enter through early cutoff instead (`harness/reconcile.ts`): each dispatched task records the dependency tasks it ran
on, and a done task's settled result hash is the git tree of its allowPaths at its settle commit plus its output hash,
so a retry or edit upstream that lands the same result invalidates nothing below it. A node is ready when every
dependency is done; its ledger task is created only then, whatever paths other live tasks write. A workflow is done when every
node is done and, when a task names its composer (`composedBy`), its final verify is green: once per graph version
`workflow step` runs `check run --workflow`, which judges every deferred module in full, records the verdict
(`workflow-final-verify`) and blocks the workflow on a red one (`derivedStatus` in `harness/workflow.ts`). A replan is
`workflow amend --desired <workflow file> --based-on <graph version>` (the Kernel's whole desired graph, reconciled by
task key) or `--change <starci/workflow-change@1 file>` (add, edit, remove, retry, accept); it records graph n+1
atomically (`STALE` on a moved graph, idempotent by `--cmd-id`) and is refused `WORKFLOW_INVALID` for an unfit contract, the
context budget judged only on a contract it adds or edits (a contract the current graph holds, done, unchanged or retried, is
admitted and keeps the budget it passed then: `buildGraph`, the admission rule of `context.budget` in
[ops/ops/README.md](../ops/ops/README.md)), `SCOPE_EXCEEDED` past the goal's
ceiling, and `GOAL_SHRUNK` when it drops a key of a graph planned under the current goal version that no key it adds
takes over (`assertDeliverables` in `harness/goal.ts`): only the first replan after a goal change may drop one. Define
and every replan are refused `TASK_NOT_SPLIT` while one task of a `perRecord` label works several Work records
([ops/ops/README.md](../ops/ops/README.md)), and `FLOW_INCOMPLETE` while a Work record a task is over has a step of its lane
([ops/lanes.yaml](../ops/lanes.yaml)) that is neither satisfied by evidence nor carried by a task of its label over it,
in the lane's order (`assertFlow` in `harness/lanes.ts`), judged on the workflow branch's head (its worktree, `flowCheckoutOf`)
where its records are written, whichever checkout asks; `kernel next` digests each record's lane, read on the same tree, as `lanes`. Each key is classified keep, continue, stale (a dependency's result changed: the Kernel accepts or retries it,
nothing is cancelled), rework (done and its contract changed: a new attempt from its previous commit with the contract
diff), redo-live (live and changed: cancelled through task cancel, which settles it discard, and relaunched), redo, add or
drop (live: cancelled; done: a generated `revert.<key>` node undoes the commits it landed, verified like any task,
unless the removal says `keepEffect`); the generated `relay.<need>.r<round>` node is a shared need's ("Shared needs"). `plan diff` prints the classification without applying it, and
`workflowActions` gives the step and `kernel next` the same per-key actions for the current graph. A red or stuck task
blocks its dependents and the workflow, naming the red checks; independent tasks keep going. A task the harness ended with no
red of its own (`harnessCause` in `harness/revive.ts`: a wave red not proven its own, a launch Orca fenced or one whose worker
never started its turn, a verify the harness stopped (VERIFY_INFRA) or its lock's deadline stopped, a done task returned
`land-orphaned`) carries its node no
more, so the node is ready and its next dispatch retries it at the same try, its last included (`tryAfter` in
`harness/tasks.ts`, a `task-revived` event), up to `reviveMax` of [ops/liveness.yaml](../ops/liveness.yaml) per node, past
which its red names the cause. A retry past its contract's `budget.tries` is refused `TRIES_EXHAUSTED` (`retryOfNode` in
`harness/workflow.ts`) until `budget raise <workflow> --task <key> --tries <n>` raises that one node's tries (a `tries-raised`
event; by its Kernel, the Supervisor or the owner), the route out of a harness-caused exhaustion; a workflow-wide raise
changes only the workflow's ceiling. Every other retry is the Kernel's amend: the red, check-premise or question decision carries its
one legal route of [ops/routes.yaml](../ops/routes.yaml), and `kernel submit` refuses `ROUTE_ILLEGAL` for a change off it (`harness/routes.ts`). A failed task whose only reds are command checks its contract wrote, each output stating an
expectation the otherwise green result contradicts, is a `check-premise` decision carrying each check's command and output
(`premiseChecks` in `harness/check-premise.ts`), answered only by an edit that sets the task's checks: a worker never
changes its own checks, so the Kernel amends a stale premise. `WORKFLOW_TRANSITIONS` in `harness/workflow.ts` is the one rule for workflow status
moves.

### Shared needs

A worker that finds a shared thing missing never builds it: it files `task result --status blocked
--needs <key> [--rule <id>] [--paths <p>...] [--note <text>]`, or a `needs` list in its output (keys, or `{key, rule, paths,
note}`). A key is `<kind>:<target>`, kind `capability`, `package` or `config`; a capability or config target is lowercase
dotted segments (`/` and `\` read as dots), a package target an npm name (`normalizeNeedKey`, `NEED_KEY_INVALID`). A reported
path under a shared root of [ops/needs.yaml](../ops/needs.yaml) names the key (`platform/http/x.ts` is
`capability:platform.http`), so two spellings of one need meet; `needs merge <into> <from>` folds the rest (`harness/needs.ts`).
The host store keeps one row per (project, key) in `shared_needs` and one per reporting task in `shared_need_waiters`: a need
opens once, every later report of its key attaches a waiter, and a report of a need that ended reopens it in a new round. Every
step of a workflow (`settleWorkflow`, so `workflow step`, `kernel next`, `supervisor next` and `supervisor tick`, inline and orca
alike) tends the needs its tasks wait on, own or resolve (`core/needs/tend.ts`): a task returned with needs is parked (`task
cancel`: its work preserved, its slot freed; no `question` is raised for it) and the need is routed by scope. Waiters of one
workflow with no path under a shared root reach that workflow's Kernel as one `shared-need` decision; waiters of two or more
workflows, a shared path or a `config` key reach the Supervisor as one `shared-need`; a `package:@starci/*` key reaches the
Supervisor as a package edit (`route: package`). Partition is the rule: exactly one owner per need, every other workflow waits
on it, a cross-workflow dependency recorded as its waiter rows, and no workflow copies another's landed code: define and every
replan refuse `NEEDS_REQUIRED`, with this route as guidance, a new task whose input names another workflow's branch
(`starci/<workflow>`, its Op branches included) or a commit another workflow's task landed (`harness/foreign-source.ts`). A Kernel answers with a `workflow-change` whose `need` is
`{key, resolver: <task key>}` (a task it adds or one its graph holds) or `{key, reject: <why>}`, or with an `escalation`, which
hands the need to the Supervisor (a `resolver` may list several task keys); the Supervisor answers with a `need-owner` command
(`workflow` the owner, whose Kernel then gets the `shared-need`; with `need.resolver`, the task keys that workflow holds, landed or
not, resolve it at once; or `need.reject`) or `supervisor dispatch --need <key>` (a `[Worker]` owns it; a package need fills
`--input package`, so its contract reads the package contexts and carries the `package-specs` check, and its worker's `pkg handoff` is linked to the need). A wrong answer (another key, an unknown or waiting
resolver, a resolver from the Supervisor, a need that moved on) is refused `NEED_ANSWER_INVALID` with how to answer, and the
decision stays open (`harness/need-answer.ts`, `core/needs/answer.ts`). A need routed past `needs.ownerDeadlineMinutes` of
[ops/liveness.yaml](../ops/liveness.yaml), or whose decision was answered with no owner, climbs one router: Kernel, Supervisor,
then an `escalation` of kind `owner` (`harness` for a package). The resolver is judged on every step: its tasks landed resolve the
need, recording every commit its keys landed, each attempt and round of each key in the order the branch holds them (each
carries its `Starci-Task` trailer: `keyCommits`), so a relay never carries a commit without the ones it stands on; a package edit resolves it once its
handed-off head is on harness main; a resolver failed, cancelled, removed or stopped, or one that closes a cycle (it waits,
through other needs, on a waiter of this one: `findCycle`), reopens it at its router in a new round with the reason named. A
need is resolved for a waiter only when its resolving commits are on the waiter's branch, so each waiting workflow's own step
first relays them (`relay`): under that branch's land lock, every resolving commit the branch lacks is replayed onto its head in
order by a three-way merge against the commit's parent (`rebaseCandidate`, a cherry-pick with no work tree), a commit whose
change the branch holds already (an equal patch, or a merge that changes nothing) skipped, and the workflow's checkout
fast-forwarded, once per need round and workflow, recorded as a `need-relayed` host event that `needs show` prints commit by
commit. A textual conflict moves nothing by itself and is never a dead end: it becomes work of the waiting workflow, one
generated relay node `relay.<need>.r<round>` (`relayTask` in `harness/reconcile.ts`, added by `amendWithRelays`) owned by its
Kernel like any task, built on the resolver's node (its label, inputs and checks), allowed the conflicting files and every file
the commits touch, whose contract is to apply exactly those commits preserving both sides' intent. That work is mechanical, so its
context is lean: its op's base, the conflicting files and the repository files the template reads (the Work records the
commits implement), with the need's evidence (each waiter's rules and note) in its details, never the template's pinned base or
its harness topic and canon files, and it is held to its op's context budget like any task; before its worker starts the
engine applies them up to the first that conflicts and leaves git's markers (`applyGenerated`). Its verify runs its label's
checks and judges it as the transport of work the source already settled: its first waiter (the first node that depends on
it, `composerOf` in `harness/graph.ts`) composes it, consuming what the commits export, so the composition rules on the relayed
files defer to that waiter, whose check and the workflow's final verify judge them in full; a context file its checkout lacks
(a Work record of the source's, on the source's branch alone) is read, by its brief and its read trace, at the last relayed
commit as data (`relayHeadOf`), never copied onto the branch; and a finding its relayed files already held at that commit (the
same rule, file and message, whichever ESLint report printed it: a deferral's json findings print their message as the stylish
report does, `judgeDeferred` in `core/check/composition.ts`) is the source's baseline, judged there and kept as `baseline-findings` evidence, wherever `check run` judges them (as the node,
its composer or the final verify), a composition rule excepted (`core/check/relay-baseline.ts`). Every waiter of the need in
that workflow depends on it and stays parked with its work kept, spending no try, until it lands; the add is a `need-relay-conflict` event naming the node and the files, and the node's landing a `need-relayed` event
naming it. Like a revert node, a relay node's key and contract are the harness's own (no file adds or edits one), it is outside
the goal's scope paths, the Work records' lanes and the foreign-source rule, since it carries what another workflow's lane built.
Only a relay node its Kernel removed raises one Supervisor `escalation` of kind `conflict`, whose answer releases the waiters as
they stand. Then every waiter whose needs all ended is
retried in one amend, its new attempt starting from the one patch its park kept ("Settling an attempt") with a "Shared needs" section in its brief. A rejection
is taken back by `needs reopen <key> --reason <why>` (Supervisor, Debug; `NEED_NOT_REJECTED` for a need in another state): the
waiters the rejection released are parked again and a new round resolves through the newest task resolver a round recorded,
judged afresh, so the next step relays its commits; with none it opens at its router (`reopenRejected` in `harness/needs.ts`).
The relay is versioned (`RELAY_VERSION`, recorded as `relayVersion` on every relay event and waiter release, none reading as
1): a rejected need whose relay conflicted under an older version is reopened so by the router itself, once per version
(`relayReopenDue`), since that rejection ruled on the relay rather than on the need. Each reopen is a `need-reopened` event
naming who reopened it. `needs list` and `needs show <key>` read the store.

### Opt-in patterns

A slot of the hfs manifest that names a `pattern` is enabled only by `sides.<side>.patterns` of the app's
`hfs.json`, an app-root file every workflow shares and no task writes, so the harness owns those lists (`harness/hfs-patterns.ts`).
It reads which slots a task's paths lie in through @starci/hfs's own classifier (`starci app explain`) and declares each pattern
the branch lacks: before the task's Op worktree is cut (its `allowPaths`), before its verify (those and the files its result
names), and when a red of its verify or of its wave names an `HFS_SLOT_NOT_ENABLED` slot. The declaration adds the names to that
one list and keeps every other byte of `hfs.json` (`addToStringArray` in `shared/json-edit.ts`, proved by parsing the result), and
lands under the branch's land lock as a commit of its own (trailer `Starci-Harness: hfs-pattern`), the checkout fast-forwarded;
after a red the verify or the wave runs again on the new head, so the task spends no try on it. Each declaration is an
`hfs-pattern-enabled` ledger event (`hfs-pattern-refused` with the reason when it cannot land, a dirty `hfs.json` in the checkout
for one, and the task then meets the red as it stands) and lands as a shared need: `config:hfs.<side>.patterns.<name>`, resolved
by the first branch's commit, a declaration on another workflow's branch recorded as its relay (`needs show`). The commit belongs
to no task, so no task's diff carries `hfs.json`: no task is judged app-wide for a declaration, and what a pattern makes legal or red
is judged on the files a task lands in its slots. A task that changes `hfs.json` or another app-wide configuration file itself
widens its scoped check to whole packages, and that run is judged against the same run at its base: a finding already there is
the base's, recorded as a `baseline-findings` event and never the task's red, so it spends no try
([contexts/project/lint.md](../contexts/project/lint.md), `core/check/base-findings.ts`).
`contract check` names the patterns a contract's `allowPaths` need that the app does not declare yet.

**Seat launch.** The claim comes first, in one transaction: the queued task goes to running and an attempt and a
`starting` seat carrying the launch record are opened; only then is Orca called, so two starts never both launch.
Orca's `run-create` and `worker-start` run under retry-request ids derived from the attempt. The brief, the contract
copy and the worker's output file live in the project's state folder, and the spec only points at the brief (the
Windows argv cap). The effective agent and model are attested from `worker-show`; a mismatch closes the worker and
requeues the task. A certain failure is explained before the worker is released (`explainLaunchFailure` in
`harness/launch-failure.ts`, for an Op's and a Kernel's launch alike): at Orca's `agent_readiness` stage the agent terminal
its receipt names is read once, a screen at one of `blockedPrompts` ([ops/routing.yaml](../ops/routing.yaml)) is a
`blocked-prompt`, anything else takes its `failureSignals` kind; the seat keeps the explanation (`seats.failure_json`,
shown by `seat list`). An unknown outcome leaves the task `effect_unknown` with its worktree and seat open, and
`seat start <task> --resume` replays the same requests.

### Package sources

An app pins npm versions of its `@starci` packages in committed files; `deps source --local`
takes them from a package folder on this machine instead, the mechanism and its reasons in the doc comment of
`core/deps/packages.ts`. Every checkout of a repository in local mode gets the same copies (`reapplyLocal`): a worker's
before its launch (`seat start`), a clean verify's after its `npm ci`, a work tree's after its own (`deps source
--sync`). Each heals the record first (`healRecord`): an entry whose folder no longer holds its package is repointed to
the harness's own `packages/` folder of that name, or dropped to npm when the harness has none, with a `deps-local-healed`
event, so a vanished folder never fails a launch, a sync or a verify; `worktree gc` heals every project's record once it
removed a package edit worktree. `--local` takes `packages/` of the harness's main checkout unless `--from` names another
folder. The push gate is `judgePush` (`core/deps/push-gate.ts`), run by `deps check` (the app pre-push hook of
`@starci/hfs`), `release push`, `release cut` and an executed `app release`. A package is fixed on a package edit branch
(`core/pkg/edit.ts`): `pkg branch` cuts it into a worktree of the harness with a push guard, `pkg test <package>`
(`core/pkg/test.ts`) runs the package's typecheck and lint scripts its `test` does not run already, then `npm test`, in
`packages/<name>` of the newest package edit worktree of the app that changes it, each under a heavy-command slot, and
is the `package-specs` check preset, `pkg handoff` records it in the host store's `package_handoffs` for Debug, and `release push` and `release publish` refuse it to every role but
debug and owner (`PKG_EDIT_PUSH_REFUSED`).

### Seats as a tree

`[Supervisor] <project>` (one per project, [state.md](../contexts/harness/state.md) "How a project is
found") > `[Kernel] <workflow>` (one per running orca workflow) > `[Op] <label> (<task id>) - <summary>` (one per attempt),
and `[Supervisor] <project>` > `[Worker] <project>: <topic>` (one per job the Supervisor hands out), each a real Orca agent, so
Orca lists a project's main checkout with its Supervisor, each workflow worktree under it with its Kernel, each Op worktree under that ("Op worktrees" above) with its Op, and each worker's
worktree with its worker. Every `supervisor` verb takes its project from the working directory (any checkout or worktree of the
project's repositories) or `--project <path>`. The owner runs `supervisor start` once per project: it reserves the
project's one Supervisor in machine.sqlite (`project_supervisors`, keyed by the Work-root repository's ledger id) and
launches the router's coordinator member (`orca agent launch --worktree path:<main checkout>`, terminal surface) in the
project's main checkout with a prompt naming its brief in the project's state folder (rendered from `ops/coordinators/`).
Its first command, `supervisor attach`, binds its terminal as coordinator of a new Run with a `[Supervisor] <project>`
task. `supervisor status` reads a project's liveness from Orca (with no `--project`, every live Supervisor's; one Orca lists
whose lease expired is `stalled (lease expired at ...)`, never alive),
`supervisor stop` closes its tab (the agent in it goes with it) and retires its row, and `supervisor ensure` starts one only
when Orca says it is gone (or replays a launch whose answer was lost), closing the old tab first; the host driver below does
the same for every project on every tick.
`workflow start` of an orca workflow runs only in the terminal of the Supervisor of the workflow's project
(`SUPERVISOR_REQUIRED` elsewhere): it makes (or reuses) the workflow's one git worktree (`workflows.worktree`, default
`<project state>/worktrees/<workflow>` on branch `starci/<workflow>`) and launches the Kernel by `worker-start
--run/--parent/--from` into that Supervisor's Run, titled `[Kernel] <workflow>`; `kernel start` relaunches one Orca reports
gone (any Kernel with `--replace`), or adopts a running workflow, under the same rule. A start first retires every Kernel seat
of the workflow still open (stopped, released, its tab closed) and refuses while Orca does not settle one, so a workflow never
holds two open Kernel seats (`startKernel` in `harness/kernel.ts`). Either records the workflow's coordinator (`workflow-coordinator`
event, `coordinator: supervisor`, `coordinatorOf` in `harness/kernel.ts`): a Supervisor sweeps only the workflows it owns in
its own project's repositories, and submits only for them (`PROJECT_FOREIGN`), and neither it nor `kernel start` (`KERNEL_FOREIGN`) touches one still
driven from a Kernel terminal another session adopted that no Kernel seat ever held, until Orca reports that terminal gone. The Kernel's first command, `kernel attach`,
adopts its terminal as coordinator of the workflow's child Run (taken back with `run-use` after a relaunch) and its
`[Kernel] <workflow>` task; every Op launches into that Run (`--run/--parent/--from` of the Kernel) inside its own Op
worktree ("Op worktrees" above), and verify lands it on the workflow's branch, so a relaunched Kernel or a retried attempt
continues from the code already there. Orca attests a caller that runs in one of its terminals as that terminal and fences a
`--from` naming another (`consumer_fenced`), and only a Run's coordinator may start a worker in it, so the Supervisor cannot
launch an Op as itself either: an Op launches only from the Kernel's own terminal (its `kernel next`) or from a process
outside Orca (`mayActAs` in `harness/kernel.ts`). A step run anywhere else, `supervisor next`, `supervisor tick` and the
amend a released need runs among them, settles and queues, and leaves each queued Op a `wait` for the Kernel (`launchWaits`
in `core/workflow/engine.ts`); `seat start` refuses such a launch before claiming the task (`CONSUMER_NOT_CALLER`). A launch
Orca fences anyway is a harness error: its attempt ends `consumer-fenced`, which spends no try or minutes, marks no stall,
reports nothing to the provider circuit and is no step of the lineage, and the task is queued again (`CONSUMER_FENCED`, a
`wait`, never a problem the Kernel acts on).

### Coordinators and their drivers

Coordinators decide; deterministic drivers do the rest, and a coordinator never ends its turn while its driver is its own
(it loops on the blocking `next`). `kernel next <workflow>` is the Kernel's driver: it drains the Kernel Run's mail, steps
the workflow (dispatch, verify, close seats), runs the budget ladder on its Ops (an attempt past its contract's
budget.minutes with no result is asked once to wrap up and file, then fenced `budget.graceMinutes` later as a red verify ends
one, both clocks leaving out the time the task's heavy commands waited in the heavy queue, those its verifies ran (tagged with
the task by `withHeavyBound`, a baseline checkout included) and those run in its own checkout (`taskQueuedMs` of
`harness/heavy.ts`), so the host's queue never asks or fences a task: seats closed, dirty allowPaths preserved and reset, the task failed `over-budget` with its try spent, its leases
released; `sweepOpBudgets` in `core/kernel/driver.ts`, `fenceAttempt` in `harness/fence.ts`; `supervisor tick` runs it too),
runs the stall ladder on its Ops (below), resolves an effect_unknown
launch through `request-show` with its attempt's request id (completed with a dispatch: that dispatch is judged by worker-show,
adopted when its worker started, fenced and the task queued again with no try spent when it never started its turn past
`stall.startDeadlineMinutes`; completed with none: replayed; absent past the deadline: stuck), holds the workflow `paused(orca-down)` while
Orca does not answer, and returns only one decision — `red`, `stale`, `question`, `conflict`, `goal`, `goal-change`,
`escalation-answer`, `shared-need` or `done`, with its evidence and a ledger digest — or `idle` after its wait. `kernel submit <file>`
applies one command: `workflow-change` (a change file or the whole desired workflow, through `workflow amend`),
`escalation` {budget, scope, conflict, owner, harness} or `handoff` (a Supervisor decision naming the repository, plus a
wake-up mail, or when Orca refuses the mail the Supervisor's loop prompt typed into its terminal: `mailOrType` of
`harness/orca/client.ts`, which the Supervisor's mail to a Kernel uses too; an `owner` escalation names its `topic` of `OWNER_TOPICS` {scope, money, credentials, legal, product} and may
propose a `default` with its `reason`, refused `COMMAND_INVALID` otherwise, in `harness/coordinator-commands.ts`); a command whose content (all but its cmdId, with its change file) was refused `poisonRefusals` times
escalates to the Supervisor (kind harness), and every later submit of it is refused at once (`COMMAND_POISONED`).
`supervisor next` sweeps the workflows the Supervisor owns in its project's registered repositories: a Kernel whose lease lapsed with no
progress past its TTL (a relaunch is not progress) is relaunched on Orca's word (gone, or idle), and once the relaunch
limit came with no progress the next relaunch pauses the workflow and escalates to the owner instead; a Kernel launch Orca
never confirmed (`launch-unknown`, or still `starting`) is reconciled, never launched beside: its dispatch (the one the failed
worker-start named, else request-show's receipt, else a replay of worker-start under the same request id) is adopted when its
worker started, when the Kernel's own `kernel attach` came through from that dispatch's live terminal, or when that live
terminal printed after the launch (Orca may keep such a worker at `start_unknown`); while it waits, and before it is adopted on
its terminal's print (the paste itself prints), a dispatch left pasted in the agent's composer, its marker anywhere on a row or
wrapped over two, is submitted again with a bare Enter (routing.yaml `pendingComposer`, for Ops too, and before any stall nudge
of an idle Kernel or Op); a live terminal that stayed quiet is never
fenced (waited on past `stall.startDeadlineMinutes`, escalated past `effectUnknownDeadlineMinutes`); only a worker Orca reports
gone, or one never started past the deadline whose terminal Orca no longer lists, is fenced, closed `launch-failed` and
relaunched once, and only once the fence held (`resolveKernelLaunch` in `core/supervisor/driver.ts`); a live Kernel idle at
its prompt meets the stall ladder; every open `owner` escalation that is a `product` choice carrying a default is decided on that
default (`ruleDefaults`, by `defaultRuling` of `harness/coordinator-commands.ts`: the escalation answered by `default:<Supervisor>`,
its Kernel given an `escalation-answer` whose ruling is the default, an `escalation-defaulted` event keeping the reasoning), so the
owner never sees it; it returns the project's oldest `escalation`, `handoff`, `shared-need` or `kernel-undecided` (a decision its Kernel left undecided, below) the Supervisor rules, then the oldest `owner-request` (`supervisor ask` and the Telegram bridge record
it in the project's mailbox, machine.sqlite `owner_requests`, and mail the Supervisor's Run as `kernel submit` does, `askSupervisor` in
`harness/owner-ask.ts`), and only then, once each (a `decision-relayed` event), one awaiting an answer from outside: kind
`owner` with no default it may rule, which the owner rules, or `harness`, which Debug rules (`awaitsOwner` in
`harness/coordinator-commands.ts`); each is filed as its ticket first ("Tickets"). A `next` blocking on its wait renews its caller's lease every `nextPollSeconds`. `supervisor submit <file>` applies `goal`, `goal-change` (goal version n+1), `stop` or `need-owner` ("Shared needs"),
or a ruling in a Kernel's place, the Kernel's own `workflow-change` or `escalation` answering a `kernel-undecided` decision,
and its `answers` close decisions and owner requests (each recording the command's cmdId) (the escalating Kernel of another workflow gets an `escalation-answer`); a `stop` ends
every open decision of its workflow.

### Supervisor dispatch

The Supervisor works through workers (`core/supervisor/workers.ts`). `supervisor dispatch --brief <file|text> [--need <key>] [--label]
[--repo] [--allow]... [--input name=value]... [--check <preset>]...`, from its terminal, makes the worker's own worktree of `--repo` (default the
project's Work-root repository, or any other checkout; a `@starci` package fix stays in the app's repository with
`--input package=<name>`, and the worker cuts its own package edit branch, `pkg branch`, and hands it off) at `<project state>/worktrees/<worker>` on branch `starci/<worker>`, queues in that repository's ledger a task
whose contract is the brief on the label's op (default `code`; with no `--allow`, its one report file) plus its checks
(`workerContract`): each `--check` preset of ops/checks.yaml, its arguments taken from the `--input` of the same name (a
name no preset has is refused `CONTRACT_UNKNOWN_PRESET`), and for a package fix of a label that needs a behavioural check
the `package-specs` check of its package, with `side=package` and `edition=harness` filled where the op declares them, so
it reads the package contexts of ops/ops/code.md; a harness fix (`--input side=harness`) reads CONTRIBUTING.md, the
branch tier and the generated section index of this file (`contexts/harness/cli-sections.md`, `contexts anatomy` keeps it
fresh), never this whole file, and opens the sections it needs with `contexts anchor`; a contract still unfit is refused `CONTRACT_UNFIT`
with a `fix:` line per problem the dispatch can answer (the `--check` and `--input` that supply a behavioural check, the
package input that fits the context budget), before any worktree is made,
records the worker in `supervisor_workers`, and launches it as `seat start` does (`startSeat` with the Supervisor as
coordinator: `--run/--parent/--from` of the Supervisor, title `[Worker] <project>: <topic>`), routed by the label's worker
tier. Every `supervisor next` round from the Supervisor's terminal tends the project's workers (`tendWorkers`): it pings each
running one past its launch grace (Orca's word that it is gone makes it lost), closes the seat of one that reported, failed
or was lost, and launches the queued ones into free slots; then it returns, after the escalations and handoffs the
Supervisor rules and before owner requests, each worker completion once as kind `worker` (`nextWorkerEvent`). `supervisor
accept <worker>` settles one that reported done with `task verify` (green commits on its branch, red fails it), `supervisor
reject <worker>` cancels a live one, and `supervisor workers` lists them with their seat's liveness. A project runs at most
`projectMaxWorkers` worker seats at once (ops/routing.yaml), every open worker seat of its repositories' ledgers and its own
workers elsewhere counted together (`projectSlots` in `harness/project-workers.ts`): a dispatch past it waits queued, and a
Kernel's launch past it is a wait whose task stays queued (`launchTask` in `core/workflow/engine.ts`), before any route is
picked, so the cap never sends work to another provider.

### The host driver

The host driver keeps the tree alive with no LLM awake. `supervisor tick` is one idempotent pass for a scheduler to run
every minute (`supervisor watch` loops it in a foreground terminal, every `stall.watchSeconds`, and once a new build of the
CLI's dist stands it starts its replacement from that build, detached onto its own stdout and stderr, records a
`supervisor-watch-reloaded` host event and exits, so it never ticks with modules a build replaced and one watch process runs): first the terminal sweep
(`harness/terminal-sweep.ts`) closes the tab of every Orca terminal the harness made — its handle recorded by a seat of a
registered ledger or a Supervisor row, or its title `[Op] `, `[Kernel] `, `[Supervisor] `, `[Worker] ` (or Orca's `worker-task_` inside a
workflow worktree) — that Orca lists orphaned or that no open seat, open Kernel record or live Supervisor holds (an unrecorded
one only once quiet past `effectUnknownDeadlineMinutes`), and never touches any other terminal (`--dry-run` reports what it
would close and does nothing else); then it records Orca's full terminal list, by which a pool count (`runningWorkers` in
`harness/machine.ts`) leaves out a seat whose terminal Orca no longer lists, and closes `launch-failed` every Kernel launch of
any registered ledger still unreconciled past `effectUnknownDeadlineMinutes` with nothing of it alive
(`harness/stale-launch.ts`), so an abandoned launch stops holding a slot; a ledger `project retire` retired is read by none of
it (retiring also removes the project's harness worktrees, their work preserved, and detaches the repository from Orca's
project list with `orca project setup-delete` once Orca lists no other worktree of it); then `ensureSupervisors` keeps
the Supervisor of every project that owns a running orca workflow, or whose last Supervisor ended by anything but the
owner's `supervisor stop` (started when Orca says it is gone); then, acting for each attached Supervisor (its terminal as
`--from`, its lease left to its own calls), it runs the Kernel sweep of that project's repositories with the Ops' stall
ladder and the ready-idle wake of each owned workflow (below), and that Supervisor's own ladder. A host store of version 2 kept one host Supervisor in its
`supervisors` table; a workflow whose Kernel was launched into that Supervisor's Run is adopted by its project's Supervisor
on the first tick (a `workflow-coordinator` event naming `adoptedFrom`), its Kernel left running there while Orca shows
that terminal, and relaunched into the project Supervisor's Run once the tick retires the host row (ended when Orca reports
its terminal gone, never deleted; `adoptFromHost` in `core/supervisor/driver.ts`). The scheduler that runs it is registered by the `host` verbs below.

### The desktop app's API

`starci ui` (`core/ui/`) serves the contract of the StarCi Harness desktop app
(`core/ui/contract.ts`, the one owner of the types, which the app in [app/](../app/README.md) imports) on 127.0.0.1 with a bearer token it prints beside its URL; CORS answers only
the Tauri origins and the app's dev server, and a Host that is not that loopback address is refused. Its reads go through the
readers behind the read verbs (`core/ui/read.ts`: the registry's repositories and projects, each ledger's workflows, graph,
seats, decisions and events, the host store's circuits, quota and Supervisors, the router's recorded pick or a dry run, the
lanes' flow, `config list`); the owner's inbox is the open Supervisor decisions `awaitsOwner` names. Every write runs its verb
in-process as the owner, one at a time (`core/ui/write.ts`): `workflow pause|resume|stop`, `config set`, a new goal and a
ruling. Both of the last are the `goal-change` a Supervisor relays (acceptance and scope kept; a ruling keeps the goal, carries
the ruling as its note and answers the escalation), written as an owner command file in the project's state folder and applied
by `supervisor submit`; each inbox decision carries that exact command. A task's answer carries the last rows its open seat's
terminal renders, read from Orca once per request (`terminalRead`), never polled. `/api/events` polls each ledger's newest event id, the host store's rows and the settings files every second while a
client listens and sends each change as a `data:` line, with a heartbeat comment every 15 seconds (`core/ui/live.ts`).

### The host

[ops/host.yaml](../ops/host.yaml) lists what a host runs for the harness (Orca, Docker, the Supervisors, the
scheduled tick, the Telegram bridge), each with its check, its start and how it is installed; `harness/host.ts` reads it and runs every argv
without a shell. The owner runs `host install` once: on Windows each schedule is a `StarCi <name>` scheduled task whose
action is `wscript //B <state base>/host/<service>.vbs`, which runs the `.cmd` beside it with its window hidden (changing
to the runtime root, setting the service's environment, appending its output to its log, every token quoted), so the
scheduler's command line carries one quoted path; `--dry` prints that argv and both files and writes nothing, and other
platforms are refused (`supervisor watch` in a terminal serves there). `host status` reports each service up, down or not
installed with its evidence, and lists every other StarCi-named task (a disabled one as legacy) without changing it;
`host up` starts what is down in `requires` order; `host uninstall` removes only the schedules ops/host.yaml declares.

### Host secrets

`harness/secret-env.ts` is the one reader of a credential: `lookupSecret(key)` returns the key from the
process environment, else from `secret.env` at the harness root (the folder above policy/; `STARCI_SECRET_ENV` replaces the
path, and the bench points it at its run's own file), parsing dotenv lines (`KEY=VALUE`, `export`, quotes, `#` comments) and
keeping no other key. It reads only the keys [policy/security.yaml](../policy/security.yaml) `secretKeys` lists and refuses any
other `SECRET_KEY_UNLISTED` before it opens the file; no message, envelope or evidence carries a value. A host service
(`telegram-bridge`, `supervisor tick`) reads the file itself, so a key `host up` strips from its environment still arrives.
[secret.env.example](../secret.env.example) names every key the host's secret.env holds. A provider key the owner sets once
for several apps (`OPENROUTER_API_KEY`) reaches each app's sealed custody through `app secret set <env> <member> <KEY>
--from-host <HOST_KEY>` (`core/app/secret.ts`): the CLI reads HOST_KEY through the loader and hands the value to @starci/hfs as
the stdin `set` reads, so no shell, argument, output, error or evidence carries it; an unlisted key is `SECRET_KEY_UNLISTED`,
a listed one the host lacks `HOST_SECRET_MISSING`. Full and lite apps keep the same custody (`.starcistacks/<env>/secrets/<member>.enc`
under the app's `.sops.yaml`), so the verb serves both. Another shared key is one line in `secretKeys`, its entry in
secret.env.example and one `set --from-host` per app.

### The owner's Telegram channel

The owner's channel is the Supervisor's terminal, the desktop app and Telegram
([ops/telegram.yaml](../ops/telegram.yaml), `harness/telegram.ts`, `harness/telegram-bridge.ts`). The bot token
(`tokenVariable`) comes from the secret loader above; a verb that would call the bot without it refuses
`TELEGRAM_NOT_CONFIGURED`, naming the key and where it is set, `connect telegram status` reports its `source` (never its value),
and every error text has the token replaced. `connect telegram discover-chat` reads the bot's updates once and stores the one private chat that wrote to
it (`--chat` picks among several) in machine.sqlite `telegram_channel`, never in a repository; no fact older than that moment
is sent. A notice sweep (`connect telegram notify`, every bridge cycle, and every `supervisor tick` once the token is set and the
chat stored, its failure reported and never failing the tick) sends, oldest first and at most `sendPerMinute`,
each fact not sent yet across every registered ledger, after filing every escalation the Supervisor cannot rule as its
ticket, of the kinds ops/telegram.yaml `notices` lists (by default `question` alone: only what needs the owner's decision): a
question ticket put to the owner (`question`, `ticket:<id>:ask`: project, workflow, topic, the question, the proposed default,
how to answer) and, while it stays live, its reminder every `reminderHours` after the card went out, a reply to the card with
its buttons keyed by the count of periods elapsed (`ticket:<id>:remind:<n>`), so at most one per period however often the
sweep runs; a defect ticket's opening and its close (`defect`), once per state and round, only when it is blocking or seen more
than `ticketOccurrences` times and while the owner has not muted them; an owner request a Supervisor command took up
(`request`); and a workflow that is done, blocked or stopped (`workflow`), keyed by its status and a hash of its reason, never by
its goal or graph version, which a Kernel amending a blocked workflow bumps every minute (`workflowNoticeKey`). A kind left out is
never read and never sent; it stays on `/tickets`, `/status`, `ticket list`, the harness UI and the monitor's report. A ticket's notice is its card
(`harness/telegram-tickets.ts`): the one banner of ops/telegram.yaml `banner`, uploaded once and then sent by the file id
Telegram keeps it under (machine.sqlite `telegram_files`, uploaded again when its content changes), its Vietnamese HTML
caption the ticket's facts (id, kind, severity, title, project, workflow, occurrences, what was tried; a question's proposed
default; an end's commit, reason or answer), and an inline keyboard whose callback data is `tk:<action>[:<ticket>[:<choice>]]`:
a defect's "Xem chi tiết", "Giao Debug" (`ticket take` for Debug), "Danh sách ticket" and "Tắt tiếng 1h" (defect notices wait
`muteMinutes`, `telegram_mutes`); a question's "Đồng ý mặc định", one button per `--option` its asker listed, and "Trả lời
khác…" (the owner's next text answers it, `telegram_pending`); a fix's "Xem commit" (`commitUrl`) and "Mở lại". Each fact is claimed in `telegram_notices` by its key before it is
sent, so it is sent once; a failed send is tried `sendTries` times. `supervisor telegram-bridge run` holds the host's one
bridge seat (pid and beat; a second bridge exits while the first is alive) and loops a sweep and a `getUpdates` long poll;
each update is claimed once in `telegram_inbound`. A message of any chat but the owner's is ignored and logged by its chat
id, never its text; the owner's reply to a live question ticket's notice, or `/answer <ticket> <text>` (`default` accepts the
proposed default), answers that ticket as the owner's; any other reply to a notice, `/answer <id> <text>` or `/ask <project>
<text>` is recorded as an owner request of that project by the owner (`askSupervisor`, as `supervisor ask` does), which wakes
its Supervisor; the owner gets one short receipt either way (an answer's is `Answered <ticket>: <answer>`). `/status` sums up
the workflows of every registered ledger in one message: per project the count by status, each blocked workflow with its
reason and each running or paused one, then the questions awaiting the owner and the open defect tickets. `/tickets` lists the open tickets, blocking first, with a button per
ticket and "Đã đóng hôm nay"; `/ticket <id>` shows one in full, its evidence, waiters and red tail redacted. A button press
(`callback_query`) is acted on only from the owner's chat, through the ticket functions the verbs use, then answered
(`answerCallbackQuery`) and its card's keyboard edited to the new state (`editMessageReplyMarkup`); a press from any other
chat is ignored and logged by its chat id. `supervisor telegram-bridge status` (alive, stale or absent) is the host service's check.

### Tickets

What the Supervisor cannot resolve within its authority is one ticket in machine.sqlite `tickets`
(`harness/tickets.ts`): a defect (`harness-defect`, `package`, `launch`, `verify`, `routing`, `other`) for Debug, or a question
(`question:business`, `question:code`, `question:spec`) for the owner, with its severity, evidence (task, attempt, seat,
decision, the red tail, redacted), what was tried, its proposed default, who opened it (role and Orca terminal) and every role
that reported it. A ticket is deduped by its fingerprint (a defect's kind, error code and module, else its normalized title;
a question's kind and normalized title): a repeat bumps `occurrences`, reopens a `fixed` defect for another round, and finds an
answered question answered. `supervisor next` from the Supervisor's terminal, every `supervisor tick` and every notice sweep
file each open `owner` escalation `awaitsOwner` holds, with or without a topic, as a `question:business` ticket (its topic,
its `default` as the proposed default), each `harness` escalation as a blocking `harness-defect` ticket, the escalation
waiting on it in `ticket_waiters` (`ticketEscalation`), and each task left `awaiting_owner` as a blocking `verify` ticket
naming its verify's last reason (one a custody block left as the owner's `question:business` on credentials, or as the
`harness-defect` of the harness module it names), the task
waiting on it (`ticketEscalations`); `supervisor next` sends the owner's Telegram
notices in the same round when it filed one (`tickNotices`), as the tick does; the Supervisor files anything else with `ticket open` (roles supervisor, owner, debug:
the monitor), whose `--task` and `--decision` wait on it and whose `--default` and `--option` are a question's answers. `ticket list [--state] [--project]` is Debug's queue, blocking first,
then by occurrences; `ticket show` reads one; `ticket take` (debug, owner) marks a defect in-progress; `ticket close --fixed-by
<sha> | --wontfix --reason | --duplicate <id>` (debug, owner) ends it, a duplicate of a live ticket handing over its waiters;
`ticket answer --answer | --accept-default [--why]` (owner, and the bridge for a Telegram reply) answers a question. An end is
recorded with who gave it and why, releases every waiter and wakes the Supervisor of each waiter's project (and of the
ticket's, when the Supervisor opened it) with an owner request by the closer naming the ticket, the fix or answer and what it
released (`wakeOnClose`); every later brief of the workflow lists it under "Answers" (`harness/brief.ts`).
The **stall ladder** (`harness/stall.ts`, thresholds in ops/liveness.yaml `stall`) reads no screen: a seat with work pending (a
Supervisor decision it rules, never an `owner` or `harness` escalation it waits on, or an owner request, or a Supervisor's
expired lease alone, its loop stopped; a Kernel decision or a node its driver acts on; an Op's unfiled running task) and no driver call (lease
renewal; an Op's output) for `idleMinutes` is stalled when Orca says its agent is idle at its prompt (`terminal wait --for
tui-idle`, or no output in `terminal list` and worker-show and no dispatch heartbeat for `quietMinutes`). It is nudged with its
role's loop prompt (`terminal send`, one claimed `stall-nudged` event per nudge, at most `nudgeMax`); a nudge unanswered past
`nudgeGraceMinutes`, or a stall after the last nudge, gives it up (`stall-gave-up`): its member records a `stalled` outcome and
its provider circuit the kind worker-show's failure words name by `failureSignals` (capacity, rate, quota, auth), and no circuit at all when they name none (a plain stall is the model's, judged by its outcomes);
an Op is fenced and its task failed `stalled` for the Kernel to retry, and a Kernel is relaunched and a Supervisor replaced
on the coordinator tier's listed order (another member only while the circuit or quota takes the first out, `decide` in
`harness/router.ts`); a member that gave up `coordinatorStallMax` plain stalls of the same seat within
`coordinatorStallWindowMinutes` raises a `harness` escalation. The Kernel relaunch limit escalates to the owner; a Supervisor replaced that many times
with the same decision waiting is left for the owner. A Kernel alive by Orca's word whose dispatching workflow holds ready or
queued tasks and no live Op since the later of its last progress and the seat's launch, while its project has a free worker
slot, meets the same ladder from the tick (`readyIdle` in `core/supervisor/driver.ts`): past `readyIdleMinutes` it is typed
`prompts.readyIdle` naming the ready tasks, once per seat and idle spell; past `readyStallMinutes` it is given up and relaunched
as remedy 2 does, once per seat (`ready-idle-woken` events). Work the Kernel leaves undecided meets the tick the same way
(`decisionIdle` in `core/supervisor/driver.ts`): an open Kernel decision, or a failed or returned task whose last decision
was answered without moving it while no escalation of that answer or of a Supervisor ruling on it is open, past
`decisionIdleMinutes` (from the later of that decision, the task's last change and the seat's launch) types the Kernel
`prompts.decisionIdle` naming each, once per seat and item; past `decisionStallMinutes` the item is handed to the Supervisor
as one `kernel-undecided` decision per item and clock (`handUndecided`), carrying the Kernel decision in full and the task's
evidence (label, state, try, result, output, red checks, routes and gate, the tasks it holds up), and none is ticketed; one
whose item the Kernel decides meanwhile is superseded. Neither relaunches the Kernel (`decision-idle` events). The Supervisor
rules it in the Kernel's place with the Kernel's own `workflow-change` or `escalation` answering the `kernel-undecided`
decision (`RULING_COMMANDS` in `harness/coordinator-commands.ts`): admitted under the Kernel's route and need checks on the open
Kernel decision it rules (`rulingAsKernel`), applied as the Kernel's command (`applyKernel` in `core/kernel/driver.ts`), the
Kernel decision answered by its cmdId and a `ruled-by-supervisor` event recorded (`recordRuling`), which `kernel next` returns
in its `rulings` once to the Kernel seat (`supervisor-ruling-told`). A ruling escalation is only of kind `owner` or `harness`
(`RULING_WITHIN_AUTHORITY` otherwise, and for a product choice that carries a default), so it alone becomes a ticket: a
question to the owner or a defect for Debug. A route a ruling takes counts toward its limit as the Kernel's does. Nudges,
wakes, give-ups and a ruling told are never progress.

### Coordinator commands

A command is a `starci/command@1` file (json or yaml): `cmdId`, `kind`, `workflow`, `basedOn` {graph, goal}, `answers`
(decision ids), and its kind's field (`change`, `goal`, `escalation`, `handoff`, `mode`, `need`, `hold`; `project` for the Supervisor),
plus `settle` (`discard` or `repair`) on a Kernel's answer to a decision on a task ("Settling an attempt").
A `workflow-change` that answers a red, question, check-premise or conflict decision on a task with no change and no need holds
the task where it stands, and names the one condition that releases it (`hold`: `ticket`, `commit` on harness main, `need` or
`time`; `tasks` names, by plan key, the tasks a hold answering an `escalation-answer` or `goal-change` keeps), refused
`HOLD_UNCONDITIONED` without one (`assertHold` in `harness/holds.ts`) and admitted off the decision's route; the hold is a `task-held` event, the
task leaves `decisionIdle` while it holds, and `releaseHolds` (every `settleWorkflow`, so every tick and step, and
`wakeOnClose` for a ticket's close or answer) releases it once the condition is met (`hold-released`): a task the harness ended
comes back to ready at the same try (`hold-revived`, past `reviveMax` too), any other has its Kernel decision reopened. It is
admitted before any side effect into `commands` with its sha256 (an `applying` intent row): a known cmdId replays its
outcome, other bytes refuse `CMD_CONFLICT`, a stale `basedOn` refuses `STALE`. Decisions are raised once per fact into
`decisions` and closed by the command that answers them, or superseded when the ledger moves past them. Mail (`orca
orchestration send|check`) only wakes: an Op mails only its Kernel, a Kernel only its project's Supervisor and its Ops, a
Supervisor only the owner. A Kernel stays the Dispatch of the Supervisor Run that launched it, so every mail to the Supervisor
(`wakeSupervisor`: an escalation, question or handoff, and an owner request) picks its sender at send time, the caller's
terminal when its seat's Run is the current Supervisor's, else the Supervisor's own terminal, which Orca accepts where it
refuses a Dispatch of a replaced Supervisor's Run (`dispatch_run_mismatch`); a mail Orca still refuses is replaced by the
Supervisor's loop prompt typed into its terminal (`mailOrType`). A Kernel takes a question only from a sender of its Run tree (its own Ops' terminals or its
project's Supervisor's); any other sender's mail is a `mail-impostor` event and is dropped. A repository Orca does not know is registered by its main checkout (`orca repo add`), so a workflow worktree is listed under its repository, and the call retried once. A
seat's terminal lives exactly as long as the seat: its tab is closed right after Orca fenced its worker (released, or ended and
retained), and the tick's sweep closes one that outlived it (`closeWorker` in `harness/orca/client.ts`). Inline workflows touch nothing in Orca: the chat agent is
their Kernel, and `kernel next` returns `idle` naming its next task.

### Routing and liveness

Routing and liveness are data: [ops/routing.yaml](../ops/routing.yaml) (tiers, pools, balance, quota, Orca usage,
provider circuit and its half-open probe, outcomes, qualification, scoring, AIMD concurrency, the workflow and project
parallel caps, workflow budgets, and the
`coordinators` tiers: a Supervisor or Kernel is routed through the same circuit, quota, probe, scoring and balance as an
Op; the router's steps are [ops/README.md](../ops/README.md)'s) and
[ops/liveness.yaml](../ops/liveness.yaml) (thresholds, the Orca answers that prove a worker gone — anything else is
unknown, never dead — the `coordinators` block: seat lease, Kernel and Supervisor TTLs, relaunch limit,
effect-unknown deadline, conflict wait, poisoned-command refusals, and how long `next` waits — and the `stall` block of the
stall ladder and the host driver). `starci route explain --label <label>` prints a pick step by step; a
label naming a coordinator (`supervisor`, `kernel`) explains that seat's pick through `pickCoordinator`.
