# STARCI.md: the starci CLI rewrite (1.0.0-alpha.40)

Owner: the owner. This is the working design of the rewritten CLI in `D:\.claude`. It records the owner's decisions and the verb set under discussion. The old CLI in `starci-academy-backend/.claude` keeps running until the new one reaches parity.

## Decisions taken (owner, 2026-10-27)

- **One CLI written in TypeScript with `commander`**, no Nest. It is built with `tsc` into `cli/dist`. npm ships `dist/` only, and git never commits it. `prepare` builds on install and `prepublishOnly` gates on typecheck, lint and build.
- **The CLI source passes ESLint** at typescript-eslint `strictTypeChecked` plus `stylisticTypeChecked`, with `noInlineConfig`. Nothing is disabled inline.
- **One shared standard (`cli/src/shared`):**
  - `defineVerb` is the one definition of a verb: path, summary, editions, effect, roles, json schema, typed flags and the handler. Help, `starci explain`, docs and completions all come from it, with no YAML beside the code.
  - Every verb prints one json envelope with `--json`: `{schema, ok, data}`, or `{schema: "starci/refusal@1", ok: false, code, message}`.
  - Exit codes: 0 done, 1 refused (nothing moved), 2 bad usage.
  - Host tools run without a shell (`runTool`, and `runNpm` goes through the running Node), so no quoting breaks on Windows.
  - `locateTree` reads the nearest `hfs.json`. A lite app sees core plus lite verbs, a full app sees core plus full verbs, and the runtime or a bare folder sees everything.
- **Edition model:**
  - The **full** edition runs its workflows in Orca: the Kernel, ops, workers and the Supervisor.
  - The **lite** edition runs inside a Claude or Codex chat and puts the canonical patterns first. The agent codes directly, and the CLI gives it the patterns, checks and app operations.

## Layout

```
cli/
  src/
    main.ts                    builds the commander program for the tree of the working directory
    registry.ts                every verb, core first, then each edition
    shared/                    verb, errors, output, tree, exec
    core/<group>/<verb>.ts     verbs of both editions
    lite/<group>/<verb>.ts     verbs of lite apps
    full/<group>/<verb>.ts     verbs of full apps and their Orca workflows
  dist/                        build output, not committed
```

## Verbs written so far

| command | edition | effect | what it does |
|---|---|---|---|
| `starci version` | core | read | CLI and Node versions |
| `starci explain [--term t]` | core | read | the verbs available here, from their definitions |
| `starci doctor` | core | read | node, git, npm and gh on the host; the StarCi tree of the folder |
| `starci check run [--base ref] [--all]` | core | read | the scope decision from the diff, then typecheck and lint of exactly that scope |
| `starci check lint` / `check typecheck` | core | read | one step of the same scope, using each package's own ESLint or tsconfig |
| `starci release push [--dry-run]` | core | remote | the light gate (on main, clean, fast-forward, no secret in the pushed range), then git push with hooks |
| `starci release cut [--package p] [--dry-run]` | core | remote | tag v<version> on a commit already on origin/main with its CHANGELOG section; pushes the tag alone |
| `starci release publish [--publish]` | core | publish | the plan of package versions missing from npm; --publish publishes them from main and reads each back |
| `starci release ci-status [--sha]` | core | read | the GitHub Actions verdict of a commit |
| `starci app info` | lite | read | the lite app's be/fe apps, canonical patterns and backing services |

Parity gaps with the old CLI, by design for now:
- The secret scan carries the provider shapes, forbidden paths and the quoted keyword assignment. It does not carry the unquoted dotenv form, SQL role passwords or badge-token exemptions.
- `release publish` has no clean-install proof, canon rebind or example re-pin. Those belong to the runtime's canon packages, not to a product.
- Roles are declared on every verb but not yet enforced. Enforcement needs the caller's role, from the seat or an env var.

## Proposed verb set (for the owner's review)

The old CLI has 268 verbs in 30 groups (see the inventory in `starci-academy-backend/.claude/STARCI.md`). The proposal keeps what each edition needs and folds the rest.

### Core (both editions)
- `version`, `explain`, `doctor`
- `check` holds run (scoped), lint, typecheck and unit. It replaces the one-verb groups check, lint and typecheck, and gate unit.
- `git` holds commit, sync and backup.
- `release` holds push (light gate), cut (tag only), publish, ci-status and notes.
- `pattern` holds list, show and add. It covers the canonical capabilities (old `app add` and `app new`), and the lite edition leads with it.
- `app` holds scaffold, sync, check, emit, db, secret, coverage and hygiene. The `--edition` given at scaffold is fixed.

### Lite (agent in chat, pattern first)
- `app info`
- `supabase` holds start, stop, status and cloud.
- `stack` holds deploy, verify and rollback (Swarm, one api).
- `docker` holds build, up and down.

### Full (workflows in Orca)
- `workflow` holds define, start, status, stop and archive.
- `task`, `msg` and `seat` replace the old kernel's watching verbs. See "Harness core" below. Without observe, nudge, critic or redesign, the Kernel needs only plan, send, wait, verify, escalate and status.
- `lane` holds workers and worktrees (old worker, machine worktrees and supervisor gc).
- `supervisor` takes the same task protocol, plus the owner channel: status, decide and tell.
- `work` collects the drawing steps under one `work draw <step>`, plus brand, graph and validate.
- `uat` holds record and slots.
- `app add reactor|saga|projection` and `test-world`.
- `stack` keeps the full infra (Kafka, Keycloak, test world).

### Removed or hidden
- Removed:
  - `supervisor push`, which still says "run full suites then push", against ruling push-main-after-scoped-check;
  - the 21 verbs nothing references, unless the owner keeps one.
- Hidden, still callable by hooks and seats: `guard *`, `orca terminal-*`, `reconciler once`, `supervisor watchdog`.

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

The rights are enforced from each verb's `effect` and `roles`. The seat runner tells the CLI its role, and a verb refuses a role it does not list.

### Changing a running workflow (amend)

Owner, 2026-10-27: the scope of a running workflow can be stopped, extended, edited or trimmed through the Supervisor. Each change rebuilds the graph and decides what keeps running.
- **Entry:** `starci workflow amend <workflow> --change <file.json>`.
  - The change is a list of entries, each `stop` (`graceful` or `hard`), `pause`, `resume`, `add`, `edit` or `remove`, written against the goal's requirements.
  - The change goes to the Supervisor as a task contract, and the Supervisor hands it to that workflow's Kernel.
- **Kernel replan:**
  1. Freeze: it sends no new task, and running tasks keep running.
  2. It applies the change to the goal, which becomes goal version n+1.
  3. It builds the new graph and diffs it against the old one by each task's **contract hash** (context, input, expectedOutput and the hashes of its dependencies). Each old task is classified:
     - keep: done and unchanged, so its result is reused;
     - continue: running and unchanged;
     - redo: its contract or a dependency changed, so it is cancelled and queued again;
     - add: new in the goal;
     - drop: no longer in the goal, so it is cancelled and its history kept.
  4. It records the graph version and the classification, then resumes dispatch from the new graph.
- **Owner gate:** when a replan drops or redoes more than the owner's threshold, the Kernel returns the plan to the Supervisor, which asks the owner before resuming.
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

### Storage: one SQLite file per project
There are four tables, instead of about 50 runtime tables and 90 machine tables:
- `seats`: who runs where, plus the last pong;
- `messages`: commands and their replies, with a correlation id and a deadline;
- `tasks`: the contract, the sender, the receiver, the status and the attempts;
- `results`: the output, the evidence and the verify verdict.

### CLI of the harness (full edition)

Who runs each verb is enforced from its `roles`. `hidden` verbs are called by the seat runner, not typed by people or agents.

| verb | who runs it | effect | what it does |
|---|---|---|---|
| `workflow define <goal.json>` | owner | local-write | record a goal (its requirements) and queue its workflow |
| `workflow start <id>` | owner, supervisor | host | boot the workflow's Kernel seat |
| `workflow list` / `workflow status <id>` | everyone | read | the workflows and their graph version, progress and waits |
| `workflow amend <id> --change <file>` | owner | local-write | stop, pause, resume, add, edit or remove scope; sent to the Supervisor |
| `workflow stop <id> --graceful\|--hard` | owner, supervisor | host | the stop entry of amend as a shorthand |
| `plan show <workflow>` | everyone | read | the current graph: tasks, edges, contract hashes and states |
| `plan diff <workflow> --to <goal-version>` | kernel, supervisor | read | the keep, continue, redo, add and drop classification of a replan |
| `plan apply <workflow>` | kernel | local-write | record the new graph version and resume dispatch |
| `contract new --kind <op-kind>` | kernel, supervisor | local-write | write a contract skeleton for an op kind |
| `contract check <file>` | everyone | read | validate the contract: schema, machine-runnable checks, `allowPaths` |
| `task send --to <op-kind\|seat\|supervisor> --contract <file>` | kernel, supervisor | host | queue the task and start or assign its seat; returns the task id |
| `task wait <id> [--timeout]` | kernel, supervisor | read | block until the result arrives or the deadline passes |
| `task result <id> --status <s> --output <file>` | op, supervisor | local-write | the receiver returns done, blocked, mismatch or failed with its output |
| `task verify <id>` | kernel, supervisor, op | read | replay every check of `expectedOutput` against the result; only green settles |
| `task status [<id>\|--workflow <w>]` | everyone | read | task states, attempts and verdicts |
| `task cancel <id>` | kernel, supervisor | host | send `cancel` to the task's seat |
| `msg send <seat> ping\|status\|cancel\|pause\|resume` | kernel, supervisor | host | one command; the seat runner answers within the deadline |
| `msg recv` / `msg reply` | hidden (seat runner) | local-write | the runner's command loop |
| `seat start --role <r> --agent <claude\|codex\|devin> [--task <id>]` | kernel, supervisor | host | launch an agent plus its runner in Orca or headless |
| `seat list` / `seat stop <id>` | supervisor (list: everyone) | host | the seats and their last pong; stop one |
| `seat run` | hidden | host | the seat runner process itself |
| `supervisor start\|stop\|status` | owner | host | the one host Supervisor seat |
| `supervisor tell "<text>"` | owner | local-write | an owner message; the Supervisor turns it into a task or an amend |
| `supervisor decide <item> --choice <c>` | owner | local-write | answer one owner decision the Supervisor raised |
| `debug open --incident <id>` | supervisor | host | start a Debug seat on a harness or environment failure |
| `debug report --diagnosis <file> --repair <contract>` | debug | local-write | return the diagnosis and the repair contract to the Supervisor |

Core verbs that every role uses: `check run|lint|typecheck`, `release push|cut|publish|ci-status`, `git commit|sync`, `explain` and `doctor`.

That makes about 30 harness verbs plus about 15 core verbs, instead of 268 today.

Lite has no Kernel, Supervisor or seats. It keeps `contract new|check` and `task verify`, so a chat agent can state the contract of its own work and prove it with the same checks.

## Op kinds (full edition)

The old runtime declares 39 ops in `modules/ops/ops`. In the contract model an op kind is a **contract template**: the default `context` it reads, the `allowPaths` it may write and the default `expectedOutput` checks. The Kernel fills in the input. The proposal keeps 13 kinds.

| op kind | does | default expectedOutput (machine checks) | replaces |
|---|---|---|---|
| `plan.define` | turn a request or a goal change into a graph proposal of tasks | a json graph matching the plan schema, with every task contract passing `contract check` | request.analyze, task.execute, scope.define, goal.revise, work.author, workspace.manage |
| `design.decide` | decide one business, architecture or brand slice as a typed record | the record matches its schema and every referenced path exists | business.decide, architecture.decide, brand.decide, decision.prepare |
| `ui.design` | draw the screens and generate their assets | renders exist at the declared viewports, assets are in the repository, the Grammar lint is green | interface.draw, interface.asset, interface.audit |
| `grammar.update` | add one semantic unit to the design Grammar | Grammar typecheck and the stories build are green, plus the new story exists | grammar.update |
| `code.scaffold` | create a new back-end, front-end or package tree | `starci check run --all` is green in the new tree | backend.scaffold, interface.scaffold, package.scaffold |
| `code.implement` | implement one slice (be, fe or package), including removing a feature | `starci check run` is green, only `allowPaths` changed, the named tests pass | backend.implement, interface.implement, scope.finish |
| `code.fix` | repair a red check or a red CI of a landed revision | the named red checks are green and nothing else turned red | code.fix, knowledge.repair |
| `code.refactor` | restructure under an unchanged behaviour | the same tests pass before and after, `starci check run` is green | code.refactor |
| `test.author` | write the tests of one slice inside test paths only | the new tests run, coverage of the slice meets the threshold, only test paths changed | test.author |
| `verify.run` | run a heavy suite (unit, integration, e2e, perf or security) on a real stack and report it | a json report matching the suite schema, with the verdict computed from it | unit.verify, integration.verify, e2e.verify, perf.verify, security.verify |
| `uat.run` | walk the UAT flows in a browser with screenshots or video | every flow step has its evidence file, and the failed steps are listed in the json | uat.verify, uat.assisted.prepare, uat.assisted.verify |
| `docs.author` | write the docs or product content one scope needs | files are in `allowPaths`, links resolve, the doc-language check is green | docs.author, content.generate |
| `release.deliver` | publish, deploy or migrate one selected target and verify it live | the registry, health or migration probe returns the expected state | release.deliver |

These leave the op list and become another party's job:
- `review.verify`: an agent judging another agent is the critic model. Machine checks go in `expectedOutput`, and taste goes to the owner's review.
- `handover.review`: finishing a workflow is the Kernel's and the Supervisor's.
- `provision.ask`: asking the owner for a credential is the Supervisor's owner channel.
- `runtime.operate`: host and runtime operation belongs to the Supervisor.

The lite edition has no ops. The chat agent does the work itself, and it can use the same templates through `contract new --kind <op-kind>` to state and verify its own task.

## Open questions

1. Is the kernel slim list above right, or should the full kernel be audited verb by verb?
2. Does `pattern` become its own group, or stay inside `app`?
3. Package naming: keep `@starci/cli` at 2.0.0, or a new name while both CLIs coexist?
