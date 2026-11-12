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
| table | records compared across many columns, sorted or bulk-selected | `DataTable`, never in a card (COLLECTION-4): title above as a `Section title`, one `Section caption` below (muted 14), and the table IS the card and looks like a list card (0.37.8, replacing the 0.36.0 grey frame): a white body, no grey frame, gutters or header strip, the column labels (12, muted) on the white, 1px full-width row dividers, the card radius, the shadow on the pink well and a 1px border on a white surface, and, when paginated, the `footer` slot under the last row behind a full-width line (`Pagination` with its `summary` "1-4 of 8 results": summary at the start, pages at the end); no wrapper card, no border; columns right-align numbers by `align="end"` or `isNumeric`; `surface="none"` full-bleed inside a `SurfaceCard`; a row that opens its record takes `href`, or `onRowAction` when it opens a drawer (the whole row is the one pressable, with keyboard), a value edited in place takes the column `editor`, a column that may fold on a narrow table is `low` priority; column sizing (0.37.3): `width` `"fill"` (the rest, with `minWidth`, `truncate` = one line + ellipsis + tooltip) / `"fit"` (its content, never wraps) / px, `hideBelow` `"tablet"|"desktop"`, table `resizable` (drag, remembered per `id` in localStorage) and `phone` (`list` under 768 by default from three columns: the first column the title, the rest one muted line); by default the first text column fills and numeric ones fit; the row title is plain text, never a `Link`, and cells take the row type (14 / 500 primary, 14 muted secondary, 12 for a small name; the header 14 / 500 muted, cells 14 / 400, the row header 14 / 500) | R351; `check:type`; lint `single-child-card`, `starci-grammar/row-title-link`, `starci-grammar/table-cell-type` |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check | lint `selection-fill-no-check` |

A list's host surface is decided before its scope (COLLECTION-1). `contained` reuses that existing surface with an
unpainted section; `task` owns a standalone card with its label outside; `entity` is a section whose head, filter and
rows stand one row step (12) apart. The selected owner supplies the list's one heading and accessible name. A
`DataTable` is never placed in a `SurfaceCard` (R351); a table enters a card only when the data is truly complex, and the
owner names that case in the rule. Standalone bounded rows use a list card with the note in `footer`. Title, count, filters
and the page command belong to the card's label or the section's head. A row that leads to its record supplies a native
title destination with `href`; `onFollow` can close its owning popover alongside that navigation. Without a destination
there is no `onFollow`. Its commands and menu remain separate targets beside the title, and loading removes the link.

A pressable row (`ListRow`, `Section kind="list"` or `SurfaceCard kind="list"` with `onPress` or `href` and no own `action`, `menu` or `control`) ends in a muted decorative `chevron-end` (mirrored in RTL), after its fact and badges; a row that is not pressable, or that has its own action, menu or control, draws none.

Key figures inside an existing surface use the same unpainted Section owner through `kind="figures"`, as
`card.choose.role:contained-figures` decides. It reuses the card's FigureCells anatomy and loading geometry. A strip
already under a heading uses `ariaLabel` and adds no visible heading; a strip that owns its heading uses `title`.

## Section head (0.36.0)
A `Section` head is ONE row: the label (14, 500) and an optional count chip (12) at the start; at the end at most ONE thing, a navigation `Link variant="head"` (the label then an arrow `→` that slides about 3px on hover, the hover underline,
the inherited size; distinct from the inline `↗` Link), an info `IconButton` or (0.37.25) a text `Button intent="neutral" size="sm"` with no icon ("Gắn thêm provider" at the end of "Provider đã gắn  2"; never the commit). No description under the label: `description` is drawn as a caption (12, muted) below the card or list, with `caption`. Lint `starci-grammar/section-head-action`
refuses any other `Button` (a commit, another size, an icon) in the head action and more than one command.

## Version diff rows (0.37.28)
A row of a version diff sets `ListRowData.diff` (`"added"`, `"removed"`, `"changed"`): a monospace gutter mark at the row's start (`+`, `−`, `~`) in the tone's ink, the row's
ground in the tone's soft pair (success, danger, warning; the danger pair here is the diff tone, not a call to action), a removed title struck through, and for a changed
row `change: { from, to }` drawn as the 12 muted line "from → to". The glyph and its label (`diffLabel`, the app's word: "Thêm", "Bỏ", "Đổi") carry the meaning, never the
colour alone. Plain rows stay in the same list. Works in `SurfaceCard kind="list"` and `Section kind="list"`; the row padding holds. Law `DNA-COMMON-LIST-ROW-DIFF`.

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
`SurfaceCard kind="list" layout="keyValue"` (and a `Section` of rows): each row's `title` is the key (muted, 14, at the start) and `value` is the content (normal text, 14, at the end). From 28rem a row is two columns (the key at most 40%); under 22rem the value wraps under the key. Use it for facts about one thing (order details, a customer), never title + subtitle for facts. In a `rows` list the same `value` is the row's fact between the copy and the end group: value, `badges` and an end `action` stand on one line, centred against the copy, with the row padding to the edge (0.37.36). Header-zone seams use `--starci-core-zone-seam` (foreground 14% over the ground), readable on white and on the grey table frame.
