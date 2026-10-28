# Open questions

1. **Worktree model.** Built: one workflow worktree, path leases keep parallel tasks disjoint, and the harness commits
   a task's paths when its verify is green. A lane per task isolates better but needs an install and a merge per lane.
   Does the owner confirm the shared worktree?
2. **`pattern` verbs:** their own group, or inside `app`?
3. **Placing a feature across running workflows.** Should the Supervisor place it by a path-ownership map kept as data,
   amending only the workflows that own the touched paths, with the model deciding only what the map cannot place?
4. **Who pushes in a lite app.** Under Orca, Debug alone merges and pushes ([decisions.md](decisions.md)), and no worker,
   Kernel or Supervisor does. How does a lite chat agent (role `agent`), which has no Debug beside it, push?
5. **Secret scan reach.** The scan carries the provider shapes, forbidden paths and the quoted keyword assignment, not
   the unquoted dotenv form, SQL role passwords or badge-token exemptions. Add them, or accept the gap?
6. **Replan owner gate.** When a replan drops or redoes more than a threshold, should the Kernel hold it for the
   owner's yes before resuming, and at what threshold?
7. **A lingering red CI.** Fix forward only, as today, or revert the red commit automatically after N minutes?
8. **Worker guard.** A worker has full Bash: should a PreToolUse guard refuse dangerous commands, beside the
   `allowPaths` diff, the foreign-commit check and the secret and loosening scans at settle, and the secret scan at push?
9. **Placing a feature across running workflows.** Should the Supervisor place it by a path-ownership map kept as data,
   amending only the workflows that own the touched paths, with the model deciding only what the map cannot place?
