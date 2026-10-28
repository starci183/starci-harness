# Text field

Contract: [Input](../../grammars/contract.md#input), [CopyField](../../grammars/contract.md#copyfield). Vendor:
[Input, TextField](../../vendor/heroui.md#input).

## Job
Let the reader type one value, or take away one value the product holds, with a persistent label, an optional
standing description under the control, and its own error.

## Choose

Choice `text-field.choose.role`: which field takes the value. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| list | the value comes from a known list | not typed: `select.choose.role` | judgement |
| secret | the reader copies a secret the product holds (a key, a webhook secret) and never edits it | `CopyField masked` with the last four characters; the clear value only in `onCopy` | DNA-COMMON-COPYFIELD-MASKED |
| copy | the reader copies a value the product holds (an id, a URL, an account number) and never edits it | `CopyField` | judgement |
| multi | several values of one kind | one `Input` per value with its remove action and an "add another" command (COLLECTION-1), never one textarea | judgement |
| search | a search over the current view | `SearchField` (named, with its shortcut hint in chrome) | judgement |
| number | a number with bounds or steps | `NumberField` | judgement |
| date | a date or a time | the date and time fields | judgement |
| prose | several lines of prose | `Textarea` | judgement |
| line | one line of free text | `Input` | judgement |

Choice `text-field.choose.columns`: how the fields of one form are laid out. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| narrow | the form's owner is narrow (drawer, rail, dialog) or every field is long | one column: `FormGrid columns={1}` or the fields stacked in the `Form` | judgement |
| pairs | short fields that read as pairs (name and plan, retries and URL) in a wide owner | `FormGrid` (two columns once its own width holds them); its rows align on the control line | DNA-COMMON-FIELD-ROW-CONTROL-LINE |

## Variants
None for the app: the treatment follows the layer, canvas or inside a surface, resolved by the grammar
(`DNA-COMMON-FIELD-BY-LAYER`; lint `starci-fe/nested-control-variant`).

## Size
`md` only ([../scale.md](../scale.md)); a `CopyField` is as tall as every field (`DNA-COMMON-FIELD-MD`). A row that
holds a field is an `md` row. Fields inside a narrow owner stay one column (RESPONSIVE-1).

## States
The label is always visible (a placeholder never replaces it). Error lives on the field, once (FEEDBACK-1);
standing guidance is the `description`, under the control (`DNA-COMMON-FIELD-ANATOMY-ORDER`). Exactly one focus
ring, on the field frame. Disabled and skeleton per CTA-3. A `CopyField` adds copied (about two seconds, announced
politely) and failed (the field's error). Known field types declare autofill and input-mode hints.

## Owner split
- **Grammar owns:** anatomy (label, control, description, error), the layer treatment, height, focus
  ring, mobile text size, the control line of a `FormGrid` row, a `CopyField`'s truncation, mask and copy states.
- **Knowledge decides:** which field role, one column or pairs, error placement, multi-value as rows.
- **App author decides:** label, description, error and copy-action copy, validation facts, autofill hints, the
  reveal behind a masked `onCopy`.

## Rules
FEEDBACK-1, COLLECTION-1, RESPONSIVE-1, ANATOMY-2. Lint: `starci-fe/no-native-form-control`,
`nested-control-variant`. Proof: A11Y-1, UX-3, UX-8, FOCUS-1.
