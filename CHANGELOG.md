# Changelog

All notable changes to the `starci-harness` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each package under `packages/` keeps its own CHANGELOG.

## [Unreleased]

### Added

- **`starci app add` takes every front-end unit.** The noun names `page`, `overlay` and `layout` beside `block`,
  `composite`, `branch` and `leaf`, and the verb hands @starci/hfs `--kind modal|drawer` and `--form` (an overlay) and
  `--blocks a,b` (the blocks a page or layout composes). What each one writes is @starci/hfs 4.9.7's.

### Changed

- **Each Op runs in a worktree of its own; path leases are gone.** Every task of a workflow, under `orca` and `inline`, works
  in `<project state>/worktrees/<workflow>.ops/<task>` on branch `starci/<workflow>.ops/<task>`, cut from the workflow
  branch's head when its seat starts, with the hooks and the workflow checkout's install linked in, never a fresh install
  (`harness/land.ts`). No path is held while a task works, so a ready task dispatches whatever paths others write
  (`LEASE_CONFLICT`, `LEASE_LOST`, the `leases` table, `conflictMinutes` and lease expiry are gone). `task verify` rebases
  the candidate onto the head it lands on (`git merge-tree`) and checks that, so what is verified is what lands; it lands
  under a land lock per branch held only while integrating, verifying again under it when another task landed meanwhile.
  A textual conflict is never resolved by the harness: the work is preserved, the attempt ends `conflict`, and the Kernel
  gets a `conflict` decision to amend on the new head. In Orca each Op worktree is listed under its workflow's worktree
  (`[Op] <workflow>: <task>`) and that under the main checkout (`orca worktree set --parent-worktree`), and removed through
  `orca worktree rm`. `task status` shows a task's Op worktree instead of leases; `task send`, `cancel`, `result` and
  `verify` drop their lease fields. Bench: `plan-self-overlap-both-land`, `plan-self-overlap-conflict-returns`,
  `lifecycle-inline-chain`.
- **The harness removes every worktree it made.** An Op's worktree goes when its task settles; a workflow's when it is done
  or stopped and its Kernel closed; a Supervisor worker's when accepted or rejected; a package edit's once its head is on
  main; a clean-verify checkout after its verdict. The new verb `starci worktree gc [--dry-run]`, run by `supervisor tick`,
  `supervisor accept` and `reject` and the step of an ended workflow, finds every harness worktree whose owner ended and
  every orphan, preserves its uncommitted work, unlinks its install links (link only) and removes it; branches with work
  that never landed stay ([contexts/authority/README.md](contexts/authority/README.md) "Worktrees"). Bench:
  `worktree-gc-every-kind`.

- **CI publishes on every push to main.** Apps consume the harness packages locally (`deps source --local`); publishing is
  CI's alone. Once `ci` is green on a push to main that affects a package or the CLI, the `publish` job runs
  `release publish --publish --base <the plan's base>`: every version under `packages/` and the CLI not on npm yet, a
  dependency first, with provenance; a version already on npm is skipped and runs queue, so a re-run is safe. The `v*`
  tag path and `release publish --tag` (`RELEASE_TAG_UNKNOWN`, `RELEASE_ALREADY_PUBLISHED`) are gone. `--base` refuses
  `RELEASE_VERSION_NOT_BUMPED` for a package whose shipped files changed (specs and test folders aside) since the commit
  npm recorded for its published version, so a change never ships under an old number. The CLI is published last: its
  commit requires each sibling at a version npm serves (`RELEASE_DEPENDENCY_SKEW` otherwise), every CI job installs it with
  the commit's siblings packed over the registry copies (`.github/actions/cli-install`), and the publish job moves its
  requirements and lockfile to the siblings it just published. The workflow reads the `NPM_TOKEN` secret (CONTRIB-20).
  Bench: `release-publish-version-not-bumped`, `release-publish-plan-guard`.
- **Speed flow: per-task verify is cheap, the wave runs the heavy checks.** policy/quality.yaml `verify.tier` (default
  `wave`): `task verify` of a workflow task runs only its cheap checks (lands, secrets and loosening on its diff, paths,
  files, json, cited, cite) and no install, and records its typecheck, lint and test checks as due; `workflow step` (inline
  and orca, so `kernel next` too) runs one wave verify once the batch has landed and before any dependent starts or the
  workflow is done, its scope decision recorded first, the heavy checks once over the union of the landed tasks; a red wave
  returns the tasks whose files are red (`done → failed`). `workflow wave <id>` runs a due wave by hand. Bench:
  `wave-inline-lint-returns-owner`, `wave-orca-lint-returns-owner`.
- **Shared install cache.** A clean checkout links its node_modules from `<state base>/cache/installs/<key>` (lockfile,
  Node and npm versions) instead of running `npm ci`; workspace links are re-made per checkout, local package mode gets a
  copy, and every link is unlinked before the checkout is removed. Bench: `verify-install-cache-reused`.
- **Host heavy-command governor.** Every tsc, eslint, test or suite command, build, npm install, setup and uat container
  the harness runs takes a slot of a machine-wide semaphore in machine.sqlite (`heavy` of ops/liveness.yaml: 2 slots, one
  under the low RAM floor, none under the critical floor or over the CPU ceiling), runs below normal priority under its
  kind's memory cap (`--max-old-space-size`, `--memory`, `--maxWorkers`), and waits, logged, never failing. A worker seat
  waits while free RAM is under the seat floor (`SEAT_RAM_LOW`). New: `host load`, and `check heavy-sites`, a CI gate
  red for a spawn site outside the governor. Bench: `heavy-third-command-waits`, `heavy-pressure-narrows-admission`,
  `seat-launch-waits-on-ram`.
- **A filed result is verified with no Kernel turn, and a hung verify is reclaimed.** `supervisor tick` and `supervisor
  next` run the settling half of a workflow step (`settleWorkflow`: recover, verify, close seats, wave) for every workflow
  the Supervisor coordinates; a reported task's worker seat is released and its tab closed. A verify holds its verifier lock
  at most `verifyDeadlineMinutes` (ops/liveness.yaml): it gives the lock up itself at the deadline, and a holder past it counts
  as gone, so `--recover` takes its task over. A tool run whose process exited ends within seconds even when a grandchild
  holds its output pipes. Bench: `verify-hung-holder-reclaimed`, `orca-tick-verifies-reported`.
- **Green rows are reused.** `check run` keys each typecheck and lint step by the digest of its inputs and reuses a green
  row of the project ledger instead of rerunning it, in a wave, Debug's scoped round and before a push. Bench:
  `check-run-green-row-reused`.
- **Host secrets come from the harness's secret.env.** One secret loader (`cli/src/harness/secret-env.ts`) reads a named key
  from the process environment, else from `secret.env` at the harness root, and only the keys policy/security.yaml
  `secretKeys` lists (`SECRET_KEY_UNLISTED` otherwise); no output carries a value. The Telegram verbs, the
  `telegram-bridge` service and `supervisor tick` read `TELEGRAM_BOT_TOKEN` through it, and `connect telegram status`
  reports its source. The committed `secret.env.example` names every key the host's secret.env holds and where to get it.
  Bench: `telegram-token-from-secret-env`, every run's `STARCI_SECRET_ENV` is its own file, and `expect.lacks`.
- **Local package sources.** `deps source --local [--from <folder>] [--package <name>]` builds each `@starci` package an
  app uses (default every one it pins or has installed, from this harness's `packages/`) and copies its publishable files
  over the app's installed copies, marked `.starci-local.json`; dependencies a local package adds are installed with
  `npm install --no-save`. package.json and package-lock.json never change. `deps source` prints each package's mode,
  `--sync` re-applies the recorded copies after an `npm ci`, `--npm` runs `npm ci`. `seat start` and clean verify apply
  the same copies to the worker's and the verify's checkout. Bench: `deps-local-verify-green`.
- **The dependency push gate.** `deps check` refuses `DEPS_PIN_UNPUBLISHED` (a committed `@starci` pin npm cannot
  install) and `DEPS_LOCAL_AHEAD` (a local copy no published version holds, compared file by file with the published
  tarball); `release push`, `release cut` and an executed `app release` run it, and the `@starci/hfs` app pre-push hook
  calls it. Bench: `deps-push-gate-pins`.
- **Package edit branches.** `pkg branch <topic>` cuts `pkg/<app>-<topic>` from harness main into a worktree under the
  harness's `.claude/worktrees/` and installs a pre-push guard; `pkg handoff [--urgent]` records the branch and head for
  Debug (`--list` is the queue); `release push`, `release publish` and the guard refuse a `pkg/` branch to every role but
  debug and owner (`PKG_EDIT_PUSH_REFUSED`). Bench: `pkg-edit-branch-handoff`.
- **The Supervisor delegates to workers.** `supervisor dispatch --brief <file|text> [--label] [--repo] [--allow] [--input]`
  hands one job to a `[Worker] <project>: <topic>` seat under the Supervisor: its own worktree on branch `starci/<worker>`, a
  task whose contract is the brief on the label's op, launched into the Supervisor's Run and routed by the worker tiers.
  `supervisor next` tends the workers and returns each one's report or end once as kind `worker`; `supervisor accept`
  settles one by `task verify`, `supervisor reject` cancels it, `supervisor workers` lists them. The Supervisor no longer
  pushes; Debug alone merges, pushes (`release push`, `release cut` now take role `debug`) and publishes. Bench:
  `supervisor-dispatch-worker-report`.
- **A project runs at most `projectMaxWorkers` worker seats** (ops/routing.yaml, 10): its Kernels' Ops and its Supervisor's
  workers together. A launch past it waits queued and starts once a seat is released, before any route is picked. Bench:
  `supervisor-worker-cap-queues`, `supervisor-worker-cap-counts-kernel-ops`.
- **A held decision no longer stops a workflow's dispatch.** `kernel next` steps the workflow before it returns an open
  decision, so a task returned and held never keeps the other ready tasks from launching; a ready task waiting on another
  task's lease names the path and its holder in `workflow status`. Bench: `workflow-blocked-keeps-dispatching`.
- **Coordinator slots are reserved.** A pool's `coordinatorReserve` (ops/routing.yaml; claude 4 of its 6) is held for
  Supervisors and Kernels: a worker pick counts it as taken, a coordinator pick takes a reserved slot whatever the workers
  hold, so a claude pool full of workers no longer pushes a Kernel relaunch onto codex. Bench:
  `coordinator-reserve-claude-full-of-workers`.
- **`supervisor next` always answers.** Its wait stops early by its longest sweep, so it returns inside the caller's shell
  timeout, and a failure no verb catches still prints its refusal (the json envelope under `--json`) with exit 1. Bench:
  `supervisor-next-always-answers`.

### Fixed

- **`check run` judges a package against its workspace dependencies built.** A package that imports a sibling exporting
  only its git-ignored build output (`exports` or `main` at `dist/`) failed its typecheck with TS2307 and its lint with
  cascaded `no-unsafe-*` errors on every clean checkout, so every `task verify` of such an app was red. Before typecheck
  and lint, `check run` now finds each target's workspace dependencies (npm, yarn or pnpm), transitively and in
  topological order, and for each whose manifest entries are missing restores its output from the build cache under its
  content key (`<state base>/cache/workspace-builds/<key>`) or runs its own `build` script and caches the output. A
  dependency that cannot be built is a red `dep-build` step with `CHECK_WORKSPACE_DEP_BUILD_FAILED` naming it, and the
  steps of the packages that need it are held. `check run` is now `local-write`. Bench: `check-run-workspace-dep-built`,
  `check-run-workspace-dep-build-failed`.
- **A task is judged only on its own work.** Another task's uncommitted files in a shared workflow worktree failed a
  task's `paths-only` and reached the lint of its `check-run-green`. When a task's work begins (its seat starts, or the
  inline step hands it out) `beginWork` records the tree of its checkout as its baseline; a dirty file unchanged since
  then is not the task's: its candidate, its stray files, `check run --task` (which `task verify` and the dry replay
  pass) and its preserve and reset leave it be, and it never widens the scope. Bench: `verify-sibling-dirt-not-judged`.
- **A staged module's composition rules wait for its composer.** A module written before the task that wires it in was
  red on `dead-exports` and `feature-not-composed`. A task's contract (or workflow task) may name its composer in
  `composedBy`; its check defers the findings of policy/quality.yaml `runtime.compositionRules` on its own allowPaths to
  that task (`deferred-to:<key>` on the lint step), the composer's check judges the module in full, and the workflow is
  done only after a green final verify (`check run --workflow`) of every deferred module; a red one blocks it. A task
  that names no composer stays red as before. The Kernel brief declares `composedBy` when it splits a module from its
  composition. Bench: `verify-composition-deferred-to-composer`.
- **Prior work is stored when the temp folder and the state base sit on two drives.** The patch was written in the temp
  folder and renamed into the store, which Windows refuses across drives (`EXDEV`, `prior-store-failed`); it is now
  written inside the store.
- **A red check's output is kept and shown.** Every check of a verify keeps the last 200 lines of its tools' output as
  its detail, with every value the secret scan recognises redacted (`redactSecrets`), and `task status <task>` prints the
  detail of the red checks of the newest verify (`checkRuns[].detail` in `--json`). Bench:
  `verify-check-run-output-in-task-status`.

## [1.1.0-alpha.5] - 2026-10-28

- **A returned task no longer holds its lease past its due time.** A task that came back to the Kernel (blocked, mismatch,
  awaiting the owner) has no worker left to write, so once its lease is due `workflow step`, `supervisor tick` and every
  lease request drop it and record `leases-expired`; a task that may still write keeps its lease however overdue. Bench:
  `lease-returned-overdue-released`, `lease-live-overdue-kept`.
- **The owner's Telegram channel.** `connect telegram discover-chat|status|notify` stores the owner's chat (after he
  messages the bot) in machine.sqlite, reports the channel and sends the notices due; `supervisor telegram-bridge
  run|status` is the host service (ops/host.yaml `telegram-bridge`, schedule `StarCi Telegram Bridge`) that sends each
  `owner` escalation, owner request taken up and workflow ended once, within ops/telegram.yaml's budget, and
  records the owner's reply to a notice, `/answer <decision-id>` or `/ask <project>` as an owner request that wakes the
  Supervisor, ignoring and logging every other chat. The bot token is `TELEGRAM_BOT_TOKEN` in the user environment
  (`TELEGRAM_NOT_CONFIGURED` otherwise). Bench: a Telegram Bot API stand-in (`serve: {stub: telegram}`) and four scenarios.

### Changed

- **Coordinators stay on Claude through a stall.** A Supervisor or Kernel the stall ladder gives up on for a plain stall is
  relaunched on the coordinator tier's first member again; a provider failure kind, or the member's
  `stall.coordinatorStallMax` plain stalls of the same seat within `stall.coordinatorStallWindowMinutes`, puts it behind,
  and the repeated stalls raise a `harness` escalation (`coordinatorRelaunch` in `harness/stall.ts`).
- **The coordinator loop holds in Claude Code.** The briefs and loop prompts run `next --wait <coordinators.nextWaitSeconds>`
  in the foreground and call it again in the same turn after every result; `nextWaitSeconds` is 540, under Claude Code's
  600 s foreground limit, and a blocking `supervisor next` renews its lease again before each wait.
- **`harness` escalations are Debug's.** The Supervisor never asks the owner about one and relays Debug's answer from
  `supervisor ask`; `supervisor next` hands an `owner` or `harness` escalation over once (`decision-relayed`), so a looping
  Supervisor waits in `next` instead of receiving it again, and neither kind makes it stalled. Bench:
  `supervisor-awaits-owner-not-stalled`, `supervisor-stall-relaunch-on-claude`.

Runs `@starci/hfs` 4.9.5 (an exact dependency).

### Changed

- **Release G.** @starci/hfs 4.9.5 bundles the canon pins of release G (Grammar family 0.15.4, which ships the fill
  Button floor, `Page`, `MermaidDiagram` and FlowGraph shapes and edge labels, with the lints `page-tabs-in-header` and
  `route-page-is-one-page`; hfs 4.9.5, canon-fe 9.4.4, canon-be 3.6.4) and the rules R324 and R325, so `starci app`
  judges and scaffolds an app at those versions. `cli/package-lock.json` is refreshed once @starci/hfs 4.9.5 is on npm
  (CONTRIB-20: the packages publish first, the CLI on a second tag).

## [1.1.0-alpha.4] - 2026-10-28

Runs `@starci/hfs` 4.9.4 (an exact dependency).

### Added

- **`supervisor ask "<request>"`.** The owner (or Debug relaying the owner's words) hands a request to a project's
  Supervisor without typing in its terminal: it is recorded in the project's mailbox (machine.sqlite `owner_requests`:
  who, text, at) and the Supervisor's Run is mailed awake as a Kernel escalation does. `supervisor next` returns it as
  kind `owner-request` (after the decisions the Supervisor rules, before those awaiting the owner), the stall ladder
  counts it as the Supervisor's work, the host driver keeps a Supervisor for a project holding one, and the Supervisor
  command whose `answers` name it closes it with its cmdId (`OWNER_REQUEST_UNKNOWN`, `STALE` otherwise). Bench:
  `supervisor-owner-request-to-workflow`, `supervisor-ask-roles`.

- **`release affected --base <sha>`.** The CI plan of a diff: the packages it affects, each with its build order (the
  siblings it requires, its `file:` dependencies and the siblings its files read by relative path, deps first), and
  whether the harness job (the CLI and the trees it reads) and the app job run; a change under `.github/` or no base is
  every node. CI's `plan` job fans those packages out to one job each beside the light gates, the harness, app and Sonar
  jobs, behind one required `ci` job, and a `v*` tag on a commit whose run on main succeeded reuses that run. Bench:
  `release-affected-ci-plan`.

### Changed

- **Release F.** @starci/hfs 4.9.4 bundles the canon pins of release F (Grammar family 0.15.3, which ships
  `PageHeader` and the lint `no-hand-rolled-page-header`; hfs 4.9.4, canon-fe 9.4.3, canon-be 3.6.3) and the rule
  R323, so `starci app` judges and scaffolds an app at those versions. `cli/package-lock.json` is refreshed once
  @starci/hfs 4.9.4 is on npm (CONTRIB-20: the packages publish first, the CLI on a second tag).

### Fixed

- **`route explain --label kernel|supervisor`** explains a coordinator seat's pick through `pickCoordinator` (tier from
  `coordinators`, then the same filters, circuit, quota, qualification, scoring and balance as a worker) instead of
  refusing `LABEL_UNKNOWN`; `--coordinator` is gone, the label names the seat. Bench: `route-explain-coordinator-circuit`.
- **A launch that fails at agent readiness says why.** The agent terminal Orca's failed receipt names (its effects and
  residualResources, so the tab is also closed now) is read once before the worker is released, and its last non-empty
  lines are the seat's failure facts (`seats.failure_json`, ledger version 9, shown by `seat list`) and part of the
  launch error. A screen at one of routing.yaml `blockedPrompts` (Claude Code's trust or external-import dialog, a login,
  a "Do you want to" confirmation) is a `blocked-prompt`: no provider strike, no member outcome, a free attempt with that
  pool put behind, and a `harness` escalation for the Supervisor naming the prompt and the worktree, which `supervisor
  tick` names on every pass. Every launch-failed seat, dead-on-arrival ones included, records its failure. Bench:
  `seat-launch-blocked-prompt`, `seat-launch-readiness-timeout-strikes`.

## [1.1.0-alpha.3] - 2026-10-28

Runs `@starci/hfs` 4.9.3 (an exact dependency).

### Changed

- **An app's `starci-harness` is the CLI that judges it.** `starci app` passes @starci/hfs the CLI's own version
  (`harness`), which is the `starci-harness` an app is checked (HFS_CANON_PIN_DRIFT, HFS_CI_MISSING_CANON) and
  scaffolded at; @starci/hfs 4.9.3 and the canon packages bundle no pin of the CLI, so a CLI release no longer needs a
  new @starci/hfs naming it.

- **`release publish` judges its plan.** A package due for publication that requires a sibling (`dependencies`,
  `peerDependencies`) at another version than the sibling's folder holds is refused `RELEASE_DEPENDENCY_SKEW`, one
  requiring a private sibling `RELEASE_DEPENDENCY_UNPUBLISHED`; `--tag <tag>` refuses a tag naming no package version
  (`RELEASE_TAG_UNKNOWN`) or only versions already on npm (`RELEASE_ALREADY_PUBLISHED`), and `--publish` publishes a
  dependency before its dependent. CI's publish job runs the plan with the tag before anything reaches npm and publishes
  the packages before the CLI. Bench: `release-publish-plan-guard`.

## [1.1.0-alpha.2] - 2026-10-28

Version 1.1.0-alpha.1 was published from an earlier commit of this list, on `@starci/hfs` 4.9.0; 1.1.0-alpha.2 carries
the whole list.

### Added

- **The app commands.** The CLI carries `starci app scaffold|sync|check|lint|add|new|emit|explain|hygiene|coverage|codemod|ci|db|secret|stack|release|upgrade`,
  each a verb with its typed flags, effect and roles that runs `@starci/hfs` (4.9.2, an exact dependency) in-process in
  the app: in human mode its output streams as it prints, under `--json` the envelope carries its report and exit code. A
  product pins `starci-harness` as its devDependency, its husky hooks and CI run `npx starci app ...`, and its codegen loads
  `starci-harness/input-bounds`; `@starci/cli` is retired. A verb flag may now be a `list`, given once per value.

- **`config list|get|set`.** One door to the harness settings, each kept in the ops/ yaml that owns it: `list` prints
  every setting as a dotted key (`routing.tiers.high[0].effort`) with its value and file, `get` one, and `set` writes a
  value with the file's comments and layout kept, after the file's own loaders accept the whole new file
  (`CONFIG_INVALID` and `CONFIG_KEY_UNKNOWN` leave it untouched). The Claude members of `ops/routing.yaml` name the effort
  of their tier, as Codex's do.

- **Lanes and repair routes.** `ops/lanes.yaml` is the standard build flow each Work record walks; `workflow define`,
  `amend` and every replan refuse `FLOW_INCOMPLETE` while a covered record's step is neither satisfied by evidence nor
  carried by a task of its label in order (a front-end code step held until its feature's drawings and back-end code), and
  `TASK_NOT_SPLIT` while one task of a `perRecord` label works several records; `kernel next` digests each record's lane.
  An orca workflow runs at most `workflowParallel` Ops at once (`ops/routing.yaml`); ready tasks past it wait. `ops/routes.yaml` bounds repairs:
  a red or question decision carries its legal route, `kernel submit` refuses `ROUTE_ILLEGAL` off it, and past its limit
  the Kernel escalates to the owner. The `ui` label becomes `draw`; `audit` and `review` are new, and the router never
  gives a `review` to the provider that authored the work it reads (`independentOf`). A workflow file may name
  `requires: [security, perf]`.

- **Host driver and stall ladder.** `supervisor tick` (one idempotent pass for a scheduled task) and `supervisor watch`
  (its loop) keep the seat tree alive with no LLM awake: ensure the Supervisor, sweep its Kernels and their Ops, and for an
  agent idle at its prompt with work pending (Orca's tui-idle, output and heartbeat signals) nudge it with its loop prompt,
  then relaunch (or fence) it on another member with a `stalled` outcome and a provider circuit strike of the kind Orca's
  failure words name (`capacity`, ..., else the new `stall`), then escalate through the relaunch limit.

### Changed

- **One Supervisor per project.** A project is the repository owning the Work plus the side repositories whose `hfs.json`
  names it; each has its own `[Supervisor] <project>` launched in its main checkout (`project_supervisors`, machine
  version 3), and every `supervisor` verb takes the project from the working directory or `--project`. `workflow start`
  and `kernel start` require the Supervisor of the workflow's project, a Supervisor sweeps only its project, and
  `supervisor tick` keeps and sweeps every project's Supervisor; a workflow under the version-2 host Supervisor is
  adopted by its project's Supervisor on the first tick.
- **Exceptions pin their lines.** An exception of `policy/loosening.yaml` or `policy/security.yaml` names its `kind`
  (`fixture`, `template`, `detector`, or `ruling` with the id of a live ruling of contexts/decisions/rulings.yaml in
  `decision`, else `EXCEPTION_RULING_UNKNOWN`) and the exact text of each line it covers (`match`); it covers only those lines,
  so a new occurrence in the same file is a finding. An exception on a file its kind does not qualify is refused
  `EXCEPTION_KIND_REFUSED`, a `match` that covers no finding turns the check red `EXCEPTION_STALE`, and `check loosening`
  and `check secrets` list every exception applied. `release push` honours the same exceptions.

### Fixed

- A completed launch request whose agent never started its turn is judged by its dispatch (adopted, or fenced and requeued
  with no try spent), never replayed forever.
- **The Sonar block carries the ruled cpd exclusion.** `app sonar` derives the `starci:sonar-scope` block with
  `sonar.cpd.exclusions` beside `sonar.coverage.exclusions`, its entries the `cpd-exclusions` allowances of the design
  truths of the `@starci/hfs` the CLI runs (ruling message-catalogs-not-duplicate-code), the line the app template renders
  inside the same block; `check loosening` accepts it there and still refuses a cpd exclusion written outside the block or
  edited inside it (bench `security-loosening-sonar-block`).

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

[Unreleased]: https://github.com/starci183/starci-harness/compare/v1.1.0-alpha.2...HEAD
[1.1.0-alpha.2]: https://github.com/starci183/starci-harness/compare/v1.0.0-alpha.1...v1.1.0-alpha.2
[1.0.0-alpha.1]: https://github.com/starci183/starci-harness/releases/tag/v1.0.0-alpha.1
