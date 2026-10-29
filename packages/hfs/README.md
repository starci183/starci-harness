# @starci/hfs

The HFS command line of a StarCi app: the one repository of a product, `<app>/` with its root (the `app.*` slots: the one `package.json`, lockfile and `node_modules`, the `hfs.json` declaration of kind `app`, CI, hooks, the `app.starciwork` work area) and its two sides `be/` and `fe/` (slot `app.sides`). It is installed from the npm registry as the exact dependency of the CLI that runs it in-process, `starci-harness` (see [`packages/README.md`](../README.md)), which passes `main` its own version as `harness`,
and it is self-contained: `runtime/` carries the slot manifest, the canon pins, the Vietnamese why
catalog slice, the loader and the architecture machine with every file it imports, so it runs where there is no runtime
checkout. The machine loads `typescript` from the app it checks (never its own copy), so run `npm ci` first.

Every command runs at the app root. A side is judged with its folder as the root it was when products were split in two repositories (the "side view" of `scripts/hfs/slots.mjs`): the root slots (`app.*`) are judged once, the `be.*` slots under `be/` and the `fe.*` slots under `fe/`, and nothing crosses sides except `sides.fe.reads` (the `be.contract.*` slots, the input of the front end's codegen). Every finding path is app-relative (`be/...`, `fe/...`).

```sh
starci app scaffold <name> [--into <dir>] [--edition full|lite] [--cwd <dir>]
starci app add <api|webhook|realtime|saga|job|reactor|queue|projection|cli|table|app> <name> [--fe] [--no-types] [options] [--cwd <dir>]
starci app add <block|composite|branch|leaf> <name> [--shapes a,b,c] [--read <read>] [--app <fe app>] [--cwd <dir>]
starci app add <page|layout> <route> [--blocks a,b] [--tabs a,b] [--app <fe app>] [--cwd <dir>]
starci app add overlay <name> --kind modal|drawer [--form] [--app <fe app>] [--cwd <dir>]
starci app lint [--cwd <dir>] [--changed <file>...] [--workspace <dir>] [--fix] [--format text|json] [--sonar <file>]
starci app sync (--check | --write) [--cwd <dir>]
starci app check [--cwd <dir>] [--json] [--fast] [--base <ref>] [--db-types]
starci app upgrade [--plan]
starci app stack <up|down|status> [--stack <dir>] [--services <list>] [--k3d] [--force] [--json] [--cwd <dir>]
starci app explain <path> [--cwd <dir>] [--json]
starci app emit [--cwd <dir>]
starci app db drift [--url-env <NAME>] [--json] [--cwd <dir>]
starci app new service <dir> <name> [--inject <binding>...] [--cwd <dir>]
starci app new spec <file>.service.ts [--cwd <dir>]
starci app new image [--cwd <dir>]
starci app secret init|set|get|unset|rename|remove|materialize|list|verify|recipients|migrate|split|audit|server-key ... [--cwd <dir>]
starci app hygiene [--cwd <dir>]
```

`starci app add` writes every front-end unit, in either edition, already in the shape of the harness's `contexts/code/fe`
and `contexts/ui`, from `templates/fe/units`, with its copy in every catalog; nothing that exists is overwritten.

- `block`: its connected half (one `useQuery<Read>Swr` read folded by `slotOfSwr` and `mapSlot`, its labels and the retry)
  over its pure half of Grammar parts drawn through `SlotView`, plus `stories/blocks/<Name>.stories.tsx` (one story per drawn
  shape and the loading twin, paired for the DNA gate). `--shapes a,b,c` adds the `X_SHAPES` inventory, the `XShape` union
  and the exhaustive switch, and the connected half takes the shape from the read's `status`. The first block writes the
  app's one copy of the status owners and the shared `status` catalog namespace (FE-ERROR-1).
- `composite`, `branch`, `leaf`: one file of Grammar parts taking resolved fields. In a front end of two or more apps with
  the shared ui package these, and `SlotView`, go to that package and its barrel (R91).
- `page <route>`: `app/[locale]/<route>/{page,loading,error}.tsx`, the server page owner `<Name>Page` drawing one Grammar
  `Page` (R325) whose header carries the trail and the heading and whose body composes `--blocks` (blocks that take no input;
  else the page's empty sentence) and, with `--tabs a,b`, the page tabs in its header as link tabs (the first tab the route, each
  other one its sub-route `<route>/<tab>`, the selected tab the current path's), its loading view `<Name>LoadingPage` (the same page drawn with `isSkeleton`, STATE-8),
  `<Name>ErrorPage` (the page with one negative Alert), and the stories pairing the page with its loading view.
- `overlay <name> --kind modal|drawer`: `features/overlays/<Name>Overlay`, a `Dialog` or a trailing `Drawer` whose connected
  half owns its open state; its decision group puts the way out first and the commit last, always in the footer; with `--form`
  the body holds a Form with an `id` over a one-column `FormGrid` and the footer's commit submits it by `form="<id>"`; stories draw it closed and open.
- `layout <segment>`: `app/[locale]/<segment>/layout.tsx` and `features/layouts/<Name>Layout`, which composes Grammar's
  `PrimaryRailLayout`: the routed page in its primary region, `--blocks` in its rail. A frame never insets a page.

## Lite edition

Lite is the smaller edition of the same HFS standard, not another profile or engine. The declaration sets `edition` to `lite`;
the same slot manifest, rule catalog, lint canons, grammar, security rules and Docker rules apply, while edition fields filter
out the test world and event machinery.

`starci app scaffold <name> --edition lite` creates the minimum single-api, single-Next-app product on its own PostgreSQL (`db/`,
the `db` service of its stack), its Passport identity and its S3 storage; a failed step removes the app it began instead of leaving a
partial tree. `starci app db new|plan|migrate|dump|post-cutover --url-env <NAME>` drives that database (default `DATABASE_URL`).

The lite `app.starciwork` slot is optional when the app has no brand records. When present, it holds only `.gitignore`,
optional `workspace.yaml` metadata and `brand/**` (R212): the existing brand record, drawing records, references and assets.
Workspace metadata supplies the project id and repo roles for app-root detection and front-end role mapping. Lite readers
read workspace metadata normally and skip the feature catalog, shell and feature records. The scaffold writes `.gitignore`
and `workspace.yaml` and retains `brand/` only when present.

The lite additions are deliberately narrow:

- `starci app add table <name> [--fe]` adds the migration and matching back-end capability. `--fe` also adds the table's
  api feature over GraphQL (get-<singular> query, create-<singular> mutation, the GraphQL server capability on first use) and, in
  every product Next app, one operation file per operation under `modules/api/graphql` and its `useQuery*Swr` / `useMutate*Swr`
  hook under `hooks/swr/api/graphql`; never a Server Action or a database reader.
- `starci app add cli <group>` creates the optional cli app on first use, including its built-in migration and seed groups, then adds
  the requested group without full-edition specs.
- `starci app add app <name>` adds another Next app in either edition: the edition's app skeleton plus the shared app core
  (modules/api, auth, toast, redux, the providers and the hooks), one fe structure for lite and full (owner ruling 2026-10-13).
- An `add` or `new` whose target slot is unavailable in lite stops before writing with `<verb> <noun>: full edition only`.

`starci app emit` emits the enabled back-end contract snapshots; a lite app generates no database types.

`starci app db drift` holds a lite app's TypeORM entities to the schema its migrations build (R333, `BE_ENTITY_SCHEMA_DRIFT`; `db/drift.mjs`).
It loads the entity list `be/src/modules/platform/database/entities.ts` with the app's own `typescript`, `typeorm` and `pg` (its `be/tsconfig.json`
path aliases resolved) and builds TypeORM's metadata through a postgres `DataSource` with `synchronize` false that never connects. It applies
`db/bootstrap.sql`, when present, and every active `db/migrations/*.sql`, each file in one transaction, to a scratch database: a throwaway
container of the image `.starcistacks/application-stacks.yaml` declares for `components.db`, or with `--url-env <NAME>` the database that
variable names, which must hold no relation in `public` yet (`DB_DRIFT_TARGET_NOT_EMPTY`). It reads the result from
`information_schema.columns` and `pg_catalog` and reports each entity column whose table or column is missing, whose type differs once
both are spelled as `format_type` names (an enum matches an enum of the name the entity gives), or whose nullability differs; a column no
entity maps is fine. Exit 0 is green, 1 is drift or a migration that does not apply to an empty database (`DB_DRIFT_MIGRATION_FAILED`),
and 2 is no verdict: a host without Docker or without the app's packages gets `DB_DRIFT_NEEDS_DATABASE` (needs a database), never a
green. An app with an entity list runs it as the `db-drift` row of `starci app release gate` and in the database step of its managed CI's
build job.

`starci app db baseline --squash --url-env <NAME> --stamp <ts14> [--drop-extension a,b] [--drop-pgmq-queue q1,job_*] [--seed-tables t1,t2]
[--image <ref>] [--apply]` retires the whole active chain into one baseline read from a database it is applied to, for a cutover whose
production starts on an empty database (`runtime/scripts/hfs/db-squash.mjs`). The source must record exactly the active chain in its
history, and it is only read. The verb dumps the source with its privileges (`pg_dump --schema-only --no-owner`, no `-x`) and keeps the
app's schemas: it leaves out the extensions `--drop-extension` names (default `pg_net,pg_cron`; pgmq stays, the lite event bus), the
pgmq queues `--drop-pgmq-queue` names (a name or a `*` pattern; no match drops nothing), every function or view whose body reaches a
dropped extension's schema, an empty publication, an event trigger on a platform function, the platform's schemas and roles and the
grants naming them, and grants to the migrating role that owns every replayed object; each is listed, and a kept object naming a left-out
one is refused with both names. Object references and function bodies stay byte-identical. It writes `db/migrations/<stamp>_baseline.sql`
(the `-- starci:baseline <last archived stamp>` header, the kept extensions created where the source has them, the schema and grants, then
the kept pgmq queues and the grants on objects outside the app schemas), a marked section of `db/bootstrap.sql` (the source's app roles
with their attributes and no password, their memberships, their allowed role settings such as `search_path`, the grants on schemas the
bootstrap creates and the database-wide default privileges, none of which a per-database dump keeps; `starci app sync` judges and keeps
the rest of the file), `db/seed.sql` (the rows of `--seed-tables`, `insert ... on conflict do nothing` in foreign-key order with their
sequences set; a table without a primary key or unique constraint is refused) and moves the chain to `db/migrations/archive/`. Before
writing, a scratch container of the app's db image (built from `.starcistacks/images/db/Dockerfile`, or `--image`) replays bootstrap, baseline and seed (the
seed twice); the same projection read from the replay must equal the source's, or the verb refuses with the differences. Docker runs every
PostgreSQL client, so the host needs none. Without `--apply` it writes nothing.

Input bounds stay with the backend DTO: `MaxLength`, `ArrayMaxSize`, `Min` and `Max` become GraphQL `@inputBounds`
input-field directives or JSON Schema constraints on the REST operation table's DTO properties. Codegen derives
`INPUT_BOUNDS` beside GraphQL wire types and `REST_INPUT_BOUNDS` under the REST API owner's `__generated__/` directory.
Each generated module also exports `inputBoundsIssues`. Forms consume the reader and their input's bounds through the API
owner and call it from each input object's zod `superRefine`, converting every returned field path into a translated custom issue.
Nested input schemas compose their own refinement. The reader
applies changed and newly added bounds automatically; required fields, types and formats remain in zod. Conflicting GraphQL
bounds across services and undecidable backend bounds refuse generation; snapshot checks detect changed limits.
Emit contracts with matching HFS and CLI versions before codegen; legacy or unsupported bounds metadata refuses generation.

The edition is chosen once at scaffold: a lite app stays lite and a full app stays full, and `starci app upgrade` refuses a lite app (`HFS_UPGRADE_EDITION_FIXED`). `starci app check --edition <edition>` accepts only the edition `hfs.json` declares.

A new full app ships its test world (`scaffold/test-world.mjs`): the `@starci/test-world` declaration under `be/src/tests/world/`
(the dev stack's Postgres per connection, the api apps, the cli app's migration runner as the migrate step), an integration spec of
readiness over the real database and one e2e spec per api app booted over the migrated database, beside the contract spec of the
be skeleton, so `test:integration`, `test:e2e` and `test:contract` of the release gate run real specs. On a full app that has no
`be/src/tests/world/global-setup.ts`, `starci app upgrade [--plan]` adds those files and the test devDependencies it lacks; a world
file that exists and differs refuses (`HFS_UPGRADE_FILE_CONFLICT`) and nothing is overwritten.

## Creating a service

Every file of a spec-required role of `ruleParams.be.unitRoles` — a `*.service.ts`, a `*.cli.ts` of the cli feature root — owes exactly one colocated `<name>.<role>.spec.ts` (unit test standard), and any other file of a `ruleParams.be.logicRoles` role inside a `coverage: required` slot may carry one beside it. `starci app new` is the one way a service and its spec come into being together:

- `starci app new service src/modules/domain/commission commission --inject InjectPrimaryEntityManager=@modules/platform/database:EntityManager --inject InjectClock=@modules/platform/clock:Clock` writes `commission.service.ts` (the class, `@Injectable()`, the constructor with the given `@Inject*()` parameters) and `commission.service.spec.ts`. `--inject` is `<Decorator>=<module>:<Type>` for a custom `@Inject*()` decorator (its token is the UPPER_SNAKE of the name, `PRIMARY_ENTITY_MANAGER`, exported from the same module) or `<Class>=<module>` for a class-typed dependency. The directory must belong to a slot of the manifest that owns the file (a service lives in `src/modules/{domain,platform,integrations}/<capability>/`), and `starci app new` never overwrites.
- `starci app new spec src/modules/domain/member/member-profile.service.ts` writes only the spec of a service you wrote by hand. It reads the constructor with the repository's own TypeScript compiler API, so `npm ci` comes first.

The spec skeleton is `Test.createTestingModule({ providers: [Service, { provide: TOKEN, useValue: double }, ...] }).compile()` and `moduleRef.get(Service)`, with one provider per constructor dependency and nothing else, every double imported from `@starci/jest-preset` (the root), and one placeholder `it` per public method. The double of a token comes from `ruleParams.be.specDoubles` of the slot manifest, the table the lint law `spec-infra-double-from-kit` holds a spec to (`*_ENTITY_MANAGER` -> `mockEntityManager()`, `CLOCK` -> `new FakeClock(...)`, `EVENT_BUS` -> `recordingEventBus()`, `QUEUE_OUTBOX` -> `recordingQueueOutbox()`, `CACHE` -> `fakeCache(clock)`, lock, lease, fence and hold -> `fakeLock(clock)`, ids -> `fakeIds()`, `*_OPTIONS` -> a literal to fill in, everything else and every class -> `mock<T>()`), so the skeleton satisfies the law by construction: no cast, no `new` of the service, no ambient clock. A back end only (a front end has no services); the files are written for prettier (print width 120).

`starci app check` runs ESLint once per side through the app's installed managed flat config: the backend canon on `be/`, and the universal FE canon plus the explicitly selected Grammar-family package on `fe/`. It also reads the app's `hfs.json` and tracked paths (`git ls-files`), checks the work tree (the root rules once, the side rules per side), and runs the whole architecture machine over each side folder. HFS findings carry their why code and Vietnamese text (`modules/kernel/failure-codes.yaml`); ESLint findings retain their rule id and failure code.

Its own checks (`scripts/hfs/check.mjs`, `scripts/hfs/rules/`; the rendered-file checks (`sync/managed.mjs`) and the prettier check (`sync/format.mjs`) live in `sync/` because they read the templates and the repository's own install, and reach `starci app check` as `extraFindings`; the jest / vitest preset the coverage exclusions come from and prettier are read from the repository's `node_modules`, so run `npm ci` first):

| Code | Level | Meaning |
|---|---|---|
| `HFS_SLOT_UNDECLARED` | error | a tracked path no slot owns (the nearest slot is named) |
| `HFS_SLOT_NOT_ENABLED` | error | a path in an opt-in slot `hfs.json` did not declare |
| `HFS_SLOT_AMBIGUOUS` | error | two slots own the path equally (a manifest gap) |
| `HFS_TRACKED_MUST_BE_IGNORED` | error | a tracked path in an `ignored` slot (build output, generated) |
| `HFS_FORBIDDEN_PRESENT` | error | a tracked path in a forbidden / `external` slot |
| `HFS_STARCIWORK_LITE_FORBIDDEN` | error | content outside the lite `app.starciwork` boundary: "lite .starciwork holds only workspace.yaml and brand/ (plus .gitignore)" (R212) |
| `HFS_SLOT_REQUIRED_MISSING` | error | a file or directory a required slot, app or instance must contain |
| `HFS_MIN_INSTANCES` | error | fewer instances of a slot than `minInstances` |
| `HFS_CANON_PIN_DRIFT` | error | a dependency not at the exact version of `knowledge/hfs/canon-pins.yaml`, or `starci-harness` not at the version of the CLI that runs the check (`runtime/scripts/hfs/canon-pins.mjs`) |
| `HFS_SIZE_SOFT_BACKLOG` | info | a source file over `ruleParams.fileLines.soft`; report only, never fails |
| `HFS_MANAGED_FILE_DRIFT` | error | a managed file that exists but differs from its render (the `managedBy` slots: hooks, workflows, sonar, the back-end `be.tool-config` files, `app.format-config`, the `scripts` block of `app.package-manifest`, compared as parsed JSON) |
| `HFS_RULE_OFF_WITHOUT_REPLACEMENT` | error | `eslint.config.mjs`, or a front end's `stylelint.config.mjs`, differs from its managed factory render, so a rule could be off, warned or redefined in it |
| `HFS_TOOL_CONFIG_LOCAL` | error | a repository holds a tool config outside the managed set (`.eslintrc*`, `.eslintignore`, a second `eslint.config.*` or `stylelint.config.*`, another prettier or lint-staged config, or a jest config in a back end that is not the one root file), a file that defines an ESLint rule or a stylelint plugin, a tool configuration key in a `package.json` (`eslintConfig`, `stylelint`, `prettier`, `lint-staged`, `jest`), or a script that runs eslint, stylelint or prettier with a flag that swaps the configuration |
| `HFS_SONAR_CONFIG` | error | `sonar-project.properties` differs from its render (no host URL; the ESLint report and HFS import paths), or the stack declaration names another quality gate than the one of `knowledge/sonar-gate.yaml` |
| `HFS_TS_STRICT` | error | the root `tsconfig.json` sets, lowers or adds anything but `extends` the preset (`be.json`, `next.json`), the template's `exclude` and (back end) the three `paths`; the finding names the flag |
| `HFS_EMPTY_DIR` | error | a directory with no file below it (git tracks none), outside `.git`, `node_modules` and `ignored` slots; the topmost one is reported |
| `HFS_GHOST_TREE` | error | an empty directory beside a sibling whose name is within two edits of its own (`business` / `bussiness`) |
| `HFS_UNTRACKED_ROOT_ENTRY` | error | an entry git neither tracks nor ignores (`git ls-files -o --exclude-standard`), outside an `ignored` slot |
| `HFS_PLAINTEXT_SECRET` | error | a tracked plaintext secret: an env, key or credentials file, a value the push scan refuses (never printed), or an `.enc` that is no sops envelope (R06) |
| `HFS_STACKS_SHAPE` | error | a `.starcistacks` path outside the standard shape (a sealed file outside `<env>/secrets/`, `runtime/files/`, root `DESIGN.md` or `k8s/`), a local Sonar not owned by the host, a service still rooted at `.stacks` (R10) |
| `HFS_CI_MISSING_CANON` | error | `ci.yml` without a `run:` step of `starci app lint` (`npm run lint`, or `npx starci app lint` at the pinned version) (R13) |
| `HFS_DEP_VERSION_SKEW` | error | a dependency at two specs across the root and workspace `package.json` files, a dependency declared at another version than the root `overrides` pin, or a nested copy of a declared dependency in `package-lock.json` (R14) |
| `HFS_CONTRACT_SNAPSHOT_DRIFT` | error | a back-end api app serving GraphQL without `be/contracts/<app>/schema.graphql` (R23); the front end reads that snapshot in place, so there is no copy to drift |
| `BE_TEST_TOPOLOGY` | error | a `*.test.*` file, a `testing/` folder, a second jest configuration or a `jest` key in `package.json` (R47; `int-spec`, `harness-spec`, the retired test folders and a per-lane test config are the machine's, under the same code) |
| `BE_SPEC_PLACEMENT` | error | a `*.spec.*`, `*.test.*` or `*-spec.*` file outside the four test layers, `scripts/` and `tools/` included (R102) |
| `HFS_REPO_LOCAL_CHECK` | error | a `check-*` file in `scripts/` or `tools/`, an `eslint-local-rules*` file or local eslint plugin, or a script that runs a local check (R103) |
| `HFS_LINT_SUPPRESSION_FILE` | error | an `eslint.suppressions*` file, a `lint:suppressions` script, an eslint suppress flag or a suppressions config (R104) |
| `HFS_PROOF_COMMAND_FILE_MISSING` | error | a `.starciwork` `requiresProof.<kind>.command` that runs a file the repository does not hold (R105) |
| `FE_GRAPHQL_CONTRACT` | error | a front-end `.graphql` document that the back end's contract snapshot (`be/contracts/<service>/schema.graphql`) does not serve: an unknown field, argument or input field, a missing required argument, a variable of another type, or a selection that does not fit (R113) |
| `HFS_SERVICE_PLACEMENT` | error | a folder outside `be/apps/<service>/` with a `Dockerfile` or a `package.json` of its own (R163): a back-end service is a Nest app of the one repository |
| `HFS_IMAGE_UNPINNED` | error | in a product with more than one service, a stack component whose `image` has no tag, `latest`, a branch word or a major or minor-only tag instead of a digest or an exact version (R164) |
| `HFS_SERVICE_STACK_DECLARATION` | error | an api or worker app of a multi-service product with no `role: service` component of `application-stacks.yaml`, named after it or mapped to it by `deploy.images.<component>.app` (R165) |
| `HFS_EVENT_CONTRACT` | error | the vendored async contract: a missing or stale `be/contracts/<service>/events.json`, a `consumes.ts` entry the provider's snapshot does not declare at that version, a `compensates` naming no declared event, or a consumer queue no consumes table lists (R166) |
| `BE_ASYNC_SPEC_MISSING` | error | a consumed event no e2e spec through `useTestWorld` names, or a saga step whose spec does not also name the compensated event (R167) |
| `BE_INTEGRATION_SPEC_MISSING` | error | an integration (`src/modules/integrations/<provider>/` with `<provider>.config.ts`) without a `src/tests/integration/<provider>/*.integration-spec.ts` that registers its module through `useTestWorld({ modules })`, references its ErrorCode enum and drives an outage through the world (R112) |
| `HFS_MONO_WORKSPACES` | error | the app root `package.json` without `workspaces` exactly `["fe/apps/*", "fe/packages/*"]`, `packageManager` `npm@<version>` or a `turbo` devDependency (R143) |
| `HFS_MONO_FE_WORKSPACE` | error | an fe app `package.json` not named `@<project>/<app>`, not private, or without exactly the workspace scripts; an fe package without `build`, `typecheck` and the workspace `lint` (R144) |
| `HFS_MONO_NEST_PROJECTS` | error | `be/nest-cli.json` not `monorepo: true`, its default project not an api app, or its `projects` not exactly the declared be apps (R145) |
| `HFS_MONO_WORKSPACE_DEP` | error | an fe workspace imports a package its own `package.json` does not declare, or the root `package.json` declares a workspace package (R146) |
| `BE_CLI_REQUIRED` | error | a back end with a connection or a command under `src/features/cli/` and no cli app `be/apps/cli`, a cli app of another name, or no `be/apps/cli/Dockerfile` (R147) |
| `HFS_PEER_INTEGRATION_MISSING` | error | the app root `package.json` depends on a driver integration (a pair of `knowledge/hfs/peer-integrations.yaml`) without its runtime peer, e.g. `@nestjs/apollo` on `@nestjs/platform-express` 11 without `@as-integrations/express5` (R111) |
| `FE_WIRE_GENERATED` | error | a contract copy with no `codegen` script wired before `build` and `typecheck`, or generated types older than the copy (R52) |
| `FE_I18N_PLACEMENT` | error | no `next-intl`, no `src/proxy.ts`, a `middleware.ts`, a route file outside `[locale]`, no `vi.json` catalog (R59) |
| `FE_I18N_CATALOG` | error | a locale catalog lacking a key another locale has (R60) |
| `FE_I18N_KEYS` | error | a literal key read through `next-intl` that a locale lacks, or a catalog key no source reads (R106; the architecture machine) |
| `FE_NO_TESTS` | error | a front end holds a `*.spec.*`, `*.test.*` or `*-spec.*` file, an `e2e/`, `__tests__/`, `__mocks__/` or `test-support/` directory, a vitest, Playwright, jest or Cypress file, a test script, or a test dependency in a `package.json`; no exception (R97; `scripts/hfs/rules/fe-no-tests.mjs`) |
| `HFS_GITIGNORE_BLOCK_DRIFT` | error | the managed `.gitignore` block differs from its render (R04; `sync/managed.mjs`) |
| `HFS_SONAR_CONFIG` | error | `sonar-project.properties` differs from its render: no `sonar.host.url`, the `sonar.exclusions` of the installed jest preset, the be lcov import with the coverage scope the slot manifest derives as the only coverage scope (R11; `sync/managed.mjs`) |
| `HFS_FORMAT` | error | a tracked file the repository's own prettier would change (R19; `sync/format.mjs`, not under `--fast`) |
| `HFS_FORMAT_TOOL_MISSING` | refusal (exit 2) | prettier is not installed in the repository; the format check is never skipped |

The managed files are judged by `sync/managed.mjs` and `sync/ts-strict.mjs` (the package renders the templates; the runtime copy does not). The list of managed
files is the `managedBy` slots of `slots.yaml`; `starci app sync --write` renders them and `starci app check` compares them, so a hand edit and a forgotten `sync` are the same finding.
Each finding is reported once: the managed ESLint and stylelint factory configs under R17, `tsconfig.json` under R22 when it names a flag, a workflow or hook that lost a canon step under R13 (or R19 for the format step), everything else under R05.
The root and both sides are rendered by the one mechanism. The root: the `scripts` block of `app.package-manifest` (`dev:be`, `dev:fe`, `build:be`, `build:fe`, `start:<app>`, `lint`, `lint:fix`, `test`, `test:integration`, `test:e2e`, `test:contract`, `test:stack`, `codegen`, `contract:emit`, `migrate`, `typecheck`, ...; a be script runs from `be/`, where its tsconfig and jest configuration are), `app.format-config`, `app.hooks`, the CI slots (`app.ci`, `app.ci-e2e`, `app.ci-images`), `app.quality-config` and the managed block of `app.git-meta`. A side: its `be.tool-config` or `fe.tool-config` slot — the side's tsconfig (resolving `@starci/tsconfig` from the root `node_modules`) and its managed ESLint factory config, the back end's build tsconfig, tests tsconfig and jest configuration, the front end's stylelint configuration. `lint` is the one lint gate, `starci app lint`: ESLint over each side with its canon, the app check and stylelint over fe; `lint:fix` is the same with `--fix`. The front end has no test script, no test configuration and no e2e or coverage file: it has no tests, and `FE_NO_TESTS` (R97) refuses any spec, e2e file, test tool or test script under `fe/`. `turbo.json` stays the app's own
(slot `app.task-graph`): it carries the task graph, which no preset can render.

The architecture machine (`scripts/hfs/architecture.mjs` of the runtime, the same code bundled here): tiers and import
direction, owner public API, cycles, module registration and composition, clones, dead exports, required files,
the source-shape, contract-form and front-end rules, and the repository-tree rules. Each violation and each error is one
finding under the machine's own rule id (`BE_TIER_DIRECTION`, `HFS_UNUSED_EXPORT`, `ARCH_OWNER_EXPORT_BYPASS`, ...). A
repository without `typescript` installed fails with `ARCH_TYPESCRIPT_MISSING`; the check never passes because it could not run.

`--fast` judges only what changed since the merge-base of `HEAD` with
`origin/main` (else `main`; `--base <ref>` names another ref): ESLint on changed source files, the slot and pin checks on the changed paths, the machine on the owners
of the changed source files without clones and dead exports, and no file-system tree checks. The required-file and minimum-instance
checks still cover the whole tree. With no merge-base `--fast` is a refusal (exit 2) that names the fix, never a silent full
pass.

Exit codes: 0 clean, 1 an error finding, 2 a tool could not run or a refusal (not a Git work tree, bad flag, `--fast` with no merge-base). `starci app check` and `starci app lint` never write to the app
(`starci app lint --fix` lets ESLint and stylelint fix in place).

## Secrets

`starci app secret` keeps an app's sealed members (the standard is the harness's PROJECT-STACKS-5): one per provider,
`.starcistacks/<env>/secrets/<provider>.enc.yaml`, sops YAML whose values keep every byte, a legacy dotenv `<member>.enc`
read until `migrate` moves it (`runtime/scripts/lib/sealed-member.mjs` names both). `set <env> <provider> <KEY> [KEY ...]`
seals every named key in one sops write (`runtime/scripts/hfs/secret.mjs`): on a terminal it prompts `<KEY>: ` for each with
masked input (one `*` per character; a paste, backspace, Enter, Ctrl+C to cancel with nothing written), redirected stdin gives
one key its whole text or several one `KEY=value` line each, `--from-file KEY=path` reads a key byte for byte
(`secret-prompt.mjs`), and `--generate <bytes>` makes a random value per key. It then declares the keys in the environment's
`secrets:` of a compose environment (`declareKeys`, `secret-standard.mjs`) and names a swarm environment's to wire by hand.
A member is sealed to its environment's rule of the managed `.sops.yaml`; `recipients <env> [--add|--remove <age1...|owner>]`
rewrites that rule (`environmentRecipients`, `secret-init.mjs`), and `init` takes the owner's identity as the app's recipient.
Re-sealing a member whose every key the set replaces needs no age identity; adding a key to one does, and the identity is found
by itself (`decryptionIdentity`, the one lookup every decrypt of a member uses: secret, stack, release, db): SOPS_AGE_KEY or SOPS_AGE_KEY_FILE of the environment, else of the app's git-ignored
`.claude/secret.env`, else of its main checkout's when the app is a git worktree, else the `hostIdentity` the harness CLI passes
(its own secret.env), else the sops `keys.txt`; with none, the verb refuses before asking for a value, naming every place it
looked and the one line that fixes it. `audit [<env>]` names every deviation and exits 1; `migrate <env> <member> [--to
<provider>]` and `split <env> <member>` repair them, dry runs until `--execute` (`secret-standard.mjs`). `server-key <env>` makes
the deploy server's own age identity on the server through the deploy's transport and seals the environment to it beside the
owner key, `--rotate` replaces it, `--backup github` stores it as the SOPS_AGE_KEY of the GitHub Environment `<env>` that
every CI job bound to `<env>` reads, and `--restore github` writes it back (`stack/server-key.mjs`). No output carries a value
except `get --reveal`.

## Sonar

One mechanism for both sides: every finding of the canon is imported into Sonar, and the quality gate
fails while any is open. Nothing is configured per app; the pieces are managed files (`starci app sync`) and this package.

One entry, one report, one file: `npm run lint` is `starci app lint`; `npm run lint -- --sonar reports/lint.sonar.json` writes the ONE Sonar file, read through `sonar.externalIssuesReportPaths`. It carries three engines: `starci-hfs` (the repository findings, rule id = the finding code), `eslint` (the BE canon, universal FE canon and selected Grammar-family plugin, rule id = the ESLint rule) and `stylelint` over fe (rule id = the stylelint rule). App lint shares app check's ESLint runner and calls its HFS checks in process, so each side's ESLint config runs once. `starci app lint --format json` prints the same findings as the one report `starci/lint@1` (`{ schema, ok, changed, counts.error, engines, errors[], findings[{ engine, rule, code, severity, path, line, column, message }] }`); `--changed <files...>` restricts ESLint and stylelint to those files and keeps of the repository findings the ones on a listed file or on no file. The exit code is 0 clean, 1 findings, 2 a tool could not run (a missing ESLint install is never a pass).

`--sonar` writes the findings as a Generic Issue Import document (SonarQube 10.3+ format: `{ rules, issues }`) before the verdict, so a
failing lint still leaves its report. A rule's name and description are the catalog's English title and Vietnamese title, meaning and next step;
impacts are HIGH (maintainability). `info` findings (the soft-size backlog) are report-only and not imported. The output is sorted, so two runs
over one tree are byte-identical. Sonar drops an issue on a file it does not index (a tracked source file or stylesheet under `sonar.sources`), so the ONE placement rule of the three engines files a finding on
any other path (hfs.json, a workflow, a config file, `e2e/`, a package the sources do not list) and a finding with no path on the first source file, its message starting with the real path.
Sonar's own ESLint import (`sonar.eslint.reportPaths`) is not used: it drops those issues silently. `sonar.sources` lists the back end's app and shared-source roots (the `be.app.*` and `be.*` source slots) and the front end's apps (the `fe.app.*` slots, plus `repo.packages` when the front end opts into an `fe.package.*` package); `sonar.tests` is the back end's.

The managed `sonar-project.properties` carries `sonar.externalIssuesReportPaths` (`reports/lint.sonar.json` only) and no `sonar.host.url` (the host is
`SONAR_HOST_URL`); the managed CI workflow produces the report and runs the scan and the gate action with `!cancelled()`, so a failed lint step still
reaches Sonar while the job stays failed. There is no `continue-on-error`. CI runs `npm run lint -- --sonar reports/lint.sonar.json` once at the app root, before the scan. The duplicate-block threshold (`ruleParams.<side>.duplicateBlock`) has no Sonar property for TypeScript (SonarJS detects
clones with its own token rule), so the machine enforces it (R21) and its findings are imported like every other.

The gate is `knowledge/sonar-gate.yaml`, the one declaration: the new-code conditions (coverage 100, duplication, issues of every severity, hotspots) and an `overall` part (coverage 100, 0 open issues on the whole code,
every hotspot reviewed, duplicated lines density, cognitive complexity through the S3776 rule). A SonarQube gate condition cannot filter by engine, so the condition counts every
open issue, imported or native; that is stricter than the three imports alone and is intended. `starci app check` reports `HFS_SONAR_CONFIG` (R11) when the
properties file is not its render or the stack declaration names another gate. R20 and R21 have their Sonar enforcers as conditions of that file.

Coverage is the logic of `be/src/modules/**`, from one derivation. `scripts/hfs/coverage-scope.mjs` derives the measured files once from the slot manifest — every `<name>.<role>.ts` of a `ruleParams.be.logicRoles` role inside a slot whose `coverage` is `required` — and `starci app sync` renders it into the three files that state it (R204 `HFS_COVERAGE_SCOPE_DRIFT`): `be/jest.config.js` as `starciJestConfig({ coverage: { roots, roles, excludes } })`, the `sonar.coverage.exclusions` line of `sonar-project.properties` and `codecov.yml`. The managed `test` script is `jest --selectProjects unit --coverage`: it fails below the per-file 100 threshold on the measured files and writes `be/coverage/lcov.info` (the jest preset's lcov reporter). The managed `sonar-project.properties` imports that report (`sonar.javascript.lcov.reportPaths=be/coverage/lcov.info`) with `sonar.coverage.exclusions` set to the complement of the measured files (SonarQube has no coverage inclusions) and no other coverage key, so the feature tier, declaration files, tests and `fe/` are never coverage targets. The managed `codecov.yml` holds the measured roots at 100 on the project and the patch, plus one component per service app and one `platform`, each at 100; the managed CI workflow uploads the lcov with `codecov/codecov-action` after the unit run. The runtime judges the coverage per file: `sonar-local.mjs scan` holds every measured file a slice touched at 100, and `sonar-local.mjs dashboard` fails a project unless every measured file is at 100.

The upload authenticates with GitHub's OIDC token: the managed `ci.yml` job has `permissions: id-token: write` and the `codecov/codecov-action@v5` step has `use_oidc: true`, so there is no repository secret and no step that skips silently when one is missing (rule CI_UPLOAD_NOT_SILENT). The owner activates the repository on Codecov once.

## Maintaining the bundle

`runtime/` holds the slot loader files, the pins, the import closure of `scripts/hfs/check.mjs` and
`scripts/hfs/architecture.mjs`, and the catalog slice of every code `starci app check` can emit. It is committed source of
this package, edited in place ([packages/README.md](../README.md) says how the bundled copies move together). Bump
`version` here and in the pin when the behaviour changes.

## Serving knowledge to other packages

`package.json` `exports` opens `./runtime/*`, so a package that needs a runtime file resolves it from the installed copy
(`import.meta.resolve("@starci/hfs/runtime/knowledge/hfs/slots.yaml")`), never from the product repository or a link path.
`@starci/eslint-canon-be` does this and lists `@starci/hfs` in `dependencies` at the exact version.
