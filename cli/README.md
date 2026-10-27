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
[CONTRIBUTING.md](../CONTRIBUTING.md); publishing is CI's (CONTRIB-20).

## Source layout

```text
src/
  main.ts                 builds the commander program for the tree of the working directory; prints the envelope
  registry.ts             every verb, core first, then each edition; which verbs a tree offers
  shared/                 verb, errors, output, tree, exec, git, role, secrets, workspace
  harness/                ledger and host store, contracts, tasks, settle, router, workflow graph, seats, liveness, uat
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
`check_runs`; `leases` (path prefixes held until the task ends, with a fencing token; a due time never frees a path);
`seats`; `messages`; `events` (append-only); `prior_work`, which indexes by workflow, plan key, contract hash,
attempt, kind and sha256 every attempt's work (the preserved patch of a cancelled or red one, the committed diff of a
settled one) kept in the project's never-pruned `prior/<sha256>.patch` store (`harness/prior.ts`); and `meta`. The host's `machine.sqlite` holds only host-wide state:
`ledgers` (the registry keyed by the git common dir), `provider_health`, `provider_events`, `pool_quota`,
`pool_concurrency`, `route_picks`, `budgets`, `budget_raises` and the host Supervisor record (`harness/machine.ts`).
A Kernel is a `seats` row of its workflow (role `kernel`); every seat holds a TTL lease (`lease_until`); `commands`
and `decisions` hold the coordinator protocol; `workflows.worktree` names a workflow's one worktree. Seats and leases stay
in the project ledger.
Additive migrations bump the corresponding machine schema version or `LEDGER_VERSION`; migrations never drop. Every
store is opened through one function (`connect` in `harness/ledger.ts`), which reads its header first: a file that is
no SQLite database or a damaged one is refused `LEDGER_CORRUPT`, naming the file and its recovery, and is never written.

**Task states.** `TRANSITIONS` in `harness/tasks.ts` is the one state machine, changed only through `setStatus`, a
compare-and-swap on the status it read (the loser of a race is refused `TASK_STATUS_RACE`):
`queued → running → reported → verifying → done | failed | awaiting_owner | cancelled`, plus `effect_unknown` (a
launch Orca could not confirm or deny, or a running task whose worker Orca reported gone). A launch that certainly
failed returns the task to `queued`; a verify with no verdict returns it to `reported` with no try spent, until one
result has reached no verdict `settleNoVerdictMax` times ([ops/liveness.yaml](../ops/liveness.yaml)): then the failure is
persistent and the task ends `awaiting_owner` with the last reason (`noVerdict` in `core/task/verify.ts`). A command
with side effects claims an intent on the task first: `cancelling` before a cancel stops seats or resets paths (a
verify or result arriving later is refused `TASK_INTENT_HELD`; a cancel refused half-way keeps it and resumes when run
again), `repair` when a preserve saved the work but could not put every path back (a held file on Windows); a task
with an intent keeps its leases, and `task verify --recover` finishes the reset from the preserve's `manifest.json`.
Each task records its checkout (its workflow's worktree, else the one it was sent from; a retry keeps its previous
task's), and verify, cancel and a failed result act there whatever checkout the caller is in. Leases fold case when
the repository's `core.ignorecase` is true; the fence is the lease row read beside the status swap, and a grant's
token only names the grant.

**Settling.** `task verify` first stops the task's worker seats (refused `VERIFY_WORKER_LIVE`, nothing changed, when
Orca cannot confirm the stop), then builds a candidate from a clean checkout of HEAD plus the task's `allowPaths` and
replays every check there, never in the worker's environment; what the candidate misses is read against the same
staged snapshot. Every candidate also meets the `lands` check, red when work under its `allowPaths` would not land
through the harness (a dirty file missing from the candidate, or a commit without the `Starci-Task:` trailer made under
them while the task ran, as a worker that commits itself leaves), and the `secrets` and `loosening` gates of the
project's runtime tier ([policy/quality.yaml](../policy/quality.yaml)) on the files it changes, whatever its contract
says (`harness/clean-verify.ts`). Green commits only those paths (never pushed) and makes the task done, records its settle commit
(`tasks.settle_commit`) and releases its leases in one transaction; red preserves and resets them and releases the
leases. Settles of one project run one at a time under the settle lock (`harness/settle.ts`), so each candidate builds
on the HEAD the previous one left and a half-done edit of one task never reaches another's checks; its holder stamps
a heartbeat, so a dead holder whose pid Windows reused is taken over once the beat goes stale. Git is the authority for
landed: a task left verifying by a verifier that no longer holds the settle lock (dead, or its beat stale) is reconciled
by `task verify --recover`, which every `workflow step` (and so `kernel next`) runs on such a task before it settles: done
when its branch carries the settle commit (its message and `Starci-Task:` trailer after the HEAD the verify started
from), else back to `reported`, which the same step verifies. Git runs through one runner (`captureGit` in
`shared/git.ts`) with `core.quotePath` off and `core.longpaths` on, and every path listing the harness parses is
NUL-separated (`-z`), so a non-ASCII or deep path is never quoted or cut.

**Workflow graph.** A workflow file (`starci/workflow@1`) is recorded as graph versions (`harness/graph.ts`) built for
a goal version (`harness/goal.ts`): goal text, acceptance ids and a scope ceiling (path prefixes, max tasks). Goal 1 is
the file's; `workflow regoal` (owner, Supervisor) records goal n+1 from a `starci/goal-change@1` file, based on goal n
(`STALE` otherwise) and idempotent by its cmdId. A node's hash is its contract hash and retry round; its dependencies
enter through early cutoff instead (`harness/reconcile.ts`): each dispatched task records the dependency tasks it ran
on, and a done task's settled result hash is the git tree of its allowPaths at its settle commit plus its output hash,
so a retry or edit upstream that lands the same result invalidates nothing below it. A node is ready when every
dependency is done; its ledger task is created only then, so a waiting node holds no lease. A replan is
`workflow amend --desired <workflow file> --based-on <graph version>` (the Kernel's whole desired graph, reconciled by
task key) or `--change <starci/workflow-change@1 file>` (add, edit, remove, retry, accept); it records graph n+1
atomically (`STALE` on a moved graph, idempotent by `--cmd-id`) and is refused `SCOPE_EXCEEDED` past the goal's
ceiling. Each key is classified keep, continue, stale (a dependency's result changed: the Kernel accepts or retries it,
nothing is cancelled), rework (done and its contract changed: a new attempt from its previous commit with the contract
diff), redo-live (live and changed: cancelled through task cancel, relaunched from its preserved patch), redo, add or
drop (live: cancelled; done: a generated `revert.<key>` node undoes the commits it landed, verified like any task,
unless the removal says `keepEffect`). `plan diff` prints the classification without applying it, and
`workflowActions` gives the step and `kernel next` the same per-key actions for the current graph. A red or stuck task
blocks its dependents and the workflow, naming the red checks; independent tasks keep going, and a retry is always the
Kernel's amend, never automatic. `WORKFLOW_TRANSITIONS` in `harness/workflow.ts` is the one rule for workflow status
moves.

**Seat launch.** The claim comes first, in one transaction: the queued task goes to running and an attempt and a
`starting` seat carrying the launch record are opened; only then is Orca called, so two starts never both launch.
Orca's `run-create` and `worker-start` run under retry-request ids derived from the attempt. The brief, the contract
copy and the worker's output file live in the project's state folder, and the spec only points at the brief (the
Windows argv cap). The effective agent and model are attested from `worker-show`; a mismatch closes the worker and
requeues the task. An unknown outcome leaves the task `effect_unknown` with its leases and seat open, and
`seat start <task> --resume` replays the same requests.

**Seats as a tree.** `[Supervisor]` (one per host) > `[Kernel] <workflow>` (one per running orca workflow) > `[Op] <label> (<task id>) - <summary>`
(one per attempt), each a real Orca agent. The owner runs `supervisor start` once: it reserves the host's one Supervisor
in machine.sqlite and launches the router's coordinator member (`orca agent launch`, terminal surface) in the runtime
checkout with a prompt naming its brief under `.runtime/` (rendered from `ops/coordinators/`). Its first command,
`supervisor attach`, binds its terminal as coordinator of a new Run with a `[Supervisor]` task. `supervisor status` reads
its liveness from Orca, `supervisor stop` closes it, and `supervisor ensure` starts one only when Orca says it is gone
(or replays a launch whose answer was lost) — for a scheduled task, e.g.
`schtasks /Create /SC MINUTE /MO 10 /TN StarCiSupervisor /TR "node D:\.claude\cli\dist\main.js supervisor ensure"`.
`workflow start` of an orca workflow runs only in the Supervisor's terminal (`SUPERVISOR_REQUIRED` elsewhere): it
makes (or reuses) the workflow's one git worktree (`workflows.worktree`, default `<project state>/worktrees/<workflow>`
on branch `starci/<workflow>`) and launches the Kernel by `worker-start --run/--parent/--from` into the Supervisor's Run,
titled `[Kernel] <workflow>`; `kernel start` relaunches one Orca reports gone. The Kernel's first command, `kernel attach`,
adopts its terminal as coordinator of the workflow's child Run (taken back with `run-use` after a relaunch) and its
`[Kernel] <workflow>` task; every Op launches into that Run (`--run/--parent/--from` of the Kernel) inside the workflow's
worktree, where verify settles it, so a relaunched Kernel or a retried attempt continues from the code already there.

Coordinators are **episodic**. `kernel next <workflow>` is the deterministic driver: it drains the Kernel Run's mail, steps
the workflow (dispatch, verify, close seats), fences an Op Orca reports idle past its budget.minutes (worker-stop, else
worker-abandon; the task fails with outcome `timeout`), resolves an effect_unknown launch through `request-show` with its
attempt's request id (completed: replayed; absent past the deadline: stuck), holds the workflow `paused(orca-down)` while
Orca does not answer, and returns only one decision — `red`, `stale`, `question`, `conflict`, `goal`, `goal-change`,
`escalation-answer` or `done`, with its evidence and a ledger digest — or `idle` after its wait. `kernel submit <file>`
applies one command: `workflow-change` (a change file or the whole desired workflow, through `workflow amend`),
`escalation` {budget, scope, conflict, owner, harness} or `handoff` (a Supervisor decision plus a wake-up mail).
`supervisor next` sweeps every registered project: a Kernel whose lease lapsed with no workflow event past its TTL is
relaunched on Orca's word (gone, or idle), more than the relaunch limit in the window pauses the workflow and escalates to
the owner; it returns the oldest `escalation` or `handoff`. `supervisor submit <file>` applies `goal`, `goal-change` (goal
version n+1) or `stop`, and its `answers` close escalations (the escalating Kernel gets an `escalation-answer`).

A command is a `starci/command@1` file (json or yaml): `cmdId`, `kind`, `workflow`, `basedOn` {graph, goal}, `answers`
(decision ids), and its kind's field (`change`, `goal`, `escalation`, `handoff`, `mode`; `project` for the Supervisor). It is
admitted before any side effect into `commands` with its sha256 (an `applying` intent row): a known cmdId replays its
outcome, other bytes refuse `CMD_CONFLICT`, a stale `basedOn` refuses `STALE`. Decisions are raised once per fact into
`decisions` and closed by the command that answers them, or superseded when the ledger moves past them. Mail (`orca
orchestration send|check`) only wakes: an Op mails only its Kernel, a Kernel only its Supervisor and its Ops, the
Supervisor only the owner. A repository Orca does not know is registered by its main checkout (`orca repo add`), so a workflow worktree is listed under its repository, and the call retried once. A
seat's tab is closed after Orca reports its worker released. Inline workflows touch nothing in Orca: the chat agent is
their Kernel, and `kernel next` returns `idle` naming its next task.

**Routing and liveness** are data: [ops/routing.yaml](../ops/routing.yaml) (tiers, pools, balance, quota, provider
circuit, AIMD concurrency, workflow budgets, and the `coordinators` tiers: a Supervisor or Kernel is routed through the
same circuit, quota, balance and bias as an Op, a workflow's bias applying to its Kernel) and
[ops/liveness.yaml](../ops/liveness.yaml) (thresholds, the Orca answers that prove a worker gone — anything else is
unknown, never dead — and the `coordinators` block: seat lease, Kernel and Supervisor TTLs, relaunch limit and window,
effect-unknown deadline, conflict wait, and how long `next` waits). `starci route explain` prints a pick step by step,
`--coordinator supervisor|kernel` for a coordinator's.
