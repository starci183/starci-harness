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
- **A shared need has one owner.** A worker that finds a shared thing missing (a capability under `platform/`, an app-root
  file, a root config, a `@starci` package) never builds it: it reports `--needs <key>`, and every report of a key, from any
  workflow, waits on one need. Exactly one owner resolves it, the workflow's Kernel when one workflow needs it, else the one
  workflow or `[Worker]` the Supervisor assigns (a `@starci` package always a worker's package edit, never the owner's); every
  other workflow waits on that owner as a recorded dependency and is released, from its kept work, once the resolving commits
  are relayed onto its own branch (a relay that conflicts becomes a relay node of that workflow, owned by its Kernel, that the
  waiters depend on; only one its Kernel removed goes to the Supervisor as a `conflict`). It
  runs always, with no switch to turn it off (`cli/src/harness/needs.ts`, `cli/src/core/needs/tend.ts`).
- **Telegram carries only what needs the owner's decision.** The owner's channel is the Supervisor's terminal, the desktop
  app and Telegram. Telegram sends a question ticket awaiting his answer (scope, money, credentials, legal, a product choice with
  no default) once as its card with buttons, reminds him of it at most once a day while it stays open, and acknowledges his
  answer with one short line; nothing else is pushed: a workflow done, blocked or stopped, an owner request taken up, a defect
  ticket opened or fixed and relaunches stay on `/status`, `/tickets`, the harness UI and the monitor's report. The owner's
  reply to a question answers its ticket, and any other answer there becomes an owner request that wakes the Supervisor
  (`notices` and `reminderHours` of [ops/telegram.yaml](../../ops/telegram.yaml), [cli/README.md](../../cli/README.md) "The
  owner's Telegram channel", `cli/src/harness/telegram-bridge.ts`). Owner, 2026-10-29: "báo ticket nào cần thầy sửa thôi nhé ko
  spam ntn ... cần quyết định của thầy".
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
- **An urgent release needs no CI; its safety floor is never skipped (`urgent-release`).** `starci app release push --urgent
  --reason "<text>"` ships an app after its fast local checks alone (app check, typecheck, lint of the files changed since the
  previous release tag, unit; a green row already recorded for the commit is reused), tags and pushes, and writes an URGENT
  record naming the role, the reason, each check's verdict and the commit (`packages/hfs/release/urgent.mjs`). That record
  satisfies `requireCi` for `deploy.prod` and `release.cut` when the caller passes `--urgent` (`cli/src/core/check/ci.ts`); the
  deploy's safety floor still runs and refuses with its own code when a step fails: a fresh encrypted database backup whose
  receipt is verified and which a test decrypt opens, migrate preview then execute, the readiness verify and the automatic
  rollback (`packages/hfs/stack/urgent-floor.mjs`). `starci app release gate --backfill <tag>` later runs the full gate on the
  same commit: green promotes the record to a normal L4 with no re-release, red opens a `verify` ticket and changes nothing on
  prod (`packages/hfs/release/gate.mjs`). Owner, 2026-10-29: "deploy gấp không cần ci cd gì hết!!!! cái này là tính năng nha".
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
- **What the Supervisor cannot resolve becomes one ticket (`tickets`).** Questions climb one level at a time, each level
  answering when it can and nobody guessing silently: an Op files `blocked` with its question and proposed default, its Kernel
  answers from the goal, the specs and the canon or escalates, and the Supervisor answers or opens one ticket. A question
  ticket (business, code, spec; an `owner` escalation with no default it may take) goes to the owner on Telegram, whose reply
  or `ticket answer` answers it, a proposed default accepted as it stands; a defect ticket (a `harness` escalation, a defect the
  Supervisor or the monitor sees) goes to Debug's queue, blocking first then by occurrences, with no Telegram notice, and Debug
  closes it with the fixing commit. A repeat of the same defect (kind, error code, module) or question bumps one ticket; its
  answer or close is recorded with who gave it and why, releases every task and escalation waiting on it, wakes the Supervisor,
  and reaches every later brief of the workflow ([ops/coordinators/supervisor.md](../../ops/coordinators/supervisor.md),
  `cli/src/harness/tickets.ts`). Owner, 2026-10-29: "Chốt, làm đi"; "op mà stuck báo lên kernel, kernel không giải quyết dc
  gửi lên supervisor".
- **Harness problems never wait on the owner.** An escalation of kind `harness` is Debug's: the Supervisor's driver files it as
  a defect ticket, the Supervisor never asks the owner about it, keeps its other work moving and relays Debug's close; only an
  `owner` escalation goes to the owner, as a question ticket. Neither makes a waiting Supervisor stalled (`awaitsOwner` in
  `cli/src/harness/coordinator-commands.ts`, [ops/coordinators/supervisor.md](../../ops/coordinators/supervisor.md)).
- **Coordinators run on their own (`coordinators-self-sufficient`).** The monitor files harness bugs as tickets and Debug fixes the
  harness; nobody nudges a Supervisor or a Kernel by hand. An `owner` escalation names its topic; a product choice inside the
  accepted goal that carries a proposed default (the goal's or the plan's, with its reason) is decided by the Supervisor's
  driver on that default and recorded with its reasoning, and only scope changes, money or real charges, credentials or
  custody, legal matters and a product choice with no default reach the owner (`OWNER_TOPICS` and `defaultRuling` in
  `cli/src/harness/coordinator-commands.ts`, `ruleDefaults` in `cli/src/core/supervisor/driver.ts`). The tick wakes a Kernel
  whose ready work idles with no live Op and gives it up to the stall ladder past a second threshold (`readyIdle` in
  `cli/src/core/supervisor/driver.ts`), and wakes a Kernel that leaves a decision or a dead task undecided, which answers it in
  that turn; past a second threshold the Supervisor rules it in the Kernel's place with the Kernel's own commands, recorded
  `ruled-by-supervisor` and told to the Kernel on its next turn, and it becomes a ticket only by the escalation the Supervisor
  rules with, an owner topic to the owner and a real harness defect to Debug, never as a harness defect by itself (`decisionIdle`
  and `handUndecided`; both thresholds in `stall` of [ops/liveness.yaml](../../ops/liveness.yaml); `assertRuling` in
  `cli/src/harness/coordinator-commands.ts`). A hold names its release condition (a ticket, a commit on harness main, a need
  or a time) and the harness releases it when that is met; a hold with none is refused (`cli/src/harness/holds.ts`). Owner,
  2026-10-29: Debug cannot rule a workflow's product decision, and the coordinators are self-sufficient. A
  task the harness ended with no red of its own returns to ready at the same try, its last included (`harnessCause` in
  `cli/src/harness/revive.ts`). Landing is atomic: a green task is on its workflow's branch or returned with its work
  preserved, never done with its work beside the branch (`lands` in `cli/src/harness/clean-verify.ts`, `preserveEscaped` in
  `cli/src/core/task/verify.ts`). A check whose premise is stale is the Kernel's to amend, never the worker's
  (`check-premise`, `cli/src/harness/check-premise.ts`). Every escalation awaiting the owner or Debug, with or without a
  topic, and every task left awaiting the owner becomes a ticket on the next tick or Supervisor next, a question among them sent
  to the owner's Telegram
  (`ticketEscalations` in `cli/src/harness/tickets.ts`).
  A contract that takes another workflow's branch or landed commit as its source is refused `NEEDS_REQUIRED`: shared needs
  are mandatory across workflows (`cli/src/harness/foreign-source.ts`). Owner, 2026-10-29: the Supervisor and Kernels must
  run on their own.
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
