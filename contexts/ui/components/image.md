# Image

Contract: [Image](../../grammars/contract.md#image). Vendor: none (a native `img` in a reserved box).

## Job
Show one picture that carries content, in a box that holds its ratio before the bytes arrive.

## Choose

Choice `image.choose.element`: which component draws a picture. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| character | the art is the product's generated character | [mascot](mascot.md) | R338 `generated-art-in-mascot-or-media-frame` |
| decorative | the art adds no fact the words beside it do not state: hero art, a backdrop, an empty state's picture | [illustration](illustration.md) | R442 `no-raw-media` |
| content | the picture itself is the information: a product photo, a screenshot, a chart exported as a picture, a person's upload | `Image` with a non-empty `alt` | `alt` required by type |
| moving | the media plays | [video](video.md) | R442 `no-raw-media` |

Choice `image.choose.ratio`: which ratio the box claims. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| square | an avatar-like or catalogue-grid picture, a logo | `1:1` | judgement |
| photo | a photograph or a screenshot of a landscape page | `4:3`, or `16:9` for a wide scene or a video still | judgement |
| tall | a phone screenshot, a portrait, a story | `3:4`, or `9:16` for a full-height phone frame | judgement |
| banner | a strip across a page head or a promotion | `21:9` | judgement |
| unknown | the file's shape is not known when the page is written (an upload) and a jump on arrival is acceptable | `auto` | judgement |

Choice `image.choose.fit`: how the picture fills the box.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| crop | the picture may lose its edges: a photograph | `cover` (the default) | judgement |
| whole | nothing of the picture may be cut: a logo, a screenshot, a diagram | `contain` | judgement |

Choice `image.choose.source`: where the file is named.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| static | the file is one of the app's statics (`statics/` at the repository root, mirrored to object storage) | `staticsKey`, resolved by the `StaticsProvider` the app mounts once | `STATICS_KEY_UNRESOLVED` in development |
| url | the URL is data already resolved: an upload, a record's `imageUrl` | `src` | judgement |
| sizes | several widths of the file exist | `renditions` (`{ src or staticsKey, width }`, or `density`) and `sizes`, with the file of the smallest width as the source | judgement |

## Variants
`caption` makes the picture a `figure` with a `figcaption` in the muted caption step; `zoom` (the open and close labels) opens the picture
larger in a lightbox. Both are the author's facts; the grammar owns how they look. `plate="none"` keeps cut-out art with an alpha channel
directly on its surface (a logo).

## Size
No size scale: the box takes its host's width and holds the `ratio`; an app bounds the width with its layout (a column, a grid track). The
corner is the Grammar's one radius (`--radius`).

## States
Loading draws a shimmer over the plate in the ready box; `isLoading` (or the region's) draws the ready box unseen under the one shimmer, and
the box never changes size. A picture that fails draws a neutral glyph on the plate in the same box, named by `alt` (`role="img"`), and
`onLoadStateChange` reports `loading`, `loaded` and `error`. The picture is `loading="lazy"` and `decoding="async"` by default; the first
screen's picture takes `loading="eager"`.

## Owner split
- **Grammar owns:** the ratio box, the shimmer and error states, `srcset` and `sizes`, the figure, the lightbox and its focus return, the
  radius, the statics resolution.
- **Knowledge decides:** which component (the table above), the ratio and the fit.
- **App author decides:** the file, its `alt` (the words a person who cannot see it needs; `""` only for a picture the words already
  state), the renditions, the caption and the zoom labels, the `StaticsProvider` base URL.

## Rules
A11Y-2, MOTION-2; lint `starci-grammar/no-raw-media` (R442), `starci-grammar/generated-art-in-mascot-or-media-frame` (R338).

## Eager pictures and the fetch priority (0.48.0)
`loading="eager"` paints with its bytes, before the page hydrates: no shimmer is drawn over it and it is never held at opacity 0 waiting for script (`DNA-COMMON-IMAGE-EAGER-PAINTS`), so an app needs no global CSS to show its hero early. `fetchPriority` (`high` | `low` | `auto`) is the `fetchpriority` hint: `high` for the one picture that is the page's largest paint, `low` for an eager picture that can wait. A lazy picture keeps its shimmer and fade. Story `Surfaces/Figures, rows, bands and pages (0.48.0)` (ImageEagerPaint).
