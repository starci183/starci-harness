# Two axes

- **Edition** (`lite` or `full`) is what an app is. It is fixed at scaffold in the app's `hfs.json` and selects the
  app verbs the CLI shows there. Lite is stateless on Postgres and puts the canonical patterns first; full adds the
  reactor, saga and projection patterns and its own infrastructure.
- **Runner** (`orca` or `inline`) is how a task runs, chosen per workflow or task, never by edition. `orca` launches a
  worker seat through Orca, so tasks run in parallel. `inline` means the Claude or Codex session that is open does the
  task itself, one at a time.

Both editions get both runners, with the same contracts, leases, clean verify and harness commit. Inline, the agent is
both Kernel and worker, so its contract is sent (and its hash fixed) before it edits code, and the harness verify on a
clean checkout decides green; liveness applies only to the `orca` runner. `starci doctor` reports the tree the working
directory belongs to (`runtime`, `lite`, `full` or `none`).
