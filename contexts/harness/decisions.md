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
  waiters depend on and the first waiter composes, judged as the transport of the source's settled work; only one its Kernel
  removed goes to the Supervisor as a `conflict`). It
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
  touched, a merged batch runs one scoped round, CI runs the full suite; no tests or build on a branch
  ([contexts/authority/](../authority/README.md)). Owner, 2026-10-28: "lên master plan để tối ưu hóa thời gian làm việc
  tránh thủ tục rườm rà ... vừa chậm vừa block cpu/ram như lint, tests, typescript"; "contexts/<quyền> ghi rõ code nhánh
  không tests".
- **No grammar tests (`no-grammar-tests`).** A Grammar edit is content only (component, CSS, props, a story for a new
  state), proved by `typecheck`, the literal lint (ruling `grammar-literal-lint`) and `build`, with no specs and no local plays or DNA run, bumping and re-pinning only `@starci/grammar`
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
  --reason "<text>"` ships an app after its fast local checks alone (typecheck and the build since `urgent-typecheck-build` below;
  a green row already recorded for the commit is reused), tags and pushes, and writes an URGENT
  record naming the role, the reason, each check's verdict and the commit (`packages/hfs/release/urgent.mjs`). That record
  satisfies `requireCi` for `deploy.prod` and `release.cut` when the caller passes `--urgent` (`cli/src/core/check/ci.ts`); the
  deploy's safety floor still runs and refuses with its own code when a step fails: a fresh encrypted database backup whose
  receipt is verified and which a test decrypt opens, migrate preview then execute, the readiness verify and the automatic
  rollback (`packages/hfs/stack/urgent-floor.mjs`). `starci app release gate --backfill <tag>` later runs the full gate on the
  same commit: green promotes the record to a normal L4 with no re-release, red opens a `verify` ticket and changes nothing on
  prod (`packages/hfs/release/gate.mjs`). Owner, 2026-10-29: "deploy gấp không cần ci cd gì hết!!!! cái này là tính năng nha".
  Its first start (`urgent-first-start`, owner 2026-10-29: "Thêm first-start"): a self-hosted database the release itself starts
  has nothing to back up and is reachable only inside the stack, so `stack deploy --urgent --first-start --db-service <service>`
  replaces the backup and test decrypt by a proof that the database is empty (no migration history, no table in public) and runs
  migrate preview then execute (db/bootstrap.sql first) inside the database's own container. The app services never start
  against the empty schema (their healthchecks fail and update_config rolls them back): the stack is first deployed with every
  service but the database at 0 replicas (a global-mode service is held off every node by an unsatisfiable placement constraint),
  then the database is waited for, proved empty and migrated, then the real stack is deployed and converged; the record, the rollback target, the readiness verify and the automatic rollback hold, and a database that is not
  empty is refused (`STACK_FIRST_START_NOT_EMPTY`) for the plain floor.
  Its checks are what can break production (`urgent-typecheck-build`, owner 2026-10-30, chosen over keeping the checks and over
  dropping them all; asked for in nivo-lite's words "build local bypass ci, thao tác thẳng với vps"): typecheck and the build
  (the release gates `typecheck`, `build`, `build-be`, `build-fe` the app declares); app check, lint and the tests wait for the
  back-fill, so `--lint-baseline` (`urgent-lint-baseline`, 2026-10-29) is retired and refused. And it is one command:
  `starci app stack deploy --env <env> --urgent --reason "<text>" --execute` with no `--image` and no `--sha` releases HEAD
  (unless it already has a pushed urgent record), builds and pushes its images on the operator's machine before the deploy's
  transport reaches the server, and deploys their digests under the unchanged floor (`packages/hfs/stack/urgent-release.mjs`). A
  tag pushed by hand carries no record: the one command adopts a tag already on HEAD and writes the record only after the checks
  pass; a record is never written by hand.
- **One canonical CLI (`cli-canonical-2026-10-30`).** Both layers move to one flag dictionary and one command tree,
  [contexts/harness/cli-canonical.md](cli-canonical.md): `--execute` is the one "do it for real" flag and every effect, a
  generator's write included (`app sync`, `contexts anatomy`, `app codemod`, `app upgrade`), is dry by default with drift
  exiting 1; `--json`, `--timeout <s>`, `--sha`, `--env`, `--db-url-env`, `--cwd`, `--out`, `--reason` and `--status` are the
  one spelling of their meaning; `app secret` takes `--env`; `feedback` folds into `ticket --kind feedback`; `ci secret set`,
  `ci var set` and `secret recipients --add/--remove` are dry until `--execute`; the test world is `app world up|down|status`;
  one parser refuses a flag an action does not take and help is generated from the parser tables. An old spelling is
  removed outright and fails as any unknown verb or flag does: no alias, no notice, no refusal table (CONTRIB-15), and
  every call site moves in the same change. Owner, 2026-10-30: "Duyệt cả 6" (the six decisions of the audit), then
  "Làm theo lane"; the sixth decision (a refused minor for each old spelling) overruled the same day: "đọc contributing là
  cấm tuyệt đối legacy r mờ".
- **App check passes under 20 findings (`gate-threshold-20`).** `starci app check` exits green while
  fewer than 20 error findings remain and none is a hard blocker: a plaintext secret, a failed boot proof or a migration finding
  blocks at any count (`packages/hfs/runtime/scripts/hfs/gate-threshold.mjs`). Every finding is still printed and kept in the
  report; only the verdict changes, so a release is not held back finding by finding (5, 4, 3, ...) by the last structural
  nits, and they are fixed later. Typecheck, build and the tests are not judged by it. Owner, 2026-10-30: "xanh khi lỗi <20",
  "tránh kiểu check vô hạn", "dưới <20 còn tí sạn thôi"; scope (app check only) and the hard blockers (plaintext
  secret, boot wiring, migration) chosen by the owner directly.
- **One authority for both runners (`authority-both-modes`).** The tiers and the role table of
  [contexts/authority/](../authority/README.md) hold identically under `inline` and `orca`, for Debug's lanes, the
  Supervisor's workers and an app session. Owner, 2026-10-28: "bộ author phải áp dụng dc cho cả inline mode lẫn orca mode".
- **One worktree per Op (`op-worktrees`).** Every task attempt of a workflow, under `orca` and `inline` alike, works in a git
  worktree of its own cut from the workflow's branch; no path is held while it works, and its verified commit is rebased
  onto the workflow's head and landed under a short land lock per branch; a textual conflict returns it `conflict` with its
  work preserved until its Kernel settles it, never resolved inside the harness (`cli/src/harness/land.ts`, `cli/src/core/task/verify.ts`).
  In Orca each Op's worktree is listed under its Kernel's and the Kernel's under the main checkout. Owner, 2026-10-28:
  "phải từng op chạy trên worktree riêng"; "ok chốt vậy sửa lun".
- **The harness collects what it made under custody (`worktree-cleanup`).** Every worktree the harness creates, in both
  runners, is collected by the harness when its work ends, its uncommitted work preserved first ([contexts/authority/README.md](../authority/README.md)
  "Worktrees", `cli/src/harness/worktree-gc.ts`). A reviewed Git-less canonical direct-child remnant of its registered runtime
  state is quarantined whole with every regular byte retained, dependency links unlinked as links and a verified metadata
  receipt; no Git reference is inferred (`quarantineRemnant` in `cli/src/harness/worktree-preserve.ts`). Before removing a Git checkout it reaps it: it closes its Orca terminals, has Orca
  forget it, ends the processes it started there or that work inside it (by pid, never by name, never itself or Orca), sees
  them gone, and only then deletes the folder; a folder still held is recorded with its holder and retried
  (`cli/src/harness/reap.ts`, `cli/src/harness/land.ts` removeWorktreeFolder). Owner, 2026-10-28: "xong việc inline và orca gì
  cũng phải dọn dẹp worktrees"; "op.kernel tạo worktree xong việc phải xóa worktree". Owner, 2026-10-29: "sao trò không kill
  tiến trình, xóa, xóa worktrees,.... kiểu vậy mới đảm bảo chớ".
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
  `cli/src/core/task/verify.ts`, `clearStale` in `cli/src/harness/preserve.ts`). A check whose premise is stale is the Kernel's to amend, never the worker's
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
  [CONTRIBUTING.md](../../CONTRIBUTING.md) CONTRIB-20). A workstation `release publish --execute` is Debug's fallback. Only the
  edited package is bumped and re-pinned ([contexts/authority/packages.md](../authority/packages.md)).
- **Open source under MIT.** The harness and every package it publishes are MIT, copyright starci183
  ([LICENSE](../../LICENSE)); the CLI ships on npm as `starci-harness`, published by CI.
- **Findings already on a branch are the base's (`r-b910f07221cf`).** A scoped check an app-wide configuration change widens is
  judged against the same check at its base, and the files a relay node carries, and its command checks, against the same check
  at the source's head it relays (tickets tk-405c2bb94dbd, tk-a46c4d69c675: a relay node transports work its source already
  settled); a finding that base holds fails no
  task and spends no try, and is kept as `baseline-findings` evidence, a composition rule excepted for a relayed source, which
  the relay's composer answers for (`cli/src/core/check/base-findings.ts`, `cli/src/core/check/relay-baseline.ts`, `judgeAtRelayHead` in
  `cli/src/harness/run-checks.ts`). An opt-in pattern of `hfs.json` is declared by the harness,
  never by a task (`cli/src/harness/hfs-patterns.ts`).
- **Every seat loads a minimal core and searches the rest, so no rule is missed (`minimal-core-search`).** The owner's words: "nạp cho op và
  kernel và sup là tối thiểu + search i" (load the op, the Kernel and the Supervisor minimally, plus search). Each op of
  `ops/ops/` and each coordinator brief of `ops/coordinators/` loads the few pages that seat cannot act without plus an index
  of what exists: the [load order](../README.md#two-layers-of-context), and a generated section index (`*-sections.md`,
  `SECTIONED_DOCS` of `cli/src/core/contexts/sectioned-docs.ts`) in place of a document too large to load whole, whose ids it
  stands for in the read trace. Everything else is read on demand, through `starci contexts search` and `starci contexts
  anchor`, as the worker procedure ([ops/ops/README.md](../../ops/ops/README.md)) and each coordinator brief say. A contract
  is measured against its op's context budget once, when it is admitted (`isAdmitted` in `cli/src/harness/tasks.ts`).
  The owner, 2026-10-31, on rules agents missed: "trò nghĩ cách làm sao tránh miss và nếu miss thì sao" (find how to avoid a
  miss, and what happens when one occurs), and "hook k có ở codex … đừng đem tính năng claude vào" (Codex has no hooks; bring
  in no Claude feature). Every agent looks a rule up in several phrasings before it answers, plans or briefs, and a brief
  cites each constraint ([contexts/README.md](../README.md) "Looking a rule up", hard rule 7), held in the files every host
  reads (AGENTS.md, this tree), never in one runtime's hooks; a missed rule is recorded as a question of the search eval and
  hardened where it lives (contexts/README.md "When a rule was missed"; `--also` and the `miss` record in
  `cli/src/core/contexts/search.ts`).
- **An Op's attempt is settled before anything of it goes (`op-settle-merge-or-discard`).** The owner, 2026-10-29: "op code
  xong báo về kernel để quyết merge hay không, merge xong mới xóa không để lại partial_work để lần sau chạy lại/xóa" (an Op
  that finishes reports to its Kernel, which decides whether to merge; delete only after the merge, and leave no partial work
  for a later run to redo or delete), and on Debug's refinement: "Theo trò" (go with it). An Op reports, the harness verifies,
  and each ended attempt settles as MERGE (its green verify lands it), DISCARD (nothing kept: the default of its Kernel's
  answer to a red of the task's own), REPAIR (its Kernel's `settle: repair`: one patch kept for exactly one repair attempt,
  counted against tries as any retry) or KEEP (a stop the harness caused or a waiter parked on a shared need: one patch kept
  for the attempt that continues it). A key keeps at most one patch, applied by its next attempt and deleted when that attempt
  settles; the worktree, branch and preserve folders of an attempt are removed only after its settle; a cancel whose worktree
  is already gone is a DISCARD that spends no try; `worktree gc` drops every older or unkept patch (`settleDue`, `settleWork`,
  `applyPriorWork` and `pruneUnkeptPrior` in `cli/src/harness/prior.ts`, `removeOpWorktree` in `cli/src/harness/land.ts`,
  `recordSettles` in `cli/src/core/kernel/driver.ts`, `KERNEL_SETTLES` in `cli/src/harness/coordinator-commands.ts`,
  `cli/src/core/task/cancel.ts`, [ops/coordinators/kernel.md](../../ops/coordinators/kernel.md)).
- **A project parks whole and resumes whole (`project-park`).** The owner, 2026-10-29, with his Claude quota nearly out: every
  workflow of a project paused and resumable later, and Orca closed for that project, no Supervisor, Kernel or worker terminal
  left running. `project park` pauses every workflow, stops each live seat as a stop the harness caused (KEEP: one patch, the
  same try), closes each Kernel terminal (worktree and graph kept), stops the Supervisor and closes every Orca terminal of the
  project, never Orca itself; nothing of a parked project is relaunched until `project unpark` brings back the Supervisor, the
  Kernels on their worktrees and the dispatch of the parked tasks from their patches (`cli/src/core/project/park-engine.ts`,
  `cli/src/harness/park.ts`, `harnessCause` in `cli/src/harness/revive.ts`, `ensureSupervisor` in `cli/src/harness/supervisor.ts`,
  `isCoordinated` in `cli/src/core/supervisor/driver.ts`). A pause the owner or Debug sets is lifted only by their own resume or
  `project unpark`, never by a Supervisor or Kernel, and a paused workflow brings no stopped Supervisor back (`resume` in
  `cli/src/core/workflow/resume.ts`, `projectsWithWorkflows` in `cli/src/core/supervisor/driver.ts`).
- **The stress bench is removed (`bench-removed`).** The owner, 2026-10-29: "với cái bench là gì dẹp nó đi, vô nghĩa vcl —
  bench phải là kết quả tests thật trong orca", then "xóa bench đi" (whatever that bench is, scrap it, it is meaningless;
  the bench has to be the results of real tests in Orca; delete the bench). The stress bench (`bench/`: scenarios, fixtures,
  stand-ins and its README), its verbs `starci bench run` and `starci bench list` (`cli/src/core/bench/`), the CI step that
  ran it with the sops and age it installed, the `bench` kind of `feedback close` and the environment overrides that existed
  only to point the CLI at its stand-ins (`STARCI_SECRET_ENV`, `STARCI_TELEGRAM_API`, `STARCI_DOCKER_BIN`,
  `STARCI_CONTEXTS_DIR`, `STARCI_FEEDBACK_REPO`) are gone. Proof of the orchestration is to come from real test results in
  Orca; until then a CLI change is proved by running the built CLI (CONTRIBUTING.md CONTRIB-1). A record that cites a bench
  scenario as proof (the CHANGELOG, earlier rulings) is history; ruling `cli-proven-by-bench` is amended to say the bench is
  removed.
- **No state inside a package.** A copy of `@starci/hfs` that an install or `starci deps source --local` placed below a
  `node_modules` folder keeps its host state (a stack's bind-mounted data, logs and receipts, `machine.sqlite`, the blob store)
  in the per-user base `installedStateBase`, never in itself, so `npm ci` and a package copy never delete a running stack's data;
  the state such a copy kept inside itself moves out on its first `starci app` verb ([state.md](state.md) "Where state lives",
  `packages/hfs/runtime/engine/runtime-root.mts`). The base is per user (`starci-harness/state`, never the retired
  `%LOCALAPPDATA%/StarCi`), a stack's state below it is keyed by project and environment, and `STARCI_LOCAL_ROOT` overrides it.
- **Branch profiles: dev reports the polish gates, main keeps the full gate (`branch-profile-dev`).** The owner, 2026-11-04: an
  app's flow-F branch is `dev`, where product and UI work runs; an app gives it a branch profile in `.starcistacks/application-stacks.yaml`
  (`branches`), per gate `blocking`, `report` or `off`. Only lint, sonar and codecov may be lowered; hfs (required blocking on dev) and the
  safety gates types, wiring (the boot proof), db, secrets, format and test block on every branch; main can never be declared or lowered, and a
  pull request into main runs the full gate. Where lint reports, the lint ratchet blocks a commit that adds lint findings to a file it touches;
  older findings stay report-only. Promoting dev to main is a named step that runs the full gate. The exception is
  `branchProfiles` of [policy/loosening.yaml](../../policy/loosening.yaml), handed to @starci/hfs by `starci app`
  (`cli/src/core/app/hfs.ts`); the selection, the report verdict and the ratchet are `packages/hfs/runtime/scripts/hfs/branch-profile.mts`,
  `packages/hfs/src/main.mts` and `packages/hfs/lint/ratchet.mts`, and the rule is [project/lint.md](../project/lint.md) PROJECT-LINT-2.
  Amended 2026-11-05 and confirmed by the owner (product and UI work on dev goes without blocking lint or Sonar): a profile may
  cover dev's feature branches by a branch pattern (`ui/*`), declared in `branches` and allowed in `branchProfiles.branches`. A pattern was
  chosen over "a branch whose upstream or merge target is a profiled branch takes its profile" because the profile must be decidable from the
  branch name alone, the same way in a pre-commit hook, a pre-push hook and CI: an upstream is local, optional and editable state, a merge
  target is unknown before a pull request exists and CI's push filter can only match names; a pattern is declared, reviewed and refused by
  R378 when it matches the default branch, and it has a literal first segment that is never `release`, so it can never reach main or a
  release candidate (`packages/hfs/runtime/scripts/lib/stack-declaration.mts` `matchesBranch`, `profileFor`).
- **App check and CI run on the warm committed cache (`warm-cache-push`).** The owner, 2026-11-04: app check and CI run on the
  warm committed cache. One full warm run per base, only after a harness pin bump (a version change invalidates it); fix loops
  check only the diff (`--staged`, a gate- or side-scoped run); never `--no-cache` in a loop or in CI. Every push carries fresh
  `.starcistacks/cache` records from a real run, never hand-edited (`HFS_CHECK_CACHE_FORGED`), and a push without them is refused:
  the managed pre-push hook runs `starci app check --fresh` (`HFS_CHECK_CACHE_UNWARMED`, `HFS_CHECK_CACHE_UNPORTABLE`;
  `packages/hfs/cache/freshness.mts`, [check-cache.md](../project/check-cache.md) "The operating procedure").
- **Cache invalidation is rare and per family (`cache-fingerprint-per-family`).** The owner, 2026-11-04: a fingerprint per family,
  built only from the parts that family reads, so a bump of `@starci/auth` or `@starci/hfs` never cold-starts lint; the lockfile counts
  by the resolved versions of each family's toolchain, and the diagnosis line names which part invalidated which family
  (`packages/hfs/cache/fingerprint.mts`, [check-cache.md](../project/check-cache.md) "The fingerprint"). A library's type surface
  reaches ESLint through the import graph's package digests; the types and test families read every resolved install until their
  records name the packages they load.
- **The release gate trusts the warm cache, with a nightly verify (`release-gate-warm-cache`).** The owner, 2026-11-04: the release
  gate (`starci app release gate` and the CI run a release waits for) runs diff-only against the trusted cache at the release commit,
  since main's cache is already verified by CI. A scheduled nightly CI job (`cache-verify.yml`) runs `STARCI_APP_CHECK_CACHE=verify`
  (diff-only, then full, compared) on main; any difference is red with family and record, and it locks releases (the release gate
  refuses `HFS_CHECK_CACHE_VERIFY_LOCKED`) until a green verify run clears it. `HFS_CHECK_CACHE_FORGED` stays a hard blocker at any
  count. An owner-triggered full release gate stays available as an explicit opt-in (`app release gate --full`, the `full` input of
  `ci.yml`), never the default (`packages/hfs/release/cache-verify-lock.mts`, [check-cache.md](../project/check-cache.md) "The
  nightly verify").
- **Every job and saga flow runs itself again after a failure of any kind (`self-recovering-flows`).** The owner, 2026-11-04: every side
  effect and async step goes through the transactional outbox in the transaction of the state change and is consumed idempotently
  through the inbox; an inbound delivery is stored raw first and processed as a replay of the stored row. A transient failure retries
  with bounded, jittered backoff; a non-transient one (input, code, config) parks the flow as `failed_awaiting_fix`, never a silent
  final dead letter, with ONE owner alert carrying the run or job id, shown in the owner UI as a work item with "resume now". Parked
  flows resume automatically when the build changes and on a scheduled sweep, and on demand; done saga steps keep their outputs and
  pivots never repeat; compensations follow the same rules; no hand-written catch-and-wait. Names: `classifyFailure`,
  `failed_awaiting_fix`, `resume` ([code/be/resilience.md](../code/be/resilience.md) BE-RESILIENCE-2, `packages/hfs/templates/be/patterns/jobs`).
- **One home for `classifyFailure`: `@starci/nest-kit` (`failure-class-in-nest-kit`).** The owner ruled the 7b leftovers to the
  coordinator, 2026-11-04: the job runner (`platform/jobs`), the lite pgmq consumer (`platform/event-bus` of the inbox) and the full
  event runner classify a failure by one rule. It lives in the runtime package every back end already installs
  (`packages/nest-kit/src/failure.ts`), never in an app capability: a copy per capability is duplicate code, and one app export that
  every consumer imports is an unused export (R25 `HFS_UNUSED_EXPORT`) in any app that renders none of them, while a package export
  is no app export. The app's error family is the argument (`classifyFailure(cause, DomainError)`), so the package knows no app type.
- **A lite app draws its own "stopped work" page (`stopped-work-page-is-the-app`).** The same ruling: lite has no owner role, so the
  harness renders no owner page; the jobs platform gives the door's halves (`JobClaims.awaitingFix()`, `ParkedJobResumerService.resume({ jobId })`,
  `ParkedJobResumeRequestsService.request`) and [code/be/jobs.md](../code/be/jobs.md) BE-JOBS-8 the contract and an example, and each app
  guards and draws the page with its own owner check.
- **The self-recovery codemod diffs against the template the app was rendered from (`versioned-template-snapshots`).** The same ruling:
  `@starci/hfs` ships the previous release's managed templates as a versioned snapshot, so `starci app codemod self-recovery`
  applies the change between that snapshot and the current template to an app file and leaves a file the app edited by hand for a
  person (`packages/hfs/templates/snapshots/`, `packages/hfs/codemod/self-recovery.mts`).
- **The managed CI builds an app's root packages with its `build:modules` script (`ci-root-packages-built-first`).** The harness lead,
  2026-11-05, after a red Nivo main run whose tests and build passed: every CI job whose checks read the types of an app's root
  workspace packages or compile code importing them builds those packages first, with `npm run build:modules` (`BUILD_MODULES` of
  `packages/hfs/sync/ci-commands.mts`). That script is the source of truth because sync itself renders it exactly when the app has root
  packages (`rootPackageFolders`, the agent SDK, the module packages and the root workspaces outside the sides), with the same
  `turbo run build --filter=./packages/*` the managed typecheck, lint, test and build scripts already run first; reading the root
  `workspaces` again in the CI render would be a second derivation of the same set, and a hand-written turbo filter would drift from the
  script the app runs locally. An app with no root package renders no step and no prefix, byte for byte as before. R301 holds it
  (ci-standard.yaml `packages-built-first`), and [cicd.md](../project/cicd.md) "Root packages are built before they are read" says why.
- **An app extends the harness's law through rule packs and package slot manifests (`app-rule-packs`).** The owner, 2026-11-05 ("packages
  của nivo riêng nivo, muốn thêm gate như hfs phải extends"): an app's own laws are the app's, never the generic harness's, and still
  machine-held. hfs.json `rulePacks` names installed packages that export a `starci/rule-pack@1` manifest; `starci app check` runs their
  machine rules as hfs findings and the canon factories load their ESLint rules, so the law that a tool config defines no local rule (R16)
  holds. The manifest is a package export rather than a file the app writes, so a pack is versioned, reviewed and reused like the canon,
  and it is loaded by the app's own install. A pack only adds: anything that could lower a harness rule (an extra key, a harness code, a
  duplicate) refuses the whole pack (R381), the stricter choice, since a partly loaded pack would make an app's law depend on which rule was
  wrong. A root package may declare `packages/<name>/slots.yaml`, held like the side slots (R382), and its coverage follows the slots: 100
  per file but its barrels, type files and the slots that opt out with a reason. A package without a manifest keeps the default scope, so
  no app changes until it declares one (`packages/hfs/runtime/scripts/lib/rule-packs.mts`, `packages/hfs/runtime/scripts/hfs/package-slots.mts`,
  [project/lint.md](../project/lint.md) PROJECT-LINT-3).
- **A Grammar patch releases the Grammar family alone (`grammar-patch-range`).** The owner, 2026-11-05 (confirmed): every Grammar change
  used to re-release the whole @starci family, because the canon pins held the exact Grammar version, the canons bundle those pins and the
  CLI requires the exact hfs, and R15 then made each app bump six pins and rerun `--fresh`. The canon pins now give the Grammar family a
  same-minor `range` beside its `version` (the version a scaffold writes); R15 accepts an exact app pin inside it, every other pin stays
  exact, and the release's sibling judgement reads the same range. A range beside the version, not in place of it, keeps every reader of
  `version` (the scaffold, the stack pins) on one exact number. A patch therefore publishes only the three family packages; a minor raises
  the range and releases the family, and `RELEASE_GRAMMAR_MINOR_REQUIRED` refuses a patch whose diff since the served version removes a
  public export or a `readonly` prop, changes a lint rule of the family, or removes a DNA law id or touches a deprecated or forbidden
  entry of the contract. The judge reads source lines and over-asks rather than under-asks. The runtime copies an eslint-grammar-*
  package bundles are hfs data that move only with an hfs release, so they never make a Grammar change a minor. Reading the Grammar
  version at lint time (option B) is not taken (`packages/hfs/runtime/scripts/lib/pin-range.mts`, `cli/src/core/release/grammar-bump.ts`,
  [grammars/contributing.md](../grammars/contributing.md) "Patch or minor").
- **A release publishes only what changed (`release-only-what-changed`).** The owner, 2026-11-05: an hfs law or data change used to release the
  canons and the Grammar family too, since each bundled a copy of the hfs runtime (and the copies the canons kept as their own were stale forks,
  slots.yaml at 3.13.0 under hfs 3.23.0). The canons and the Grammar lint family now import that runtime from the installed @starci/hfs, which
  they peer by `~x.y.z`, and keep in runtime/ only what hfs does not ship. The publish plan skips a raised version whose shipped files differ
  from the served one only by its CHANGELOG, lockfile and version field. R15 reads a same-minor range for the two canons as for the Grammar.
  @starci/hfs stays exact for apps: it arrives with starci-harness, and the check (the CLI's hfs) and the canon lint (the app's hfs) must be one
  copy, which an exact pin equal to the CLI's requirement guarantees; the CLI keeps its exact requirement. The canons' TypeScript keeps its own
  declarations of that runtime through tsconfig paths, read through the canon's HfsView type (`cli/src/core/release/publish.ts`,
  `packages/eslint-canon-*/src/lib/*root.ts`, [packages/README.md](../../packages/README.md)).
- **The check plans its memory from the app (`memory-plan`).** The owner, 2026-11-05: one heap per kind was wrong at both ends, a tiny app held a 12 GB
  coverage parent and Nivo's parent died on 494 MB of coverage records at node's default heap. `app check` now measures the app (specs and sources per
  side, the record MB) and sizes each heap with constants fitted on Nivo's runs (ops/liveness.yaml heavy.plan), holds each planned child at its planned MB
  in admission, learns a factor when a child's peak runs over its plan, and names the plan on an out-of-memory. The coverage records are held as their
  lines (a lazy record) and folded through the preset's merge one at a time, so the parent holds about three times their MB instead of seven. The CLI
  measures and plans, and hands the plan to @starci/hfs through STARCI_MEMORY_PLAN, so a CLI never needs a newer hfs to plan
  ([check-cache.md](../project/check-cache.md#the-memory-plan)).
- **The pre-push gate runs CI's own steps (`ci-parity`).** The owner, 2026-11-05: main CI went red on a landing `next build` after a green local
  `--fresh`. The build and audit families read the commands of the app's rendered workflow, never restate them, and run whole in the pre-push gate,
  a build with its own SWC cache root (the Windows hardened-loader refusal of %LOCALAPPDATA%\swc); CI's coverage step runs on the merged lcov. The
  database steps stay CI-only (R383, [check-cache.md](../project/check-cache.md#ci-parity)).
