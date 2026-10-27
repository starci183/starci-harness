# @starci/eslint-grammar-offset-pop

Offset Pop composes the Common renderers and types. This package inherits their checks from the exact matching `@starci/eslint-grammar-core` release; the rule implementations and shared infrastructure have one owner. Offset Pop has no additional component API rules yet. Its visual choices belong to its DNA and packaged stylesheet.

Rule ownership follows `FE-RULE-OWNERSHIP` in `contexts/code/fe/README.md` of the StarCi harness. The family's inheritance is declared in `contexts/grammars/offset-pop.md`; the app-shell law is `contexts/ui/composition.md`.

The managed `fe/eslint.config.mjs` consumes the universal canon and the selected family:

```js
import { loadHfs, starciFeConfig } from "@starci/eslint-canon-fe"
import { offsetPopGrammarConfig } from "@starci/eslint-grammar-offset-pop"

const hfs = loadHfs(import.meta.url)
export default [...starciFeConfig({ hfs }), ...offsetPopGrammarConfig({ hfs })]
```

The inherited rule IDs use the `starci-grammar` prefix. `rules`, `recommended`, `ruleOwners`, `lawOwners`, `ruleDeclarations`, `why` and the default plugin expose the same authoritative objects as the matching Common contract. The package has its own canon pin and generated runtime copy and follows the Grammar version.

## Migrating from @starci/eslint-canon-fe 8.x

The pinned canon-fe release moved the twenty Grammar component rules (listed in the `@starci/eslint-grammar-core`
README and the pinned canon-fe changelog) out of the universal canon. An Offset Pop app receives them
through this package under the `starci-grammar/` namespace with unchanged IDs, codes and severity.

1. Set `sides.fe.grammar` to `offset-pop` in `hfs.json`; no family is inferred.
2. Install this package at its canon-pins version beside `@starci/eslint-canon-fe` 9 in the app
   root `devDependencies`; it brings the matching `@starci/eslint-grammar-core`. `starci app check`
   refuses canon-fe 9 without it (`FE_STACK_FAMILY_LINT_MISSING`).
3. Compose `starciFeConfig({ hfs })` first and `offsetPopGrammarConfig({ hfs })` second (the block
   above); `starci app sync` renders that managed `fe/eslint.config.mjs`.
4. Rename references to the moved rules from `starci-fe/` to `starci-grammar/`.

Consuming apps migrate in their own release.

`npm test` runs package regression specs. Grammar and application front ends carry no specs.

The source is TypeScript in `src/`; `npm run build` emits `dist/`, which the package ships beside `runtime/`. The spec resolves `@starci/eslint-grammar-core` through its built `dist/`, so build that package first (`npm run build` in `packages/eslint-grammar-core`), then `npm install` here.
