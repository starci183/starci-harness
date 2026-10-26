---
slots: []
---
# Folder

Decides which directory a piece of back-end code lives in. The machine form is the `be.*` slots of `hfs/slots.yaml`; the shape
inside a kind folder is that kind's topic, errors are error.md, persistence is persistence.md and tests are test.md.

## BE-FOLDER-1 Responsibility roots
The back end is a `be/apps/<app>/` monorepo even with one app; apps own process composition only. `be/src/features/<kind>/` owns
what triggers the application, one root per trigger kind (BE-FOLDER-2). `be/src/modules/<tier>/<capability>` owns reusable
capabilities: `domain` for business rules, `platform` for technical runtime, `integrations` for a third-party provider or
protocol, plus the opt-in pattern tiers of `tiers.be`. `be/src/tests/` holds non-unit tests and shared test data. Nothing else
sits at `be/src/`, and no teaching, mock or sandbox code lives under it. No folder named `types`, `constants`, `utils`, `helpers`,
`shared`, `common`, `testing` or `exceptions` exists under modules or features: types go in `<name>.contracts.ts`, constants in
the file that owns them, an ownerless helper in the platform capability that uses it. A feature stays within the file budget
`ruleParams.common.featureFiles`; a larger one splits by product capability. A module may have one consumer.

Why: ownership decides placement, not topology or consumer count; a closed tier set keeps every capability under the same
dependency rules, and catch-all folders hide mixed ownership.

Enforced by: R01 HFS_SLOT_UNDECLARED, R02 HFS_SLOT_REQUIRED_MISSING, R145 HFS_MONO_NEST_PROJECTS, R292 HFS_FEATURE_FILE_BUDGET.

## BE-FOLDER-2 Features are grouped by trigger kind
`be/src/features/` holds one folder per trigger kind and nothing else: `api/<feature>/` (api.md), `cli/` (cli.md) and one root per
further kind of `triggerKinds` (webhooks, realtime, saga, reactors, jobs), each enabled by declaring its pattern in `hfs.json`
`sides.be.patterns`. A feature root holds exactly what its kind's slot `requires`/`allows`: its entries, `application/` (the CQRS
files, no protocol-named folder) and one `transport/<protocol>/` per protocol with exactly one `<feature>-<protocol>.module.ts`.
A socket gateway or subscription is the realtime kind and a provider webhook the webhooks kind. A non-door feature role (policy,
guard, client, filter, interceptor, projection, contracts) declares only data, types and DTO metadata; renaming a suffix never
grants a place for business logic, which belongs in a tested module capability.

Why: the trigger decides which app composes the code, so grouping by trigger keeps each app's composition one folder and makes a
cross-kind import visible from the path alone.

Enforced by: R29 BE_FEATURE_SHAPE, R179 BE_KIND_DECLARATION, R180 BE_KIND_EMPTY, R264 HFS_FEATURE_LOGIC_ROLE.

## BE-FOLDER-4 Capability shape follows owned behaviour
A domain, platform or integration capability has exactly one `index.ts` at its root and only the parts it owns, within its slot's
closed `requires`/`allows`: a module and module definition when it registers providers, config and options when configured, and
`errors/`, `messages/` and `persistence/` in their sub-slots. Same-owner imports are relative and never go through the owner's
own `index.ts`; no nested `index.ts` and no empty conventional folder exist. `platform/primitives` holds ownerless pure helpers
(Outcome, time arithmetic, hashing, ids); a helper with an owner sits beside it.

Why: one public entry per owner is the only way to change internals without a repository-wide search.

Enforced by: R30 BE_PUBLIC_SURFACE, R01 HFS_SLOT_UNDECLARED.
