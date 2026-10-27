# SegmentedControl

Contract: [SegmentedControl](../../grammars/contract.md#segmentedcontrol). Vendor:
[ToggleButtonGroup](../../vendor/heroui.md#togglebuttongroup).

## Job
Choose **one value** among two to five short, mutually exclusive options that are all worth seeing at once.
It is a form control announced as a radio group; it submits a value inside a form.

## Choose

Choice `segmented-control.choose.role`: which control sets one value from a closed set. The first row that
applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| panels | the choice swaps whole panels | `tabs.choose.role:panels` | judgement |
| filter | the choice filters a collection, possibly several values at once | selectable `TagGroup` (`chip.choose.role:filter`) | judgement |
| switch | the value is on or off of one setting | `Switch` | judgement |
| radio | each option needs a sentence of explanation | `RadioGroup` | judgement |
| list | six or more options, or labels too long for one segment | `select.choose.role` | candidate: a `SegmentedControl` holds 2 to 5 segments |
| segmented | 2 to 5 short, mutually exclusive options, all worth seeing at once | `SegmentedControl` | `DNA-COMMON-SEGMENTED-RADIO` |

## Variants
None for the app. The selected segment carries the selection treatment (CTA-1): never a commit among the options.

## Size
`md` default, `sm` in a dense toolbar; in a bar it is `control` ([../scale.md](../scale.md)). `width="fill"`
stretches segments across a narrow form.

## States
A segment is never deselected by pressing it again. Skeleton keeps the label as text and draws one block of the
segments' footprint.

## Owner split
- **Grammar owns:** anatomy, selection paint, sizes, radio semantics, form submission.
- **Knowledge decides:** segmented vs select vs radio vs tabs vs tags; the step.
- **App author decides:** options, labels (an icon-only option has an accessible label), the value.

## Rules
STATE-6, CTA-1, FEEDBACK-1. Proof: A11Y-4, FOCUS-2.
