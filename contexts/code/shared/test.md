# Test

Which side carries tests, what a coding op tests and what it runs. How a back-end spec is placed, built and asserted
is [be/test.md](../be/test.md); the jest projects, doubles and coverage are `@starci/jest-preset`'s README.

## SHARED-TEST-1 The back end is tested; the front end has no tests

Tests live on the back end only, in the four jest projects of `@starci/jest-preset` (`unit`, `integration`, `e2e`,
`contract`) placed by BE-TEST-1. The front end has no spec file, test folder, runner configuration, test script or
test dependency: a front-end change is proved by the typecheck and lint gates and, for a screen, by UAT and the owner's
review.

Why: front-end behaviour that matters is drawn by the grammar and judged by its lint and by UAT walks; a unit suite
over screens would test the framework and freeze markup.

Enforced by: R97 FE_NO_TESTS, R47 BE_TEST_TOPOLOGY. Open: the `fe` profile of
[policy/quality.yaml](../../../policy/quality.yaml) still lists `unit` in its CI tier
([decisions/open-core.md](../../decisions/open-core.md), contradiction "FE tests").

## SHARED-TEST-2 An op tests what it changed and runs only those tests

An op that adds or changes a back-end source writes or updates its spec in the same task, even when the goal does not
mention tests, and runs only the specs related to the files it changed, which hold every logic file it changed at the
app's per-file coverage. The whole unit suite with the per-file coverage of every measured file, and the integration,
e2e and contract suites, are CI's or a `verify` task's, never a coding op's. No test is skipped,
focused or weakened to pass (SHARED-LOOSENING-1).

Why: a scoped run keeps a task fast and deterministic; CI judges the rest after the push and a red CI becomes its own
scoped task.

```sh
cd be && npx jest --selectProjects unit --findRelatedTests <changed files>
```

Enforced by: R47 (`staged-spec-presence`, BE_UNIT_SPEC_NOT_STAGED); the contract's `tests-pass` check names the
command and narrows its coverage to the changed logic files (`coverage: changed`, `cli/src/harness/coverage-scope.ts`).

## SHARED-TEST-3 An op writes no test kind its edition forbids

An op writes only the test kinds its edition has ([project/lite.md](../../project/lite.md) "What CI runs" lists what
a lite app lacks), so a lite op writes no `*.e2e-spec.ts` and adds no e2e script, whatever a full-edition rule says.

Why: the slot of a forbidden kind does not exist in a lite tree, so the spec could never be placed or run.

Enforced by: R212 HFS_EDITION_INVALID (forbidden slots present), R272 BE_APP_BOOT_PROOF_MISSING. Open: R32 and R47
still require the e2e world ([decisions/open-core.md](../../decisions/open-core.md), contradiction "R32, R47 vs R212,
R272").
