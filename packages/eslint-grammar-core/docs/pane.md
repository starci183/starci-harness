# A pane grid holds panes, a pane holds sections

Law module: `pane.ts`. Catalogue: R345 FE_PANE_GRID_CHILD_NOT_PANE, R346 FE_PANE_CHILD_NOT_SECTION, R347 FE_PANE_SECTION_PADDING,
R348 FE_PANE_GRID_FRAME.

`PaneGrid` places each child by the `area` of a `Pane` element and drops the rest. A `Pane` owns its content inset and
publishes it to its `PaneSection` bands (or to one nested `PaneGrid`); a band takes its inline inset from the pane, so a
padding or margin utility on what a band renders adds a second inset beside it. A tabbed app page mounts its grid as
`Page chrome="panes"`, flush under the tab line; a grid in a card or a viewport-fill wrapper re-decides the frame and the
bottom edge that chrome owns.

Every rule below is an error in `coreGrammarConfig`; none can be switched off or suppressed inline. They apply to product
source (the route, feature, component, hook, foundation, module and transport tiers and the workspace packages); a script or
a file no slot owns is not judged. A raw element inside a `Freestyle` subtree is the app's own and is not judged.

Children are read through `cond ? <Pane/> : null`, `cond && <Pane/>`, `items.map(() => <Pane/>)`, arrays and fragments (a
fragment inside a `Pane` is read through; a fragment as a `PaneGrid` child is refused). null, false and `undefined` render
nothing.

## `starci-grammar/pane-grid-children`

A child of `PaneGrid` that is not a literal `Pane` element (a wrapper component, a raw element, a fragment or a variable) is a
finding: its cell renders blank.

**Invalid** (`src/components/blocks/BrainDossiers/component.tsx`)

```tsx
<PaneGrid areas={areas}>
  <CategoryPane area="list" />
  <Pane area="main">…</Pane>
</PaneGrid>
```

**Valid**

```tsx
<PaneGrid areas={areas}>
  <Pane area="list">…</Pane>
  {hasDetail ? <Pane area="detail">…</Pane> : null}
</PaneGrid>
```

**Finding code:** `FE_PANE_GRID_CHILD_NOT_PANE`

## `starci-grammar/pane-children`

A raw element, or a Grammar component other than `PaneSection`, `PaneGrid` and `Freestyle`, placed directly in a `Pane` is a
finding: it skips the inset the pane publishes. A project component is allowed here and judged in its own file.

**Invalid**

```tsx
<Pane area="list">
  <div className="shrink-0 px-4 pt-3 pb-2"><SearchField label={label} /></div>
</Pane>
```

**Valid**

```tsx
<Pane area="list">
  <PaneSection><SearchField label={label} /></PaneSection>
</Pane>
```

**Finding code:** `FE_PANE_CHILD_NOT_SECTION`

## `starci-grammar/no-pane-section-padding`

A padding or margin utility (`p-*`, `px-*`, `py-*`, `ps/pe/pt/pb/pl/pr-*`, `m-*`, `mx/my/ms/me/mt/mb/ml/mr-*`, negative forms,
and the arbitrary `[padding…]` and `[margin…]` properties, under any variant) on the outermost element a `PaneSection` renders
is a finding, and so is one on the root of a component declared in the same file and returned as a section child. Class strings
are read from literals, templates, class builders (`cn`, `clsx`, …), conditionals, same-file constants and, through the type
program, imported constants. Zero and auto values (`p-0`, `mx-auto`) reset or place and inset nothing.

**Invalid**

```tsx
<PaneSection>
  <div className="px-4 py-3"><SearchField label={label} /></div>
</PaneSection>
```

**Valid**

```tsx
<PaneSection gap="section">
  <div className="flex items-center gap-2"><Avatar /><Heading level={2}>{name}</Heading></div>
</PaneSection>
```

**Finding code:** `FE_PANE_SECTION_PADDING`

## `starci-grammar/pane-grid-page`

A `PaneGrid` whose nearest framing element in the file is a `FillViewport`, a `SurfaceCard`, `SurfaceListCard` or
`SurfaceAccordionCard`, a `Page` with another chrome than `panes`, or a `Page chrome="panes"` with an element between them, is
a finding. A grid in a `Pane` is nested and fine; a grid whose frame lives in another file is judged where the frame is.

**Invalid**

```tsx
<FillViewport><PaneGrid areas={areas}>…</PaneGrid></FillViewport>
<SurfaceCard composition="joined"><PaneGrid areas={areas}>…</PaneGrid></SurfaceCard>
```

**Valid**

```tsx
<Page chrome="panes" header={header}><PaneGrid areas={areas}>…</PaneGrid></Page>
```

**Finding code:** `FE_PANE_GRID_FRAME`

Rule ownership: [FE-RULE-OWNERSHIP](../../../contexts/code/fe/README.md#the-placement-test-fe-rule-ownership).
