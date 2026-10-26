# Op files: one per label, base and extend

Every worker task has a label (`code`, `test`, `ui`, `verify`, `uat`, `docs`, `deliver`), and each label has one op file
here, `<label>.md`. The op file owns the **base** of a task of that label; the Kernel's contract adds an **extend**. The
harness works the union, base then extend, and the worker reads nothing else.

`cli/src/harness/ops.ts` loads and validates these files (`OPS_INVALID` names the file and the fault);
`cli/src/harness/contract.ts` resolves a contract against its op and judges it; `cli/src/harness/brief.ts` renders the
brief.

## An op file

The front matter is data (`schema: starci/op@1`); the body is the label's own procedure, the part of the work that
differs from the procedure below. A body never restates the common procedure.

| key | holds |
|---|---|
| `summary`, `floor`, `hostTools` | what the label is for, its difficulty floor and the host tools it needs; the router reads the last two ([../README.md](../README.md)) |
| `context.base` | the files every task of the label reads. `harness:<path>` is a file of this checkout (knowledge, ops, a package README), which a published CLI ships ([cli/README.md](../../cli/README.md)); any other entry is a repository path. `{name}` is filled from the task's inputs or `{label}` |
| `input.base` | the named inputs a contract must give, each with what it means. `summary` and `details` belong to every contract and are never declared |
| `output.base` | the keys the worker's output json must carry: `type` (`string`, `number`, `boolean`, `object`, `array`, `string[]`), optional `minItems`, `when: work` (only for a work-driven task), `cites` (a read trace), `summary`. `behavioural: true` says the output is itself the evidence of behaviour (a suite or flow report) |
| `checks.base` | the checks of every task of the label: presets of [../checks.yaml](../checks.yaml), bare or `{preset, args}`. `behavioural: true` makes a contract without a behavioural check unfit |

## The contract's extend

A contract (`starci/contract@2`, written by `starci contract new` or inline in a workflow file) carries the Kernel's part:

- `context.extend`: more files to read (the Kernel picks the knowledge topics, the project's Work records and code the
  task needs; it reads the full context, CONTEXT.md, knowledge, knowledge/project, the project's Work and these op files, to
  write it). `context.revision` is the commit the task starts from.
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
  hand-written `result-json` is needed for them. It counts as behavioural when `output.behavioural` is true.
- The read trace: `rulesApplied` lists the rule ids the work applied and `workRecords` the Work record ids a work-driven
  task (one whose context reads `.starciwork/`) worked from. The `rules-cited` preset is red when a cited id is named by none
  of the task's context files, literally as a token of a Markdown heading or a yaml `id:` value (`workRecords` against the
  Work files only), or when fewer ids are cited than `minItems`. An id has a letter and a digit or hyphen (`R01`,
  `BE-ERROR-1`); a plain word is no id. An op whose output cites carries `rules-cited`, and only such an op, which
  `loadOps` enforces. `contract check` refuses a contract that must cite rules while its context, all harness files, names
  none.
- The brief: the procedure below, then the op's body, the inputs, the write paths, the exact files to read (absolute,
  base then extend), the output keys with their types, the checks and the budget.

## The worker procedure

You are a StarCi worker. You do exactly one task, described by its contract, and you return one result.
The task follows this brief; `starci task status {taskId} --json` shows the same contract.

1. Read exactly the files the brief lists under "Read exactly these files", base then extend, before you change anything.
   Do the task's input inside its context, and write only under its allowPaths.
2. Write your output to `{outputFile}`: one json object carrying every key the brief lists under "Output", with its type.
   When it asks for `rulesApplied`, name the ids of the rules you applied, each as it appears in a file you read (a heading such as
   `BE-ERROR-1` or a yaml `id: R01`); never cite a rule you did not read.
3. Prove your own work: run `starci task verify {taskId} --contract {contractFile}` until it is green, within the budget.
   It judges only what you may have written: files leased by other tasks are not yours. A check on `@result` reads the
   output file. Test only what the task changed; the full suite is CI's after the push.
4. Return exactly one result with `starci task result {taskId} --status <s> --output @{outputFile}` (the `@` reads the file):
   - `done`: verify is green.
   - `blocked`: you cannot finish without something outside the contract; say what, in one sentence.
   - `mismatch`: the contract itself is wrong or contradictory; show why.
   - `failed`: the budget ran out; attach the last red checks.

A defect that belongs to a package the app consumes (the grammar, a canon package, the harness) is reported, never worked
around in the app: file `blocked` naming the package, the component and the error, even when a shim inside allowPaths
would make your checks green.

Never commit, push, merge into main, change the contract, edit tests or configs outside allowPaths, or ask the owner.
The harness verifies your result again on a clean checkout and commits it; a green you did not earn is refused.
