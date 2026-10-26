# Imports

Through which path a file imports and what it exports. The tier direction (who may import whom) and the side's own
entries (the back end's nested-index ban and export budget, the front end's hook and grammar boundaries) are each
side's topics.

## SHARED-IMPORTS-1 Across owners through the owner's entry; inside one owner, relative

A file imports another owner (a module, a feature, a workspace package) only through that owner's public entry: the
side's alias (`@modules/*`, `@features/*`, `@tests/*` on the back end; `@/` on a front-end app) resolving to the
owner's `index.ts`, or a package name and one of its declared exports. Inside one owner imports are relative and never
go through the owner's own entry. An entry re-exports named symbols only, never `export *`. The aliases are the
repository tsconfig's `paths` (SHARED-TYPING-1) and nothing else defines one.

Why: one public entry per owner is the only way to change internals without a repository-wide search.

```ts
import { InvoicesService } from "@modules/domain/invoices"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { normalizeAdjustment } from "./adjustment.policy"
```

Enforced by: R30 BE_PUBLIC_SURFACE (`import-owner-entry`, `no-folder-reexport`, `alias-reexport` on the back end;
`owner-export-bypass` on both).

## SHARED-IMPORTS-2 Type-only bindings use `import type`

A binding used only as a type is imported with `import type` (or `export type` when re-exported). Import order and
grouping are the author's; Prettier lays the lines out (SHARED-FORMAT-1).

Why: a type import disappears from the emitted code, so it can never create a runtime cycle or load a module for its
types alone.

```ts
import type { EntityManager } from "typeorm"
import type { AdjustmentRow } from "./persistence/adjustments.rows"
```

Enforced by: review only.

## SHARED-IMPORTS-3 Every export has a consumer; every import is used

An exported symbol has a production consumer (a test reference does not keep it alive), every source file is reached
from an entry, and no import binding goes unused. An export nothing uses is deleted, not kept for later.

Why: a symbol nothing uses is surface nobody maintains, and it hides the real public API among the dead.

Enforced by: R25 HFS_UNUSED_EXPORT (`dead-exports` in both canons), R235 SCAN_SMELL (`no-unused-import` in both
canons), the compiler's `noUnusedLocals`.
