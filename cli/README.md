# The starci CLI

`@starci/cli` is the `starci` command: one TypeScript source on `commander`, built with `tsc` into `dist/`, which git
never tracks. `npm ci` builds it (`prepare`); `prepublishOnly` gates on typecheck, lint and build, and `prepack` copies
the runtime's `ops/`, `policy/`, `contexts/` and the jest preset's README into the package (`files` of
[package.json](package.json)), so a published CLI carries its data and resolves every `harness:` context file of the
op files from itself. The checks a change must pass
are in [CONTRIBUTING.md](../CONTRIBUTING.md).

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
The workflow records its Kernel dispatch, agent and model; task seats and leases stay in the project ledger.
Additive migrations bump the corresponding machine schema version or `LEDGER_VERSION`; migrations never drop.

**Task states.** `TRANSITIONS` in `harness/tasks.ts` is the one state machine, changed only through `setStatus`:
`queued → running → reported → verifying → done | failed | awaiting_owner | cancelled`, plus `effect_unknown` (a
launch Orca could not confirm or deny, or a running task whose worker Orca reported gone). A launch that certainly
failed returns the task to `queued`; a verify with no verdict returns it to `reported` with no try spent.

**Settling.** `task verify` builds a candidate from a clean checkout of HEAD plus the task's `allowPaths` and replays
every check there, never in the worker's environment. Green commits only those paths (never pushed); red preserves and
resets them and releases the leases. Settles of one project run one at a time under the settle lock
(`harness/settle.ts`), so each candidate builds on the HEAD the previous one left and a half-done edit of one task
never reaches another's checks.

**Workflow graph.** A workflow file (`starci/workflow@1`) is recorded as graph versions (`harness/graph.ts`). Each
task is a node whose node hash covers its contract hash, its retry round and its dependencies' node hashes, so a
change flows down to every dependent. A node is ready when every dependency is done; its ledger task is created only
then, so a waiting node holds no lease. A replan (`workflow amend`, `plan diff`) classifies each task as keep,
continue, redo, add or drop. A red or stuck task blocks its dependents and the workflow, naming the red checks;
independent tasks keep going, and a retry is always the Kernel's amend, never automatic. `WORKFLOW_TRANSITIONS` in
`harness/workflow.ts` is the one rule for workflow status moves.

**Seat launch.** The claim comes first, in one transaction: the queued task goes to running and an attempt and a
`starting` seat carrying the launch record are opened; only then is Orca called, so two starts never both launch.
Orca's `run-create` and `worker-start` run under retry-request ids derived from the attempt. The brief, the contract
copy and the worker's output file live in the project's state folder, and the spec only points at the brief (the
Windows argv cap). The effective agent and model are attested from `worker-show`; a mismatch closes the worker and
requeues the task. An unknown outcome leaves the task `effect_unknown` with its leases and seat open, and
`seat start <task> --resume` replays the same requests.

**Seats as a tree.** The owner starts one `[Supervisor]` agent per host with `supervisor start`; `supervisor status`
reports its terminal liveness and `supervisor stop` releases it. The Supervisor's first command, `supervisor attach`,
binds its `ORCA_TERMINAL_HANDLE`, creates its Run and `[Supervisor]` task, and records the seat in the host store.
`workflow start` for an Orca workflow must run in that Supervisor terminal (`SUPERVISOR_REQUIRED` names
`starci supervisor start` otherwise). It launches a `[Kernel] <workflow>` agent into the Supervisor's Run with
`--run <supervisor run> --parent <supervisor task> --from <supervisor terminal>`. `kernel start <workflow>` relaunches
a missing Kernel or adopts a running workflow without one. The Kernel's first command, `kernel attach <workflow>`,
binds its own terminal, creates its child Run and Kernel task, then takes the first workflow step. Every Op launches
into that Kernel Run with `--run <kernel run> --parent <kernel task> --from <kernel terminal>`, titled `[Op] <task>`.
The coordinator briefs ship under `ops/coordinators/`; launch prompts point at brief files under `.runtime/`.
A repository Orca does not know is registered (`orca repo add`) and the call retried once. A seat's tab is closed
after Orca reports its worker released; `workflow step` closes settled Op seats, and `workflow stop` releases the
Kernel dispatch and closes its terminal after its Ops. Inline workflows touch nothing in Orca. The mailbox boundary
and role duties are owned by [roles.md](../contexts/harness/roles.md); the ledger, not mail, holds workflow state.

**Routing and liveness** are data: [ops/routing.yaml](../ops/routing.yaml) (tiers, pools, balance, quota, provider
circuit, AIMD concurrency, workflow budgets) and [ops/liveness.yaml](../ops/liveness.yaml) (thresholds, and the Orca
answers that prove a worker gone; anything else is unknown, never dead). Coordinator tiers use the same router,
provider circuit, quotas and balance as Ops; a workflow's bias also applies to its Kernel. `starci route explain`
prints an Op or coordinator pick step by step.
