# Rows of data are always a card

Law module: `rows-in-card.ts`. Finding code: `FE_ROWS_IN_CARD`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#ROWS-IN-CARD`.

A list of rows or key-value rows is a card: on the pink well a shadow and no border, on a white surface (aside, pane, drawer) a 1px border and no shadow. Grammar draws that edge itself when the rows stand in a `Section` or a `SurfaceCard`.

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
