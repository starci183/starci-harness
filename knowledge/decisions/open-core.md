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
