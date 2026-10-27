# Work: the product records of a project

`.starciwork/` at the app root holds the product's Work: what the product must do, how it is designed, what was built
and how it is accepted. It is product content, committed with the app; harness state never lives there
([contexts/harness/state.md](../harness/state.md)). Which paths the tree may hold is slot `app.starciwork` of
[hfs/slots.yaml](../hfs/slots.yaml); the edition decides how much of it exists ([lite.md](lite.md), [full.md](full.md)).
This file owns the record families, their lifecycle vocabulary and who writes what.

## The tree

| path | schema | holds |
|---|---|---|
| `workspace.yaml` | `work/workspace@1` | the project id and its repositories as `{role, name}` (`be`, `fe`); the one place a side repository is named |
| `index.yaml` | `work/catalog@1` | the feature catalog: one `{id, directory, description}` per feature |
| `features/<f>/index.yaml` | `work/feature@1` | the feature's scope: purpose, what is decided, what this release delivers, what is excluded, open questions |
| `features/<f>/<family>/<name>/index.yaml` | per family, below | one record; `<name>` may nest by segment (`contract/purchase/<name>`) when a group needs it |
| `brand/index.yaml`, `brand/assets/**` | `work/brand@1` | the product's brand direction over its grammar's token names |
| `shell/index.yaml` | `work/layout-tree@1` | the app shell every screen sits in |
| `_resources/{environments,identities,fixtures}/<name>/resource.yaml` | `work/resource@1` | what UAT and runs resolve: an environment's origins and allowed effects, an identity's provider and sealed custody (never a secret value), a fixture's seed |

A record's `id` is `<family>.<feature>.<name>` with the nesting segments joined by dots (`contract.<f>.<group>.<name>`);
the folder path is not identity, and every reference between records uses the id.

## Record families

Every leaf record carries `schema`, `id`, `title`, `state`, `activity`, and as needed `refs` (ids it reads),
`dependsOn`, `blockedBy` (ids that must be done first), `blockers` (impediments in words), `requiresProof` (the
commands that prove it, each `{required, command, note}`), `change` (`{rev, kind, at, reason}` of the last edit) and
`extensions`. The family adds its own fields:

| family | schema | owns | its own fields |
|---|---|---|---|
| `br` | `work/business-rule@1` | a product rule that holds whatever the screen or code | `statements`, `acceptance`, `authorityRefs`, `appliesTo` |
| `br/<rule>/ac` | `work/acceptance-criterion@1` | one given/when/then of the rule above; no state of its own | `rule`, `given`, `when`, `then` |
| `fr` | `work/functional-requirement@1` | an observable behaviour: who triggers it and what follows | `actors`, `trigger`, `mainFlow`, `exceptionFlows`, `postconditions`, `composes` |
| `nfr` | `work/non-functional-requirement@1` | a quality with a measurable criterion | `quality`, `observableCriterion`, `measurement` |
| `journey` | `work/customer-journey@1` | a customer path across requirements and features | `steps`, `requirements`, `crossesFeatures` |
| `data` | `work/data@1` | a business entity: fields, invariants, its lifecycle | `fields`, `invariants`, `stateMachine` |
| `decision` | `work/policy-decision@1` | a policy question, its options and the owner's outcome | `question`, `options`, `recommendation`, `recommendationReason`, `outcome`, `chosen`, `reason`, `blocks` |
| `sds` | `work/sds-component@1` | a logical component of the design: responsibility, interfaces, sequence; no repository path until code proves it | `responsibility`, `interfaces`, `owners`, `stateMachine`, `sequence` |
| `contract` | `work/contract@1` | a synchronous surface one feature provides and others consume | `owner`, `between`, `surface`, `guarantees`, `consumerObligations` |
| `integration` | `work/integration@1` | the boundary to one external provider, proven only against it | `provider`, `boundary`, `endpoints`, `credential`, `sandbox` |
| `ui` | `work/ui-screen@1` | one screen: route, surface, persona and its interface spec | `brand`, `shell`, `route`, `routeParent`, `surface`, `persona`, `ui` |
| `impl/<repository>` | `work/implementation@1` | the code that proves records, in one repository named by `workspace.yaml` | `repository`, `owners` (`{role, path}`, module-root directories, never files), `proves` |
| `uat` | `work/uat-flow@1` | one acceptance walk in a browser (below) | `entry`, `actor`, `accounts`, `environment`, `steps`, `failurePaths`, `recording`, `effects`, `cleanup` |
| `gap` | `work/gap@1` | a known absence, closed by the records that fill it | `statement`, `closedBy` (ids) |

Requirements (`br`, `fr`, `nfr`, `journey`, `data`, `decision`) say what must hold and never name code; design (`sds`,
`contract`, `integration`) says how it is built without repository paths; `ui` says what a screen decides; `impl`
and `uat` are the proof. A shared rule, entity or contract has one owning feature, and other features reference its
id. A family folder exists only when the feature has a record for it.

## State and activity

- **Only leaves carry state.** A feature, the catalog and a scope folder derive progress from their records and
  carry none; an acceptance criterion follows its rule.
- **`state`** is `todo` (defined, not yet proven) or `done` (proven). A reviewed requirement or design stays `todo`
  and is still the source of truth downstream; `done` is set only when the proof its `requiresProof` names has run
  green on the delivered revision.
- **`activity`** says whether work on a `todo` record is running: `idle`, or `investigating`, `implementing`,
  `verifying` while a task holds it, and `blocked` after a settle saw its proof red. There is no in-progress state.
- **Blocking** is `blockedBy` (ids) or `blockers` (words), never a state.
- **Proof cannot outrun its target.** An `impl` is `done` only when every record in its `proves` is; a `gap` only
  when every id in `closedBy` is; a `ui` only when the screen's approved direction exists. A change to a record
  that was `done` returns its dependents to `todo` until they are proven again.

## Who writes what

| writer | writes |
|---|---|
| the Kernel (its own reasoning) or a `docs` task it sends | every record's content: new records, revisions, `change`, `refs`, `blockers`, `requiresProof` |
| a `code`, `ui` or `test` task | code, never a record; what it learned goes into its result for the Kernel to record |
| a `uat` task | the run's evidence beside the flow (below), never the flow's steps or expectations |
| the harness, at settle | only `state`, `activity` and the flow's `evidence.yaml` of the uat record the settled task walked |
| the owner | decisions (`decision` outcomes) and taste; the Kernel records them |

The harness writes a uat record at settle ([cli/src/harness/settle.ts](../../cli/src/harness/settle.ts)): green sets
`state: done` and `activity: idle` inside the task's harness commit, red sets `activity: blocked` in a Work commit of its
own, and both append the run to `evidence.yaml`. Every other record's state change is a `docs` task's edit inside a
leased scope (`.starciwork/features/<f>`), held by review.

## UAT flows

A flow lives at `features/<f>/uat/<flow>/` and runs from its record: the walk, the accounts and the environment are
read from Work, never retyped in a script.

- **`index.yaml`** (`work/uat-flow@1`): `entry` (the address the walk opens), `actor` (the role of the default
  account), `accounts` (`accounts.yaml`), `environment` (the id of an environment resource), ordered `steps`, each
  `{order, actor?, action, expected, checks?}` where `checks` are `{id, expected}` pairs a run reports by id;
  `failurePaths` (`{id, step, expected}`, the refusals the walk must observe); `recording` (whether a video is
  required and what it covers); `effects` (what the walk leaves behind); `cleanup`; `requiresProof`.
- **`accounts.yaml`** (`work/disposable-accounts@1`): `disposable` and `accounts` as `{role, identity}`, the identity
  being a resource id under `_resources/identities`; a literal password never appears.
- **Optional** `fixtures.yaml`, `seed.sql`, `cleanup.sql` beside it.
- **A run** is a `uat` task: the worker writes a short Playwright script from the flow and calls `starci uat run`
  (the pinned image, [ops/uat.yaml](../../ops/uat.yaml)) with `--out` set to `.starciwork/features/<f>/uat/<flow>/runs/<runId>`.
  The script itself writes the observations there during the run: one PNG screenshot per step and `checks.json`, each
  step's status and the value it read for each check id. `starci uat run` keeps a receipt of the run in the harness
  state (`.runtime/uat/receipts/`, with its copy `starci-receipt.json` in the folder): the script's digest, the image,
  the container, its exit code, its start and end, and every file of the folder by sha256, each stored by digest in
  `.runtime/blobs/sha256/`. The `uat-flow` check judges the walk on `checks.json` and the screenshots as that receipt
  holds them; a file the run did not write, or one changed after it, counts for nothing, and the worker's own verdict
  can make the walk red, never green. `runs/` is git-ignored by the Work tree's `.gitignore`, so raw output is never
  committed. The flow's `evidence.yaml` (`work/evidence@1`, tracked, written only by the settle) cites each run by id,
  task, verdict and the sha256 of every file, the receipt's copy included; each digest resolves in the harness store
  after the run folder is gone, and that link is what lets the flow reach `done`.
- A step that needs a person or an owner authorization (a live charge, a provider's manual check) says so in its
  `action`; a run without that authorization records the step as not walked, never as passed.

## Read with

[README.md](README.md) (the life cycle this Work feeds), [anatomy.md](anatomy.md) (where `.starciwork` sits in the
tree), [stacks.md](stacks.md) (the environments a UAT resource names), [lite.md](lite.md) and [full.md](full.md)
(how much of the tree an edition keeps), [lint.md](lint.md) (which of these facts a machine checks).
