# The one card has a kind

Law module: `surface-card.ts`. Catalogue: R355 FE_SURFACE_CARD_KIND, R366 FE_LABEL_IN_GRID.

`SurfaceCard` is one component whose `kind` the compiler checks: `body` (the default), `figures`, `list`, `accordion`
and `tile`; any kind may carry typed `headers` and `footers` zones. What a kind draws is not drawn by hand around it, and where the name sits follows the kind: a card that heads a section has a `label` outside the material, a tile names itself inside.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to product
source; a script or a file no slot owns is not judged.

## `starci-grammar/surface-card-kind`

Finding code: `FE_SURFACE_CARD_KIND` (R355). The direct children of a `SurfaceCard` of the `body` kind (no `kind`, or
`kind="body"`) are not a raw `ul`, `ol`, `li` or `dl`, not a `Divider`, and not a `SectionHeader` or `Heading` standing as a
second title. A `Section` whose only child is one `SurfaceCard` frames one subject twice. Children are read through
`cond && <x/>`, `cond ? <x/> : <y/>` and `.map`.
On a `SurfaceCard` or a `Board`, the `children` of a `{ kind: "custom" }` zone written in a `headers` or `footers` array literal hold no
`Tabs`, `SearchField` or `Divider` (`zone`): filter and search are the typed `filter`, `search` and `toolbar` zones and the card draws
its own seams. Grammar also refuses them at run time in development.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Runs">
  <ul>{runs.map((run) => <li key={run.id}>{run.name}</li>)}</ul>
  <Divider />
  <SectionHeader title="Totals" />
</SurfaceCard>
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard kind="list" label="Runs" items={runs.map((run) => ({ id: run.id, title: run.name }))} empty={empty} />
```

## `starci-grammar/no-label-in-grid`

Finding code: `FE_LABEL_IN_GRID` (R366). A `SurfaceCard` with a `label` repeated in a `Grid kind="cards"` (two or more as
direct children, or one written in a `.map`) is refused. A peer you recognise and open is a tile, named inside beside its
mark; comparing a fact across peers is one `kind="list"` card.

**Invalid** (`src/components/blocks/Connectors/component.tsx`)

```tsx
<Grid kind="cards">
  {connectors.map((c) => <SurfaceCard key={c.id} label={c.name}>{c.summary}</SurfaceCard>)}
</Grid>
```

**Valid** (`src/components/blocks/Connectors/component.tsx`)

```tsx
<Grid kind="cards">
  {connectors.map((c) => <SurfaceCard key={c.id} kind="tile" name={c.name} mark={{ icon: c.icon }} description={c.summary} />)}
</Grid>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
