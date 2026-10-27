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

Until `registry.ts` lists the two verbs, run them through their entry: `node cli/dist/core/bench/entry.js run --all`.

`bench run` gives every scenario its own folder under `<state base>/bench/<run>` with a scratch git repository, an
isolated `STARCI_LOCAL_ROOT` and the Orca stand-in, runs the scenario's steps with the built CLI, asserts each
expectation, and writes `result.json` there and a line in `<state base>/bench/results.jsonl`. It writes nothing tracked;
`--record` rewrites the scoreboard table below and nothing else. Exit 1 when a scenario ran red.

- **Scenario files** are `scenarios/<id>.yaml` (`starci/scenario@1`, validated by `cli/src/core/bench/scenario.ts`): the
  group, what is injected, the expected behaviour, the pass criteria, the automation status (`automated`, `semi` when it
  needs a live Orca, `manual`), and either the steps the runner executes or, while it waits for verbs or a person, the
  `pending` reason with the exact `manual` steps.
- **Steps** call a verb (`starci`, with `expect`, `save` and `parallel`), write files (`file`, `write`), act as a worker
  (`worker` writes its files and files its result), run git, script the Orca stand-in (`orca`), inject a fault straight
  into a ledger (`sql`, the state a killed process leaves behind), and `assert` on the ledger, git, the stand-in's call log
  or the file system. `when` and `unless` tie a step to a `--fault`.
- **The Orca stand-in** is `stub/orca-stub.mjs`: the runner copies this node binary to `<state base>/bench/bin/orca` and
  points `STARCI_ORCA_BIN` at it, and the stub, preloaded into it, answers the orca CLI subset the harness calls
  (worker-start, show, stop, release; run-create, run-use; task-create; terminal create, list, close, rename; repo add;
  check, send), dedupes by retry-request like Orca, logs every call, and replays the faults a scenario scripts (refuse,
  outcome unknown, lost reply, slow, garbage, a changed reply shape, a worker that exited). No real Orca is ever launched.
- **Fixtures that must not be text in this public repository** (a provider-shaped key, an inline lint suppression) are
  built by the runner at run time (`write.generated`).

A `FAIL` on main is a finding against the harness, not against the bench: the scenario states the behaviour the owner's
design asks for.

## Scoreboard

<!-- scoreboard:start -->
<!-- scoreboard:end -->
