# SegmentedControl

Contract: [SegmentedControl](../../grammars/contract.md#segmentedcontrol). Vendor:
[ToggleButtonGroup](../../vendor/heroui.md#togglebuttongroup).

## Job
Choose **one value** among two to five short, mutually exclusive options that are all worth seeing at once.
It is a form control announced as a radio group; it submits a value inside a form.

## Choose

| Need | Use |
| --- | --- |
| 2-5 short options, all visible, one value | `SegmentedControl` |
| more options, or long labels | [select](select.md) |
| options that each need a sentence of explanation | a radio group |
| on/off of one setting | a switch |
| swap whole panels | [tabs](tabs.md) |
| filter a collection, possibly several at once | selectable `TagGroup` ([chip](chip.md)) |

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
