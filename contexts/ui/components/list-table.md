# List and table

Contract: [List and Table](../../grammars/contract.md#list). Vendor: [ListBox, Table](../../vendor/heroui.md#table).

## Job
Show several of one kind of thing in a page section, with equal rows the reader can scan and compare
(COLLECTION-1).

## Choose

Choice `list-table.choose.role`: which collection carries the rows. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| list | rows of peers, wherever they stand (an existing surface, the page canvas), bounded or searched, filtered or paged: entities with a name, one description line, a few facts and actions | `Section kind="list"` of typed `items` (`ListRow`), with its required `empty` state and `Tabs kind="filter"` in its `filter` slot when the list narrows; its title is the list's one heading and accessible name. It draws the one look of BOUNDARY-7 by itself (flat rows, hairlines, aligned with the title), so a hand-made list of blocks divided by `Divider` is never written, and it is never a card | type: a list needs `items` and `empty`; lint `starci-grammar/surface-card-list`, `starci-grammar/surface-in-surface`; `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE`, `DNA-COMMON-LIST-ONE-LOOK` |
| catalog | several lists or groups narrowed by one toolbar (filter tabs, a search, its selects) | a `Section` (kind `region`) whose `filter` slot holds the toolbar, a flat row between its head and the groups, and the groups as its children; never a rowless card borrowed for its `filter`, `search` or `toolbar` zones (a toolbar is a row on the surface, not a card). When the page title already names the catalog, the region is headless: `ariaLabel` in place of `title` (0.43.1), never a second visible title that repeats the page | type: `filter` on a region or a list section; a region takes `title` or `ariaLabel`, never both; story `Surfaces/Section filter row (0.43.1)` |
| timeline | events in time order | `Timeline`; an entry that needs the reader (a failed step, a pending approval) takes `isAttention` | judgement |
| process | the stages of one process the reader follows (read, index, extract, review) | `Stepper` with its stages; the current stage is marked and a failed stage takes the error state | type: stages are typed data |
| table | records compared across many columns, sorted or bulk-selected | `DataTable`, never in a card (COLLECTION-4): title above as a `Section title`, one `Section caption` below (muted 14), and the table is flat (`surface="none"`, the default): a collection, never a card of its own, it stands on whatever holds it with the column labels (12, muted), 1px full-width row dividers, no fill, radius, shadow or edge, and, when paginated, the `footer` slot under the last row behind a full-width line (`Pagination` with its `summary` "1-4 of 8 results": summary at the start, pages at the end); no wrapper card, no border; columns right-align numbers by `align="end"` or `isNumeric`; `surface="card"` only for an app that wants the table as its own white card, `surface="frame"` inside a `SurfaceCard kind="table"`; a row that opens its record takes `href` (a real link in the table and in the phone list: middle-click, new tab, Enter, focus ring, router navigation; 0.39.4), or `onRowAction` when it opens a drawer (the whole row is the one pressable, with keyboard), a value edited in place takes the column `editor`, a column that may fold on a narrow table is `low` priority; column sizing (0.37.3): `width` `"fill"` (the rest, with `minWidth`, `truncate` = one line + ellipsis + tooltip) / `"fit"` (its content, never wraps; a cell of buttons keeps them on one line and its column sizes to them, 0.42.0) / px, `hideBelow` `"tablet"|"desktop"`, table `resizable` (drag, remembered per `id` in localStorage) and `phone` (`list` under 768 by default from three columns: the first column the title, the rest one muted line); by default the first text column fills and numeric ones fit; the row title is plain text, never a `Link`, and cells take the row type (14 / 500 primary, 14 muted secondary, 12 for a small name; the header 14 / 500 muted, cells 14 / 400, the row header 14 / 500) | R351; `check:type`; lint `single-child-card`, `starci-grammar/row-title-link`, `starci-grammar/table-cell-type` |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check; a list whose items go somewhere (a Data nav, mail rows) is `selectionMode="none"` with an `href` on each item, a real link (0.39.4): an item is either selectable or a link | lint `selection-fill-no-check` |

A list is one `Section kind="list"` wherever it stands (COLLECTION-1): its head, filter and rows stand one row step (12)
apart, and it supplies the list's one heading and accessible name. A
`DataTable` is never placed in a `SurfaceCard` (R351); a table enters a card only when the data is truly complex, and the
owner names that case in the rule. A list's note is its `caption`. Title, count, filters
and the page command belong to the card's label or the section's head. A row that leads to its record supplies a native
title destination with `href`; `onFollow` can close its owning popover alongside that navigation. Without a destination
there is no `onFollow`. Its commands and menu remain separate targets beside the title, and loading removes the link.

A pressable row (`ListRow`, a `Section kind="list"` row or a `Board` item, with `onPress` or `href` and no own `action`, `menu` or `control`) ends in a muted decorative `chevron-end` (mirrored in RTL), after its fact and badges; a row that is not pressable, or that has its own action, menu or control, draws none.

Key figures inside an existing surface use the same unpainted Section owner through `kind="figures"`, as
`card.choose.role:contained-figures` decides. It reuses the card's FigureCells anatomy and loading geometry. A strip
already under a heading uses `ariaLabel` and adds no visible heading; a strip that owns its heading uses `title`.

## Filter row (0.43.1, narrow step 0.44.0)
A section's `filter`, a list's or a region's, is ONE flat row in the order given: `Tabs kind="filter"`, then the `SearchField`, then its
`Select`s, the controls on one bottom edge at the inline gap. The tabs hug their labels, the search grows into what is left (never under
12rem), each select keeps its own width; a peer that no longer fits wraps to the next line. Below 48rem of the row's own width the tabs and
the search each take a full line, and the selects follow by their look: a `compact` or `pill` select keeps its content width and shares a
wrapping line with the next one, a `field` select takes a full line. A filter row's selects are `compact`. The row lays the peers out itself,
so an app wraps them in no `Cluster` or `Grid` and gives them no width. The `filter` row is where a `Tabs kind="filter"` stands in a page
or pane body (lint `starci-grammar/tabs-in-well` passes it there). Story `Surfaces/Section filter row (0.43.1)` (its play tests measure
one row at 1440 and the narrow step at 390, compact and field selects).

## Section head (0.36.0)
A `Section` head is ONE row: the label (14, 500) and an optional count chip (12) at the start; at the end at most ONE thing, a navigation `Link variant="head"` (the label then an arrow `→` that slides about 3px on hover, the hover underline,
the inherited size; distinct from the inline `↗` Link), an info `IconButton` or (0.37.25) a text `Button intent="neutral" size="sm"` with no icon ("Gắn thêm provider" at the end of "Provider đã gắn  2"; never the commit). No description under the label: `description` is drawn as a caption (12, muted) below the card or list, with `caption`. Lint `starci-grammar/section-head-action`
refuses any other `Button` (a commit, another size, an icon) in the head action and more than one command.

## Version diff rows (0.37.28)
A row of a version diff sets `ListRowData.diff` (`"added"`, `"removed"`, `"changed"`): a monospace gutter mark at the row's start (`+`, `−`, `~`) in the tone's ink, the row's
ground in the tone's soft pair (success, danger, warning; the danger pair here is the diff tone, not a call to action), a removed title struck through, and for a changed
row `change: { from, to }` drawn as the 12 muted line "from → to". The glyph and its label (`diffLabel`, the app's word: "Thêm", "Bỏ", "Đổi") carry the meaning, never the
colour alone. Plain rows stay in the same list. Works in `Section kind="list"`; the row padding holds. Law `DNA-COMMON-LIST-ROW-DIFF`.

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

## Row description
`ListRowData.description` is a string (the muted description) or a node: inline text with 16px marks ("@chatbot · [logo] Email · [logo] Chat"). A node is drawn at 12,
muted, on one line directly under the name at the identity gap (not a row step below).

## Rules
COLLECTION-1..4, BOUNDARY-2..3, BOUNDARY-7, FONT-9, OVERFLOW-4, LAYOUT-3. Lint: `single-child-card`, `starci-grammar/surface-in-surface`,
`starci-grammar/row-title-link`, `starci-grammar/table-cell-type`, `starci-fe/selection-fill-no-check`,
`no-list-panel-padding`, `list-item-has-key`, `no-commit-in-collection-item`. Proof: TASTE-3, TASTE-10, UX-5.

`DataTable fill` (0.37.3) makes the table fill the height its host gives it (a `Section fill` cell of a stretched `Grid`): the white body grows to the card's foot and the footer sticks to the bottom. The section head is a fixed 2rem row, nowrap, the label truncating first.

## Key-value rows (0.37.5)
`Section kind="list" layout="keyValue"`: each row's `title` is the key (muted, 14, at the start) and `value` is the content (normal text, 14, at the end). From 28rem a row is two columns (the key at most 40%); under 22rem the value wraps under the key. Use it for facts about one thing (order details, a customer), never title + subtitle for facts. In a `rows` list the same `value` is the row's fact between the copy and the end group: value, `badges` and an end `action` stand on one line, centred against the copy, with the row padding to the edge (0.37.36). Header-zone seams use `--starci-core-zone-seam` (foreground 14% over the ground), readable on white and on the grey table frame.
