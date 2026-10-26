# Routing, providers and budgets

Every tunable lives once in [ops/routing.yaml](../../../ops/routing.yaml); read it, never restate it.

## Who will run a task

```text
starci route explain --label <label> --difficulty <easy|medium|hard|insane>
```

It dry-runs the router and records nothing: the tier and why, the chain of `{agent, model, effort}`, each
filter (host tools, lineage, bias, balance, quota) with every dropped member and its reason, and the chosen
member. Add `--attempt <n>` and `--red <agent/model,...>` to see a retry (a second contract-red raises the
tier one step), and `--only`, `--avoid` or `--prefer <a,...>` to see an owner bias.

A bias that empties the chain is refused (`ROUTE_BIAS_EMPTY`), never dropped silently. To make it stick,
put `bias` or an `agent` plus `model` pin in the workflow file; only on the owner's word.

## Provider health

```text
starci provider status
```

Per provider: the circuit (healthy or open until when), strikes, each pool's concurrency cap against its
maximum, running workers and the quota window. No quota reading means unknown, never blocked.

```text
starci provider report <provider> --outcome <success|unknown|rate|quota|capacity|auth|launch> --detail "<typed error>"
starci provider report <provider> --quota <percent> --pool <pool> --resets-at <iso-time>
```

Report what a worker's result or an account poll taught; `seat start` records its own launch outcomes. An
unknown outcome is never a failure.

```text
starci provider recover <provider> --by owner --reason "<the probe that passed>"
```

Close a circuit only after a passing probe and with the owner's OK. Never recover a provider to get past
an auth or quota error the owner has not fixed.

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
