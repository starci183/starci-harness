# A surface never stands inside another surface

Law module: `surface-depth.ts`. Catalogue: R340 FE_RAISED_SURFACE_IN_SURFACE.

A `SurfaceCard` inside another `SurfaceCard` is refused: a card never sits in a card. A white `Pane surface`, `Drawer`, `Dialog`, `AlertDialog` or `Popover` may hold an object card, drawn as everywhere: a 1px `--border` edge and no shadow (BOUNDARY-6). Development throws the card-in-card refusal from the Grammar itself; this rule is its same-file half and R356 closes it across files.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to product
source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages); a script or
a file no slot owns is not judged.

## `starci-grammar/no-raised-surface-in-surface`

A `SurfaceCard` (or `<ns>.SurfaceCard`) imported from `@starci/grammar` that another `SurfaceCard` of the same file encloses is a finding. A card no element of the file encloses is judged where its parent is written. The fix gives the content to the outer card's own body; a list, a table or figures inside it stand flat in a `Section` (`Section kind="list"`, `Section kind="figures"`).

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Run">
  <SurfaceCard label="Steps">...</SurfaceCard>
</SurfaceCard>
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Run">
  <Text>{summary}</Text>
  <Section kind="list" ariaLabel="Steps" items={steps} empty={empty} />
</SurfaceCard>
```

**Finding code:** `FE_RAISED_SURFACE_IN_SURFACE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
