# Routing, providers and budgets

Every tunable lives once in [ops/routing.yaml](../../../ops/routing.yaml); read it, never restate it.

## Who will run a task

```text
starci route explain --label <label> --difficulty <easy|medium|hard|insane> [--risk <tag,...>]
```

The router alone picks; no file or person steers it. `route explain` dry-runs it and records nothing:
the tier and why, each step (hard filter with qualification, quota, lineage, probe, score, balance) with every
dropped member and its reason, every member's score, the exploration roll, the probe decision and the chosen
member ([ops/README.md](../../../ops/README.md) "The router" owns the steps). Add `--attempt <n>` and
`--red <agent/model,...>` to see a retry (a second contract-red raises the tier one step), and `--simulate <n>`
to see how a run of picks spreads.

## Provider health

```text
starci provider status
starci provider sync
```

`status`: per provider, the circuit (healthy, striking, open until its next probe, half-open), each pool's
concurrency cap against its maximum, running workers and the quota of its binding window. No quota reading
means unknown, never blocked. `sync` reads Orca's account usage now and the ledgers' ended attempts; a recorded
pick does both on its own, so run it only to look.

```text
starci provider report <provider> --outcome <success|unknown|rate|quota|capacity|auth|launch> --detail "<typed error>"
starci provider report <provider> --quota <percent> --pool <pool> --resets-at <iso-time>
```

Report what a worker's result or a provider's own usage page taught when Orca does not expose it; `seat start`
records its own launch outcomes. An unknown outcome is never a failure.

A circuit recovers by itself: once its probe is due the next pick sends that provider one launch, and its
success closes the circuit (an ok usage reading closes an auth circuit too). `provider recover` is the
Supervisor's record of a probe it ran itself; it is never needed in normal operation.

## Budgets

```text
starci budget show
starci budget show <workflow>
starci budget raise <workflow> --minutes <n> --by owner --reason "<why>"
starci budget raise <workflow> --tries <n> --by owner --reason "<why>"
```

A workflow spends minutes and tries against its ceiling; a launch that never ran spends no try. At the
ceiling, dispatch holds with `BUDGET_EXHAUSTED`. Raise only on the owner's explicit OK with their reason.
A task's own tries stay its contract's `budget.tries`; `TRIES_EXHAUSTED` is the owner's call as well.
