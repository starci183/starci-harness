# STARCI.md: the starci CLI rewrite (1.0.0-alpha.40)

Owner: the owner. This is the working design of the rewritten CLI in this repository. It records the owner's decisions and the verb set under discussion. The old CLI in `starci-academy-backend/.claude` keeps running until the new one reaches parity. An agent starts at [CONTEXT.md](CONTEXT.md), which owns the load order, the project binding and the hard rules.

## Decisions taken (owner, 2026-10-27)

- **One CLI written in TypeScript with `commander`**, no Nest. It is built with `tsc` into `cli/dist`. npm ships `dist/` only, and git never commits it. `prepare` builds on install and `prepublishOnly` gates on typecheck, lint and build.
- **The CLI source passes ESLint** at typescript-eslint `strictTypeChecked` plus `stylisticTypeChecked`, with `noInlineConfig`. Nothing is disabled inline.
- **One shared standard (`cli/src/shared`):**
  - `defineVerb` is the one definition of a verb: path, summary, editions, effect, roles, json schema, typed flags and the handler. Help, `starci explain`, docs and completions all come from it, with no YAML beside the code.
  - Every verb prints one json envelope with `--json`: `{schema, ok, data}`, or `{schema: "starci/refusal@1", ok: false, code, message}`.
  - Exit codes: 0 done, 1 refused (nothing moved), 2 bad usage.
  - Host tools run without a shell (`runTool`, and `runNpm` goes through the running Node), so no quoting breaks on Windows.
  - `locateTree` reads the nearest `hfs.json`. A lite app sees core plus lite verbs, a full app sees core plus full verbs, and the runtime or a bare folder sees everything.
- **Two independent axes, edition and runner:**
  - The **edition** (`lite` or `full`, fixed in `hfs.json` at scaffold) says what the app is: its stack, how it scales and its `app` verbs. Lite is stateless on Postgres and puts the canonical patterns first; full adds the reactor, saga and projection patterns and its own infra.
  - The **runner** (`orca` or `inline`) says how the harness runs a task, and is chosen per workflow or per task, never by edition. `orca` launches a worker seat through Orca (`seat start`, `task send --launch`), so tasks run in parallel. `inline` means the Claude or Codex session that is open does the task itself: it sends the task, files the result inline and has it verified, one task at a time.
  - Both editions get both runners. Contracts, leases, the clean verify and the harness commit are the same for either runner.
  - Inline guards: the agent is both Kernel and worker, so its contract must be sent (and its hash fixed) before it edits code, and the harness verify on a clean checkout is what decides green. Liveness (ping and pong) applies only to the `orca` runner.
- **One CI workflow** (`.github/workflows/ci.yml`). Job `check` on every push and pull request to main: the CLI's typecheck, lint and build (the CLI keeps no specs), `check loosening`, `check secrets --all`, every package's specs, then the Sonar new-code gate. Job `publish` on a `v*` tag: every package under `packages/` that is not private and whose version is not on npm. Tokens live only in GitHub secrets; the repository is public.
- **Machine actions are the harness's job** (owner ruling). An agent never installs Playwright or browsers, or runs Docker by hand: a `uat` worker writes a short Playwright script and calls `uat run`, which runs it in the official Playwright image pinned in `ops/uat.yaml` and keeps the playwright package inside that image, never in the product.
- **Harness state never lives in a product repository** (owner correction of the alpha layout, as the legacy had it). A product's `.starciwork/` is product content only and is committed; the harness writes its ledger, briefs and scratch under the runtime root (see Storage).

## Layout

```
AGENTS.md, CLAUDE.md           the agent bootstrap: read CONTEXT.md first
CONTEXT.md                     load order, state, project binding, hard rules
CONTRIBUTING.md                rules for editing this repository
hfs.json                       kind runtime, policy profile runtime
cli/
  src/
    main.ts                    builds the commander program for the tree of the working directory
    registry.ts                every verb, core first, then each edition
    shared/                    verb, errors, output, tree, exec, git, secrets, workspace
    harness/                   ledger, contracts, tasks, router, workflow graph, seats
    core/<group>/<verb>.ts     verbs of both editions
    lite/<group>/<verb>.ts     verbs of lite apps
    full/<group>/<verb>.ts     verbs of full apps
  dist/                        build output, not committed
ops/                           the worker brief, labels, check presets, routing (data the CLI validates)
policy/                        quality tiers and profiles, canon packages, loosening, security
knowledge/                     how app code and UI are written
packages/                      the canon packages apps install from npm, each with its own specs
skills/starci/                 the agent entry for operating the harness
.github/workflows/ci.yml       CI: the CLI gates, the package specs, Sonar; publish on a v* tag
.runtime/                      harness state (git-ignored), see Storage
```

## Verbs written so far

| command | edition | effect | what it does |
|---|---|---|---|
| `starci version` | core | read | CLI and Node versions |
| `starci explain [--term t]` | core | read | the verbs available here, from their definitions |
| `starci doctor` | core | read | node, git, npm, gh and Orca (with its version) on the host; the StarCi tree of the folder and its policy profile; the runtime root, state base and how many ledgers `machine.sqlite` lists; the repository's `.starciwork` (tracked, untracked, git-ignored), warning about an ignored one or a `runtime.sqlite` of the old layout inside it |
| `starci check run [--base ref] [--all]` | core | read | the scope decision from the diff, then typecheck and lint of exactly that scope |
| `starci check lint` / `check typecheck` | core | read | one step of the same scope, using each package's own ESLint or tsconfig |
| `starci release push [--dry-run]` | core | remote | the light gate (on main, clean, fast-forward, no secret in the pushed range), then git push with hooks |
| `starci release cut [--package p] [--dry-run]` | core | remote | tag v<version> on a commit already on origin/main with its CHANGELOG section; pushes the tag alone |
| `starci release publish [--publish]` | core | publish | the plan of package versions missing from npm; --publish publishes them from main and reads each back |
| `starci release ci-status [--sha]` | core | read | the GitHub Actions verdict of a commit |
| `starci app info` | lite | read | the lite app's be/fe apps, canonical patterns and backing services |
| `starci contract new\|check`, `task send\|result\|status\|verify\|cancel` | core | see "CLI of the harness" | the P1 task protocol, in both editions |
| `starci seat start\|list\|stop\|ping` | core | see "CLI of the harness" | Orca worker seats, the `orca` runner in either edition |
| `starci route explain`, `provider status\|recover\|report`, `budget show\|raise` | core | see "Verbs added to the harness set" | the P2 router, provider circuit, pool concurrency and workflow budgets |
| `starci workflow define\|start\|step\|run\|pause\|resume\|status\|list\|amend\|stop`, `plan show\|diff` | core | see "CLI of the harness" and "Workflow file and graph" | the P3 workflow: a goal as a graph of contracts, dispatched as its dependencies settle |

Parity gaps with the old CLI, by design for now:
- The secret scan carries the provider shapes, forbidden paths and the quoted keyword assignment. It does not carry the unquoted dotenv form, SQL role passwords or badge-token exemptions.
- `release publish` has no clean-install proof, canon rebind or example re-pin. Those belong to the runtime's canon packages, not to a product.
- Roles are enforced only when `STARCI_ROLE` names the caller's role: a verb whose `roles` do not list it refuses `ROLE_REFUSED`, a value that is no role is usage (`ROLE_UNKNOWN`), and unset means not enforced. Orca's `worker-start` cannot set a worker's environment, so the brief names the role (`worker` for an Orca seat, `agent` for an inline task) and tells the worker to set it.

## Final lists: ops and CLI (owner, 2026-10-27)

This section is the one list of worker labels and verbs. The tables further down ("CLI of the harness", "Verbs added to the harness set") explain the harness verbs, and this list supersedes them where the two differ.

### Ops: one worker, seven labels

Every op is the same worker running `ops/worker.md`. A label is a routing hint plus default checks, declared once in `ops/labels.yaml`. The Kernel writes the contract, and the label only helps it pick the agent and the presets.

| label | the work | default checks (`ops/checks.yaml`) | difficulty floor | host tools |
|---|---|---|---|---|
| `code` | scaffold, implement, fix, refactor, remove a feature | check-run-green, paths-only, tests-pass (related) | medium | git, node |
| `test` | write the tests of one slice, inside test paths | tests-pass (the new tests), paths-only (test paths) | medium | git, node |
| `ui` | draw screens, generate assets, grow the Grammar | renders (viewports), check-run-green, paths-only | hard | git, node, browser |
| `verify` | run one heavy suite the goal asks for (perf, security, e2e) and report it | json-schema (suite report) | medium | git, node, docker |
| `uat` | walk the flows with `starci uat run` (Playwright in Docker), a screenshot per step | json-schema (flow report), renders (evidence) | medium | browser (a Docker engine answers) |
| `docs` | documentation and product content | paths-only, doc-language | easy | git |
| `deliver` | publish, deploy or migrate one target and probe it live | probe (url/registry/migration) | hard | git, node, docker |

The Kernel's own work is plan, decide and finish. The Supervisor's is the owner channel, operations, land and push, and CI-red routing. The Owner's is taste and acceptance.

### CLI: 83 verbs in 4 sets, plus 5 hidden

**Core: both editions (33)**

| group | verbs |
|---|---|
| (top) | `version`, `explain`, `doctor` |
| `check` | `run`, `lint`, `typecheck`, `unit` |
| `git` | `commit`, `sync`, `backup` |
| `release` | `push`, `cut`, `publish`, `ci-status`, `notes` |
| `contract` | `new`, `check` |
| `task` | `send`, `result`, `status`, `verify`, `cancel` (a lite agent sends its own task, files the result inline and verifies it) |
| `app` | `scaffold`, `sync`, `check`, `info`, `emit`, `db`, `secret` |
| `pattern` | `list`, `show`, `add` |
| `uat` | `run` (a `uat` worker's Playwright script in the pinned image of `ops/uat.yaml`, host ports forwarded on 127.0.0.1, `--env` variables of the caller's shell handed in by name only, the script's own arguments after `--`, screenshots into the evidence folder) |

**Lite apps (agent in chat) (10)**

| group | verbs |
|---|---|
| `supabase` | `start`, `stop`, `status`, `cloud` |
| `stack` | `deploy`, `verify`, `rollback` |
| `docker` | `build`, `up`, `down` |

**Full apps (5)**

| group | verbs |
|---|---|
| `app add` | `reactor`, `saga`, `projection` (the patterns lite refuses) |
| `stack` | `up`, `down` for the full infra (Kafka, Keycloak, test world), plus the lite `deploy`, `verify` and `rollback` |

**Harness: both editions (35).** `seat`, `msg`, `daemon`, `supervisor` and `debug` need the `orca` runner; the rest also serve an `inline` run, where the chat agent is the Kernel.

| group | verbs | who |
|---|---|---|
| `workflow` | `define`, `start`, `step`, `run`, `pause`, `resume`, `list`, `status`, `amend`, `stop` | owner (list and status: everyone; step and run: Kernel, Supervisor, the inline agent; pause and resume: Kernel, Supervisor) |
| `plan` | `show`, `diff` (`workflow amend` applies a replan) | Kernel |
| `task` | `wait` (later) | Kernel, Supervisor |
| `msg` | `send` (hidden: `recv`, `reply`) | Kernel, Supervisor |
| `seat` | `start`, `list`, `stop`, `ping` (hidden: `run`) | Kernel, Supervisor |
| `route` | `explain` | everyone |
| `provider` | `status`, `recover`, `report` | status: everyone; recover: owner or Supervisor; report: Kernel or Supervisor |
| `budget` | `show`, `raise` | raise: owner or Supervisor |
| `lease` | `list` (later; `task status <id>` shows a task's leases today) | everyone |
| `daemon` | `start`, `stop`, `status` (hidden: `sweep`) | owner, Supervisor |
| `supervisor` | `start`, `stop`, `status`, `tell`, `decide` | owner |
| `debug` | `open`, `report` | Supervisor opens; Debug reports |

**Hidden** (called by the daemon, seat runner or hooks, not listed in `explain`): `msg recv|reply`, `seat run`, `daemon sweep`, the PreToolUse `guard`.

**Removed from the legacy 268:** every op-watching Kernel verb (observe, nudge, critic, redesign, decisions menu, foundations, cut-seam), the 39 op manifests and `route op`, `supervisor push`, the qualification store, and the 21 unreferenced verbs.

## Harness core (owner model, 2026-10-27)

Owner: the Kernel never reads an op's terminal. It sends work as a contract, `(context, input, expectedOutput)`, and waits for the output and an exit code. The Supervisor is reached the same way. Liveness is a ping-pong. This replaces the critic, debug, observe and nudge model.

### Three parties, one protocol
- **Op:** a short-lived agent (Claude, Codex or Devin) in an Orca seat. It receives one task, works until its own output meets `expectedOutput`, and returns the output.
- **Kernel:** one long-lived seat per workflow.
  - It splits the goal into tasks, sends them, waits and verifies each output by machine.
  - It escalates a `blocked` or `mismatch` result to the Supervisor as a new task.
- **Supervisor:** one seat per host.
  - It receives the tasks no op can finish: cross-workflow work, runtime repair, owner decisions.
  - It returns an output the same way, asking the owner when the contract needs a person.

### Two kinds of message
1. **Command, a short request and response.**
   - A closed set: `ping`, `status`, `cancel`, `pause`, `resume`.
   - The answer is due within seconds.
   - The answer comes from the **seat runner**, the harness process that hosts the agent, not from the model. A model in the middle of a long tool call cannot answer promptly, and liveness must not depend on it.
   - No pong before the deadline means the seat is dead. The sender relaunches the task with its next attempt, or escalates.
2. **Task, an asynchronous contract and its result.**
   - `context`: what the receiver may read and where it works: repository, base commit, worktree, rulings, the paths it may write.
   - `input`: what to do, in words plus structured fields (op kind, target).
   - `expectedOutput`: what the result must satisfy, as **machine checks only**:
     - `command`: a command that must exit 0, for example `starci check run`;
     - `files`: globs it may touch, globs it must not touch, files that must exist;
     - `json`: an output document that must match a schema;
     - `test`: named tests that must pass.
     Anything no machine can judge (taste, UX) is an owner review step, never part of the contract.
   - `budget`: minutes and attempts.
   - **Result:** `status` is one of `done`, `blocked` (with the reason), `mismatch` (the receiver shows that `expectedOutput` itself is wrong or contradictory) or `failed`, plus the output and evidence such as commit, files and json.
   - The sender runs `starci task verify`, which replays every check of `expectedOutput` against the result. Only a green verify settles the task.

### Roles and their rights

| role | job | lives | reads | writes | effects | never | escalates to |
|---|---|---|---|---|---|---|---|
| op | one task, until its output meets `expectedOutput` | one task | the task's `context` only | its lane worktree, inside `allowPaths` | read, local-write | push, merge into main, change its contract, ask the owner | Kernel: `blocked` or `mismatch` |
| kernel | split the goal into tasks, send, wait, verify | one workflow | its goal and its workflow's ledger | tasks and messages of its workflow; merges lanes into the workflow branch | read, local-write, host (its own seats) | write code itself, read an op's terminal, push main | Supervisor: a task beyond an op |
| supervisor | run the host, take tasks beyond an op, carry the owner channel | always, one per host | every workflow, seat and ruling | land on main, the light push, seats, budgets, rulings the owner decides | + remote (push); publish only with the owner's approval | write product code (it sends a task to an op), bend a gate | Owner: decisions, publish, rulings |
| debug | diagnose a harness or environment failure, never task content | one incident | everything, read-only (ledgers, logs, transcripts) | a diagnosis and a repair task only | read | edit code, change rules, run any writing verb | Supervisor: the diagnosis plus the repair task |

The rights come from each verb's `effect` and `roles`. With `STARCI_ROLE` set, a verb refuses a role it does not list (see "Verbs written so far"); unset, they are declared, not enforced.

### Changing a running workflow (amend)

Owner, 2026-10-27: the scope of a running workflow can be stopped, extended, edited or trimmed through the Supervisor. Each change rebuilds the graph and decides what keeps running.
- **Entry:** `starci workflow amend <workflow> --change <file>` (format: "Workflow file and graph").
  - The change is a list of entries, each `add`, `edit`, `remove` or `retry`, or a whole workflow file that replaces the graph. Stopping is `workflow stop`; `workflow pause` holds dispatch and `workflow resume` restarts it.
  - The change goes to the Supervisor as a task contract, and the Supervisor hands it to that workflow's Kernel.
- **Kernel replan:**
  1. Freeze: it sends no new task, and running tasks keep running.
  2. It applies the change to the goal, which becomes goal version n+1.
  3. It builds the new graph and diffs it against the old one by each task's **node hash** (its contract hash, its retry round and the node hashes of its dependencies). Each old task is classified:
     - keep: unchanged and not running: a done result is reused, a task not yet sent waits on, a failed one stays failed;
     - continue: running and unchanged;
     - redo: its contract or a dependency changed, so it is cancelled and queued again;
     - add: new in the goal;
     - drop: no longer in the goal, so it is cancelled and its history kept.
  4. It records the graph version and the classification, then resumes dispatch from the new graph.
- **Owner gate** (later, with the Supervisor): when a replan drops or redoes more than the owner's threshold, the Kernel returns the plan to the Supervisor, which asks the owner before resuming.
- **Stop:** `graceful` dispatches nothing new and waits for running tasks. `hard` cancels every seat at once with the `cancel` command.
- **A feature added while several workflows run.** The Supervisor first maps the impact: which workflow owns the paths and outputs the feature touches.
  - It amends only the owners. A workflow the feature does not touch keeps running unfrozen.
  - When the feature spans owners, each owner gets its part, and the cross-workflow dependency is declared on the other owner's output (its contract hash). If no owner fits, it starts a new workflow.
  - It checks the `allowPaths` of the new tasks against every running workflow and serializes the overlaps.
  - Done work is kept, and only queued tasks are rewritten, which is cheap because they never ran.
  - Example: the realtime bell for pending approvals.
    - The chat workflow owns `platform/realtime`. It keeps its done hub and door and adds an approvals topic. Its queued FE subscription and UAT tasks get new contracts.
    - The agent-pages workflow owns `approval-requests`. It adds the event that the topic waits on.
    - The billing workflow is untouched.

### Storage: harness state under the runtime root, product Work in the repository

```text
<state base>/machine.sqlite                                  one per host: the ledger registry and host-wide state (§6)
<state base>/projects/<ledger_id>/runtime.sqlite             one per project: its ledger (§6)
<state base>/projects/<ledger_id>/briefs/ contracts/ preserved/ outputs/   that project's harness files
<app>/.starciwork/                                           product content only, in git
```

- `<state base>` is `<runtime root>/.runtime`, where the runtime root is the harness checkout holding `cli/` and `ops/` (or the installed package carrying `ops/`), found the way `ops/` is found. `.runtime/` is git-ignored there. `STARCI_LOCAL_ROOT` replaces the whole state base and `STARCI_PROJECTS_ROOT` only `projects/`; tests and probes set `STARCI_LOCAL_ROOT` to a temp directory. `harness/ledger.ts` owns every one of these paths.
- A ledger is found through the host registry, never by walking a repository: the project is the repository's git common dir (`git rev-parse --git-common-dir`), so its linked worktrees share one ledger, and `machine.sqlite` `ledgers` maps it to a `ledger_id` (`<checkout name>-<hash of the common dir>`), minted on the first write and kept in the ledger as `meta.ledger_id`. Read verbs (`task status`, `seat list`) create nothing.
- `<app>/.starciwork/` holds the product's Work (Business/SRS, Architecture/SDS, `features/…`, `workspace.yaml`). The harness never writes its state there, never ignores or excludes it, and never strips it from a candidate: a docs task leases a scope inside it (`.starciwork/features/<f>`) and its edit lands like any other. Only the whole tree as an `allowPaths` entry is refused, as `.` is.
- A ledger an alpha build left at `<app>/.starciwork/runtime.sqlite` is not read, copied or migrated; the new location starts empty.

### CLI of the harness (both editions)

Who runs each verb is declared in its `roles` (enforced when `STARCI_ROLE` is set, see "Verbs written so far"). `hidden` verbs are called by the seat runner, not typed by people or agents. A verb marked (later) is not built yet. Every verb here serves both editions; a seat verb needs the `orca` runner and refuses `ORCA_MISSING` on a host without Orca.

| verb | who runs it | effect | what it does |
|---|---|---|---|
| `workflow define <file>` | owner, kernel, supervisor | local-write | record the Kernel's workflow file as graph v1: every contract fit (`contract check` rules), dependencies known, no cycle; the workflow row is its budget account (the ops default ceiling) |
| `workflow start <id>` | owner, supervisor, kernel | host | a defined workflow runs and takes its first step: `orca` dispatches the ready tasks, `inline` prints the next task for the chat agent. Booting a Kernel seat comes with P4 |
| `workflow step <id>` | owner, kernel, supervisor, agent | host | one idempotent tick: cancel live tasks no node carries, ping the seats of running tasks past their launch grace (§5), settle reported tasks through `task verify`, dispatch the ready ones within `maxParallel` and the workflow budget, update the status; exit 1 when blocked. `workflow run`, a chat loop or the daemon calls it |
| `workflow run <id> [--interval <s>] [--until done\|blocked\|idle] [--max-ticks <n>]` | owner, kernel, supervisor, agent | host | the daemon-less driver: `workflow step` every interval (default 30 s, at least 1 s; it sleeps, never spins), one line per change (a status, a node state, a new action); returns when done or stopped, blocked with nothing left moving (`--until blocked`: at the first blocked), paused with nothing live, at the first quiet tick (`--until idle`, the inline default) or after `--max-ticks`; exit 0, 1 when blocked, 2 on usage |
| `workflow pause <id> [--reason <r>]` / `workflow resume <id>` | owner, supervisor, kernel | local-write / host | pause holds dispatch (nothing new is sent or launched; live tasks keep running and each step still settles them); resume returns it to running and takes a step. `WORKFLOW_TRANSITIONS` in `harness/workflow.ts` is the one rule for workflow status moves |
| `workflow list` / `workflow status <id>` | everyone | read | the workflows with runner, status and reason, graph version, progress and budget; each task's state, ledger task and why it waits |
| `workflow amend <id> --change <file>` | owner, kernel, supervisor | host | the replan: classify keep, continue, redo, add or drop, record graph v+1 with the classification, cancel the live tasks of redo and drop through `task cancel`, resume dispatch |
| `workflow stop <id> --graceful\|--hard` | owner, supervisor | host | graceful sends nothing new and lets live tasks settle (stopped once none is live); hard cancels every live task and its seats now |
| `plan show <workflow> [--version n]` | everyone | read | a recorded graph: tasks, edges, contract and node hashes, the current graph's states, and the version history with each classification |
| `plan diff <workflow> --to <file>` | owner, kernel, supervisor | read | the classification an amend with that file would apply, and the tasks it would cancel; changes nothing |
| `contract new --label <l> --summary <s> --allow <p,...> [--read <p,...>] [--cwd-path <p>] [--check "<preset>[:arg=v,...];..."] [--details <t>] [--base <rev>] [--out <file>] [--force]` | owner, kernel, supervisor, agent | local-write | write a fit contract (default `contracts/<summary>.json` in the project's state folder, see Storage), composing `expectedOutput` from the label's default checks and named presets |
| `contract check <file>` | everyone | read | validate the contract: schema, labels, presets, machine-runnable checks, a behavioural check; `allowPaths` are literal (no glob), not the whole repository nor the whole `.starciwork` Work tree, never named twice (`./src/a` is `src/a`) |
| `task send <contract> [--workflow <w>] [--retry-of <task>] [--launch [--agent <a> --model <m>] [--effort <e>] [--worktree <path\|selector>] [--run <id>] [--timeout-ms <ms>]]` | owner, kernel, supervisor, coordinator, agent (`--launch`: the roles of `seat start`) | host | queue a fit contract and lease its `allowPaths` (`LEASE_CONFLICT` on an overlap with a live task); a retry repeats the same label and paths within the try budget; `--launch` starts a worker seat as `seat start` does, routed when `--agent` and `--model` are left out; prints the task id. Handing a task to the Supervisor (`--to`) comes later |
| `task wait <id> [--timeout]` (later) | kernel, supervisor | read | block until the result arrives or the deadline passes |
| `task result <id> --status done\|blocked\|mismatch\|failed --output <json>\|@<file>` | worker, op, agent, kernel, supervisor | local-write | file the one immutable result of the open attempt; a queued task is worked inline (lite); `failed` preserves and resets the task's dirty `allowPaths`, then releases its leases |
| `task verify <id> [--no-commit]` / `task verify <id> --recover` / `task verify --contract <file> [<id>] [--record]` | every writing role, op included | local-write | verify a reported task on a clean checkout of HEAD plus its `allowPaths`, one settle at a time: green moves the branch to a harness commit of only those paths (never pushed) and closes the task's seats; red preserves and resets its paths, fails the task and releases its leases; no verdict (`HEAD_MOVED`, a broken verifier) returns it to reported with no try spent. `--no-commit` only checks; `--recover` frees a task whose verifier died; `--contract` dry-replays a contract in the working tree, its `@result` json checks reading the task's output file |
| `task status [<id>\|--workflow <w>]` | everyone | read | task states, attempts, result, leases, check runs, seats and preserved work |
| `task cancel <id> [--reason <r>]` | owner, kernel, supervisor | host | stop and release the task's seats through Orca, preserve and reset its dirty `allowPaths`, cancel it and release its leases; refused while a worker may still write |
| `msg send <seat> ping\|status\|cancel\|pause\|resume` (later) | kernel, supervisor | host | one command; the seat runner answers within the deadline |
| `msg recv` / `msg reply` | hidden (seat runner) | local-write | the runner's command loop |
| `seat start <task> [--agent <a> --model <m>] [--effort <e>] [--worktree <path\|selector>] [--run <id>] [--timeout-ms <ms>] [--dry-run]` / `seat start <task> --resume` | owner, kernel, supervisor, coordinator | host | write the task's brief, claim the queued task and launch one Orca worker on it (see §7); without `--agent` and `--model` the router picks them (§3) and the pick is stored on the attempt; other roles and headless seats come later |
| `seat list [--live]` / `seat stop <seat>` | list: everyone; stop: owner, kernel, supervisor, coordinator | read / host | the seats with agent, model, status, last pong and liveness verdict from the recorded pings (`--live` asks Orca); stop and release one seat's worker |
| `seat ping <seat>` | owner, kernel, supervisor, coordinator | local-write | ask Orca (`worker-show`, under the ping deadline) about one open seat and record last ping, last pong and Orca's last-output time; Orca's explicit word that the worker is gone makes the seat `worker-lost` and its running task `effect_unknown` (exit 1); no answer proves nothing |
| `seat run` | hidden | host | the seat runner process itself |
| `supervisor start\|stop\|status` | owner | host | the one host Supervisor seat |
| `supervisor tell "<text>"` | owner | local-write | an owner message; the Supervisor turns it into a task or an amend |
| `supervisor decide <item> --choice <c>` | owner | local-write | answer one owner decision the Supervisor raised |
| `debug open --incident <id>` | supervisor | host | start a Debug seat on a harness or environment failure |
| `debug report --diagnosis <file> --repair <contract>` | debug | local-write | return the diagnosis and the repair contract to the Supervisor |

Core verbs that every role uses: `check run|lint|typecheck`, `release ci-status`, `explain` and `doctor`. `release push|cut|publish` list the owner and release roles (push also coordinator and lead); see Open questions.

That makes about 30 harness verbs plus about 15 core verbs, instead of 268 today.

An `inline` run, in either edition, needs no Kernel seat, Supervisor or worker seats. It uses `contract new|check` and `task send|result|status|verify|cancel`: the chat agent states the contract of its own work, sends it, files the result inline and has it verified and committed with the same checks.

### Workflow file and graph (P3)

The Kernel (an agent) writes the workflow file; the harness validates and records it and never invents a task.

```yaml
schema: starci/workflow@1        # yaml or json
id: todo-api                     # lower-case key, the workflow id
goal: A todo module in three layers, with a guide
runner: orca                     # orca | inline
agent: claude                    # agent + model pin every orca task (optional; without a pin the router picks)
model: claude-sonnet-5-5
effort: high                     # optional, with a pin
bias: {prefer: [claude]}         # optional router bias: only, avoid, prefer
maxParallel: 2                   # orca live tasks at once (default 2); inline runs one
base: HEAD                       # base of inline contracts (default HEAD)
worktree: path:/work/wf-todo     # optional orca worktree selector
tasks:
  - id: model                    # the plan key of its ledger tasks
    label: test                  # inline contract: label, summary, allowPaths, checks (+ details, readPaths, cwd, budget)
    summary: write src/model.js exporting todo(title)
    allowPaths: [src/model.js]
    checks:                      # the label's default checks are added, as contract new does; a bare name is a preset
      - check: {kind: command, run: [node, -e, "require('./src/model.js')"]}
    difficulty: medium           # optional, read by the router
  - id: store
    contract: contracts/store.json   # or a contract file, relative to this file
    dependsOn: [model]
    agent: codex                 # optional per-task pin (agent and model together)
    model: gpt-6.1-sol
```

A change file is `{schema: starci/workflow-change@1, workflow: <id>, reason?, changes: [...]}` with entries `{op: add, task: {...}}`, `{op: edit, id, set: {...}}` (inline fields merge onto the task's contract, `contract:` replaces it, `dependsOn` and pins replace theirs), `{op: remove, id}` and `{op: retry, id}` (a new retry round, so the same contract is sent again).

- **Graph:** each task is a node keyed by its id. Its **node hash** covers its contract hash, its retry round and the node hashes of its dependencies, so a change flows down to every dependent. Two tasks with no order between them whose `allowPaths` overlap are allowed; `define` notes them and the path lease runs them one after the other.
- **Dispatch:** a node is ready when every dependency is done. Its ledger task is created only then (with `workflow_id`, its plan key and its node hash), so a waiting node holds no lease. An `orca` task is then launched through the seat-start module function: pinned, or routed by `pickRoute` from its label, difficulty, lineage and the workflow's bias; a refused route or a failed launch leaves it queued for the next step. Every dispatch first checks the workflow budget (`BUDGET_EXHAUSTED` holds it).
- **Node states:** waiting, ready, blocked (a dependency is stuck), then the task's own: queued, running, launch-unknown, lost (Orca said its worker is gone: stuck until the Kernel cancels and amends), reported, returned (the worker filed blocked or mismatch), verifying, done, failed, cancelled.
- **Workflow states:** defined, running, blocked, paused, stopping, stopped, done (`WORKFLOW_TRANSITIONS`). A red verify (or a failed, returned, lost or cancelled task) blocks its dependents and makes the workflow `blocked` with the reason, naming the red checks; independent tasks keep going. A retry is the Kernel's amend (`edit` or `retry`), never automatic: the new task retries the failed one (same label and paths) within its try budget.
- **Inline:** the step queues one task at a time and prints it with its brief and the commands (`task verify --contract`, `task result`, `workflow step`); the contract is sent before the agent edits code.

## Ops are plain workers (owner, 2026-10-27)

Owner: the Kernel writes each op's contract itself, so an op is only a worker. There is no catalog of op kinds: the 39 manifests of `modules/ops/ops` are retired.
- **One worker.** Every op runs the same brief:
  - read the contract;
  - do `input` inside `context`, writing only `allowPaths`;
  - dry-replay its contract with `starci task verify <task> --contract <copy>` until it is green or the budget ends;
  - return with `starci task result`.
  The intelligence that used to live in op manifests (what to read, what to prove) is now in the contract the Kernel writes.
- **The Kernel picks the worker:** the agent (Claude, Codex or Devin), the model and the budget for each task. It decides from the task (size, kind of work) and the host's provider health and quotas.
- **Reusable checks, not op kinds.** A small library of named check presets helps the Kernel compose `expectedOutput` without retyping:
  - `check-run-green`: `starci check run` exits 0 in the lane;
  - `paths-only`: only `allowPaths` changed;
  - `tests-pass <names>`;
  - `json-schema <file> <schema>`: the file is one the task lands, read from the clean checkout; `@result` names the worker's filed result output instead (preset `result-json`);
  - `renders <viewports>`;
  - `probe <url> <status>`.
  `contract new --check` composes them, and `contract check` refuses a check that no machine can run.
- **What the old ops did now lives elsewhere:**
  - Planning (request.analyze, scope.define, goal.revise, work.author) is the Kernel's own work.
  - Reviewing (review.verify) is gone: machine checks go in `expectedOutput`, and taste goes to the owner.
  - Handover, the owner asks (provision.ask) and runtime operation (runtime.operate) belong to the Kernel and the Supervisor.
  - Everything else (implement, fix, refactor, test, scaffold, draw, verify suites, UAT, docs, deliver) is a contract the Kernel writes for a worker.
- **Lite:** the chat agent is the worker. It can write its own contract with the same presets and prove its work with `task verify`.

### Tests stay inside the task; CI judges the rest (owner, 2026-10-27)

Owner: "tránh vết xe đổ là quá nhiều test nên test trong phạm vi nó làm thôi!!! và push main để ci tự xử". In English: learn from the past, where too many tests ran; test only within the task's own scope, push main, and let CI handle the rest.
- **A contract's checks cover only what the task changed:**
  - `check-run-green` runs `starci check run` against the lane's own diff;
  - `tests-pass` names the tests related to the changed files, the `jest --findRelatedTests` reach, and never a whole suite;
  - `paths-only` keeps the change inside `allowPaths`.
- **No contract asks for a full suite**, whether unit-all, e2e-all or the example rows. A `verify` worker runs a heavy suite only when the goal itself is that suite, for example a performance measurement the owner asked for.
- **Landing:** when a task's verify is green, the Kernel merges the lane. The Supervisor lands and runs `starci release push`. CI runs the full suite on main.
- **CI red:** the Supervisor reads `starci release ci-status`. A red verdict becomes a `code` contract for a worker, scoped to the red checks, and never blocks the next push.

### Source-code policy (owner, 2026-10-27)

`policy/` beside `ops/` holds four files. Policy selects and configures. It never restates a rule: the rules live in the CLI and in the canon packages, and each fact has one owner.

- **`quality.yaml`**: the two gate tiers, the profiles and `requireCi`.
  - The **runtime tier** runs in `starci check run` before a push and in `task verify` on the clean checkout, scoped to the diff, each process bounded by `stepTimeoutSeconds`. Its gates are `secrets`, `loosening`, `canon`, `typecheck` and `lint`.
  - The **CI tier** (`unit`, `e2e`, `build`, `sonar-new-code`) runs on main after the push. Nobody waits for it unless `requireCi` lists the action: today `release.cut`, `release.publish` and `deploy.prod`, which refuse `CI_NOT_GREEN` unless `release ci-status` of their commit is green.
  - A gate name the CLI does not implement is refused when the file is read.
- **`canon.yaml`**: the canon package of each stack and tool, by npm name: fe → `@starci/eslint-canon-fe`, be → `@starci/eslint-canon-be`, css → `@starci/stylelint-canon`, plus `@starci/tsconfig`, `@starci/prettier-config` and `@starci/jest-preset`. The `canon` gate requires every changed package to depend on its profile's canon package for each tool it configures, and that tool's config to name it.
- **`loosening.yaml`**: the banned markers (inline disables, ts escapes, NOSONAR, skipped or focused tests, swallowed failures, `--no-verify`, gate-widening allowlists). `starci check loosening` reads the tree as it stands, not a diff, and reports `file:line`. Exceptions are declared only in policy, each with one file, one marker and the reason, never inline; an exception that matches nothing is red.
- **`security.yaml`**: configures the secret scan (`starci check secrets`, and `release push` on the pushed range). Sops envelopes are allowed, except under the `runtime` profile; `neverRead` lists the files the CLI never opens.
- **Profiles:** a project picks its profile in `hfs.json` (`"policy": "be" | "fe" | "app" | "lib" | "runtime"`). Without one, `defaults` chooses: `lib` for no hfs.json, `app` for an app, `runtime` for the runtime.
- **Project overlays:** a project may carry `policy/loosening.yaml` and `policy/security.yaml` to ban more and declare its exceptions. It can never unban, and never carries `quality.yaml` or `canon.yaml`.
- **Verbs:** `check loosening`, `check secrets` and `check ci` are core read verbs. The `ci-green` preset (`check ci --ref origin/main`) lets a deliver contract wait for CI.

### Who does what now (owner, 2026-10-27)

| party | work | from the old ops |
|---|---|---|
| Kernel (its own reasoning) | plan: analyze the request, bound the scope, revise the goal, write the records and the graph | request.analyze, task.execute, scope.define, goal.revise, work.author, workspace.manage |
| Kernel (its own reasoning) | decide: business behaviour, architecture, brand, provisional decisions | business.decide, architecture.decide, brand.decide, decision.prepare |
| Kernel | finish: assemble the handover and ask the Supervisor for owner acceptance | handover.review |
| Supervisor | owner asks (credentials, accounts), host and runtime operation, scope amends | provision.ask, runtime.operate |
| Owner | taste and UX acceptance | review.verify (its non-machine part) |
| Worker (op) | **code**: scaffold, implement, fix, refactor, remove a feature | backend/interface/package.scaffold, backend/interface.implement, code.fix, code.refactor, scope.finish, knowledge.repair |
| Worker (op) | **test**: write tests inside test paths | test.author |
| Worker (op) | **ui**: draw screens, generate assets, grow the Grammar | interface.draw, interface.asset, interface.audit, grammar.update |
| Worker (op) | **verify**: run a heavy suite on a real stack and report it as json | unit/integration/e2e/perf/security.verify |
| Worker (op) | **uat**: walk the flows in a browser with evidence | uat.verify, uat.assisted.prepare, uat.assisted.verify |
| Worker (op) | **docs**: documentation and product content | docs.author, content.generate |
| Worker (op) | **deliver**: publish, deploy or migrate one target and probe it live | release.deliver |

- The worker labels (code, test, ui, verify, uat, docs, deliver) are not manifests. They are a routing hint the Kernel puts on a contract so it can pick the agent and model.
- When a plan or a decision is too large for the Kernel's own turn, the Kernel may still send it to a worker as a contract whose `expectedOutput` is a json record. It then judges that record itself.

## Harness plan (alpha.40): ops/, verbs, routing, failures

Based on three readings of the legacy runtime (2026-10-27): its routing (`scripts/agent/op-pick.mjs`, `lib/tier-pick.mjs`, `modules/models/*`), its failure handling (`failure-codes.yaml`, `op-incident-policy.yaml`, provider circuit, pool backoff, liveness, budgets), and its job lifecycle (`driver-loop.yaml`, dispatch, settle, leases, Orca launch). Each section keeps the legacy core and drops its accretion.

### 1. Repository layout

```
cli/                       the starci CLI (exists)
  src/harness/             ledger, contracts, tasks, router, failure policy, liveness, seat launch
ops/                       everything that describes work, as data validated by the CLI
  worker.md                the one worker brief (prompt template)
  labels.yaml              code, test, ui, verify, uat, docs, deliver: difficulty floor, host tools, default checks
  checks.yaml              the named check presets (check-run-green, paths-only, tests-pass, json-schema, renders, probe)
  routing.yaml             tiers and their chains, pools (provider, maxParallel, labels, tools), host probes, balance, quota bands,
                           circuit cooldowns and strikes, failure signals, AIMD tuning, workflow budgets
  liveness.yaml            seat liveness thresholds and the Orca answers that prove a worker gone
  uat.yaml                 the pinned Playwright image of `uat run` and the bounds of one run
```
`ops/` is data, not code. Every tunable number lives there once, and the CLI reads it. Nothing is restated in prose.

### 2. Worktree model (decision for the owner)
- **Legacy (proven):** one worktree per workflow (`wf-<id>`).
  - Parallel workers share it, and path leases keep their `allowPaths` disjoint.
  - The harness, never the worker, commits a task's own paths when its verify is green, and preserves and resets them when it is red.
- **Lane per task:** isolation, but each lane needs its own `npm ci`, and every lane must be merged back. The legacy runtime never did this for product work.
- **Proposal:** keep the legacy model. One workflow worktree, path leases, and a harness commit per green task. The scoped check of a task filters the diff by its `allowPaths`.

### 3. Model and agent selection (router)
The legacy minimal core, kept as is:
1. `tier = labelTier ?? difficultyTier[max(difficulty, labelFloor)]`, where difficulty is easy, medium, hard or insane, mapped to the low, medium, high and frontier tiers.
2. The tier is an ordered chain of `{agent, model, effort}`.
3. A member is dropped when:
   - its pool does not serve the label;
   - a host tool the label needs is missing;
   - this task's lineage excluded the pool (1 attributable failure demotes it, 2 exclude it);
   - the provider circuit is open;
   - `running >= min(maxParallel, backoffCap)`.
4. Owner bias: `only`, `avoid` or `prefer`. A bias that empties the chain is a refusal, never a silent fallback.
5. Balance: a member picked 3 times in a row, or holding more than 70% of the tier's running seats, yields to the next member.
6. Quota: a member at 90% or more of its quota window is skipped. A biased member may go to 95%. At 100% it is never used. When every member is out, the result is `tokens-out` with the earliest reset.
7. The first remaining member is chosen. The pick record (chain, dropped members with reasons, chosen member, chosen-by) is stored on the attempt, and dispatch reuses it.
8. A retry re-picks with lineage penalties, and the second contract-red of a lineage raises the tier one step (amendment 5); infrastructure failures keep the tier. An exhausted chain is escalated to the Supervisor.
9. Estimate: `W = Σ weight·count` (file 4, assertion 3, component 12, record 2). The size class gives the worker count, clamped by the disjoint path prefixes.

Dropped from the legacy router: the qualification and probation store (empty), 37 admission reason codes, fenced reservations with proofs, reviewer independence, prices in the decision, and the `route model` what-if.

### 4. Failures: classes, actions and bounds

| class | detector | action | bound | then |
|---|---|---|---|---|
| provider-unavailable (rate-limited, quota, capacity, auth) | typed launch or worker error | open the provider circuit for its kind, re-pick another pool, **no try spent** | cooldown: rate 10 min, quota 1 h or reset, capacity 10 min, auth 24 h; ×5 on reopen within 1 h, cap 1 h; launch kinds need 2 strikes | Supervisor |
| worker-lost | no pong before the deadline, or the seat is gone | one ping retry, then settle `no-report` and retry on another pool; an unknown effect is fenced and reconciled first | 2 | Supervisor, then owner |
| worker-hung | pong ok but no progress for `activeStale` | the same as worker-lost | 2 | Supervisor |
| contract-red | `task verify` red | rerun with the red checks fed back; the next attempt goes to another member | 2 | Kernel replans, then Supervisor |
| mismatch | the worker shows the contract is wrong | the Kernel rewrites the contract, **no try spent** | 1 | Supervisor |
| blocked (env, authority, gap) | typed result | env goes to the Supervisor, authority to the owner, a gap to the Kernel's plan | 1 to 2 | owner |
| contract-invalid | `contract check` | refuse before dispatch, no try spent | - | - |
| budget-exhausted | try, token or workflow cap | hold dispatch and raise a gate | - | the Supervisor or owner raises it, with who and why logged |
| resource-throttle | free RAM or pool capacity | queue with a named wait, never kill a running worker | - | - |

Accounting rules:
- A no-effect failure is free.
- An unknown or partial effect costs a try and is reconciled before the retry.
- `awaiting_owner` costs nothing.
- The task try budget is 5. Only the Supervisor or the owner raises it.
- A periodic sweep re-routes any failed task that has no recorded next step, so nothing fails silently.

Provider health keeps one row per provider, with its strikes, `circuit_open_until` and events. A cheap probe closes it early.

Pool concurrency is AIMD:
- halve it on a rate limit (floor 2, at most once per 2 min);
- add 1 every 5 min after 15 quiet minutes.

Dropped from the legacy: the 2,235-code catalog (about 95% are lint findings), terminal-screen scraping with per-card regexes, about 60 hold reasons and the conditions table. Codes stay, but only for runtime failures: a closed set, each with a handler and a next handler.

### 5. Liveness
- **Who answers.** The **seat runner** answers a `ping` for its seat, not the model. It is one host process, the harness daemon. It answers from Orca's own worker state (terminal alive, last output time) and from the task's ledger state.
- **Thresholds** live once in `ops/liveness.yaml`: `launchGrace`, `pingDeadline`, `activeStale` and `quiet`, with the Orca answers that prove a worker gone (a gone worker state or observation, or `dispatch_not_found`). Nudges (at most 2) and the Kernel (20 min) and Supervisor (30 min) turn budgets come with P4.
- **Built (P2, no daemon yet):** `seat ping` and every `workflow step` ask Orca's `worker-show` and record last ping, last pong and the last output time Orca reports. Only an explicit gone answer marks a seat `worker-lost` and its task `effect_unknown`, keeping its leases; the node is `lost` and the Kernel cancels and retries it. An Orca that is down, slow or unsure leaves the seat `unknown`, then `quiet` past the threshold, held and never dead; a pong with no output for `activeStale` is `stale` and only reported. The ping retry and the automatic no-report retry of §4 come with the daemon.

- **Seat rotation.** The Kernel and Supervisor seats are rotated after a wake or token budget. They keep no memory, because the ledger is the state.

### 6. Ledger and host store (where they live: Storage)
A project ledger has twelve tables:
- `workflows` (the goal and defaults of the workflow file, goal version, graph version, status and reason);
- `plan_nodes`, `edges` and `graph_versions` (since ledger version 4: each graph version's nodes with contract, contract hash, node hash, routing hints and retry round; their dependencies; and why the version was recorded, with its replan classification);
- `tasks` (contract, label, try number, retry-of, status; a workflow task also its plan key and node hash);
- `attempts` (one per dispatch: pick record, agent, model, outcome, verdict);
- `results` (immutable, unique per attempt);
- `check_runs` (raw exit codes; a worker's own runs are evidence only);
- `leases` (path prefixes held until the task ends, a fencing token, and a due time that is information only and never frees a path);
- `seats` (role, agent, model, attempt, Orca dispatch handle, worker-start request id, Run, the launch record a resume replays, status, last ping, last pong and last output time since ledger version 5, end time);
- `messages` (commands with a correlation id and a deadline);
- `events` (append-only).

`machine.sqlite` keeps only host-wide state: `ledgers` (the legacy registry columns plus `repo_common_dir`, the lookup key) and `provider_health` (a provider's rate limit or circuit is the same for every project, so it moved out of the project ledger; an older ledger keeps its unused table, since migrations never drop). P2 adds, in `harness/machine.ts`: `provider_events` (every outcome, open, recover and quota reading; reopens are counted from it), `pool_quota` (the newest reading per pool window; none is unknown, never blocked), `pool_concurrency` (the AIMD cap below maxParallel), `route_picks` (recent picks per tier, for balance) and `budgets`/`budget_raises` (a workflow's raised ceilings, who and why). Running workers are counted from the open seats of every registered ledger, read-only. Host locks come later. Seats and leases stay in the project ledger. The legacy's other machine tables are not carried over.

Status transitions are enforced in code with one state machine (`TRANSITIONS` in `harness/tasks.ts`), not duplicated in triggers. Task states are:
`queued → running → reported → verifying → done | failed | awaiting_owner | cancelled`, plus `effect_unknown` (a launch Orca could not confirm or deny, or a running task whose worker Orca reported gone). A launch that certainly failed returns `running` or `effect_unknown` to `queued`; a verify with no verdict returns `verifying` to `reported`. A new column comes by an additive migration that bumps the ledger version.

### 7. Seat launch (Orca)
- The claim comes first, in one transaction: the queued task goes to running, and an attempt and a `starting` seat carrying the launch record are opened. Only then is Orca called, so two starts never both launch.
- An agent starts through `orca orchestration run-create` (unless `--run` names a Run) and `worker-start --spec <short spec> --worktree <path|selector> --agent <a> --model <m> [--effort]`, each under a `--retry-request` id derived from the attempt id.
- The brief always goes to `briefs/<task>.md` in the project's state folder (see Storage), with the contract copy beside it and the worker's output file in `outputs/<task>.json`. Every worktree of the project reads the same files, nothing lands in the product repository, and the spec only points at the brief. This works around the Windows argv cap.
- After the start, the effective agent and model are attested from `worker-show`. A model mismatch, or a task cancelled during the launch, closes the worker (stop and release); a mismatch rolls the task back to queued.
- A certain failure closes what was left and rolls the task back to queued, with no try spent. An unknown outcome (outcome_unknown, an unreadable answer, a timeout) leaves the task `effect_unknown` with its leases and its seat open; `seat start <task> --resume` replays the same requests.
- A cancel stops and releases the task's seats. A launch whose outcome is unknown and that named no dispatch refuses the cancel until a resume learns the dispatch.

### 8. Verbs added to the harness set

| verb | does |
|---|---|
| `route explain --label <l> [--difficulty n] [--attempt n] [--red a/m,...] [--only\|--avoid\|--prefer a,...]` | dry-run the router and print the whole path: the tier and why, the chain after each step (hard filter, lineage, bias, balance, quota), every dropped member with its reason, the chosen member; records nothing |
| `provider status` / `provider recover <p> --by --reason` | circuits, strikes, pool caps, running workers and quota windows; close a circuit after a passing probe |
| `provider report <p> --outcome <kind>\|--quota <pct> [--pool] [--resets-at] [--detail]` | record what a worker's result or an account poll taught (`seat start` records its own launch outcomes; unknown is never a failure) |
| `budget show [<workflow>]` / `budget raise <workflow> --minutes\|--tries --by --reason` | a workflow's minutes and tries used against its ceiling (a launch that never ran spends no try); raising is owner or Supervisor only. A task's tries stay its contract's `budget.tries` |
| `lease list` | path leases and their holders |
| `sweep` | the periodic re-route of failed tasks with no next step (the daemon runs it; hidden) |
| `daemon start\|stop\|status` | the host process that runs seat liveness, pongs, SLA clocks and sweeps |

### 9. Phases

| phase | delivers | usable by |
|---|---|---|
| P0 | ledger, `ops/` schemas, `contract new\|check`, `task verify` | lite agents prove their own work |
| P1 | `task send\|result\|status\|verify\|cancel`, `seat start\|list\|stop`, path leases, the worker brief, Orca seat launch, harness commit per green task | the owner sends single tasks by hand |
| P2 | router, provider circuit, AIMD, budgets, failure routes, daemon liveness and sweep | unattended retries |
| P3 | workflow graph: `plan show\|diff`, `workflow define\|start\|step\|status\|list\|amend\|stop` (orca and inline); the Kernel loop that writes and amends the file is an agent | full workflows |
| P4 | Supervisor: owner channel, land, `release push`, CI red becomes a fix task, Debug seats | host-wide operation |
| P5 | parity run against the legacy on one real project, then cut over | alpha.40 |

### 10. Self-critique and the amendments it forces

| # | risk | severity | amendment to the plan |
|---|---|---|---|
| 1 | A worker games its own checks: it edits tests or relaxes lint so verify turns green | high | `task verify` replays on a clean checkout at the task's commit, never in the worker's environment. Tests and configs outside `allowPaths` are forbidden by default, and the loosening gate stays. |
| 2 | Green but wrong: machine checks miss the intent (Goodhart) | high | `contract check` refuses a contract without at least one behavioural check (a test or a probe). What cannot be measured becomes a named owner review step. |
| 3 | Shared worktree: task A's half-done edit turns task B's typecheck red | high | Keep the legacy side serialization (one be task and one fe task at a time per workflow). Verify on the clean base plus that task's commit only. |
| 4 | Bad contracts burn workers, and the Kernel is a bottleneck | medium | A strict `contract check` with concrete `allowPaths` and a behavioural check. A `mismatch` costs no try. One Kernel per workflow. |
| 5 | No escalation on retry, so a capability failure repeats | medium | A change from the legacy: a second `contract-red` raises the tier one step. Infrastructure failures keep the tier. |
| 6 | The contract hash misses code dependencies: a done task is invalidated by another task's files | medium | The hash includes a digest of the paths in `context`. An amend that changes those paths turns the dependent task into a redo. |
| 7 | Constant pushes to main, and a red CI breaks main for the other workflows | medium | A workflow lands in waves, not per task. A CI red still open after N minutes reverts the red commit automatically. |
| 8 | Liveness depends on Orca: an Orca restart once declared every worker dead | medium | "Unknown" is never "dead". Death is concluded only from an explicit Orca answer; otherwise the seat is held, not retried. |
| 9 | A big-bang rewrite and cut-over | high | Strangler cut-over: inline runs use the new CLI first, then one orca workflow runs beside the legacy, and verb groups move one at a time. |
| 10 | An LLM Supervisor places features unpredictably | low | The path-ownership map is data. Placement is a machine rule, and the LLM handles only the cases the rule cannot place. |
| 11 | Provider quota is not observable for every agent (Codex, Devin) | low | No reading means unknown, not blocked. Learn only from real quota errors through the circuit. |
| 12 | A worker with full Bash writes outside `allowPaths` or leaks a secret | medium | Keep a PreToolUse guard for dangerous commands, a diff check of `allowPaths` at settle, and the secret scan at push. |

## Knowledge

`knowledge/` beside `ops/` and `policy/` holds what an agent needs to decide how an app is built, and the data gates
and generators read to hold it. [knowledge/README.md](knowledge/README.md) is the map and the reading order per task.

- **Layout:** `ui/` (universal interface decisions), `grammars/` (the grammar contract and why each grammar looks as
  it does), `vendor/` (what HeroUI ships and what a grammar keeps), `patterns/{fe,be}/` (code patterns),
  `hfs/` (the app shape: `slots.yaml`, `rules.yaml`), `stack/` (`fe.yaml` libraries, `pins.yaml` versions),
  `decisions/` (`rulings.yaml`, the one owner-ruling log, and `open-*.md`, the owner's review queue).
- **Who reads it:** an authoring agent reads the Markdown reasoning; gates, lint and generators read only the YAML data
  (each with a `schema`) and pattern front matter.
- **Boundary model:** the grammar package (a package implementing the grammar contract: components, values, variants,
  the intent x placement map) owns what things look like; knowledge owns when and why; lint and gates enforce; the
  app writes product data and layout CSS only. Every app built from the same grammar and knowledge comes out the same.
- **One owner per fact:** a value code owns is named, never copied; a fact lives in one file; rules carry no dates or
  ruling citations, which live in `decisions/rulings.yaml`.
- **Feedback hardens:** a feedback becomes a grammar API that removes the choice, a lint, gate or threshold, or the
  rule rewritten in its one place, never a case note or a duplicate rule; each hardening records its ruling.
- **Product content is not knowledge:** requirements, brand direction, screen records and examples go to the
  product's `.starciwork`; gate selection, loosening, secrets and coverage are `policy/`.

## Open questions

1. Worktree model: keep the legacy shared workflow worktree with path leases (proposed), or a lane per task?
2. `ops/` data format: YAML validated by the CLI (proposed), or TypeScript objects?
3. Does `pattern` become its own group, or stay inside `app`?
4. Package naming: keep `@starci/cli` at 2.0.0, or a new name while both CLIs coexist?
5. Roles: the roles table says an op never pushes, while `release push` is a core verb of both editions. Today its roles are owner, release, coordinator and lead, so an op is not listed, but nothing enforces roles yet. Does pushing stay a core verb a role may be granted, or move into the Supervisor's harness set (and then how does a lite chat agent, role `agent`, push)?
