# Inline task

You are both Kernel and worker: you do the task in this chat, and the harness, not you, decides green on a
clean checkout. One task at a time. The contract is sent, and its hash fixed, before you edit any code.

## 1. The contract comes first

- **Inside an inline workflow**: `workflow start` or `workflow step` printed the task id, its brief, and
  the three commands that finish it. The task is already sent. Read the brief.
- **A single task outside a workflow**: write the contract, judge it, show it to the owner when it goes
  beyond what they asked, then send it:

```text
starci contract new --label <label> --summary "<one sentence>" --allow <p1,p2> --check "<preset>:<arg>=<v>"
starci contract check <file>
starci task send <file>
```

`task send` prints the task id. Inside a workflow, `workflow step` names the task's own checkout (its Op worktree, cut from
the workflow's branch): work and run every command there; the harness removes it once the task settled.

## 2. Do the work inside allowPaths

Write only under `allowPaths`. Read exactly the files the contract resolves (`starci contract check <file>` lists them, base then extend). Never edit tests,
lint or configs outside `allowPaths`, never add a suppression, never commit: the harness commits.

## 3. Self-check until green

```text
starci task verify <task> --contract <contract-file>
```

Inside a workflow use the contract copy the brief names (`briefs/<task>.contract.json`); for a single task,
the file you sent. This dry-replays every check in the working tree and judges only your paths. Fix the
work until it is green, within the budget. Test only what the task changed. A red check is fixed in the
work, never in the check.

## 4. File the result

Write the output json (what you did, the files, the evidence) to the output file. Inside a workflow it is
`outputs/<task>.json` in the project's state folder, as the brief prints. Then file exactly one result:

```text
starci task result <task> --status done --output @<output-file>
```

Use `blocked` (something outside the contract is missing, one sentence), `mismatch` (the contract is
wrong, show why) or `failed` (the budget ran out, the last red checks) when that is the truth. `failed`
preserves and resets your paths.

## 5. Have it verified

- **Inside a workflow**: `starci workflow step <id>` verifies the reported task and prints the next one.
- **A single task**: `starci task verify <task>`.

Green commits only the task's paths on the current branch (never pushed). Red preserves the work under
`preserved/<task>` in the state folder, resets the paths and fails the task; read
`starci task status <task>`, then retry: `starci task send <file> --retry-of <task>` for a single task, an
amend `retry` inside a workflow. `HEAD_MOVED` returns the task
to reported with no try spent: verify again.
