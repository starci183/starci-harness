# Open decisions: patterns, hfs, stack and the rulings log

Choices made while writing [patterns](../patterns/README.md), [hfs](../hfs/README.md), [stack](../stack/README.md)
and [rulings.yaml](rulings.yaml), each with the alternative and the reason, so the owner can overturn one in one place.
A confirmed row moves to `rulings.yaml` and is deleted here. The follow-up column names the code that must change for
the knowledge to be true.

## Decisions

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| C-1 | Patterns are Markdown with YAML front matter (`slots`, and `files` for scaffolded trees; fe/folder.md also carries `frameworkPinnedRootFiles`) | keep YAML topics | an agent reads reasoning; the only machine reads were the slot→topic map and the `files` trees, which the front matter keeps | repoint the slot→topic reader and `app add` (`ruleParams.be.addKinds.*.topic` now names `<topic>.md`) |
| C-2 | Library-only fe topics are dropped (theme, motion, chart, flow, markdown, code, diagram, pdf, observe, utils, lint); their fact is one `why` line in `stack/fe.yaml`; `pattern` is omitted for those concerns | keep a topic per library | the topic restated `forbids` in prose; `fe-stack-import` already reads the data | none (`pattern` is optional in the lint) |
| C-3 | "App CSS is layout only" is stated once, in [patterns/fe/ui.md](../patterns/fe/ui.md) FE-CSS-1; FE-UI, FE-CSS, FE-ICON merged into that file | keep css.yaml, ui.yaml, icon.yaml | nine places held the fact | none |
| C-4 | An app imports no vendor UI component; `@heroui/react` and `react-aria-components` are grammar peers only (FE-IMPORTS-5) | the legacy allowance for app leaves and blocks | owner guidance: no visual choice is left to the app; a vendor import is a second visual owner | grammar lint `vendor-primitive-has-named-owner` must refuse every app import of a vendor UI package (R93) |
| C-5 | No product UI package: slot `fe.package.ui` is removed; a shared front-end package holds no visual component (FE-PACKAGES-2) | define it as a grammar family entry | every visual element lives in the grammar package | slot removed from hfs/slots.yaml; R63 lint must refuse visuals in `fe/packages/*` |
| C-6 | The data-status recipe is stated once, in [patterns/fe/README.md](../patterns/fe/README.md#data-status-of-a-region) (FE-ERROR-1) | keep it in function.yaml and error.yaml | the grammar contract links to one place | none |
| C-7 | "slot" means an HFS slot; a component's named part is an "anatomy slot"; `Slot<T>`/`SlotView` stay code identifiers and prose calls the value a "resource" | rename the code type | renaming code is out of scope; prose can be exact now | optional code rename of `Slot<T>` to `Resource<T>` |
| C-8 | App tiers keep `blocks/composites/branches/leaves`; grammar tiers keep `primitive/composite/branch/composition`; a grammar component is never called a "leaf" | one shared vocabulary | they are different layers with different rules | none |
| C-9 | `FE-STATE-REDUX` and `FE-STATE-ZUSTAND` merge into FE-STATE-1 (one owner per kind of state, a table); FE-DATE and FE-NUMBER become FE-I18N-5 (formatting owners) | keep them as library topics | the decision is which store owns which state, not the library | none |
| C-10 | FE-FOLDER-5 (grammar package layout) and FE-ERROR-5 (grammar TypeErrors) are dropped from app patterns | keep them | they describe the grammar package's own code, owned by its source | none |
| C-11 | `hfs/rules.yaml` keeps 242 product rules with one-sentence laws, failure codes and enforcers (kind and id); 52 rules whose only enforcers are the runtime's own checks are not knowledge (list below); per-rule `gates`, `docs`, `templateNa`, `exemplifiedBy`, `witness`, `proves` and enforcer `at` paths are dropped | port them | gates are policy (quality.yaml); evidence ledgers are coverage policy; `at` named legacy script paths that the new harness does not have | the new CLI implements the `hfs`/`machine` enforcers or the catalog marks them planned |
| C-12 | `hfs/slots.yaml` is ported as data (156 slots), with `since`, `exemplifiedBy`, `templateNa`, `consumers`, `versioning` history and ruling citations removed; field and parameter meanings moved to hfs/README.md | keep the comment documentation in the YAML | the comments mixed history with field docs; a parse-and-write port cannot keep comments | the vendored canon runtimes still read their copy of the legacy manifest; repoint them to `knowledge/hfs/slots.yaml` |
| C-13 | `ruleParams` (infraOwners, specDoubles, suffixes, ...) stay in `hfs/slots.yaml` | move each into the lint package that reads it | one owner either way; moving needs package releases | revisit when the canon packages are rebuilt in this repository |
| C-14 | `stack/pins.yaml` keeps `@starci/eslint-grammar-starci` (the published name) and lists the rename as pending removed vocabulary | pin the future `eslint-grammar-common`/`-core` | write what is true now; the renamed packages are not published | publish `@starci/eslint-grammar-common` and `-core` (open-grammar D-7), then repin and drop the pending entry |
| C-15 | The node base image tag is a pin in `stack/pins.yaml` `images` (R190) | keep it as a constant in the docker rule | a law named a script constant as its owner | the docker rule reads the pin |
| C-16 | `rulings.yaml` keeps only live and proposed rulings; superseded and amended ones are folded into their successor and listed under `absorbs`, so an old citation still resolves | keep superseded entries with `status` | replace, never append | none |
| C-17 | The FE dated owner cases of 2026-10-13 (one library per concern, front end serves no API, wire types generated) are logged as `fe-stack-one-library`, `fe-auth-only`, `fe-wire-generated`; the BE owner decisions of 2026-09-30 and 2026-10-02 as `be-convention` and `be-bounded-contexts` | one entry per legacy case | each case restated the same decision for another topic | none |
| C-18 | R216 lost its numeric bound (`auth.jwt_expiry`); no parameter owns it yet | keep the number in the law | laws carry no values | add `ruleParams.db.jwtExpiryMaxSeconds` (or similar) and have R216 read it |

## Contradictions found, with the resolution written

| Where | Contradiction | Written as |
|---|---|---|
| R32, R47 vs R212, R272 | R32 and R47 require the e2e world, but lite has none | open: R32 and R47 should be scoped to full |
| R102 vs R47, R281 | unit specs allowed only for `unitRoles` vs required or optional for every logic role | open: the be test pattern follows R281 (a logic role owes coverage, a spec is optional) |
| R43 vs R248 | capability config helpers placed in `main.ts`/`<app>.env.ts` vs read from `*.config.ts` | open: patterns/be/config.md follows R248 |
| R164 vs R10, R266 | own images pinned by version tag vs by digest | open: digest, as R10/R266 |
| R06, R220, R277 | three rules for sealed secrets; R220 is the lite-only copy | open: merge into R06 |
| R18 vs R303, R22 vs R72 | pairs restating one law | open: merge each pair |
| BE handler role (BE-FUNCTION-1, BE-API-2 vs BE-CQRS-3, R87, R203) | handler opens the transaction vs handler is thin | thin handler; the service authorizes, opens the transaction, stamps the clock |
| BE event contract source | `events.ts` table vs typed classes equal to `events.json` | `events.json` emitted from the classes (R151); the saga `files:` data still names `events.ts` |
| BE breaking event change | bump the version vs publish `<event>.v2` | `<event>.v2` (R177) |
| BE job processor | `features/jobs/<job>/<job>.processor.ts` with `run(at)` vs `transport/queue/<job>.processor.ts` extending `FencedProcessor` | the jobs pattern's form |
| BE `transport/message` in api features vs reactors own other-context consumers | both legal in legacy | kept the api allowance; open for the owner |
| FE tests | R97 (front end has no tests) vs `policy/quality.yaml` profile `fe` running `unit` in CI | knowledge keeps R97; policy should drop `unit` for fe or the owner rules otherwise |
| Legacy finding codes without a rule | BE_APP_MODULE_LIST_INLINE, BE_REST_ROUTE_UNDECLARED, BE_WEBHOOK_INBOX_KEY, STACKS_REALTIME_SCALED and several DB_* codes appear in patterns but in no rule's failure codes | patterns cite only existing rule ids; the catalog gaps stay open |

## What `policy/` should take (not ported into knowledge)

- **Enforcement law** (legacy `patterns/enforcement.yaml` ENF-MANDATORY-1..7): already implemented by `policy/loosening.yaml`
  and the check gates; the ENF-PROP proposals are dropped (their FE test clauses contradict R97).
- **Design truths** (legacy `hfs/design-truths.yaml`): the loosening exceptions belong in a project's
  `policy/loosening.yaml`; the budget pins are already owned by `hfs/slots.yaml`.
- **Sonar** (legacy `sonar-gate.yaml`): thresholds and the new-code gate belong to `policy/quality.yaml` (`sonar-new-code`).
- **Coverage ledgers** (legacy `hfs/requirements.yaml`, `hfs/surfaces.yaml`, `patterns/scan-coverage.yaml`, the rules'
  `witness`/`proves`/`exemplifiedBy`): coverage evidence, a `policy/coverage/` concern if kept at all; "surfaces" there
  means coverage areas, not UI surfaces.
- **CI standard** (legacy `hfs/ci-standard.yaml`, ruling `ci-standard`): the app CI shape is template and policy data.
- **Runtime-only rules** (52, enforced by the runtime's own checks): R07, R09, R114-R119, R121, R122, R124-R127,
  R192-R196, R198-R202, R205, R206, R208-R211, R221-R225, R227-R234, R236-R242, R247, R274. They govern the harness
  repository; the new harness states its own in `policy/` and `CONTEXT.md` "Decisions".
- **Harness rulings** not logged here: supervisor-mission, supervisor-self-learning, supervisor-machine-log,
  ram-aware-concurrency, autopilot-run-to-finish, settle-runtime-service, evidence-in-db-and-blobs,
  providers-claude-codex-devin, one-pattern-no-legacy, no-runtime-specs, speed-flow, release-waves,
  push-main-after-scoped-check, publish-as-soon-as-done, scope-before-check, candidate-ci, release-require-ci-per-project,
  loosening-always-red, loosening-state-check, design-truths-*, hook-input-budget-pins, orca-terminal-create-official,
  lite-chat-full-op, handover-owner-approval, credential-build-placeholders, owner-language-logs, push-scan-test-secrets-encrypted,
  alpha20-secrets-by-consumer, and the draw-loop rulings (draw-shapes-only, draw-content-region-only, draw-token-render,
  draw-rationale-evidence, draw-devin-brand-claude, one-version-owner-review, drawing-owner-parts, drawing-light-device-matrix).
- **Product records** not logged: `nivo-main-colour-ink` belongs to that product's `.starciwork`.

## Shared coding standard (patterns/shared)

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| S-1 | `Array<T>` / `ReadonlyArray<T>` is one shared rule (SHARED-TYPING-3), although the reference front end writes `T[]` in route props | keep it back-end only | both side topics already stated it; the back-end lint holds it; the front-end canon's own doc says consumers get `@typescript-eslint/array-type`, which its `BORROWED` set does not include | add `@typescript-eslint/array-type` (generic) to `eslint-canon-fe` `BORROWED` |
| S-2 | The only type assertion is `as const` on both sides (SHARED-TYPING-2) | the front-end lint's allowance of a single `x as unknown` | an `as unknown` is a widening nobody needs where the value is already typed; the back-end lint refuses it | front-end `no-type-assertion` refuses `as unknown` too, or adopts `consistent-type-assertions` never |
| S-3 | Named exports everywhere; a default only in a file the framework loads by default (Next route files, the test world's global setup and teardown) (SHARED-NAMING-2) | FE-IMPORTS-7's "no default export from a reusable component" | that wording left non-component modules open; both lints already refuse every other default | none |
| S-4 | Module-level functions are arrow constants on both sides, with a back-end overload set as the one exception (SHARED-NAMING-3) | front-end only | BE-NAMING-5 already asked for arrow function values; the reference back end declares an overload set with `function`, which an arrow cannot express | a back-end `prefer-arrow-export` that admits overload sets |
| S-5 | A repository tsconfig sets only `paths`, `include`, `exclude`, `outDir` and restates no preset flag (SHARED-TYPING-1) | allow restating | the reference front-end app restates `plugins` and `incremental` already in `next.json`; a second owner of a flag drifts | an `hfs` check beside R22 that refuses a restated preset flag |
| S-6 | Nothing checks format before CI, so the op runs Prettier on its changed files (SHARED-FORMAT-1); the harness commit (`commit-tree`) runs no hook (SHARED-SCRIPTS-4) | rely on the app's pre-commit hook | the hook never runs on a harness commit | a `format` gate in the runtime tier of the app profiles |
| S-7 | Source language: English and no emoji on both sides, ASCII only on the back end (SHARED-COMMENT-3) | ASCII on both | the front-end lint judges a second language structurally (`no-vietnamese-in-source`) and admits typographic punctuation; the lint wins for what it enforces | none |

## Front-end coding standard (patterns/fe)

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| F-1 | The status recipe (FE-ERROR-1) is `DataSlot<T>` with `items`/`isLoading`/`isError`/`isForbidden`, `slotOfSwr`/`mapSlot`, `SlotView` with a same-shape `placeholder` value; no unauthorized status and no `xDefaultState` | the former `Slot<T>`/`toSlot` with `isUnauthorized` and an exported `xDefaultState` | the reference app has no `toSlot`, no `isUnauthorized` and no `xDefaultState`; a signed-out viewer is sent to sign-in by the proxy and the session gate before any region renders; the lint holds the "rest as itself" model (`no-placeholder-prop`, `slot-status-through-slotview`) | `knowledge/grammars/common.md` "Data status of a region" still lists "unauthorized"; C-6 and C-7 name the old identifiers |
| F-2 | `XBaseProps` is `{ state?, props, on? }`: `state` only when a unit has more than one drawn shape (FE-FUNCTION-2) | `state` always, with `xDefaultState` | 17 of 343 reference pure halves take `state`; `base-props-atom` accepts its absence | none |
| F-3 | Class-name exports are UPPER_SNAKE `<ROLE>_CLASS_NAME` built with `cn` from `@heroui/react` (FE-NAMING-3, FE-IMPORTS-3) | `xClassName` / `xClassNames` / `getXClassName` | 1037 of 1073 reference exports are UPPER_SNAKE; the grammar lint lets a `classNames.ts` import `@heroui/react` | an export-name check in `class-names.mjs`; C-4's follow-up ("refuse every app import of a vendor UI package") must keep `cn` in `classNames.ts` and the providers file |
| F-4 | Object contracts are `interface`, unions and aliases `type` (FE-TYPING-1) | props as `export type` | 325 of 332 reference `XBaseProps` are interfaces; no lint judges it | none |
| F-5 | GraphQL operations return the Apollo result and the SWR wrapper throws on missing data; `GraphQLResponse<T>` is the outcome of non-Apollo calls (auth actions, toast runners) only (FE-ERROR-2) | every operation returns `GraphQLResponse<T>` | the reference operations reject on `errors[]` and 0 SWR hooks read `success: false` | the reference declares `GraphQLResponse<T>` in `modules/types/outcome.ts`, not the outcome slot `modules/api/graphql/types.ts` that R51 names; move it |
| F-6 | Writes run through a domain command hook (`use<X>Commands`) that uses `useGraphQLWithToast` and revalidates the reads it changed (FE-DATA-COMMAND) | a block calls `useMutate<X>Swr` itself | the reference does it this way in 84 hook files; the mutation wrappers never revalidate | none |
| F-7 | The viewer is isolated by an SWR cache keyed by viewer id in the providers; a key carries the tenant id and the request arguments (FE-DATA-KEY) | the viewer id in every key | that is how the reference isolates users; a stream key still carries the viewer | `swr-data-lifecycle` identities should name the tenant helper |
| F-8 | Providers live in `app/[locale]/providers.tsx`; app-wide side effects are `hooks/effects/*SideEffect.tsx` mounted by a `SideEffectsLayout` inside the providers (FE-BOUNDARY-3) | `components/providers` and `SwrSideEffects.tsx` | the reference has neither; slot `fe.route` allows `providers.tsx` | slots `fe.components.providers` and the `SwrSideEffects.tsx` allowance of `fe.hooks.swr` have no reference instance |
| F-9 | `brand.css` is the fourth import of `globals.css` (FE-CSS-2) | import it from `modules/brand/index.ts` in the root layout and the global error file, as the reference does | one import site instead of two; stylelint `globals-import-order` accepts both | move the reference import |
| F-10 | The routing prefix mode is the product's choice inside the one routing config (FE-I18N-1) | `localePrefix: "as-needed"` everywhere | the reference uses `"never"` with cookie negotiation; only a message string of `next-conventions.mjs` mentions `as-needed`, no rule checks it | none |
| F-11 | The client catalog `pick` of R60 is not stated as a rule (FE-I18N-3) | state it | the reference passes the whole catalog to the client provider and no check implements `pick` (R60's `hfs i18n-catalog` checks key parity) | implement `pick` in `i18n-catalog`, or drop it from R60's law |
| F-12 | Input bounds come from the generated `INPUT_BOUNDS` through `inputBoundsIssues` (FE-FORM) | copied constants in `<domain>.shared.ts` | codegen emits them and copied numbers drift from the back end; the reference generates them but has 0 consumers | migrate the reference forms; a lint candidate refusing numeric `min`/`max` literals in `hooks/rhf` |
| F-13 | Hook domain folders are camelCase, module folders and files kebab-case (FE-NAMING-5) | one case for both | the reference has 63 camelCase and 18 kebab-case hook domains, and kebab-case modules | rename the 18 kebab-case hook domains |
| F-14 | Glyph sets are imported only by `components/leaves/Icon` (FE-ICON) | allow `modules/toast` | the reference toast imports `@heroicons/react` directly; the toast should take its glyphs from the Icon map | move the toast glyphs |
| F-15 | Socket.io and GraphQL subscription doors stay in FE-REALTIME-2 | drop them | the reference uses SSE only, but the back-end realtime pattern keeps the doors and the lint names their homes | none |

## Back-end coding standard (patterns/be)

Decisions taken while making [patterns/be](../patterns/be/README.md) match the lite reference app and
`@starci/eslint-canon-be`; the lint wins for what it enforces, the reference app for the rest.

| Id | Decision | Alternative | Reason | Follow-up |
|---|---|---|---|---|
| B-1 | Errors are `DomainError` families per capability (BE-ERROR-1) | an `AbstractException` base | the lint (`throw-domain-error`, `error-family-shape`) and the reference app both use `DomainError`; `AbstractException` is a legacy product's base | none |
| B-2 | A refusal is thrown as the capability error; an `Outcome` only where a caller in the modules branches on it (BE-ERROR-3) | every expected refusal returned as an `Outcome` | the reference throws in about 230 service files and returns `Outcome` in about 25; the lint enforces only the error type | none |
| B-3 | A method that joins a caller's transaction takes the manager as its last parameter, defaulting to the injected one; a producer takes a required `tx` (BE-PERSISTENCE-10) | a required `manager` field of a params object | the reference shape; the lint judges only which manager is used inside a callback | none |
| B-4 | Queue producers are `enqueue<Job>(payload, tx)` with a dedupe key and no correlation id; correlation (BE-LOGGING-4) applies only to an app declaring the `logging` pattern | a required `correlationId` on every producer, `HttpClient` call and job | the reference has no correlation id anywhere and its `HttpClient` port has no such field; no lint requires it | decide whether lite declares `logging` |
| B-5 | A flat job or queue payload is narrowed by a hand-written `is<Payload>` guard; zod is for deep shapes (BE-TYPING-5, BE-TYPING-8) | zod for every non-DTO boundary | the reference guards queue payloads by hand and keeps six schema files; the lint only places and bounds zod | none |
| B-6 | Retries are job attempts; an in-process wait uses the `Timer` port of `platform/retry` (BE-RESILIENCE-1) | a `retry(fn, bounds)` helper | the reference `platform/retry` exports only `Timer`; `no-hand-rolled-retry` holds either way | none |
| B-7 | A pure policy or mapper may carry its own spec (BE-TEST-1); the rule that helpers are covered only through their service is removed | keep BE-TEST-8 | the lint makes a spec optional beside every logic-role file and the reference has many | none |
| B-8 | A builder used by one spec may live in it; only a shared or row-writing builder lives in `fixtures/builders` (BE-TEST-16) | every builder in `fixtures/builders` | the reference defines one-spec builders inline; the lint homes only persisting builders | none |
| B-9 | The back-end line-comment casing rule (lowercase first letter) is removed; SHARED-COMMENT-2 governs | keep BE-COMMENT-5 casing | the reference writes 125 of 137 line comments as capitalised sentences and no lint checks casing | the shared example may keep either casing |
| B-10 | A `@Credential({ kind })` public API route counts as REST evidence (BE-TRANSPORT-1) | only the listed public reasons | the reference serves its public API as credential routes and passes `rest-door-needs-a-reason` | name the credential case in the rule's message |
| B-11 | Lite schedules are `pg_cron` ticks in migrations that enqueue through the declared outbox function; the app scheduler list stays empty (BE-QUEUES-3) | BullMQ job schedulers | the reference does so; R258 covers the tick | none |
| B-12 | Lite composition is proved by the wiring check and services; no e2e per operation (BE-API-3) | an e2e flow per operation in both editions | lite forbids the e2e world (R212) | R32 and R47 scoping (contradiction above) |
| B-13 | Event-bus, reactors, saga, projections and services topics are marked full-edition and were not re-verified | rewrite them against lite | the reference declares none of them | owner ruling on lite patterns ([project/lite.md](../project/lite.md)) |
| B-14 | The `files` front matter (legacy scaffold trees naming entities, TypeORM migrations and templates that do not exist) is removed from every be topic; the slots it fed into the anatomy are now declared in `slots` | keep the trees | nothing in this harness reads them but the anatomy, and they described the full edition's legacy layout as if it were lite's | none (anatomy unchanged) |
