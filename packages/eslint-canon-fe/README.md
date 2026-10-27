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
family that publishes the shared HeroUI surface and field API: `nested-control-variant` refuses static
variants on layer-aware fields and primary Tabs inside painted Grammar surfaces (`FE_NESTED_VARIANT`),
`no-app-surface-paint` keeps surface paint in Grammar (`FE_GRAMMAR_LAYOUT_ONLY`) and
`no-list-panel-padding` refuses horizontal padding wrappers around Grammar lists and section captions
within the nearest painted surface (`FE_LIST_PANEL_PADDING`). The R65 budget law's
`no-app-relative-clock` leaves live relative time and countdowns to Grammar's shared clock.

The [button intent law](docs/button-intent.md) (CTA-6) requires every app Button and IconButton to
declare intent and leave variants to Grammar. It contains destructive confirms in their same-file
dialog, counts mutually exclusive render paths separately and reserves commit for the view's
decision rather than repeated collection items.

Regression specs belong to this package. Application front ends and Grammar libraries have no specs.

## The runtime copy

`runtime/` holds the StarCi runtime files the rules import (the slot manifest and view, the project graph and the
architecture machine it runs, the Sonar syntax rules), byte for byte at their runtime paths. It is committed source of
this package, edited in place ([packages/README.md](../README.md) says how the bundled copies move together).
