# Orca worker

The worker's instructions are the procedure of [ops/ops/README.md](../../../ops/ops/README.md) and the op file of its label. Do not restate or override them.

What an Orca worker sees:

- A short spec that points at its brief, `briefs/<task>.md` in the project's state folder under
  `<runtime root>/.runtime/projects/<ledger_id>/`. The brief is that procedure with the task's id and files
  filled in, then the op and the contract in plain words: input, allowPaths, the exact files to read, the output keys and each check.
- Beside it, the contract copy `briefs/<task>.contract.json` it dry-replays, and the output file
  `outputs/<task>.json` it writes.
- Its worktree: the workflow's `worktree`, the `--worktree` given at launch, or the product repository.
- Nothing else: no owner channel, no other task's terminal.

The verbs it runs are the ones its brief names: `starci task status <task>`,
`starci task verify <task> --contract <file>` and `starci task result <task> --status <s> --output @<file>`.

From the Kernel's side: a worker is launched by `workflow step` (orca runner) or by
`starci seat start <task> --execute`, which writes the brief, claims the queued task and starts the agent.
`starci seat start <task>` (its dry run) writes the brief and prints the Orca argv without launching, the way to
read exactly what a worker will see. Never type into a worker's terminal; read its result and the verify.
