# Open questions

1. **`pattern` verbs:** their own group, or inside `app`?
2. **Placing a feature across running workflows.** Should the Supervisor place it by a path-ownership map kept as data,
   amending only the workflows that own the touched paths, with the model deciding only what the map cannot place?
3. **Who pushes in a lite app.** Under Orca, Debug alone merges and pushes ([decisions.md](decisions.md)), and no worker,
   Kernel or Supervisor does. How does a lite chat agent (role `agent`), which has no Debug beside it, push?
4. **Secret scan reach.** The scan carries the provider shapes, forbidden paths and the quoted keyword assignment, not
   the unquoted dotenv form, SQL role passwords or badge-token exemptions. Add them, or accept the gap?
5. **Replan owner gate.** When a replan drops or redoes more than a threshold, should the Kernel hold it for the
   owner's yes before resuming, and at what threshold?
6. **A lingering red CI.** Fix forward only, as today, or revert the red commit automatically after N minutes?
7. **Worker guard.** A worker has full Bash: should a PreToolUse guard refuse dangerous commands, beside the
   `allowPaths` diff, the foreign-commit check and the secret and loosening scans at settle, and the secret scan at push?
