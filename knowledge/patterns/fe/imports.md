---
slots: []
---
# Imports

What a front-end file may import, through which path. The direction itself is [architecture.md](architecture.md)
FE-ARCHITECTURE-2; import layout and order are Prettier's and carry no rule.

## FE-IMPORTS-1 Paths

Same-unit imports are relative (`./component`, `./classNames`). Cross-folder imports in one source root use the app
alias (`@/`) and enter the owner's public entry. Cross-package imports use the package name and a declared export,
never a path into another package's `src`. Grammar objects come from the selected grammar's published entry, never
the package root. Type-only imports use `import type`.

Why: aliases are source-root conveniences; package exports are ownership contracts.

Enforced by: R30.

## FE-IMPORTS-3 Data enters through hooks

Only `hooks/swr` imports `modules/api` operations; other hooks compose those hooks; features and connected blocks
import hooks through the hooks public entry; presentation never imports transport, at runtime or as a wire type.
Lower tiers may call an intrinsic `hooks/ui` hook whose resolved implementation touches no product, session or API
lifecycle.

Why: one hook location makes data ownership auditable.

Enforced by: R56, R285.

## FE-IMPORTS-5 Vendor boundaries

An app imports no vendor UI component (`@heroui/*`, `react-aria-components`): every visual element comes from the
grammar. Only the app's `components/leaves/Icon` imports the glyph set ([ui.md](ui.md) FE-ICON). Headings, form
controls, images and structural elements the grammar renders are never raw HTML.

Why: a vendor import in an app is a second visual owner and the start of a local fork.

Enforced by: R62 FE_NATIVE_FORM_CONTROL, R93 FE_VENDOR_BOUNDARY.

## FE-IMPORTS-6 Explicit re-exports

Feature, module and package entries re-export named symbols only, never `export *`; an export with no consumer is
deleted.

Enforced by: R25, R30.

## FE-IMPORTS-7 Forbidden

No bypass of another owner's public entry; no default export from a reusable component; no inline lint or type
suppression; no import from two grammars or a second grammar stylesheet under one root; no app-local clone of a
grammar renderer or shell geometry (a unit named `*Layout`, `*Shell`, `*TopBar`, `*Nav`, `*Sidebar`, `*Rail` composes
the grammar shell and writes layout classes only inside the regions it is handed); no product name or business logic
in a grammar export.

Why: these bans protect mockability, lint integrity and the grammar boundary.

Enforced by: R18 HFS_INLINE_SUPPRESSION, R30, R62, R313 FE_APP_SHELL_FRAME.
