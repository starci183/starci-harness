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
- **The Supervisor delegates; Debug lands.** The Supervisor never works hands-on: every code or package fix and every
  investigation that touches files goes to a `[Worker] <project>: <topic>` seat it dispatches under itself, in its own worktree,
  routed by the worker tiers; the Supervisor reads the worker's result and accepts or rejects it. Merging, pushing and
  publishing harness packages are Debug's alone (`cli/src/core/supervisor/workers.ts`, the `release` verbs' roles). A project
  runs at most `projectMaxWorkers` worker seats at once, its Kernels' Ops and its Supervisor's workers together; a launch past
  it waits queued and starts once a seat is released ([ops/routing.yaml](../../ops/routing.yaml),
  `cli/src/harness/project-workers.ts`).
- **Questions reach the owner on Telegram.** The owner's channel is the Supervisor's terminal, the desktop app and Telegram:
  every `owner` escalation, owner request taken up and workflow ended is sent once to the owner's chat, and the
  owner's answer there becomes an owner request that wakes the Supervisor ([cli/README.md](../../cli/README.md) "The owner's
  Telegram channel", `cli/src/harness/telegram-bridge.ts`).
- **Host credentials live in the harness's secret.env.** The owner keeps every host credential in `secret.env` at the harness
  root, untracked; the committed [secret.env.example](../../secret.env.example) names its keys and where to get each. Agents
  and tools never open it; the CLI's secret loader reads a key policy/security.yaml `secretKeys` lists, the environment
  winning over the file ([cli/README.md](../../cli/README.md) "Host secrets", `cli/src/harness/secret-env.ts`).
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
- **Speed flow (`speed-flow`).** Checks run in three tiers: a branch runs at most a fast typecheck or lint of the files it
  touched, a merged batch runs one scoped round, CI runs the full suite; no tests, build or bench on a branch
  ([contexts/authority/](../authority/README.md)). Owner, 2026-10-28: "lên master plan để tối ưu hóa thời gian làm việc
  tránh thủ tục rườm rà ... vừa chậm vừa block cpu/ram như lint, tests, typescript"; "contexts/<quyền> ghi rõ code nhánh
  không tests".
- **No grammar tests (`no-grammar-tests`).** A Grammar edit is content only (component, CSS, props, a story for a new
  state), proved by `typecheck` and `build`, with no specs and no local plays or DNA run, bumping and re-pinning only `@starci/grammar`
  ([contexts/authority/packages.md](../authority/packages.md), `packages/grammar/package.json` `test`). Owner, 2026-10-12,
  restated 2026-10-28: "ghi rõ grammar sửa chỉ sửa nội dung".
- **Scope before check (`scope-before-check`).** A wave writes its scope decision (diff, changed files, reach, exact
  commands, what is skipped and why) before any command, reuses green rows for unchanged inputs and reruns only red rows
  and their dependents ([contexts/authority/wave.md](../authority/wave.md)). Owner, 2026-10-28: "tránh thủ tục rườm rà".
- **Push main after a scoped check (`push-main-after-scoped-check`).** A green wave goes to main at once with
  `release push`, and CI is the critic; a red CI opens the next fix and blocks nobody
  ([contexts/authority/ci.md](../authority/ci.md), [CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-18, CONTRIB-19). Owner,
  2026-10-28: "tối ưu hóa thời gian làm việc tránh thủ tục rườm rà".
- **One authority for both runners (`authority-both-modes`).** The tiers and the role table of
  [contexts/authority/](../authority/README.md) hold identically under `inline` and `orca`, for Debug's lanes, the
  Supervisor's workers and an app session. Owner, 2026-10-28: "bộ author phải áp dụng dc cho cả inline mode lẫn orca mode".
- **One worktree per Op (`op-worktrees`).** Every task attempt of a workflow, under `orca` and `inline` alike, works in a git
  worktree of its own cut from the workflow's branch; no path is held while it works, and its verified commit is rebased
  onto the workflow's head and landed under a short land lock per branch; a textual conflict returns it `conflict` with its
  work preserved for an amend, never resolved inside the harness (`cli/src/harness/land.ts`, `cli/src/core/task/verify.ts`).
  In Orca each Op's worktree is listed under its Kernel's and the Kernel's under the main checkout. Owner, 2026-10-28:
  "phải từng op chạy trên worktree riêng"; "ok chốt vậy sửa lun".
- **The harness removes what it made (`worktree-cleanup`).** Every worktree the harness creates, in both runners, is removed by
  the harness when its work ends, its uncommitted work preserved first ([contexts/authority/README.md](../authority/README.md)
  "Worktrees", `cli/src/harness/worktree-gc.ts`). Owner, 2026-10-28: "xong việc inline và orca gì cũng phải dọn dẹp
  worktrees"; "op.kernel tạo worktree xong việc phải xóa worktree".
- **The router alone picks.** Every Op and Kernel is routed by [ops/routing.yaml](../../ops/routing.yaml) from real
  signals: each platform's usage and reset read from Orca, every attempt's outcome per member, qualification earned
  from verdicts, and a provider in trouble probed back on its own. No workflow, task or owner names an agent or steers
  the pick, and no circuit waits for a person ([ops/README.md](../../ops/README.md) "The router").
- **Coordinators run on Claude.** Supervisors and Kernels take the `coordinator` tier of
  [ops/routing.yaml](../../ops/routing.yaml) in its listed order, Claude first; a seat the stall ladder gives up on for its
  own idleness is relaunched on Claude again, its repeated stalls escalating kind harness (`coordinatorStallEscalates` in
  `cli/src/harness/stall.ts`); Claude's pool holds `coordinatorReserve` of its slots for coordinators, so workers never
  take the slots a coordinator needs (`capacityReason` in `cli/src/harness/router.ts`); only the circuit or quota taking
  Claude out hands the seat to the next member (`decide` in `cli/src/harness/router.ts`).
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
  ([README.md](../../README.md) "CI"); its tokens live only in GitHub secrets.
- **Coded is usable; publishing is CI's (`publish-by-ci`, `publish-as-soon-as-done`).** Apps consume the harness packages from the harness checkout (`deps source
  --local`, `cli/src/core/deps/`), so finished code serves both apps before any release. Publishing to npm is separate and
  automatic: every push to main publishes, once its own CI jobs are green, each package and CLI version not on npm yet, and refuses a
  package changed under a version already there (`RELEASE_VERSION_NOT_BUMPED`, `cli/src/core/release/publish.ts`;
  [CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20). A workstation `release publish --publish` is Debug's fallback. Only the
  edited package is bumped and re-pinned ([contexts/authority/packages.md](../authority/packages.md)).
- **Open source under MIT.** The harness and every package it publishes are MIT, copyright starci183
  ([LICENSE](../../LICENSE)); the CLI ships on npm as `starci-harness`, published by CI.
