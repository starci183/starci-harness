# @starci/eslint-canon-fe

Universal front-end laws for TypeScript and Next.js applications, classified by
[FE-RULE-OWNERSHIP](../../../knowledge/patterns/fe/index.yaml#FE-RULE-OWNERSHIP).
The canon owns composition, data and effect boundaries, translations, accessibility, source
structure, typed contracts, token discipline and check integrity across Grammar families.

```js
import { loadHfs, starciFeConfig } from "@starci/eslint-canon-fe"
import { starciGrammarConfig } from "@starci/eslint-grammar-starci"

const hfs = loadHfs(import.meta.url)
export default [...starciFeConfig({ hfs }), ...starciGrammarConfig({ hfs })]
```

`starci app sync` renders the selected family's managed flat config. Both factories cover every
app and workspace package's source. Universal rules, React Hooks rules, type-aware rules and
Sonar rules run at error; the factory sets typed parsing and refuses inline lint directives.
Generated wire types, dependencies and build outputs follow the shared source-scope contract.

Concrete Grammar component names, props, variants, scales and vendor recipes belong to
`@starci/eslint-grammar-starci` or the selected family's package. The family rules keep their
bare IDs under the `starci-grammar` namespace. This package exports shared AST, binding, type,
slot and configuration infrastructure through `@starci/eslint-canon-fe/lib/*`; family packages
import those readers without copying them.

Every universal law remains gathered by `index.mjs`; its recommendation enables every rule.
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

Regression specs belong to this package. Application front ends and Grammar libraries have no specs.
