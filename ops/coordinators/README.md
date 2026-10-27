# Coordinator briefs

The CLI renders [supervisor.md](supervisor.md) for each project's `[Supervisor] <project>` and [kernel.md](kernel.md) for
each orca workflow's `[Kernel]`, filling `{placeholders}` at launch. The rendered copy lives in the project's state folder
under `.runtime/` and the launch prompt only names it (the Windows argv cap). The seats, their verbs and the command file are owned by
[cli/README.md](../../cli/README.md) "Seats as a tree"; the role boundary by
[roles.md](../../contexts/harness/roles.md); coordinator tiers by [routing.yaml](../routing.yaml).
