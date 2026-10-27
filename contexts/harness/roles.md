# Roles

The owner talks to each project's `[Supervisor] <project>`, which runs in the project's main checkout; each running orca
workflow of the project has a `[Kernel] <workflow>` under it, and each task attempt an `[Op] <label> (<task id>) - <summary>` under its Kernel, all real Orca agents. Coordinators loop: `kernel next` and
`supervisor next` do the mechanics and hand them one decision, which they answer with one command (`kernel submit`,
`supervisor submit`), never ending their turn while the driver is theirs (`supervisor tick` nudges one that does, then
relaunches it on another model); [cli/README.md](../../cli/README.md) "Seats as a tree" owns the verbs. Inline workflows use the chat
agent as Kernel and worker without Orca seats. A role's rights come from each verb's `effect` and `roles` (cli/README.md
"The verb standard" says when they are enforced).

| role | job | never | escalates to |
|---|---|---|---|
| worker (an Op seat, or the inline chat agent) | one task, until its output passes the contract's checks (base ∪ extend), writing only its `allowPaths` | commit, push, merge into main, change its contract, ask the owner, wait on a blocking ask | Kernel: a `blocked` or `mismatch` result |
| Kernel, a seat per orca workflow | plan (analyze the request, bound the scope, write every contract and the workflow file), make provisional business and architecture choices, answer each `kernel next` decision with a `workflow-change` within the budget, and finish with a `handoff` | write product code under the `orca` runner, shrink the owner's goal (drop a task the goal's graph holds that no new task takes over), read a worker's terminal, push main, mail the owner | Supervisor: an `escalation` (budget, scope, conflict, owner, harness) |
| Supervisor, a seat per project ([state.md](state.md) "How a project is found") | the owner channel for its project's workflows: turn an owner request into a workflow and its `goal`, answer escalations (path ownership, scope, budget) with a `goal-change` or `stop`, owner asks (credentials, accounts), host and runtime operation, landing on main with `release push` after a green scoped check, turning a red CI into a scoped `code` contract | write product code, bend a gate, publish without the owner | Owner |
| Debug, the chat agent outside Orca | diagnose a harness or environment failure, never task content; its one writing verb is `config set`, a harness setting | edit code, change rules, run any other writing verb | Supervisor: the diagnosis and a repair contract |
| Owner | taste and UX acceptance, decisions, approval of public actions | | |

An Op mails only its Kernel, a Kernel only its project's Supervisor (and its own Ops), a Supervisor only the owner. Mail only
wakes; the ledger holds every command and decision. The procedures live in [the Op procedure](../../ops/ops/README.md),
[the Kernel brief](../../ops/coordinators/kernel.md) and [the Supervisor brief](../../ops/coordinators/supervisor.md). The
Kernel never reads an Op terminal: it sends a contract and the harness judges the filed result with `starci task verify`.
