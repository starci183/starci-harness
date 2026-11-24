# Choosing one value

The Grammar has no segmented control and no choice chips: `SegmentedControl` and `ChoiceChips` are removed (the pill-in-a-track look is `Tabs appearance="primary"`, a switch of a mode or period of the same data, [tabs](tabs.md) `tabs.choose.role:switch`). Choosing a value of a form or a toolbar is a dropdown `Select`.

The owner, 2026-11-24, in his words:

> "xóa choicechips ra không xài, đủ hết cả rồi mà, trong form thì chọn dropdown"

So a peer choice has one component per meaning, and none of them is a row of chips:

- switching views, or a list's status filter ("In progress / Done", "Board / List") is `Tabs` secondary (`kind="views"` or `kind="filter"`), its count in the tab's `count` slot ([tabs](tabs.md) "Views are secondary");
- switching a period or mode of the same data, with no navigation, is `Tabs appearance="primary"`;
- choosing one value in a form or a toolbar is a `Select`, whatever the number of options; `RadioGroup` only when each option needs a sentence of explanation;
- several values of a filter are a multi-selection list (`select.choose.role:multi`), never chips.

## Job
Choose **one value** of a form or a toolbar from a closed set. It is a form control; it submits a value inside a form.

## Choose

Choice `segmented-control.choose.role`: which control sets one value from a closed set. The first row that
applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| panels | the choice swaps whole panels | `tabs.choose.role:panels` | judgement |
| filter | the choice filters a collection that stays in place (a status, a topic, a channel) | `Tabs kind="filter"`, a `count` per tab (`chip.choose.role:filter`) | judgement |
| mode | the choice toggles a period or mode of the same data without navigating, two to four short fixed options | `Tabs appearance="primary"` (`tabs.choose.role:switch`) | lint `starci-fe/no-primary-tabs-misuse` |
| switch | the value is on or off of one setting | `Switch` | judgement |
| radio | each option needs a sentence of explanation | `RadioGroup` | judgement |
| buttons | the value of a form field, options with the weight of a button (a plan level, an amount) that all stay visible; never a period or mode switch of shown data, which is `Tabs appearance="primary"` at the trailing edge of its head (`tabs.choose.role:switch`) | `ChoiceButtons`, separate toggles as tall as a Button of their size | `DNA-COMMON-CHOICE-BUTTONS-BUTTON-HEIGHT` |
| several | several values | `select.choose.role:multi-visible` or `select.choose.role:multi`; never chips | judgement |
| select | any other one value of a form or toolbar (a time, a size, a day, an answer, a tool), however few the options; a taken option is a disabled option of the list | `Select`: `appearance="field"` in a form, `"compact"` in a toolbar, a pane head or a `Section` filter row (`select.choose.role:select`) | judgement |

## Variants
None for the app. The selected segment carries the selection treatment (CTA-1): never a commit among the options. A selected `ChoiceButtons` option is the accent soft pair (fill and text) with no edge of its own, whatever the app's plate hooks; the focus ring shows for keyboard focus only, never after a pointer press (owner 2026-11-23).

## Size
A `Select` takes its size from [select](select.md). `ChoiceButtons` takes `size` `md` (default, 40) or `sm` (32), the height of a Button of the
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
