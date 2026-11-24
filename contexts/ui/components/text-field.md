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
| file | the reader hands the product files to upload | `Dropzone` of `@starci/grammar/core/ext/dropzone` for EVERY upload ([upload](upload.md)); `FileDropzone` only for a file that submits with a native form and is never uploaded on its own; a file picked as one action among others is `FileButton` (`button.choose.role:file`) | DNA-COMMON-NO-GRAPH-OR-MOTION-LIBRARY |
| search | a search over the current view | `SearchField` (named, with its shortcut hint in chrome); `measure="fill"` (the default), `"compact"` (up to 26rem, above a list's tabs) or `"toolbar"` (15rem = 240px at the start of a toolbar row beside other controls, full width below 30rem) | judgement |
| number | a number with bounds or steps | `NumberField` | judgement |
| date | a date or a time | the date and time fields | judgement |
| prose | several lines of prose | `Textarea` | judgement |
| line | one line of free text | `Input` | judgement |

Choice `text-field.choose.columns`: how the fields of one form are laid out. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| narrow | the form's owner is narrow (drawer, rail, dialog) or every field is long | one column: `Grid kind="form" columns={1}` or the fields stacked in the `Form` | judgement |
| pairs | short fields that read as pairs (name and plan, retries and URL) in a wide owner | `Grid kind="form"` (two columns once its own container is 31rem wide, one column below); its rows align on the control line | DNA-COMMON-FIELD-ROW-CONTROL-LINE |

## Variants
None: a field has one look on the canvas and inside a surface alike (`DNA-COMMON-FIELD-ONE-LOOK`; the prop types have no
`variant`). The theme sets it through the field tokens (`--field-background`, `--field-border`, `--field-border-width`, `--field-border-focus`)
and the field ring hooks (owner: @starci/grammar `src/common/theme-hooks.json`).

## Size
The parts of every field stand on the Field rule (label 8, help 4, field to field 24, [field](field.md) FIELD-1..4).
`md` only ([../scale.md](../scale.md)); a `CopyField` is as tall as every field (`DNA-COMMON-FIELD-MD`). A row that
holds a field is an `md` row. Fields inside a narrow owner stay one column (RESPONSIVE-1).

## States
The label is always visible (a placeholder never replaces it). Error lives on the field, once (FEEDBACK-1);
standing guidance is the `description`, under the control (`DNA-COMMON-FIELD-ANATOMY-ORDER`). Exactly one focus
ring, on the field frame. Disabled and skeleton per CTA-3. A `CopyField` adds copied (about two seconds, announced
politely) and failed (the field's error). Known field types declare autofill and input-mode hints.

## Owner split
- **Grammar owns:** anatomy (label, control, description, error), the layer treatment, height, focus
  ring, mobile text size, the control line of a `Grid kind="form"` row, a `CopyField`'s truncation, mask and copy states.
- **Knowledge decides:** which field role, one column or pairs, error placement, multi-value as rows.
- **App author decides:** label, description, error and copy-action copy, validation facts, autofill hints, the
  reveal behind a masked `onCopy`.

## Chat composer
A `Textarea` with `onSubmitShortcut` is a chat composer, and every chat uses it (`DNA-COMMON-COMPOSER-ONE-LINE`): it starts at one line, the 40px control height, grows with its text up to 6 lines, then scrolls (no
scrollbar), and shrinks back when the text is cleared. `send={{ label, onPress, isDisabled, isPending }}` draws the send action as its own
40px commit Button 12px (the row gap) after the box, level with the box's bottom: the send glyph and `label` from 48rem, the round 40px
icon button named `label` below it. `startAction={{ glyph | source, label, onPress, isDisabled }}` draws one `sm` ghost icon button inside
the box at its bottom start (attach, emoji), with the text starting after it; the caret, the selection and the mention list read the textarea
alone. The app writes no Cluster or gap around the composer. `COMPOSER_MIN_ROWS` (1) and `COMPOSER_MAX_ROWS` (6) name the two bounds.

The `count / max` of a `Textarea` with `maxLength` shows only near the limit, from `COUNT_NEAR_LIMIT` (80%) of it, and past it as invalid;
below that nothing is drawn, so a composer with `maxLength={4000}` carries no "0/4000". `isCountShown`
keeps it at every length, for a field whose budget is the task (a bio, a headline). Story `Forms / Textarea count`.

## Rules
FEEDBACK-1, COLLECTION-1, RESPONSIVE-1, ANATOMY-2, FIELD-1..4. Lint: `starci-fe/no-native-form-control`,
`starci-grammar/field-label`. Proof: A11Y-1, UX-3, UX-8, FOCUS-1.
