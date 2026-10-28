# Lint and gates over a project

Which machine judges which kind of fact in a project, where it runs, and which standard facts no machine judges yet.
What each rule flags is its own documentation (the package's rule, the gate's code); this file only places them.
Profiles, tiers and gate configuration are [policy/quality.yaml](../../policy/quality.yaml), the canon package of each
stack is [policy/canon.yaml](../../policy/canon.yaml), the packages are [packages/README.md](../../packages/README.md),
and the laws with their enforcers are [hfs/rules.yaml](../hfs/rules.yaml).

## Where a check runs

- **Runtime tier**: `starci check run` before a push and `starci task verify` on the clean checkout, scoped to the
  packages the diff touches (the changed packages below); a task's diff is only what it changed since its work began,
  never another task's uncommitted work in the same checkout (`cli/src/harness/baseline.ts`). It widens to every package when the diff touches an app-wide
  configuration file every side reads (the root paths of the app-root declaration, manifest, lockfile and tool-config
  slots of [hfs/slots.yaml](../hfs/slots.yaml) and any canon tool's config file, `cli/src/core/check/scope.ts`), so each
  side's lint config loads and lints its whole package; a task that changes nothing is judged on the tracked files
  under its allowPaths and their packages. A task waits for it. Each package is judged against its workspace
  dependencies as a consumer sees them: before its typecheck and lint, every dependency in its workspace (npm, yarn or
  pnpm), transitively and dependencies first, whose manifest entries (`exports`, `main`, `module`, `types`) name a file not on disk is
  restored from the build cache under its content key or built with its own `build` script. A dependency that cannot be
  built is red with `CHECK_WORKSPACE_DEP_BUILD_FAILED` naming it, and holds the steps of the packages that import it
  (`cli/src/core/check/workspace-deps.ts`). A module built before the task that wires it in names that task in its
  contract's `composedBy`: its findings of the composition rules (`runtime.compositionRules` of
  [policy/quality.yaml](../../policy/quality.yaml)) on its own allowPaths are deferred to that task, whose check judges the
  module in full, and so does the workflow's final verify before the workflow is done; a module whose task names no
  composer answers for them itself (`cli/src/core/check/composition.ts`). The tail of every red step's output, secrets redacted, is kept as the task's
  evidence and `starci task status <task>` prints it.
- **CI tier**: after the push, on main. Nobody waits for it unless `requireCi` lists the action.
- **The app's own scripts**: hooks and CI steps the app wires (format check, stylelint, `hfs check`). The harness
  does not call them; they run in the app's CI.

A profile picks the tiers' gates and its canon stacks. `be` and `fe` are a side repository's, `app` a one-repository
app's (both sides), `lib` and `runtime` carry no canon. A workspace root is never typechecked as one project: the
`typecheck` gate skips it and checks each member against its own `tsconfig.json`.

## Packages and gates

| machine | side | profiles | runs at | kind of fact |
|---|---|---|---|---|
| gate `secrets` | any | all | runtime (and `release push` on the pushed range) | no credential or unsealed secret in the tree; configured by `policy/security.yaml` |
| gate `loosening` | any | all | runtime, over the whole tree | no inline disable, ts escape, skipped or focused test, swallowed failure or widened allowlist; exceptions only in `policy/loosening.yaml` |
| gate `canon` | each changed package | `be`, `fe`, `app` | runtime | the package depends on its stack's canon package for every tool it configures, and the tool's config names it |
| gate `typecheck` | each changed package with a `tsconfig.json` | all | runtime | the strict flags of `@starci/tsconfig` hold; types compile |
| gate `lint` | each changed package with an ESLint config | all | runtime, over the changed files | whatever that package's ESLint config enables: the canon below, plus the grammar lint on the front end |
| `@starci/eslint-canon-be` (enforcer `eslint-be`) | be | `be`, `app` | through `lint` | slot placement, tier direction and imports, naming, typing, persistence and transaction shape, error families, test shape, size budgets; reads [hfs/slots.yaml](../hfs/slots.yaml) |
| `@starci/eslint-canon-fe` (enforcer `eslint-fe`) | fe | `fe`, `app` | through `lint` | the universal front-end law: slots, imports, function shape, i18n, the one library per concern of [stack/fe.yaml](../stack/fe.yaml), budgets; it names no grammar component |
| grammar lint (enforcer `eslint-grammar-core`) | fe | `fe`, `app` | through `lint`, inside the app's ESLint config | calls to the selected grammar's component API: names, props, variants, sizes, tokens |
| `@starci/stylelint-canon` (enforcer `stylelint`) | fe CSS | `fe`, `app` | `canon` checks the wiring; stylelint itself runs in the app's scripts | grammar tokens only; brand values only in the brand file |
| `@starci/prettier-config` | both | `be`, `fe`, `app` | `canon` checks the wiring; the format check runs in the app's scripts | layout of the source text |
| `@starci/jest-preset` | be | `be`, `app` | `canon` checks the wiring; the specs run in CI (`unit`, `e2e`) | the unit test kit and its doubles |
| app CLI `@starci/hfs` (enforcers `hfs`, `machine`) | the app root and both sides | apps | the app's scripts and CI (`hfs check`) | the tree against the slot manifest, `hfs.json`, generated contracts, catalogs, the import graph |
| gate `sonar-new-code` (enforcer `sonar`) | each repository | `be`, `fe`, `app` | CI | coverage, duplication and issues of new code |
| gates `unit`, `e2e`, `build` | each repository | per profile | CI | the suites and the build; what a lite app cannot run is [lite.md](lite.md) "What CI runs" |

## Facts no machine checks yet

These standard facts live only in knowledge; a reviewer (the Kernel judging a result, the owner on taste) holds them.
Each leaves this list the day a machine checks it.

- **Pattern rules held by review.** Every rule of [code/](../code/README.md) whose `Enforced by:` line says review
  only, wholly or for one side or part (that line is the one statement of it, never listed here), and the review
  obligations CODE-REVIEW-1 to 7 of [code/README.md](../code/README.md#review-obligations), which no machine can
  decide.
- **Interface decisions.** Which component, rank, ramp step, state coverage and composition a screen uses
  ([contexts/ui](../ui/README.md)); [ui/proof/thresholds.yaml](../ui/proof/thresholds.yaml) holds the numbers a
  proof gate would read, and no gate of this repository runs it.
- **Work record shape.** Every fact of [work.md](work.md) for the families other than `work/uat-flow@1`: schemas and
  fields per family, id form, leaf-only state, proof that cannot outrun its target. The harness validates a uat flow
  record and its evidence file only when a uat task is sent, judged or settled (`cli/src/harness/work.ts`).
- **Who writes a record's state.** Outside the uat records the settle writes, a record's state is a `docs` task's edit,
  held by review (PROJECT-WORK-5 in [work.md](work.md)).
- **The `hfs.json` profile key.** Its spelling and default are PROJECT-1 in [README.md](README.md); no check refuses
  a profile under another key.
- **Pins.** That an app's `@starci/*` and shared dependencies sit at the versions of [stack/pins.yaml](../stack/pins.yaml):
  no harness gate compares them (`starci app check` compares them with the copy @starci/hfs bundles, and `starci-harness`
  with the version of the CLI that runs it).
- **The setup commands of a contract.** That a contract carries them (PROJECT-2 in [README.md](README.md)) is its
  author's duty; the clean verify only shows their absence as a red check, and the project keeps no persistent list
  of them yet.

## PROJECT-LINT-1 A fact a machine can decide moves to the machine

A fact a machine can decide is checked by a machine and kept once: the rule moves into the package or gate that owns
its kind (the placement test of [code/fe](../code/fe/README.md#the-placement-test-fe-rule-ownership) decides
which), its law is added to [hfs/rules.yaml](../hfs/rules.yaml) with the enforcer, the pattern section cites the rule
id in its "Enforced by" line, and the fact leaves the list above in the same change. Knowledge then states the reason
only; it never keeps a second wording of what the rule flags, and a gate never carries a fact knowledge still argues.

## Read with

[README.md](README.md) (the profiles a project picks), [anatomy.md](anatomy.md) (the packages each gate judges),
[work.md](work.md) (the Work facts listed above), [stacks.md](stacks.md), [lite.md](lite.md) and [full.md](full.md)
(how an edition changes which slots and rules apply).
