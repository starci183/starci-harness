# Text field

Contract: [Input](../../grammars/contract.md#input). Vendor: [Input, TextField](../../vendor/heroui.md#input).

## Job
Let the reader type one value, with a persistent label, an optional standing description, and its own error.

## Choose

| Need | Use |
| --- | --- |
| one line of free text | `Input` |
| a search over the current view | `SearchField` (named, with its shortcut hint in chrome) |
| a number with bounds or steps | `NumberField` |
| a date or time | the date and time fields |
| several lines of prose | `Textarea` |
| several values of one kind | one `Input` per value with its remove action and an "add another" command (COLLECTION-1), never one textarea |
| a value from a known list | [select](select.md) or [segmented-control](segmented-control.md) |

## Variants
The field's treatment follows its layer: on the page background it takes the canvas treatment, inside a painted
surface the nested treatment. The grammar resolves this from context; the app never passes a field variant
(presentation "The layer chain"). Lint: `starci-fe/nested-control-variant`.

## Size
`md` only ([../scale.md](../scale.md)). A row that holds a field is an `md` row. Fields inside a narrow owner
stay one column (RESPONSIVE-1).

## States
The label is always visible (a placeholder never replaces it). Error lives on the field, once (FEEDBACK-1);
standing guidance is the `description`. Exactly one focus ring, on the field frame. Disabled and skeleton per CTA-3.
Known field types declare autofill and input-mode hints.

## Owner split
- **Grammar owns:** anatomy (label, description, control, error), the layer treatment, height, focus ring, mobile text size.
- **Knowledge decides:** which field role, one column in narrow owners, error placement, multi-value as rows.
- **App author decides:** label, description and error copy, validation facts, autofill hints.

## Rules
FEEDBACK-1, COLLECTION-1, RESPONSIVE-1, ANATOMY-2. Lint: `starci-fe/no-native-form-control`,
`nested-control-variant`. Proof: A11Y-1, UX-3, UX-8, FOCUS-1.
