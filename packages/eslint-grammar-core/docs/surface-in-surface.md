# A list of rows inside a surface is the Grammar list

Law module: `surface-in-surface.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SURFACE-IN-SURFACE`. Finding code: `FE_SURFACE_IN_SURFACE`.

Rows inside a drawer, a dialog, a pane band or a rail are a `Section kind="list"`, drawn as everywhere else: flat rows divided by hairlines, aligned with the title (LIST-ONE-LOOK). A hand-made row list is the bare form.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline.

## `starci-grammar/surface-in-surface`

A Grammar `Stack`, or a `ul`, `ol` or `div`, whose rendered children include a Grammar `Divider` between other children, inside a `SurfaceCard`, `Drawer`, `Dialog`, `PaneSection` or the `rail` of a `Grid kind="main-rail"`, is refused. A card inside a card is `no-raised-surface-in-surface` and a `Divider` directly in a `body` card is `surface-card-kind`; neither is read again.

**Invalid**

```tsx
<Drawer title="Runs">
  <Stack gap="row">{runs.map((run) => <Fragment key={run.id}><Cluster gap="inline">...</Cluster><Divider /></Fragment>)}</Stack>
</Drawer>
```

**Valid**

```tsx
<Drawer title="Runs"><Section kind="list" items={runs} /></Drawer>
<Stack><Section kind="figures" ariaLabel="Totals" items={totals} /><Section kind="list" title="Runs" items={runs} empty={null} /></Stack>
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
