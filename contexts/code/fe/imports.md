---
slots: []
---
# Imports

What a front-end file may import beyond the shared law. Owner entries, the `@/` alias, `import type`, named re-exports
and dead exports are [shared imports](../shared/imports.md) SHARED-IMPORTS-1..3; the tier direction is
[architecture.md](architecture.md) FE-ARCHITECTURE-2.

## FE-IMPORTS-1 The grammar comes from its published entry, imported where it renders

Grammar components are imported from the selected grammar's published entry (`@starci/grammar/common`) in the file
that renders them, never from the package root or an internal path, and an app never re-exports a grammar export
under its own name.

Why: the entry is the grammar's contract; a shim makes one app green while the defect it hides stays in the grammar
for every other app, so a grammar defect is reported to the grammar (SHARED-LOOSENING-2).

Enforced by: R93 (`grammar-entry`; machine `grammar`), R321 (`no-grammar-shim`).

## FE-IMPORTS-2 Data enters through hooks

Only the `hooks/swr` wrappers import `modules/api` operations and `swr`; domain hooks compose those wrappers; blocks
and features import hooks through the hooks entries; presentation never imports transport, at runtime or as a wire
type.

Why: one place per read makes cache identity and data ownership auditable.

Enforced by: R285 (`operations-only-in-swr-hooks`, `swr-only-in-family`), R50 (`fetch-only-in-api-client`,
`transport-owner`), R56 (`hook-location`).

## FE-IMPORTS-3 Vendor packages have one named owner each

`@heroui/react` is imported for `cn` in a `classNames.ts`, and for the runtime providers (`I18nProvider`, the toast
region) in `app/[locale]/providers.tsx` and `modules/toast` only (the router reaches the grammar through the grammar
root, FE-I18N-4); glyph sets only in
`components/leaves/Icon` ([ui.md](ui.md) FE-ICON); `@supabase/*` only in `modules/auth`; `@apollo/client` only in
`modules/api`; `axios` only in `modules/api/rest`.

Why: a vendor import anywhere else is a second owner of what the grammar or the module already owns, and the start of
a local fork.

Enforced by: R93 (`vendor-primitive-has-named-owner`, `no-vendor-icon-outside-icon-leaf`), R244 (`fe-stack-import`),
R50 (`fetch-only-in-api-client`); the provider-file allowance is review only.
