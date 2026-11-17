# A lone DataTable, chart or list is the surface, never a card

Law module: `single-child-card.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SINGLE-CHILD-CARD`. Finding code: `FE_SINGLE_CHILD_CARD`.

A card (`SurfaceCard`) groups two or more different parts (figures + list + actions), or carries zones (tabs, search, head actions). A card of key-value or choice rows (`kind="table"`, `kind="select"`, `kind="details"`, a `ListBox`, `DisclosureList`, `Timeline`, a `DescriptionList`) is valid alone or not (0.37.8). A standalone `DataTable` (`surface="card"`) or chart IS the surface: its title sits above it as a `Section` head and one line under it as `Section caption`, so a card around it is a second card. A list is a flat `Section kind="list"` that titles itself (0.43.0, LIST-ONE-LOOK), so a card around a lone list is refused the same way.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/single-child-card`

A Grammar `SurfaceCard` is refused when it has no zones (no `headers` or `footers` prop, an empty array counts as none, and no `labelEnd`) and its only body child (looked through fragments, `cond && x`, `cond ? x : y` and `.map`; blank text ignored) is:

- table: `DataTable`
- chart: `BarChart`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`
- list: `Section kind="list"`

Not flagged: any key-value or choice card (`kind="table"`, `kind="select"`, `ListBox`, `DisclosureList`, `Timeline`, `DescriptionList`), a card with two or more body children, a card with zones or `labelEnd`, a card with a JSX spread, `kind` `figures`, `details`, `accordion` or `tile`, a non-Grammar `SurfaceCard`, and non-product source. `Meter` and `Progress` are single values, not charts.

**Invalid**

```tsx
<SurfaceCard label="Runs"><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Usage"><BarChart data={usage} /></SurfaceCard>
<SurfaceCard label="Runs"><Section kind="list" ariaLabel="Runs" items={runs} empty={null} /></SurfaceCard>
```

**Valid**

```tsx
<Section title="Runs" caption="Last 30 days"><DataTable columns={columns} rows={runs} /></Section>
<Section kind="list" title="Runs" items={runs} empty={null} />
<SurfaceCard label="Runs"><ListBox items={runs} /></SurfaceCard>
<SurfaceCard label="Runs" headers={[{ kind: "search", /* ... */ }]}><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Runs"><Text>3 failed</Text><DataTable columns={columns} rows={runs} /></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
