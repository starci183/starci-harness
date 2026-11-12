# A surface never stands inside another surface

Law module: `surface-depth.ts`. Catalogue: R340 FE_RAISED_SURFACE_IN_SURFACE.

A `SurfaceCard` inside another `SurfaceCard` is refused (0.37.5): a card never sits in a card. A white `Pane surface`, `Drawer`, `Dialog`, `AlertDialog` or `Popover` HOSTS cards: on a white ground a card is the group and draws a 1px border with no shadow (SURFACE-ELEVATION); on the pink well it has the shadow and no border. Development throws the card-in-card refusal from the Grammar itself; this rule is its same-file half and R356 closes it across files.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to product
source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages); a script or
a file no slot owns is not judged.

## `starci-grammar/no-raised-surface-in-surface`

A `SurfaceCard` (or `<ns>.SurfaceCard`) imported from `@starci/grammar` that another `SurfaceCard` of the same file encloses is a finding. A card no element of the file encloses is judged where its parent is written. The fix gives the content to the outer card's own body, or uses a kind of the outer card (`bands`, `list`, `figures`) for what needs its own faces.

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
