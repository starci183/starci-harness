# List and table

Contract: [List and Table](../../grammars/contract.md#list). Vendor: [ListBox, Table](../../vendor/heroui.md#table).

## Job
Show several of one kind of thing in a page section, with equal rows the reader can scan and compare
(COLLECTION-1).

## Choose

Choice `list-table.choose.role`: which collection carries the rows. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| contained | an existing surface owns the list's region | unpainted `Section kind="list"` of typed `items`, with its required `empty` state; its title is the list's one heading and accessible name. It draws itself as a nested surface (1px separator border, card radius, clipped), so a hand-made list of blocks divided by `Divider` is never written | R340/R356 forbid another card; lint `starci-grammar/surface-in-surface` |
| task | a standalone bounded set on the page canvas, worked through or scanned as one group, with no search, filter or paging | `SurfaceCard kind="list"`, label outside, `empty` required (`card.choose.role:task-list`) | type: a list needs `items` and `empty` |
| entity | entities with a name, one description line, a few facts and actions, in a list that searches, filters, pages or has no bound | `Section kind="list"` with `items`, `Tabs kind="filter"` in its `filter` slot when the list narrows | `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE` |
| timeline | events in time order | `Timeline`; an entry that needs the reader (a failed step, a pending approval) takes `isAttention` | judgement |
| process | the stages of one process the reader follows (read, index, extract, review) | `Stepper` with its stages; the current stage is marked and a failed stage takes the error state | type: stages are typed data |
| table | records compared across many columns, sorted or bulk-selected | `DataTable`, never in a card (COLLECTION-4): title above as a `Section title`, one `Section caption` below (muted sm 13), and the table draws ONE frame itself (1px separator border, card radius, surface ground, clipped, header row inside; no grey band, no inner white body; `surface="none"` full-bleed inside a `SurfaceCard`); a row that opens its record takes `href`, or `onRowAction` when it opens a drawer (the whole row is the one pressable, with keyboard), a value edited in place takes the column `editor`, a column that may fold on a narrow table is `low` priority; the row title is plain text, never a `Link`, and cells take the row type (md 14 / 500 primary, sm 13 muted secondary) | R351; lint `single-child-card`, `starci-grammar/row-title-link`, `starci-grammar/table-cell-type` |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check | lint `selection-fill-no-check` |

A list's host surface is decided before its scope (COLLECTION-1). `contained` reuses that existing surface with an
unpainted section; `task` owns a standalone card with its label outside; `entity` is a section whose head, filter and
rows stand one row step (12) apart. The selected owner supplies the list's one heading and accessible name. A
`DataTable` is never placed in a `SurfaceCard` (R351); a table enters a card only when the data is truly complex, and the
owner names that case in the rule. Standalone bounded rows use a list card with the note in `footer`. Title, count, filters
and the page command belong to the card's label or the section's head. A row that leads to its record supplies a native
title destination with `href`; `onFollow` can close its owning popover alongside that navigation. Without a destination
there is no `onFollow`. Its commands and menu remain separate targets beside the title, and loading removes the link.

Key figures inside an existing surface use the same unpainted Section owner through `kind="figures"`, as
`card.choose.role:contained-figures` decides. It reuses the card's FigureCells anatomy and loading geometry. A strip
already under a heading uses `ariaLabel` and adds no visible heading; a strip that owns its heading uses `title`.

## Variants
Rows are separated by lines (n-1 lines) or by gap, never both (`DNA-COMMON-LIST-SEAMS`). Rows align their boxes to the content edge of a panel or a pane
(the row box and its selected fill start there; the title inside keeps the vendor item padding). Per-item commands are `neutral` (CTA-6). Unread rows take the contract's unread weight.

## Size
List row leading slots and option rows sit on the ramp ([../scale.md](../scale.md)); row actions take `sm`.
Tables are dense by default; numeric columns align end (FLOW-1); a wide table has one horizontal scroll owner.

## States
Loading shows `budgets.skeletonRows` skeleton rows from the same row the list draws, in the list's own container, with the
resolved row anatomy; empty and failed states are the region's [empty-state](empty-state.md) (STATE-8, FEEDBACK-2, the
[loading table](loading.md)).

## Owner split
- **Grammar owns:** row anatomy and order, description line limit, separators, selection fill, table density,
  skeleton rows, panel alignment (a `ListBox` in a `Pane` resolves the panel inset itself).
- **Knowledge decides:** card or section, which row role, selection style, per-item intent, page size.
- **App author decides:** items, keys, copy, sort and filter facts.

## Rules
COLLECTION-1..4, BOUNDARY-2..3, BOUNDARY-7, FONT-9, OVERFLOW-4, LAYOUT-3. Lint: `single-child-card`, `starci-grammar/surface-in-surface`,
`starci-grammar/row-title-link`, `starci-grammar/table-cell-type`, `starci-fe/selection-fill-no-check`,
`no-list-panel-padding`, `list-item-has-key`, `no-commit-in-collection-item`. Proof: TASTE-3, TASTE-10, UX-5.
