# Mascot

Contract: [Mascot](../../grammars/contract.md#mascot). Vendor: none (Common's `Image` under a sized box).

## Job
Show the product's generated character at one size wherever it appears, tied to the asset slot it was requested under.

## Choose

Choice `mascot.choose.size`: which step the character takes. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| split | a split screen gives the art its own half (a sign-in or onboarding split) | `hero`, `visibility` `wide` unless the art carries meaning the compact layout needs (`always`) | judgement |
| lead | the art leads a one-task region: an onboarding step, a welcome, a finished task | `lg` | judgement |
| support | the art accompanies a message inside a region: an empty state, a notice | `md` | judgement |
| inline | the art sits beside a line or a compact row | `sm` | judgement |

Choice `mascot.choose.meaning`: whether the character is named.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| decorative | the copy beside it already says everything | `alt` left empty (the default): hidden from assistive technology | judgement |
| meaningful | the art itself carries information the copy does not | a non-empty `alt` that says it | judgement |

## Variants
The step and `visibility` are the app's, by the tables above. Fit, ground and the compact step-down are the grammar's.

## Size
Its own scale, not the control ramp: `sm` 96px, `md` 160px, `lg` 240px square; `hero` fills its host's height up to
`--grammar-mascot-hero-max`. Below 48rem `lg` draws `md` and `md` draws `sm`; a hero is absent below 64rem unless
`visibility="always"` keeps it as the `lg` box.

## States
Loading keeps the box transparent (no plate); a failed load keeps the box.

## Owner split
- **Grammar owns:** the scale and its tokens, fit contain, the transparent ground, the compact step-down, the hero's
  visibility, the `data-asset-*` attributes.
- **Knowledge decides:** the step and whether the art is named (the tables above); where a mascot may appear is the
  brand record's (BRAND-2, DISCIPLINE-3).
- **App author decides:** the asset slot and its delivered file, the step by the table, `alt` copy.

## Rules
BRAND-2, DISCIPLINE-3, A11Y-2; lint `starci-grammar/generated-art-in-mascot-or-media-frame` (R337),
`starci-grammar/mascot-asset-slot-required` (R338).
