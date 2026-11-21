# Key-value and disclosure rows stand in a section or an object card

Law module: `rows-in-card.ts`. Finding code: `FE_ROWS_IN_CARD`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#ROWS-IN-CARD`.

Key-value rows (`DescriptionList`) and disclosure rows (`DisclosureList`) stand in a `Section` (the facts or the disclosures of a collection, flat on the surface: `<Section title ...><DescriptionList isDivided items={...} /></Section>`) or in the body of an object card (the facts of ONE object beside its name or a control). A plain list of rows is a flat `Section kind="list"` (LIST-ONE-LOOK). A card whose only content is the rows is `card-is-object`.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/rows-in-card`

A Grammar `DescriptionList` or `DisclosureList` that no `SurfaceCard` or `Section` of the same file encloses (message `bare`). A row primitive passed as a JSX attribute value is judged where the receiver draws it. `ListBox` (a navigation list or menu) is not read.

**Invalid**

```tsx
<Stack><DescriptionList items={items} /></Stack>
```

**Valid**

```tsx
<Section title="Details"><DescriptionList isDivided items={items} /></Section>
<SurfaceCard label="Agent"><DescriptionList items={items} /><Button>Pause</Button></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
