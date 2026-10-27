# Stress bench

The bench proves that the orchestration survives its failure cases. Each scenario injects one failure into a run of the
harness and judges what the harness did from the ledger and from git: the states and events it recorded, the commits in
the workflow's worktree, that nothing unchanged was redone, that no step moved without evidence, that no actor overstepped
its role, and that no person had to step in. A scenario is not an example app: it builds its own scratch repository at run
time and throws it away.

## Running it

```text
starci bench list [--group <group>]
starci bench run <id> [--fault <name>]
starci bench run --all [--record]
```

`bench run` gives every scenario its own folder under `<state base>/bench/<run>` with a scratch git repository, an
isolated `STARCI_LOCAL_ROOT` and the Orca stand-in, runs the scenario's steps with the built CLI, asserts each
expectation, and writes `result.json` there and a line in `<state base>/bench/results.jsonl`. It writes nothing tracked;
`--record` rewrites the scoreboard table below and nothing else. Exit 1 when a scenario ran red.

- **Scenario files** are `scenarios/<id>.yaml` (`starci/scenario@1`, validated by `cli/src/core/bench/scenario.ts`): the
  group (`acceptance` holds the owner's acceptance runs), what is injected, the expected behaviour, the pass criteria, the
  automation status (`automated`, `semi` when it needs a live Orca, `manual`), and either the steps the runner executes
  or, while it waits for verbs or a person, the `pending` reason with the exact `manual` steps. A scenario that exposes a
  harness defect names it in `finding` with the file:line that owns it and stays red until the harness changes; its
  assertions are never weakened to pass.
- **An orca workflow runs on the coordinator tree, booted through real verbs.** A scenario's `repos` adds repositories
  beside the scratch one (`<run>/<name>`, `${repo.<name>}`), each a project of its own unless its `hfs.json` names a Work
  root. A `boot` step runs `supervisor start` and `supervisor attach` once per project (`boot.project`, default the
  scratch repository's), then `workflow define <file>` and `workflow start <workflow>` in the workflow's repository
  (`boot.in`, default the project's) from that Supervisor's terminal, and `kernel attach` from the terminal the Kernel's
  launch got; `boot.adopt` attaches a workflow's current Kernel seat (one `supervisor next` relaunched). It saves
  `supervisor.{launch,terminal,run}` (`supervisor.<repo>.*` for another repository's project),
  `kernel.<workflow>.{launch,terminal,run}` and `worktree.<workflow>`. A verb step's `seat` (`supervisor`,
  `supervisor:<repo>` or `kernel:<workflow>`) runs it in that seat's terminal (`ORCA_TERMINAL_HANDLE`) and role, a
  Supervisor from its project's repository and a Kernel from its workflow's worktree; `kernel next <workflow> --wait 0` and
  `kernel submit` drive the workflow, and command files are written with `file`.
- **Steps** call a verb (`starci`, with `seat`, `expect`, `save` and `parallel`), boot the tree (`boot`), write files
  (`file`, `write`; `write.from` copies a file or folder in, `${ops}` naming the ops/ folder the CLI reads), act as a worker (`worker` writes its files in the task's checkout, the workflow's worktree, and files
  its result there), read a ledger value into a variable (`read`), run git, script the Orca stand-in (`orca`), inject a
  fault straight into a ledger (`sql`, the state a killed process or elapsed time leaves behind), and `assert` on the
  ledger (the scratch repository's, or `repo: <name>`'s), git (`in` another checkout such as `${worktree.<workflow>}`), the stand-in's call log (`orcaCalls`, `match`
  filtering by flag) or the file system. `when` and `unless` tie a step to a `--fault`.
- **The Orca stand-in** is `stub/orca-stub.mjs`: the runner copies this node binary to `<state base>/bench/bin/orca` and
  points `STARCI_ORCA_BIN` at it, and the stub, preloaded into it, answers the orca CLI subset the harness calls: `agent
  launch` (a terminal handle, replayed by `--retry-launch`), run-create and run-use (a Run bound to its coordinator
  terminal), task-create, worker-start (refused unless `--from` is the coordinator of `--run` and `--parent` a task of
  it), worker show, stop, release and abandon, request-show, `orchestration check` and `send` (one mailbox per Run or
  dispatch, deliveries acked), terminal create, list, close and rename, and repo add, and the idle signals the stall ladder reads (`terminal wait --for tui-idle`, `terminal show`, the
  terminal list's lastOutputAt, worker-show's heartbeat and agentWait, and `terminal send`, which keeps each typed prompt). It
  dedupes by retry-request like Orca,
  logs every call, and replays the faults a scenario scripts, optionally only for calls whose flags `match` (refuse,
  outcome unknown, lost reply, slow, garbage, crash, a changed reply shape), and the states it sets: a worker that exited
  (`dispatch: "*"` every Op, `kernel` every Kernel), a terminal gone, mail a seat sent. No real Orca is ever launched.
- **Fixtures that must not be text in this public repository** (a provider-shaped key, an inline lint suppression) are
  built by the runner at run time (`write.generated`).

A `FAIL` on main is a finding against the harness, not against the bench: the scenario states the behaviour the owner's
design asks for.

## Scoreboard

<!-- scoreboard:start -->
| scenario | group | what | automation | result | recorded |
|---|---|---|---|---|---|
| [acc-1-fresh-run](scenarios/acc-1-fresh-run.yaml) | acceptance | owner acceptance 1: a fresh orca run from the owner's request to the Supervisor's stop, through every coordinator verb | automated | pass | 2026-10-27 |
| [acc-2-crash-continue-same-worktree](scenarios/acc-2-crash-continue-same-worktree.yaml) | acceptance | owner acceptance 2: the Kernel crashes mid-run; the relaunched Kernel continues in the same worktree and Run, nothing redone | automated | pass | 2026-10-27 |
| [acc-3-change-of-mind-keeps-done-work](scenarios/acc-3-change-of-mind-keeps-done-work.yaml) | acceptance | owner acceptance 3: the owner changes their mind mid-run; done work is kept, live unchanged work continues, the dropped task stops | automated | pass | 2026-10-27 |
| [acc-4-conflict-scope-escalates](scenarios/acc-4-conflict-scope-escalates.yaml) | acceptance | owner acceptance 4: two workflows want one path; the conflict escalates, the Supervisor narrows one, its Kernel replans inside the new scope | automated | pass | 2026-10-27 |
| [lifecycle-amend-add-reopens-done](scenarios/lifecycle-amend-add-reopens-done.yaml) | lifecycle | a task found late is added to a done workflow, which reopens and runs it | automated | pass | 2026-10-27 |
| [lifecycle-cycle-refused](scenarios/lifecycle-cycle-refused.yaml) | lifecycle | a workflow whose tasks depend in a cycle is refused at define | automated | pass | 2026-10-27 |
| [lifecycle-empty-graph](scenarios/lifecycle-empty-graph.yaml) | lifecycle | a workflow with no tasks is refused, never 'done' with nothing done | automated | pass | 2026-10-27 |
| [lifecycle-inline-chain](scenarios/lifecycle-inline-chain.yaml) | lifecycle | fresh inline workflow of two dependent tasks runs to done | automated | pass | 2026-10-27 |
| [lifecycle-kernel-episodic](scenarios/lifecycle-kernel-episodic.yaml) | lifecycle | the Kernel is woken only for decisions and exits after one command | automated | pending |  |
| [lifecycle-orca-single-op](scenarios/lifecycle-orca-single-op.yaml) | lifecycle | fresh orca workflow: Kernel tree, one Op, verify, release, tabs closed | automated | pass | 2026-10-27 |
| [lifecycle-resume-after-restart](scenarios/lifecycle-resume-after-restart.yaml) | lifecycle | a workflow resumes from the ledger alone after every harness process restarted | automated | pending |  |
| [lifecycle-supervisor-handoff](scenarios/lifecycle-supervisor-handoff.yaml) | lifecycle | a finished workflow hands off to the Supervisor, who lands it | automated | pending |  |
| [project-fe-workflow-under-be-supervisor](scenarios/project-fe-workflow-under-be-supervisor.yaml) | lifecycle | a side (FE) repository's workflow runs under the Supervisor of the project whose Work its hfs.json names | automated | pass | 2026-10-27 |
| [supervisor-per-project-two-projects](scenarios/supervisor-per-project-two-projects.yaml) | lifecycle | two projects on one host: two Supervisors, each launching and sweeping only its own project's workflows | automated | pass | 2026-10-27 |
| [crash-after-commit-before-ledger](scenarios/crash-after-commit-before-ledger.yaml) | crash | killed between the harness commit and the ledger write: no second commit | automated | pass | 2026-10-27 |
| [crash-kernel-during-replan](scenarios/crash-kernel-during-replan.yaml) | crash | the CLI dies halfway through applying a replan | automated | pending |  |
| [crash-kernel-mid-step](scenarios/crash-kernel-mid-step.yaml) | crash | the CLI dies after the dispatch claim and before the Orca call | automated | pending |  |
| [crash-kernel-relaunch-storm](scenarios/crash-kernel-relaunch-storm.yaml) | crash | a Kernel that dies right after every launch: the relaunch limit pauses the workflow and escalates to the owner | automated | pass | 2026-10-27 |
| [crash-machine-reboot](scenarios/crash-machine-reboot.yaml) | crash | the machine reboots mid-run | manual | pending |  |
| [crash-op-dies-after-result](scenarios/crash-op-dies-after-result.yaml) | crash | the Op process dies right after filing its result: the result still settles | automated | pass | 2026-10-27 |
| [crash-op-mid-edit](scenarios/crash-op-mid-edit.yaml) | crash | an Op dies with half its edit written | semi | pending |  |
| [crash-supervisor-dies](scenarios/crash-supervisor-dies.yaml) | crash | the Supervisor seat dies with handoffs and escalations pending | automated | pass | 2026-10-27 |
| [crash-verifying-orphan](scenarios/crash-verifying-orphan.yaml) | crash | the CLI died mid-verify: the next step returns the task to reported and verifies it | automated | pass | 2026-10-27 |
| [coordinator-stall-model-capacity](scenarios/coordinator-stall-model-capacity.yaml) | orca | a Kernel stops at its prompt after a model-capacity error: the tick nudges it, then relaunches it on another member with the first one's circuit open | automated | pass | 2026-10-27 |
| [kernel-holding-on-open-escalation](scenarios/kernel-holding-on-open-escalation.yaml) | orca | a Kernel escalates and ends its turn while its workflow still has work it can drive: the tick nudges it | automated | pass | 2026-10-27 |
| [nudge-storm-bounded](scenarios/nudge-storm-bounded.yaml) | orca | a Kernel that answers each nudge and stalls again, under a storm of ticks: nudges stay bounded, then it is relaunched | automated | **FAIL** | 2026-10-27 |
| [op-stall-nudge](scenarios/op-stall-nudge.yaml) | orca | an Op stops at its prompt with its task unfiled: its Kernel's driver nudges it once, and the nudge restarts it | automated | pass | 2026-10-27 |
| [orca-dead-on-arrival-launch](scenarios/orca-dead-on-arrival-launch.yaml) | orca | Orca completed an Op's launch but the agent never started its turn: the dispatch is judged, fenced, and the task relaunched on another member | automated | pass | 2026-10-27 |
| [orca-down-pauses-workflow](scenarios/orca-down-pauses-workflow.yaml) | orca | Orca stops answering mid-run: the Kernel driver pauses the workflow (orca-down) and lifts only that pause when Orca is back | automated | pass | 2026-10-27 |
| [orca-duplicate-step-no-double-launch](scenarios/orca-duplicate-step-no-double-launch.yaml) | orca | eight concurrent steps of one workflow launch each task once | automated | pass | 2026-10-27 |
| [orca-garbage-run-create-no-second-run](scenarios/orca-garbage-run-create-no-second-run.yaml) | orca | run-create answers garbage: the retry replays the same request, never a second Run | automated | pass | 2026-10-27 |
| [orca-kernel-tab-closed-by-hand](scenarios/orca-kernel-tab-closed-by-hand.yaml) | orca | the owner closes the Kernel tab: the Supervisor relaunches the Kernel, which takes its Run back | automated | pass | 2026-10-27 |
| [orca-launch-outcome-unknown](scenarios/orca-launch-outcome-unknown.yaml) | orca | worker-start says outcome_unknown: hold, then resume replays the same request | automated | pass | 2026-10-27 |
| [orca-launch-refused](scenarios/orca-launch-refused.yaml) | orca | Orca refuses a worker-start with a typed error: requeue, no try spent, relaunch next step | automated | pass | 2026-10-27 |
| [orca-lost-reply-no-duplicate](scenarios/orca-lost-reply-no-duplicate.yaml) | orca | Orca launched the worker but the reply was lost: no second worker | automated | pass | 2026-10-27 |
| [orca-missing-binary](scenarios/orca-missing-binary.yaml) | orca | Orca is not installed: start refuses cleanly and spends nothing | automated | pass | 2026-10-27 |
| [orca-repo-unknown-registered](scenarios/orca-repo-unknown-registered.yaml) | orca | Orca does not know the repository: repo add, then the launch retries once | automated | pass | 2026-10-27 |
| [orca-slow-reply](scenarios/orca-slow-reply.yaml) | orca | Orca answers slower than the process deadline | automated | pending |  |
| [orca-worker-exited](scenarios/orca-worker-exited.yaml) | orca | Orca reports the worker exited: the task becomes effect_unknown (lost), never silently running | automated | pass | 2026-10-27 |
| [orca-worker-idle-forever](scenarios/orca-worker-idle-forever.yaml) | orca | an Op sits idle past its budget minutes | automated | pending |  |
| [supervisor-idle-after-turn](scenarios/supervisor-idle-after-turn.yaml) | orca | the Supervisor ended its turn with an escalation waiting and its Kernel died: the scheduled tick drives the sweep and nudges it | automated | pass | 2026-10-27 |
| [provider-all-down](scenarios/provider-all-down.yaml) | provider | every provider is down: dispatch holds with a named reason, no launch, no busy loop | automated | pass | 2026-10-27 |
| [provider-auth-revoked](scenarios/provider-auth-revoked.yaml) | provider | a provider's auth is revoked (org disabled): its circuit opens and the router routes around it | automated | pass | 2026-10-27 |
| [provider-launch-failure-strikes](scenarios/provider-launch-failure-strikes.yaml) | provider | repeated launch failures open the provider circuit | automated | pending |  |
| [provider-model-downgraded](scenarios/provider-model-downgraded.yaml) | provider | Orca launches a different model than the router asked for: the worker is closed and the task requeued | automated | pass | 2026-10-27 |
| [provider-quota-until-date](scenarios/provider-quota-until-date.yaml) | provider | a pool is exhausted until a reset date: rerouted, not stalled, until that date | automated | pass | 2026-10-27 |
| [provider-rate-limit](scenarios/provider-rate-limit.yaml) | provider | a provider rate-limits: its pool's concurrency shrinks and new work routes elsewhere | automated | pending |  |
| [change-drop-done-node-reverts](scenarios/change-drop-done-node-reverts.yaml) | change | the change removes a task that already landed | automated | pending |  |
| [change-edit-done-node-reworks](scenarios/change-edit-done-node-reworks.yaml) | change | editing the contract of a done task makes it rework, its independents keep | automated | pass | 2026-10-27 |
| [change-edit-queued-node](scenarios/change-edit-queued-node.yaml) | change | editing a queued task replaces it without spending a try | automated | pass | 2026-10-27 |
| [change-goal-change-mid-run](scenarios/change-goal-change-mid-run.yaml) | change | the owner changes the goal while tasks run | automated | pass | 2026-10-27 |
| [change-noop-retry-early-cutoff](scenarios/change-noop-retry-early-cutoff.yaml) | change | a retry upstream that lands the same result invalidates nothing downstream | automated | pass | 2026-10-27 |
| [change-rapid-successive](scenarios/change-rapid-successive.yaml) | change | two amends built on the same graph version arrive back to back | automated | pending |  |
| [change-reverted-ab-a](scenarios/change-reverted-ab-a.yaml) | change | the owner changes a contract and changes it back before the rework lands | automated | pending |  |
| [change-stale-dependency-kernel-decides](scenarios/change-stale-dependency-kernel-decides.yaml) | change | a dependency lands a different result: dependents become stale, never auto-cancelled | automated | pending |  |
| [change-touches-running-node](scenarios/change-touches-running-node.yaml) | change | the change edits a task while it runs (redo-live) | automated | pending |  |
| [change-while-verify-settling](scenarios/change-while-verify-settling.yaml) | change | an amend arrives while a task's verify is settling | automated | pending |  |
| [kernel-cannot-drop-owner-deliverable](scenarios/kernel-cannot-drop-owner-deliverable.yaml) | change | a Kernel's replan cannot drop a task of the owner's goal; a replacement or the Supervisor's goal-change can | automated | pass | 2026-10-27 |
| [conflict-lease-case-insensitive](scenarios/conflict-lease-case-insensitive.yaml) | conflict | Docs/A.md and docs/a.md are one file on Windows and macOS: one lease | automated | pass | 2026-10-27 |
| [conflict-lease-overlap](scenarios/conflict-lease-overlap.yaml) | conflict | two live tasks over the same path: the second is refused LEASE_CONFLICT | automated | pass | 2026-10-27 |
| [conflict-scope-blocked](scenarios/conflict-scope-blocked.yaml) | conflict | a worker needing a path outside its scope files blocked, never widens | automated | pass | 2026-10-27 |
| [conflict-scope-exceeded-escalates](scenarios/conflict-scope-exceeded-escalates.yaml) | conflict | the Kernel needs a path past its scope ceiling: refused SCOPE_EXCEEDED, escalated (kind scope), widened by the Supervisor | automated | pass | 2026-10-27 |
| [conflict-second-worktree-same-ledger](scenarios/conflict-second-worktree-same-ledger.yaml) | conflict | a linked worktree of the repository sees the same ledger | automated | pass | 2026-10-27 |
| [conflict-split-brain-supervisor](scenarios/conflict-split-brain-supervisor.yaml) | conflict | two Supervisors of one project | automated | pending |  |
| [conflict-two-kernels-one-workflow](scenarios/conflict-two-kernels-one-workflow.yaml) | conflict | two Kernel seats claim the same workflow | automated | pending |  |
| [conflict-two-workflows-same-path](scenarios/conflict-two-workflows-same-path.yaml) | conflict | two workflows in one repository want the same path: the second waits, then runs | automated | pass | 2026-10-27 |
| [worker-claims-done-without-output](scenarios/worker-claims-done-without-output.yaml) | worker | done with no output file is refused | automated | pass | 2026-10-27 |
| [worker-commits-itself](scenarios/worker-commits-itself.yaml) | worker | a worker that commits its own work is caught, not silently credited | automated | pass | 2026-10-27 |
| [worker-deletes-tests](scenarios/worker-deletes-tests.yaml) | worker | a worker deleting a tracked test outside its paths cannot land the deletion | automated | pass | 2026-10-27 |
| [worker-files-twice](scenarios/worker-files-twice.yaml) | worker | a second result for the same attempt is refused | automated | pass | 2026-10-27 |
| [worker-forges-uat-evidence](scenarios/worker-forges-uat-evidence.yaml) | worker | a uat worker files passed with screenshots it never took | automated | pending |  |
| [worker-hallucinated-task-id](scenarios/worker-hallucinated-task-id.yaml) | worker | a result for a task id the ledger never issued is refused | automated | pass | 2026-10-27 |
| [worker-loops-never-files](scenarios/worker-loops-never-files.yaml) | worker | an Op loops and never files a result | automated | pending |  |
| [worker-partial-output-write](scenarios/worker-partial-output-write.yaml) | worker | a truncated output file is refused, not half-recorded | automated | pass | 2026-10-27 |
| [worker-runs-destructive-git](scenarios/worker-runs-destructive-git.yaml) | worker | a worker runs reset --hard, a push or spawns its own sub-agents | manual | pending |  |
| [worker-tampers-contract-copy](scenarios/worker-tampers-contract-copy.yaml) | worker | a worker editing its contract copy changes nothing: the ledger's contract judges | automated | pass | 2026-10-27 |
| [worker-writes-outside-allowpaths](scenarios/worker-writes-outside-allowpaths.yaml) | worker | a worker that also writes outside its allowPaths lands nothing outside them | automated | pass | 2026-10-27 |
| [git-detached-head](scenarios/git-detached-head.yaml) | git | the workflow worktree is on a detached HEAD | automated | pending |  |
| [git-dirty-owner-edit-in-allowpaths](scenarios/git-dirty-owner-edit-in-allowpaths.yaml) | git | the owner has uncommitted edits inside a task's allowPaths when it starts | automated | pending |  |
| [git-head-moved-by-owner](scenarios/git-head-moved-by-owner.yaml) | git | the owner commits in the workflow worktree between result and verify | automated | pass | 2026-10-27 |
| [git-huge-file](scenarios/git-huge-file.yaml) | git | a worker writes a 200 MB file inside allowPaths | automated | pending |  |
| [git-line-endings](scenarios/git-line-endings.yaml) | git | a worker writes CRLF into an LF repository | automated | pending |  |
| [git-merge-conflict-on-rework-apply](scenarios/git-merge-conflict-on-rework-apply.yaml) | git | a rework's prior patch no longer applies to HEAD | automated | pending |  |
| [git-rebase-force-push-by-someone](scenarios/git-rebase-force-push-by-someone.yaml) | git | someone rebases or force-pushes the workflow branch mid-run | manual | pending |  |
| [git-submodule-in-allowpaths](scenarios/git-submodule-in-allowpaths.yaml) | git | allowPaths names a submodule | manual | pending |  |
| [budget-minutes-exhausted](scenarios/budget-minutes-exhausted.yaml) | budget | a workflow that used its minutes holds dispatch with BUDGET_EXHAUSTED | automated | pass | 2026-10-27 |
| [budget-raise-mid-flight](scenarios/budget-raise-mid-flight.yaml) | budget | a budget raise arrives while tasks are live | automated | pending |  |
| [budget-tries-exhausted-then-raised](scenarios/budget-tries-exhausted-then-raised.yaml) | budget | a workflow out of tries holds dispatch until a raise, then resumes | automated | pass | 2026-10-27 |
| [config-change-widens-scope](scenarios/config-change-widens-scope.yaml) | verify | a change to an app-wide configuration file widens the scoped check to every side that reads it | automated | pass | 2026-10-27 |
| [verify-clean-checkout-not-worker-env](scenarios/verify-clean-checkout-not-worker-env.yaml) | verify | a check that passes only in the worker's environment is red on the clean checkout | automated | pass | 2026-10-27 |
| [verify-flaky-test](scenarios/verify-flaky-test.yaml) | verify | a check fails then passes on the same tree | automated | pending |  |
| [verify-only-task-settles-on-observed-evidence](scenarios/verify-only-task-settles-on-observed-evidence.yaml) | verify | a task whose audit finds nothing to change settles green on the checks over its allowPaths, with no commit | automated | pass | 2026-10-27 |
| [verify-probe-target-down](scenarios/verify-probe-target-down.yaml) | verify | a probe check's target is down | automated | pending |  |
| [verify-red-preserves-and-resets](scenarios/verify-red-preserves-and-resets.yaml) | verify | a red verify preserves the work, resets the paths and commits nothing | automated | pass | 2026-10-27 |
| [verify-slow-suite](scenarios/verify-slow-suite.yaml) | verify | a check runs past its deadline | automated | pending |  |
| [messaging-duplicate](scenarios/messaging-duplicate.yaml) | messaging | the same command is delivered twice | automated | pass | 2026-10-27 |
| [messaging-impostor-sender](scenarios/messaging-impostor-sender.yaml) | messaging | a command arrives from a dispatch that is not of this Run | automated | pass | 2026-10-27 |
| [messaging-lost-wake](scenarios/messaging-lost-wake.yaml) | messaging | the wake mail is lost | automated | pass | 2026-10-27 |
| [messaging-mailbox-backlog](scenarios/messaging-mailbox-backlog.yaml) | messaging | a dead Kernel leaves a backlog; the new one processes it exactly once | automated | pass | 2026-10-27 |
| [messaging-op-flood](scenarios/messaging-op-flood.yaml) | messaging | an Op floods its Kernel with mail | automated | pending |  |
| [messaging-out-of-order](scenarios/messaging-out-of-order.yaml) | messaging | commands arrive out of order | automated | pending |  |
| [messaging-question-to-dead-kernel](scenarios/messaging-question-to-dead-kernel.yaml) | messaging | an Op's blocked question reaches a Kernel that died | automated | pending |  |
| [messaging-reply-stale-after-replan](scenarios/messaging-reply-stale-after-replan.yaml) | messaging | an answer to a question made stale by a replan | automated | pending |  |
| [worker-mails-supervisor-directly](scenarios/worker-mails-supervisor-directly.yaml) | messaging | an Op tries to mail the Supervisor or the owner | automated | pending |  |
| [scale-50-ops](scenarios/scale-50-ops.yaml) | scale | fifty Ops under one Kernel: the cap holds, nothing launches twice | automated | pass | 2026-10-27 |
| [scale-fanout-60-inline](scenarios/scale-fanout-60-inline.yaml) | scale | sixty independent tasks: inline queues exactly one at a time | automated | pass | 2026-10-27 |
| [scale-ledger-contention](scenarios/scale-ledger-contention.yaml) | scale | sixteen concurrent read and write verbs on one ledger never fail on a lock | automated | pass | 2026-10-27 |
| [scale-orca-maxparallel](scenarios/scale-orca-maxparallel.yaml) | scale | eight ready orca tasks launch no more than maxParallel seats | automated | pass | 2026-10-27 |
| [scale-ten-workflows](scenarios/scale-ten-workflows.yaml) | scale | ten workflows in one repository with disjoint paths all start | automated | pass | 2026-10-27 |
| [security-allowpaths-escape](scenarios/security-allowpaths-escape.yaml) | security | allowPaths that escape the repository are refused before any lease | automated | pass | 2026-10-27 |
| [security-env-allowpath](scenarios/security-env-allowpath.yaml) | security | a contract leasing .env is refused; the harness never opens it | automated | pass | 2026-10-27 |
| [security-loosening-in-diff](scenarios/security-loosening-in-diff.yaml) | security | a lint suppression written inside allowPaths never lands | automated | pass | 2026-10-27 |
| [security-malicious-postinstall](scenarios/security-malicious-postinstall.yaml) | security | a dependency's postinstall runs during clean verify | manual | pending |  |
| [security-secret-in-diff](scenarios/security-secret-in-diff.yaml) | security | a credential written inside allowPaths never lands in a harness commit | automated | pass | 2026-10-27 |
| [security-secret-in-result-output](scenarios/security-secret-in-result-output.yaml) | security | a worker puts a credential into its result output | automated | pending |  |
| [security-symlink-escape](scenarios/security-symlink-escape.yaml) | security | a worker plants a symlink or junction inside allowPaths pointing outside | manual | pending |  |
| [worker-prompt-injection-in-repo](scenarios/worker-prompt-injection-in-repo.yaml) | security | a repo file tells the worker to exfiltrate secrets and widen its scope | semi | pending |  |
| [time-clock-skew-dst](scenarios/time-clock-skew-dst.yaml) | time | the clock jumps (DST, NTP correction) during a run | manual | pending |  |
| [time-due-lease-never-frees](scenarios/time-due-lease-never-frees.yaml) | time | a lease past its due time still holds its path | automated | pass | 2026-10-27 |
| [time-paused-days-moved-main](scenarios/time-paused-days-moved-main.yaml) | time | a workflow paused for days resumes on a moved main | automated | pending |  |
| [time-sleep-ttl-storm](scenarios/time-sleep-ttl-storm.yaml) | time | a laptop sleep lapses every TTL lease at once | automated | pending |  |
| [crash-disk-full-sqlite](scenarios/crash-disk-full-sqlite.yaml) | resources | the disk fills during a ledger write | manual | pending |  |
| [resources-argv-cap-brief](scenarios/resources-argv-cap-brief.yaml) | resources | a 50 kB brief never crosses the Windows argv cap | automated | pending |  |
| [resources-crlf-workflow-yaml](scenarios/resources-crlf-workflow-yaml.yaml) | resources | a workflow file saved with CRLF line endings defines like LF | automated | pass | 2026-10-27 |
| [resources-disk-full-blob-store](scenarios/resources-disk-full-blob-store.yaml) | resources | disk fills while preserving a patch | manual | pending |  |
| [resources-disk-full-git-object](scenarios/resources-disk-full-git-object.yaml) | resources | the disk fills while the harness writes the task commit | manual | pending |  |
| [resources-file-locked](scenarios/resources-file-locked.yaml) | resources | an antivirus or IDE locks a file during preserve or verify | manual | pending |  |
| [resources-long-path](scenarios/resources-long-path.yaml) | resources | a task path beyond 260 characters is done or refused with a code, never half-committed | automated | pass | 2026-10-27 |
| [resources-too-many-handles](scenarios/resources-too-many-handles.yaml) | resources | the host runs out of handles | manual | pending |  |
| [resources-unicode-path](scenarios/resources-unicode-path.yaml) | resources | a repository under a Vietnamese path with spaces runs end to end | automated | pass | 2026-10-27 |
| [orca-reply-schema-changed](scenarios/orca-reply-schema-changed.yaml) | upgrade | an upgraded Orca answers worker-start in a shape this CLI cannot read | automated | pass | 2026-10-27 |
| [orca-restarted-handles-invalid](scenarios/orca-restarted-handles-invalid.yaml) | upgrade | Orca restarts and every terminal handle and dispatch is unknown to it | semi | pending |  |
| [supervisor-host-adoption](scenarios/supervisor-host-adoption.yaml) | upgrade | a workflow whose Kernel the host Supervisor of a version-2 host store launched is adopted by its project's Supervisor | automated | pass | 2026-10-27 |
| [upgrade-intermediate-ledger-read-verb](scenarios/upgrade-intermediate-ledger-read-verb.yaml) | upgrade | a ledger migrated by an intermediate build opens through a read verb | automated | pass | 2026-10-27 |
| [upgrade-ledger-newer-refused](scenarios/upgrade-ledger-newer-refused.yaml) | upgrade | an older CLI meeting a newer ledger refuses LEDGER_NEWER and never downgrades it | automated | pass | 2026-10-27 |
| [upgrade-migration-while-seats-run](scenarios/upgrade-migration-while-seats-run.yaml) | upgrade | the CLI is upgraded and migrates the ledger while seats run | automated | pending |  |
| [git-branch-deleted](scenarios/git-branch-deleted.yaml) | ledger | the workflow's branch is deleted by hand | manual | pending |  |
| [ledger-deleted-recover](scenarios/ledger-deleted-recover.yaml) | ledger | the project ledger is deleted mid-run | automated | pending |  |
| [ledger-machine-store-corrupt](scenarios/ledger-machine-store-corrupt.yaml) | ledger | a corrupted machine.sqlite is refused with a code, never overwritten | automated | pass | 2026-10-27 |
| [ledger-repo-moved](scenarios/ledger-repo-moved.yaml) | ledger | the repository folder is moved or renamed | automated | pending |  |
| [ledger-wal-huge](scenarios/ledger-wal-huge.yaml) | ledger | the WAL grows huge | manual | pending |  |
| [ledger-worktree-deleted](scenarios/ledger-worktree-deleted.yaml) | ledger | the workflow worktree is deleted by hand | manual | pending |  |
| [model-cmdid-reuse-different-content](scenarios/model-cmdid-reuse-different-content.yaml) | model | a cmdId reused with different content | automated | pending |  |
| [model-compaction-forgets-role](scenarios/model-compaction-forgets-role.yaml) | model | a coordinator's context compaction forgets it is the Kernel | semi | pending |  |
| [model-extremely-slow](scenarios/model-extremely-slow.yaml) | model | a model takes an hour per step | semi | pending |  |
| [model-poison-command](scenarios/model-poison-command.yaml) | model | the same invalid command is submitted again and again | automated | pass | 2026-10-27 |
| [model-worker-role-cannot-overstep](scenarios/model-worker-role-cannot-overstep.yaml) | model | a process running as worker cannot amend, raise budgets, stop or push | automated | pass | 2026-10-27 |
| [worker-mismatch-no-try-spent](scenarios/worker-mismatch-no-try-spent.yaml) | model | the model refuses the task as specified: mismatch returns it without spending a try | automated | pass | 2026-10-27 |
| [budget-task-always-over](scenarios/budget-task-always-over.yaml) | plan | a task blows its budget every try | automated | pending |  |
| [flow-incomplete-refused](scenarios/flow-incomplete-refused.yaml) | plan | a replan that adds back-end code without the rest of its lane is refused and the graph stays as it was | automated | pass | 2026-10-27 |
| [lane-be-needs-test-e2e-review](scenarios/lane-be-needs-test-e2e-review.yaml) | plan | back-end code is tested, proven end to end and reviewed before the plan is recorded | automated | pass | 2026-10-27 |
| [lane-fe-code-held-until-be-code](scenarios/lane-fe-code-held-until-be-code.yaml) | plan | front-end code of a feature waits for the back end's code of the same feature | automated | pass | 2026-10-27 |
| [lane-fe-code-held-until-ui](scenarios/lane-fe-code-held-until-ui.yaml) | plan | front-end code waits for its feature's screens to be drawn | automated | pass | 2026-10-27 |
| [lane-ui-already-drawn-skips](scenarios/lane-ui-already-drawn-skips.yaml) | plan | a screen the owner already drew is not drawn again; its front end is built, audited and walked | automated | pass | 2026-10-27 |
| [lane-ui-draw-then-image](scenarios/lane-ui-draw-then-image.yaml) | plan | a screen not yet drawn walks its ui lane, draw then image, before define records the graph | automated | pass | 2026-10-27 |
| [plan-code-split-per-record](scenarios/plan-code-split-per-record.yaml) | plan | one code task over several impl records is refused; one task per record fans out in parallel | automated | pass | 2026-10-27 |
| [plan-replan-oscillation](scenarios/plan-replan-oscillation.yaml) | plan | the Kernel replans A, B, A, B | automated | pending |  |
| [plan-self-overlap-serialised](scenarios/plan-self-overlap-serialised.yaml) | plan | the Kernel plans two independent tasks over one path: the lease serialises them | automated | pass | 2026-10-27 |
| [plan-unachievable-goal](scenarios/plan-unachievable-goal.yaml) | plan | the goal cannot be met | automated | pending |  |
| [plan-wrong-dependency-order](scenarios/plan-wrong-dependency-order.yaml) | plan | the Kernel forgets a dependency | semi | pending |  |
| [route-audit-drift-repairs-code](scenarios/route-audit-drift-repairs-code.yaml) | plan | an audit that finds drift is repaired by code, never re-run at the same head | automated | pass | 2026-10-27 |
| [route-limit-escalates](scenarios/route-limit-escalates.yaml) | plan | past a route's limit the Kernel may not repair again; it escalates to the owner through the Supervisor | automated | pass | 2026-10-27 |
| [environment-keycloak-down-uat](scenarios/environment-keycloak-down-uat.yaml) | environment | an external dependency is down during uat | semi | pending |  |
| [environment-lockfile-drift](scenarios/environment-lockfile-drift.yaml) | environment | the lockfile drifts from package.json | automated | pending |  |
| [environment-npm-registry-down](scenarios/environment-npm-registry-down.yaml) | environment | the npm registry is down during clean verify | manual | pending |  |
| [environment-port-taken](scenarios/environment-port-taken.yaml) | environment | the dev server's port is taken during uat | manual | pending |  |
| [environment-secret-unavailable](scenarios/environment-secret-unavailable.yaml) | environment | a test needs a secret the host lacks | manual | pending |  |
| [host-status-and-install-dry](scenarios/host-status-and-install-dry.yaml) | environment | host status reads every service of ops/host.yaml; install --dry prints the scheduler argv and writes nothing | automated | pass | 2026-10-27 |
| [verify-docker-down-uat](scenarios/verify-docker-down-uat.yaml) | environment | Docker is down when a uat verify needs the pinned image | semi | pending |  |
| [owner-cancels-during-settle](scenarios/owner-cancels-during-settle.yaml) | owner | the owner cancels a task while its verify settles | automated | pending |  |
| [owner-late-gate-approval](scenarios/owner-late-gate-approval.yaml) | owner | the owner approves a gated diff long after it was asked | automated | pending |  |
| [owner-pause-holds-dispatch](scenarios/owner-pause-holds-dispatch.yaml) | owner | pause holds new dispatch while the live task still settles | automated | pass | 2026-10-27 |
| [owner-stop-hard-closes-seats](scenarios/owner-stop-hard-closes-seats.yaml) | owner | owner stops a running orca workflow hard: tasks cancelled, seats and Kernel closed | automated | pass | 2026-10-27 |
| [owner-two-sessions-goal-change](scenarios/owner-two-sessions-goal-change.yaml) | owner | two sessions send conflicting goal-changes | automated | pass | 2026-10-27 |
| [release-ci-red-after-push](scenarios/release-ci-red-after-push.yaml) | release | CI turns red after a push | semi | pending |  |
| [release-push-non-fast-forward](scenarios/release-push-non-fast-forward.yaml) | release | release push refuses a non fast-forward and moves nothing | automated | pass | 2026-10-27 |
| [release-repeated-red-ci](scenarios/release-repeated-red-ci.yaml) | release | CI stays red after the fix attempt | semi | pending |  |
| [release-secret-blocks-push](scenarios/release-secret-blocks-push.yaml) | release | a secret in the pushed range blocks release push | automated | pass | 2026-10-27 |
| [cost-reset-date-reroute](scenarios/cost-reset-date-reroute.yaml) | cost | a pool exhausted until a date: forecast and reroute | automated | pending |  |
| [cost-runaway-token-loop](scenarios/cost-runaway-token-loop.yaml) | cost | a worker loops spending tokens without progress | semi | pending |  |
| [cost-task-burns-pool-quota](scenarios/cost-task-burns-pool-quota.yaml) | cost | one task burns the pool's quota | automated | pending |  |
<!-- scoreboard:end -->
