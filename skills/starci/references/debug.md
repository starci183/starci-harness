# Debug a stuck workflow

Find the lowest thing that is stuck, read its evidence, and act through the verbs. The ledger is the truth;
never open `runtime.sqlite` by hand and never read or type into a worker's terminal.

## Look, in this order

```text
starci workflow status <id>
starci task status --workflow <id>
starci task status <task>
starci seat list --live
starci provider status
starci budget show <id>
```

`workflow status` gives the reason and each task's state and wait. `task status <task>` gives attempts,
the filed result, its Op worktree, check runs and preserved work. `seat list --live` asks Orca for each open seat.

## What each state means

| Seen | Cause | Do |
| --- | --- | --- |
| `effect_unknown` | Orca could not confirm or deny a launch; the task keeps its worktree and seat | `starci seat start <task> --resume` replays the same request; never send a second task |
| `verifying` that never ends, `VERIFY_LIVE` | a verifier is running, or died | the next `workflow step` recovers it once no verifier holds the settle lock; `starci task verify <task> --recover` does the same by hand |
| `HEAD_MOVED`, `SETTLE_BUSY` | the branch moved or another settle runs | no try spent: step or verify again |
| `LAND_CONFLICT`, attempt outcome `conflict` | the task's verified work does not rebase onto the branch's new head; its work is preserved | the Kernel retries the node by an amend, which starts from the preserved work on the new head; never resolve it by hand in the harness |
| `running` with no result | the worker is working or lost | `starci seat ping <seat>`; `seat list` shows live, stale, quiet, unknown or lost. Unknown is never dead |
| seat `worker-lost`, node `lost` | Orca reported the worker gone; the task is `effect_unknown` and keeps its worktree | `starci task cancel <task> --reason "<why>"`, then retry by an amend |
| a dispatch refused (`ROUTE_NO_MEMBER`, `POOLS_FULL`, `PROVIDERS_UNAVAILABLE`, `TOKENS_OUT`) | no member can take it now | the task stays queued and the next step routes it again; read `route explain` and `provider status` |
| a circuit open | a provider failed (rate, quota, capacity, auth) | wait for the cooldown; recover only after a passing probe and the owner's OK |
| seat failure `blocked-prompt`, `BLOCKED PROMPT` in `supervisor tick` | the agent waits at a dialog in its worktree (trust, external import, login, a confirmation); the provider is not at fault | read the screen `seat list` prints, answer or remove the prompt in that worktree's agent config, then answer the harness escalation |
| `BUDGET_EXHAUSTED`, `TRIES_EXHAUSTED` | a ceiling is reached | ask the owner |
| `failed` after a red verify | the checks are red; work is under `preserved/<task>` | read the red checks, then retry or fix the contract by an amend |
| `returned` | the worker filed `blocked` or `mismatch` | supply what is missing, or fix the contract by an amend |
| `ORCA_MISSING` | no Orca on this host | Orca is opened by the owner; an inline run needs none |

Amend, retry and stop are in [run-workflow.md](run-workflow.md); routing and budgets in
[routing-and-providers.md](routing-and-providers.md).

## Hard rules

- Never `git stash`, `git reset --hard`, force-push, `--no-verify`, or switch the branch of a checkout you do
  not own. Preserved work lives under the state folder; read it, never delete it.
- Never read secret or env files, enter a credential or print a token. What only the owner can do (a
  login, a key, a spend) is reported once with the exact action.
- Never loosen a gate: no inline disable, ts escape, skipped test, `|| true`, gate-widening allowlist or
  policy exception to turn a check green. Change the code or the contract, not the gate.
- Never edit a ledger, a brief or a filed result by hand, and never settle a task as someone else.
- A harness defect (the CLI did the wrong thing) is reported with the command, its output and the ledger
  evidence; fix it in the runtime root on its own branch, not by working around it in a product.
