# ops/

The data the harness reads to give a task its base, check its result, route it and watch its seat. Every file is
validated by the CLI when it is read; a key no code reads is deleted.

| file | holds | read by |
|---|---|---|
| [ops/ops/README.md](ops/README.md) | the op pattern (base and extend) and the worker procedure every brief starts with | `cli/src/harness/ops.ts`, `brief.ts` |
| `ops/ops/<label>.md` | one op per label (`code`, `test`, `ui`, `verify`, `uat`, `docs`, `deliver`): base context, inputs, output keys and checks, the difficulty floor, the host tools and the label's procedure | `ops.ts`, `contract.ts`, `brief.ts`, the router |
| [checks.yaml](checks.yaml) | the check presets an op or a contract names, each expanding into one primitive check | `contract.ts`, `run-checks.ts` |
| [routing.yaml](routing.yaml) | tiers, pools, host probes, balance, quota, usage, the provider circuit and its probe, failure signals, outcomes, qualification, scoring, pool concurrency, workflow budgets: every number of the router | `router.ts`, `circuit.ts`, `usage.ts`, `outcomes.ts`, `pools.ts`, `budget.ts` |
| [liveness.yaml](liveness.yaml) | seat liveness thresholds and Orca's words for a gone worker (the `orca` runner) | `liveness.ts` |
| [uat.yaml](uat.yaml) | the pinned Playwright image and the bounds of one `starci uat run` | `uat.ts` |

A label's floor and host tools live in its op file and nowhere else. The prose below explains how the router and the
failure accounting use the numbers of `routing.yaml`; it never restates them.

## The router

The router alone picks every Op and Kernel: no workflow or task names an agent, a model or a preference, and a task gives it
only its label, difficulty and `risk` tags. `starci route explain` prints every step for a label, a difficulty and risk
tags (`--simulate <n>` tallies a run of picks); `cli/src/harness/router.ts` implements them.

0. **Signals.** A recorded pick first reads Orca's account usage when the last reading is older than `usage.refreshMinutes`
   (`harness/usage.ts`: every window of `usage.windows` per pool, the most-used one as the pool's quota with its reset; an
   ok reading closes a circuit opened for auth, or for quota with headroom) and records every ended attempt of every
   registered ledger per member and label (`harness/outcomes.ts`: green or red verdict, timeout, lost, launch failure,
   mismatch, minutes). `starci provider sync` does both at once; `provider report` records one outcome or reading by hand.
1. **Tier.** `labelTiers[label]` when the label is named there, else `difficultyTier` of the higher of the task's
   difficulty and the label's floor. A lineage that reaches `escalateAfterReds` contract-red attempts moves one step up
   `tierOrder`; an infrastructure failure keeps the tier.
2. **Hard filter.** A member of the tier is dropped when its pool does not take the label, when a host tool the label
   needs has a probe that fails on this host, when this task's lineage has two contract-red attempts on its pool, when
   its provider's circuit is open and its probe is not due (or already in flight), or when its pool is at its cap
   (`maxParallel`, lowered by the pool's concurrency backoff). A task whose `risk` names one of `qualification.riskTags`
   also drops a member below `qualification.riskMinimum` for the label, and never probes; when that alone empties the
   tier, the task looks one tier up (`ROUTE_UNQUALIFIED` at the top).
3. **Quota.** A member at `exhaustedPercent` of its binding window is dropped until that window resets; one at
   `reservePercent` only while a member below it is left. No reading, a stale one or one past its reset is unknown and kept.
4. **Lineage.** One contract-red attempt of this task on a pool puts that member behind every other.
5. **Probe.** A provider whose circuit is half-open (`circuit`: its cooldown ended, or its probe interval passed) takes this
   pick as its one probe; the probe is marked in flight until its launch reports, and a success closes the circuit.
6. **Score.** Every member left is ordered by expected success over expected cost: the Beta posterior mean of its green
   rate for the label (`scoring.prior` plus its verdicts; timeouts and lost workers count against it) over its mean
   minutes on the label (over `scoring.costMinutes`), times `1 + paceWeight` per unit its quota burns ahead of its
   window's clock. With probability `exploreSharePercent`, and only while explore picks hold less than that share of the
   tier's recent picks, the order uses a Thompson sample instead of the mean.
7. **Balance.** The scored head picked `maxStreak` times in a row, or holding more than `maxSharePercent` of its tier's
   running seats, yields to the next.
8. **Pick.** The head is chosen, by `probe`, `score`, `explore` or `balance`. The pick record (the chain after each step,
   every dropped member with its reason, the scores, the exploration roll, the probe) is stored on the attempt, and
   dispatch reuses it.

Qualification is earned per member and label from the verdicts of the last `outcomes.windowDays`: `qualification.high`
and `.standard` name the verdicts and green share each needs, a member of a `startStandard` tier is standard until its
verdicts say otherwise, and anything else is probation. A label that reviews another task's work does not exist (the
contract's machine checks are the review), so no step prefers a provider other than the author's.

## Failures and their accounting

| class | what happens | bound |
|---|---|---|
| provider-unavailable (rate, quota, capacity, auth) | the provider's circuit opens for its kind (`circuit`), the task is re-picked on another pool; no try is spent; the circuit closes on its own through its half-open probe or an ok usage reading | the circuit's cooldowns and probe backoff |
| worker-lost | Orca's explicit word that the worker is gone makes the seat `worker-lost` and the task `effect_unknown`; it is cancelled and retried on another pool | 2, then the Supervisor |
| worker-hung | Orca answers but the worker printed nothing for `activeStaleMinutes`; handled as worker-lost | 2, then the Supervisor |
| contract-red | `task verify` is red; the next attempt carries the red checks and goes to another member | 2, then the Kernel replans |
| mismatch | the worker shows the contract is wrong; the Kernel rewrites it, and no try is spent | 1, then the Supervisor |
| blocked | `env` goes to the Supervisor, `authority` to the owner, a `gap` to the Kernel's plan | |

- A failure with no effect is free: a launch that certainly failed returns its task to `queued`, and a verify that
  reached no verdict returns it to `reported` (`TRANSITIONS` in `cli/src/harness/tasks.ts`).
- An unknown effect costs a try and is reconciled before the retry.
- `awaiting_owner` costs nothing.
- A task's tries are its contract's `budget.tries`; a workflow's minutes and tries are capped by `budgets` and raised only
  by the owner or the Supervisor (`starci budget raise`).
