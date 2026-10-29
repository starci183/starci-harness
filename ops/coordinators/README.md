# Coordinator briefs

The CLI renders [supervisor.md](supervisor.md) for each project's `[Supervisor] <project>` and [kernel.md](kernel.md) for
each orca workflow's `[Kernel]`, filling `{placeholders}` at launch. The rendered copy lives in the project's state folder
under `.runtime/` and the launch prompt only names it (the Windows argv cap). The seats and their verbs are owned by
[cli/README.md](../../cli/README.md) "Seats as a tree", "Coordinators and their drivers" and "Supervisor dispatch", the command
file by its "Coordinator commands"; the role boundary by
[roles.md](../../contexts/harness/roles.md); coordinator tiers by [routing.yaml](../routing.yaml).
