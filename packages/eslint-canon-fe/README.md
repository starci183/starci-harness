# @starci/eslint-canon-fe

Universal front-end laws for TypeScript and Next.js applications, classified by
FE-RULE-OWNERSHIP (the StarCi runtime's `contexts/code/fe/index.yaml`).
The canon owns composition, data and effect boundaries, translations, accessibility, source
structure, typed contracts, token discipline and check integrity across Grammar families.

```js
import { loadHfs, starciFeConfig } from "@starci/eslint-canon-fe"
import { coreGrammarConfig } from "@starci/eslint-grammar-core"

const hfs = loadHfs(import.meta.url)
export default [...starciFeConfig({ hfs }), ...coreGrammarConfig({ hfs })]
```

`starci app sync` renders the selected family's managed flat config. Both factories cover every
app and workspace package's source. Universal rules, React Hooks rules, type-aware rules and
Sonar rules run at error; the factory sets typed parsing and refuses inline lint directives.
Generated wire types, dependencies and build outputs follow the shared source-scope contract.

Concrete Grammar component names, props, variants, scales and vendor recipes belong to
`@starci/eslint-grammar-core` or the selected family's package. The family rules keep their
bare IDs under the `starci-grammar` namespace. This package exports shared AST, binding, type,
slot and configuration infrastructure through `@starci/eslint-canon-fe/lib/*`; family packages
import those readers without copying them.

Every universal law remains gathered by `src/index.ts`; its recommendation enables every rule.
The package is TypeScript: `src/**/*.ts` builds to `dist/` (`npm run build`), the published entry and
the `lib/*` readers are the built files, `npm run typecheck` holds the source and specs strict, and
`npm test` runs the specs on the source. The bundled `runtime/` is read through the package import
`#runtime/*`.
The `docs/` directory carries the detailed behavior of the documented laws. `why` supplies
failure codes and English guidance for the catalogued rules.

`starciPlainSourceConfig({ root })` applies slot-free universal rules to a TypeScript `src/`
tree. `starciTypedSourceConfig({ root })` provides the shared typed, React Hooks and Sonar
configuration for source that has not adopted the product composition laws.

The [surface composition law](docs/surface-rules.md) (R318) holds ANATOMY-2 and PADDING-0 for every
family that publishes the shared HeroUI surface and field API: `no-app-surface-paint` keeps surface paint in Grammar (`FE_GRAMMAR_LAYOUT_ONLY`) and
`no-list-panel-padding` refuses horizontal padding wrappers around Grammar lists and section captions
within the nearest painted surface, a `Pane` or a `PaneSection` included (`FE_LIST_PANEL_PADDING`),
`no-hand-built-panes` refuses a multi-pane frame drawn by hand, a vertical divider as a column seam or
columns inside a joined card, where `PaneGrid` owns both (`FE_HAND_BUILT_PANES`), and
`no-heading-above-card` refuses a `Section` around a single card (`FE_HEADING_ABOVE_CARD`), `no-selectable-tag-group` refuses a selection on a `TagGroup` (`FE_TAG_GROUP_SELECTION`), `no-fill-command-in-header` refuses a `width="fill"` Button in a page or card header slot (`FE_COMMAND_FILLS_HEADER`), and `no-table-in-card` refuses a `DataTable` inside a `SurfaceCard`, where a `SurfaceListCard` with its note in `footer` holds plain rows (`FE_TABLE_IN_CARD`). The R65 budget law's
`no-app-relative-clock` leaves live relative time and countdowns to Grammar's shared clock.

The spacing law (R350) leaves every distance to Grammar: `no-spacing-utility` refuses a padding, margin, gap
or space utility (`p-*`, `px-*`, `m*-*`, `gap-*`, `space-*`, arbitrary values and variants included) in an app class
string, where a role prop names the relation instead (`Stack`/`Cluster` `gap`, `Grid` `kind`, `PaneSection`, `Page`;
`FE_SPACING_UTILITY`). It runs in the counting cohort (`COUNTING` of `src/lib/config.ts`): `starci app lint` reports
and counts every finding at warn and fails on none, while `starci app codemod spacing-roles` migrates the app.

The [button intent law](docs/button-intent.md) (CTA-6) requires every app Button and IconButton to
declare intent and leave variants to Grammar. It contains destructive confirms in their same-file
dialog, counts mutually exclusive render paths separately and reserves commit for the view's
decision rather than repeated collection items.

The R92 `tier-children` and `base-props-atom` checks share the existing R325 one-level RootPage proof: a mounted
page or segment layout composes one connected root, that root renders its own Base, and the Base owns the selected
canonical page renderer. Only those exact input members may take `children`; ordinary blocks, relays, fake or unused
renderers and shape records containing rendered trees remain refused. The selected canonical Grammar catalog owns
semantic renderer bindings; universal code carries no concrete renderer spelling.

Regression specs belong to this package. Application front ends and Grammar libraries have no specs.

## The runtime copy

`runtime/` holds the StarCi runtime files the rules import (the slot manifest and view, the project graph and the
architecture machine it runs, the Sonar syntax rules), byte for byte at their runtime paths. It is committed source of
this package, edited in place ([packages/README.md](../README.md) says how the bundled copies move together).
