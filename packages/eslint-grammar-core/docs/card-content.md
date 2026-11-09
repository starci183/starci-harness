# One content per card

Law module: `card-content.ts`. Finding codes: `FE_CARD_ONE_CONTENT`, `FE_NO_LABEL_DESCRIPTION`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#CARD-ONE-CONTENT`.

A `SurfaceCard` holds exactly ONE content: a list, an input group (a form), a table, a graph or a figures ribbon, with its own controls (a tab, search or pagination zone, a form footer with Cancel and Save). Several groups are several cards, each with a `Sublabel` above it; items of the same kind stay in one list. A card inside a card is `no-raised-surface-in-surface` (R340). A label has no description under it.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/card-one-content`

- A `SurfaceCard` (not `figures`, not `tile`) whose body holds more than one content component (`ListBox`, `ItemList`, `DescriptionList`, `DataTable`, `FlowGraph`, `BarChart`, `Timeline`, `Form`, `FormGrid`, a `Section kind="list"` or `"figures"`, ...), looked through layout wrappers (message `many`).
- A card that carries a `figures` header zone while it is not itself `kind="figures"`: a ribbon above another content (message `ribbon`).

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
<Sublabel>Lines</Sublabel><SurfaceCard kind="list" label="Lines" items={lines} empty="-" />
<Sublabel>Facts</Sublabel><SurfaceCard kind="details" label="Facts" items={facts} />
<Section title="Runs" caption="Everyone on the team">...</Section>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
