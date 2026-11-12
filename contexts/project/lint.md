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

An app's product branch is `dev` ([branches.md](branches.md) PROJECT-BRANCH-1), and its `.starcistacks/application-stacks.yaml` may give it a branch profile: per gate
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
  a push as its branch (`GITHUB_REF`); the managed pre-push hook names `main` itself (`STARCI_JUDGED_BRANCH`) for a push of `main` or a release tag; elsewhere the checked-out branch. `starci app check --profile` prints it (`branch profile dev`, or
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
- **New code is never loosened.** A profile lowers old debt only. Where a profile reports lint or sonar, the lines this branch changed
  since its merge-base with `main` (the `git diff -U0` of the merge-base with `origin/main`, else `main`, to the work tree, the diff the
  Sonar new-code prediction reads: `newCodeSince` in `packages/hfs/cache/app-families.mts`) are judged as `main` judges them
  (`packages/hfs/cache/new-code.mts`, R387, both plain errors the profile never marks report-only):
  - **Lint.** An ESLint error finding on a changed line is blocking `LINT_NEW_CODE_FINDING`, listed in place of its report-only
    entry; a finding on an untouched line stays report-only. The lint ratchet above stays.
  - **Coverage.** The predicted new-code coverage of the changed lines (`check-cache.md` "Sonar and Codecov", computed from the unit-spec
    records of this run) below the minimum `newCode.coverage.minPercent` of the Sonar gate `main` enforces
    (`packages/hfs/runtime/knowledge/sonar-gate.yaml`) is blocking `COVERAGE_NEW_CODE_BELOW`; a change with no coverable line is
    not judged. The Sonar server's quality gate and the Codecov upload stay report-only, since they depend on servers.
  - **Local Sonar scan.** A whole `app check` runs the real scan on a profile branch as a report: findings of a family the profile
    reports never skip it, and its verdict never counts there.
- **How an agent works on a profile branch.** It fixes every finding of a blocking gate, `hfs` and the safety gates above
  all, every `LINT_RATCHET_RAISED`, every `LINT_NEW_CODE_FINDING` and every `COVERAGE_NEW_CODE_BELOW` (the lines it changed are clean and covered); it reads the findings a run marks report-only and never chases them, so a touched
  file is left with no more lint findings than it had, never cleaned on the side.
- **Promotion.** Moving `dev` to `main` is the release of [branches.md](branches.md) PROJECT-BRANCH-1: the full gate runs on it (a
  push of `main` or of a release tag is judged as `main` whatever branch is checked out, `STARCI_JUDGED_BRANCH` of the managed pre-push
  hook), and every report-only finding counts again there, so whoever promotes fixes what the full gate refuses first.

## PROJECT-LINT-3 A project extends the law through its ext folder

A project's own laws (the shape of one of its packages, a schema its specs follow, a naming rule of its modules, a generated file that must be
fresh) belong to the project, never to the generic harness: the harness only runs them. They live in one place, the folder `ext/` at the app
root (slot `app.ext`), with one subfolder per tool, and they are recorded as decisions in the project's `.starciwork/concepts`. There is no
extension point inside a package: a rule reaches a package by naming its paths. Outside `ext/` a repository keeps no check, lint rule or
lint plugin of its own (R103).

- **The manifest declares everything.** `ext/manifest.json` (`starci/project-ext@1`, `packages/hfs/runtime/scripts/lib/project-ext.mts`) holds
  `api`, the extension API version the folder targets, `rules`, `checks` and `packages`. Every rule carries an `id` (`APP-SHAPE-1`), a finding `code`, a
  `severity` (`error` or `warning`), its `doc` (a file below `ext/` or an https link), `appliesTo` (app-relative globs that start at a named
  folder: the paths the rule judges) and exactly one engine:
  - `hfs`: a file of `ext/hfs/` whose default export is `(context) => findings`. `starci app check` runs it over the tracked files `appliesTo`
    matches; `context` is `{ api, repoRoot, files, read }` and a finding `{ path, message, line?, column? }`.
  - `lint`: `{ tool: "eslint", file }`, a file of `ext/lint/` whose default export is an ESLint rule. The canon factories (`starciBeConfig`,
    `starciFeConfig`, `starciBePackagesConfig`) load it over the files `appliesTo` names inside their own scope, under the plugin `project-ext`,
    so the law that tool configs call only the canon factories and define no local rule still holds: a declared file of `ext/lint/` is the
    one rule file a repository may hold (`HFS_TOOL_CONFIG_LOCAL`, R16, judges the same file undeclared, and a rule file anywhere else).
- **Project checks.** A check that reads the whole app as a program, where a rule over files is the wrong shape (an id no file may still
  write, a generated list that must match its source, a generator's `--check`), is a file `ext/checks/<name>.mjs` that the manifest's `checks`
  declares as `{ "id": "<kebab-id>", "run": "ext/checks/<name>.mjs", "why": "<what it guards>" }`. `starci app check` runs every declared
  check as its own step, `checks`, wherever the hfs gate runs (CI's included): with this Node, from the app root, one after another; exit 0 is
  green, any other exit is `HFS_PROJECT_CHECK_FAILED` (R402) naming the check, its exit and the last lines it printed, an hfs finding that
  blocks like hfs. Its verdict is never cached, since a check reads what it reads. A file of `ext/checks/` no declaration names, a
  check-named file in `scripts/` or `tools/` and a package script that runs one are `HFS_REPO_LOCAL_CHECK` (R103); a package script that
  runs a declared check is the developer's shortcut to it. `starci app sync` names a loose check-named script and the declaration to add,
  and never moves it: a check may resolve paths from its own folder, and its `why` is the project's to write. A check that re-implements a
  canon or harness check is proposed to the harness instead.
- **Always run.** `starci app check` loads the manifest and runs every hfs rule and project check on every run that selects the hfs gate, so the
  pre-push hook and CI do; a finding of a refused extension is reported whatever paths the run is scoped to.
- **What is declared must be there.** A declared rule file or check file that is not found, a rule file of `ext/hfs/` or `ext/lint/` that no rule
  declares, an `ext/` folder without its manifest, a rule that throws and a finding without a path are red (`HFS_EXT_INVALID`, R381, a hard
  finding of the hfs family).
- **An extension only adds.** A rule or a manifest with any other key (an `off`, an `overrides`, a `disable`), a severity other than `error` or
  `warning`, a code the harness reports and an id or code declared twice refuse the whole extension (`HFS_EXT_INVALID`); a refused extension
  lends nothing, the check is red, and a lint run stops instead of linting without the project's law. No key of the manifest reaches a rule of
  the harness, so no extension can turn one off or lower it.
- **The API is versioned.** `api` names the extension API the folder was written for (`PROJECT_EXT_API`, 1; the `@starci/hfs` README
  "Extension API" lists what it covers). A breaking change raises the number, and `starci app check` refuses a manifest of another number with
  `HFS_EXT_API_MISMATCH`, naming the project that needs the update; until then none of its rules runs and the check is red.
- **A finding is reported under the rule's own code.** The report names the rule's `id` and its `doc` where a harness finding names its
  catalog entry; the harness's failure-code catalog holds no project code.
- **Findings go through the same policy.** An hfs rule and a project check are hfs findings: they block on every branch, like hfs. A lint rule is
  a lint finding: it follows the lint gate, so a branch profile that reports lint reports it and the lint ratchet (PROJECT-LINT-2) still holds
  it on the files a commit touches. A new rule rolls out with the ratchet: new code is clean from day one, existing findings burn down.
- **A package's slots are declared by the project.** `packages` maps a root package folder (`packages/<name>`) to `{ closed, slots }`
  (`packages/hfs/runtime/scripts/hfs/package-slots.mts`): folder slots with placeholders (`src/parts/<id>/`), the files each instance `requires`
  and `allows`, glob and file slots, and `closed` (default true: every file below `src/` belongs to a slot). A slot names the canon that judges
  its files with `lint` (`be`, the default, or `fe`). hfs holds the package to them as it holds the be and fe sides to theirs
  (`HFS_PACKAGE_SLOT_MISSING`, `HFS_PACKAGE_SLOT_DISALLOWED`, `HFS_PACKAGE_SLOT_UNPLACED`, `HFS_PACKAGE_SLOTS_INVALID`, R382). A package's own
  `slots.yaml` is read for one more minor, for a package the manifest does not declare, with the warning `HFS_PACKAGE_SLOTS_MOVED`.
- **Package coverage follows the slots.** Every file of a package is measured at 100 per file in the back end's unit run (BE-TEST-13), but
  its barrels and type files and each slot that opts out with `coverage: { none: "<reason>" }`; an opt-out without its reason is refused.
  A package no declaration names keeps the harness's default scope (its `workbench/`, `public/` and `client/` subtrees unmeasured).

Known gap: extension API 1 loads ESLint rules only; a Stylelint rule of a project has no engine yet (`lint.tool` other than `eslint` is
refused), so a CSS law of one project is held by a project check until the stylelint canon loads `ext/lint/`. Known gap: the canons do not yet
read a slot's `lint`; the front-end subpaths of a root package are still the fixed ones of the packages lint config.

## Read with

[README.md](README.md) (the profiles a project picks), [anatomy.md](anatomy.md) (the packages each gate judges),
[work.md](work.md) (the Work facts listed above), [stacks.md](stacks.md), [lite.md](lite.md) and [full.md](full.md)
(how an edition changes which slots and rules apply), [check-cache.md](check-cache.md) (the committed result
cache of `app check` and unit coverage).
