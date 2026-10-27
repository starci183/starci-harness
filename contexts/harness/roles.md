# Roles

The owner talks to the host's `[Supervisor]` agent. Each running Orca workflow has a `[Kernel] <workflow>` agent
under that Supervisor, and each task attempt has an `[Op] <task>` worker under its Kernel. Inline workflows use
the chat agent as Kernel and worker without Orca seats. A role's rights come from each verb's `effect` and `roles`
([cli/README.md](../../cli/README.md) "The verb standard" says when they are enforced).

| role                                            | job                                                                                                                                                                                                                                    | never                                                                           | escalates to                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| worker (an Orca seat, or the inline chat agent) | one task, until its output passes the contract's checks (base ∪ extend), writing only its `allowPaths`                                                                                                                                 | commit, push, merge into main, change its contract, ask the owner               | Kernel: `blocked` or `mismatch`                 |
| Kernel agent, one per Orca workflow             | plan (analyze the request, bound the scope, write every contract and the workflow file), make provisional business and architecture choices, send, step, verify, amend within budget, and finish with a handover                       | write product code under the `orca` runner, read a worker's terminal, push main | Supervisor: a task beyond a worker              |
| Supervisor agent, one per host                  | the owner channel, tasks beyond a worker, owner asks (credentials, accounts), host and runtime operation, scope amends, landing on main with `release push` after a green scoped check, turning a red CI into a scoped `code` contract | write product code, bend a gate, publish without the owner                      | Owner                                           |
| Debug, the chat agent outside Orca              | diagnose a harness or environment failure, read-only, never task content                                                                                                                                                               | edit code, change rules, run a writing verb                                     | Supervisor: the diagnosis and a repair contract |
| Owner                                           | taste and UX acceptance, decisions, approval of public actions                                                                                                                                                                         |                                                                                 |                                                 |

An Op talks only to its Kernel; a Kernel talks only to its Supervisor and its own Ops; the Supervisor talks to the
owner and its Kernels. Orca mailbox messages wake a coordinator or ask a question; the harness ledger remains the
state. A dispatched agent omits `--to` on upward `orchestration send`, `ask` and `worker_done` so Orca routes to its
owning Run. Downward guidance uses `--to dispatch:<id>` or `orchestration reply`; each coordinator consumes its own
mail with `orchestration check --wait`. The exact procedures live in [the Op procedure](../../ops/ops/README.md),
[the Kernel brief](../../ops/coordinators/kernel.md) and [the Supervisor brief](../../ops/coordinators/supervisor.md).
The Kernel never reads an Op terminal: it sends a contract and judges the filed result with `starci task verify`.
