# Run a workflow

The workflow is defined and the owner's OK covers starting it. You hold its id and the product repository.
For an Orca workflow, the owner starts the host Supervisor once (`starci supervisor start`) and the following
start runs from that Supervisor terminal. The Kernel agent owns the step loop; the outside chat is Debug.

## Start

```text
starci workflow start <id>
```

- `orca`: launches a routed `[Kernel] <id>` agent into the Supervisor's Run. Its first command, `starci kernel
attach <id>`, binds its terminal, makes its own child Run and task, then steps the workflow. Ops launch beneath
  that Kernel as `[Op] <task>`, up to `maxParallel`, each pinned or routed. An Orca start outside the Supervisor
  terminal refuses `SUPERVISOR_REQUIRED`. Relaunch a missing Kernel or adopt a running workflow from the Supervisor
  with `starci kernel start <id>`. If Orca does not know the repository, the harness registers it (`orca repo add`).
- `inline`: queues one task and prints it with its brief and the commands to finish it. Work it as
  [inline-task.md](inline-task.md) says.

## The step loop

`workflow step` is one idempotent tick: it cancels live tasks no node carries any more, settles reported
tasks through `task verify`, closes the seat and tab of every task whose result is settled (done, failed, returned,
cancelled), dispatches newly ready tasks within `maxParallel` and the budget, and updates the status. A missing
Kernel must be relaunched from the Supervisor with `kernel start`. Exit 1 means the workflow is blocked.

```text
starci workflow step <id>
```

- **Inline**: call it after each `task result`; it settles that task and prints the next one. No timer.
- **Orca**: the Kernel follows [its coordinator brief](../../../ops/coordinators/kernel.md): wait on its child
  Run's mailbox with `orca orchestration check --terminal <kernel-terminal> --wait --types
"worker_done,question,escalation" --timeout-ms 600000 --json`, process every returned message and step. Mail wakes
  the loop; the ledger and contract checks decide state. Acknowledge the prior delivery on the next check.
- **A foreground harness loop**: `starci workflow run <id> --interval 60` repeats the step, one line per change,
  and exits 0 when done, 1 when blocked; it honours pause and stop.

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
contract, attempts, the filed result, leases, check runs and preserved work. Never read a worker's terminal;
the result and the verify are the only truth.

## Read a block

| What status shows                       | Do                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| a red verify, naming red checks         | read the check runs; the work was preserved and reset. Retry, or fix the contract (amend) |
| `returned`: the worker filed `blocked`  | supply what was missing by an amend, or take it to the owner                              |
| `returned`: the worker filed `mismatch` | the contract is wrong: fix it with an amend `edit` (no try spent)                         |
| a dependency is stuck                   | fix the stuck task; its dependents wait                                                   |
| `BUDGET_EXHAUSTED`                      | ask the owner; see [routing-and-providers.md](routing-and-providers.md)                   |
| a launch refused or unknown             | see [debug.md](debug.md)                                                                  |

A retry is never automatic.

## Amend

Write a change file (`starci/workflow-change@1`), or a whole workflow file with the same id:

```yaml
schema: starci/workflow-change@1
workflow: <id>
reason: <why>
changes:
  - { op: retry, id: <key> }
  - { op: edit, id: <key>, set: { checks: [...], details: <text> } }
  - {
      op: add,
      task:
        {
          id: <key>,
          label: <label>,
          summary: <s>,
          allowPaths: [<p>],
          checks: [...],
        },
    }
  - { op: remove, id: <key> }
```

`edit` merges inline fields onto the task's contract; `contract:` replaces it; `dependsOn` and pins
replace theirs. Preview, then apply:

```text
starci plan diff <id> --to <change-file>
starci workflow amend <id> --change <change-file>
```

The diff classifies each task keep, continue, redo, add or drop and lists what it would cancel. A retry or a
contract fix inside the accepted goal is your call; an add, a remove or a redo of done work needs the
owner's OK on the diff. `WORKFLOW_MOVED` means the graph changed under you: diff again.

## Stop

The Kernel finishes settled work with a graceful stop and handover. An early stop needs the owner's approval.

```text
starci workflow stop <id> --graceful
starci workflow stop <id> --hard
```

`--graceful` sends nothing new and lets live tasks settle; the workflow reads `stopping` until none is live.
In an inline run, finish the current task or cancel it (`starci task cancel <task> --reason "<why>"`),
then step once. `--hard` cancels every live task and its seats now. The Kernel's own stop leaves its terminal open
to send `handoff` and `worker_done` upward; the Supervisor repeats `workflow stop <id> --graceful` after completion
to release the Kernel dispatch and close its terminal after its Ops.
