# Select and ComboBox

Contract: [Select](../../grammars/contract.md#select). Vendor: [Select, ComboBox, ListBox](../../vendor/heroui.md#select).

## Job
Pick one value (or several) of a form or a toolbar from a list: the one control for choosing a value, however few the options. A value of a form or toolbar is a `Select`; views and filters are [tabs](tabs.md).

## Choose

Choice `select.choose.role`: which list control picks the value. Views, filters and modes are [tabs](tabs.md) (`tabs.choose.role`) and are settled first. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| action | the entries are actions, not values | `menu.choose.placement` | judgement |
| switch | the value is on or off of one setting | `Switch` | judgement |
| radio | each option needs a sentence of explanation | `RadioGroup` | judgement |
| multi-visible | several values, and every option fits on screen | `CheckboxGroup` | judgement |
| multi | several values from a longer list, or the values of a filter in a toolbar | a multi-selection list: `DropdownMenu` with a `multiple` selection group behind a compact trigger in a toolbar, `ListBox selectionMode="multiple"` in a form; never chips. Known gap: `Select` has no multiple selection, so a filter of several values has no field-looking trigger | judgement |
| combo | a long or searchable list, or free entry with suggestions | `ComboBox` | judgement |
| select | known options, one value, however few (a time, a size, a day, an answer, a tool, a plan level, an amount); a taken option is a disabled option of the list | `Select`: `appearance="field"` in a form, `"compact"` in a toolbar, a pane head or a `Section` filter row | judgement |

## Variants
Same layer rule as a [text field](text-field.md): the grammar resolves the treatment from context. The selection
indicator side is the contract's arrangement.

## Size
`md` only; options are list rows on the ramp ([../scale.md](../scale.md)).

## States
Label always visible; error on the field; the option list keeps keyboard typeahead; disabled options are skipped
by arrow traversal.

## Owner split
- **Grammar owns:** trigger and popover anatomy, option rows, indicator side, height.
- **Knowledge decides:** select vs combo vs radio vs tabs vs menu.
- **App author decides:** options, labels, the value.

## Leading icon
`icon` (an icon source) draws a decorative 20px glyph (the chip icon size) at the start of the trigger, before any `prefix` and the value, in every appearance (a calendar on a period, a funnel on a filter). It is muted, `aria-hidden` and never the name: `label` names the control. The app owns the glyph; no appearance changes with it.

## Compact
`appearance="compact"` is the pill at the dense control step (32): a picker in a toolbar, a pane head or a `Section` `filter` row.

A pill (`pill` and `compact`) sizes to its value, in a `Cluster`, a `Stack` or a page head alike: never under
8rem nor over 20rem (nor its row), a longer value cut with an ellipsis on one line. It never fills its row; the `field`
appearance fills its column.

## Rules
FEEDBACK-1, STATE-6. Lint: `starci-fe/no-native-form-control`. Proof: A11Y-1, FOCUS-2, UX-8.
