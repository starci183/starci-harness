# List and table

Contract: [List and Table](../../grammars/contract.md#list). Vendor: [ListBox, Table](../../vendor/heroui.md#table).

## Job
Show several of one kind of thing in a page section, with equal rows the reader can scan and compare
(COLLECTION-1).

## Choose

Choice `list-table.choose.role`: which collection carries the rows. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| task | a bounded set the reader works through or scans as one group, with no search, filter or paging: a setup's items, required steps, a rail's choices, the few facts of a first-run step | `SurfaceCard kind="list"`, label outside, `empty` required (`card.choose.role:task-list`) | type: a list needs `items` and `empty` |
| entity | entities with a name, one description line, a few facts and actions, in a list that searches, filters, pages or has no bound | `Section kind="list"` with `items`, a `FilterButtonGroup` in its `filter` slot when the list narrows (ruling `section-is-the-heading`) | `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE` |
| timeline | events in time order | `Timeline`; an entry that needs the reader (a failed step, a pending approval) takes `isAttention` | judgement |
| process | the stages of one process the reader follows (read, index, extract, review) | `Stepper` with its stages; the current stage is marked and a failed stage takes the error state | type: stages are typed data |
| table | records compared across many columns, sorted or bulk-selected | `DataTable`, never in a card, a muted note below; a row that opens its record takes `href`, a value edited in place takes the column `editor`, a column that may fold on a narrow table is `low` priority | R351 |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check | lint `selection-fill-no-check` |

A list is a card by default and a section when it grows (COLLECTION-1). The `task` row is a card with the label outside; the
`entity` row is a section whose title is its heading and whose head, filter and rows stand one section step apart. A
`DataTable` is never placed in a `SurfaceCard` (R351); a table enters a card only when the data is truly complex, and the
owner names that case in the rule. Plain rows with few facts are a list card with the note in `footer`. Title, count, filters
and the page command belong to the card's label or the section's head.

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
COLLECTION-1..3, BOUNDARY-2..3, OVERFLOW-4, LAYOUT-3. Lint: `starci-fe/selection-fill-no-check`,
`no-list-panel-padding`, `list-item-has-key`, `no-commit-in-collection-item`. Proof: TASTE-3, TASTE-10, UX-5.
