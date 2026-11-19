# Custom

Contract: [Custom](../../grammars/contract.md#custom). Vendor: none (a Common region).

## Job
Give the app and its fans one sanctioned place where anything goes: any markup, any class name and any library (a graph
editor, an animation library, a chart toolkit) when no grammar component fits. The Grammar draws nothing inside it and its
lint reports nothing inside it. It is a last resort: the rest of the page stays on the grammar, and every use is listed for audit.

`Custom` is the broad hatch. [Freestyle](freestyle.md) is the narrow one (own plain elements and CSS, with the Grammar's
components still judged inside it); a region that needs a library, or a Grammar component drawn off-contract, is `Custom`.

## Choose

Choice `custom.choose.region`: whether a region is written by hand.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| grammar | a grammar component or composition expresses the region | that component, never `Custom` | judgement |
| freestyle | the region needs only the app's own plain elements and CSS | `Freestyle` | judgement; lint `starci-grammar/freestyle-has-reason` |
| custom | the region needs a library the Grammar does not ship (a graph editor such as `@xyflow/react`, an animation library such as `motion`), or markup and classes no other hatch allows | `Custom` with a `reason` that names why nothing fits, around that region only | judgement; lint `starci-grammar/custom-has-reason` |

Wrap the one region, not the page. Graph drawings (workflow editors, schema maps, bubble maps) are app code: the Grammar ships
no graph component, so the app writes it with its own library inside `Custom`.

## Variants
None. `as` picks the intrinsic element the region renders (`div` by default); the attributes of that element (`className`, `style`,
`id`, `aria-*`, `data-*`, event handlers) pass through. `reason` is required and stamped as `data-grammar-custom-reason`.

## Size
None of its own: a block-level region that takes its content's size. It adds no paint, inset or radius.

## States
None of its own.

## Owner split
- **Grammar owns:** the region itself: the element, the pass-through of its attributes and the reason stamp. Nothing else.
- **Knowledge decides:** grammar vs freestyle vs custom (the table above); that it is a last resort.
- **App author decides:** the region, its markup, CSS and libraries, and the reason in a few words.

## What lint does inside and outside
- **Inside the subtree of a `Custom`** (its attributes and everything it renders) no Grammar rule and no canon front-end rule that
  judges markup, look or libraries reports anything: `eslint-grammar-core` and `eslint-grammar-offset-pop` rules, and the canon
  `starci-fe` laws of the look (`class-names`, `tokens`, `spacing`, `type-scale`, `surface-rules`, `native-controls`, `fe-stack`, ...).
- **Imports.** An import whose every use is inside a `Custom` is not judged (`import { ReactFlow } from "@xyflow/react"`, a HeroUI
  primitive, a library the fe-stack forbids). A same-file component that is not exported and that only a `Custom` renders (a plain function, an arrow or a `memo` / `forwardRef` wrapper) counts as inside,
  so a canvas written as `const Canvas = () => ...` and rendered as `<Custom reason="..."><Canvas /></Custom>` may call the
  library's hooks. A use outside the region, an unused import, a side-effect import and an exported helper keep the import judged.
- **Outside a `Custom`** every rule stays as it was. The repository's own integrity laws (inline lint directives, comments, type
  safety, translation, transport, project graph) are never switched off by any region.
- **`Custom` is recognised by its import** from `@starci/grammar` (`Custom` or `<ns>.Custom`); an app component of the same name opens no region.

## Rules
- `starci-grammar/custom-has-reason`: the `reason` is a non-empty string literal.
- `starci-fe/custom-only-library`: `motion`, `motion/react`, `framer-motion`, `@xyflow/react`, `reactflow` and `@reactflow/*` are imported only
  for use inside a `Custom` (a type-only import is free). The Grammar never imports them: `starci-grammar/no-graph-or-animation-library`
  and `npm run check:libraries` in `packages/grammar` (DNA `DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY`). Grammar's own motion is the CSS
  transitions its tokens drive and stays.

## Inventory (audit, never a failure)
`starci-custom-inventory [root] [--json]` (the `bin` of `@starci/eslint-grammar-core`) lists every `<Custom reason="...">`
of the source under `root`: file, position, `as`, reason and the third-party libraries the region uses. It always exits 0.
The same report is `customInventory(root)` / `formatCustomInventory(uses)` from `@starci/eslint-grammar-core`.
