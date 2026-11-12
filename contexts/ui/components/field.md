# Field

Contract: [Input](../../grammars/contract.md#input). Vendor: [TextField](../../vendor/heroui.md#input).

## Job
Space the parts of every control the same way: the label, the control, its help, error or counter, and the fields of one
form. The field rule is the one spacing contract of Input, Select, NumberField, Textarea, ComboBox, the date and time
fields, Search, CopyField, Checkbox and Radio groups, ChoiceChips, Switch and Slider, so a form built of any mix of them
comes out with one rhythm. What each control *is* is [text-field](text-field.md) and [select](select.md).

## Choose

Choice `field.choose.label`: who draws the label of a control. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| prop | the control is a form field or a choice (every control above) | its own `label` prop: the control draws the label at md 14 / 500, 8 above the control | lint `starci-grammar/field-label` |
| group | the control is a group (`RadioGroup`, `CheckboxGroup`, `Fieldset`) | the group's `label` (a `Fieldset` legend), its `description` between the label and the options | lint `starci-grammar/field-label` |
| none | the control stands in a bar or a row whose own text names it (a search in a toolbar, a switch in a row) | no visible label, the accessible name through `aria-label`, as the situation allows | judgement |

A hand-made `Text` or `span` placed before a control as its label is spaced by whoever placed it, so the
rhythm below does not hold; the lint refuses it.

Choice `field.choose.rhythm`: who sets a distance of a form. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| inside | a distance between the parts of one field | nothing: the grammar sets it (FIELD-1, FIELD-2) | `starci-grammar/field-label` for the label; the field's own anatomy for the rest |
| between | the distance between two fields | the `Form`, the `Grid kind="form"` rows and columns, the `Fieldset` or a field stack (`Stack gap="section"` of controls): 24 (FIELD-3). Never a gap, margin or padding on one field | `starci-grammar/gap-proximity` exempts the field stack in a `Form` or `Fieldset`; `starci-fe/no-spacing-utility` |
| fieldset | a named group of fields with actions | a `Fieldset`: the legend 8 above its fields, its actions 24 below the last field (FIELD-4) | judgement |

## The rhythm

| Id | Distance | Value | Owner |
| --- | --- | --- | --- |
| FIELD-1 | label to control | 8 (`--grammar-inline-gap`); the label is md 14 / 500 | the control |
| FIELD-2 | control to its help, error or counter | 4 (`--grammar-identity-gap`); a group's description stands 8 on each side, between the label and the options | the control |
| FIELD-3 | field to field | 24 (`--grammar-section-gap`), set by the `Form`, the `Grid kind="form"` rows and columns, the `Fieldset` or the field stack, never by a field (a field has no outer margin) | the form |
| FIELD-4 | `Fieldset` legend to its fields; its fields to its actions | 8; 24 | the `Fieldset` |

A choice (`Checkbox`, `Radio`, `Switch`) puts its label 8 from the control and its help 4 below. The field stack of
24 inside a `Form`, `Fieldset` or a Drawer or Dialog body is the Field rule's rhythm and is exempt from the proximity law
([presentation](../presentation.md#space) G6): the form is the container, the fields are its peers.

## Variants
None for the app ([text-field](text-field.md) Variants).

## Size
`md` only ([../scale.md](../scale.md)); the label is `md` 14 / 500 (FONT-7 in [../presentation.md](../presentation.md#type)).

## States
The label is always visible and the help sits in its own slot under the control; an error replaces nothing and takes the
help's 4. The rhythm holds in every state, loading included (STATE-8).

## Owner split
- **Grammar owns:** every distance of FIELD-1, FIELD-2 and FIELD-4, the label's size and weight, and FIELD-3 through
  `Form`, `Grid kind="form"` and `Fieldset`. Story `forms--field-rhythm` shows every control kind in one `Form`.
- **Knowledge decides:** which control, one column or pairs ([text-field](text-field.md) `text-field.choose.columns`).
- **App author decides:** the label, help and error words. No distance.

## Rules
FIELD-1..4, G6, FONT-7, STATE-8. Lint: `starci-grammar/field-label`, `starci-grammar/gap-proximity`,
`starci-fe/no-spacing-utility`. Proof: A11Y-1, TASTE-4.

## A labelled Switch needs its description (SWITCH-LABEL-DESCRIPTION)
A `Switch` with a visible label MUST carry `description` (the type is a union on `isLabelHidden`: a bare control, `isLabelHidden`, is the only switch without one). The row is label (14, weight 500) and description (12, muted) at the start filling the row, the control at the end edge centred vertically, the whole row the hit target; there is no placement prop, so the control cannot come before the text. Setting explanations are the description of the switch, never a loose line under it.
