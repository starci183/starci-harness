# One object per card

Law module: `card-content.ts`. Finding codes: `FE_CARD_ONE_CONTENT`, `FE_NO_LABEL_DESCRIPTION`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#CARD-ONE-CONTENT`.

A `SurfaceCard` is ONE object: its name, its facts and its commands (`actions`). A second list, table, form or graph is not part of the object: it stands flat in its own `Section` (a ribbon is `Section kind="figures"`); items of the same kind stay in one list. A card inside a card is `no-raised-surface-in-surface` (R340); a card whose only content is a collection is `card-is-object`. A label has no description under it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/card-one-content`

- A `SurfaceCard` (not `tile`) whose body holds more than one content component (`ListBox`, `ItemList`, `DescriptionList`, `DataTable`, `BarChart`, `Timeline`, `Form`, `FormGrid`, a `Section kind="list"` or `"figures"`, ...), looked through layout wrappers (message `many`).

## `starci-grammar/no-label-description`

- A `Section` with a `description` prop (message `section`): write `caption`.
- A labelled `SurfaceCard` (not a tile) with a `description` prop (message `card`): write `note`.

**Invalid**

```tsx
<SurfaceCard label="Order"><ListBox label="Lines" .../><DescriptionList items={facts} /></SurfaceCard>
<Section title="Runs" description="Everyone on the team">...</Section>
```

**Valid**

```tsx
<Section title="Lines"><DataTable label="Lines" columns={columns} rows={lines} renderCell={renderCell} emptyContent="-" /></Section>
<Section title="Facts"><DescriptionList isDivided items={facts} /></Section>
<Section title="Runs" caption="Everyone on the team">...</Section>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
