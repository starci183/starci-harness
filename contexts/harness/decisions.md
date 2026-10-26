# Decisions

The owner's harness decisions, as present-tense rulings, each naming the file that implements it. A ruling on how app code is written
goes to [contexts/decisions/rulings.yaml](../decisions/rulings.yaml) instead.

- **One CLI.** The harness is one TypeScript CLI on `commander`, with no framework; `starci explain`, generated from
  the verb definitions, is the one list of commands ([cli/README.md](../../cli/README.md)).
- **One brief per task.** Every brief is the worker procedure common to all ops followed by the label's op file
  ([ops/ops/README.md](../../ops/ops/README.md)); there is no catalog of op kinds beyond the labels. The Kernel writes each
  contract; a label also routes (its floor and host tools) and its checks are presets of [ops/checks.yaml](../../ops/checks.yaml).
- **Op pattern: `base` and `extend`.** Each label has one op file, `ops/ops/<label>.md`, owning the base of a task's
  context, input, output and checks; the Kernel's contract only extends it, and the output carries the trace of what
  the op read. [ops/ops/README.md](../../ops/ops/README.md) owns the mechanics and names the code that enforces them.
- **Project pattern.** `contexts/project/` is the map of a StarCi project: the app root owning `.starciwork`, its
  sides, the `hfs.json` choices, the Work life cycle, the anatomy generated from slots, where lint applies, the
  `.starcistacks` shape and the lite and full differences. It links each fact to its owner and restates none.
- **Machine checks only.** A contract's checks, its op file's `checks.base` plus its own `checks.extend`, are only
  checks a machine runs (`command`, `starci`, `files`, `json`, `probe`, `cited`, `uat-flow`), and an op whose
  `checks.behavioural` is true makes a contract without a behavioural check unfit (`contractProblems` in
  `cli/src/harness/contract.ts`). Anything no machine can judge (taste, UX) is an owner review step, never part of a contract.
- **Tests stay inside the task; CI judges the rest.** A contract's checks cover only what the task changed: the scoped
  `check run`, the tests related to the changed files (never a whole suite) and `paths-only`. A `verify` worker runs a
  heavy suite only when the goal itself is that suite. CI runs the full suite on main after the push; a red CI becomes
  a `code` contract scoped to the red checks and never blocks the next push.
- **Policy selects; code and canon enforce.** [policy/](../../policy/README.md) picks the gates and configures them; every
  rule lives once, in the CLI or a canon package.
- **One CI workflow.** [.github/workflows/ci.yml](../../.github/workflows/ci.yml) gates every push and pull request to main
  and publishes on a `v*` tag ([README.md](../../README.md) "CI"); its tokens live only in GitHub secrets.
