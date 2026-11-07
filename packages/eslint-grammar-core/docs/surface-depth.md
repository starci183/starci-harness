# A surface never stands inside another surface

Law module: `surface-depth.ts`. Catalogue: R340 FE_RAISED_SURFACE_IN_SURFACE.

The Grammar draws one depth, raised, and no nested edge: a `SurfaceCard` inside another `SurfaceCard`, inside a
`Pane surface`, or inside a `Dialog`, `Drawer`, `AlertDialog` or `Popover` is refused: a surface
never sits in a surface, dialogs and drawers included. Development throws the same refusal from the Grammar itself; this rule is
its same-file half and R356 closes it across files.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to product
source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages); a script or
a file no slot owns is not judged.

## `starci-grammar/no-raised-surface-in-surface`

A `SurfaceCard` (or `<ns>.SurfaceCard`) imported from `@starci/grammar` that a `SurfaceCard`, `Dialog`, `Drawer`,
`AlertDialog`, `Popover`, or a `Pane` with a `surface` prop of the same file encloses is a finding. An overlay's `trigger` is
not its content, so a card written in a trigger is not enclosed by it. A surface no element of the file encloses is judged
where its parent is written. The fix gives the content to the host's own body, or uses a kind of the outer card (`bands`,
`list`, `figures`) for what needs its own faces.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Run">
  <SurfaceCard label="Steps">...</SurfaceCard>
</SurfaceCard>
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard
  kind="bands"
  label="Run"
  bands={[{ kind: "body", children: summary }, { kind: "list", items: steps, empty }]}
/>
```

**Finding code:** `FE_RAISED_SURFACE_IN_SURFACE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
