# Changelog

## 2.6.0 - 2026-10-31

- Added: the per-spec coverage of the app check cache. With `STARCI_SPEC_COVERAGE_DIR=<folder>` the config adds the reporter `spec-coverage-reporter.js` and runs like a shard (no all-files instrumentation, no threshold): each spec file writes the covered and not-covered statements, functions and branch locations of every measured source as flags, never hit counts, and a failed spec writes none. `@starci/jest-preset/spec-coverage` merges the records of every spec (an item is covered when any spec covers it) into the lcov and coverage-final.json an unsharded run writes. Specs: `test/spec-coverage.spec.ts`.

## 2.5.3 - 2026-10-30

- Changed: the message that names the managed sync command says `starci app sync --execute`.

## 2.5.2 - 2026-10-30

- Added: `coverage.files` of the rendered be/jest.config.js: the files a slot declares as logic (hfs 4.11.20 `logic`) are collected and held to 100 per file like the logic roles; a config rendered without `files` loads as before. Specs: `test/coverage-scoped.spec.ts`, `test/preset.spec.ts`.

## 2.5.1 - 2026-10-29

- Fixed: `fakeTransaction` records a `query` that calls a migration's database function the way `callDbFunction` writes it (`SELECT * FROM "<schema>"."<fn>"(...)`, any schema but `pg_catalog`) as a write, so a rolled-back inbox claim or event send appears in `rolledBackWrites`; any other `SELECT` stays a read.
- Added: `fakeInbox().claimRow(source, eventId, tx, { entity, row })`, the double of the lite `EntityInbox` claim: it refuses a missing or blank id (`DATABASE_WEBHOOK_DELIVERY_ID_REQUIRED`), claims the trimmed id and, for the winning claim only, records the row `row(id)` builds in `receipts` (with the manager and `inTransaction`) and answers `receipt-<n>`; a repeat, or a pair marked by `receiptExists(source, eventId)`, answers undefined. `failNext("claimRow", error)` scripts a failure.

## 2.5.0 - 2026-10-29

- Added: `fakeQueryBuilder(answers)` and `queueQueryBuilders(em, answers)` (also at `@starci/jest-preset/query-builder`), the double of `createQueryBuilder(Entity, "alias")` beside `mockEntityManager`: every chained call is recorded and returned to the chain, the terminals resolve the spec's answers. Lite persistence reads through entities and that builder (ruling `lite-persistence-typeorm-entities`), so the double moves here from the apps.

## 2.4.1 - 2026-10-28

- Changed: `@starci/ai-router` joins the ESM-only dependencies jest compiles to CommonJS, so a spec that builds an AppModule registering the AI pool loads it.
- Fixed: the built declarations name `.js` (`dist/index.d.ts` and `dist/entity-manager.d.ts` named `.ts` files a consumer tsc cannot read).
- Fixed: the pair-mismatch message names state protocol 2 as test-world 1.1 and later write it, not "test-world 1.1.x"; release C pins this preset beside `@starci/test-world` 1.2.3, which speaks protocol 2.

## 2.4.0 - 2026-10-28

- Changed: the source is TypeScript in `src/`, built to CommonJS JavaScript in `dist/` (`npm run build`; `prepack` builds), and the declarations are emitted from it instead of hand-written; `main`, `types` and every export (`.`, `./mock`, `./clock`, `./entity-manager`, `./ids`, `./matchers`, `./cache`, `./lock`, `./event-bus`, `./queue`, `./inbox`, `./builders`, `./merge`) point into `dist/`. No rule or behaviour changed; the specifiers are unchanged. The files jest loads by path are now `dist/world-runner.js`, `dist/unit-metadata.js`, `dist/unit-metadata.generated.js` (the coverage anchor, copied byte for byte from `assets/`) and `dist/lcov.js`; `@starci/jest-preset/merge` now has types.
- Changed: `starciJestConfig` returns `StarciJestConfig` (jest's `Config` with `projects` all objects, a custom reporter path allowed in `coverageReporters` and a `coverageThreshold` keyed by glob only), the type its value always had; `createMock` takes a factory called with the property name; the package specs are `test/*.spec.ts` and load the built `dist/`.

## 2.3.7 - 2026-10-27

- Changed: licensed MIT (was UNLICENSED); the package metadata names the repository, homepage and bugs so npm can attach provenance. No rule or behaviour changed.

## 2.3.6 - 2026-10-25
- Added: the fake inbox records client operations and sweeps (`clientEntries`, `sweeps`) and the entity-manager and index doubles follow the idempotent client inbox of the alpha.31 cohort; the lite and full example back ends spec against them.

## 2.3.5 - 2026-10-23
- Changed: the preset sets no `testTimeout` (the jest default applies; a world spec sets its own), owner ruling 2026-10-22: no loosening.
- Changed: the type probes assert their compiler diagnostics (file, line, code) from their own rejected fixtures instead of inline ts directives; the generated metadata anchor carries no coverage-exclusion comment; a spec refuses any inline suppression in the package.

## 2.3.4 - 2026-10-21
- Changed: supersedes 2.3.3, published from a lane whose history the owner refused (an unapproved allowlist entry) and therefore a superseded orphan that is not used; this version carries the same work plus the standalone scaffold fix.
- Changed: the Sonar exclusions live in `sonar-exclusions.cjs` (published, require-free), which `sonarExclusions()` reads; @starci/hfs ships the same file byte for byte so `npx @starci/cli app scaffold` renders them without installing this preset. The list is unchanged.

## 2.3.2 - 2026-10-18
- Added: shard mode `STARCI_COVERAGE_SHARD=1` (only the loaded files are measured, no per-file threshold, istanbul JSON) and `@starci/jest-preset/merge` (istanbul-lib-coverage merge by source location, lcov through the preset reporter): the coverage job of the sharded managed CI.

## 2.3.1 - 2026-10-18

- Fixed: coverage excludes only compiler-emitted constructor `design:paramtypes` metadata guards injected by the preset transform; application source is never excluded, and the generated anchor is omitted from LCOV.
- Changed: unit transforms use isolated transpilation instead of a per-file type program. A bundled ts-jest after-transformer preserves constructor metadata guards while mapping only those generated calls to a dedicated generated-metadata coverage anchor, keeping per-file 100 coverage reachable without hiding source branches. `importHelpers` stays enabled; type checking remains a separate gate. The bundled LCOV reporter gives repeated callback names unique identities so the app coverage gate can verify function totals.

## 2.3.0 - 2026-10-16

- Added: a declared lite app (the edition of the `hfs.json` above its `be/`) runs its existing integration and contract specs without a test world: those projects exist only when their spec files do, and neither the world runner nor the world global setup and teardown is attached to a lite run.
- Changed: a full app without a test world keeps only the unit project (an unfinished full scaffold), as before; the cited ruling is now ruling:R212/case-1 amended by ruling:R212/case-4.

## 2.2.7 - 2026-10-13

- Fixed: the ESM-only runtime dependency `jose` (the Supabase access-token verifier of every lite back end) is compiled to CommonJS by ts-jest instead of being skipped with node_modules, so a lite app's unit run can load its guard (owner ruling 2026-10-12: lite keeps full's unit run).

## 2.2.6 - 2026-10-08

- Fixed: the `integration`, `e2e` and `contract` projects match `**/src/tests/<layer>/**/*.<layer>-spec.ts` instead of a pattern prefixed with the root path. On Windows a root that holds a dot-named folder (a checkout under `.claude`) turned the path separator before it into a glob escape, so the contract run found 0 spec files ("No tests found") although they exist.
- Fixed: `jest-util` is a declared devDependency of the package, which its own spec requires.

## 2.2.5 (published before this release)

- Breaking (contract change `coverage-modules-logic`): `starciJestConfig({ coverage: { roots, roles, excludes } })` takes the coverage scope the managed `be/jest.config.js` renders (`hfs sync`, from the `coverage` field of the slot manifest and `ruleParams.be.logicRoles`, through `scripts/hfs/coverage-scope.mjs`), and refuses to run without it. `COVERAGE_SOURCES` is deleted: per-file 100 now holds on every logic role (service, policy, projection, guard, mapper, client, filter, interceptor, processor, step, saga, saga-step, compensation, consumer, webhook) inside the measured roots (the logic of `be/src/modules`), never on `be/src/features` (thin by R203). New exports `rootGlob` and `StarciCoverageScope`; `collectCoverageFrom(coverage)` and `hasCoverageSubjects(root, glob)` take a scope and a glob with `**` and `{a,b}`.
- New: `fakeInbox()` (also `@starci/jest-preset/inbox`), the twin of `recordingOutbox()` for the delivery side: `claim` answers true for the first call of a (source, eventId) pair and false afterwards, `release` gives the claim back, `seen` marks a redelivery, and `claims`, `claimed`, `released`, `failNext` and `clear` let a spec assert what a consumer or a signed webhook did. A spec no longer stubs `mock<Inbox>()` by hand.

## 2.2.4 - 2026-10-02

- Changed: the world runner runs up to `min(--maxWorkers, slots)` files of the integration, e2e and contract projects at once,
  each still in a fresh process of its own (never in band), each bound to one data slot of `@starci/test-world` 1.1.0: the
  file's process is forked with `STARCI_TEST_WORLD_SLOT=<k>`, and no two files ever hold one slot at the same time. The slot
  count is the one the world's globalSetup published in its state file. This lifts the 2.2.0 limitation "one file at a time".
- Changed: the runner reads test-world state protocol 2 only. A missing state file or another protocol fails the run with
  `JEST_PRESET_WORLD_PAIR_MISMATCH`, naming this preset, the test-world that wrote the file and the fix (pin both together per
  knowledge/hfs/canon-pins.yaml); there is no fallback mode.
## Unreleased

- Removed (breaking): `recordingOutbox()` and the `./outbox` entry, superseded by the event bus and the queue outbox. Added `recordingEventBus()` (the `EventBus` port: `publish(event, tx)`, scripted pending retries, dead letters and one-shot failures) and `recordingQueueOutbox()` (the `QueueOutbox` port: `write(tx, queue, payload)`), each recording whether `tx` was a `fakeTransaction` manager, and the `./event-bus` and `./queue` entries. Contract change `patterns-event-bus`.

## 2.2.2 - 2026-10-01

- Changed: the coverage reporters are `text-summary`, `text` and `lcov`. The unit run writes `coverage/lcov.info`, which Sonar (`sonar.javascript.lcov.reportPaths`) and Codecov import with the scope `hfs sync` renders from `COVERAGE_SOURCES` (services only). Coverage is still collected from `src/**/*.service.ts` only, with the per-file threshold of 100. Contract change `sonar-services-coverage`.

## 2.2.1 - 2026-10-01

- Changed: declares its test toolchain as devDependencies and @jest/globals as an optional peer, with a lockfile (lane PKGT clean proof); no preset change. The published package.json differs from 2.2.0, so the version moves.

## 2.2.0 - 2026-10-01

- Fixed: in one `npm run test:e2e` every e2e file after the first failed to boot with "Cannot determine a GraphQL output type":
  `@nestjs/graphql` keeps its type registry on the process global, the test world's globalSetup loads application code in jest's
  main process, and jest-environment-node exposes the host process's globals to every file it runs there (or in a reused worker).
  The integration, e2e and contract projects now run on the preset's world runner (`runner: WORLD_RUNNER`, `world-runner.cjs`):
  every spec file in a fresh worker process, never in band (not even with `--runInBand` or one
  test), so each file boots clean whatever framework keeps state on a global. The runner drives the stock jest-runner of the jest
  that loads it (jest -> @jest/core -> jest-runner), one single-worker farm per file.
- Changed: the world runner runs the files of the integration, e2e and contract projects ONE AT A TIME, enforced by the runner
  (`--maxWorkers` is not honoured there): every file shares the run's data and the test world resets it when a file boots, so
  two files at once would wipe each other's state. The project-level `maxWorkers: 1` is removed: it is a global jest option a
  project config never applied (so e2e files used to run cores-1 at a time).
- Known limitation (lifted in alpha.5): world files cannot run in parallel until each worker has its own data namespace (a
  database schema, a Keycloak realm prefix, a Redis key prefix and its own fakes per worker).
- Added: `WORLD_RUNNER` (the runner's resolved path) on the package root.

## 2.1.1 - 2026-10-01

- Fixed: a repository without its test world (`src/tests/world/global-setup.ts`) could not run its unit specs with the managed `jest.config.js`: jest validates every project's `globalSetup`, even under `--selectProjects unit`. The integration, e2e and contract projects are now declared only when the world exists.

## 2.1.0 - 2026-09-30

- Added: the claim side of `recordingOutbox()`, so a claim-side consumer is specced with the kit double the `OUTBOX` token requires (`spec-infra-double-from-kit`) instead of `mock<Outbox>()`. `queueRecords(...records)` fills a backlog that `claimDue(params)` hands out in order (only the asked queues, at most `limit`, removed once claimed; an empty backlog is an empty claim, a record queued twice is a duplicate delivery), `failNext(operation, error)` makes the next `enqueue`, `claimDue`, `complete`, `retry` or `bury` reject once, and `claims`, `completed`, `retried`, `buried` and `backlog` expose what happened. `RecordingOutbox<M, R>` takes the claimed record type as a second parameter; `ClaimedRecord`, `ClaimParams`, `RetryParams`, `BuryParams` and `OutboxOperation` are exported from `./outbox`. `clear()` resets the claim side too. No breaking change.

## 2.0.0 - 2026-09-30

- Breaking: `starciJestConfig()` takes no options. The repository `jest.config.js` is a managed file, exactly `module.exports = require("@starci/jest-preset").starciJestConfig()`, rendered by `hfs sync` and compared by `hfs check` (HFS_MANAGED_FILE_DRIFT), so `moduleNameMapper`, `roots`, `tsconfig`, `rootDir`, `unit` and `e2e` overrides are gone. `StarciJestOptions` is removed.
- Added: the three path aliases (`@features/*`, `@modules/*`, `@tests/*`) are part of the preset (`MODULE_NAME_MAPPER`), matching the aliases the managed `tsconfig.json` declares.
- Added: `coverageProvider: "v8"`, so branch coverage counts real source, not the helpers TypeScript emits.
- Breaking: four projects, one per test kind (owner test layout 2026-09-30): `unit` (colocated `*.spec.ts`, ignores `src/tests/{world,integration,e2e,contract}/`), `integration` (`src/tests/integration/**/*.integration-spec.ts`), `e2e` (`src/tests/e2e/**/*.e2e-spec.ts`) and `contract` (`src/tests/contract/**/*.contract-spec.ts`). The last three compile against `src/tests/tsconfig.json`, run one worker and share the test world's `globalSetup`/`globalTeardown` (`src/tests/world/global-setup.ts`, `global-teardown.ts`); there is no `setupFilesAfterEnv`. `src/tests/e2e/live/`, `E2E_LIVE` and `test:e2e:live` are gone: a provider sandbox is a contract spec. `typecheck:e2e` is replaced by `typecheck:tests`.
- Unchanged: ts-jest with `diagnostics: false` (`isolatedModules` comes from `@starci/tsconfig`), `mock<T>()` and `FakeClock`.
- Added (unit test standard, lane UT): the shared unit double kit on the package root, `mockEntityManager({ method: [Entity, result] })` (typed against the entity, `query: [sql, rows]`, a list of pairs for several answers, every method a `jest.fn`, any unstubbed method throws an error naming it, `create(Entity, plain)` works unstubbed), `fakeTransaction(em)` (`outcomes`, `commits`, `rollbacks`, `committedWrites`, `rolledBackWrites`), `fakeCache(clock)` (JSON round trip, TTL from the clock, `has`, `ttlOf`, `keys`, typed-key and cache-manager shapes), `fakeLock(clock)` (`acquire`, `release`, `isHeld`, `holderOf`, `fenceOf`), `recordingOutbox()` (`enqueue`, `messages`, `writes`, `entries` with `inTransaction`), `builder<T>(defaults)`, `fakeIds()` and the Outcome matchers `toBeRefused` and `toSucceedWith` (installed in the unit project through `setupFilesAfterEnv`). Sub-path exports `./cache`, `./lock`, `./outbox`, `./builders`, `./entity-manager`, `./ids` and `./matchers` were added next to `./mock` and `./clock`.
- Breaking: coverage is collected from `src/**/*.service.ts` only (minus `src/tests/**`, `dist`, `coverage`), with a per-file threshold of 100 on lines, branches, functions and statements (`coverageThreshold` glob key `./src/**/*.service.ts`); the managed `test` script runs the unit project with `--coverage`. The previous denominator (`src/**/*.ts` and `apps/**/*.ts`) is gone. The unit project overlays `isolatedModules: false` and `importHelpers: true` on the repository tsconfig (exported as `UNIT_COMPILER_OPTIONS`) so a decorated service can reach 100 (no `design:paramtypes` guard branches, no inlined decorator helpers); repositories list `tslib` in devDependencies.
- Breaking: `sonarCoverageExclusions()` is removed and coverage reporters are `text-summary` and `text` only (no `lcov`): Sonar does not depend on coverage and Codecov is not fed by the preset. `sonarExclusions()` remains and renders `sonar.exclusions`.
- Breaking (convention): a unit spec exists only as `<name>.service.spec.ts` beside a `*.service.ts` and builds the service with `Test.createTestingModule({ providers })`; `mockEntityManager()` and `fakeTransaction()` from `src/tests/fixtures/database.ts` are replaced by the kit of this package.
