---
slots: []
---
# Imports

The back-end specifics of imports. Owner entries and aliases, `import type`, used exports and imports are shared:
[SHARED-IMPORTS-1 … 3](../shared/imports.md); named exports [SHARED-NAMING-2](../shared/naming.md); layout
[SHARED-FORMAT-1](../shared/format.md). The tier direction is BE-ARCHITECTURE-1.

## BE-IMPORTS-1 One flat index per owner, within its budget, consumed in production

An owner (capability, feature, queue) has exactly one `index.ts`, at its root: no nested index. It holds only named
`export { }` and `export type { }` lines, within its slot's `budget.indexExports`, and a feature's index exports only
its transport modules (the app composes nothing else). The budget is per owner, and so is the cure: an owner whose surface
outgrows it is split, never widened or squeezed. A REST door adds one name to its feature's index (its HTTP module), so the
pressure of many operations lands on the domain module whose services and contracts they import: that module is split by
bounded context (one domain module per aggregate or noun the operations act on, each with its own index of its services and
contract types), never kept whole by merging contract types, moving them to a wider owner or raising the budget. A namespace
import consumes only the members it reads; an error code, queue constant or catalog key kept alive only by a test or by
its own kind table is dead.

Why: a nested or oversized index is a second public surface nobody reviews, a module wide enough to fill it is several
contexts behind one door, and a symbol only tests use is surface nobody maintains.

Enforced by: `no-folder-reexport`, `no-self-module-alias`, `no-relative-capability-escape`, `owner-export-bypass`
(R30), `dead-exports` (R25), R280.

## BE-IMPORTS-7 Jest resolves the same aliases

The jest preset maps `@features/*`, `@modules/*` and `@tests/*` exactly as `be/tsconfig.json` declares them, and specs
import through them; a spec never `jest.mock`s a module path.

Why: a spec must load the module the compiler resolves.

Enforced by: `spec-no-module-mock` (R48); the mapping is the managed `jest.config.js` (R05).
