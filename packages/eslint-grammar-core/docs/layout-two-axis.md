# Layout, one axis

Law module: `layout-two-axis.ts`. Finding code: `FE_LAYOUT_TWO_AXIS`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#LAYOUT-TWO-AXIS`.

A report page (`Page` standard: the pink well) stacks its card surfaces in ONE direction, a vertical column 24 apart. Cards stand side by side only as siblings of the same role and height (figure cells, short equal cards). A page with a persistent selection or navigation column, or a full-height chat or editor, is a workspace page (`Page chrome="panes"`): a grid of panes split by dividers whose side panes are white surfaces at full height, never cards. The page's `chrome` is the layout declaration, so one page has one frame type.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/layout-two-axis`

A Grammar `Grid` or `Cluster` is a finding when its rendered children are:

- a `SurfaceCard` together with a `Stack` that holds two or more `SurfaceCard`s (message `beside`): two axes in one well;
- two or more `SurfaceCard`s of different `kind` (an absent `kind` is `body`; message `unequal`): different roles are different heights.

`Grid kind="main-rail"`, a card with a JSX spread, a card repeated by `.map` and a `Stack` of cards on its own are not judged.

**Invalid**

```tsx
<Grid><SurfaceCard label="Runs" /><Stack><SurfaceCard label="A" /><SurfaceCard label="B" /></Stack></Grid>
<Cluster><SurfaceCard kind="figures" /><SurfaceCard kind="details" /></Cluster>
```

**Valid**

```tsx
<Stack gap="section"><SurfaceCard kind="figures" /><SurfaceCard label="Runs">...</SurfaceCard></Stack>
<Cluster><SurfaceCard kind="figures" /><SurfaceCard kind="figures" /></Cluster>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
