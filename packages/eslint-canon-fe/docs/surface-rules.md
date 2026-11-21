# Grammar surface composition

Law module: `surface-rules.mjs`. HFS rule: R318. Canon: ANATOMY-2 and PADDING-0.

## `starci-fe/no-app-surface-paint`

Finding code: `FE_GRAMMAR_LAYOUT_ONLY`. App classes carry layout. A raw `bg-surface` utility paints a surface and is refused, including conditional classes, class builders, responsive variants, important modifiers and opacity suffixes. Compose a painted Grammar surface such as `SurfaceCard`. Static props spreads keep the same obligations. The typed lint of an app follows imported colocated class declarations as well as local constants.

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

Finding code: `FE_HAND_BUILT_PANES`. A multi-pane frame is a `PaneGrid` of `Pane`s, which draws the dividers between panes, sizes the columns and collapses a side pane below medium. A vertical `Divider` used as a column seam is a pane frame drawn by hand: a vertical `Divider` (or the plain wrapper element that holds only it) standing among plain column elements (`div`, `aside`, `Region`) of a flex row, or a vertical `Divider` anywhere inside a `SurfaceCard composition="joined"`; and a joined card that holds a plain flex row of two or more columns as one of its own children. `joined` stacks bands divided by horizontal separators. A short vertical separator between controls of a toolbar, a `flex-col` stack, and a row whose classes cannot be read in the file are not judged. The typed lint of an app follows imported colocated class declarations.

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

## `starci-fe/no-table-in-card`

Finding code: `FE_TABLE_IN_CARD` (R351). A `DataTable` is not placed in a `SurfaceCard`. Plain rows with a few facts are a `Section kind="list"` with its `title` on the section and the note as its `caption`, and no card around it; a table is a `Section` holding a `DataTable` (title and count on the section, `footer={<Pagination />}` on the table), with no card around it. The rule reads the file: a Grammar `DataTable` enclosed by a Grammar `SurfaceCard` element is a finding, and so is a `DataTable` rendered by a component of the same file (a declaration, a variable's function, a `memo` or `forwardRef` wrapper, followed through other components of the file) that a `SurfaceCard` encloses. A card in another file that renders a table component is judged where the card is written. There is no inline exemption.

Invalid:

```tsx
import { SurfaceCard, DataTable } from "@starci/grammar/core"
const Rules = () => (
  <SurfaceCard label="Rules" headingLevel={2}>
    <Text>{description}</Text>
    <DataTable label="Rules" columns={columns} rows={rows} renderCell={renderCell} emptyContent={null} />
    <Text>{footnote}</Text>
  </SurfaceCard>
)
```

Valid:

```tsx
import { Section } from "@starci/grammar/core"
const Rules = () => (
  <Section
    kind="list"
    title="Rules"
    caption={footnote}
    items={rules.map((rule) => ({ id: rule.id, title: rule.title, description: rule.summary }))}
    empty={<EmptyNotice message="No rules." />}
  />
)
```

A table is a `Section` holding a `DataTable`:

```tsx
import { DataTable, Section } from "@starci/grammar/core"
const Rules = () => (
  <Section title="Rules" count={rows.length}>
    <DataTable label="Rules" columns={columns} rows={rows} renderCell={renderCell} emptyContent={null} />
  </Section>
)
```

## `starci-fe/no-fill-command-in-header`

Finding code: `FE_COMMAND_FILLS_HEADER` (R352). A page or pane command hugs its label and sits at the end of its header row: a Grammar `Button` with `width="fill"` written in the `actions` of a `PageHeader` or in the `labelEnd` of a `SurfaceCard` or the `action` of a `Section` is refused. `width="fill"` is for a form submit, an auth panel and a phone action bar (`PinnedActionBar`); the rule judges the header slots only, since a form, an auth panel and a phone action bar are not decidable from the file.

Invalid:

```tsx
import { PageHeader, Button } from "@starci/grammar/core"
const Head = () => <PageHeader title="Agents" actions={<Button intent="commit" width="fill">Add agent</Button>} />
```

Valid:

```tsx
import { PageHeader, Button } from "@starci/grammar/core"
const Head = () => <PageHeader title="Agents" actions={<Button intent="commit">Add agent</Button>} />
```

## `starci-fe/no-heading-above-card`

Finding code: `FE_HEADING_ABOVE_CARD` (R354). A card carries its own label, so a heading over it is wrong. A Grammar `Section` (not `kind="list"`) whose only child is one `SurfaceCard` is refused, and so is a card whose `ariaLabel` is the `Section`'s `title`. Several cards under one `Section` stay legal, and a `Section` holding anything else is not judged. The fix moves the title to the card's `label`, the count to `fact`, the action to `labelEnd`; a note is the card's `note`.

Invalid:

```tsx
import { Section, SurfaceCard } from "@starci/grammar/core"
const Rules = () => (
  <Section title="Rules" count={3} action={add}>
    <SurfaceCard ariaLabel="Rules">{rules}</SurfaceCard>
  </Section>
)
```

Valid:

```tsx
import { SurfaceCard } from "@starci/grammar/core"
const Rules = () => <SurfaceCard label="Rules" fact="3" labelEnd={add} note={note}>{rules}</SurfaceCard>
```

