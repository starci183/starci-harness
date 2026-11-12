# A lone DataTable or chart is the surface; a list card is always valid

Law module: `single-child-card.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SINGLE-CHILD-CARD`. Finding code: `FE_SINGLE_CHILD_CARD`.

A card (`SurfaceCard`) groups two or more different parts (figures + list + actions), or carries zones (tabs, search, head actions). A card of LIST or key-value rows (`kind="list"`, `kind="table"`, `kind="select"`, a `ListBox`, `DisclosureList`, `Timeline`, `Section kind="list"`, a `DescriptionList`) is valid alone or not (aligned in 0.37.8: one list card with its head and count chip, or a bordered key-value card on a white aside, is the law). A standalone `DataTable` (`surface="card"`) or chart IS the surface: its title sits above it as a `Section` head and one line under it as `Section caption`, so a card around it is a second card.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/single-child-card`

A Grammar `SurfaceCard` is refused when it has no zones (no `headers` or `footers` prop, an empty array counts as none, and no `labelEnd`) and its only body child (looked through fragments, `cond && x`, `cond ? x : y` and `.map`; blank text ignored) is:

- table: `DataTable`
- chart: `BarChart`, `ProportionBar`, `BubbleMap`, `FlowGraph`, `MermaidDiagram`

Not flagged: any list or key-value card (`kind="list"`, `kind="table"`, `kind="select"`, `ListBox`, `DisclosureList`, `Timeline`, `Section kind="list"`, `DescriptionList`), a card with two or more body children, a card with zones or `labelEnd`, a card with a JSX spread, `kind` `figures`, `details`, `accordion` or `tile`, a non-Grammar `SurfaceCard`, and non-product source. `Meter` and `Progress` are single values, not charts.

**Invalid**

```tsx
<SurfaceCard label="Runs"><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Usage"><BarChart data={usage} /></SurfaceCard>
```

**Valid**

```tsx
<Section title="Runs" caption="Last 30 days"><DataTable columns={columns} rows={runs} /></Section>
<SurfaceCard label="Runs" kind="list" items={runs} empty={null} />
<SurfaceCard label="Runs"><ListBox items={runs} /></SurfaceCard>
<SurfaceCard label="Runs" headers={[{ kind: "search", /* ... */ }]}><DataTable columns={columns} rows={runs} /></SurfaceCard>
<SurfaceCard label="Runs"><Text>3 failed</Text><DataTable columns={columns} rows={runs} /></SurfaceCard>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
