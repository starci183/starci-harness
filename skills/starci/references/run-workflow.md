# Run a workflow

The workflow is defined and the owner's OK covers starting it. You hold its id and the product repository.

## Start

```text
starci workflow start <id>
```

- `orca`: makes the workflow's Kernel in Orca once (a `[Kernel] <id>` terminal, its Run and its task; the terminal
  you run in when `ORCA_TERMINAL_HANDLE` names one), then dispatches the ready tasks to worker seats nested under it as
  `[Op] <id> › <task>`, up to `maxParallel`, each pinned or routed. If Orca does not know the repository yet, the harness
  registers it (`orca repo add`); if the Kernel cannot be made, the report says so and ops launch flat.
- `inline`: queues one task and prints it with its brief and the commands to finish it. Work it as
  [inline-task.md](inline-task.md) says.

## The step loop

`workflow step` is one idempotent tick: it cancels live tasks no node carries any more, settles reported
tasks through `task verify`, closes the seat and tab of every task whose result is settled (done, failed, returned,
cancelled), dispatches newly ready tasks within `maxParallel` and the budget, and updates the status. A Kernel
terminal that is gone is made again at the next launch. Exit 1 means the workflow is blocked.

```text
starci workflow step <id>
```

- **Inline**: call it after each `task result`; it settles that task and prints the next one. No timer.
- **A terminal you watch**: `starci workflow run <id> --interval 60` repeats the step in the foreground, one line per
  change, and exits 0 when done, 1 when blocked; it honours pause and stop.
- **Orca, Claude Code**: `/loop <interval> Run "starci workflow step <id> --cwd <repo>"; on exit 1 run "starci workflow status <id> --cwd <repo>" and handle the block as references/run-workflow.md says; stop when the status is done or stopped.`
  Use a few minutes as the interval.
- **Orca, Codex**: if the running Codex accepts `/loop`, use it with the same sentence; otherwise create a
  thread automation (heartbeat) with it; otherwise run the step yourself on each owner check-in. Say which
  one you used, and never claim a loop the host did not confirm.

One loop per workflow per chat. End it when the workflow is done or stopped.

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

| What status shows | Do |
| --- | --- |
| a red verify, naming red checks | read the check runs; the work was preserved and reset. Retry, or fix the contract (amend) |
| `returned`: the worker filed `blocked` | supply what was missing by an amend, or take it to the owner |
| `returned`: the worker filed `mismatch` | the contract is wrong: fix it with an amend `edit` (no try spent) |
| a dependency is stuck | fix the stuck task; its dependents wait |
| `BUDGET_EXHAUSTED` | ask the owner; see [routing-and-providers.md](routing-and-providers.md) |
| a launch refused or unknown | see [debug.md](debug.md) |

A retry is never automatic.

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

Ask the owner first.

```text
starci workflow stop <id> --graceful
starci workflow stop <id> --hard
```

`--graceful` sends nothing new and lets live tasks settle; the workflow reads `stopping` until none is live.
In an inline run, finish the current task or cancel it (`starci task cancel <task> --reason "<why>"`),
then step once. `--hard` cancels every live task and its seats now. Once the workflow is stopped, after its ops,
the harness closes the Kernel terminal it made (one it adopted from `ORCA_TERMINAL_HANDLE` stays open).
