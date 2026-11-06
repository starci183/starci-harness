# Choosing one value

The Grammar has no segmented control: `SegmentedControl` is removed (the pill-in-a-track look is `Tabs appearance="primary"`, a switch of a mode or period of the same data, in a card's `switch` header zone). Choosing a value of a form is `ChoiceChips` or `RadioGroup`.

## Job
Choose **one value** among two to five short, mutually exclusive options that are all worth seeing at once.
It is a form control announced as a radio group; it submits a value inside a form.

## Choose

Choice `segmented-control.choose.role`: which control sets one value from a closed set. The first row that
applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| panels | the choice swaps whole panels | `tabs.choose.role:panels` | judgement |
| filter | the choice filters a collection that stays in place | `Tabs kind="filter"` (`chip.choose.role:filter`) | judgement |
| switch | the value is on or off of one setting | `Switch` | judgement |
| radio | each option needs a sentence of explanation | `RadioGroup` | judgement |
| chips | six or more short options (times, sizes, days) that all stay visible and wrap onto rows | `ChoiceChips` (a taken option is disabled and keeps its place) | `DNA-COMMON-CHOICE-CHIPS-WRAP` |
| list | six or more options, or labels too long for one chip | `select.choose.role` | judgement |
| segmented | 2 to 5 short, mutually exclusive options, all worth seeing at once | `ChoiceChips` (or `RadioGroup` when each needs a sentence); joined buttons are refused by R380 | judgement |

## Variants
None for the app. The selected segment carries the selection treatment (CTA-1): never a commit among the options.

## Size
`ChoiceChips` sizes follow [../scale.md](../scale.md).

## States
A segment is never deselected by pressing it again. Skeleton keeps the label as text and draws one block of the
segments' footprint.

## Owner split
- **Grammar owns:** anatomy, selection paint, sizes, radio semantics, form submission.
- **Knowledge decides:** segmented vs select vs radio vs tabs vs tags; the step.
- **App author decides:** options, labels (an icon-only option has an accessible label), the value.

## Rules
STATE-6, CTA-1, FEEDBACK-1. Proof: A11Y-4, FOCUS-2.
