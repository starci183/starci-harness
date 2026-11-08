# A list of rows inside a surface is a nested surface

Law module: `surface-in-surface.ts`. Knowledge: `knowledge/ui/presentation/grammar-laws.yaml#SURFACE-IN-SURFACE`. Finding code: `FE_SURFACE_IN_SURFACE`.

The Grammar wraps a `Section kind="list"` placed in a card body, a drawer, a dialog, a pane band or a rail as a nested surface (a 1px separator border, the card radius, clipped). A hand-made row list is the bare form.

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
<SurfaceCard label="Runs" kind="list" headers={[{ kind: "filter", /* ... */ }]} items={runs} empty={null} />
```

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
