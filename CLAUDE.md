# StarCi harness bootstrap

Read [AGENTS.md](AGENTS.md) first: it holds the bootstrap and the environment gotchas. Then read
[contexts/README.md](contexts/README.md) and follow its load order.

AGENTS.md is linked, not imported: workflow worktrees live under `.runtime/`, so every agent started in one inherits this file,
and an `@` import of a file outside its working directory stops Claude Code at a confirmation dialog before the agent is ready.
