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
[CONTRIBUTING.md](../CONTRIBUTING.md); publishing is CI's, on every push to main (CONTRIB-20).

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

**Ledgers.** [contexts/harness/state.md](../contexts/harness/state.md) says where the files are; `harness/ledger.ts` owns
every path. A project ledger (`runtime.sqlite`) holds `workflows`; `plan_nodes`, `edges` and `graph_versions` (each
graph version's nodes with contract hash, node hash, routing hints and retry round, and why the version was recorded);
`tasks`; `attempts` (one per dispatch, with the router's pick record); `results` (immutable, one per attempt);
`check_runs` (every check of every verify with its status, exit code and detail: the tail of its output, at most `EVIDENCE_LINES` of `shared/output.ts` per tool run, with every value `redactSecrets` of `shared/secrets.ts` recognises redacted, which `task status` prints for the red checks of the newest verify); `seats`; `messages`; `events` (append-only); `prior_work`, which indexes by workflow, plan key, contract hash,
attempt, kind and sha256 every attempt's work (the preserved patch of a cancelled or red one, the committed diff of a
settled one) kept in the project's never-pruned `prior/<sha256>.patch` store (`harness/prior.ts`); `check_rows`, the green
check steps by input digest (`harness/check-reuse.ts`); and `meta`. The host's `machine.sqlite` holds only host-wide state:
`ledgers` (the registry keyed by the git common dir), `provider_health`, `provider_events`, `pool_quota`,
`pool_concurrency`, `route_picks`, `budgets`, `budget_raises`, `host_events`, `owner_requests`, the heavy-command
governor's `heavy_slots` and `cpu_samples` (`harness/heavy.ts`), `project_supervisors`, one live
Supervisor row per project key (`harness/machine.ts`, `harness/supervisor.ts`), `supervisor_workers`, each `[Worker]` a
Supervisor dispatched (`harness/project-workers.ts`), and the Telegram channel's
`telegram_channel`, `telegram_notices` and `telegram_inbound` (`harness/telegram.ts`).
A Kernel is a `seats` row of its workflow (role `kernel`); every seat holds a TTL lease (`lease_until`); `commands`
and `decisions` hold the coordinator protocol; `workflows.worktree` names a workflow's worktree and `tasks.worktree` a task's
own checkout. Seats stay in the project ledger.
Additive migrations bump the corresponding machine schema version or `LEDGER_VERSION`; migrations never drop. Every
store is opened through one function (`connect` in `harness/ledger.ts`), which reads its header first: a file that is
no SQLite database or a damaged one is refused `LEDGER_CORRUPT`, naming the file and its recovery, and is never written.

**Task states.** `TRANSITIONS` in `harness/tasks.ts` is the one state machine, changed only through `setStatus`, a
compare-and-swap on the status it read (the loser of a race is refused `TASK_STATUS_RACE`):
`queued → running → reported → verifying → done | failed | awaiting_owner | cancelled`, plus `effect_unknown` (a
launch Orca could not confirm or deny, or a running task whose worker Orca reported gone). A launch that certainly
failed returns the task to `queued`; a red wave verify returns a `done` task to `failed` (its only way out; it holds
nothing either way); a verify with no verdict returns it to `reported` with no try spent, until one
result has reached no verdict `settleNoVerdictMax` times ([ops/liveness.yaml](../ops/liveness.yaml)): then the failure is
persistent and the task ends `awaiting_owner` with the last reason (`noVerdict` in `core/task/verify.ts`). A command
with side effects claims an intent on the task first: `cancelling` before a cancel stops seats or resets paths (a
verify or result arriving later is refused `TASK_INTENT_HELD`; a cancel refused half-way keeps it and resumes when run
again), `repair` when a preserve saved the work but could not put every path back (a held file on Windows); a task
with an intent keeps its worktree, and `task verify --recover` finishes the reset from the preserve's `manifest.json`.
Each task records its checkout (its Op worktree, else the one it was sent from), and verify, cancel and a failed result
act there whatever checkout the caller is in.

**Op worktrees.** Every task of a workflow, under either runner, works in a git worktree of its own,
`<project state>/worktrees/<workflow>.ops/<task>` on branch `starci/<workflow>.ops/<task>`, cut when its seat starts (or
its inline step hands it out) from the head of the branch its workflow's worktree has checked out (an inline workflow
without one: the checkout it runs in), beside that worktree rather than inside it, since git keeps no branch below another
branch's name and a nested checkout would sit in the workflow's tree. It gets the product's hooks and links each
node_modules folder of that checkout (a junction on Windows), never a fresh install (`ensureOpWorktree` in
`harness/land.ts`). No path is held while a task works: two tasks may write the same file at once. Under the orca
runner the worktree is listed in Orca under the workflow's worktree as `[Op] <workflow>: <task>`, and the workflow's
worktree under the project's main checkout as `[Kernel] <workflow>` (`orca worktree set --parent-worktree`), so
Orca's worktree tree shows Supervisor, Kernel and Op whichever worktree each terminal runs in. Every worktree the
harness made is removed once its owner's work ends ([contexts/authority/README.md](../contexts/authority/README.md)
"Worktrees"): an Op's by verify, cancel and a failed result at once, and by every `workflow step` for a task a fence,
a stall or a crash ended (`sweepOpWorktrees`); every other kind, and any orphan, by the collector `worktree gc`, which
`supervisor tick`, `supervisor accept` and `reject`, and a workflow step of a done or stopped workflow run
(`harness/worktree-gc.ts`). Removal preserves uncommitted work first, unlinks the install links with a plain unlink,
never a recursive delete through a link, then removes the worktree through `orca worktree rm` for an orca run (git
when Orca is not used or left the folder) and prunes; an Op's branch is deleted once its tip is on the branch it
landed on, every other branch is kept.

**Settling.** `task verify` first stops the task's worker seats (refused `VERIFY_WORKER_LIVE`, nothing changed, when
Orca cannot confirm the stop), then builds a candidate from HEAD of the task's checkout plus its work under its
`allowPaths`, rebases it onto the head of the branch it lands on without a work tree (`git merge-tree --write-tree` with
the candidate's parent as the base, `rebaseCandidate` in `harness/land.ts`), and replays every check on a clean checkout
of that rebased commit, never in the worker's environment (a workflow task's heavy checks wait for its wave, below), so
what is verified is what lands; what the candidate misses
is read against the same staged snapshot. A textual conflict is never resolved by the harness: no check runs, the work
is preserved, the attempt ends `conflict` and the task fails without a verdict, and the Kernel gets a `conflict`
decision to amend the node on the new head, whose retry starts from the preserved work. A task working in a checkout it
shares (one sent from the owner's checkout) records its checkout's tree as its baseline when its work begins
(`beginWork` in `harness/baseline.ts`), and a dirty file unchanged since then is left out of its candidate, its
`paths-only` stray files, the lint and typecheck of its `check run --task`, and its preserve and reset; an Op worktree
holds only its task's work and records none. Every candidate also meets the `lands` check, red when work under its `allowPaths` would not land
through the harness (a dirty file missing from the candidate, or a commit without the `Starci-Task:` trailer made under
them while the task ran, as a worker that commits itself leaves), and the `secrets` and `loosening` gates of the
project's runtime tier ([policy/quality.yaml](../policy/quality.yaml)) on the files it changes, whatever its contract
says (`harness/clean-verify.ts`). Its scoped `starci check` runs over what the candidate changes, or, when it changes
nothing, over the tracked files under the `allowPaths` (`runScopedCheck` in `harness/run-checks.ts`), red when no step
ran; `check run` first builds the workspace dependencies whose entries the clean checkout lacks, or restores them from
the build cache (`core/check/workspace-deps.ts`, cache path in `harness/ledger.ts`), as
[contexts/project/lint.md](../contexts/project/lint.md) states. Green commits only those paths (never pushed; a candidate that changes nothing commits nothing and its result hash
reads the tree of its `allowPaths` at the head it settled on) and makes the task done and records its settle commit
(`tasks.settle_commit`) in one transaction; red preserves and resets its paths and fails it; either way the task's Op
worktree is removed. A verify holds its task's verifier lock throughout, and the land lock of the branch it lands on
(one per branch, `landLockKey` in `harness/land.ts`) only while its verified commit is integrated: an Op's lands by
`git merge --ff-only` in the target checkout, which moves branch, index and work tree together and refuses rather than
overwrite a local edit, a task in the checkout it lands on by moving the ref. Verifies of one workflow run side by side;
when another task landed between a verify's rebase and its landing, it verifies again on the new head under the land
lock, so each lands on the head the previous one left. A lock's holder stamps a heartbeat, so a dead holder whose pid
Windows reused is taken over once the beat goes stale (`withSettleLock` in `harness/settle.ts`). Git is the authority
for landed: a task left verifying by a verifier that no longer holds its verifier lock (dead, or its beat stale) is
reconciled by `task verify --recover`, which every `workflow step` (and so `kernel next`) runs on such a task before it
settles: done when the branch it lands on carries the settle commit (its message and `Starci-Task:` trailer after the head
the verify started from), else back to `reported`, which the same step verifies. Git runs through one runner (`captureGit` in
`shared/git.ts`) with `core.quotePath` off and `core.longpaths` on, and every path listing the harness parses is
NUL-separated (`-z`), so a non-ASCII or deep path is never quoted or cut.

**Wave verify.** The tiers are [contexts/authority/](../contexts/authority/README.md)'s; policy/quality.yaml `verify.tier`
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
coverage). A red check belongs to the tasks whose landed files its output names (every task that left it when it names
none): those tasks go `done → failed` with the red rows on their attempt (`wave-returned`), back to the Kernel like any
red verify, and every task of the wave is judged (`wave-judged`, `wave-verified`). `workflow wave <id>` runs a due wave by
hand.

**Install cache.** A clean checkout never runs its own `npm ci` when the shared install exists: `cachedInstall`
(`harness/install-cache.ts`) keys an install by the lockfile's bytes, Node's version and npm's
(`<state base>/cache/installs/<key>`, path in `harness/ledger.ts`). A miss runs `npm ci` in the checkout and copies its
node_modules into the cache (staged, then renamed into place), recording the links npm made to the checkout's own folders
(workspace members) relative to the install folder; a hit gives the checkout a real node_modules whose every package is a
link into the cache (a junction on Windows), those workspace links re-made to the checkout, and a marker. A repository in
local package mode gets a copy instead, then the same `reapplyLocal`. Before a checkout is removed, and when a leftover
one is pruned, every link in its node_modules is removed with a plain unlink (`unlinkInstallLinks`), never a recursive
delete through it.

**Heavy-command governor.** Every heavy command the harness spawns (tsc, eslint, a command check, a workspace or package
build, `npm ci` or `npm install`, a contract's setup, a uat container) runs through `withHeavySlot` of
`harness/heavy.ts`: one slot of a host-wide semaphore (`heavy_slots` in the machine.sqlite of the harness's main checkout,
or of `STARCI_LOCAL_ROOT` when set: `governorStorePath` of `harness/ledger.ts`, so every worktree of the harness shares
it) while it runs, admitted by free
memory and the CPU average over a window (samples in `cpu_samples`), with the limits, memory caps and seat floor in the
`heavy` block of [ops/liveness.yaml](../ops/liveness.yaml). A command with no slot waits in the queue, says so on stderr
and records a `heavy-wait` host event; waiting never fails it. Each child runs below normal priority, a node tool under
its kind's `--max-old-space-size`, a uat container under `--memory`, a jest or vitest run with `--maxWorkers` (1 under
pressure), and inherits `STARCI_HEAVY_HELD`, so a `starci check run` it starts runs under its slot instead of waiting on
it. `check heavy-sites` (a CI gate) is red for a spawn site in `cli/src` that runs a heavy command outside the governor.
`seat start` refuses `SEAT_RAM_LOW` while free memory is under the seat floor, which `workflow step` reports as a wait.
`host load` prints the load, the slots in use with each child's pid and RSS, and the queue.

**Result reuse.** `check run` keys each typecheck and lint step by the digest of its inputs (`checkDigest` in
`harness/check-reuse.ts`: the gate, the judged files, the content of the package and the workspace packages it reaches
and of the repository's root files, dirty files hashed as they stand, Node's version and the tool's) and keeps green
steps in the project ledger's `check_rows`; a step whose digest has a green row is that row, reused and never rerun, in a
wave, in Debug's scoped round and before a push alike.

**Workflow graph.** A workflow file (`starci/workflow@1`) is recorded as graph versions (`harness/graph.ts`) built for
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
atomically (`STALE` on a moved graph, idempotent by `--cmd-id`) and is refused `SCOPE_EXCEEDED` past the goal's
ceiling, and `GOAL_SHRUNK` when it drops a key of a graph planned under the current goal version that no key it adds
takes over (`assertDeliverables` in `harness/goal.ts`): only the first replan after a goal change may drop one. Define
and every replan are refused `TASK_NOT_SPLIT` while one task of a `perRecord` label works several Work records
([ops/ops/README.md](../ops/ops/README.md)), and `FLOW_INCOMPLETE` while a Work record a task is over has a step of its lane
([ops/lanes.yaml](../ops/lanes.yaml)) that is neither satisfied by evidence nor carried by a task of its label over it,
in the lane's order (`assertFlow` in `harness/lanes.ts`); `kernel next` digests each record's lane as `lanes`. Each key is classified keep, continue, stale (a dependency's result changed: the Kernel accepts or retries it,
nothing is cancelled), rework (done and its contract changed: a new attempt from its previous commit with the contract
diff), redo-live (live and changed: cancelled through task cancel, relaunched from its preserved patch), redo, add or
drop (live: cancelled; done: a generated `revert.<key>` node undoes the commits it landed, verified like any task,
unless the removal says `keepEffect`). `plan diff` prints the classification without applying it, and
`workflowActions` gives the step and `kernel next` the same per-key actions for the current graph. A red or stuck task
blocks its dependents and the workflow, naming the red checks; independent tasks keep going, and a retry is always the
Kernel's amend, never automatic: the red or question decision carries its one legal route of
[ops/routes.yaml](../ops/routes.yaml), and `kernel submit` refuses `ROUTE_ILLEGAL` for a change off it (`harness/routes.ts`). `WORKFLOW_TRANSITIONS` in `harness/workflow.ts` is the one rule for workflow status
moves.

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

**Package sources.** An app pins npm versions of its `@starci` packages in committed files; `deps source --local`
takes them from a package folder on this machine instead, the mechanism and its reasons in the doc comment of
`core/deps/packages.ts`. Every checkout of a repository in local mode gets the same copies (`reapplyLocal`): a worker's
before its launch (`seat start`), a clean verify's after its `npm ci`, a work tree's after its own (`deps source
--sync`). The push gate is `judgePush` (`core/deps/push-gate.ts`), run by `deps check` (the app pre-push hook of
`@starci/hfs`), `release push`, `release cut` and an executed `app release`. A package is fixed on a package edit branch
(`core/pkg/edit.ts`): `pkg branch` cuts it into a worktree of the harness with a push guard, `pkg handoff` records it in
the host store's `package_handoffs` for Debug, and `release push` and `release publish` refuse it to every role but
debug and owner (`PKG_EDIT_PUSH_REFUSED`).

**Seats as a tree.** `[Supervisor] <project>` (one per project, [state.md](../contexts/harness/state.md) "How a project is
found") > `[Kernel] <workflow>` (one per running orca workflow) > `[Op] <label> (<task id>) - <summary>` (one per attempt),
and `[Supervisor] <project>` > `[Worker] <project>: <topic>` (one per job the Supervisor hands out), each a real Orca agent, so
Orca lists a project's main checkout with its Supervisor, each workflow worktree under it with its Kernel, each Op worktree under that ("Op worktrees" above) with its Op, and each worker's
worktree with its worker. Every `supervisor` verb takes its project from the working directory (any checkout or worktree of the
project's repositories) or `--project <path>`. The owner runs `supervisor start` once per project: it reserves the
project's one Supervisor in machine.sqlite (`project_supervisors`, keyed by the Work-root repository's ledger id) and
launches the router's coordinator member (`orca agent launch --worktree path:<main checkout>`, terminal surface) in the
project's main checkout with a prompt naming its brief in the project's state folder (rendered from `ops/coordinators/`).
Its first command, `supervisor attach`, binds its terminal as coordinator of a new Run with a `[Supervisor] <project>`
task. `supervisor status` reads a project's liveness from Orca (with no `--project`, every live Supervisor's),
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
continues from the code already there.

Coordinators decide; deterministic drivers do the rest, and a coordinator never ends its turn while its driver is its own
(it loops on the blocking `next`). `kernel next <workflow>` is the Kernel's driver: it drains the Kernel Run's mail, steps
the workflow (dispatch, verify, close seats), runs the budget ladder on its Ops (an attempt past its contract's
budget.minutes with no result is asked once to wrap up and file, then fenced `budget.graceMinutes` later as a red verify ends
one: seats closed, dirty allowPaths preserved and reset, the task failed `over-budget` with its try spent, its leases
released; `sweepOpBudgets` in `core/kernel/driver.ts`, `fenceAttempt` in `harness/fence.ts`; `supervisor tick` runs it too),
runs the stall ladder on its Ops (below), resolves an effect_unknown
launch through `request-show` with its attempt's request id (completed with a dispatch: that dispatch is judged by worker-show,
adopted when its worker started, fenced and the task queued again with no try spent when it never started its turn past
`stall.startDeadlineMinutes`; completed with none: replayed; absent past the deadline: stuck), holds the workflow `paused(orca-down)` while
Orca does not answer, and returns only one decision — `red`, `stale`, `question`, `conflict`, `goal`, `goal-change`,
`escalation-answer` or `done`, with its evidence and a ledger digest — or `idle` after its wait. `kernel submit <file>`
applies one command: `workflow-change` (a change file or the whole desired workflow, through `workflow amend`),
`escalation` {budget, scope, conflict, owner, harness} or `handoff` (a Supervisor decision naming the repository, plus a
wake-up mail); a command whose content (all but its cmdId, with its change file) was refused `poisonRefusals` times
escalates to the Supervisor (kind harness), and every later submit of it is refused at once (`COMMAND_POISONED`).
`supervisor next` sweeps the workflows the Supervisor owns in its project's registered repositories: a Kernel whose lease lapsed with no
progress past its TTL (a relaunch is not progress) is relaunched on Orca's word (gone, or idle), and once the relaunch
limit came with no progress the next relaunch pauses the workflow and escalates to the owner instead; a Kernel launch Orca
never confirmed (`launch-unknown`, or still `starting`) is reconciled, never launched beside: its dispatch (the one the failed
worker-start named, else request-show's receipt, else a replay of worker-start under the same request id) is adopted when its
worker started, when the Kernel's own `kernel attach` came through from that dispatch's live terminal, or when that live
terminal printed after the launch (Orca may keep such a worker at `start_unknown`); while it waits, a dispatch left pasted in the
agent's composer is submitted again with a bare Enter (routing.yaml `pendingComposer`, for Ops too); a live terminal that stayed quiet is never
fenced (waited on past `stall.startDeadlineMinutes`, escalated past `effectUnknownDeadlineMinutes`); only a worker Orca reports
gone, or one never started past the deadline whose terminal Orca no longer lists, is fenced, closed `launch-failed` and
relaunched once, and only once the fence held (`resolveKernelLaunch` in `core/supervisor/driver.ts`); a live Kernel idle at
its prompt meets the stall ladder; it returns the project's oldest `escalation` or `handoff` the Supervisor rules, then the oldest `owner-request` (`supervisor ask` and the Telegram bridge record
it in the project's mailbox, machine.sqlite `owner_requests`, and mail the Supervisor's Run as `kernel submit` does, `askSupervisor` in
`harness/owner-ask.ts`), and only then, once each (a `decision-relayed` event), one awaiting an answer from outside: kind
`owner`, which the owner rules, or `harness`, which Debug rules and answers with a `supervisor ask` (`awaitsOwner` in
`harness/coordinator-commands.ts`). A `next` blocking on its wait renews its caller's lease every `nextPollSeconds`. `supervisor submit <file>` applies `goal`, `goal-change` (goal version n+1) or `stop`,
and its `answers` close escalations and owner requests (each recording the command's cmdId) (the escalating Kernel of another workflow gets an `escalation-answer`); a `stop` ends
every open decision of its workflow.
The Supervisor works through workers (`core/supervisor/workers.ts`). `supervisor dispatch --brief <file|text> [--label]
[--repo] [--allow]... [--input name=value]...`, from its terminal, makes the worker's own worktree of `--repo` (default the
project's Work-root repository, or any other checkout; a `@starci` package fix stays in the app's repository with
`--input package=<name>`, and the worker cuts its own package edit branch, `pkg branch`, and hands it off) at `<project state>/worktrees/<worker>` on branch `starci/<worker>`, queues in that repository's ledger a task
whose contract is the brief on the label's op (default `code`; with no `--allow`, its one report file),
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

**The host driver** keeps the tree alive with no LLM awake. `supervisor tick` is one idempotent pass for a scheduler to run
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
it; then `ensureSupervisors` keeps
the Supervisor of every project that owns a running orca workflow, or whose last Supervisor ended by anything but the
owner's `supervisor stop` (started when Orca says it is gone); then, acting for each attached Supervisor (its terminal as
`--from`, its lease left to its own calls), it runs the Kernel sweep of that project's repositories with the Ops' stall
ladder of each owned workflow, and that Supervisor's own ladder. A host store of version 2 kept one host Supervisor in its
`supervisors` table; a workflow whose Kernel was launched into that Supervisor's Run is adopted by its project's Supervisor
on the first tick (a `workflow-coordinator` event naming `adoptedFrom`), its Kernel left running there while Orca shows
that terminal, and relaunched into the project Supervisor's Run once the tick retires the host row (ended when Orca reports
its terminal gone, never deleted; `adoptFromHost` in `core/supervisor/driver.ts`). The scheduler that runs it is registered by the `host` verbs below.

**The desktop app's API.** `starci ui` (`core/ui/`) serves the contract of the StarCi Harness desktop app
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

**The host.** [ops/host.yaml](../ops/host.yaml) lists what a host runs for the harness (Orca, Docker, the Supervisors, the
scheduled tick, the Telegram bridge), each with its check, its start and how it is installed; `harness/host.ts` reads it and runs every argv
without a shell. The owner runs `host install` once: on Windows each schedule is a `StarCi <name>` scheduled task whose
action is `wscript //B <state base>/host/<service>.vbs`, which runs the `.cmd` beside it with its window hidden (changing
to the runtime root, setting the service's environment, appending its output to its log, every token quoted), so the
scheduler's command line carries one quoted path; `--dry` prints that argv and both files and writes nothing, and other
platforms are refused (`supervisor watch` in a terminal serves there). `host status` reports each service up, down or not
installed with its evidence, and lists every other StarCi-named task (a disabled one as legacy) without changing it;
`host up` starts what is down in `requires` order; `host uninstall` removes only the schedules ops/host.yaml declares.

**Host secrets.** `harness/secret-env.ts` is the one reader of a credential: `lookupSecret(key)` returns the key from the
process environment, else from `secret.env` at the harness root (the folder above policy/; `STARCI_SECRET_ENV` replaces the
path, and the bench points it at its run's own file), parsing dotenv lines (`KEY=VALUE`, `export`, quotes, `#` comments) and
keeping no other key. It reads only the keys [policy/security.yaml](../policy/security.yaml) `secretKeys` lists and refuses any
other `SECRET_KEY_UNLISTED` before it opens the file; no message, envelope or evidence carries a value. A host service
(`telegram-bridge`, `supervisor tick`) reads the file itself, so a key `host up` strips from its environment still arrives.
[secret.env.example](../secret.env.example) names every key the host's secret.env holds.

**The owner's Telegram channel.** The owner's channel is the Supervisor's terminal, the desktop app and Telegram
([ops/telegram.yaml](../ops/telegram.yaml), `harness/telegram.ts`, `harness/telegram-bridge.ts`). The bot token
(`tokenVariable`) comes from the secret loader above; a verb that would call the bot without it refuses
`TELEGRAM_NOT_CONFIGURED`, naming the key and where it is set, `connect telegram status` reports its `source` (never its value),
and every error text has the token replaced. `connect telegram discover-chat` reads the bot's updates once and stores the one private chat that wrote to
it (`--chat` picks among several) in machine.sqlite `telegram_channel`, never in a repository; no fact older than that moment
is sent. A notice sweep (`connect telegram notify`, every bridge cycle, and every `supervisor tick` once the token is set and the
chat stored, its failure reported and never failing the tick) sends, oldest first and at most `sendPerMinute`,
each fact not sent yet across every registered ledger: an `owner` escalation (never a `harness` one, which is Debug's; project, workflow,
decision id, the question, how to answer), an owner request a Supervisor command took up, and a workflow that is done,
blocked or stopped (keyed by its status and versions). Each fact is claimed in `telegram_notices` by its key before it is
sent, so it is sent once; a failed send is tried `sendTries` times. `supervisor telegram-bridge run` holds the host's one
bridge seat (pid and beat; a second bridge exits while the first is alive) and loops a sweep and a `getUpdates` long poll;
each update is claimed once in `telegram_inbound`. A message of any chat but the owner's is ignored and logged by its chat
id, never its text; the owner's reply to a notice, `/answer <decision-id> <text>` or `/ask <project> <text>` is recorded as an
owner request of that project by the owner (`askSupervisor`, as `supervisor ask` does), which wakes its Supervisor, and the
owner gets a receipt. `supervisor telegram-bridge status` (alive, stale or absent) is the host service's check.
The **stall ladder** (`harness/stall.ts`, thresholds in ops/liveness.yaml `stall`) reads no screen: a seat with work pending (a
Supervisor decision it rules, never an `owner` or `harness` escalation it waits on; a Kernel decision or a node its driver acts on; an Op's unfiled running task) and no driver call (lease
renewal; an Op's output) for `idleMinutes` is stalled when Orca says its agent is idle at its prompt (`terminal wait --for
tui-idle`, or no output in `terminal list` and worker-show and no dispatch heartbeat for `quietMinutes`). It is nudged with its
role's loop prompt (`terminal send`, one claimed `stall-nudged` event per nudge, at most `nudgeMax`); a nudge unanswered past
`nudgeGraceMinutes`, or a stall after the last nudge, gives it up (`stall-gave-up`): its member records a `stalled` outcome and
its provider circuit the kind worker-show's failure words name by `failureSignals` (capacity, rate, quota, auth), and no circuit at all when they name none (a plain stall is the model's, judged by its outcomes);
an Op is fenced and its task failed `stalled` for the Kernel to retry, and a Kernel is relaunched and a Supervisor replaced
on the coordinator tier's listed order (another member only while the circuit or quota takes the first out, `decide` in
`harness/router.ts`); a member that gave up `coordinatorStallMax` plain stalls of the same seat within
`coordinatorStallWindowMinutes` raises a `harness` escalation. The Kernel relaunch limit escalates to the owner; a Supervisor replaced that many times
with the same decision waiting is left for the owner. Nudges and give-ups are never progress.

A command is a `starci/command@1` file (json or yaml): `cmdId`, `kind`, `workflow`, `basedOn` {graph, goal}, `answers`
(decision ids), and its kind's field (`change`, `goal`, `escalation`, `handoff`, `mode`; `project` for the Supervisor). It is
admitted before any side effect into `commands` with its sha256 (an `applying` intent row): a known cmdId replays its
outcome, other bytes refuse `CMD_CONFLICT`, a stale `basedOn` refuses `STALE`. Decisions are raised once per fact into
`decisions` and closed by the command that answers them, or superseded when the ledger moves past them. Mail (`orca
orchestration send|check`) only wakes: an Op mails only its Kernel, a Kernel only its project's Supervisor and its Ops, a
Supervisor only the owner, and a Kernel takes a question only from a sender of its Run tree (its own Ops' terminals or its
project's Supervisor's); any other sender's mail is a `mail-impostor` event and is dropped. A repository Orca does not know is registered by its main checkout (`orca repo add`), so a workflow worktree is listed under its repository, and the call retried once. A
seat's terminal lives exactly as long as the seat: its tab is closed right after Orca fenced its worker (released, or ended and
retained), and the tick's sweep closes one that outlived it (`closeWorker` in `harness/orca/client.ts`). Inline workflows touch nothing in Orca: the chat agent is
their Kernel, and `kernel next` returns `idle` naming its next task.

**Routing and liveness** are data: [ops/routing.yaml](../ops/routing.yaml) (tiers, pools, balance, quota, Orca usage,
provider circuit and its half-open probe, outcomes, qualification, scoring, AIMD concurrency, the workflow and project
parallel caps, workflow budgets, and the
`coordinators` tiers: a Supervisor or Kernel is routed through the same circuit, quota, probe, scoring and balance as an
Op; the router's steps are [ops/README.md](../ops/README.md)'s) and
[ops/liveness.yaml](../ops/liveness.yaml) (thresholds, the Orca answers that prove a worker gone — anything else is
unknown, never dead — the `coordinators` block: seat lease, Kernel and Supervisor TTLs, relaunch limit,
effect-unknown deadline, conflict wait, poisoned-command refusals, and how long `next` waits — and the `stall` block of the
stall ladder and the host driver). `starci route explain --label <label>` prints a pick step by step; a
label naming a coordinator (`supervisor`, `kernel`) explains that seat's pick through `pickCoordinator`.
