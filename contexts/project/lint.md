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
  side's lint config loads and lints its whole package, and such a widened run is judged against the same run at its base,
  as the files a shared need's relay node carries are judged against the same run at the source's head it relays
  (`cli/src/core/check/relay-baseline.ts`): a finding the base holds already (rule, file and message, line numbers aside) is
  the base's, kept as `baseline-findings` evidence and never the change's, and only a new one is red, a relayed source never
  answering for a composition rule (`cli/src/core/check/base-findings.ts`); a task that changes nothing is judged on the tracked files
  under its allowPaths and their packages. A task waits for it. Each package is judged against its workspace
  dependencies as a consumer sees them: before its typecheck and lint, every dependency in its workspace (npm, yarn or
  pnpm), transitively and dependencies first, whose manifest entries (`exports`, `main`, `module`, `types`) name a file not on disk is
  restored from the build cache under its content key or built with its own `build` script. A dependency that cannot be
  built is red with `CHECK_WORKSPACE_DEP_BUILD_FAILED` naming it, and holds the steps of the packages that import it
  (`cli/src/core/check/workspace-deps.ts`). A module built before the task that wires it in names that task in its
  contract's `composedBy`, and a shared need's relay node is composed by its first waiter (`composerOf` of
  `cli/src/harness/graph.ts`): its findings of the composition rules (`runtime.compositionRules` of
  [policy/quality.yaml](../../policy/quality.yaml)) on its own allowPaths are deferred to that task, whose check judges the
  module in full, and so does the workflow's final verify before the workflow is done; a module whose task names no
  composer answers for them itself (`cli/src/core/check/composition.ts`). The tail of every red step's output, secrets redacted, is kept as the task's
  evidence and `starci task status <task>` prints it.
- **CI tier**: after the push, on main. Nobody waits for it unless `requireCi` lists the action.
- **The app's own scripts**: hooks and CI steps the app wires (format check, stylelint, `starci app check`, green only with zero
  error findings that the branch profile does not report), each under the
  branch profile of the branch it judges (PROJECT-LINT-2). The harness does not call them; they run in the app's CI.

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
| app CLI `@starci/hfs` (enforcers `hfs`, `machine`) | the app root and both sides | apps | the app's scripts and CI (`starci app check`) | the tree against the slot manifest, `hfs.json`, generated contracts, catalogs, the import graph |
| gate `sonar-new-code` (enforcer `sonar`) | each repository | `be`, `fe`, `app` | CI | coverage, duplication (message catalogs excluded from duplication only) and issues of new code |
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

## PROJECT-LINT-2 A branch profile lowers only the polish gates

An app's product branch is `dev`, and its `.starcistacks/application-stacks.yaml` may give it a branch profile: per gate
`blocking`, `report` (the gate runs, diff-only against the warm cache as always, prints its findings and writes its records,
but its findings never count toward the verdict) or `off` (not run). A gate the profile leaves out blocks.

```yaml
branches:
  dev: { gates: { lint: report, sonar: report } }
  "ui/*": { gates: { lint: report, sonar: report } }
```

A key is a branch name or a **branch pattern** that covers the feature branches merging into `dev` (`ui/*` covers `ui/3`): a
literal first segment, then `/` and segments in which `*` stands for any characters but `/`, as in a GitHub push filter. A
pattern never starts with `release/` (the release candidates run the release's checks), and one that matches the default
branch is refused like naming it. A branch takes its own entry, else every pattern that matches it, merged gate by gate to
the stricter mode. The branch name alone decides, so a hook and CI agree; an upstream or a merge target never does.

- **What may be lowered.** Only the polish gates `lint`, `sonar` and `codecov`, on a branch `branchProfiles` of
  [policy/loosening.yaml](../../policy/loosening.yaml) allows. `hfs` and the safety gates `types`, `wiring`, `db`, `secrets`,
  `format` and `test` block on every branch, and the default branch (`main`, `master` or `ci.github.defaultBranch`) is never
  declared, by its name or by a pattern that matches it: it always runs the full gate. A declaration that breaks either is `HFS_BRANCH_PROFILE_INVALID` (R378), a hard
  blocker, and lowers nothing.
- **Which profile a run is under.** The branch the run judges chooses it, automatically: in CI a pull request into the default
  branch (`GITHUB_BASE_REF`) runs the full gate, any other pull request is judged as its source branch (`GITHUB_HEAD_REF`) and
  a push as its branch (`GITHUB_REF`); elsewhere the checked-out branch. `starci app check --profile` prints it (`branch profile dev`, or
  `branch profile ui/* (a pattern covering ui/3)`), with one `--gate` only that gate's mode (`packages/hfs/runtime/scripts/hfs/branch-profile.mts`). `starci app check`, the managed
  pre-commit and pre-push hooks and the rendered CI all take it: a push to `dev` runs the reduced CI (the lint job reports,
  the Sonar analysis and the Codecov upload of a reported gate run without the quality gate judging), and a pull request into
  `main` runs the full gate. Each gate a profile does not keep blocking prints one notice naming the branch profile.
- **The lint ratchet.** Where lint reports, a commit never adds lint findings to a file it touches: each touched source file
  has no more ESLint error findings than at the base (the parent commit for the pre-commit hook, `starci app check
  --ratchet`; for the pre-push hook and CI the merge-base with the pushed range or the remote branch, else `HEAD^`), and a new
  file has none (`LINT_RATCHET_RAISED`, R379, an error finding). The range ratchet trusts the lint records first, as every
  family trusts the warm cache: a touched file that the committed cache at the base and this run's
  lint records both hold, with no rule's count risen, is settled without a child, so a first push of a profile branch, whose
  base is far back, does not lint the whole diff twice. Every other file has both versions linted through the side's installed
  config, in children of at most `RATCHET_TEXTS_PER_CHILD` texts (`packages/hfs/lint/ratchet.mts`), so the heap of one child
  stays bounded; the run prints how many files the records settled and how many were linted. The findings a file already
  carried stay report-only.
- **How an agent works on a profile branch.** It fixes every finding of a blocking gate, `hfs` and the safety gates above
  all, and every `LINT_RATCHET_RAISED`; it reads the findings a run marks report-only and never chases them, so a touched
  file is left with no more lint findings than it had, never cleaned on the side.
- **Promotion.** Moving `dev` to `main` is a named step, a pull request (or merge) into `main`, which runs the full gate:
  every report-only finding counts again there, so whoever promotes fixes what the full gate refuses first.

## PROJECT-LINT-3 An app extends the law through rule packs and package slot manifests

An app's own laws (a block library's shape, a spec schema, a naming rule of its modules) belong to the app, never to the generic harness, and
they are still machine-held, through two extension points that only add.

- **Rule packs.** `hfs.json` `rulePacks: ["@scope/hfs-rules"]` names installed packages. Each exports `./rule-pack`, a
  `starci/rule-pack@1` manifest (`packages/hfs/runtime/scripts/lib/rule-packs.mts`) whose every rule carries an `id` (`NIVO-BLOCK-1`), a
  finding `code`, a `severity` (`error` or `warning`), the `spec` file of the package that proves it, its `doc` (a file of the package or an
  https link) and exactly one engine: `check`, a machine rule `starci app check` runs over the tracked files, or `eslint`, a rule the canon
  factories (`starciBeConfig`, `starciFeConfig`, `starciBePackagesConfig`) load for the sides it names. Because the factories load them, the
  law that tool configs call only the canon factories and define no local rule still holds.
- **A pack only adds.** A rule with any other key (an `off`, an `overrides`), a code the harness reports, an id or a code another pack holds,
  a rule that throws and a finding without a path refuse the whole pack (`HFS_RULE_PACK_INVALID`, R381, a hard finding of the hfs family),
  and a refused pack lends nothing; the lint run then stops instead of linting without the app's law.
- **Pack findings go through the same policy.** A `check` rule is an hfs finding: it blocks on every branch, like hfs. An `eslint` rule is a
  lint finding: it follows the lint gate, so a branch profile that reports lint reports it and the lint ratchet (PROJECT-LINT-2) still holds
  it on the files a commit touches. A new pack rolls out with the ratchet: new code is clean from day one, existing findings burn down.
- **Package slot manifests.** A root workspace package may declare `packages/<name>/slots.yaml` (`starci/package-slots@1`,
  `packages/hfs/runtime/scripts/hfs/package-slots.mts`): folder slots with placeholders (`src/blocks/<id>/`), the files each instance
  `requires` and `allows`, glob and file slots, and `closed` (default true: every file below `src/` belongs to a slot). hfs holds the
  package to it as it holds the be and fe sides to theirs (`HFS_PACKAGE_SLOT_MISSING`, `HFS_PACKAGE_SLOT_DISALLOWED`,
  `HFS_PACKAGE_SLOT_UNPLACED`, `HFS_PACKAGE_SLOTS_INVALID`, R382).
- **Package coverage follows the slots.** Every file of a package is measured at 100 per file in the back end's unit run (BE-TEST-13), but
  its barrels and type files and each slot that opts out with `coverage: { none: "<reason>" }`; an opt-out without its reason is refused.
  A package without a manifest keeps the harness's default scope (its `workbench/`, `public/` and `client/` subtrees unmeasured).

## Read with

[README.md](README.md) (the profiles a project picks), [anatomy.md](anatomy.md) (the packages each gate judges),
[work.md](work.md) (the Work facts listed above), [stacks.md](stacks.md), [lite.md](lite.md) and [full.md](full.md)
(how an edition changes which slots and rules apply), [check-cache.md](check-cache.md) (the committed result
cache of `app check` and unit coverage).
