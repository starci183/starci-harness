---
slots: []
---
# Folder

Which directory back-end code lives in. The machine form is the `be.*` slots of `hfs/slots.yaml`; the shape inside a
kind folder is that kind's topic.

## BE-FOLDER-1 Four responsibility roots

`be/apps/<app>/` composes processes (a monorepo even with one app). `be/src/features/<kind>/` holds what triggers the
application, one root per trigger kind. `be/src/modules/<tier>/<capability>/` holds capabilities: `domain` (business
rules), `platform` (technical runtime), `integrations` (one provider each) and the opt-in pattern tiers (`queues`; in
full `events`, `projections`). `be/src/tests/` holds non-unit tests and shared test data. Nothing else sits under
`be/src`, and no folder is named `types`, `constants`, `utils`, `helpers`, `shared`, `common` or `exceptions`: a type
goes in `<name>.contracts.ts`, a constant beside its owner, an ownerless pure helper in `platform/primitives`. A feature
stays within `ruleParams.common.featureFiles`.

Why: ownership decides placement, and a catch-all folder hides mixed ownership.

Enforced by: hfs and `slot-undeclared` (R01), R02, R145, R292.

## BE-FOLDER-2 Features are grouped by trigger kind

`be/src/features/` holds one folder per kind the app declares in `hfs.json` `sides.be.kinds`: `api/<feature>/`,
`cli/`, `jobs/<job>/`, `webhooks/<provider>/`, `realtime/<channel>/`. A feature holds exactly what its kind's slot
allows: its module files, `application/` (CQRS only) and one `transport/<protocol>/` per protocol with one
`<feature>-<protocol>.module.ts`. A feature file declares no business logic under any suffix: that belongs in a tested
capability.

Why: the trigger decides which app composes the code, so a cross-kind import is visible from the path alone.

Enforced by: `feature-layout` (R29), R179, R180, `feature-logic-role` (R264).

## BE-FOLDER-4 A capability holds only what it owns, behind one index

A capability has one `index.ts` at its root and only the parts it owns: module files when it registers providers,
`<c>.config.ts` and `<c>.options.ts` when configured, `<c>.decorators.ts` for its injectors, ports
(`<c>.port.ts`), services, policies, mappers, clients, and the sub-folders `errors/`, `messages/` and `persistence/`.
No nested `index.ts`, no empty folder; the index exports named symbols within the slot's `budget.indexExports`.

Why: one public entry per owner is the only way to change internals without a repository-wide search.

Enforced by: `no-folder-reexport`, `import-owner-entry` (R30), `slot-undeclared` (R01).
