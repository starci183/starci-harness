# Work: the product records of a project

`.starciwork/` at the app root holds the product's Work: the concepts the owner ruled, what the product must do, how it
is designed, what was built and how it is accepted. It is product content, committed with the app; harness state never lives there
([contexts/harness/state.md](../harness/state.md)). Which paths the tree may hold is slot `app.starciwork` of
[hfs/slots.yaml](../hfs/slots.yaml); the edition decides how much of it exists ([lite.md](lite.md), [full.md](full.md)).
This file owns the record families, the concepts, their lifecycle vocabulary and who writes what.

## The tree

| path | schema | holds |
|---|---|---|
| `workspace.yaml` | `work/workspace@1` | the project id and its repositories as `{role, name}` (`be`, `fe`); the one place a side repository is named |
| `index.yaml` | `work/catalog@1` | the feature catalog: one `{id, directory, description}` per feature |
| `features/<f>/index.yaml` | `work/feature@1` | the feature's scope: purpose, what is decided, what this release delivers, what is excluded, open questions |
| `features/<f>/<family>/<name>/index.yaml` | per family, below | one record; `<name>` may nest by segment (`contract/purchase/<name>`) when a group needs it |
| `concepts/index.yaml` | `work/concept-catalog@1` | the concept catalog: one `{id, directory, description}` per concept, in reading order (PROJECT-WORK-7) |
| `concepts/<name>/index.yaml` | `work/concept@1` | one concept: a ruling of the owner about what the product is, with how much of it the code holds (PROJECT-WORK-7) |
| `brand/index.yaml`, `brand/assets/**` | `work/brand@1` | the product's brand direction over its grammar's token names |
| `shell/index.yaml` | `work/layout-tree@1` | the app shell every screen sits in |
| `_resources/{environments,identities,fixtures}/<name>/resource.yaml` | `work/resource@1` | what UAT and runs resolve: an environment's origins and allowed effects, an identity's provider and sealed custody (never a secret value), a fixture's seed |

A record's `id` is `<family>.<feature>.<name>` with the nesting segments joined by dots (`contract.<f>.<group>.<name>`);
the folder path is not identity, and every reference between records uses the id.

## PROJECT-WORK-1 Every record belongs to one family

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
| `integration` | `work/integration@1` | the boundary to one external provider, proven only against it | `provider`, `boundary`, `endpoints`, `credential`, `sandbox`, `research` (PROJECT-WORK-4) |
| `ui` | `work/ui-screen@1` | one screen: route, surface, persona and its interface spec | `brand`, `shell`, `route`, `routeParent`, `surface`, `persona`, `ui`, `direction` (the repository path of its drawn HTML), `assets` (`{slot, summary, file?}`, the artwork the drawing leaves for real art) |
| `impl/<repository>` | `work/implementation@1` | the code that proves records, in one repository named by `workspace.yaml` | `repository`, `owners` (`{role, path}`, module-root directories, never files), `proves` |
| `uat` | `work/uat-flow@1` | one acceptance walk in a browser (below) | `entry`, `actor`, `accounts`, `environment`, `steps`, `failurePaths`, `recording`, `effects`, `cleanup` |
| `gap` | `work/gap@1` | a known absence, closed by the records that fill it | `statement`, `closedBy` (ids) |

Requirements (`br`, `fr`, `nfr`, `journey`, `data`, `decision`) say what must hold and never name code; design (`sds`,
`contract`, `integration`) says how it is built without repository paths; `ui` says what a screen decides; `impl`
and `uat` are the proof. A shared rule, entity or contract has one owning feature, and other features reference its
id. A family folder exists only when the feature has a record for it.

## PROJECT-WORK-2 Only leaves carry state, and proof cannot outrun its target

- **Only leaves carry state.** A feature, the catalog and a scope folder derive progress from their records and
  carry none; an acceptance criterion follows its rule.
- **`state`** is `todo` (defined, not yet proven) or `done` (proven). A reviewed requirement or design stays `todo`
  and is still the source of truth downstream; `done` is set only when the proof its `requiresProof` names has run
  green on the delivered revision.
- **`activity`** says whether work on a `todo` record is running: `idle`, or `investigating`, `implementing`,
  `verifying` while a task holds it, and `blocked` after a settle saw its proof red. There is no in-progress state.
- **Blocking** is `blockedBy` (ids) or `blockers` (words), never a state.
- **Proof cannot outrun its target.** An `impl` is `done` only when every record in its `proves` is; a `gap` only
  when every id in `closedBy` is; a `ui` only when the owner approved the direction its `direction` names. A change to a record
  that was `done` returns its dependents to `todo` until they are proven again.

## PROJECT-WORK-3 Requirements and design reason across every case; a decided slice proceeds

A requirement or design record reasons, for the slice it serves, across the main path, the alternatives, the failures
and the edge cases, with the constraints that bound them: the behaviour, boundaries, contracts, data, authority and
assumptions a slice depends on are clear enough to build without guessing. A consequential unknown is written down
(an open question of the feature, a `blockers` line, a `decision` or a `gap` record), never left out. An unresolved
business, security or data choice blocks only the records and effects it touches, through `blockedBy` on its
`decision`; a slice that is decided proceeds to code and test, and what they reveal repairs the owning record, whose
change returns its dependents to `todo` (PROJECT-WORK-2). Breadth is not certainty: the record covers what is
foreseeable, not every theoretical case.

Why: an omitted case surfaces as a guess in code, and waiting for a complete design blocks the slices that are already
decided.

## PROJECT-WORK-4 An integration is designed from the provider's current documentation

Before an `integration` record is designed, its author reads the provider's current official documentation for the
intended use. The record's `research` keeps what that reading found: the primary sources and the date they were read,
the authentication, account, scope and lifecycle limits the provider supports, the callback or webhook setup it needs
(BE-WEBHOOK-1 … 4 build it), which prerequisites only the owner can provide, and the live verification plan that proves
the integration against the provider itself. Missing research sends the work back to the record, never to the owner as
a bare credential request, and a credential that exists proves nothing about the provider; the live proof runs only when
it is asked for or before a release. The code the record designs is BE-INFRA-3.

Why: a provider's behaviour changes under its own release cycle; a design from memory or an old example fails where
the current limits differ, and only a dated source shows when the design must be read again.

## PROJECT-WORK-5 Each writer writes only its part

| writer | writes |
|---|---|
| the Kernel (its own reasoning) or a `docs` task it sends; an app session outside a workflow | every record's content: new records, revisions, `change`, `refs`, `blockers`, `requiresProof`; a concept and its catalog line once the owner ruled (PROJECT-WORK-7) |
| a `code` or `test` task | code, never a record; what it learned goes into its result for the Kernel to record |
| a `draw` or `image` task | a ui record's `direction` and its drawing, or an asset slot's `file` and its image; never its `state` |
| a `uat` task | the run's evidence beside the flow (below), never the flow's steps or expectations |
| the harness, at settle | only `state`, `activity` and the flow's `evidence.yaml` of the uat record the settled task walked |
| the owner | decisions (`decision` outcomes), the rulings a concept records, and taste; the Kernel records them |

The harness writes a uat record at settle ([cli/src/harness/settle.ts](../../cli/src/harness/settle.ts)): green sets
`state: done` and `activity: idle` inside the task's harness commit, red sets `activity: blocked` in a Work commit of its
own, and both append the run to `evidence.yaml`. Every other record's state change is a `docs` task's edit inside an
allowPaths scope (`.starciwork/features/<f>`), held by review.

## PROJECT-WORK-7 A product's concepts are read before designing and never bent silently

A concept is a ruling of the owner about what the product is: where a kind of thing lives, what a part never does, how
two parts divide one job. It holds across features, so no feature owns it: `concepts/index.yaml` lists every concept as
`{id, directory, description}` in reading order, and `concepts/<name>/index.yaml` holds one. Both editions keep them. A
`decision` record is a question of one feature with its options; a concept is the standing law every feature is checked
against.

| field | holds |
|---|---|
| `schema`, `id`, `title` | `work/concept@1`, `concept.<name>`, the ruling named in a few words |
| `rule` | the ruling in one or two sentences, present tense, readable alone |
| `why` | the reason the owner gave or the damage the ruling prevents |
| `forbids` | what the ruling excludes, one line each |
| `example` | one small case that shows the ruling applied |
| `livesIn` | the code that holds it, as `{path, holds}`; empty until code exists |
| `decided` | `{by, at, words, source}`: who ruled, the day, the owner's own words, verbatim and in his language, where they were recorded, and the record the ruling was taken from |
| `status` | `built` (the code named in `livesIn` does what `rule` says), `partial`, `not-built` or `not-verified`; `built` and `notBuilt` list which part is which |
| `refs` | the ids of the concepts and records it reads |
| `extensions` | what the ruling needs beyond these fields: a name map, a table of approved shapes, a list of cases |

- **Read first.** Before a requirement, a design, a contract, a plan or code of the product is written, its author reads
  the catalog and every concept the work touches; a Kernel names them in the contract's `context.extend`.
- **Written when the owner rules.** A ruling of the owner on the product is written into the concept it changes, or a new
  one with its catalog line, in the change that first acts on it (PROJECT-WORK-5 names the writer). The record states
  what holds now; `decided` keeps the day and the words, and the earlier text lives in git.
- **A contradiction is raised.** A request, a design, a note or code that contradicts a concept is put to the owner with
  the concept's id and both statements, and the contradicting part waits for the answer. Nobody applies it silently, and
  nobody edits a concept to fit the code: only the owner's word changes a concept.
- **Status never runs ahead of the code.** `built` is set by whoever read or proved the code `livesIn` names; a part
  nobody checked is `not-verified`, and a ruling the code does not yet follow is `not-built` with the gap in `notBuilt`.

Why: a ruling kept only in a chat or a session note is lost at the next session, and work designed without it rebuilds
what the owner already refused; a concept marked as built before the code follows it is read as a shipped fact. The
paths are admitted by slot `app.starciwork` (R212 holds the lite boundary); the content of a concept and the reading
before design are held by review.

## Lanes

Each record family walks a lane of steps, each a label ([ops/lanes.yaml](../../ops/lanes.yaml)): requirements, design
and the brand are decided once by `docs`; a screen is drawn, then its art made; front-end code waits for its feature's
screens and is audited and walked; back-end code is tested, proven end to end and reviewed. A step the record's evidence
already satisfies (its state, its drawing, its owners' commits, a receipted run, a green task over it) is skipped, and a
workflow covering the record carries every other step ([cli/src/harness/lanes.ts](../../cli/src/harness/lanes.ts)).

## PROJECT-WORK-6 A UAT flow runs from its record

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
