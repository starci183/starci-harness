# Select and ComboBox

Contract: [Select](../../grammars/contract.md#select). Vendor: [Select, ComboBox, ListBox](../../vendor/heroui.md#select).

## Job
Pick one value (or several) from a list too long to show all at once.

## Choose

Choice `select.choose.role`: which list control picks the value. Reached from
`segmented-control.choose.role:list`, which settles the short sets first. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| action | the entries are actions, not values | `menu.choose.placement` | judgement |
| multi-visible | several values, and every option fits on screen | `CheckboxGroup` | judgement |
| multi | several values from a longer list | a multi-select | judgement |
| combo | a long or searchable list, or free entry with suggestions | `ComboBox` | judgement |
| select | six or more known options, one value | `Select` | candidate: a `Select` lists at least six options |

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

## Leading icon
`icon` (an icon source, 0.47.1) draws a decorative 16px glyph at the start of the trigger, before any `prefix` and the value, in every appearance (a calendar on a period, a funnel on a filter). It is muted, `aria-hidden` and never the name: `label` names the control. The app owns the glyph; no appearance changes with it.

## Compact
`appearance="compact"` is the pill at the dense control step (32): a picker in a toolbar, a pane head or a `Section` `filter` row.

A pill (`pill` and `compact`) sizes to its value (0.42.0), in a `Cluster`, a `Stack` or a page head alike: never under
8rem nor over 20rem (nor its row), a longer value cut with an ellipsis on one line. It never fills its row; the `field`
appearance fills its column.

## Rules
FEEDBACK-1, STATE-6. Lint: `starci-fe/no-native-form-control`. Proof: A11Y-1, FOCUS-2, UX-8.
