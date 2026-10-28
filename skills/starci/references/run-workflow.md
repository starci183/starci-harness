# Run a workflow

The workflow is defined and the owner's OK covers starting it. You hold its id and the product repository.

## Start

```text
starci workflow start <id>
```

- `orca`: only from the terminal of the Supervisor of the repository's project (elsewhere `SUPERVISOR_REQUIRED`). It makes
  the workflow's one worktree and launches its `[Kernel] <id>` agent into that Supervisor's Run; the Kernel attaches, and its `kernel next` dispatches the
  ready tasks as `[Op] <label> (<task id>) - <summary>` under it, up to `maxParallel` within `workflowParallel` of ops/routing.yaml (the rest wait), each routed, all in that worktree. If Orca does
  not know the repository yet, the harness registers it (`orca repo add`).
- `inline`: queues one task and prints it with its brief and the commands to finish it. Work it as
  [inline-task.md](inline-task.md) says.

## The step loop

`workflow step` is one idempotent tick: it cancels live tasks no node carries any more, settles reported
tasks through `task verify`, closes the seat and tab of every task whose result is settled (done, failed, returned,
cancelled), dispatches newly ready tasks within `maxParallel` (capped by `workflowParallel`) and the budget, and updates the status. Exit 1 means
the workflow is blocked.

```text
starci workflow step <id>
```

- **Inline**: call it after each `task result`; it settles that task and prints the next one. No timer.
- **A terminal you watch**: `starci workflow run <id> --interval 60` repeats the step in the foreground, one line per
  change, and exits 0 when done, 1 when blocked; it honours pause and stop.
- **Orca**: the Kernel's loop is `starci kernel next <id>` (it steps, fences and waits for you) and one
  `starci kernel submit <file>` per decision, as [its brief](../../../ops/coordinators/kernel.md) says; no timer, no
  `/loop`. A Kernel that dies is relaunched by `supervisor next` and continues from the ledger and the worktree.

One loop per workflow. End it when the workflow is done or stopped.

`starci workflow pause <id>` holds dispatch while live tasks still settle; `starci workflow resume <id>` dispatches
again. Pause and resume are the owner's or the Kernel's.

## Watch

```text
starci workflow status <id>
starci plan show <id>
starci task status --workflow <id>
starci task status <task>
starci seat list --live
starci budget show <id>
```

`workflow status` names each task's state, its ledger task and why it waits. `task status <task>` shows the
contract, attempts, the filed result, its Op worktree, check runs and preserved work. Never read a worker's terminal;
the result and the verify are the only truth.

## Read a block

| What status shows | Do |
| --- | --- |
| a red verify, naming red checks | read the check runs; the work was preserved and reset. Retry, or fix the contract (amend) |
| `returned`: the worker filed `blocked` | supply what was missing by an amend, or take it to the owner |
| `returned`: the worker filed `mismatch` | the contract is wrong: fix it with an amend `edit` (no try spent) |
| a dependency is stuck | fix the stuck task; its dependents wait |
| `BUDGET_EXHAUSTED` | ask the owner; see [routing-and-providers.md](routing-and-providers.md) |
| a launch refused or unknown | see [debug.md](debug.md) |

A retry of a red, returned or stuck task is always an amend. A task the harness ended with no red of its own (a wave red not
proven its own, a fenced or lost launch, a verify stopped by infrastructure) is the one the harness retries itself, at the same
try (cli/README.md "Workflow graph").

## Amend

Write a change file (`starci/workflow-change@1`), or a whole workflow file with the same id:

```yaml
schema: starci/workflow-change@1
workflow: <id>
reason: <why>
changes:
  - {op: retry, id: <key>}
  - {op: edit, id: <key>, set: {checks: [...], details: <text>}}
  - {op: add, task: {id: <key>, label: <label>, summary: <s>, allowPaths: [<p>], checks: [...]}}
  - {op: remove, id: <key>}
```

`edit` merges inline fields onto the task's contract; `contract:` replaces it; `dependsOn`, `difficulty` and `risk`
replace theirs. Preview, then apply:

```text
starci plan diff <id> --to <change-file>
starci workflow amend <id> --change <change-file>
```

The diff classifies each task keep, continue, redo, add or drop and lists what it would cancel. A retry or a
contract fix inside the accepted goal is your call; an add, a remove or a redo of done work needs the
owner's OK on the diff. `WORKFLOW_MOVED` means the graph changed under you: diff again.

## Stop

Ask the owner first.

```text
starci workflow stop <id> --graceful
starci workflow stop <id> --hard
```

`--graceful` sends nothing new and lets live tasks settle; the workflow reads `stopping` until none is live.
In an inline run, finish the current task or cancel it (`starci task cancel <task> --reason "<why>"`),
then step once. `--hard` cancels every live task and its seats now. Under orca the Supervisor stops a workflow with a
`stop` command (`supervisor submit`); once stopped or done, after its Ops, the harness releases the Kernel's dispatch and
closes its terminal (a Kernel's own call leaves that to the Supervisor, so it can send its handoff first).
