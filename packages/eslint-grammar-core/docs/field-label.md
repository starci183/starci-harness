# A control is labelled by its own label prop

Law module: `field-label.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#FIELD-LABEL`. Finding code: `FE_FIELD_LABEL`.

The Field contract spaces label to control 8, control to help 4 and field to field 24 (the Form or the field stack). A `Text` placed beside a control as its label is spaced by whoever placed it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/field-label`

A Grammar `Text` or `Label`, or a plain `label` or `span` with literal text, standing immediately before a Grammar form control (Input, Select, Textarea, NumberField, ComboBox, Autocomplete, CheckboxGroup, RadioGroup, ChoiceChips, Switch, DatePicker, DateField, TimeField, SearchField, Slider, CopyField) among the same parent's children (looked through fragments, conditions and `.map`), when the control has no `label` prop (an `aria-label` alone does not count), is refused. A control with a spread is not judged.

**Invalid**

```tsx
<Text>Name</Text>
<Input value={name} onChange={setName} />
```

**Valid**

```tsx
<Input label="Name" value={name} onChange={setName} />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
