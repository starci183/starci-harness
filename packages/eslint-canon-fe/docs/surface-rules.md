# Grammar surface composition

Law module: `surface-rules.mjs`. HFS rule: R318. Canon: ANATOMY-2 and PADDING-0.

## `starci-fe/nested-control-variant`

Finding code: `FE_NESTED_VARIANT`. Grammar context supplies field variants on the page background and inside painted surfaces. App code omits every static `variant` on layer-aware fields, including fields rendered by imported or helper components. Named import aliases, namespace imports, static constants and props spreads preserve Grammar ownership. `Tabs` are the underline bar everywhere, their labels text on the content edge, so the pill (`variant="secondary"`) is refused wherever it is set: a pill is a filter's shape, and a filter over a collection is a selectable `TagGroup`.

Invalid:

```tsx
import { SearchField } from "@starci/grammar/core"
const Search = () => <SearchField variant="secondary" />
```

Valid:

```tsx
import { SurfaceCard, SearchField } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><SearchField /></SurfaceCard>
```

## `starci-fe/no-app-surface-paint`

Finding code: `FE_GRAMMAR_LAYOUT_ONLY`. App classes carry layout. A raw `bg-surface` utility paints a surface and is refused, including conditional classes, class builders, responsive variants, important modifiers and opacity suffixes. Compose a painted Grammar surface such as `SurfaceCard`. Static props spreads keep the same obligations. Typed app lint follows imported colocated class declarations as well as local constants.

## `starci-fe/no-list-panel-padding`

Finding code: `FE_LIST_PANEL_PADDING`. Within the nearest painted Grammar surface (`Pane` and `PaneSection` included), a wrapper around `ListBox` or its section caption cannot add horizontal padding through `p-*`, `px-*`, `ps-*`, `pe-*`, `pl-*`, `pr-*` or arbitrary `padding-inline` properties. These insets add to the list's own padding. Page gutters outside that surface and lists outside any surface retain their layout padding. Unpainted containers such as `Rail` pass the parent context through.

Invalid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <SurfaceCard><div className="pl-2"><ListBox label="Members" items={members} /></div></SurfaceCard>
```

Valid:

```tsx
import { SurfaceCard, ListBox } from "@starci/grammar/core"
const Panel = () => <div className="px-4"><SurfaceCard><ListBox inset="panel" label="Members" items={members} /></SurfaceCard></div>
```

## `starci-fe/no-hand-built-panes`

Finding code: `FE_HAND_BUILT_PANES`. A multi-pane frame is a `PaneGrid` of `Pane`s, which draws the dividers between panes, sizes the columns and collapses a side pane below medium. A vertical `Divider` used as a column seam is a pane frame drawn by hand: a vertical `Divider` (or the plain wrapper element that holds only it) standing among plain column elements (`div`, `aside`, `Region`) of a flex row, or a vertical `Divider` anywhere inside a `SurfaceCard composition="joined"`; and a joined card that holds a plain flex row of two or more columns as one of its own children. `joined` stacks bands divided by horizontal separators. A short vertical separator between controls of a toolbar, a `flex-col` stack, and a row whose classes cannot be read in the file are not judged. Typed app lint follows imported colocated class declarations.

Invalid:

```tsx
import { Divider, SurfaceCard } from "@starci/grammar/core"
const Frame = () => (
  <SurfaceCard composition="joined" height="fill">
    <div className="flex h-full">
      <div className="w-72">{rail}</div>
      <div className="flex"><Divider orientation="vertical" /></div>
      <div className="flex-1">{body}</div>
    </div>
  </SurfaceCard>
)
```

Valid:

```tsx
import { Page, Pane, PaneGrid, PaneSection } from "@starci/grammar/core"
const Frame = () => (
  <Page chrome="panes" header={header}>
    <PaneGrid areas={areas}>
      <Pane area="rail"><PaneSection>{rail}</PaneSection></Pane>
      <Pane area="main"><PaneSection>{body}</PaneSection></Pane>
    </PaneGrid>
  </Page>
)
```
