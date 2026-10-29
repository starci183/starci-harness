# Op files: one per label, base and extend

Every worker task has a label (`code`, `test`, `draw`, `image`, `audit`, `review`, `verify`, `uat`, `docs`, `deliver`), and
each label has one op file here, `<label>.md`. The op file owns the **base** of a task of that label; the Kernel's contract
adds an **extend**. The harness works the union, base then extend, and the worker reads nothing else. Which labels a Work
record needs, in which order, is its lane ([../lanes.yaml](../lanes.yaml)).

`cli/src/harness/ops.ts` loads and validates these files (`OPS_INVALID` names the file and the fault);
`cli/src/harness/contract.ts` resolves a contract against its op and judges it; `cli/src/harness/brief.ts` renders the
brief.

## An op file

The front matter is data (`schema: starci/op@1`); the body is the label's own procedure, the part of the work that
differs from the procedure below. A body never restates the common procedure.

| key | holds |
|---|---|
| `summary`, `floor`, `hostTools`, `independentOf` | what the label is for, its difficulty floor, the host tools it needs and the labels whose authors it is never routed to; the router reads the last three ([../README.md](../README.md)) |
| `perRecord` | a task of the label works one Work record: a plan whose task of it carries the lane steps of several records, or whose `allowPaths` reach the owner paths of several impl records, is refused `TASK_NOT_SPLIT` (`assertFlow` in `cli/src/harness/lanes.ts`), so independent records run in parallel |
| `context.base` | the files every task of the label reads. `harness:<path>` is a file of this checkout (contexts, ops, a package README), which a published CLI ships ([cli/README.md](../../cli/README.md)); any other entry is a repository path. `{name}` is filled from the task's inputs or `{label}`. An entry may be `{file, when}`: it applies only when every input it names holds one of its values (the code op reads the app files for `side: be|fe`, CONTRIBUTING.md plus cli/README.md for `side: harness`, and CONTRIBUTING.md plus the package contexts for `side: package`). An entry marked `shared: true` is read by every task of the label for orientation, so its ids are never a read trace. `context.budget` caps the resolved context in tokens (bytes / 4); `contract check` refuses a heavier one |
| `input.base` | the named inputs a contract must give, each with what it means. `summary` and `details` belong to every contract and are never declared |
| `output.base` | the keys the worker's output json must carry: `type` (`string`, `number`, `boolean`, `object`, `array`, `string[]`), optional `minItems`, `when: work` (only for a work-driven task), `cites` (a read trace), `summary` |
| `checks.base` | the checks of every task of the label: presets of [../checks.yaml](../checks.yaml), bare (its arguments then come from the contract's inputs of the same names, which `input.base` must declare) or `{preset, args}`. Each check has a trust tier by its kind: T0 the harness observes (command, starci, files, probe), T1 it reads from a receipted run (uat-flow), T2 is the worker's claim (json, cited) and is never behavioural. `behavioural: true` makes a contract without a T0 or T1 behavioural check unfit |

## The contract's extend

A contract (`starci/contract@2`, written by `starci contract new` or inline in a workflow file) carries the Kernel's part:

- `context.extend`: more files to read (the Kernel picks the knowledge topics, the project's Work records and code the
  task needs; it reads [contexts/project/index.md](../../contexts/project/index.md), the generated index of the tree, in
  place of the tree itself, then only the files the task needs, the project's Work and these op files, to write it). `context.revision` is the commit the task starts from.
- `input.base`: the values of the op's base inputs; `input.extend`: named inputs of its own.
- `output.extend`: more keys the output must carry.
- `checks.extend`: more checks.

An extend only adds. A contract may also pin a copy of the base (`context.base`, `output.base`, `checks.base`), and
`starci contract check` refuses it when the copy drops a file, key or check of the op's base, when an output key the op
owns is given a looser type, fewer items, a new `when` or another `cites`, or when an input the op requires has no value.
The resolved contract always carries the op's whole base, pinned or not. A `starci/contract@1` (its `readPaths`,
`expectedOutput.checks` and `context.base` revision) is read as the contract@2 it means.

## What the harness generates from the base

- The `output` check: a json check of the filed result carrying every required key with its type (base and extend), so no
  hand-written `result-json` is needed for them. It is a T2 claim: it can make a task red, never prove it green.
- The read trace: `rulesApplied` lists the rule ids the work applied and `workRecords` the Work record ids a work-driven
  task (one whose context reads `.starciwork/`) worked from. The `rules-cited` preset is red when a cited id is named by none
  of the task's context files, literally as a token of a Markdown heading or a yaml `id:` value, or when fewer ids are cited
  than `minItems`; a rule id some contexts page owns is red naming that page, which the brief did not include. The
  context files include the rule pages of the allowPaths (`cli/src/harness/rule-pages.ts`): every code topic whose front
  matter `slots` names a slot of [hfs/slots.yaml](../../contexts/hfs/slots.yaml) that an allowPath lies in or holds. A rule id has a letter and a digit or hyphen (`R01`, `BE-ERROR-1`); a plain word is no id.
  `workRecords` is read against the Work records the task can read: its Work context files, the records under its own Work
  allowPaths, and each record of the checkout that one of those context files or the contract's inputs points at by Work id
  or `.starciwork/` path (an impl record's `proves`, say); never the rest of the Work tree. A cited id outside them is red as
  naming no Work record readable by the task, with where the check looked. An op whose output cites carries `rules-cited`,
  and only such an op, which `loadOps` enforces. `contract check` refuses a contract that must cite rules while its context, all harness files, names
  none.
- The brief: the procedure below, then the op's body, the inputs, the write paths, the exact files to read (absolute,
  base then extend), the rule pages of the paths (citable, opened on demand, outside the op's context budget), the output
  keys with their types, the checks and the budget.

## The worker procedure

You are a StarCi worker. You do exactly one task, described by its contract, and you return one result.
The task follows this brief; `starci task status {taskId} --json` shows the same contract.

1. Read exactly the files the brief lists under "Read exactly these files", base then extend, before you change anything.
   Do the task's input inside its context, and write only under its allowPaths. When the brief has a "Prior work"
   section, earlier attempts of this same work left changes: start from them, never redo them blindly. Read what
   changed in the contract since and why the last attempt ended, then keep what still holds and fix the rest. The prior
   patch is either applied to your checkout already, or it did not apply cleanly and the brief names its file, from which
   you port what still holds by hand.
2. Write your output to `{outputFile}`: one json object carrying every key the brief lists under "Output", with its type.
   When it asks for `rulesApplied`, name the ids of the rules you applied, each as it appears in a file you read (a heading such as
   `BE-ERROR-1` or a yaml `id: R01`); never cite a rule you did not read.
3. Prove your own work: run `starci task verify {taskId} --contract {contractFile}` until it is green, within the budget.
   Your checkout is a worktree of your own, cut from the workflow's branch, that the harness removes once your task settled. A check on `@result` reads the
   output file. Beyond it you run only what tier 1 allows ([contexts/authority/branch.md](../../contexts/authority/branch.md)):
   no tests, build, bench or full suite, and no install of your own; the harness gives your checkout the app's `@starci`
   packages as the app takes them (npm, or local copies under `starci deps source --local`).
4. Return exactly one result with `starci task result {taskId} --status <s> --output @{outputFile}` (the `@` reads the file):
   - `done`: verify is green. Work that finds nothing to change (the code already meets the task) is done too: you change
     nothing, the checks judge the files under your allowPaths as they stand, and the harness settles it without a commit.
   - `blocked`: you cannot finish without something outside the contract; say what, in one sentence. When the business,
     the code or the spec is unclear, or a check is red for a cause that is clearly the harness's (a wrong scope, a missing
     context page, an install or infrastructure fault, a tool error) and not your code, you never guess silently and never bend
     your work around it: your output carries `question` (the question, or the red and why it is the harness's) and, when you
     have one, `default` (the answer you propose), which your Kernel may simply accept. It answers from the goal, the specs and
     the canon, or climbs the question to the Supervisor, who answers it or files one ticket; the answer reaches your next
     attempt's brief under "Answers". When that something is
     a shared thing that is missing (a capability under `platform/`, an app-root file, a `@starci` package, a root config such
     as the lint, tsconfig, compose or package.json), you never build it: add `--needs <key>` with its key
     (`capability:platform.http`, `package:@starci/grammar`, `config:root-eslint`), `--rule <id>` that asks for it,
     `--paths <path>...` it would touch and `--note <what>`. Every task that reports one key waits on one need, which one owner
     resolves; your task is parked with its work kept and runs again, from that work, once the need is resolved or ruled
     not shared (the brief's "Shared needs" says which).
   - `mismatch`: the contract itself is wrong or contradictory; show why.
   - `failed`: the budget ran out (attach the last red checks), or, for a label that measures the product (`audit`,
     `review`, `verify`, `uat`), what you measured is wrong: your verdict is `failed` and your findings say why. You never
     repair it; the Kernel routes the findings ([../routes.yaml](../routes.yaml)).

A defect that belongs to a package the app consumes (the grammar, a canon package, the harness) is never worked around in
the app, even when a shim inside allowPaths would make your checks green. A task whose input names a `@starci` package to
fix is a package edit, done as [contexts/authority/packages.md](../../contexts/authority/packages.md) says. Any other
task files `blocked --needs package:<name>` with a note naming the component and the error.

Never commit in your checkout (only a package edit's own branch takes your commits), push, merge into main, change the
contract, edit tests or configs outside allowPaths, or ask the owner ([contexts/authority/](../../contexts/authority/README.md)).
The harness verifies your result again on a clean checkout and commits it; a green you did not earn is refused.

### Orca mail

Under the Orca runner you talk only to your coordinator, the seat whose Run you were launched into: your Kernel, or for a
`[Worker]` the Supervisor that dispatched you; never to the owner or another seat. Your filed result and `task verify` are the
state; mail only wakes your coordinator. Use the terminal, Orca task and dispatch ids of your injected
Orca preamble (the Orca task id is not the StarCi task id above). Upward mail omits `--to` and `--run`, so Orca delivers
it to your dispatch's owning Run, which is your coordinator's.

- Stuck, or the work needs a change outside your allowPaths: never wait on a blocking `ask`. File the StarCi result with
  `--status blocked` (or `mismatch`) and your question in its output; your coordinator takes it as one decision.
- Done: file the StarCi result, then report exactly once with both ids and an honest outcome (`failed` when the requested
  work is incomplete); the body is three sentences: what you did, what you found, what remains.

```text
orca orchestration send --from <terminal> --type worker_done --subject "<status>" --body "<three sentences>" --task-id <orca-task-id> --dispatch-id <dispatch-id> --outcome succeeded
```

Read downward guidance at natural checkpoints and before you report (`orca orchestration check --terminal <terminal>
--json`, then `--ack <delivery-id>` on the next check). After `worker_done`, stop and stay idle. Inline tasks file the
StarCi result without Orca mail.
