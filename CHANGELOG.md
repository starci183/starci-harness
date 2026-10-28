# Changelog

All notable changes to the `starci-harness` CLI are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each package under `packages/` keeps its own CHANGELOG.

## [Unreleased]

### Added

- **The urgent release** (owner, 2026-10-29: "deploy gấp không cần ci cd gì hết!!!! cái này là tính năng nha"). `starci app release
  push --urgent --reason "<text>"` ships an app after its fast local checks alone and writes an URGENT record (role, reason, checks,
  commit); `starci app release gate --backfill <tag>` runs the full gate on that commit later, promoting the record to L4 when green
  and opening a blocking `verify` ticket when red (`cli/src/core/app/release.ts` hands @starci/hfs 4.9.10 the caller's role and the
  ticket queue). `requireCi` of `deploy.prod` and `release.cut` accepts the commit's pushed urgent record when the caller passes
  `--urgent` (`cli/src/core/check/ci.ts`), and `starci app stack deploy --env production --execute` now holds `deploy.prod` itself
  (`cli/src/core/app/stack.ts`); with `--urgent` the deploy's safety floor runs first and is never skipped. Bench:
  `release-urgent-push-deploy-accepted`, `release-urgent-backfill-green-promotes`, `release-urgent-backfill-red-opens-ticket`,
  `app-lint-eslint-heap-flag`; the boot proof timeout is held by `packages/hfs/src/hfs-boot-proof.spec.mjs` on a real worker.

### Changed

- **The release gate's load defects.** The eslint memory of ops/liveness.yaml `heavy` is 8192 MB, its admission estimate matches,
  and the CLI hands it to the ESLint child of an app lint or app check as its heap; `heavy.bootProofTimeoutSeconds` (300) is the
  lite boot proof's own budget from its spawn, a timeout retried once and then reported `BOOT_PROOF_TIMEOUT`, not as a failed proof
  (`hfsLimitsEnv` in `cli/src/harness/heavy.ts`).

### Fixed

- **A vanished local package folder no longer burns tries.** A project's local package record (`deps-local.json`) that named a
  package edit worktree Debug had landed and removed made every Op launch log `deps-local-sync-failed`, the wave's install red,
  and both landed tasks come back as wave-foreign revivals at the same try. Every reader of the record now heals it first
  (`healRecord` in `cli/src/core/deps/packages.ts`): an entry whose folder no longer holds its package is repointed to the
  harness's own `packages/<name>` (of its main checkout, also the `deps source --local` default), or dropped so the package
  resolves from npm, with a `deps-local-healed` event; `worktree gc` heals every project's record once it removed a package
  edit worktree. An install red although the work changed no file an install reads is now the harness's failure
  (`assertNoInfraFailure` in `cli/src/harness/clean-verify.ts`): the verify or wave reaches no verdict, spends no try, fails
  and revives no task (`wave-infra`), opens one harness-defect ticket (`INSTALL_RED_HARNESS`), and the next step verifies
  again. Bench: `deps-local-vanished-folder-heals-on-launch`, `wave-install-red-harness-stop`.
- **A held worktree no longer loops or fails a settle.** Removing a harness worktree first closes every Orca terminal whose
  worktree it is (a seat's or a plain shell's; the caller's own aside), since Windows refuses to remove a folder a process works
  in (EBUSY). A folder git emptied and deregistered but whose rmdir was refused is removed as the empty folder it is, instead of
  `git worktree remove` answering "is not a working tree" on every workflow step; one git deregistered but could not empty (a
  file named `nul`, which Windows' own delete refuses) has its remaining files deleted, links unlinked first and never
  entered, and the collector finds such remnants under a project's state worktrees folder once they sit quiet for ten
  minutes. A removal still refused as busy (EBUSY,
  EPERM, EACCES) is recorded `worktree-remove-busy` in the ledger and left: the task settles, the step reports a wait, and
  `worktree gc` retries it with backoff (1 min doubling to 1 h), opening one `harness-defect` ticket at the sixth attempt that
  names the holding process when `handle`, `openfiles` or `lsof` can (`cli/src/harness/worktree-busy.ts`). `worktree gc` also
  removes the harness worktrees a retired project still holds, and `project retire` closes the main checkout's terminals and
  saved workspace details (`orca terminal close --all`) before detaching it, so a forced delete leaves no "Unknown" project in
  Orca. Bench: `worktree-remove-closes-terminal`, `worktree-remove-busy-gc-retries`, `worktree-gc-retired-leftovers`; a new
  `hold` stand-in holds its working folder, and the Orca stand-in lists each terminal's worktree and ends a holder whose
  terminal is closed.
### Changed

- **The Supervisor rules what a Kernel leaves undecided** (owner, 2026-10-29). A Kernel decision (a red task, a failed or
  returned one answered without moving it, a question, check-premise or shared-need) still undecided past
  `decisionStallMinutes`, though the Kernel was woken, is no longer a `harness` escalation ticketed for Debug: the tick hands it
  to the Supervisor as a `kernel-undecided` decision carrying the decision in full and the task's evidence, superseded if the
  Kernel decides it first. The Supervisor rules it in the Kernel's place with the Kernel's own `workflow-change` (under its
  route and need checks; its route counts toward the limit) or an `escalation`, through `supervisor submit`; the ruling is
  recorded `ruled-by-supervisor`, closes the Kernel's decision, and `kernel next` tells the Kernel seat once on its next turn
  (`rulings`). Only a ruling escalation becomes a ticket, and only of kind `owner` (a question to the owner) or `harness` (a
  defect for Debug); any other is refused `RULING_WITHIN_AUTHORITY`. The Kernel brief and the `decisionIdle` prompt say a
  woken decision is answered in that turn: never leave a decision open across a wake. Bench:
  `supervisor-tick-wakes-kernel-on-undecided`, `supervisor-rules-kernel-undecided`.
- **A hold names what releases it.** A `workflow-change` that answers a decision on a task without moving it (no change, no
  need) carries `hold: {ticket | commit | need | time}`, else it is refused `HOLD_UNCONDITIONED`. The hold is recorded on the
  task (`task-held`), keeps the task out of the undecided wakes, and is released by the harness once its condition is met (the
  ticket closed or answered, harness main contains the commit, the need ended, the time passed), from every workflow step and
  tick and from the ticket's close or answer: a task the harness ended comes back at the same try, any other returns to its
  reopened Kernel decision (`cli/src/harness/holds.ts`). A hold with no release condition held a dead task for hours.
  Bench: `kernel-hold-released-by-ticket`.
- **Telegram carries only what needs the owner's decision** (owner, 2026-10-29). ops/telegram.yaml `notices` lists the notice
  kinds that go out, `question` alone by default: a question ticket awaiting the owner is sent once as its card, reminded at
  most once per `reminderHours` (24) while it stays open as a reply to the card with its buttons, and an answer is acknowledged
  with one short line. Workflow done, blocked or stopped, owner requests taken up and defect tickets opened or fixed are no
  longer sent (`workflow`, `request`, `defect` switch them back on); they stay on `/status`, `/tickets`, the harness UI and the
  monitor's report. Bench: `telegram-owner-decisions-only`; `ticket-telegram-card-buttons` switches `defect` on.

### Added

- **Host starvation is visible, and ticketed once.** `starci host load` adds who holds the memory: the top processes by working
  set, managed (a recorded heavy command or seat, a process under one, one working in the harness's state folder) or unmanaged
  (other node, WSL and Docker, IDEs, agents), each command line clipped and redacted, with totals per group; each queued heavy
  command shows how long it waited and why ("free RAM 2.6 GB below reserve 8 GB"), and the seat holds are listed
  (`harness/host-holders.ts`). `seat start` records a `SEAT_RAM_LOW` hold (since when, on what memory) and `workflow status`
  names it instead of a bare `queued` ("held: free RAM 2.6 GB below seat floor 6 GB (since 21:02Z)"), as it names a verify
  waiting for a heavy slot and a task awaiting the owner. When admission or a seat launch has been held past
  `heavy.starvedTicketMinutes` (ops/liveness.yaml, 45), `supervisor tick` opens one `harness-defect` ticket per episode
  (`HOST_STARVED`) listing the top unmanaged holders; the governor's rules are unchanged. Bench: `host-starvation-visibility`.
- **Custody into an opt-in live suite.** A command check whose run holds a `useSandbox` spec reads the keys its world declares
  from the app's sealed `.starcistacks/<env>` members, with the code `app secret materialize` uses, into that test run's child
  environment only, and scrubs every handed value from the output before it becomes evidence (`harness/custody.ts`). A key
  custody lacks is `CUSTODY_KEY_MISSING` ("custody lacks OPENROUTER_API_KEY in dev"): the task ends `awaiting_owner`, in its
  verify or in the wave that runs its deferred tests, spends no try and is filed as the owner's question on credentials, where
  it used to fail red with TEST_WORLD_NOT_DECLARED. Bench: `verify-live-suite-custody`, whose fake value appears in no output,
  check row, event or ticket. A bench verb step that fails inside `starci app` now shows @starci/hfs's stderr.
- **`/status` on Telegram.** One message summing up the workflows of every registered ledger: counts by status per project,
  each blocked workflow with its reason, each running or paused one, the questions awaiting the owner and the open defects.

### Fixed

- **A workflow notice is sent once per state.** Its key held the goal and graph versions, which a Kernel amending a blocked
  workflow bumps every minute, so "workflow lesson-ai is blocked" went out at 2:59, 3:00 and 3:02; it is now keyed by status and
  a hash of the reason (`workflowNoticeKey`). Bench: `telegram-workflow-notice-once-per-state`.

## [1.1.0-alpha.6] - 2026-10-29

- **Desktop app 0.2.0, released as latest.** The app-v* release is no longer a pre-release, so the repository sidebar shows it; README gains a Packages section with every published package, its npm link and a live version badge.

### Added

- **Atomic landing.** A worker's brief names its own Op worktree as its repository (it named the workflow's worktree, so
  workers wrote there and their tasks settled done with nothing landed). `lands` is red when a result names files under
  allowPaths while the candidate changes none, and every ending of an Op's task preserves whatever sits dirty under its
  allowPaths in the checkout it lands on as the task's work and puts that checkout back under the land lock (`land-escaped`),
  so a green task is on its branch or returned with its work preserved, and a stale leaked copy no longer refuses the
  fast-forward (`SETTLE_REF_FAILED` to awaiting_owner). `task verify --recover` returns a done task whose named files never
  landed: its work preserved, failed `land-orphaned`, a harness cause that revives it at the same try, its workflow reopened
  when it had ended done. Bench: `land-escaped-work-returns-preserved`, `land-stale-escape-cleared-then-lands`,
  `land-orphan-recover-returns-task`.
- **Test runs scoped to the task's own specs.** A jest command check (tests-pass, suite-verdict) runs the spec files it names
  by `--runTestsByPath`, which no array option of the script (`--selectProjects e2e`) can swallow; an integration, e2e or
  contract run naming none runs the task's changed specs, else every spec of its kinds; a live-provider spec (`useSandbox`)
  runs only when its file or folder is named (`scopedTests` in `cli/src/harness/coverage-scope.ts`). Bench:
  `verify-e2e-scoped-to-own-specs`.
- **check-premise decisions.** A failed task whose only reds are command checks its contract wrote, each output stating an
  expectation the otherwise green result contradicts, reaches the Kernel as `check-premise` with each check's command and
  output; route `check-premise-amends-checks` takes only an edit that sets the task's checks (`cli/src/harness/check-premise.ts`,
  ops/coordinators/kernel.md). Bench: `kernel-check-premise-amends-checks`.
- **Undecided work wakes the Kernel.** The tick types a live Kernel `prompts.decisionIdle` naming each open Kernel decision, and
  each failed or returned task whose last decision was answered without moving it, past `decisionIdleMinutes`; past
  `decisionStallMinutes` it escalates the item to the Supervisor (kind harness, ticketed) (`decisionIdle`, `stall` of
  ops/liveness.yaml). Bench: `supervisor-tick-wakes-kernel-on-undecided`.
- **Every owner wait is ticketed.** A task left awaiting_owner becomes a blocking `verify` ticket naming its verify's last
  reason, beside the escalations (with or without a topic) already ticketed, and `supervisor next` sends the owner's Telegram
  notices in the round that filed them. Bench: `ticket-legacy-owner-escalation-and-awaiting-task`.

- **Ticket cards on Telegram.** Every ticket notice is the one banner `ops/telegram/ticket-banner.png` (generated once with
  Codex's image generation; `banner` of `ops/telegram.yaml`), uploaded once and then reused by its Telegram file id, captioned
  in Vietnamese with the ticket's facts and carrying inline buttons: a defect's details, hand to Debug, the ticket list and a
  one-hour mute (`muteMinutes`); a question's accept the default, its listed options (`ticket open --option`) and another
  answer; a fix's commit link (`commitUrl`) and reopen. The bridge reads button presses (`callback_query`) from the owner's chat
  only, acts through the ticket functions, answers the press and edits the card's keyboard; `/tickets` lists the open tickets
  with a button each and "Đã đóng hôm nay", `/ticket <id>` shows one in full, redacted. Bench: `ticket-telegram-card-buttons`;
  the Telegram stand-in answers `sendPhoto` (json or multipart), `answerCallbackQuery` and `editMessageReplyMarkup` and takes
  presses at `/__callback`.

- **Tickets.** What the Supervisor cannot resolve within its authority becomes one ticket in machine.sqlite (`tickets`,
  `ticket_waiters`): a defect (`harness-defect`, `package`, `launch`, `verify`, `routing`, `other`) for Debug's queue, or a
  question (`question:business`, `question:code`, `question:spec`) for the owner, with severity, evidence (task, attempt, seat,
  decision, redacted red tail), what was tried, a proposed default, and who opened and reported it. A repeat of the same defect
  (kind, error code, module) or question bumps `occurrences` instead of opening a second, and reopens a fixed defect. New verbs:
  `ticket open` (supervisor, owner, debug), `ticket list [--state] [--project]` (blocking first, then by occurrences),
  `ticket show`, `ticket take` and `ticket close --fixed-by | --wontfix --reason | --duplicate` (debug, owner), `ticket answer
  --answer | --accept-default` (owner). `supervisor next`, `supervisor tick` and every notice sweep file each open `owner`
  escalation the owner rules as a question ticket (its topic and `default` kept) and each `harness` escalation as a blocking
  defect ticket, the escalation waiting on it. Telegram puts each question to the owner once, whose reply (or `/answer <ticket>`,
  `default` accepting the proposed default) answers it, and notices a defect's opening and close once each, below blocking
  only past `ticketOccurrences` (`ops/telegram.yaml`); the notice of an `owner` escalation is now its ticket's. An answer or
  close is recorded with who gave it and why, releases every task and escalation waiting on it, wakes the Supervisor with an
  owner request naming them, and reaches every later brief of the workflow under "Answers". The Op, Kernel and Supervisor
  briefs carry the rule: an Op stuck on an unclear rule or a harness red files `blocked` with its question and proposed
  default, the Kernel answers or escalates, the Supervisor answers or opens one ticket; nobody guesses silently. Bench:
  `ticket-op-question-kernel-answers`, `ticket-op-question-owner-answers-on-telegram`, `ticket-harness-defect-debug-closes`;
  `telegram-notify-once-per-decision` and `telegram-bridge-reply-records-owner-request` now prove the ticket notices.

- **Coordinators run on their own.** An `owner` escalation names its `topic` (`scope`, `money`, `credentials`, `legal`,
  `product`) and may propose a `default` with its `reason` (`COMMAND_INVALID` otherwise); the Supervisor's driver (`supervisor
  next` and `supervisor tick`) decides a `product` choice that carries a default on that default, answers its Kernel with an
  `escalation-answer` and records the reasoning (`escalation-defaulted`), so only scope, money, credentials, legal matters and a
  product choice with no default reach the owner and Telegram. The tick wakes a Kernel whose workflow holds ready work with no
  live Op past `stall.readyIdleMinutes` with a prompt naming the ready tasks, and gives it up to a relaunch past
  `stall.readyStallMinutes` (`ops/liveness.yaml`). A task the harness ended with no red of its own (a wave red not proven its
  own, a fenced or lost launch, a verify stopped by infrastructure or its deadline) returns to ready and is dispatched again at
  the same try, its last included (`task-revived`, at most `reviveMax` per node; past it the Kernel's red names the
  `harnessCause`). `workflow define` and every replan refuse `NEEDS_REQUIRED` a task whose input names another workflow's
  branch or landed commit as its source. Bench: `supervisor-defaulted-escalation-decided`,
  `supervisor-tick-wakes-idle-ready-kernel`, `kernel-harness-killed-task-revived`, `kernel-cross-branch-copy-refused`.

- **Shared needs.** A worker that finds a shared thing missing files `task result --status blocked --needs <key> [--rule]
  [--paths]... [--note]` (or a `needs` list in its output) instead of building it. Keys are `capability:`, `package:` or
  `config:` names, normalized, and a reported path under a shared root of the new `ops/needs.yaml` names the key. One need
  per (project, key) lives in machine.sqlite (`shared_needs`, `shared_need_waiters`); every report of the key attaches its
  task as a parked waiter, its work kept. Every workflow step, under both runners, routes a need to its workflow's Kernel
  (one workflow) or to the Supervisor (two workflows, a shared root, a config key, a `@starci` package as a package edit)
  as one `shared-need` decision; exactly one owner resolves it (`workflow-change` with `need.resolver` or `need.reject`, the
  new `need-owner` Supervisor command, `supervisor dispatch --need`), a need unowned past `needs.ownerDeadlineMinutes`
  (`ops/liveness.yaml`) climbs one router, a failed resolver or a cycle reopens it, and once the resolver lands (or its
  package handoff is merged) the waiters are retried from their kept work in each workflow's own step. A cross-branch relay
  comes first: the resolving tasks' landed commits are cherry-picked onto each waiting workflow's branch under its land lock
  (a `need-relayed` event, printed by `needs show`), and a conflict moves nothing and raises one Supervisor `conflict`
  escalation with the waiters kept parked. A `need-owner` may name tasks its owner already landed as `need.resolver`. A wrong
  answer bounces `NEED_ANSWER_INVALID` with guidance. New verbs `needs list`, `needs show`, `needs merge`. Bench group
  `needs`: ten scenarios.

### Fixed

- **A task is briefed with the rule pages of its paths.** The resolved context adds, for every allowPath, each
  `contexts/code/{be,fe}/*.md` topic whose front matter `slots` names a slot of `contexts/hfs/slots.yaml` the path lies in
  (its most specific slot, an app-kind slot matched by the app folder) or holds (`harness/rule-pages.ts`), so a worker on the
  CLI aggregate may cite `BE-CLI-*` and one on an integration `BE-INFRA-*`. The brief lists them as "Rule pages of your
  paths", citable and opened on demand, outside the op's context budget. `rules-cited` names the page that owns an id the
  task was not handed ("BE-WEBHOOK-1 is owned by contexts/code/be/webhooks.md, which the brief did not include"). Bench:
  `cited-rules-by-paths`.
- **A task in its Op worktree is judged on its own diff.** `starci check run --task` and the worker's `task verify --contract`
  replay diff from the Op worktree's fork (the workflow head it was cut from), never from `origin/main`, so lint, typecheck
  and the changed-file coverage no longer judge what earlier tasks left on the workflow branch (`LINT_CONFIG_MISSING` and
  `TYPECHECK_CONFIG_MISSING` on `.starciwork` files, whole-suite coverage thresholds). A tests-pass run that changed no source
  file judges no coverage, and coverage arguments go only to a command that runs jest (`jest`, `npx jest`, or a package
  script that calls jest); any other command, such as `git diff --no-index`, runs as named.
- **Orca lineage is re-applied on every tick.** An Op whose launch ended unknown is listed under its Kernel's worktree at
  once, and `supervisor tick` re-applies the lineage of every harness worktree Orca lists without its parent
  (`harness/orca/lineage.ts`), logging Orca's refusal with its reason (`orca-lineage-refused`). Bench:
  `orca-lineage-reapplied-on-tick`.
- **A pasted dispatch is submitted before its launch is adopted.** The paste itself prints, so a dispatch left in the
  composer read as started and was adopted unsubmitted; the screen is now read first (the marker found anywhere on a row
  or wrapped over two), and an idle Kernel or Op is resubmitted before it is nudged. Bench:
  `orca-composer-paste-printed-before-adoption`.
- **`project retire` cleans up after the project.** It removes every harness worktree of the project (work preserved,
  branches kept) and detaches the repository from Orca's project list (`orca project setup-delete`) once Orca lists no
  other worktree of it. Bench: `project-retire-removes-worktrees-detaches-orca`.
- **Concurrent starts of one task no longer race on its Op worktree.** It is made under a ledger lock per task (bench
  `orca-duplicate-step-no-double-launch` on Linux). `supervisor-dispatch-worker-report` reads the worker's branch, whose
  worktree the accept removed (`gitLog` takes `ref`), and `worker-commits-itself` commits in the Op worktree.

- **`starci app add` takes every front-end unit.** The noun names `page`, `overlay` and `layout` beside `block`,
  `composite`, `branch` and `leaf`, and the verb hands @starci/hfs `--kind modal|drawer` and `--form` (an overlay) and
  `--blocks a,b` (the blocks a page or layout composes). What each one writes is @starci/hfs 4.9.7's.

### Changed

- **A package publishes once its own CI jobs are green.** The publish no longer waits for the `ci` aggregate: `publish-packages`
  publishes each due package once the repo-wide gates and the `package` jobs of its build order are green, holding and naming
  the rest (`.github/scripts/publish-gate.mjs`), and `publish-cli` publishes the CLI after it once the harness job and every
  gate are green. A red bench, Sonar or app job no longer holds a package (CONTRIBUTING.md CONTRIB-20). `release publish
  --publish --package cli` now moves the CLI's sibling requirements to their folder versions, as a run without `--package` does.
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
- **Shared install cache.** A clean checkout and an Op worktree link their node_modules from `<state base>/cache/installs/<key>`
  (lockfile, Node and npm versions) instead of running `npm ci` (an Op worktree falls back to linking its target's install on a
  miss, and always in local package mode); workspace links are re-made per checkout, a clean checkout in local package mode
  gets a copy, and every link is unlinked before the checkout is removed. Bench: `verify-install-cache-reused`.
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
