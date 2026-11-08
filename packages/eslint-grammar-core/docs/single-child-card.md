# A table, list or chart standing alone is the surface

Law module: `single-child-card.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SINGLE-CHILD-CARD`. Finding code: `FE_SINGLE_CHILD_CARD`.

A card (`SurfaceCard`) groups two or more different parts (figures + list + actions), or carries zones (tabs, search, head actions). A table, list or chart standing alone IS the surface: its title sits above it as a `Section` head and one line sits under it as `Section caption` (muted, sm). The Grammar draws a standalone `DataTable` (`surface="card"`) and every `Section kind="list"` as its own card (border, card radius, card shadow; the table keeps HeroUI's native look inside), so a card around either is a second card.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/single-child-card`

A Grammar `SurfaceCard` is refused when it has no zones (no `headers` or `footers` prop, an empty array counts as none, and no `labelEnd`) and either:

- its only body child (looked through fragments, `cond && x`, `cond ? x : y` and `.map`; blank text ignored) is a table, a list or a chart:
  - table: `DataTable`
  - list: `ListBox`, `ItemList`, `DisclosureList`, `Timeline`, `Section kind="list"`
  - chart: `BarChart`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`
- or it is `kind="table"` or `kind="list"` (the data-driven form of the same lone table or list).

Not flagged: a card with two or more body children, a card with zones or `labelEnd`, a card with a JSX spread, `kind` `figures`, `details`, `accordion` or `tile`, a non-Grammar `SurfaceCard`, and non-product source. `Meter`, `Progress` and `DescriptionList` (a record's term/value facts; its card is `kind="details"`) are not read as table, list or chart.

**Invalid**

```tsx
<SurfaceCard label="Runs"><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Runs" kind="list" items={runs} empty={null} />
```

**Valid**

```tsx
<Section title="Runs" caption="Last 30 days"><DataTable columns={columns} rows={runs} /></Section>
<Section title="Runs" caption="Last 30 days" kind="list" items={runs} />
<SurfaceCard label="Runs" headers={[{ kind: "search", /* ... */ }]}><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Runs"><Text>3 failed</Text><DataTable columns={columns} rows={runs} /></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
