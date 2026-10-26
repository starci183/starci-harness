---
slots: []
---
# Imports

Decides through which path a back-end file imports and what it exports. The direction between tiers is architecture.md
(BE-ARCHITECTURE-1); what a door may import is BE-TRANSPORT-2; import layout is Prettier's.

## BE-IMPORTS-1 Cross-owner imports resolve to the owner's index
Across owners use the back end's aliases (the managed `be/tsconfig.json` `paths`: `@modules/*`, `@features/*`, `@tests/*`) or a
workspace package export, always resolving to the target owner's `index.ts`. Inside one owner use relative imports, never the
owner's own `index.ts`. No deep import into another owner, no `export *`, no nested `index.ts`. An `index.ts` holds only named
`export { }` and `export type { }` lines within its slot's `budget.indexExports`. Every exported symbol, enum member, queue
constant, error code and catalog key has a production consumer; a test reference or an error's kind or message mapping does not
keep it alive, and a namespace import consumes only the members it reads.

Why: one public entry per owner is the only way to change internals without a repository-wide search, and a symbol nothing uses
is surface nobody maintains.

Enforced by: R30 BE_PUBLIC_SURFACE, R25 HFS_UNUSED_EXPORT, R280 HFS_UNUSED_SYMBOL.

## BE-IMPORTS-2 Layout and order are Prettier's and the author's
Prettier (`@starci/prettier-config`) lays out import declarations; ESLint carries no formatting rule and order is not enforced.
Type-only bindings use `import type`.

Why: a formatter that decides layout removes a whole class of review noise; order carries no dependency meaning a check could
judge.

Enforced by: R19 HFS_FORMAT.

## BE-IMPORTS-6 Exports are named
Source exports are named; the only default exports are the Jest `global-setup.ts` and `global-teardown.ts` of the test world. The
environment is read only by its owners (BE-CONFIG-1), raw libraries only by theirs (BE-INFRA-1), and logging goes through the
Logger port (BE-LOGGING-1).

Why: a named export is greppable and renamed in one place.

Enforced by: R89 BE_SOURCE_FORM.

## BE-IMPORTS-7 Jest sees the same aliases
The jest preset mirrors the tsconfig aliases in `moduleNameMapper`, and specs import through them; a spec never `jest.mock`s a
module path.

Why: a spec must resolve the same module the compiler resolves.

Enforced by: R47 BE_TEST_TOPOLOGY.
