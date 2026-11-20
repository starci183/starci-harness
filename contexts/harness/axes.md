# Two axes

- **Edition**: an app has one edition (R212 in [hfs/rules.yaml](../hfs/rules.yaml)), what the live
  apps run: the full code structure, slots, patterns and back-end unit specs; no Work features catalog (`.starciwork` keeps
  workspace.yaml, brand/** and the concepts); chat agents code directly and run the app gates before each commit, with no Kernel
  op required; its own stack on Docker Swarm with the backing services it declares; the integration and e2e test world on
  request only (R12). The hfs.json `edition` field is deprecated: any value is ignored with the warning HFS_EDITION_DEPRECATED,
  and a later train drops the field.
- **Runner** (`orca` or `inline`) is how a task runs, chosen per workflow or task. `orca` launches a worker seat through Orca,
  so tasks run in parallel. `inline` means the Claude or Codex session that is open does the task itself, one at a time.

Every app gets both runners, with the same contracts, Op worktrees, clean verify and harness commit. Inline, the agent is
both Kernel and worker, so its contract is sent (and its hash fixed) before it edits code, and the harness verify on a
clean checkout decides green; liveness applies only to the `orca` runner. `starci doctor` reports the tree the working
directory belongs to (`runtime`, `app` or `none`).
