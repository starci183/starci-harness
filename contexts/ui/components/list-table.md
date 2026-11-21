# List and table

Contract: [List and Table](../../grammars/contract.md#list). Vendor: [ListBox, Table](../../vendor/heroui.md#table).

## Job
Show several of one kind of thing in a page section, with equal rows the reader can scan and compare
(COLLECTION-1).

## Choose

Choice `list-table.choose.role`: which collection carries the rows. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| list | rows of peers, wherever they stand (an existing surface, the page canvas), bounded or searched, filtered or paged: entities with a name, one description line, a few facts and actions | `Section kind="list"` of typed `items` (`ListRow`), with its required `empty` state and `Tabs kind="filter"` in its `filter` slot when the list narrows; its title is the list's one heading and accessible name. It draws the one look of BOUNDARY-7 by itself (flat rows, hairlines, aligned with the title), so a hand-made list of blocks divided by `Divider` is never written, and it is never a card | type: a list needs `items` and `empty`; lint `starci-grammar/surface-in-surface`; `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE`, `DNA-COMMON-LIST-ONE-LOOK` |
| catalog | several lists or groups narrowed by one toolbar (filter tabs, a search, its selects) | a `Section` (kind `region`) whose `filter` slot holds the toolbar, a flat row between its head and the groups, and the groups as its children; never a card (a toolbar is a row on the surface). When the page title already names the catalog, the region is headless: `ariaLabel` in place of `title` (0.43.1), never a second visible title that repeats the page | type: `filter` on a region or a list section; a region takes `title` or `ariaLabel`, never both; story `Surfaces/Section filter row (0.43.1)` |
| timeline | events in time order | `Timeline`; an entry that needs the reader (a failed step, a pending approval) takes `isAttention` | judgement |
| process | the stages of one process the reader follows (read, index, extract, review) | `Stepper` with its stages; the current stage is marked and a failed stage takes the error state | type: stages are typed data |
| table | records compared across many columns, sorted or bulk-selected | never in a card (COLLECTION-4), one layout: a `Section` (title, count, fact, one action) → its `filter` row (`Tabs kind="filter"` with counts, a `SearchField size="sm"`, its selects) → a flat `DataTable` → the `DataTable footer` pager → one `Section caption` (the source or the period, muted). A figures ribbon that summarises the table is its own `Section kind="figures"` above. The table has one look on every ground (the page, a pane, a drawer, a dialog): no fill, radius, shadow or outer edge; the header labels muted over a 1px `--border` line; cells at the row step, 12 inline; rows divided by `--separator` hairlines; the first column on the content's start edge and the last on its end edge; numbers end-aligned in tabular figures (`align="end"` or `isNumeric`); a group row muted 600 under a `--border` line with no fill; a pressable row hovers and a selected row shows as BOUNDARY-7 draws a row. When paginated, the `footer` slot stands 12 under the last row with no line of its own: `Pagination` with its `summary` ("1-4 of 8 results", muted, at the start), the pages at the end, the current page on `--default` at 500. Empty keeps the header and draws an unframed `EmptyNotice` centred in the body (a filter that matches nothing adds its clear-filter command); loading keeps the real header, locks the filter row and draws skeleton rows of the real row height; an error replaces the body under the header. A row that opens its record takes `href` (a real link in the table and in the phone list: middle-click, new tab, Enter, focus ring, router navigation), or `onRowAction` when it opens a drawer (the whole row is the one pressable, with keyboard); a value edited in place takes the column `editor`; a column that may fold on a narrow table is `low` priority. Column sizing: `width` `"fill"` (the rest, with `minWidth`, `truncate` = one line + ellipsis + tooltip) / `"fit"` (its content, never wraps; a cell of buttons keeps them on one line and its column sizes to them) / px, `hideBelow` `"tablet"|"desktop"`, table `resizable` (drag, remembered per `id` in localStorage) and `phone` (`list` under 768 by default from three columns: each row a flat `ListRow`, the first column the title, the rest one muted line); by default the first text column fills and numeric ones fit; the row title is plain text, never a `Link`, and cells take the row type (14 / 500 primary, 14 muted secondary, 12 for a small name; the row header 14 / 500; the header and cells as [presentation](../presentation.md#type) FONT-7 sets them) | R351; `check:type`; lint `starci-grammar/card-is-object`, `starci-grammar/row-title-link`, `starci-grammar/table-cell-type` |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check; a list whose items go somewhere (a Data nav, mail rows) is `selectionMode="none"` with an `href` on each item, a real link (0.39.4): an item is either selectable or a link |

A list is one `Section kind="list"` wherever it stands (COLLECTION-1): its head, filter and rows stand one row step (12)
apart, and it supplies the list's one heading and accessible name. A
`DataTable` is never placed in a `SurfaceCard` (R351). A list's note is its `caption`. Title, count, filters
and the page command belong to the section's head. A row that leads to its record supplies a native
title destination with `href`; `onFollow` can close its owning popover alongside that navigation. Without a destination
there is no `onFollow`. Its commands and menu remain separate targets beside the title, and loading removes the link.

A pressable row (`ListRow`, a `Section kind="list"` row or a `Board` item, with `onPress` or `href` and no own `action`, `menu` or `control`) ends in a muted decorative `chevron-end` (mirrored in RTL), after its fact and badges; a row that is not pressable, or that has its own action, menu or control, draws none.

Key figures are `Section kind="figures"`, the ribbon, wherever they stand ([contract](../../grammars/contract.md#section)
Section owns its look). A strip already under a heading uses `ariaLabel` and adds no visible heading; a strip that owns its
heading uses `title`.

## Filter row (0.43.1, narrow step 0.44.0)
A section's `filter`, a list's or a region's, is ONE flat row in the order given: `Tabs kind="filter"`, then the `SearchField`, then its
`Select`s, the controls on one bottom edge at the inline gap. The tabs hug their labels, the search grows into what is left (never under
12rem), each select keeps its own width; a peer that no longer fits wraps to the next line. Below 48rem of the row's own width the tabs and
the search each take a full line, and the selects follow by their look: a `compact` or `pill` select keeps its content width and shares a
wrapping line with the next one, a `field` select takes a full line. A filter row's selects are `compact`. The row lays the peers out itself,
so an app wraps them in no `Cluster` or `Grid` and gives them no width. The `filter` row is where a `Tabs kind="filter"` stands in a page
or pane body (lint `starci-grammar/tabs-in-well` passes it there). Story `Surfaces/Section filter row (0.43.1)` (its play tests measure
one row at 1440 and the narrow step at 390, compact and field selects).

## Row edge tone (0.45.1)
A row that waits for the reader (a pending approval) or leads its list (the most recently opened) takes `edgeTone` (`RowEdgeTone`: `accent`, `success`, `warning`, `danger`): a
2px bar on its start edge in the theme token of the tone (`--accent`, `--success`, `--warning`, `--danger`), the bar a selected table row draws, an inset shadow so the content never moves,
kept under hover. It is a field of the row, not a prop of the list: `ListRowData.edgeTone` (a `Section kind="list"` item, a `Board` item) and `DataTableRow.edgeTone` (a table
row on its first cell, and its phone list row). The words stay in a badge or the meta (the bar is never the only signal); it is never a fill, and it is not a status: use `state` or a badge
for that. `verdict` (success and danger, for a row that reports an outcome) draws the same bar; `edgeTone` wins when both are set. A selected table row draws the accent bar over its
tone. No theme hook. Story `Surfaces/Row edge tone (0.45.1)`.

## Unread row (0.46.0)
A row the person has not read takes `emphasis: "unread"` (`ListRowData`: a `Section kind="list"` item, a `Board` item), the fact a `ListBox` item already states with the same name and value. Its title takes the strong weight (semibold) and an accent dot follows it on the title line, so the row's box does not change and
a pressable or linked title keeps the weight; the description and the meta stay muted. The dot is decorative and the weight is not a name: pass `unreadLabel` (the app's word, "Unread") and it is read before the title, as `diffLabel` is for a diff row. One look, no prop for the dot's colour, no read-state style: a read row is the plain row.
It is a fact of the row, not a status: the badge and the meta keep the words ("2 min ago"), and `state` and `edgeTone` are unrelated. A list that marks rows read as they are opened changes the row's `emphasis` and nothing else. `ListBox` keeps its own unread look (the strong weight on label and description).

Evidence (Rule 1). NIVO console shell canvas, repository `nivoos-lite` at `8759c8ab`, `.starcistacks/canvas/`: `GRAMMAR-GAPS.md:11` (G3: an unread mark on a list row, dot plus strong weight; `ListBox` has `emphasis: "unread"`, `ListRow` has none);
`pages/05-notifications-panel.html:57` and `pages/06-notifications-list.html:42` (the notification panel and the full list, each asking for the mark on `ListRow`). Story `Surfaces/Unread row (0.46.0)`.

## Table totals, row ground, phone selection (0.46.2)
`DataTable totals` ({ label, values by column id }) is one row after the last row: the label in the first column, each figure in the cell of its own column (the same end alignment and tabular figures as the rows above), semibold on an opaque secondary-surface ground over a `--border` line. Where the table scrolls (`maxBlockSize` or `fill`) the row is sticky at the foot of the scroll region, directly over the `footer`; in a table as tall as its rows it is the last row. It is not a data row (not selectable, not pressable) and is drawn only when the table has rows (not while loading, failed or empty). On the phone list it is the last item, each figure prefixed by its column label. Stats that are not column figures stay a `Section kind="figures"` ribbon.

`DataTableRow.groundTone` (`accent`, `success`, `warning`, `danger`) paints the whole row in the tone's soft pair (`x-soft` behind, `x-soft-foreground` on the words), beside `edgeTone` (the 2px bar; both may be set). Use it for a status the whole row answers; the status stays a word in a cell (colour is never the only cue). A selected row's grey fill and accent bar come over it; a pressable row darkens it a step on hover.

On the phone list a table with `selectionMode` starts selecting on a long press (500 ms, a drift over 10 px cancels): the row is selected, every row shows a 24px check mark (a real checkbox, named by `selectRowLabel`, is each row's keyboard and screen-reader control and is the long press's keyboard equivalent), and from then on a press toggles a row instead of running its `onRowAction` or `href`. `selectedCountLabel(count)` is the polite live status. At 768 and above the table keeps its selection column. Stories `Surfaces/Table totals, row ground and phone selection (0.46.2)`.

`Board`: `BoardColumn.canDrop(move)` returns `null` (let in) or a reason (refuse). A refusing column is no drop place (the drag is not accepted, so the card springs back and `onMove` does not run), outlines in the danger token with the reason written in the column for five seconds, announces the reason (`role="status"`) and calls `onRefuse(move, reason)` so the app may also raise a Toast; the keyboard move (Alt and an arrow) is held to the same answer. Story `Surfaces/Board refused drop (0.46.2)`.

## Section head (0.36.0)
**List body geometry (owner, 2026-11-19, 0.48.0; list body only).** A `Section kind="list"` with rows (the default layout) has no outer border. Its rows stand on the section title's column and are indented under it: each row is a band with 16 inline padding (px-4); a row side that touches the list's edge (the first row's top, the last row's bottom) has 16 (p-4), a side that touches the divider between two rows has 12 (p-3), so a middle row is py-3. The 1px divider and the hover fill run from the title's edge to the list's end, longer than the text, and there is no divider after the last row. Hover keeps the original `--surface-secondary` fill; hover and press never scale, shift or otherwise transform a row (`DNA-COMMON-LIST-ROW-NO-TRANSFORM`). The row title is 16 / 400 primary, its description 14 secondary. A list inside a card or a pane band, and a `keyValue`, `suggestions` or `settings` layout, is not indented: the surface or the title column already insets it. `layout="settings"` draws settings rows (title 16, hint 14, a `control` at the end) flush with the section title. The empty state of a section list is a small icon, a 16 title and a 12 hint on the page ground (no illustration, no card). Laws: `DNA-COMMON-LIST-NO-BORDER`, `DNA-COMMON-LIST-ROW-PADDING`, `-PADDING-DIVIDER`, `-PADDING-EDGE`.

A `Section` head is ONE row: the label (14, 500) and an optional count chip (12) at the start; at the end at most ONE thing, a navigation `Link variant="head"` (the label then an arrow `→` that slides about 3px on hover, the hover underline,
the inherited size; distinct from the inline `↗` Link), an info `IconButton` or (0.37.25) a text `Button intent="neutral" size="sm"` with no icon ("Gắn thêm provider" at the end of "Provider đã gắn  2"; never the commit). No description under the label: `description` is drawn as a caption (12, muted) below the list or table, with `caption`. Lint `starci-grammar/section-head-action`
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
- **Knowledge decides:** which row role, selection style, per-item intent, page size.
- **App author decides:** items, keys, copy, sort and filter facts.

## Row description
`ListRowData.description` is a string (the muted description) or a node: inline text with 16px marks ("@chatbot · [logo] Email · [logo] Chat"). A node is drawn at 12,
muted, on one line directly under the name at the identity gap (not a row step below).

## Rules
COLLECTION-1..4, BOUNDARY-2..3, BOUNDARY-7, FONT-9, OVERFLOW-4, LAYOUT-3. Lint: `card-is-object`, `starci-grammar/surface-in-surface`,
`starci-grammar/row-title-link`, `starci-grammar/table-cell-type`, `list-item-has-key`, `no-commit-in-collection-item`. Proof: TASTE-3, TASTE-10, UX-5.

`DataTable fill` (0.37.3) makes the table fill the height its host gives it (a `Section fill` cell of a stretched `Grid`): the body grows to the host's foot and the footer sticks to the bottom. The section head is a fixed 2rem row, nowrap, the label truncating first.

## Key-value rows (0.37.5)
`Section kind="list" layout="keyValue"`: each row's `title` is the key (muted, 14, at the start) and `value` is the content (normal text, 14, at the end). From 28rem a row is two columns (the key at most 40%); under 22rem the value wraps under the key. Use it for facts about one thing (order details, a customer), never title + subtitle for facts. In a `rows` list the same `value` is the row's fact between the copy and the end group: value, `badges` and an end `action` stand on one line, centred against the copy, with the row padding to the edge (0.37.36).

## Phone fixes for rows, figures, tables and timelines (0.48.0)
- **Rows at 390.** In a rows list (no `layout`), at a container of 28rem or less, a row's end group (meta, status chips) and its commands ALWAYS stand under its text, each on its own line, starting on the title's edge; a row that only opens keeps its chevron on the title line. Key-value, settings and suggestion lists, a row with a `value` and an `actionPlacement="end"` row keep their own rules (`DNA-COMMON-ROW-PHONE-UNDER`, `DNA-COMMON-ROW-PHONE-START-EDGE`). The step numeral (`leading: { position }`, "1." or "#1") is regular weight (`DNA-COMMON-STEP-NUMERAL-400`).
- **The loading list.** A `Section kind="list"` that loads with no row to measure draws three placeholder rows in its layout's shape: a label over a line (rows), a key and its value (`keyValue`), a label, its hint and the control (`settings`), one line (`suggestions`). A block that knows more (a leading mark, a meta) passes its same-shape placeholder rows as `items`. A loading row with a `value` keeps the value's track.
- **A figure that is a link** shows it at rest: its term ends with the muted chevron of a pressable row and the cell takes the row hover fill under a pointer (`DNA-COMMON-FIGURE-LINK-CUE`).
- **A table wider than its region.** The `DataTable` scroll region that scrolls sideways is a named, keyboard-focusable region (Tab reaches it, the arrows scroll it, the focus ring sits inside its edge), its edges fade where columns wait, and below 48rem the end edge carries a soft shadow while more columns wait (`DNA-COMMON-TABLE-SCROLL-FOCUSABLE`).
- **Timeline.** A dot is neutral (`--muted`) on every entry that is not the current one, whatever its `state`; only the current entry's dot takes a colour, its state's tone or the accent (the dot rule; `DNA-COMMON-TIMELINE-DOT-NEUTRAL`).

Stories `Surfaces/Figures, rows, bands and pages (0.48.0)` and `Navigation & Data/Phone fixes (0.48.0)`.
