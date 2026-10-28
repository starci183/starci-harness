# Define a workflow

You are the Kernel for this goal (an orca workflow's `[Kernel]` seat, given the goal by its Supervisor, or the chat
under the inline runner). You write the contracts and the workflow file; the harness validates and records them and
never invents a task. Nothing is queued before the owner's OK.

## 1. Pin the goal

Resolve the product repository, the goal, its scope and the expected outcome. When any is unclear, scan
(step 2) and ask. Never shrink or reword the owner's goal to fit a plan.

## 2. Read-only context scan

Run only read verbs and read files; write nothing:

```text
starci doctor
starci workflow list
starci task status
starci app info
```

`app info` answers in a lite app only. Then read the app's `hfs.json` and its `.starciwork/` (specs,
architecture, `features/<f>`) and the code the goal touches. Fold what you find into the goal and the tasks.

## 3. Draft the tasks

Split the goal into tasks, one outcome each. Per task decide:

- `label`: one of the op files of `ops/ops/` (code, test, draw, image, audit, review, verify, uat, docs, deliver). Its op
  gives the base context, inputs, output keys and checks, and the difficulty floor; the task only extends them. Every Work
  record a task is over walks its lane ([ops/lanes.yaml](../../../ops/lanes.yaml)): plan a task for each step its evidence
  does not satisfy yet, each behind the step before it, or define refuses `FLOW_INCOMPLETE` and names the missing step.
- `allowPaths`: literal files or folders, never a glob, never `.` and never the whole `.starciwork`. Inside
  `.starciwork` lease one scope, for example `.starciwork/features/<f>`.
- `checks`: presets from `ops/checks.yaml`. At least one behavioural check (`tests-pass`, `json-required`,
  `result-json`, `probe`, `ci-green` or a command) for every label that requires it. What a task, the
  merged batch and CI each run is [contexts/authority/](../../../contexts/authority/README.md); never ask a task for a suite.
- `dependsOn`: only real order. Overlapping `allowPaths` without an order are allowed; the lease serializes them.
- `difficulty`, and `risk` when the work carries one of the risks `qualification.riskTags` of
  [ops/routing.yaml](../../../ops/routing.yaml) names: a risk-tagged task refuses a member still on probation for its
  label. Nothing in a workflow file names an agent or a model; the router alone picks.

For a contract you want as its own file, write it and judge it:

```text
starci contract new --label <label> --summary "<one sentence>" --allow <p1,p2> --check "<preset>:<arg>=<v>;<preset>" --out <file>
starci contract check <file>
```

`contract new` says what still keeps a contract unfit. Fix the contract, not the check.

## 4. Write the workflow file

Keep it outside the product repository, in the project's state folder that `contract new` prints
(`<runtime root>/.runtime/projects/<ledger_id>/`), for example `workflows/<id>.yaml`. Shape
(`starci/workflow@1`, yaml or json):

```yaml
schema: starci/workflow@1
id: <lower-case-key>
goal: <the owner's goal, enriched by the scan>
runner: orca            # or inline; never chosen by edition
maxParallel: 4          # orca only, optional: fewer than workflowParallel of ops/routing.yaml (the default), never more
tasks:
  - id: <key>
    label: <label>
    summary: <one sentence>
    allowPaths: [<path>]
    checks: [<preset or {preset, args}>]
    dependsOn: [<key>]
  - id: <key>
    contract: <contract file, relative to this file>
```

Optional header fields: `worktree`, `base`. Optional task fields: `details`, `context` (files to read beyond the op's
base), `inputs`, `output`, `cwd`, `budget`, `difficulty`, `risk`.

For orca tasks, show who the router would pick:

```text
starci route explain --label <label> --difficulty <d> [--risk <tag,...>]
```

## 5. Present and get the OK

Show the owner the whole file: goal, runner, each task with label, summary, allowPaths, checks and
dependencies, any difficulty or risk, and say whether you will also start it. Wait for an explicit OK on this exact
file. Any material edit needs a new OK.

## 6. Define

```text
starci workflow define <file>
starci plan show <id>
```

`define` refuses an unfit contract, an unknown dependency or a cycle; fix the file and define again (an id
already defined is changed with an amend, see [run-workflow.md](run-workflow.md)). Report the workflow id,
graph version, node hashes and budget it printed. Start it only under an OK that covers starting.
