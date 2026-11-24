# Marketing motion

Contract: [motion](../../grammars/contract.md#marketing-motion). Vendor: none (four pieces over the Grammar's own ramps).

## Job
Give a public marketing page its four movements (a section rising into view, a loop of names, a figure counting up, a picture that follows the text) without the page holding a keyframe, a timing or an observer of its own.

Evidence (Rule 1). The need is not one product's: a landing page, a pricing page and a launch page of any product, and a docs site's tour, each use the same four.

## Choose

Choice `motion.choose.piece`: which piece a movement is. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| enter | a section or a set of peers should arrive as the reader scrolls to it | `Reveal` | DNA-COMMON-REVEAL-REDUCED-STATIC |
| loop | a strip of logos or names that has no start and no end | `Marquee` | DNA-COMMON-MARQUEE-REDUCED-STATIC |
| count | one figure that is worth watching arrive (a total, a percentage, a rating) | `CountUp` | DNA-COMMON-COUNT-UP-REDUCED-STATIC |
| follow | one picture or product view that changes while two or more steps of text scroll past | `StickyStory` | DNA-COMMON-STICKY-STORY-PINS |
| none | a state change, a press, an overlay | no piece: the Grammar's own transitions (`--starci-core-motion-duration`) | judgement |

Choice `motion.choose.reveal`: what a `Reveal` wraps.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| rise | one region (a section, a split, a closing band) | `kind="rise"` (the default): the region rises as one piece | DNA-COMMON-REVEAL-REDUCED-STATIC |
| stagger | peers that read as a set (a grid of cards, a row of steps, a list of plans) | `kind="stagger"`: each direct child rises, the next a beat after the one before | DNA-COMMON-REVEAL-REDUCED-STATIC |
| above the fold | the first screen of the page | no `Reveal`: what the reader sees first is already there | judgement |

Choice `motion.choose.cover`: the picture-led card of a marketing page (a feature, a template, a platform). No further piece exists: it is `SurfaceCard kind="tile"` with `poster.bleed` in `Grid kind="cards" size="tile"` ([card](card.md) `card.choose.role:tile`), inside a `Reveal kind="stagger"` when the set should arrive in turn. A card with a picture that is not a peer in a grid is a `body` card with an `Image` in its content.

## Variants
- `Reveal` takes `kind` (`rise`, `stagger`). Nothing else: the duration, the distance and the stagger step are the ramps (`--grammar-motion-duration-reveal`, `--grammar-motion-distance-reveal`, `--grammar-motion-stagger`).
- `Marquee` takes a `label` and its items. The pace is the ramp `--grammar-loop-marquee` (a shorter cycle on a phone). Give it enough items to fill its width once; it repeats them to close the loop.
- `CountUp` takes `value`, the application's `locale`, `format` (`Intl.NumberFormat` options: grouping, decimals, `percent`, `compact`), `prefix` and `suffix`. The count's length is the ramp `--grammar-motion-duration-count`.
- `StickyStory` takes a `label`, two or more `steps` (`id`, `content`, `panel`) and `stage` (`start` or `end`, the side of the pinned picture in reading order).

## How each one behaves
All four draw their **static, complete** content first, and add movement only where `prefers-reduced-motion: no-preference` holds and the browser can do it. Reduced motion, a page whose script never runs and a browser without the feature all land on the static content, so nothing is ever hidden behind a movement.

| Piece | With motion | Static (reduced motion, no script, no feature) |
| --- | --- | --- |
| `Reveal` | fades up on entering the viewport: scroll-driven (`animation-timeline: view()`) with no script where the browser has it; otherwise a small observer that hides only a region that starts below the fold and shows it on arrival | in place, opaque, never hidden |
| `Marquee` | drifts toward the start, pauses while the pointer rests on it or focus is inside it; the repeat is `aria-hidden` and `inert` | one run, wrapped onto as many lines as it needs, no repeat |
| `CountUp` | counts from zero to the value the first time it is seen; the moving figure is `aria-hidden` and the final value stays in the accessibility tree | the final value as plain text, from the server's first byte |
| `StickyStory` | on a wide screen the picture is pinned and the panel of the step in the middle of the viewport shows, driven by one scroll timeline per step (or by an observer) | the steps in order, each with its own panel below its text |

## Size
No size scale. `StickyStory` pins at `--grammar-story-pin-top` and its stage and each step are `--grammar-story-height` tall.

## States
The states are the table above: static, scroll-driven, observed, counting, paused, pinned. A piece draws no skeleton: it holds content the page already has and waits for no read.

## Owner split
- **Grammar owns:** every duration, easing and distance (the ramps in `src/common/ramps.css`: `--grammar-motion-*`, `--grammar-loop-marquee*`, `--grammar-story-*`), the feature test, the observer fallback, the reduced-motion and phone fall-backs, the accessibility of the repeat and of the stage.
- **Knowledge decides:** which piece, and what a `Reveal` wraps (the tables above).
- **App author decides:** the content, the figures, the locale, the steps and their pictures. A `panel` is drawn twice (in the stage and under its step), so it holds no `id`.

## Rules
MOTION-1, MOTION-2, MOTION-3 (the duration is the Grammar's, never the app's); DNA `DNA-COMMON-MOTION-TOKENS-BOUND`, `DNA-COMMON-REVEAL-REDUCED-STATIC`, `DNA-COMMON-MARQUEE-REDUCED-STATIC`, `DNA-COMMON-MARQUEE-COPY-HIDDEN`, `DNA-COMMON-MARQUEE-PAUSES`, `DNA-COMMON-COUNT-UP-REDUCED-STATIC`, `DNA-COMMON-STICKY-STORY-PINS`, `DNA-COMMON-STICKY-STORY-STAGE-HIDDEN`, `DNA-COMMON-STICKY-STORY-REDUCED-STATIC`, `DNA-COMMON-STICKY-STORY-REDUCED-PANELS`, `DNA-COMMON-STICKY-STORY-PHONE-STATIC`, `DNA-COMMON-STICKY-STORY-PHONE-PANELS`.
