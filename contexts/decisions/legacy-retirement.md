# Retiring the legacy runtime

The owner ordered three things: every package under `packages/` is TypeScript source built to JavaScript, the legacy
runtime at `D:/Repositories/starci-academy-backend/.claude` (the `starci-skills` repository) is deleted, and whatever
context it still holds that this harness lacks moves here. The owner also ruled that this harness is the final version:
the legacy tree is read only as a supplement, and the flows of this harness are the standard. A legacy flow, engine,
workflow, orchestration, runtime, seat or gate is therefore obsolete wherever this harness has its own mechanism, and
nothing below ports one. Secret files are out of scope; the owner moves them himself.

This file is the owner's review queue for that retirement, like the `open-*.md` files beside it. It is the inventory
and the plan, read on 2026-10-27 from legacy `main` at `9b808daa5` and from this repository's `main` at `bfe0bf9`; it
changes nothing in either. When the deletion step at the end is done, the moves it lists have landed in their owners and
this file is deleted (CONTRIB-7: plans live in git).

## 1. Context map

Every legacy area has one of three fates. **Owned** names the harness file that holds the fact today. **MISSING** means
no harness file holds it yet. **OBSOLETE** means it describes the legacy runtime's own machinery, which this harness
replaces; the reason names the replacement. The knowledge port into `contexts/` was already done and recorded:
[open-core.md](open-core.md) (C-1 to C-18 and "What `policy/` should take"), [open-grammar.md](open-grammar.md),
[open-ui.md](open-ui.md) and the analysis notes under `docs/knowledge-analysis/`; this map relies on them and does not
repeat their rows.

### knowledge/ (226 files)

| Legacy area | Fate | Harness owner, or reason |
|---|---|---|
| `knowledge/hfs/slots.yaml`, `rules.yaml`, `README.md` | Owned | `contexts/hfs/slots.yaml`, `contexts/hfs/rules.yaml`, `contexts/hfs/README.md` (C-11, C-12) |
| `knowledge/hfs/canon-pins.yaml`, `fe-stack.yaml` | Owned | `contexts/stack/pins.yaml`, `contexts/stack/fe.yaml` |
| `knowledge/hfs/rulings.yaml` | Owned | knowledge rulings: `contexts/decisions/rulings.yaml` (C-16, C-17); harness rulings: `contexts/harness/decisions.md` |
| `knowledge/hfs/design-truths.yaml` | Owned | `policy/loosening.yaml` and the budgets of `contexts/hfs/slots.yaml` (open-core "What policy should take") |
| `knowledge/hfs/requirements.yaml`, `surfaces.yaml`, `patterns/scan-coverage.yaml` | OBSOLETE | coverage ledgers of the legacy audit; `policy/quality.yaml` owns what CI measures |
| `knowledge/hfs/runtime-slots.yaml` | OBSOLETE | the legacy repository's own tree standard; this repository's shape is `cli/README.md` and `hfs.json` |
| `knowledge/hfs/facts.yaml` | OBSOLETE | backs R192, a runtime-only rule (open-core list); prose is held by review here |
| `knowledge/hfs/ci-standard.yaml` | Owned | the CI workflow template of `packages/hfs/templates` and `policy/quality.yaml` (open-core) |
| `knowledge/hfs/docker.md` | Owned | `contexts/code/be/services.md`, R187 to R191 in `contexts/hfs/rules.yaml`, the image pins of `contexts/stack/pins.yaml` (C-15) |
| `knowledge/hfs/peer-integrations.yaml` | MISSING | read by `HFS_PEER_INTEGRATION_MISSING` (R111) from a copy in `packages/hfs/runtime`; no `contexts/` owner (item M-7) |
| `knowledge/patterns/be/*` (34) | Owned | `contexts/code/be/*.md`, one topic each; `architecture-check.yaml` is the project graph of `packages/eslint-canon-be` |
| `knowledge/patterns/fe/*` (41) | Owned | `contexts/code/fe/*.md`; library-only topics are `why` lines of `contexts/stack/fe.yaml` (C-2); css, ui and icon are `code/fe/ui.md` (C-3); redux and zustand are FE-STATE-1, date and number FE-I18N-5 (C-9); multi-app is `code/fe/folder.md` |
| `knowledge/patterns/repo/*` (10) | Owned | `contexts/code/shared/*.md`, `contexts/project/{README,lite,stacks,lint}.md`, `contexts/stack/pins.yaml`, `policy/security.yaml`, size budgets in `contexts/hfs/slots.yaml` |
| `knowledge/patterns/enforcement.yaml` | Owned | `policy/loosening.yaml` and the gates of `cli/src/core/check/` (open-core) |
| `knowledge/ui/composition/*`, `presentation/*`, `proof/*` | Owned | `contexts/ui/composition.md`, `presentation.md`, `proof.md`, `ui/proof/thresholds.yaml` and the three anchors |
| `knowledge/ui/examples/brand-direction.example.yaml` | OBSOLETE | a product record; brand records live in a product's `.starciwork` (`contexts/project/work.md`) |
| `knowledge/grammars/common/`, `offset-pop/` | Owned | `contexts/grammars/common.md` (idioms and playbook shapes, D-9), `contract.md`, `contract.yaml`, `offset-pop.md` |
| `knowledge/grammars/starci/`, `heritage/` | OBSOLETE | removed vocabulary (CONTRIB-15); the family is `core`, `contexts/grammars/core.md`; the open shapes are O-12 |
| `knowledge/vendor/heroui/*` (65) | Owned | `contexts/vendor/heroui.md`, `parity.yaml`, `wrappers.yaml` |
| `knowledge/application-stacks.yaml` | Owned, gaps | `contexts/project/stacks.md`; the deployment playbooks are missing (M-3) |
| `knowledge/architecture-rules.yaml` | MISSING | the review-only architecture obligations (M-2) |
| `knowledge/design-patterns.yaml` | MISSING | the DP-01 to DP-16 catalog metadata (M-1) |
| `knowledge/op-gate.yaml` | OBSOLETE | the legacy READ-CODE-CHECK loop; `ops/ops/code.md` and `ops/checks.yaml` |
| `knowledge/sonar-gate.yaml` | Owned | `policy/quality.yaml` (`sonar-new-code`) |
| `knowledge/index.yaml`, `ui/index.yaml` | Owned | `contexts/README.md`, `contexts/ui/README.md` |

### docs/ (69 files)

| Legacy area | Fate | Harness owner, or reason |
|---|---|---|
| Rule explainers: `a16-*` (5), `hfs-*` (6), `legacy-*-rule-coverage`, `legacy-runtime-*`, `legacy-monorepo-rules`, `legacy-backend-rules`, `legacy-backlog`, `backend-boundary-proofs`, `backend-cli`, `be-shape-coverage`, `frontend-source-authoring`, `managed-tooling-coverage`, `test-builder-coverage`, `operation-contracts`, `nest-contract-check`, `next-data-lifecycle-check` | Owned or OBSOLETE | the law is `contexts/hfs/rules.yaml`, the check is in its canon package and README; the coverage notes are legacy audit evidence |
| `architecture.md` | Owned, runtime part OBSOLETE | app architecture: `contexts/code/{fe,be}/architecture.md`; "this repository's own layout": `cli/README.md` |
| `code-pattern-enforcement.md`, `quality-bar.md` | OBSOLETE | enforcement is `contexts/project/lint.md`, `policy/`; proof is `contexts/ui/proof.md`; coverage scope is R204 and `packages/hfs/README.md` |
| `design-pattern-catalog.md` | MISSING | M-1 |
| `application-stacks.md`, `remote-application-api.md`, `repo-presentation.md` | Owned, gaps | `contexts/project/stacks.md`; Swarm, scheduled work, backup, CI variable names, quality services, badges and remote APIs are missing (M-3) |
| `microservices.md` | Owned | `contexts/project/full.md` and `contexts/code/be/{services,messages,saga,webhooks,realtime}.md` |
| `lite-edition.md` | Owned | `contexts/project/lite.md` |
| `business-srs.md` | Owned, gap | `contexts/project/work.md`; the breadth of SRS and SDS reasoning is missing (M-6) |
| `interface-audit.md` | Owned, gap | `ops/ops/audit.md`, `contexts/ui/proof.md`; the judgement lenses are missing (M-5) |
| `browser-testing.md`, `assisted-uat.md` | OBSOLETE | `ops/uat.yaml`, `ops/ops/uat.md`, `skills/starci/references/uat.md` |
| `host-secrets.md`, `runtime-example-secrets.md` | Owned | `policy/security.yaml`, "Secret custody" of `contexts/project/stacks.md` |
| `cli.md` | OBSOLETE | `starci explain` |
| `ledger-db.md` | OBSOLETE | `cli/src/harness/ledger.ts`, `contexts/harness/state.md` |
| `workflow-kernel.md`, `supervisor.md`, `ops.md`, `ops-source-ownership.md`, `goal.md`, `why.md`, `verify-proof.md`, `agent-admission.md` | OBSOLETE | `ops/README.md`, `ops/coordinators/{kernel,supervisor}.md`, `ops/ops/README.md`, `ops/routing.yaml`, `ops/lanes.yaml`, `ops/routes.yaml` |
| `host-contract.md`, `orca-boundary.md`, `connectors.md` | OBSOLETE | `ops/host.yaml`, `cli/src/harness/host.ts` |
| `installation.md`, `config-format.md`, `provisioning.md` | OBSOLETE | README "Install"; harness state in `contexts/harness/state.md` |
| `git-governance.md`, `releasing.md`, `source-process.md`, `debugging.md` | OBSOLETE | CONTRIB-16 to CONTRIB-20; `skills/starci/references/{release,debug}.md` |
| `knowledge-yaml.md` | OBSOLETE | knowledge is Markdown with front matter (C-1) |

### The remaining folders and root files

| Legacy area | Fate | Harness owner, or reason |
|---|---|---|
| `CONTEXT.md` | Owned, gaps | load order: `contexts/README.md`; editions: `contexts/harness/axes.md`, `contexts/project/lite.md`; the front-end standard: `contexts/ui/**`, `contexts/code/fe/**`; the integration-research rule (M-4) and SRS breadth (M-6) are missing; the rest is the legacy operating model |
| `STARCI.md` (untracked, only in the main checkout) | OBSOLETE | removed vocabulary (CONTRIB-15) |
| `CONTRIBUTING.md`, `README.md` | Owned | `CONTRIBUTING.md`, `README.md` |
| `skills/starci/**` (13) | OBSOLETE | `skills/starci/SKILL.md` and `references/{define-workflow,run-workflow,debug,uat,release,routing-and-providers,worker,inline-task,ui-on-grammar}.md` |
| `modules/cli/commands/**` (300) | OBSOLETE | `defineVerb` files listed in `cli/src/registry.ts` |
| `modules/kernel/**`, `modules/goal/**` | OBSOLETE | `ops/coordinators/kernel.md`, `cli/src/harness/tasks.ts`, `cli/src/core/workflow/` |
| `modules/ops/**` (39 op manifests) | OBSOLETE | the ten labels of `ops/ops/*.md` (CONTRIB-15) |
| `modules/models/**` | OBSOLETE | `ops/routing.yaml` |
| `modules/host/**` | OBSOLETE | `ops/host.yaml` |
| `modules/supervisor/**` | OBSOLETE | `ops/coordinators/supervisor.md`, `cli/src/core/supervisor/` |
| `modules/reconciler/**` | OBSOLETE | removed vocabulary; `ops/liveness.yaml` |
| `modules/schemas/**` | OBSOLETE | zod schemas in `cli/src`; Work record schemas in `contexts/project/work.md` |
| `modules/i18n/**` | OBSOLETE | the legacy UI's messages; the harness is English |
| `engine/**` | OBSOLETE | `cli/src/harness/ledger.ts`, `cli/src/shared/`; copies survive in `packages/*/runtime/engine` (section 3) |
| `scripts/**` (1755) | OBSOLETE | verbs under `cli/src/core/**`, gates under `cli/src/core/check/`, `policy/`; `scripts/hfs/**`, `scripts/lib/**` survive as copies in `packages/*/runtime/scripts` (section 3) |
| `ui/**` (201) | OBSOLETE | `starci ui` (`cli/src/core/ui/`) and the desktop app `D:/Repositories/starci-harness-app` |
| `e2e/**` (21) | OBSOLETE | package specs (CONTRIB-2) and scratch-repository proofs (CONTRIB-1) |
| `examples/**` (2851) | OBSOLETE | removed vocabulary (CONTRIB-15) |
| `init/AGENTS.md` | Owned | "the bootstrap an app carries" in `contexts/harness/state.md` |
| `ext/sonar/**` | MISSING | the host's shared SonarQube Compose files; three containers run from them today (M-8) |
| `packages/eslint/{be,fe,grammar-starci,grammar-offset-pop}`, `stylelint`, `grammar`, `heroicons`, `hfs`, `jest-preset`, `prettier-config`, `test-world`, `tsconfig`, `event-stream` | Owned | `packages/eslint-canon-be`, `eslint-canon-fe`, `eslint-grammar-core`, `eslint-grammar-offset-pop`, `stylelint-canon` and the same names (moved, ahead of legacy) |
| `packages/cli` (`@starci/cli` 1.7.47, 30 files, 19,677 lines) | MISSING | pinned in `contexts/stack/pins.yaml` and installed by apps; its source exists only in the legacy repository (M-9) |
| `packages/fe-kit` (`@starci-examples/fe-kit`) | OBSOLETE | served the example front ends |

## 2. Missing context worth moving

Each item is a supplement to a harness owner that already exists and fits the harness flows as they are: the Kernel
names the file in a contract's `context.extend`, `starci contexts search` finds it, and no legacy flow comes with it.
Each is rewritten in the harness voice where its concept lives (CONTRIB-6), never copied, and lands with its ruling
in [rulings.yaml](rulings.yaml) when it carries one.

| Id | What | Legacy source | Supplements | Effort |
|---|---|---|---|---|
| M-1 | The design-pattern selection map: which mechanism (outbox, inbox, saga, lease and fencing, bounded retry, bulkhead, versioned events and the rest of DP-01 to DP-16) a scenario's invariants call for, and that no feature takes every one | `docs/design-pattern-catalog.md`, `knowledge/design-patterns.yaml` | a "Choosing a mechanism" section of `contexts/code/be/README.md`, each entry pointing at the topic that owns its code (`idempotency.md`, `saga.md`, `resilience.md`, `projections.md` ...) | M |
| M-2 | The architecture obligations only a reviewer can judge (the semantic part, without what `rules.yaml` already decides) | `knowledge/architecture-rules.yaml` | a "Review obligations" section of `contexts/code/README.md` | S |
| M-3 | Deployment and operations playbooks: Swarm on a VPS and lite production, scheduled work on Swarm, runtime configuration and health, database backup and reset, the CI secret and variable names (names only), the quality services, README status badges, and remote application APIs (consumer, rollout and cluster administration as three contracts) | `docs/application-stacks.md`, `docs/remote-application-api.md`, `docs/repo-presentation.md` | "Operations" and "Ingress" of `contexts/project/stacks.md`; product names removed | M |
| M-4 | External integration research: read the provider's current official documentation before designing an integration, record its sources, read date, auth and lifecycle limits and a live verification plan in the integration's declaration | `CONTEXT.md` | `contexts/code/be/transport.md` (outbound adapters) and `webhooks.md` | S |
| M-5 | Interface audit lenses: a symbol is a product claim, the installed grammar outranks a direction's pixels, an intentional departure needs an owner decision, real artwork versus code-native interface | `docs/interface-audit.md` | "Lenses and verdicts" of `contexts/ui/proof.md` | S |
| M-6 | Breadth of requirement and design reasoning: main, alternative, failure and edge cases, consequential unknowns recorded rather than omitted, a decided slice proceeds | `CONTEXT.md`, `docs/business-srs.md` | `contexts/project/work.md` | S |
| M-7 | Driver integration peers as data (a driver that needs its runtime peer, R111) | `knowledge/hfs/peer-integrations.yaml` | a `peers` map in `contexts/stack/pins.yaml`, read by the R111 check after section 3 repoints it | S |

Two MISSING items are not knowledge and do not go into `contexts/`:

- **M-8, the shared SonarQube stack.** `ext/sonar/compose.yaml` and `cloudflared.yaml` run the containers
  `starci-sonarqube`, `starci-sonarqube-postgres` and `starci-cloudflared-sonarqube` today, and five products declare
  `root: .claude/ext/sonar` in `.starcistacks/application-stacks.yaml` (section 4). They need a new home before the
  deletion: under `ops/` only with code that reads them (CONTRIB-9), or a small host-infrastructure repository. The
  owner chooses; the Compose project name stays the same so the running containers and their volumes are adopted, not
  recreated.
- **M-9, the `@starci/cli` source.** Apps pin `@starci/cli` 1.7.47 from npm, but no harness folder owns its source.
  Either it moves to `packages/cli` and joins section 3, or the harness CLI's `starci app` verbs take its job and the
  pin is removed from `contexts/stack/pins.yaml`, `contexts/code/shared/scripts.md` and the hfs templates. The owner
  chooses; until then the bundle of section 4 keeps the source.

## 3. Package TypeScript plan

### Where each package stands

Counts exclude `node_modules` and `dist`. "Own" is the package's code; "runtime copy" is its bundled `runtime/` tree of
legacy files; "data" is TypeScript that is input, never compiled (lint fixtures that must keep their violations, app
templates).

| Package | Own JS (files, lines) | Own TS (files, lines) | Runtime copy JS | Data TS | Builds TS to `dist` |
|---|---|---|---|---|---|
| `ai-router` | 1 (`eslint.config.mjs`) | 27, 4,101 | none | none | yes |
| `event-stream` | 0 | 15, 2,219 | none | none | yes |
| `test-world` | 1 (`eslint.config.mjs`) | 134, 17,783 | none | none | yes |
| `grammar` | 6 build and capture tools (5 `.mjs`, 1 `.cjs`) | 177, 18,630 | none | none | yes |
| `heroicons` | 1 spec | 2 `.tsx`, 282 | none | none | yes |
| `tsconfig` | 1 spec, 161 | 0 (JSON presets) | none | none | nothing to build |
| `prettier-config` | 1 `.cjs` + 1 spec | 1 `.d.cts` | none | none | no |
| `jest-preset` | 18 `.cjs` (1,367) + 5 specs (1,595) | 12 hand-written `.d.ts`, 405 | none | none | no |
| `stylelint-canon` | 51, 3,467 | 0 | none | none | no |
| `eslint-grammar-offset-pop` | 3, 106 | 1 `.d.ts` | 40, 3,788 | none | no |
| `eslint-grammar-core` | 35, 3,455 | 1 `.d.ts` | 52, 5,274 | none | no |
| `eslint-canon-fe` | 133, 20,829 | 0 | 175, 23,441 | 20 fixtures | no |
| `eslint-canon-be` | 222, 36,461 | 0 | 174, 23,427 | 160 fixtures | no |
| `hfs` | 319, about 43,300 (198 of them specs in `src/`) | 0 | 510, 82,781 | 427 templates (+330 `.tpl`) | no |

Five packages are already TypeScript with a build (`ai-router`, `event-stream`, `test-world`, `grammar`, `heroicons`)
and need only their leftover tooling files converted. Nine carry about 790 files and 110,000 lines of hand-written
JavaScript, specs included. The four lint packages and `hfs` also carry 951 files and 138,700 lines of runtime copies.

### What a conversion needs

- **tsconfig.** A `tsconfig.json` (typecheck, specs included) and a `tsconfig.build.json` (`rootDir: src`,
  `outDir: dist`, `declaration`, specs, fixtures and templates excluded) extending `@starci/tsconfig` `build.json`,
  strict, with `rewriteRelativeImportExtensions` so sources import `./x.ts` and `dist` imports `./x.js`; that replaces
  the regex pass in `ai-router`'s build script. `jest-preset` and `prettier-config` build CommonJS (`module: commonjs`),
  since jest and prettier load them with `require`; their hand-written `.d.ts` files are deleted, the build emits them.
- **Build script.** `build` cleans `dist` and runs `tsc -p tsconfig.build.json`, then copies the package's data (see
  below); `prepack` runs `typecheck`, `build` and `test`. `package.json` `main`, `exports` and `files` move to `dist`,
  keeping every public specifier (`@starci/eslint-canon-fe/lib/*`, `@starci/hfs/runtime/*`, `@starci/hfs/form-bounds`)
  so consumers change nothing.
- **Specs.** `*.spec.mjs` become `*.spec.ts` beside the source and run with `node --test` on the TypeScript (Node 24
  strips types), so a spec needs no build; coverage stays on the source. Specs that read a sibling package by relative
  source path (`../eslint-canon-fe/index.mjs`, `../grammar/src`) read the sibling's package name or built `dist`.
  CONTRIB-2 holds: every rule keeps its spec.
- **Data stays data.** Lint fixtures (`eslint-canon-be/fixtures`, `eslint-canon-fe/fixtures`), the app templates of
  `hfs/templates` (`.ts`, `.tsx`, `.tpl`, Dockerfiles, hooks), `stylelint-canon` `.css` fixtures and YAML are excluded
  from compilation and copied as they are. A file found through `import.meta.url` resolves from one `packageRoot()`
  helper per package, because `dist/` sits one level below the source.
- **CI.** `.github/workflows/ci.yml` builds every package before testing any, since siblings install each other as
  `file:` copies (`packages/README.md`), and the publish job publishes `dist`.

### One owner for the runtime copies

`packages/README.md` says today that a change to one runtime copy is made to every copy in the same commit. Those
copies hold harness knowledge a second, third, fourth and fifth time, in the legacy shapes:

| File | Copies | Owner it duplicates |
|---|---|---|
| `runtime/knowledge/hfs/canon-pins.yaml` | 5, identical (canon-be, canon-fe, grammar-core, offset-pop, hfs) | `contexts/stack/pins.yaml` |
| `runtime/knowledge/hfs/slots.yaml` | 5, identical | `contexts/hfs/slots.yaml` |
| `runtime/knowledge/grammars/index.yaml` | 4, identical (canon-be, canon-fe, grammar-core, hfs) | `contexts/grammars/contract.yaml` and the grammar ids `core`, `offset-pop` |
| `runtime/knowledge/hfs/rules.yaml` | 3, identical (canon-be, grammar-core, hfs) | `contexts/hfs/rules.yaml` |
| `runtime/knowledge/hfs/fe-stack.yaml` | 3 (canon-be, canon-fe, hfs) | `contexts/stack/fe.yaml` |
| `runtime/knowledge/hfs/design-truths.yaml` | 1 (hfs) | `policy/loosening.yaml` |
| `runtime/scripts/**`, `runtime/engine/**` | canon-be's 174 files are a subset of hfs's 510 with no differing file; canon-fe adds `lib/next-contract.mjs` | none in `contexts/`: legacy code |

The proposal: **`contexts/` owns the data and `packages/hfs` owns the code; every other copy is generated at build.**

1. The runtime code moves once into `packages/hfs/src/runtime/` as TypeScript, pruned to the import closure of the
   entry points the five packages actually call (`scripts/hfs/check.mjs`, `slots.mjs`, the architecture machine, the
   Sonar and line-count libraries). Legacy-runtime-only files in the copies (`engine/orca-config`, `model-config`,
   `release-config`, `modules/kernel/*.yaml`, `scripts/reconciler`, `scripts/machine`, `scripts/agent`) are deleted, not
   converted, when nothing in the closure imports them.
2. The readers of the knowledge copies are repointed to the `contexts/` schemas (`starci/stack-pins@1`, the ported
   `hfs/slots.yaml` and `rules.yaml`, `stack/fe.yaml`, `grammars/contract.yaml`); that is open-core C-12's follow-up.
   `hfs`'s build copies those files from `contexts/` into `dist/data/`, so the published package is self-contained and
   no product repository or harness path is read at run time.
3. Each lint package's build copies the compiled closure it imports from `../hfs/dist/runtime` and the data from
   `contexts/` into its own `dist/`. A lint package stays installable alone, and no copy is ever edited by hand: the
   `runtime/` folders leave git, and `packages/README.md` says the build generates them.

### Risks

- **Strict typing of untyped code** is most of the work: up to about 190,000 lines (own code plus the `hfs` runtime
  before pruning) of plain JavaScript gain types with no `any` (CONTRIB-11). ESLint rule modules type against `eslint`'s own `Rule.RuleModule`,
  already a peer, so no new dependency is needed.
- **Paths that move with `dist/`**: `import.meta.url` lookups, `import.meta.resolve("@starci/hfs/runtime/...")` from the
  lint packages, the `exports` maps and every `files` list. A missed one fails only in an installed copy, so each
  package proves itself with `npm pack` and an install into a scratch app (CONTRIB-1).
- **Behaviour drift in the repoint** of step 2: the contexts schemas are not the legacy shapes (slots lost `since` and
  `templateNa`, rules lost `gates` and `at`). Each repointed reader keeps its specs green on the same fixtures.
- **Versions**: specifiers stay, so a minor release per package suffices, with every `@starci` pin raised together in
  `contexts/stack/pins.yaml`; the grammar family (`grammar`, `eslint-grammar-core`, `eslint-grammar-offset-pop`) keeps
  one version.
- **Linting**: the canon packages have no ESLint of their own today. The conversion holds `tsc` strict; adding the
  harness's `strictTypeChecked` lint to them is a separate, later lane, not a loosening.

### Lanes

At most five Opus workers run at once, each on its own worktree and on files no other lane writes (CONTRIB-16). The
order follows the size: `hfs` is the critical path, so its runtime starts first.

| Wave | Lane | Files it owns | Work | Estimate |
|---|---|---|---|---|
| 0 | W0 build convention | `packages/tsconfig/`, `packages/README.md`, `.github/workflows/ci.yml` | a `package` preset in `@starci/tsconfig`, the build and spec convention above, CI builds before tests | S, 2 h |
| 1 | L1 hfs runtime | `packages/hfs/runtime/**` → `packages/hfs/src/runtime/**`, `packages/hfs/scripts/` | prune to the closure, convert, repoint readers to `contexts/`, emit `dist/data` and the closure for the lint packages | L, 2 days |
| 1 | L2 eslint-canon-be | `packages/eslint-canon-be/` except `runtime/` | 222 files to `src/**/*.ts`, 132 specs, fixtures stay data | L, 1.5 days |
| 1 | L3 eslint-canon-fe | `packages/eslint-canon-fe/` except `runtime/` | 133 files, 74 specs, fixtures stay data | M, 1 day |
| 1 | L4 hfs commands | `packages/hfs/{src,scaffold,sync,stack,db,emit,ci,release,codemod,lint,report,upgrade,coverage}/` | 319 files and 198 specs; imports of `../runtime/...` become `./runtime/...` mechanically at merge, since L1 keeps the relative tree | L, 2 days |
| 1 | L5 small packages | `stylelint-canon`, `eslint-grammar-core` and `eslint-grammar-offset-pop` (own code), `jest-preset`, `prettier-config`, the leftover tooling of `grammar`, `heroicons`, `ai-router`, `test-world` | convert, CommonJS builds for jest and prettier | M, 1 day |
| 2 | L6 lint packages consume the closure | the `runtime/` folders and build scripts of the four lint packages | delete the copies, generate them at build from `hfs` and `contexts/`, specs green | M, 0.5 day |
| 2 | L7 release | versions, CHANGELOGs, `contexts/stack/pins.yaml`, open-core C-12 and C-13 | minor releases, repins, open rows closed | S, 2 h |

Waves merge whole: every lane of a wave lands, then one scoped check runs on the merged tree and main is pushed; CI
runs the full package suite (CONTRIB-3, CONTRIB-18). Wave 1's wall time is about two days, the whole plan three to four.

## 4. Retirement checklist

Every line is true before the deletion step.

### In-flight operations

- `CLAUDE.md` and `AGENTS.md` of the backend allow the legacy runtime only to finish an operation it started, such as a
  production deploy. Production deploys run from the backend's own GitHub Actions on push, not from the legacy tree; the
  owner confirms no run is in progress (`gh run list` on the backend repository).
- The legacy host store (`.runtime/machine.sqlite`) holds no running job: of 59 supervisor jobs, 16 succeeded, 10 failed
  and 33 were cancelled, the last on 2026-10-07. Its two supervisor seats say `live` but were last seen on 2026-10-09
  and 2026-10-07, so they are stale.
- The legacy worktree `.claude/.claude/worktrees/s20-grammar-core` has no uncommitted change (`git status` in it is
  clean), since the deletion removes it with the tree.
- The `starci-next` ledger in the legacy store holds one `queued` workflow (2026-10-21). It is cancelled, or redefined
  with `workflow define` in this harness if still wanted; it is never resumed on the legacy runtime.
- The last deploy receipt under `.runtime/deploy/receipts` is from 2026-10-24.
- Two scheduled tasks run legacy code now, **StarCi Harness App** and **StarCi Harness Tunnel** (both `Running`, through
  `C:/Users/Hi/.starci/bin/starci.cmd` into `packages/cli/bin/starci.mjs`), with four `node` processes
  (`starci.mjs harness start [--tunnel]`, `scripts/cli/main.mjs harness start [--tunnel]`). They are ended and deleted,
  with the three disabled legacy tasks **StarCi-Reconciler**, **StarCi-Resume-Every10m** and
  **StarCi-Supervisor-Every30m** (`starci doctor` lists them as "legacy, disabled"). **StarciHfsKeeper** points at
  `D:/starci-tmp`, not at the legacy tree.
- The three SonarQube containers keep running; M-8 gives their Compose files a new home first.

### References from product repositories

Searched in the 91 git repositories under `D:/Repositories` (depth two): every `package.json` to depth three, `hfs.json`,
`.husky/**`, `.github/**`, `scripts/`, `.git/hooks`, `.git/config`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, plus the
`.starcistacks` declarations. No CI workflow and no `hfs.json` points into the legacy tree. Twelve repositories do:

| Repository | Reference | Action |
|---|---|---|
| `starci-academy-backend` | `package.json` scripts `workspace:bootstrap`, `checkpoint:data:{plan,status,push,pull,restore}`, `gate:canon` call `.claude/scripts/...` files that no longer exist | delete the seven scripts |
| `starci-academy-fe` | `@starci/heroicons: file:../starci-academy-backend/.claude/packages/heroicons`; scripts `heroicons:build`, `heroicons:verify` | pin `@starci/heroicons` at the `contexts/stack/pins.yaml` version from the registry; delete the two scripts |
| `starci-academy` | script `audit:fe`; two lines of `CLAUDE.md`; a comment in `.husky/pre-commit` | delete the script, reword the lines (the scripts named are already gone) |
| `mia-mia-backend`, `miamia-fe`, `nivo-backend`, `nivo-fe`, `starci-next`, `starci-next-fe` | `.husky/_/reference-transaction`, the legacy history guard (git-ignored, written by the legacy dispatcher), runs `scripts/guards/shim.mjs` | delete the generated hook; husky rewrites its own `_` folder |
| `mia-mia-backend`, `nivo-backend`, `nivo-monorepo`, `starci-monorepo`, `starci-next` | `.starcistacks/application-stacks.yaml` `services.sonar.stack.root: .claude/ext/sonar` | repoint to the M-8 home |
| `starci-runtime-overnight-20260915` | `.git/config` remote `url = D:/Repositories/starci-academy-backend/.claude` | repoint to the bundle, or archive the clone |

Outside the products: the ten shims of `C:/Users/Hi/.starci/bin` (`starci`, `starci.cmd`, `git.cmd`, `node.cmd`,
`npm.cmd`, `npx.cmd`, `gh.cmd`, `docker.cmd`, `schtasks.cmd`, `supabase.cmd`) and `C:/Users/Hi/.starci/runtime.json`
point at the legacy CLI; the folder is not on `PATH`. The shims are deleted, or `starci.cmd` repointed to
`starci-harness`. `C:/Users/Hi/.codex/config.toml` carries stale project entries for the legacy tree and its worktrees.

### Branches and unique work

The legacy repository has 4,011 local branches, 49 tags, 36 stash entries, two extra worktrees and 443 MiB of packs.
Its `main` equals the last-fetched `origin/main`. 2,218 branches are merged into `main`; **1,793 are not, and none of
those is on the remote** (1,753 commits exist on no remote branch):

| Prefix | Branches | Not merged | Newest tip |
|---|---|---|---|
| `preserved/` | 3,304 | 1,581 | 2026-10-08 |
| `lane/` | 242 | 150 | 2026-10-08 |
| `sup/` | 18 | 18 | 2026-10-01 |
| `starci183/` | 75 | 16 | 2026-10-19 |
| `fix/` | 88 | 6 | 2026-10-26 |
| `f4-*` | 4 | 4 | 2026-09-29 |
| `backup/`, `grammar/` | 3, 14 | 3, 3 | 2026-10-17, 2026-10-12 |
| `release/` | 14 | 2 | 2026-10-26 |
| eleven single-branch prefixes (`codex/`, `feat/`, `finish-*`, `prep/`, `preview/`, `s20-*`, `scratch/`, `smells3/`, `trial/`, `worktree-*`) | | 11 | 2026-10-27 |

Ten unmerged branches moved after 2026-10-20 and are the only ones worth a look before archiving: `feat/a30x-optable`,
`fix/a31-ex-full-it`, `fix/a31-ex-full-sonar`, `fix/a31-gate-fe-aggregate`, `fix/next-scaffold`,
`fix/next-scaffold-clean`, `fix/nivo-pagination-doc-codes`, `s20-grammar-core` (its worktree is still checked out;
the Grammar core move already landed here as S27 and S29), `scratch/a31-premerge`, `smells3/integration`. None is ported;
the harness is the standard and the bundle keeps them.

### Archive

**Recommended: one git bundle, kept outside every repository.** The `origin` push URL is disabled by design, a push of
4,011 branches to a new remote would publish legacy work and history that only needs keeping, and a bundle is one file
that `git clone` reads back. A bundle carries refs, not stash entries beyond the top one, so each stash entry first gets
an archive ref. Untracked legacy files the owner wants kept (`STARCI.md`, the `.runtime/` ledgers) go into a zip
beside it; secret files are the owner's own move.

```powershell
$L = "D:\Repositories\starci-academy-backend\.claude"
$A = "D:\Archive\starci-skills-legacy-2026-10-27"
New-Item -ItemType Directory -Force $A | Out-Null
$i = 0; git -C $L stash list --format=%H | ForEach-Object { git -C $L update-ref "refs/archive/stash/$i" $_; $i++ }
git -C $L bundle create "$A\starci-skills.bundle" --all
git -C $L bundle verify "$A\starci-skills.bundle"
Compress-Archive -Path "$L\STARCI.md", "$L\.runtime" -DestinationPath "$A\untracked.zip"
```

### Files that point at the legacy runtime

- `D:/Repositories/starci-academy-backend/CLAUDE.md` and `AGENTS.md`: the paragraph "The legacy runtime in this
  repository's `.claude/` (starci-skills) is retired for new work ..." is deleted; the bootstrap keeps only the harness.
- `D:/Repositories/starci-academy-backend/.gitignore`: lines 82 to 99 and 123 to 128 describe `.claude/` as the
  `starci-skills` checkout and its predecessors. The `.claude/` ignore stays (agents write worktrees there); the
  comments and the entries for trees that no longer exist (`.claude-v3/`, `.claude_legacy/`,
  `.claude-starci-ultimate/`, `.claude-vip/`, `.claude/docs/.migrate-tmp/`, `.claude/_canon_tmp/`) are removed.
- `D:/Repositories/starci-academy-backend/package.json`: the seven scripts of the table above.
- The user's memory (`C:/Users/Hi/.claude/projects/D--Repositories-starci-academy-backend/memory/`): 40 of 273 files
  name legacy paths (`.claude/scripts`, `.claude/knowledge`, `.claude/packages`, `.claude/modules`, `.claude/docs`,
  `.claude/skills`, `scripts/kernel`, `starci-skills`). The runtime-history notes (`starci-runtime-*`, `v8-skills-tree-state`,
  `starci-skills-suite`, `workspace-*`, `v2-skills-canon-migration`, `model-allocation-3tier`) become history or are
  deleted; the working rules that cite a legacy path (`feedback-analyze-and-approve-before-editing`,
  `feedback-canon-multisession-fetch-before-write`, `feedback-translate-sweep-check-en-sibling`,
  `screen-audit-skill-and-tier-rules`, `starci-content-fix-skill`, `starci-personal-project-fix-skill`,
  `audits-official-framework`, `course-domain-docs`, `devops-audit-task`, `robocopy-mir-follows-junctions` and the rest of
  the 40) are reworded to their harness owner from section 1; `MEMORY.md` lines that say ".claude is its own git repo,
  gitignored by the backend; canon gates run via `npm run gate:canon`", "FE canon and rules have one source of truth in
  backend `.claude`" and "Official audits use `.claude/docs/` runners" are rewritten, and the line "legacy .claude runtime
  only finishes in-flight deploys" is removed once the deletion is done.

### The deletion step (for the owner to approve)

When every line above holds (the in-flight checks green, the twelve repositories and the shims repointed, M-8 and M-9
decided, the bundle verified), the owner approves this, run from `D:/Repositories/starci-academy-backend`:

```powershell
schtasks /End /TN "StarCi Harness App"; schtasks /End /TN "StarCi Harness Tunnel"
"StarCi Harness App","StarCi Harness Tunnel","StarCi-Reconciler","StarCi-Resume-Every10m","StarCi-Supervisor-Every30m" | ForEach-Object { schtasks /Delete /TN $_ /F }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'starci-academy-backend\\\.claude' } | ForEach-Object { Stop-Process -Id $_.ProcessId }
Get-ChildItem .claude -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue | ForEach-Object { cmd /c rmdir "$($_.FullName)" }
cmd /c rmdir /s /q "D:\Repositories\starci-academy-backend\.claude"
```

Junctions are removed one by one before the tree, and `rmdir` never follows one, so nothing outside the folder is
touched (a recursive delete through a junction purges its target). Afterwards `D:/Repositories/starci-academy-backend/.claude`
does not exist, `git status` of the backend is unchanged (the folder was ignored), and this file is deleted.
