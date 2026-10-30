# A nested surface stays subordinate

Law module: `surface-depth.ts`. Catalogue: R340 FE_RAISED_SURFACE_IN_SURFACE.

Grammar's bounded surfaces (`SurfaceCard`, `SurfaceAccordionCard`, `SurfaceListCard`) read their depth from the surface
context: raised at the top of a page (BOUNDARY-6), outlined inside another surface (BOUNDARY-5), so two raised surfaces never
stack (`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`). `SurfaceListCard` also takes a `depth` prop that overrides the context;
forcing `depth="top"` on a list that sits inside another surface raises a surface inside a surface.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. It applies to product
source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages); a script or
a file no slot owns is not judged.

## `starci-grammar/no-raised-surface-in-surface`

A `depth` attribute whose value is statically the string `"top"` (a literal, an expression container holding one, or a
template literal without expressions) on a depth-accepting surface element (today `SurfaceListCard`, or `<ns>.SurfaceListCard`)
is a finding when a `SurfaceCard`, `SurfaceListCard` or `SurfaceAccordionCard` element of the same file encloses it. A depth
computed at run time, `depth="nested"`, and a surface no element of the file encloses are not judged. The fix is to drop
`depth` and let the Grammar resolve it from the surface context.

**Invalid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Run">
  <SurfaceListCard label="Steps" depth="top" items={steps} />
</SurfaceCard>
```

**Valid** (`src/components/blocks/Runs/component.tsx`)

```tsx
<SurfaceCard label="Run">
  <SurfaceListCard label="Steps" items={steps} />
</SurfaceCard>
```

**Finding code:** `FE_RAISED_SURFACE_IN_SURFACE`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
