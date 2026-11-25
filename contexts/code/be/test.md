---
slots: [be.cli, be.client-cli, be.tests, be.root-e2e]
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
`passport.tokens.ts`). A spec that outgrows its line budget (`ruleParams.common.fileLines`) splits by facet into
`<name>.<role>.<facet>.spec.ts` beside the main `<name>.<role>.spec.ts` and the same subject (`orders.service.refunds.spec.ts`
beside `orders.service.spec.ts` and `orders.service.ts`); a split with no main spec or no subject is an orphan. A spec of a handler,
resolver, controller, module or app file, or of any other file, is a finding. Integration
specs are `src/tests/integration/<area>/*.integration-spec.ts` on real infrastructure through `useTestWorld`; contract
specs `src/tests/contract/<provider>/*.contract-spec.ts`; e2e flows `src/tests/e2e/<area>/*.e2e-spec.ts`. Test
infrastructure lives only in `src/tests/world/`, shared data and builders in `src/tests/fixtures/` (a fixtures file holds
data and builders only: no boot helper, no `@nestjs/testing`, no AppModule, no `NestFactory`, no container or docker client,
no `.listen(`, no `override*` call; BE-TEST-12). Integration and contract run
through `npm run test:integration` and `npm run test:e2e` (after `typecheck:tests`; `starci test integration|e2e` is the same run with the cache report, BE-TEST-17) on a local machine, never in a hook, the default typecheck or a CI workflow (R12).

The world is also the one place of raw SQL text (R334): plain CRUD on an application table goes through its entity on
`world.db.<connection>`, a database function of the app through `callDbFunction`, and seeded rows come from builders
(BE-TEST-16); only a probe stays raw, as `sql`-tagged text with `$n` parameters (a privilege or row-level-security probe,
catalog, cron or trigger introspection, a pgmq queue table, a lock or failure probe). Test-only functions are never added to
the main database. A unit spec of a listed pass-through file may pass its fake `session.query("select 1")`.

Why: one placement rule makes discovery mechanical, and slow suites stay out of fast gates.

Enforced by: `unit-test-colocated`, `test-world-files`, `tests-infra-only-in-world`, `test-world-shape`,
`test-infra-placement` (R47: BE_TEST_TOPOLOGY for a file outside `src/tests/world/` that imports `@nestjs/testing`, an
AppModule, `NestFactory`, `testcontainers` or a docker client or calls `createTestingModule` or `.listen(`, and
BE_SPEC_WORLD_MISSING for an integration or e2e spec that gets its world anywhere but `useTestWorld` of
`src/tests/world/use-test-world`; hfs reads the tree, so it holds on a branch that lints nothing), `spec-placement` (R102),
R112, R334 (the world's raw SQL).

## BE-TEST-2 The subject is built by the testing module from providers only

A unit spec builds its subject with `Test.createTestingModule({ providers: [Subject, ...doubles] }).compile()` and
`moduleRef.get(Subject)`, usually in one `build()` function returning the subject and its doubles. No `new` of the
subject, no `imports`, no `override*`, no `jest.mock`. The providers besides the subject are exactly its constructor
dependencies: an injector's exported token (`{ provide: CLOCK, useValue: clock }`) or a domain service class
(`{ provide: MembersService, useValue: mock<MembersService>() }`). Every required dependency is provided; a parameter
decorated with Nest's `@Optional()` may be omitted to cover its absence. A TypeScript optional parameter alone does not
make Nest injection optional. A `*.schema.ts` is parsed directly. A subject of plain exported functions (a policy or mapper
module) is provided under a local token as the real functions of that one sibling file, `{ provide: SUBJECT, useValue: {
fnA, fnB } }`, every member an export of `<name>.<role>.ts` under its own name; a function of another module is never a member
(it is a collaborator: call it directly, or let its own spec prove it), and anything else a token gets is a kit double.

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

Enforced by: R273 (the coverage bar of BE-TEST-13); the case list is review only.

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

Integration and e2e differ by what they prove. An **integration** spec proves one module or capability:
`useTestWorld({ modules })`, real infrastructure, no HTTP door of ours. An **e2e** spec proves a flow:
`src/tests/e2e/<flow>/*.e2e-spec.ts` through `useTestWorld({ apps })` boots the full app(s) on its local db service, seeds a real package through the app's deploy door, drives the app only through its external
doors (HTTP, a webhook, GraphQL; never by importing a service, a module or the AppModule), fakes only at the network edge
(`world.fake.<provider>`) and asserts persisted state (`world.db.<connection>`). Both run only on request, never in CI, a hook or a
release gate row (R12), on the slots the app declares, exclusive specs alone, and through a result cache (BE-TEST-17). Neither assembles its own world: the world is `src/tests/world/` and nothing else, a boot helper,
`Test.createTestingModule`, an AppModule import, `NestFactory`, a container, a docker client or `.listen(` outside it is a homemade
world (BE_TEST_TOPOLOGY), `src/tests/fixtures/` holds data and builders only, and a spec that does not call `useTestWorld` of
`src/tests/world/use-test-world` is BE_SPEC_WORLD_MISSING. A violating file is `src/tests/fixtures/e2e/world.ts` that boots
`Test.createTestingModule({ imports: [AppModule] }).overrideProvider(...)` and `.listen(0)`, with specs calling its `bootWorld`; a
passing one declares `src/tests/world/test-world.config.ts` and its specs call `useTestWorld({ modules })` or `useTestWorld({ apps })`.

A boot check that imports test fixtures or builders (a module that boots the app on stubbed ports to prove its wiring, `sides.be.apps[].boot.module` of hfs.json) stays in the app and is not part of the production build: the synced `be/tsconfig.build.json` excludes every boot module hfs.json declares other than the default `apps/<app>/src/app.module.ts`, so the image build never takes it as a root. No app edits the synced `be/tsconfig.build.json` or removes the file in its Dockerfile.

Integration specs boot capability modules through `useTestWorld({ modules })` on the local stack (the db
CLI database and the declared Redis), fake only external providers at the network edge, override no provider, guard or
token, and assert persisted state. The app proves composition by compiling the real AppModule graph (`starci app check
--gate wiring`), after the same proof has scanned it for provider rings (BE-INJECTION-5), and each declared pattern in
integration specs; an e2e flow boots the real apps
(`useTestWorld({ apps })`). Configuration is substituted by passing options, never by patching `process.env`. A
provider whose contract requires TLS (an OIDC issuer and its JWKS) is faked over HTTPS (`defineHttpFake({ https: true })`,
`@starci/test-world` README "Fakes"), and the app trusts the run's fake CA (`w.fake.<name>.ca`) through its HTTP client's
`trustedCa` (BE-INFRA-2), passed as `HTTP_TRUSTED_CA` in the environment the world builds, never by turning verification
off (SHARED-LOOSENING-1, marker `tls-unverified`), so the issuer check a spec proves is the one production runs.

A back end whose consumers are woken by the database's own change feed (WAL, Debezium Server, a Redis stream) proves that road end to end with `stacks.debezium` (`@starci/test-world` README "Change data capture (Debezium)"). The stack declares the `debezium` compose service (the pinned `quay.io/debezium/server` image; kind `cdc`, stateful like a queue, so never fakeable and `fakedBy` is refused), and the declaration pairs it with `stacks.postgresql.logicalReplication: true` and `stacks.redis`; a world that declares `stacks.debezium` without one of those, or whose stack has no `debezium` service, is BE_TEST_TOPOLOGY (R47 `test-world-files`). A passing world: `stacks: { postgresql: { connections: [{ name: "primary" }], logicalReplication: true }, redis: {}, debezium: {} }`; a violating one drops `logicalReplication` or `redis`.

Why: a hand-assembled module can pass while the real app cannot start, and transaction, lock and fence claims need the
real store.

Enforced by: `tests-no-override` (eslint, and `test-infra-placement` of hfs: an `overrideProvider`, `overrideGuard` or `overrideModule` call under `src/tests/` or in any integration, e2e or contract spec is BE_TEST_TOPOLOGY), `test-infra-placement` (BE_SPEC_WORLD_MISSING), `e2e-uses-production-transport`, `e2e-asserts-persisted-state` (R47, R48), R272, R401, R284.

## BE-TEST-13 Coverage is held to tiers, from one derivation

The unit project measures every logic-role file of the measured roots (`src/modules/{domain,integrations,platform}/*`,
minus `errors/`, `messages/`, `persistence/`), and every file a measured slot declares in `logic`. A file that carries logic
without a role suffix is declared by its slot, never by a new role name. The `features/` tier is linted (feature-thin, R203), never
measured; the front end is not measured.

The bar is the owner's (owner 2026-11-25), its numbers stated once, in `@starci/hfs` knowledge/sonar-gate.yaml:

- **Tiers**, each over its modules as a whole: **A** 85% lines and 80% branches (money, authz, the engine core); **B** 75% lines
  and 65% branches (the product domain); **C** 60% lines (the integrations, the rest of the platform, the console and read modules).
- **Business packages** (nivoos): 60%, and every cell and flow has a spec.
- **The patch** (new or changed measured code): at least 80%.
- **Every measured file**: at least 50% lines, branches, functions and statements.
- **The project**: never below its base commit (a ratchet, only up).

Which module is in which tier is the app's declaration, since module names differ per app: hfs.json `sides.be.coverageTiers` maps a
tier to its modules, each `<layer>/<module>` (a `*` inside the module name) or `packages/<name>`; a module it does not name is in the
default tier, B. An entry without `*` wins over a pattern, a longer pattern over a shorter one, a stricter tier over a looser one.

```json
"coverageTiers": {
  "A": ["domain/billing", "domain/identity", "platform/outbox"],
  "C": ["integrations/*", "platform/*"]
}
``` The logic of a root package (every file below the `src/` of `packages/<name>` but its barrels, its type modules `<name>.types.ts` and `<name>-types.ts` and the slots the
project opts out with a reason, [project/lint.md](../../project/lint.md) PROJECT-LINT-3, [project/README.md](../../project/README.md) PROJECT-3) is
inside the scope at the bar of its tier, its specs run by the same unit run; a type module declares types only, and one that holds runtime
code is refused by R273.
A root package that has its own `tsconfig.json` is compiled by jest with it, the others with the back end's options ([project/README.md](../../project/README.md) PROJECT-3); the choice is made by the jest preset from the tree, not rendered.
The scope and the bar are rendered once into the managed `jest.config.js` (the per-file floor of every measured file),
`codecov.yml` (the project ratchet, the patch bar, one `tier-<letter>` component per tier at its bar) and `sonar-project.properties`
(new code at the patch bar); R273 judges the per-file floor and every tier over the merged lcov. No file carries a coverage ignore, and
there is no waiver: a module below its bar is covered, or the app moves it to the tier that holds it, in hfs.json.
The bar, the business bar and the spec of every cell and flow are test and coverage obligations: an app that declares its `test` or
`coverage` gate off ([project/lint.md](../../project/lint.md) PROJECT-LINT-4) is not judged for them, and every run reports the gate as
`off (declared: <reason>)`, never as passed.

Why: decisions live in the modules' logic, so a bar on exactly those files is meaningful, and one denominator everywhere makes a gap
visible wherever it is read. 100 per file could not be reached (the apps had one spec per three to five source files and switched
their test gates off), and a bar nobody meets is no bar: the tiers ask most of the code where an error costs money or access, and the
ratchet keeps every app from going back.

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

## BE-TEST-17 Integration and e2e run on the slots `.starcistacks` declares, exclusive specs alone, with a cache

An app declares how many spec files of a world kind run at once in its `.starcistacks/application-stacks.yaml`:

```yaml
tests:
  integration: { workers: 3 }
  e2e: { workers: 3 }
```

`workers` is an integer from 1 to 8 and is the number of data slots a run of that kind provisions: the files run in
parallel, each in a process of its own bound to a slot, never two on one slot. A kind absent, or the block absent, is 1: one file at a time. Slots are a `@starci/test-world` feature. A wrong shape is a finding (the `tests` property of the schema `starci/application-stacks@1`:
unknown kinds, a non-integer, 0 or more than 8). `starci test <kind> --workers <n>` (`STARCI_TEST_WORLD_WORKERS=<n>`) overrides it for one run;
jest's `--maxWorkers` is never read, the harness sizes it for unit runs.

A timing-sensitive spec (a latency budget, a soak, a load run) declares itself exclusive: `useTestWorld({ apps, exclusive: true })` (a typed option of
`@starci/test-world`). The runner reads that literal from the file and runs every exclusive file of a kind alone, one at a time, after the parallel
batch of its kind has ended.

A spec file whose inputs are unchanged since its last green run is not run: the run reports it `cached`, with the duration of the green run it
stands for. A new, changed or previously red file runs, and its green run is recorded. The inputs of a spec are the digest of

- the spec file, and its import closure, resolved through the tsconfig (aliases, `extends`, a root package outside the jest root, type-only,
  dynamic and `require` imports, JSON);
- the application source it can reach: every code, configuration and data file of the jest root (`be/`) but the other specs, the world folder and
  build output (the world boots modules, migrations and seeds that no import of the spec names);
- the world declaration, `src/tests/world/**`;
- the lockfiles of the jest root and the app root;
- the stack definition, `.starcistacks/application-stacks.yaml` and every `.starcistacks/<env>/` but its sealed `runtime/` (so a change of `tests.workers`
  re-runs the files, once);
- the versions of `@starci/test-world` and `@starci/jest-preset`, and the kind.

`--full` ignores the cache and runs every file; `--spec <path>` runs the named files whatever the cache says; both record what ran green. A red
spec is never cached: its record is removed. A spec that boots a live provider (`useSandbox`) is never cached, and a run that filters tests by
name (`-t`) records nothing. The records are JSON Lines in the app repository, `.starcistacks/cache/test/<kind>/<area>.jsonl` (one line per spec:
its path, key, the digests behind the key, `passed` and the duration in ms; sorted, LF), committed with the code like the check cache, so a warm
cache survives across machines and a merge of two branches is a union. Each file of the run is a line of the report, `ran`, `cached` or `FAILED`
with its time, and the run ends with the counts and the time the cache saved. `starci test <kind>` asks the cache first and, when every file of the
kind is cached, starts no world at all. The contract kind is never cached.

This changes nothing about when a world suite runs: only on request, never in CI, a hook or a release gate row (R12).

Why: a world spec costs seconds to minutes and most of a local session changes one module, so running again a green file whose inputs did not
move proves nothing new; the app, which knows how much of the real stack its machine holds, declares the parallelism, and a spec that measures time
must not share the machine with another.

Enforced by: the `tests` property of the stacks schema and `HFS_STACKS_SHAPE` (the declaration), R12 and `HFS_E2E_IN_AUTOMATIC_GATE` (when a suite
runs); the slots, the exclusive batch and the cache are `@starci/jest-preset`'s world runner and `starci test integration|e2e`, proved by the
packages' own specs.
