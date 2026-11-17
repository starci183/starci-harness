# Key-value and disclosure rows stand in a card or a section

Law module: `rows-in-card.ts`. Finding code: `FE_ROWS_IN_CARD`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#ROWS-IN-CARD`.

Key-value rows (`DescriptionList`) and disclosure rows (`DisclosureList`) stand in a `SurfaceCard` or a `Section`. In a card they take the card's edge: on the pink well a shadow and no border, on a white surface (aside, pane, drawer) a 1px border and no shadow, which Grammar draws itself. A plain list of rows is a flat `Section kind="list"` (LIST-ONE-LOOK, `surface-card-list`).

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/rows-in-card`

A Grammar `DescriptionList` or `DisclosureList` that no `SurfaceCard`, `Section`, `DataTable` or `Accordion` of the same file encloses (message `bare`). A row primitive passed as a JSX attribute value is judged where the receiver draws it. `ListBox` (a navigation list or menu) is not read.

**Invalid**

```tsx
<Stack><DescriptionList items={items} /></Stack>
```

**Valid**

```tsx
<SurfaceCard label="Details"><DescriptionList items={items} /></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
