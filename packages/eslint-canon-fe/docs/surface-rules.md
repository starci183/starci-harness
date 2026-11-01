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

## `starci-fe/no-table-in-card`

Finding code: `FE_TABLE_IN_CARD` (R351). A `DataTable` is not placed in a `SurfaceCard`. Plain rows with a few facts are a `SurfaceListCard` of `ListRow` with the label outside and the note in its `footer`; a table that compares records across many columns sits in its section with no card around it. The rule reads the file: a Grammar `DataTable` enclosed by a Grammar `SurfaceCard` element is a finding, and so is a `DataTable` rendered by a component of the same file (a declaration, a variable's function, a `memo` or `forwardRef` wrapper, followed through other components of the file) that a `SurfaceCard` encloses. A card in another file that renders a table component is judged where the card is written. There is no inline exemption; a table the owner rules complex enough to sit in a card is named in this rule.

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
import { SurfaceListCard, ListRow } from "@starci/grammar/core"
const Rules = () => (
  <SurfaceListCard label="Rules" footer={footnote}>
    {rules.map((rule) => <ListRow key={rule.id} title={rule.title} description={rule.summary} />)}
  </SurfaceListCard>
)
```

## `starci-fe/no-fill-command-in-header`

Finding code: `FE_COMMAND_FILLS_HEADER` (R352). A page or pane command hugs its label and sits at the end of its header row: a Grammar `Button` with `width="fill"` written in the `actions` of a `PageHeader` or in the `labelEnd` of a `SurfaceCard` or `SurfaceListCard` is refused. `width="fill"` is for a form submit, an auth panel and a phone action bar (`PinnedActionBar`); the rule judges the header slots only, since a form, an auth panel and a phone action bar are not decidable from the file.

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

## `starci-fe/no-selectable-tag-group`

Finding code: `FE_TAG_GROUP_SELECTION` (R353). A Grammar `TagGroup` holds values the user entered, to remove or to order, and has no selection: `selectionMode`, `selectedIds`, `defaultSelectedIds` and `onSelectionChange` on it are refused. Peer values that filter a collection that stays in place are a `FilterButtonGroup`.

Invalid:

```tsx
import { TagGroup } from "@starci/grammar/core"
const Filter = () => <TagGroup label="Team" items={items} selectionMode="single" selectedIds={[team]} onSelectionChange={pick} />
```

Valid:

```tsx
import { FilterButtonGroup } from "@starci/grammar/core"
const Filter = () => <FilterButtonGroup label="Team" options={options} value={team} onValueChange={pick} />
```

## `starci-fe/no-heading-above-card`

Finding code: `FE_HEADING_ABOVE_CARD` (R354). A card has a label by design (ruling `card-carries-its-own-label`), so a hand heading above it is wrong. A Grammar `SectionHeader` directly followed, in the same parent, by one `SurfaceCard`, `SurfaceListCard` or `SurfaceAccordionCard` is refused, and so is a card whose `ariaLabel` is the header's `title`. Several cards under one header stay legal, and a header followed by anything else is not judged. The fix moves the title to the card's `label`, the count to `fact`, the action to `labelEnd` and the note to `footer`.

Invalid:

```tsx
import { SectionHeader, SurfaceListCard } from "@starci/grammar/core"
const Rules = () => (
  <section>
    <SectionHeader title="Rules" count={3} action={add} />
    <SurfaceListCard ariaLabel="Rules">{rows}</SurfaceListCard>
  </section>
)
```

Valid:

```tsx
import { SurfaceListCard } from "@starci/grammar/core"
const Rules = () => <SurfaceListCard label="Rules" fact="3" labelEnd={add} footer={note}>{rows}</SurfaceListCard>
```

