# Select and ComboBox

Contract: [Select](../../grammars/contract.md#select). Vendor: [Select, ComboBox, ListBox](../../vendor/heroui.md#select).

## Job
Pick one value (or several) from a list too long to show all at once.

## Choose

| Need | Use |
| --- | --- |
| 2-5 short options, all worth seeing | [segmented-control](segmented-control.md) or a radio group |
| 6 or more known options, one value | `Select` |
| a long or searchable list, or free entry with suggestions | `ComboBox` |
| several values from a list | a multi-select, or a selectable `TagGroup` when all options fit on screen |
| an action, not a value | a [menu](menu.md) |

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
- **Knowledge decides:** select vs segmented vs combo vs radio vs menu.
- **App author decides:** options, labels, the value.

## Rules
FEEDBACK-1, STATE-6. Lint: `starci-fe/no-native-form-control`. Proof: A11Y-1, FOCUS-2, UX-8.
