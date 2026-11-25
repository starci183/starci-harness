# Schema form and agent surfaces: SchemaForm, ApprovalCard, WorkbenchSlot, NoteList, NoteRow, ConflictCard

Contract: [schema-form](../../grammars/contract.md) and `agent-surfaces` of [contract.yaml](../../grammars/contract.yaml). Vendor: none of its own; the controls are [text-field](text-field.md), [select](select.md) and [upload](upload.md), the cards are [card](card.md).

## Job
Let a person and an agent fill ONE structured result together, and read what an agent knows. The result's shape is a schema (the JSON Schema a zod schema emits), so no screen draws that form by hand.

## Choose

Choice `schema-form.choose.surface`: which component draws the structured result. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| fill | the person or the agent writes the fields of a result (a script, a brief, a quote) | `SchemaForm`: one control per field of the schema, the label over the control; `meters` reads a limit against an array's items (15 of 15 seconds) | candidate |
| approve | one request waits for a yes and its facts are a schema's fields | `ApprovalCard`: `SurfaceCard` with the facts as words (`SchemaForm layout="kv" readOnly`), `editable` fields fixable in place with Save and Cancel, the one solid action Approve (held while a quick edit is open), the way into the full editor as a text button | candidate |
| workbench | the first tab of an agent: what its pack draws for it | `WorkbenchSlot`; a pack with no workbench passes `empty` and a fallback (its recent runs): the slot says in words that the agent has no workbench yet and that it still works | judgement |
| memory | what an agent remembers: each sentence with its kind, source, scope and use | `NoteList` of `NoteRowData` (the row alone is `NoteRow`); a note narrower than the shop carries the one command that widens it | judgement |
| clash | a new note disagrees with a remembered one | `ConflictCard`: the two sides as named groups, the ways to settle at the foot, none of them the solid one | judgement |

Choice `schema-form.choose.control`: how a field of the schema is drawn. The first row that applies wins; the schema decides, the author never picks a control.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| choice | the field has `enum` or `oneOf` | `Select` with the titles of `oneOf` | judgement |
| rows | an array of objects | numbered rows, each with move up, move down and remove, and an add button (`addLabel`, `maxItems` with its note) | judgement |
| list | an array of strings | the same rows, one line each | judgement |
| group | an object inside the object | a fieldset titled by the field | judgement |
| number | `number` or `integer` | `NumberField` without steppers; the unit is in the label | judgement |
| switch | `boolean` | `Switch kind="compact"` | judgement |
| upload | `format` is `image` or `file` | the `upload` slot, else a `FileDropzone` that hands the files to `onUpload` | judgement |
| text | anything else | `Textarea` for `format="textarea"`, else `Input` (`email` and `tel` take their keyboard) | judgement |

## The states of a form two hands fill
- **Edited by the person** (`marks[path] = "edited"`): the label ends with a muted marker (the pencil and the app's "You edited"). It is how the agent knows to leave the field alone; the app keeps the rule, the form shows it.
- **Being written by the agent** (`"writing"`): the field is read-only on the secondary ground and its label ends with the typing dots and "Claude is writing"; the status is announced.
- **Proposed** (`proposals[path]`): under the field, the value now (struck, the diff's removed tone) over the suggested one (the added tone), with Accept and Reject as `border` buttons; `onProposal(path, decision)`. The form changes nothing until the app applies the decision.
- **Missing**: a required field left empty draws the warning edge and the app's "Needed" under it; `schemaFormMissing(schema, value)` returns the paths for the app's sticky foot ("2 places missing"). The words are never colour alone.
- **Focused**: the field's own ring (the field tokens); the form adds none.
The form keeps no copy of the value: it hands the whole new value to `onChange(value, { path })`.

## The quick edit of an approval card
`editable` lists the paths a person may fix without the full editor. Quick edit opens only those as controls, with Save and Cancel under the facts; Approve is disabled while it is open, so nobody approves what they have not saved; Cancel drops the draft. The note under the card says what quick edit does and what opening the editor keeps.

## Owner split
Grammar owns the controls, the markers, the diff and the layout. The app owns every word (`labels`), the schema, who is allowed to write which field, what an upload is, and the decisions.

## Rules
`DNA-COMMON-ONE-ACCENT-FILL` (the approval is the card's one solid action), `DNA-COMMON-LOADING-REGION-INERT` (a loading form is inert and keeps its boxes).
