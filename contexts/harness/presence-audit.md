# Presence audit of the hfs rules and the contexts laws

A law that says an app must contain something, or a round must produce something, is enforced only when a check refuses its
absence as well as a wrong one. A check that judges only what exists ("if present, it must be right") lets work bypass the law by
not making the thing or putting it elsewhere. This table holds every such law of [hfs/rules.yaml](../hfs/rules.yaml) and of
`contexts/project` and `contexts/code`, classified by what refuses it:

- **a**: enforced both ways, presence and correctness;
- **b**: correctness only, presence unenforced (a gap);
- **c**: not enforced at all.

Checker paths are under `packages/hfs/runtime/scripts/hfs/` unless they name another root; eslint ids are rules of
`@starci/eslint-canon-be` or `-fe`. A presence law enforced only by eslint, typecheck or coverage holds while that gate runs; an app
may switch those gates off ([project/lint.md](../project/lint.md) PROJECT-LINT-4), which is the app's declared choice, not a gap.

## hfs rules

| Law | Must contain or produce | Class | Checker (presence) |
|---|---|---|---|
| R02 | every required slot file, `minInstances`, `requiredInstances` | a | `check.mts:245` (`HFS_SLOT_REQUIRED_MISSING`), machine `architecture/required-files.mts` |
| R13 | CI runs the pinned `app check --gate lint`; hooks installed | a | `rules/pipeline.mts:17` |
| R23 | a contract snapshot per api app (`schema.graphql`, `openapi.json`) | a | `rules/contract.mts:22` |
| R31 | every feature, transport and capability module composed | a | machine `architecture/reachability.mts:17` |
| R46 | a runner for every sweep, outbox and retry | a | machine `architecture/background-unowned.mts:67` |
| R47 | the one test world `src/tests/world/`, specs through `useTestWorld` | a | `rules/test-infra-placement.mts:19` (`BE_SPEC_WORLD_MISSING`), eslint `test-world-files` |
| R47, R281, SHARED-TEST-2 | a unit spec beside every logic-role file | b | new files: `rules/staged-specs.mts:12` (`BE_UNIT_SPEC_NOT_STAGED`, pre-commit); the whole tree only through eslint `unit-test-colocated` and R273 coverage, both gates an app may switch off; see "Not added" |
| R53, FE-FOLDER-4 | global-error, locale error, not-found and loading boundaries | a | machine `architecture/required-files.mts:46` |
| R57 | every owner mounted, every href routed | a | machine `architecture/reachability.mts:17` |
| R59 | `src/proxy.ts`, the default `vi.json` catalog | a | `rules/frontend-tree.mts:21` |
| R60, FE-I18N-3 | a catalog for every declared locale and none for another; the same keys in each | a | `rules/i18n-locales.mts` (`FE_I18N_LOCALE_MISSING`), `rules/frontend-tree.mts:22` (`FE_I18N_CATALOG`) |
| R106 | every key read exists in every locale; every key is read | a | machine `architecture/i18n-keys.mts` |
| R105 | every file a `.starciwork` proof command runs | a | `rules/proof-commands.mts:19` |
| R109, BE-COMMENT-3 | JSDoc on every public member | a | eslint `require-public-member-jsdoc` |
| R111 | the runtime peer of every driver integration | a | `rules/peer-integrations.mts:12` |
| R112 | an integration spec per integration (full) | a | `rules/integration-specs.mts:22`; the law is `editions: [full]`, lite proves through R284 |
| R143, R144, R145 | workspaces, lockfile, `nest-cli.json` projects per declared app | a | `rules/monorepo.mts:24` |
| R147 | the ops cli app when a connection or ops command exists | a | `rules/cli.mts:20` |
| R151 | a class per vendored event entry and an entry per class | a | `rules/event-bus.mts:17` |
| R155, R284 | a `<pattern>/<scenario>` test per declared pattern scenario | a | `rules/event-bus.mts:18`, `rules/proof-lane.mts:11`; an undeclared pattern's platform slot is `HFS_SLOT_NOT_ENABLED` |
| R165 | a `role: service` component per api or worker app (multi-service) | a | `rules/services.mts:33` |
| R166 | `events.json` per service | a | `rules/event-tables.mts:7` |
| R167, BE-SERVICES-4 | an e2e spec per consumed event | a | `rules/services.mts:35` |
| R173, BE-SAGA-4 | an e2e spec per saga compensation | a | `rules/saga.mts:30` |
| R179 | `sides.be.kinds` exactly the kinds in use, with their patterns | a | `rules/kinds.mts:14` |
| R245, R289, BE-CONFIG-1 | `<app>.env.ts`, `<app>.options.ts`, `compose/`, `app.module.ts` per app | a | `rules/app-env-required.mts:6` |
| R248 | every required environment read is sealed or declared, every sealed key read | a | `rules/env-parity.mts:34` |
| R262, BE-AUTH-8 | distinct live and ready signals | a | eslint `ready-real`, `health-signals` |
| R267 | images lock, release pointers, health assertions, backup per Swarm environment | a | `rules/stacks-release.mts:68`, `:80` |
| R268 | a jobs declaration per scheduler | a | `rules/stacks-release.mts:37` |
| R269 | Dependabot, `npm audit`, SBOM and provenance | a | `rules/supply-chain.mts:205` |
| R272 | the boot proof of every lite back-end app | a | `rules/boot-proof.mts:8` |
| R273, BE-TEST-13 | full coverage per measured logic file | a | coverage gate, `rules/coverage-below.mts` |
| R275 | one ingress per Swarm environment | a | `rules/stacks-ingress.mts:35` |
| R280 | a production consumer per enum member, queue constant, error code, catalog key | a | `rules/unused-symbol.mts:14` |
| R295, BE-ARCHITECTURE-3 | a module definition and options file per module | a | eslint `module-definition-required` |
| R300 | each required `NEXT_PUBLIC_*` as an ARG default or a build arg per environment | a | `rules/fe-build-args.mts:1` |
| R302, BE-AI-6 | a tool catalog for a served MCP server | a | `rules/mcp-tools.mts` (`HFS_MCP_TOOLS_SNAPSHOT_MISSING`, `HFS_MCP_TOOLS_SNAPSHOT`) |
| R333, R35 | every entity listed in `PRIMARY_ENTITIES`, every listed column in the migrations | a | machine `architecture/schema-owner.mts:203`, `packages/hfs/db/drift.mts` |
| R343 | a committed check cache record per base | a | `packages/hfs/cache/trust.mts:15` (`HFS_CHECK_CACHE_MISSING`) |
| R372 | a lite app's dev environment | a | `rules/stacks-local.mts:83` |
| R388, PROJECT-BRANCH-1 | `main` and `dev` | a | `dev-branch.mts:1` |
| R393 | every migration file applied to the dev database (`--env local`) | a | `packages/hfs/stack/local-live-checks.mts:7` |
| R395, PROJECT-GALLERY-1, PROJECT-GALLERY-2, PROJECT-GALLERY-4, PROJECT-GALLERY-5, PROJECT-GALLERY-6 | the gallery; a screen (`explain.md`) per `page.tsx` route of the front end; a screen's `explain.md` changed with its source | a | `rules/gallery.mts` (`HFS_APP_GALLERY_MISSING` the folder; `HFS_APP_GALLERY_ROUTE_MISSING` a route with no screen, so an empty `gallery/pages/` fails), `rules/gallery-coupling.mts` (`HFS_APP_GALLERY_EXPLAIN_STALE`), `rules/gallery-design.mts` (`HFS_APP_GALLERY_DESIGN_UNAPPROVED` a screen of a designed area with no approved design); `localOnly`: warnings in `--env local`, errors in `--env prod` |
| R437, PROJECT-BRAND-1, PROJECT-BRAND-2 | the brand sheet `.starcistacks/brand/illustration.yaml` once an app keeps a `statics/**/*.prompt.yaml`; in each prompt file the base it names (`basePrompt.name`, default `illustration`, else a base of `media.yaml`), its `basePrompt.version`, `subject` and a `prompt` that starts with the base text | a | `rules/brand.mts` (`HFS_BRAND_MISSING` the sheet, `HFS_BRAND_PROMPT_STALE` the version, `HFS_BRAND_PROMPT_INCOMPLETE` the subject and the base text; `HFS_BRAND_INVALID` a malformed sheet or media.yaml, `HFS_BRAND_BASE_UNKNOWN` a prompt file naming a base the sheet does not define); `localOnly` except the last: warnings in `--env local`, errors in `--env prod`; the folder is optional in the slot manifest and the scaffold writes it |
| R396 | an `<area>.<action>` operationId per REST operation | a | `rules/rest-contract.mts:63`; the document's presence is R23 |
| R399 | each declared side tracks files | a | `rules/project-sides.mts:31` |
| R436, PROJECT-BUSINESS-1 | each declared nivoos package holds its files, a root package that depends on the nivoos SDK is declared, and its `nivoos package check` passes | a | `rules/nivoos.mts` (`HFS_NIVOOS_PACKAGE_MISSING`, `HFS_NIVOOS_UNDECLARED`), `cache/nivoos-package-check.mts` (`HFS_NIVOOS_PACKAGE_CHECK`) |
| R426, PROJECT-STACKS-14 | a store per stateful component; the seed door (`adapter.command`) of a store a seed-backup or a seed-standard set fills | a | `rules/data-stores.mts:89`, `rules/data-stores.mts:76` |
| R429, PROJECT-STACKS-5 | each declared secret target | a | `rules/secret-targets.mts:34` |
| R433, PROJECT-WORK-7 | the `conventions` concept and its row; one catalog row per concept | a | `rules/concepts-conventions.mts` (`HFS_CONCEPT_CONVENTIONS_MISSING`, `HFS_CONCEPT_UNCATALOGUED`) |
| R434, PROJECT-STACKS-13 | in a seed-standard with `adapter/`: its entry `adapter/main.ts`, `adapter/package.json`, the commit hook `.githooks/pre-commit` and the CI workflow `.github/workflows/seed-standard.yml`, each running `starci app check --staged`; the adapter's output for every committed output file | a | `rules/data-adapter.mts:50` (`HFS_DATA_ADAPTER_UNGUARDED`; `HFS_DATA_ADAPTER_DRIFT` for an output file the adapter writes and the commit lacks), run by the copy repository's commit hook and CI (`sync/hygiene.mts`) |
| R177, BE-PERSISTENCE-15 | a pinned previous copy of a published contract | b | `rules/rest-contract.mts`, `rules/services.mts` judge a pin that exists; see "Not added" |
| R390, R391, R392 | a non-blocking side step, a holding line, the `waited` ladder declaration | c | planned enforcers, no checker (held by review) |

## contexts laws

| Law | Must contain or produce | Class | Checker (presence) |
|---|---|---|---|
| PROJECT-STACKS-3, PROJECT-STACKS-6 | a runbook per environment with the seven operations | a | `stacks-gate.mts:257` (`runbook-path-invalid`, `runbook-command-missing`) |
| PROJECT-STACKS-12 | seed data only in the seed levels, each with its manifest | a | R375 `rules/seeds.mts` |
| PROJECT-WORK-4 | an integration designed from the provider's current documentation | c | judgement: whether its author read the documentation is not in the tree |
| PROJECT-WORK-7 | the concept of every folder a task touches is read first | c | review only; no law requires every folder to have a concept, so coverage is not checkable |
| BE-API-3 | an e2e spec per resolver and controller (full) | c | review only (`Enforced by` says so) |
| BE-TEST-5 | every branch, boundary and refusal per method | c | judgement; R273 measures the lines it reaches |
| FE-FUNCTION-7 | a story per shape member | a | eslint `shape-has-story` |
| CONTRIB-20 (harness) | a CHANGELOG entry per raised package version | c | `release cut` refuses a tag without its section (`cli/src/core/release/cut.ts:65`); a package published by `release publish` is not asked for one |
| CONTRIB-20 (harness) | a raised version per changed package | a | `cli/src/core/release/publish.ts:247` |
| harness verbs | documentation per verb | a | `starci explain` is generated from the verb definitions |

## Not added

- **Unit spec presence over the whole tree (R47, R281).** The pre-commit check holds new files; the tree is held by eslint and
  coverage, which PROJECT-LINT-4 lets an app switch off while its product is not settled. An hfs check would overrule that
  declaration, so presence stays with the gates the app runs.
- **Integration specs in lite (R112).** The law is `editions: [full]`; lite proves its integrations and patterns through R284.
  Extending it is a change of the law, not a missing check.
- **Pinned contract copies (R177).** Whether a contract is published is not in the tree, so the absence of its pin cannot be decided.
- **Concept coverage per folder (PROJECT-WORK-7).** No law requires it; adding one is the owner's decision.
- **CHANGELOG entry per published version (CONTRIB-20).** Decidable, but it belongs to `release publish` in `cli/`, outside hfs.
- **Gallery shots per UI round (R395).** Owned by the lane that couples gallery coverage to UI changes.
