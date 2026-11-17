# Illustration

Contract: [Illustration](../../grammars/contract.md#illustration). Vendor: none (a native `picture` in a reserved box).

## Job
Draw art that decorates: it says nothing the words beside it do not, and the page reads the same without it.

## Choose

Choice `illustration.choose.place`: where decorative art may stand. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| character | the art is the product's character | [mascot](mascot.md) | R338 |
| page state | a whole page has nothing, is gated or failed (first visit, a paywall, a 404, a 500) | the `illustration` of an `EmptyNotice` with `scope="page"` ([empty-state](empty-state.md)) | type: only `scope="page"` takes it |
| hero | a landing hero or a split screen gives the art its own half | `Illustration` beside the headline (a `Grid kind="pair"` trailing), or in the `artwork` of an `EntryFrame` with `ratio="fill"` | judgement |
| banner | a strip across a marketing page | `Illustration` with `ratio="21:9"` and a `compact` crop | judgement |
| else | anywhere inside a working page (a section, a list, a table, a panel) | none: a working page carries no art (DISCIPLINE-3) | DISCIPLINE-3 |

Choice `illustration.choose.ratio`: `1:1` or `4:3` for art beside a headline, `16:9` or `21:9` for a band, `fill` for art that takes the whole box
of its host. A crop that differs on a phone (a wide band becomes a taller picture) is `compact`: another file and, when its shape differs,
its own `ratio`, drawn below 48rem through a `picture` source.

Choice `illustration.choose.meaning`: decorative by default (`alt` empty, `aria-hidden`); a non-empty `alt` only when the art carries a fact
the copy does not.

## Variants
`fit` is `cover` (the default, the art fills its box) or `contain` (the whole art on a transparent ground). The file is named by `src` or by a
`staticsKey` ([image](image.md) `image.choose.source`).

## Size
Its width is its host's; the app bounds it with a layout track. In an `EmptyNotice` of page scope the art is the state step, set by the grammar:
160px at 1440 and 120px below 48rem (`--grammar-illustration-state`).

## States
Loading: a shimmer in the ready box. Error: the plate with no mark (the page stays whole without the art). Region loading draws the ready box
under a shimmer. The file is `loading="lazy"` by default; the first screen's art takes `loading="eager"`.

## Owner split
- **Grammar owns:** the ratio box, the compact breakpoint, the states, the radius, the statics resolution, the state step.
- **Knowledge decides:** where art may stand (the table above) and that it is decorative.
- **App author decides:** the files and their crops, the compact ratio, the statics base URL.

## Rules
BRAND-2, DISCIPLINE-3, DISCIPLINE-4, A11Y-2; lint `starci-grammar/no-raw-media` (R436), `starci-grammar/generated-art-in-mascot-or-media-frame` (R338).
