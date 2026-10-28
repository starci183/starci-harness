# Decisions

The owner's harness decisions, as present-tense rulings, each naming the file that implements it. A ruling on how app code is written
goes to [contexts/decisions/rulings.yaml](../decisions/rulings.yaml) instead.

- **One CLI.** The harness is one TypeScript CLI on `commander`, with no framework; `starci explain`, generated from
  the verb definitions, is the one list of commands ([cli/README.md](../../cli/README.md)). It publishes to npm as
  `starci-harness` (bins `starci` and `starci-harness`, [cli/package.json](../../cli/package.json)), so
  `npx starci-harness` runs it where no checkout exists. It carries the app commands too: `starci app` runs
  `@starci/hfs` in-process, a product pins `starci-harness` as its devDependency at the version of the CLI that
  judges and scaffolds it (the CLI hands @starci/hfs its own version; no bundled pin names the CLI, which depends on
  @starci/hfs exactly), and `@starci/cli` is retired.
- **One brief per task.** Every brief is the worker procedure common to all ops followed by the label's op file
  ([ops/ops/README.md](../../ops/ops/README.md)); there is no catalog of op kinds beyond the labels. The Kernel writes each
  contract; a label also routes (its floor and host tools) and its checks are presets of [ops/checks.yaml](../../ops/checks.yaml).
- **Op pattern: `base` and `extend`.** Each label has one op file, `ops/ops/<label>.md`, owning the base of a task's
  context, input, output and checks; the Kernel's contract only extends it, and the output carries the trace of what
  the op read. [ops/ops/README.md](../../ops/ops/README.md) owns the mechanics and names the code that enforces them.
- **One Supervisor per project.** Each project ([state.md](state.md) "How a project is found": the Work-root repository
  and its sides) has its own `[Supervisor] <project>` in its main checkout, which starts, owns and sweeps only that
  project's workflows; one host driver (`supervisor tick`) keeps every project's Supervisor alive
  (`cli/src/harness/supervisor.ts`, `cli/src/core/supervisor/driver.ts`).
- **Questions reach the owner on Telegram.** The owner's channel is the Supervisor's terminal, the desktop app and Telegram:
  every `owner` escalation, owner request taken up and workflow ended is sent once to the owner's chat, and the
  owner's answer there becomes an owner request that wakes the Supervisor. The bot token stays in the owner's user
  environment, read by name, never from a file ([cli/README.md](../../cli/README.md) "The owner's Telegram channel",
  `cli/src/harness/telegram-bridge.ts`).
- **Project pattern.** `contexts/project/` is the map of a StarCi project: the app root owning `.starciwork`, its
  sides, the `hfs.json` choices, the Work life cycle, the anatomy generated from slots, where lint applies, the
  `.starcistacks` shape and the lite and full differences. It links each fact to its owner and restates none.
- **A standard flow, planned dynamically.** Every Work record walks the lane of its family
  ([ops/lanes.yaml](../../ops/lanes.yaml)): a model fills the content of one step and never decides which step comes
  next, which label repairs what or how many rounds ([ops/routes.yaml](../../ops/routes.yaml)). The Kernel plans only the
  steps evidence does not satisfy yet (a screen the owner already drew is not drawn again); `workflow define`, `amend` and
  every replan refuse `FLOW_INCOMPLETE` otherwise (`assertFlow` in `cli/src/harness/lanes.ts`), and `kernel submit`
  refuses `ROUTE_ILLEGAL` for an answer off a decision's route (`assertRoute` in `cli/src/harness/routes.ts`); past a
  route's limit the owner decides, through the Supervisor.
- **Machine checks only.** A contract's checks, its op file's `checks.base` plus its own `checks.extend`, are only
  checks a machine runs (`command`, `starci`, `files`, `json`, `probe`, `cited`, `uat-flow`), and an op whose
  `checks.behavioural` is true makes a contract without a behavioural check unfit (`contractProblems` in
  `cli/src/harness/contract.ts`). Anything no machine can judge (taste, UX) is an owner review step, never part of a contract.
- **Tests stay inside the task; CI judges the rest.** A contract's checks cover only what the task changed, or, for a task
  that changes nothing, its allowPaths as they stand: the scoped `check run` (`runScopedCheck` in
  `cli/src/harness/run-checks.ts`), the tests related to the changed files (never a whole suite) and `paths-only`. A `verify` worker runs a
  heavy suite only when the goal itself is that suite. CI runs the full suite on main after the push; a red CI becomes
  a `code` contract scoped to the red checks and never blocks the next push.
- **The router alone picks.** Every Op and Kernel is routed by [ops/routing.yaml](../../ops/routing.yaml) from real
  signals: each platform's usage and reset read from Orca, every attempt's outcome per member, qualification earned
  from verdicts, and a provider in trouble probed back on its own. No workflow, task or owner names an agent or steers
  the pick, and no circuit waits for a person ([ops/README.md](../../ops/README.md) "The router").
- **Coordinators run on Claude.** Supervisors and Kernels take the `coordinator` tier of
  [ops/routing.yaml](../../ops/routing.yaml) in its listed order, Claude first; a seat the stall ladder gives up on for its
  own idleness is relaunched on Claude again, and only a provider failure, or the same member's repeated stalls (which also
  escalate), hands the seat to the next member (`coordinatorRelaunch` in `cli/src/harness/stall.ts`).
- **Harness problems never wait on the owner.** An escalation of kind `harness` is Debug's: the Supervisor keeps it in the
  ledger, never asks the owner about it, keeps its other work moving and relays Debug's answer, which arrives as a
  `supervisor ask` by `debug`; only an `owner` escalation (a product decision, credentials, scope, money) goes to the owner.
  Neither makes a waiting Supervisor stalled (`awaitsOwner` in `cli/src/harness/coordinator-commands.ts`,
  [ops/coordinators/supervisor.md](../../ops/coordinators/supervisor.md)).
- **A failed launch says why.** A launch Orca fails at agent readiness has the agent terminal it created read once,
  before the worker is released, and the seat keeps its last lines; an agent waiting at a host or config prompt is the
  host's to fix, never a provider strike, and goes to the Supervisor as a `harness` escalation (`blockedPrompts` of
  [ops/routing.yaml](../../ops/routing.yaml), `cli/src/harness/launch-failure.ts`).
- **A terminal lives as long as its seat.** Nothing finished stays open in Orca: an Op's or Kernel's tab is closed once Orca
  fences its worker, retained dispatches included (`closeWorker` in `cli/src/harness/orca/client.ts`); a Kernel start retires
  every previous Kernel seat of its workflow first, so one workflow never holds two (`startKernel` in
  `cli/src/harness/kernel.ts`); `supervisor stop` and a Supervisor relaunch close the old Supervisor's tab
  (`cli/src/harness/supervisor.ts`); and every `supervisor tick` closes the harness terminals no open seat or live Supervisor
  holds and the orphaned ones, never a terminal the harness did not make (`cli/src/harness/terminal-sweep.ts`).
- **One door to the settings.** Each harness setting stays in the ops/ yaml that owns it, with no config file of its own;
  `starci config list|get|set` reads and changes them, and `set` writes only a value the file's own loaders accept
  (`cli/src/harness/settings.ts`).
- **Policy selects; code and canon enforce.** [policy/](../../policy/README.md) picks the gates and configures them; every
  rule lives once, in the CLI or a canon package.
- **One CI workflow.** [.github/workflows/ci.yml](../../.github/workflows/ci.yml) gates every push and pull request to main
  and publishes on a `v*` tag ([README.md](../../README.md) "CI"); its tokens live only in GitHub secrets.
- **Open source under MIT.** The harness and every package it publishes are MIT, copyright starci183
  ([LICENSE](../../LICENSE)); the CLI ships on npm as `starci-harness`, published by CI on a `v*` tag.
