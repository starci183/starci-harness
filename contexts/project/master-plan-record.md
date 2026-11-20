# Master Plan: the decisions, reasons and rules of a project

A project's Master Plan is the one record of what it decided, why, and the rules every task holds, kept as data in
`.starciwork/master-plan.yaml` at the app root. It is product content, committed with the app, written by the owner's rulings
like the concepts ([work.md](work.md) PROJECT-WORK-5, PROJECT-WORK-7): the concepts say what the product's words, data and
names are; the Master Plan says which choices bind every layer of the build. This file owns its shape, how a brief carries it
and how its rules map to the gates.

## PROJECT-MASTER-PLAN-1 A project keeps its Master Plan as nine layers of data

`.starciwork/master-plan.yaml`, schema `starci/master-plan@1`, holds `layers`, exactly these nine in this order, and an
optional `project` name:

| id | holds |
|---|---|
| `business` | what the product is for, who acts in it and how work moves |
| `tech` | the stack: frameworks, data stores, AI, infrastructure, repository |
| `patterns` | the design patterns every flow follows |
| `ui` | the interface: the component set, typography, viewports |
| `data` | the schema, the stores, the naming and data conventions |
| `testing` | what counts as proof and when suites run |
| `security` | custody of secrets and keys, access, isolation |
| `observability` | run logs, retries, parking, alerts, recovery |
| `domains` | the boundaries of the code and how the work is split |

Each layer holds `decisions[]` (what was chosen, one text each), `reason` (why, `""` while undecided), `rules[]` and an
optional `roadmap[]` (what is planned and not decided now, never built ahead), plus an optional `title` in the product's
language. A rule is `{ id, kind, text, enforcedBy? }`: `id` is unique across the plan (`DATA-3`), `kind` is `always` or
`never`, `text` is the rule in the plan's own words, and `enforcedBy` names what holds it, one name or a list: an hfs rule id
(`R431`) of [hfs/rules.yaml](../hfs/rules.yaml), a check preset of [ops/checks.yaml](../../ops/checks.yaml), or `review`.
A later layer never contradicts an earlier one, and a decision changes in this file first, then in the code.

The paths are admitted by slot `app.starciwork` ([hfs/slots.yaml](../hfs/slots.yaml)); `starci app scaffold` writes the
skeleton (the nine layers with nothing decided) from the template `packages/hfs/templates/app/skeleton/.starciwork/master-plan.yaml`.
The app check judges the file (R449): a file that is not this shape, repeats a rule id or names in `enforcedBy` an hfs rule the
installed catalog does not hold is `HFS_MASTER_PLAN_INVALID`, an error; an app that tracks none yet is the warning
`HFS_MASTER_PLAN_MISSING`, never blocking. The check reads the shape and the ids, never whether a decision is right, which is
held by review. Known gap: a check preset named in `enforcedBy` is not resolved by the app check, which has no harness checkout;
`starci app master-plan` (PROJECT-MASTER-PLAN-3) resolves it.

Why: a decision kept only in chat or in a person's head is rebuilt differently by every agent; nine fixed layers make the same
questions answered in the same place, and a rule as data can be handed to the task it binds and matched to the gate that holds it.

## PROJECT-MASTER-PLAN-2 A brief carries the layers of its op, and a task that contradicts a rule stops and asks

Every worker brief (`cli/src/harness/brief.ts`) carries a "Master Plan" section with the layers its op names in the op file's
front matter, `masterPlan: [layer...]` ([ops/ops/README.md](../../ops/ops/README.md)): `code` reads patterns, data, ui and
domains; `design`, `draw`, `image` and `audit` read ui; `prove`, `test` and `verify` read testing; `deliver` reads tech, security and
observability; `docs` reads business and domains; `inspect` and `review` read all nine. The mapping is data of the op files, never code.
The brief reads the plan from the task's checkout, then from the Work root its `hfs.json` names (`work.root`, for a side
repository), then from the workflow's checkout; a project without one gets a line that says so, and a malformed plan refuses
the brief `MASTER_PLAN_INVALID`.

A task that contradicts a rule or a decision of those layers stops and asks: the worker changes nothing the plan forbids and
files `blocked` with a `question` naming the rule id (or the decision) and the contradiction, and the plan change it proposes
as `default` (the worker procedure of [ops/ops/README.md](../../ops/ops/README.md)). The plan changes first, by its owner; the
code follows. This is held by review: no gate reads whether a change contradicts a decision.

## PROJECT-MASTER-PLAN-3 Each rule's enforcement is reported, so the plan shows what the harness holds

`starci app master-plan` (`--json` for machines) lists every rule of the plan with its status:

| status | means |
|---|---|
| `enforced` | it names machines only, each an hfs rule of the app's installed catalog with a built enforcer or a check preset |
| `partial` | a named machine holds a part of it and the `review` beside it holds the rest |
| `planned` | it names an hfs rule whose enforcers are all still owed (`status: planned`) |
| `review` | only a reviewer holds it |
| `unenforced` | it names nothing |
| `unknown` | a name resolves to no hfs rule and no check preset; the verb exits 1 |

A rule is mapped to an hfs rule only where that rule truly judges it, or a named part of it, and a part no machine reads is
written as `review` beside it (`partial`), so `enforced` never reads as more than the gate holds. A rule that stays `review` or `unenforced`
and that a machine could decide is a gap to close as a gate ([lint.md](lint.md) PROJECT-LINT-1).

## Read with

[work.md](work.md) (the `.starciwork` tree and the concepts), [README.md](README.md) (the life cycle a task walks),
[ops/ops/README.md](../../ops/ops/README.md) (the op files and the worker procedure).
