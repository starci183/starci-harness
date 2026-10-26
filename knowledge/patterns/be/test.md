---
slots: [be.cli, be.tests, be.root-e2e]
---
# Test

Decides where a back-end spec lives, how its subject is built, which doubles it uses, what it asserts, how the real world boots and
what coverage measures. The spec-required roles are `ruleParams.be.unitRoles`, the measured roles `ruleParams.be.logicRoles` of
the `coverage: required` slots, the thin roles `ruleParams.be.thinRoles`; pattern scenarios are `ruleParams.be.patternScenarios`.

Work rule: write or update the spec of every source you add or change, even when the goal does not ask for it, and run only those
specs and the specs that import them; the whole unit suite runs at push, and integration and e2e run only when asked.

## BE-TEST-1 Four test kinds, placed by folder and suffix
A unit spec sits beside its subject as `<name>.<role>.spec.ts`: required beside every spec-required role (each `*.service.ts`, each
cli command) and beside a webhook or realtime door that has no service of its own; optional beside any other logic-role file of a
measured slot, which may instead be covered through its service's spec. Any other `*.spec.ts` outside the test slots is a finding,
apps included. Integration is `be/src/tests/integration/<capability>/*.integration-spec.ts` (capability modules on real
infrastructure through `useTestWorld({ modules })`; every integration of `modules/integrations/<provider>/` has one). E2E is
`be/src/tests/e2e/<area>/*.e2e-spec.ts` through `useTestWorld({ apps })`. Contract is
`be/src/tests/contract/<provider>/*.contract-spec.ts` against provider sandboxes, failing without sandbox config. `be/src/tests/world/`
is the only test infrastructure (global setup and teardown, `use-test-world.ts`, `fakes/<provider>/` network-edge fakes with
`failNext`, `replayWebhook` and `delay`, and `test-world.config.ts` declaring `defineTestWorld({ stack, stacks, fakes })`); typed
doubles and builders live in `be/src/tests/fixtures/`. One `be/jest.config.js` (the rendered preset call) declares exactly the
`unit`, `integration`, `e2e` and `contract` projects; the unit project maps nothing into the other test slots. Scripts are `test`,
`test:integration`, `test:e2e` and `test:contract`, the last three entered through `starci gate run --root <app> --tests <name>` and
depending on `typecheck:tests` (`be/src/tests/tsconfig.json`, excluded from the main tsconfig). None of them enters a commit hook,
lint-staged, the default typecheck, coverage or automatic CI; a kept e2e workflow is manual dispatch only.

Why: one placement rule makes discovery mechanical, and keeping slow suites out of automatic gates keeps those gates fast and
deterministic while the manual suites still refuse code that does not compile.

Enforced by: R47 BE_TEST_TOPOLOGY, R102 BE_SPEC_PLACEMENT, R12 HFS_E2E_IN_AUTOMATIC_GATE, R112 BE_INTEGRATION_SPEC_MISSING.

## BE-TEST-2 Build the subject through the Nest testing module, providers only
A unit spec of every logic role builds its subject with `Test.createTestingModule({ providers: [Subject, { provide: TOKEN, useValue:
double }] }).compile()` and takes it with `moduleRef.get(Subject)`: no `new` of the subject, no `imports` of a real module, no
`overrideProvider` or `overrideModule`. It calls public methods and asserts the returned outcome or the state the doubles recorded;
it never calls a protected hook and never reads source to assert architecture (that is lint). A value role (`ruleParams.be.valueRoles`,
a real boundary `*.schema.ts`) is parsed directly: `expect(orderSchema.safeParse(input).success).toBe(false)`.

Why: a hand-built subject drifts from its real constructor and decorators, and a module that imports or overrides quietly grows
into a partial application.

Enforced by: R48 BE_SPEC_QUALITY, R281 BE_SPEC_FORM_ALL_ROLES.

## BE-TEST-3 The providers list equals the constructor dependencies
The providers besides the subject are exactly the constructor's dependencies, each through the exported token of its injector; a
missing and an extra provider are both findings. A dependency the subject does not hold (the clock owned by `fakeCache(clock)`)
is not provided.

Why: an extra provider hides a dependency the subject lost, and equality makes the constructor the single source.

Enforced by: R48 BE_SPEC_QUALITY, R85 BE_RAW_INJECT.

## BE-TEST-4 Doubles come from the kit
Doubles come only from `@starci/jest-preset`: `mockEntityManager`, `fakeTransaction`, `fakeCache`, `fakeLock`, `recordingEventBus`,
`recordingQueueOutbox`, `fakeInbox`, `FakeClock`, `fakeIds`, `mock<T>()`, `builder` and the Outcome matchers (`toBeRefused`,
`toSucceedWith`). A known infrastructure token takes its matching kit double; options tokens take builders or literals; anything
else `mock<T>()`. `mockEntityManager({ method: [Entity, result] })` is typed against the entity and throws on any unstubbed method, so
a missing stub proves the call did not happen; `fakeTransaction` records commits, rollbacks and the writes of each; `fakeCache` and
`fakeLock` behave (TTL, contention, expiry, fence) against the clock; the recording bus and outbox expose what was published or
enqueued and whether it was in a transaction. Banned in specs: any cast, an ambient clock, `jest.mock` of an own module or library,
`process.env`, an ad-hoc object standing in for an EntityManager, a source read.

Why: one double per dependency kind makes a stale spec fail to compile instead of staying green through a cast, and strict fakes
turn an unexpected call into a failure instead of a silent `undefined`.

Enforced by: R48 BE_SPEC_QUALITY, R72 BE_TYPE_ESCAPE, R79 BE_AMBIENT_CLOCK.

## BE-TEST-5 Each dependency kind brings its mandatory cases
Every service spec covers, per method, the input boundaries (zero, empty, max, rounding), paging and ordering, every declared
Outcome, every domain throw and an idempotent re-run, plus the cases of each dependency kind its constructor holds:
- EntityManager: found, not found, the ownership `where`, take and order, exact written fields, nothing written on refusal, a
  database error.
- Transaction: commit, rollback with no side effect when the body throws, outbox written inside the transaction.
- Options (real values from builders): every flag branch, an optional integration absent, boundary values.
- Clock and ids: before, at and after deadlines, expiry, ordering.
- Buses: the exact message dispatched, nothing on refusal, a failed command mapped to an Outcome.
- Services and ports of other capabilities (`mock<T>()`): every Outcome they return; allowed, refused, unavailable.
- Integration wrappers (`mock<Wrapper>()`, never the raw library): success, missing, malformed, timeout or unavailable, duplicate,
  partial. A wrapper's own spec doubles its transport token with payload fixtures and maps 404, 401, 5xx, timeout and bad JSON to
  Outcomes.
- Cache: hit, miss, TTL expiry, nothing cached on error, invalidation, per-principal key.
- Lock, fence or hold: acquired, contended, released on error, expiry.
- Event bus, queue outbox, scheduler: emitted exactly once, nothing on refusal, idempotency key present.
- Request context and locale (real values): owner, other, admin, anonymous, each locale.
- Framework: the real `Reflector`; metadata present and absent.
- Registries and multi-providers: empty, one, many, unknown key, duplicate.
- Primitive tokens (real values): blank and boundary values where the service branches.
- Saga steps: all in order; step N fails and earlier steps compensate in reverse; re-run is idempotent.

Why: a fixed case list per dependency kind turns "write a good test" into a checklist whose branches add up to full coverage.

Enforced by: R48 BE_SPEC_QUALITY, R273 HFS_COVERAGE_BELOW.

## BE-TEST-6 Mirror the canonical example specs
A service spec follows the shape of the example reference `service-spec`: one spec of a transactional service providing only its
constructor dependencies, asserting success, a refusal and a replayed duplicate together with the transaction and the published
events; one of a service reading through a cache and a provider client, asserting the cache TTL through the cache double and the
refusal of an unknown token. Test names are English sentences.

Why: two concrete specs fix the reading of every other rule: which doubles, what is provided, what a stub's absence proves.

Enforced by: R48 BE_SPEC_QUALITY.

## BE-TEST-7 The feature tier is thin, so only the spec-required roles have unit specs
A feature-tier file of a thin role maps its parameters and makes one delegating call into `modules/` (a service, a bus, the event bus
or a queue producer), with no branch, loop, ternary, `try`, `throw` or computation. Business logic lives in `modules/**`;
orchestration (step order, compensation, claim, fencing, retry) lives in the platform capabilities. A cli command and a feature-tier
service (the saga orchestrator) are thin and still owe their spec asserting the delegation. The feature tier is proved by integration
and e2e, never measured; a unit spec of a handler, resolver, controller, consumer, mapper, entity, module or composition is a
finding.

Why: a branch hidden in a door is one no unit spec reaches; a mechanical feature tier moves every decision where coverage measures
it.

- When a decision is tempting in a door → move the `if`, the loop and the manager use into the service and test it there.

Enforced by: R203 BE_FEATURE_THIN, R47 BE_TEST_TOPOLOGY.

## BE-TEST-8 Pure helpers are covered through their services
A pure helper or decide function a service calls has no spec of its own; the service spec reaches its branches. A helper that needs
its own spec to reach full coverage is doing a service's work and moves into a service.

Why: one spec per service keeps discovery mechanical and stops a helper from being tested alone while its real caller is not.

Enforced by: R47 BE_TEST_TOPOLOGY.

## BE-TEST-9 What is asserted
Assert the refusal or error code, the order of side effects, returned rows, persisted state and the `where` that holds ownership, as
relevant. Every test holds a behaviour or state assertion; zero assertions or only `toBeDefined()` prove nothing. Titles are English
sentences stating the behaviour (`it("refuses a buyer who already owns the offer", ...)`).

Why: assertions on code and state prove behaviour; messages and call counts alone do not.

- When the claim is "nothing was written after a refusal" → an unstubbed `save` on `mockEntityManager` proves it.

Enforced by: R48 BE_SPEC_QUALITY, R281 BE_SPEC_FORM_ALL_ROLES.

## BE-TEST-10 What is not asserted
No call-only spec, no e2e step that checks only a success flag (assert the persisted row), no sleep (wait with `waitFor` deadlines),
no guard, provider or DI override under `be/src/tests`, no live model call in e2e, no branched outcome inside one flow step, no
skipped, focused or todo test. Only a contract spec may call a provider sandbox.

Why: a test that cannot fail for the wrong reason is not evidence, and time-based waiting hides races.

Enforced by: R48 BE_SPEC_QUALITY.

## BE-TEST-11 Names
The outer suite names the class under test; nested suites name public methods or scenarios.

Why: a failure names the subject it measures.

Enforced by: R48 BE_SPEC_QUALITY.

## BE-TEST-12 Integration and e2e boot the real world
Integration and e2e boot through `useTestWorld`. An e2e boots the real apps through `useTestWorld({ apps })` against the app's own
stack running real (database, cache, identity provider with its realm, mail host, and a local cluster when the app drives one):
global setup attaches to a warm stack or starts its own, teardown stops only what it started, and the real migrations run once over
the cli's connection list. Only external SaaS the team does not operate is faked, at the network edge (`world.fake.<provider>`); a
stateless compute service may be faked with a declared reason, a database, cache, identity provider, mail host or queue never. Real
services fail on purpose through `world.infra.<service>.latency(ms)`, `.cut()` and `.restore()`. No provider, DI token or guard is
overridden; identity fixtures issue real tokens; state is asserted after `waitFor`. Full proves app composition with this boot; lite
compiles the module graph with doubles (`starci app check --wiring`) and proves declared patterns in integration specs. Database
doubles prove local behaviour only; transaction, lock and crash claims need the real store. Configuration is substituted by passing
options, never by patching `process.env`.

Why: a hand-assembled module can pass while the real app cannot start; only the edition's boot proof checks the actual composition,
and only real services prove behaviour against them.

Enforced by: R47 BE_TEST_TOPOLOGY, R48 BE_SPEC_QUALITY, R272 BE_APP_BOOT_PROOF_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.

## BE-TEST-13 Coverage is per file on the logic roles of the measured slots, from one derivation
The unit project measures every logic-role file inside a `coverage: required` slot (the logic of `be/src/modules/**`) at full
per-file lines, branches, functions and statements, and nothing else; the scope is derived once from the slot manifest and rendered by
`starci app sync` into the managed `be/jest.config.js`, which is never hand-edited. `test` runs the unit project with coverage and
fails below the bar. Types are checked once by `typecheck` and `typecheck:tests` (ts-jest diagnostics off); the unit project overlays
the compiler settings that keep emitted helpers and decorator metadata from adding branches. `starci app check --coverage-from
be/coverage/lcov.info` checks every tracked logic file of that scope; a missing record or metric fails, and the report lists what is
outside the scope. No file carries an inline coverage ignore.

Why: decisions live only in the modules' logic, so a per-file bar on exactly those files is meaningful; a whole-tree average rewards
trivial files and hides an untested branch.

Enforced by: R204 HFS_COVERAGE_SCOPE_DRIFT, R273 HFS_COVERAGE_BELOW, R47 BE_TEST_TOPOLOGY.

## BE-TEST-14 Sonar and Codecov judge the same scope
The unit run writes `be/coverage/lcov.info`, and both coverage services import it with the one scope of BE-TEST-13: Sonar reads that
report and excludes from coverage exactly the complement of the measured files; Codecov holds the measured roots and the patch, with
one component per service app and one for platform. `starci app sync` renders both files from the same derivation; CI uploads with
OIDC, with no secret. The feature tier, declaration and composition files, tests and the front end are never coverage targets.

Why: one denominator everywhere makes a gap in any logic file visible and blocking wherever it is read.

Enforced by: R11 HFS_SONAR_CONFIG, R204 HFS_COVERAGE_SCOPE_DRIFT.

## BE-TEST-15 Spec prose is English
Identifiers, suite and test names, comments and fixture strings are English; other languages appear only in message catalogs and
fixtures whose purpose is localized text.

Why: one language keeps failure output searchable and reviewable by every contributor.

Enforced by: R89 BE_SOURCE_FORM.

## BE-TEST-16 Test data comes from builders
Builders live only in `be/src/tests/fixtures/builders/<area>.builder.ts`, one per area; `*.repository.ts`, `*.fixture.ts` and
`*.factory.ts` test files do not exist, and no other test module creates persisted rows. Pure builders (`commissionRow(overrides)`)
return typed objects with valid defaults for unit inputs and `mockEntityManager` results; persisting builders
(`orderBuilder(world.db.primary).pending().build(overrides)`) insert real rows through entity classes and create their own parent
chain. A spec never hand-builds rows through raw SQL or EntityManager writes (reads are fine) and never repeats the same entity
literal. Everything under `be/src/tests` keeps database constraints on. Builders only arrange data (no assertion or test framework
import) and have deterministic defaults: fixed or `fakeIds` ids, fixed dates, no ambient randomness. Raw SQL in a builder is allowed
only for an area with no entity classes.

Why: a row chain written in each spec drifts from the schema and hides which value matters; constraints on make an impossible
arrangement fail at the builder.

Enforced by: R98 BE_TEST_BUILDER_HOME, R99 BE_TEST_ROW_BY_BUILDER, R100 BE_TEST_CONSTRAINTS_ON, R101 BE_TEST_BUILDER_ARRANGES.
