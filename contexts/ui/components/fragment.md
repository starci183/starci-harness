# Fragment

Contract: [Fragment](../../grammars/contract.md#fragment). Vendor: none (a Common region).

## Job
Give the app and its fans one sanctioned place where anything goes: any markup, any class name and any library (a graph
editor, an animation library, a chart toolkit) when no grammar component fits. The Grammar draws nothing inside it and its
lint reports nothing inside it. It is a last resort: the rest of the page stays on the grammar, and every use is listed for audit.

`Fragment` renders NO wrapper element, only its children, like React's `Fragment`: there is no `as`, no `className` and no
DOM stamp. `reason` is required and serves the lint and the inventory. [Freestyle](freestyle.md) is the narrow hatch
(a block of own plain elements and CSS, with the Grammar's components still judged inside it); a region that needs a library, or a
Grammar component drawn off-contract, is `Fragment`.

## Choose

Choice `fragment.choose.region`: whether a region is written by hand.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| grammar | a grammar component or composition expresses the region | that component, never `Fragment` | judgement |
| freestyle | the region needs only the app's own plain elements and CSS | `Freestyle` | judgement; lint `starci-grammar/freestyle-has-reason` |
| fragment | the region needs a library the Grammar does not ship (a graph editor such as `@xyflow/react`, an animation library such as `motion`), or markup and classes no other hatch allows | `Fragment` with a `reason` that names why nothing fits, around that region only | judgement; lint `starci-grammar/fragment-has-reason` |

Wrap the one region, not the page. Graph drawings (workflow editors, schema maps, bubble maps) are app code: the Grammar ships
no graph component, so the app writes it with its own library inside `Fragment`.

## Variants
None. The only props are `reason` (required string) and `children`.

## Size and states
None: it renders no element of its own, so it has no size, paint, inset, radius or state.

## Name clash with React's Fragment
A file that needs React's `Fragment` as well imports the Grammar's one under an alias:

```tsx
import { Fragment } from "react"
import { Fragment as GrammarFragment } from "@starci/grammar"
```

The lint follows the local alias. A region is recognised only when the element is the `Fragment` export of `@starci/grammar`
(`Fragment`, an alias such as `GrammarFragment`, or `<G.Fragment>` of a Grammar namespace import). React's `Fragment` and `<>`
open no region, and neither does an app component that is merely named `Fragment`.

## Owner split
- **Grammar owns:** the component itself: children in, children out, the required `reason`. Nothing else.
- **Knowledge decides:** grammar vs freestyle vs fragment (the table above); that it is a last resort.
- **App author decides:** the region, its markup, CSS and libraries, and the reason in a few words.

## What lint does inside and outside
- **Inside the subtree of a `Fragment`** (its `reason` attribute and everything it renders) no Grammar rule and no canon front-end
  rule that judges markup, look or libraries reports anything: `eslint-grammar-core` and `eslint-grammar-offset-pop` rules, and the canon
  `starci-fe` laws of the look (`class-names`, `tokens`, `spacing`, `type-scale`, `surface-rules`, `native-controls`, `fe-stack`, ...).
- **Imports.** An import whose every use is inside a `Fragment` is not judged (`import { ReactFlow } from "@xyflow/react"`, a HeroUI
  primitive, a library the fe-stack forbids). A same-file component that is not exported and that only a `Fragment` renders (a plain function, an arrow or a `memo` / `forwardRef` wrapper) counts as inside,
  so a canvas written as `const Canvas = () => ...` and rendered as `<GrammarFragment reason="..."><Canvas /></GrammarFragment>` may call the
  library's hooks. A use outside the region, an unused import, a side-effect import and an exported helper keep the import judged.
- **Outside a `Fragment`** every rule stays as it was. The repository's own integrity laws (inline lint directives, comments, type
  safety, translation, transport, project graph) are never switched off by any region.

## Rules
- `starci-grammar/fragment-has-reason`: the `reason` is a non-empty string literal.
- `starci-fe/fragment-only-library`: `motion`, `motion/react`, `framer-motion`, `@xyflow/react`, `reactflow` and `@reactflow/*` are imported only
  for use inside a `Fragment` (a type-only import is free). The Grammar never imports them: `starci-grammar/no-graph-or-animation-library`
  and `npm run check:libraries` in `packages/grammar` (DNA `DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`). Grammar's own motion is the CSS
  transitions its tokens drive and stays.

## Inventory (audit, never a failure)
`node node_modules/@starci/eslint-grammar-core/dist/lib/fragment-inventory-cli.js [root] [--json]` lists every `<Fragment reason="...">`
of the source under `root`: file, position, reason and the third-party libraries the region uses (it follows the import alias).
It always exits 0. The same report is `fragmentInventory(root)` / `formatFragmentInventory(uses)` from `@starci/eslint-grammar-core`.
