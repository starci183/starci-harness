---
slots: [be.cli, be.tests, be.root-e2e]
---
# Test

Where a back-end spec lives, how its subject is built, which doubles it uses, what it asserts and what coverage
measures. Which side is tested and what an op runs is shared ([SHARED-TEST-1 … 3](../shared/test.md)); the jest
projects, doubles and coverage mechanics are the `@starci/jest-preset` README. The spec-required roles are
`ruleParams.be.unitRoles`, the measured roles `ruleParams.be.logicRoles`, and a slot's own measured files its `logic`.

## BE-TEST-1 Test kinds are placed by folder and suffix

A unit spec is `<name>.<role>.spec.ts` beside its subject: required beside every `*.service.ts`, every `*.cli.ts` and a
webhook or realtime door; optional beside any other logic-role file (`policy`, `mapper`, `client`, `guard`, `schema`,
`processor`, `step`, ...) and beside a logic file its slot declares (`logic`: `passport.tokens.spec.ts` beside
`passport.tokens.ts`). A spec of a handler, resolver, controller, module or app file, or of any other file, is a finding. Integration
specs are `src/tests/integration/<area>/*.integration-spec.ts` on real infrastructure through `useTestWorld`; contract
specs `src/tests/contract/<provider>/*.contract-spec.ts`; full adds `src/tests/e2e/<area>/*.e2e-spec.ts`. Test
infrastructure lives only in `src/tests/world/`, shared data in `src/tests/fixtures/`. Integration and contract run
through `npm run test:integration` (after `typecheck:tests`), never in a hook or the default typecheck.

Why: one placement rule makes discovery mechanical, and slow suites stay out of fast gates.

Enforced by: `unit-test-colocated`, `test-world-files`, `tests-infra-only-in-world`, `test-world-shape` (R47),
`spec-placement` (R102), R112.

## BE-TEST-2 The subject is built by the testing module from providers only

A unit spec builds its subject with `Test.createTestingModule({ providers: [Subject, ...doubles] }).compile()` and
`moduleRef.get(Subject)`, usually in one `build()` function returning the subject and its doubles. No `new` of the
subject, no `imports`, no `override*`, no `jest.mock`. The providers besides the subject are exactly its constructor
dependencies: an injector's exported token (`{ provide: CLOCK, useValue: clock }`) or a domain service class
(`{ provide: MembersService, useValue: mock<MembersService>() }`). A `*.schema.ts` is parsed directly.

Why: a hand-built subject drifts from its real constructor, and an extra provider hides a dependency the subject lost.

```ts
const build = async () => {
    const members = mock<WorkspaceMembersService>()
    const orders = mock<OrdersService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            OrdersReadService,
            { provide: WorkspaceMembersService, useValue: members },
            { provide: OrdersService, useValue: orders },
        ],
    }).compile()
    return { reads: moduleRef.get(OrdersReadService), members, orders }
}
```

Enforced by: `spec-builds-with-testing-module`, `spec-no-new-subject`, `spec-module-definition-only-providers`,
`spec-no-module-mock`, `unit-spec-providers` (R48, R281).

## BE-TEST-4 Doubles come from the kit

Every double comes from `@starci/jest-preset`: `mockEntityManager` and `fakeTransaction` for the manager, `FakeClock`,
`fakeIds()`, `recordingQueueOutbox()`, `fakeInbox()`, `fakeCache`, `fakeLock`, `builder` for options, and `mock<T>()`
for everything else; the token-to-double table is `ruleParams.be.specDoubles`. No cast, ad-hoc manager object,
ambient clock, `process.env` or source read in a spec.

Why: one typed double per dependency kind makes a stale spec fail to compile, and a strict double turns an unexpected
call into a failure instead of a silent `undefined`.

Enforced by: `spec-infra-double-from-kit`, `spec-typed-entity-manager`, `no-return-only-generic`, `spec-no-source-read`
(R48), `no-ambient-clock` (R79), `no-direct-env-read` (R43).

## BE-TEST-5 Each method covers its branches and its dependencies' answers

Per public method: every branch, boundary (empty, zero, max, clamp) and refusal code; per dependency kind its cases:
the manager (found, missing, the scoping parameters, nothing written after a refusal), a transaction (commit, rollback
with no effect), the clock and ids (before, at and after a deadline; exact ids), a queue producer or outbox (enqueued
once, inside the transaction, nothing on refusal), the inbox (first and duplicate claim), another service (each answer
and each refusal, and nothing read after a refused membership), an integration client (success, rejected, unavailable,
malformed).

Why: a fixed case list per dependency kind turns "a good test" into a checklist whose branches add up to full
coverage.

Enforced by: R273 (per-file coverage); the case list is review only.

## BE-TEST-7 The feature tier is thin and unmeasured

A handler, resolver, controller, processor, step or mapper of `features/` maps its parameters and makes one
delegating call into `modules/`; it is proved by the service spec, the boot proof and integration specs, never
measured. A cli command and a webhook or realtime door still owe their spec of the delegation.

Why: a branch hidden in a door is one no unit spec reaches; a mechanical feature tier moves every decision where
coverage measures it.

- When a decision is tempting in a door → move the `if`, the loop and the manager into the service and test it there.

Enforced by: `feature-thin` (R203), `unit-test-colocated` (R47).

## BE-TEST-9 A test asserts behaviour, in exact values

Every test asserts a result, a refusal code or a recorded state, in exact values (ids from `fakeIds()`, dates from
`FakeClock`), never only that a call happened and never `expect.any(String)`. The outer `describe` names the class, a
nested one the method, and each `it` is an English sentence of the behaviour (`"reads nothing when membership is
refused"`). No sleep (integration waits with `waitFor` and a deadline); a skipped or focused test is SHARED-LOOSENING-1.

Why: a test that cannot fail for the wrong reason is evidence; a call-count alone is not.

Enforced by: `no-call-only-spec`, `spec-behavior-assertion`, `spec-exact-values`, `spec-no-skip`, `no-sleep-in-flow`
(R48, R281).

## BE-TEST-12 Integration specs boot the real world; the app is proved by its boot

Integration specs boot capability modules through `useTestWorld({ modules })` on the local stack (lite: the db
CLI database and the declared Redis), fake only external providers at the network edge, override no provider, guard or
token, and assert persisted state. Lite proves composition by compiling the real AppModule graph (`starci app check
--wiring`) and each declared pattern in integration specs; full boots the real apps for e2e
(`useTestWorld({ apps })`). Configuration is substituted by passing options, never by patching `process.env`. A
provider whose contract requires TLS (an OIDC issuer and its JWKS) is faked over HTTPS (`defineHttpFake({ https: true })`,
`@starci/test-world` README "Fakes"), and the app trusts the run's fake CA (`w.fake.<name>.ca`) through its HTTP client's
`trustedCa` (BE-INFRA-2), passed as `HTTP_TRUSTED_CA` in the environment the world builds, never by turning verification
off (SHARED-LOOSENING-1, marker `tls-unverified`), so the issuer check a spec proves is the one production runs.

Why: a hand-assembled module can pass while the real app cannot start, and transaction, lock and fence claims need the
real store.

Enforced by: `tests-no-override`, `e2e-uses-production-transport`, `e2e-asserts-persisted-state` (R47, R48), R272, R284.

## BE-TEST-13 Coverage is 100 per measured file, from one derivation

The unit project measures every logic-role file of the measured roots (`src/modules/{domain,integrations,platform}/*`,
minus `errors/`, `messages/`, `persistence/`), and every file a measured slot declares in `logic`, at 100 lines, branches,
functions and statements per file. A file that carries logic without a role suffix is declared by its slot, never by a new
role name. The scope is rendered once into the managed `jest.config.js`, `sonar-project.properties` and `codecov.yml`; no
file carries a coverage ignore.

Why: decisions live in the modules' logic, so a per-file bar on exactly those files is meaningful, and one denominator
everywhere makes a gap visible wherever it is read.

Enforced by: R204, R273, R11.

## BE-TEST-16 Test data comes from builders

Test data is built with the kit's `builder<T>(defaults)`: a function answering valid deterministic defaults with
overrides (`orderOf({ status: "draft" })`). A builder used by one spec may live in it; a shared one lives in
`src/tests/fixtures/builders/<area>.builder.ts`, and any builder that writes rows lives only there. A spec never
inserts rows by hand or repeats a row literal, builders never assert, and nothing under `src/tests` drops a
constraint.

Why: a row written in each spec drifts from the schema and hides which value matters.

```ts
const orderOf = builder<OrderRow>({ id: "order-1", workspace_id: "ws-1", status: "confirmed", created_at: NOW })

orders.find.mockResolvedValue(orderOf({ status: "draft" }))
```

Enforced by: `persisting-builder-in-builders-slot`, `spec-no-raw-insert`, `spec-no-repeated-row-literal`,
`builder-arranges-only`, `tests-keep-constraints` (R98, R99, R101, R100).
