# ops/

The data the harness reads to give a task its base, check its result, route it and watch its seat. Every file is
validated by the CLI when it is read; a key no code reads is deleted.

| file | holds | read by |
|---|---|---|
| [ops/ops/README.md](ops/README.md) | the op pattern (base and extend) and the worker procedure every brief starts with | `cli/src/harness/ops.ts`, `brief.ts` |
| `ops/ops/<label>.md` | one op per label (`code`, `test`, `ui`, `verify`, `uat`, `docs`, `deliver`): base context, inputs, output keys and checks, the difficulty floor, the host tools and the label's procedure | `ops.ts`, `contract.ts`, `brief.ts`, the router |
| [checks.yaml](checks.yaml) | the check presets an op or a contract names, each expanding into one primitive check | `contract.ts`, `run-checks.ts` |
| [routing.yaml](routing.yaml) | tiers and their chains, pools, host probes, balance, quota, the provider circuit, failure signals, pool concurrency, workflow budgets: every number of the router | `router.ts`, `circuit.ts`, `pools.ts`, `budget.ts` |
| [liveness.yaml](liveness.yaml) | seat liveness thresholds and Orca's words for a gone worker (the `orca` runner) | `liveness.ts` |
| [uat.yaml](uat.yaml) | the pinned Playwright image and the bounds of one `starci uat run` | `uat.ts` |

A label's floor and host tools live in its op file and nowhere else. The prose below explains how the router and the
failure accounting use the numbers of `routing.yaml`; it never restates them.

## The router

`starci route explain` prints every step for a label and a difficulty; `cli/src/harness/router.ts` implements them.

1. **Tier.** `labelTiers[label]` when the label is named there, else `difficultyTier` of the higher of the task's
   difficulty and the label's floor. A lineage that reaches `escalateAfterReds` contract-red attempts moves one step up
   `tierOrder`; an infrastructure failure keeps the tier.
2. **Hard filter.** A member of the tier's chain is dropped when its pool does not take the label, when a host tool the
   label needs has a probe that fails on this host, when this task's lineage excluded its pool, when its provider's
   circuit is open, or when its pool is at its cap (`maxParallel`, lowered by the pool's concurrency backoff).
3. **Lineage.** One contract-red attempt of this task on a pool demotes that pool to the back of the chain; two exclude
   it, so a retry goes to another member.
4. **Bias.** The workflow's `only` keeps, `avoid` removes and `prefer` moves to the front. A bias that empties the chain
   is a refusal (`ROUTE_BIAS_EMPTY`), never a silent fallback.
5. **Balance and quota.** Without an active bias a member picked `maxStreak` times in a row, or holding more than
   `maxSharePercent` of its tier's running seats, yields to the next. A member at `reservePercent` of its quota window is
   skipped, a biased one may go to `biasPercent`, and none is used at `exhaustedPercent`.
6. **Pick.** The first member left is chosen. The pick record (the chain after each step, every dropped member with
   its reason, the chosen member) is stored on the attempt, and dispatch reuses it.

## Failures and their accounting

| class | what happens | bound |
|---|---|---|
| provider-unavailable (rate, quota, capacity, auth) | the provider's circuit opens for its kind (`circuit`), the task is re-picked on another pool; no try is spent | the circuit's cooldowns |
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
