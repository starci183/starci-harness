# Changelog

All notable changes to the `starci-harness` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each package under `packages/` keeps its own CHANGELOG.

## [Unreleased]

### Added

- **Lanes and repair routes.** `ops/lanes.yaml` is the standard build flow each Work record walks; `workflow define`,
  `amend` and every replan refuse `FLOW_INCOMPLETE` while a covered record's step is neither satisfied by evidence nor
  carried by a task of its label in order, and `kernel next` digests each record's lane. `ops/routes.yaml` bounds repairs:
  a red or question decision carries its legal route, `kernel submit` refuses `ROUTE_ILLEGAL` off it, and past its limit
  the Kernel escalates to the owner. The `ui` label becomes `draw`; `audit` and `review` are new, and the router never
  gives a `review` to the provider that authored the work it reads (`independentOf`). A workflow file may name
  `requires: [security, perf]`.

- **Host driver and stall ladder.** `supervisor tick` (one idempotent pass for a scheduled task) and `supervisor watch`
  (its loop) keep the seat tree alive with no LLM awake: ensure the Supervisor, sweep its Kernels and their Ops, and for an
  agent idle at its prompt with work pending (Orca's tui-idle, output and heartbeat signals) nudge it with its loop prompt,
  then relaunch (or fence) it on another member with a `stalled` outcome and a provider circuit strike of the kind Orca's
  failure words name (`capacity`, ..., else the new `stall`), then escalate through the relaunch limit.

### Fixed

- A completed launch request whose agent never started its turn is judged by its dispatch (adopted, or fenced and requeued
  with no try spent), never replayed forever.

## [1.0.0-alpha.1] - 2026-10-27

The first published version.

### Added

- **npm package.** The CLI publishes as `starci-harness` with the bins `starci` and `starci-harness`, so
  `npx starci-harness explain` runs it without a checkout; the package carries `ops/`, `policy/`, `contexts/`, the
  starci skill and the built search index. CI publishes it with npm provenance on a `v*` tag, under the dist-tag its
  prerelease names (`alpha`).
- **Seat tree in Orca.** One `[Supervisor]` per host, one `[Kernel] <workflow>` per running orca workflow and one
  `[Op] <task>` per attempt, each a real Orca agent; `supervisor` and `kernel` verbs with episodic `next` and `submit`
  drivers, coordinator commands admitted idempotently by `cmdId`, and one git worktree per workflow.
- **Contracts with base and extend.** One op file per label (`ops/ops/<label>.md`) owns the base of a task's context,
  input, output and checks; the Kernel's contract only extends it, and `contract check` judges fitness before
  `task send` leases its `allowPaths`.
- **Clean verify.** `task verify` stops the worker, builds a candidate from a clean checkout of HEAD plus the task's
  paths, replays every check there and commits only on green; red preserves and resets. Settles of one project run one
  at a time, task status moves by compare-and-swap, and `--recover` reconciles a crashed settle from git.
- **Replan.** Goal versions, `workflow amend` from a desired graph or a change file, per-key classification (keep,
  continue, stale, rework, redo-live, redo, add, drop) with generated reverts, early cutoff on a dependency's settled
  result, and `plan diff` to preview it.
- **Prior work.** Every attempt's patch is stored content-addressed and offered to the next attempt in its brief.
- **Trust tiers and receipted UAT.** Checks carry a trust tier by kind (harness-observed, receipted run, worker
  claim) and only the first two count as behavioural; `uat run` writes a harness receipt that `uat-flow` checks
  require.
- **Stress bench.** `bench run` and `bench list` run the stress scenarios of `bench/` in scratch repositories against an
  Orca stand-in and record a scoreboard.
- **Contexts search.** `contexts search` ranks contexts, op files, policy and harness documents by BM25 fused with a
  local embedding model when it is built, and falls back to BM25 alone; `--check` fails on a stale index and `--eval`
  measures recall.
- Gates: `check run`, `check loosening`, `check secrets`, `check lint`, `check typecheck`, `contexts anatomy --check`,
  and the release verbs `release push`, `release cut`, `release publish` and `release ci-status`.

[Unreleased]: https://github.com/starci183/starci-harness/compare/v1.0.0-alpha.1...HEAD
[1.0.0-alpha.1]: https://github.com/starci183/starci-harness/releases/tag/v1.0.0-alpha.1
