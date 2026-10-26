# Roles

The Kernel never reads a worker's terminal: it sends work as a contract (context, input, output and checks: its op's base plus its own extend) and judges
the result with `starci task verify`. A role's rights come from each verb's `effect` and `roles`
([cli/README.md](../../cli/README.md) "The verb standard" says when they are enforced).

| role | job | never | escalates to |
|---|---|---|---|
| worker (an Orca seat, or the inline chat agent) | one task, until its output passes the contract's checks (base ∪ extend), writing only its `allowPaths` | commit, push, merge into main, change its contract, ask the owner | Kernel: `blocked` or `mismatch` |
| Kernel, one per workflow | plan (analyze the request, bound the scope, write every contract and the workflow file), make provisional business and architecture choices, send, step, verify, amend, and finish with a handover for owner acceptance | write product code under the `orca` runner, read a worker's terminal, push main | Supervisor: a task beyond a worker |
| Supervisor, one per host (seat not built yet) | the owner channel, tasks beyond a worker, owner asks (credentials, accounts), host and runtime operation, scope amends, landing on main with `release push`, turning a red CI into a scoped `code` contract | write product code, bend a gate, publish without the owner | Owner |
| Debug (seat not built yet) | diagnose a harness or environment failure, read-only, never task content | edit code, change rules, run a writing verb | Supervisor: the diagnosis and a repair contract |
| Owner | taste and UX acceptance, decisions, approval of public actions | | |
