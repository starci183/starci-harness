# @starci/eslint-grammar-core

Concrete StarCi Grammar component, prop, variant and token contracts belong here under
[FE-RULE-OWNERSHIP](../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
The package version follows `@starci/grammar`; universal FE laws remain in `@starci/eslint-canon-fe`.

```js
import { loadHfs, starciFeConfig } from "@starci/eslint-canon-fe"
import { coreGrammarConfig } from "@starci/eslint-grammar-core"

const hfs = loadHfs(import.meta.url)
export default [...starciFeConfig({ hfs }), ...coreGrammarConfig({ hfs })]
```

Every rule uses the `starci-grammar` namespace and runs at error. The factory checks the selected
Grammar and covers the same source files as the universal factory. Shared AST, type, slot and
binding readers are imported from the universal package's explicit infrastructure exports.
Family helpers and the generated runtime closure belong to this package.

The rule IDs remain stable when their namespace moves. Laws cover the fixed app shell and navbar,
Grammar-owned structural elements, glyphs and icon sizes, destructive menu entries, status inks,
chip labels that start uppercase, a Button that leads somewhere ending with `endArrow` (no typed or icon arrow), row type sizes in a DataTable cell or ListRow, one size per Cluster line, a row title that is plain text when the row opens (`button-arrow`, `table-cell-type`, `same-line-size`, `row-title-link`), generated art rendered through `Mascot` or `MediaFrame` with every `Mascot` naming its asset slot, the page head composed by `PageHeader`, the pane grid (a `PaneGrid` of `Pane`s, a `Pane` of `PaneSection`s that carry no padding of their own, mounted as `Page chrome="panes"`), the route page as one `Page` with its tabs in the header, heading and token scales, vendor ownership and slot-status composition, and a surface nested in another surface left subordinate (no forced `depth="top"`), and a Freestyle region that names its reason (its raw elements are exempt from the paint and raw-element laws). The pill (`Tabs appearance="primary"`) is only the `switch` header zone of a card, and a page stacks two underline `Tabs` layers at most (`tabs-switch-zone`, `tabs-depth`; `docs/tabs.md`). Each rule's metadata cites
its behavioral knowledge source and the governing ownership test. The R318 surface composition
rules (nested control variants, panel-list alignment, layout-only CSS) stay in the universal canon.
The proximity and composition laws of 2026-11-09 each have a doc: `gap-proximity` (a layout element stands at least one gap step closer than its layout parent), `field-label` (a control is labelled by its own `label` prop), `surface-in-surface` (a hand-made divided row list in a surface is `Section kind="list"`) `single-child-card` (a table, list or chart alone is the surface, not a card's only content) and `page-breadcrumbs` (a console `Page` header states `breadcrumbs`, or `"root"`).

## Migrating from @starci/eslint-canon-fe 8.x

The pinned canon-fe release moved twenty rules here. Their IDs, finding codes and error severity are unchanged;
only the namespace changes from `starci-fe/` to `starci-grammar/`: `app-shell-frame`,
`no-shell-bottom-tabs`, `navbar-control-size`, `navbar-cluster`, `no-navbar-create`,
`no-raw-structural-element`,
`status-text-uses-soft-foreground`, `vendor-primitive-has-named-owner`,
`no-vendor-icon-outside-icon-leaf`, `heroicons-is-the-glyph-vendor`,
`no-icon-size-class`, `destructive-menu-entry-needs-danger-tone`,
`no-inline-svg-outside-brand-mark-leaf`, `no-fractional-step`,
`no-unresolved-token-class`, `slot-status-through-slotview`, and the text laws `text-inline-only` (R357),
`no-text-heading` (R358) and `one-highlight-per-render` (R359).

1. Set `sides.fe.grammar` to `core` in `hfs.json`; no family is inferred.
2. Install this package at its canon-pins version beside `@starci/eslint-canon-fe` 9 in the app
   root `devDependencies`. `starci app check` refuses canon-fe 9 without it
   (`FE_STACK_FAMILY_LINT_MISSING`), so the rules cannot be lost silently.
3. Compose the universal factory first and this one second, with the same HFS view (the block
   above). `starci app sync` renders that managed `fe/eslint.config.mjs`.
4. Rename references to the moved rules from `starci-fe/` to `starci-grammar/`.

Consuming apps migrate in their own release.

Offset Pop inherits the Common component contract through `@starci/eslint-grammar-offset-pop`.
Its own adapter selects that family and reuses these implementations.

Regression checks live in this ESLint package. The Grammar and consuming app front ends carry no specs.

The source is TypeScript in `src/` (`src/lib/` holds the shared readers, `src/vendor.d.ts` types the untyped canon and runtime
JavaScript it imports); `npm run build` emits `dist/`, which is what the package ships beside `runtime/` and `docs/`.
