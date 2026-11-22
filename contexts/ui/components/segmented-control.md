# Choosing one value

The Grammar has no segmented control: `SegmentedControl` is removed (the pill-in-a-track look is `Tabs appearance="primary"`, a switch of a mode or period of the same data, [tabs](tabs.md) `tabs.choose.role:switch`). Choosing a value of a form is `ChoiceChips`, `ChoiceButtons` or `RadioGroup`.

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
| buttons | the value of a form field, options with the weight of a button (a plan level, an amount) that all stay visible; never a period or mode switch of shown data, which is `Tabs appearance="primary"` at the trailing edge of its head (`tabs.choose.role:switch`) | `ChoiceButtons`, separate toggles as tall as a Button of their size | `DNA-COMMON-CHOICE-BUTTONS-BUTTON-HEIGHT` |
| chips | six or more short options (times, sizes, days) that all stay visible and wrap onto rows | `ChoiceChips`, toggles as tall as a Chip (a taken option is disabled and keeps its place) | `DNA-COMMON-CHOICE-CHIPS-WRAP` |
| list | six or more options, or labels too long for one chip | `select.choose.role` | judgement |
| segmented | 2 to 5 short, mutually exclusive options, all worth seeing at once | `ChoiceButtons` or `ChoiceChips` (or `RadioGroup` when each needs a sentence); joined buttons are refused by R380 | judgement |

## Variants
None for the app. The selected segment carries the selection treatment (CTA-1): never a commit among the options. A selected `ChoiceButtons` option is the accent soft pair (fill and text) with no edge of its own, whatever the app's plate hooks; the focus ring shows for keyboard focus only, never after a pointer press (owner 2026-11-23).

## Size
`ChoiceChips` has one size: a choice chip is as tall as a Chip of size sm ([chip](chip.md)), the 12 text on a 20 line
(`DNA-COMMON-CHOICE-CHIPS-CHIP-HEIGHT`). `ChoiceButtons` takes `size` `md` (default, 40) or `sm` (32), the height of a Button of the
same size (`DNA-COMMON-CHOICE-BUTTONS-BUTTON-HEIGHT`, `DNA-COMMON-CHOICE-BUTTONS-SM-HEIGHT`).

## States
A segment is never deselected by pressing it again. Skeleton keeps the label as text and draws one block of the
segments' footprint.

## Owner split
- **Grammar owns:** anatomy, selection paint, sizes, radio semantics, form submission.
- **Knowledge decides:** segmented vs select vs radio vs tabs vs tags; the step.
- **App author decides:** options, labels (an icon-only option has an accessible label), the value.

## Rules
STATE-6, CTA-1, FEEDBACK-1. Proof: A11Y-4, FOCUS-2.
