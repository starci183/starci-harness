# Freestyle

Contract: [Freestyle](../../grammars/contract.md#freestyle). Vendor: none (a Common region).

## Job
Give the app one sanctioned place to write its own plain divs and CSS (layout, paint, radius, arbitrary values,
absolutely positioned art) when no grammar component or composition fits. It is a last resort: the rest of the page
stays on the grammar.

## Choose

Choice `freestyle.choose.region`: whether a region is written by hand.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| grammar | a grammar component or composition expresses the region (a card, a rail, a pane layout, a backdrop, a mascot) | that component, never `Freestyle` | judgement |
| freestyle | no grammar component or composition fits and the region needs the app's own elements or CSS (a sign-in brand art composed of absolutely positioned pieces) | `Freestyle` with a `reason` that names why nothing fits, around that region only | judgement; lint `starci-grammar/freestyle-has-reason` |

Keep everything else on the grammar: the page, its header, its surfaces and its controls. Wrap the one region, not the
page. A grammar component placed inside `Freestyle` keeps its contract and is judged as before.

## Variants
None. `reason` is required and stamped as `data-grammar-freestyle-reason`; `className` carries the app's own CSS.

## Size
It fills its host (inline and block size 100%).

## States
None of its own.

## Owner split
- **Grammar owns:** the region itself: a div that fills its host and adds no paint, inset or radius; the reason stamp.
- **Knowledge decides:** grammar vs freestyle (the table above); that it is a last resort.
- **App author decides:** the region, its elements and CSS, and the reason in a few words.

## Rules
Ruling grammar-freestyle-region; lint R341 (`starci-grammar/freestyle-has-reason`). The rules that judge hand-written
elements, classes, styles and generated art (`starci-fe/no-arbitrary-value`, `no-app-surface-paint`,
`no-raw-brand-value`, `no-list-panel-padding`, `no-inline-class-name`, `no-native-img`,
`starci-grammar/no-raw-structural-element`, `no-fractional-step`, `generated-art-in-mascot-or-media-frame`,
`no-inline-svg-outside-brand-mark-leaf`) do not report the raw elements inside a `Freestyle` subtree of the same file.
