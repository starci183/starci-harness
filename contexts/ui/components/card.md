# Card

Contract: [Card](../../grammars/contract.md#card). Vendor: [Card](../../vendor/heroui.md#card).

## Job
Present **one subject** as one bounded object with its own face (COLLECTION-2).

## Choose

Choice `card.choose.role`: what presents the subject, which is the card's `kind` (a compiler-checked union, so a wrong body
for a kind does not compile). The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| contained-list | an existing surface owns the region holding the rows | unpainted `Section kind="list"` (`list-table.choose.role:contained`), with one heading and accessible name | R340/R356 forbid a surface in a surface |
| contained-figures | key figures already belong to a pane or another surfaced region | unpainted `Section kind="figures"` with shared `Figure` data; retain an existing parent heading with `ariaLabel`, or use `title` when the strip owns its heading | type: titled/headless forms exclude each other; one shared FigureCells renderer; R340/R356 forbid another surface |
| task-list | standalone rows on the page canvas, worked through or scanned as one bounded group with no search, filter or paging | `SurfaceCard kind="list"`: label outside, `items`, a required `empty`, a `footer` for the note | type: a list needs `items` and `empty`; R355 |
| collection | rows that search, filter or page, or have no bound | not a card: `Section kind="list"` (`list-table.choose.role:entity`) | R355 refuses a `Section` around one card |
| single-child | the body would be one lone `DataTable` or chart, with no zones and no head actions (a list or key-value card is valid, 0.37.8) | not a card: the part is the surface, its title a `Section title` above and one `Section caption` below (COLLECTION-4) | lint `single-child-card` (error) |
| disclosure | one summary that reveals a rarely changed region | `kind="accordion"`, closed by default | judgement |
| choice | pick one or several of a few options (a mode, permissions, settings) | `kind="select"` with `selectionMode` `single`/`multiple`, `items` `{ id, title, subtitle?, isDisabled?, control? }`, `value`, `onChange`: a HeroUI Checkbox per row (the checkbox look in both modes, never a radio), title 14/500, subtitle 12 muted only under a title, the whole row the hit target, full-width 1px dividers; `role="group"` of real checkboxes, `single` excludes the others (a radiogroup would contradict the checkbox look). A setting's explanation is a row subtitle, never a loose line under the card | owner 2026-11-09 |
| figures | a standalone row of key figures on the page canvas | `kind="figures"` (DISCIPLINE-2): touching cells with lines between cells and rows | type: typed figures; candidate: cells at most `budgets.ribbonCells` |
| whole | the whole card is one destination or command | `wholeAction`, present only where the card holds no inner control (STATE-5) | type: a nested interactive does not compile |
| kinds | several kinds of content about one subject | typed `headers` above and `footers` below any kind's body: `filter`, `search` (with trailing `filters` selects in its row), `toolbar`, `switch` (the pill, `tabs.choose.role:switch`), `figures`, `custom` and `more`, `paging`, `custom`; a one-line `description` of the head sits under the label; the shell pads them and draws the one divider between zones and the body, never inner cards or a `Divider`; a `custom` zone holds no `Tabs`, `SearchField` or `Divider` | type; R355; candidate: separators at most `budgets.hairlinesPerCard` |
| tile | one of several peers repeated in a grid, each a thing to recognise or open (a provider, a template, a product) | `kind="tile"`: its name inside with its typed mark or media poster, operational badges and one visible action; further commands use its menu, in `Grid kind="cards"` | type: poster image/absence, single/three badges and wholeAction/inner controls are exclusive; a tile has no `label`; R366 |
| entity | one entity or one summary of one subject, heading its section | `SurfaceCard` of the default `body` kind: label outside | judgement |

Choice `card.choose.label`: where the card's name sits. The kind decides, in both families.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| section | the card heads a section: `body`, `list`, `accordion`, `figures` | `label` as an unpainted row above the material, `fact` the count, `labelEnd` the action, `note` the muted line under the card | `DNA-COMMON-CARD-LABEL-ABOVE`, `DNA-CORE-CARD-LABEL-OUTSIDE`, `DNA-OFFSET-POP-CARD-LABEL-OUTSIDE`; R354 |
| tile | the card is one peer in a grid | `name` and `mark` inside, no label, fact, labelEnd or ariaLabel title | type; R366 |
| docked | the region is docked in a layout | not a card: a `Pane` | R345 to R349 |

Choice `card.choose.highlight`: whether a card claims the next step.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| highlight | peers share the view and this card is the task's next step | `isHighlight` on this card only | `DNA-COMMON-ONE-HIGHLIGHT`; lint `starci-grammar/one-highlight-per-render` (R359) |
| plain | every other card | no highlight | judgement |

Choice `card.choose.treatment`: which face the card wears. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| ink | the page's signature moment on an overview or an entry page (ACCENT-6) | `treatment="ink"`, with `artwork` or `motif` | judgement; candidate: one per page (`budgets.signatureMoments`) |
| soft | a card the product deliberately raises and says why in words: a first-run welcome, the brand art band on a page whose moment holds copy or a control (SURFACE-4) | `treatment="soft"`, with `artwork` when the brand record allows the mascot here (DISCIPLINE-3) | `DNA-COMMON-SOFT-GROUND` |
| surface | every other card | no treatment (`surface`) | judgement |

A painted treatment rebinds the surface pair on its ground, so the grammar children inside keep their contrast
(`DNA-COMMON-TREATMENT-TEXT-CONTRAST`); the app never paints a card's ground itself (`starci-fe/no-app-surface-paint`).

A card carries its own title, count, action and note: the title is its `label`, the count its `fact`, the action its `labelEnd`
and the note its `footer`. A `Section` whose only child is one card is a heading over one card and is refused (R354), as is a card whose `ariaLabel` repeats the section's title; several cards under one `Section`
stay legal.

## One content per card, elevation from context (0.36.0)
A `SurfaceCard` holds exactly ONE content: a list, an input group (a form), a table, a graph or a figures ribbon, with its own controls (a tab, search or pagination zone, a form footer with Cancel and Save). Several groups are several cards,
each with a `Sublabel` above it; items of the same kind stay in one list. No card inside a card (lint R340 `no-raised-surface-in-surface`); a card with more than one content, or a figures zone above another content, is refused by
`starci-grammar/card-one-content`. A label has no description under it: a section's line is its `caption` and a card's line is its `note`, both under the card (lint `starci-grammar/no-label-description`). A legend (a FlowGraph's kinds)
stands under the card as chips (`note={<FlowGraphLegend items />}`); a FlowGraph inside a card draws no frame of its own.

Elevation is decided by context, never by the app (SURFACE-ELEVATION): a card on the pink well has the card shadow and NO border; a surface on a white surface (a `Pane surface`, the aside, a `Drawer`, `Dialog` or `Popover`) has the
1px separator border and no shadow. The bordered list frame (`Section kind="list"`) and a framed `EmptyNotice` follow the same rule. A table card follows the same rule since 0.37.8 (TABLE, owner 2026-11-09): there is no grey table frame any more; a table is white, like a list card, with muted 12px column labels on the white, 1px full-width row dividers and its zones divided by full-width lines (shadow on the well, border on white).

Rows are always a card (0.37.5, lint `rows-in-card`): a `DescriptionList` or `DisclosureList` with no `Section` or `SurfaceCard` around it is an error. A white pane's rows are a `Section kind="list"` (a `SurfaceCard` inside a `Pane surface` is refused); story `Surfaces/Surface elevation` asserts the edge on both grounds.

## Icons are outline (0.36.0, ICONS-OUTLINE)
Never a filled or solid icon (lint `starci-grammar/outline-icons-only` refuses a solid icon-set import anywhere). An icon that stands alone as the mark of a row, card, empty state or graph step gets an icon tile (a soft-tone square with an outline icon);
an icon inline with text (a status beside a label, a search field, a button start icon, a link arrow, meta) is a plain outline icon at text size with no tile. A status is a tone-coloured outline icon with no tile (check-circle success,
x-circle danger, a spinner for running): the FlowGraph run overlay, the Stepper and the accordion step marks follow it.

## Variants
The face is the grammar's, and the card has one depth, raised. EVERY surface on the page ground is a card (0.32.0, owner 2026-11-09): the surface ground, the card radius, a 1px `--separator` border AND the card shadow, for `SurfaceCard` of every kind, form panels, the standalone `DataTable` (its own white card, the look of a list card inside: 0.37.8 dropped the grey frame, gutters and header strip), the `Section kind="list"` frame and a framed `EmptyNotice`. A surface nested in a card, pane, drawer, dialog or popover keeps the border and drops the shadow (the border is never doubled). Captions and titles stay outside the card. `check:type` pins it. A card never stands inside another card: that is refused by a development throw and R340; a `Pane surface`, `Drawer`, `Dialog`, `AlertDialog` or `Popover` HOSTS cards, drawn bordered with no shadow (0.37.5, SURFACE-ELEVATION). R340
(`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`); across files the render graph refuses it too (R356). What sits in a surface is a box at the nested inset (a notice, a `Quote`, a
stat cell), not a card. A decorative slab is a `custom` header zone of the card or the artwork of a painted card (SURFACE-6).

## Size
A card's `label` is 14 / 600 and its head `description` 14 muted (the final type scale, FONT-7); a `figures` cell's value is the display size 20 and its label and meta are 14. A `figures` item may carry `trend` (`up | down | flat`, with `trendSense` and `trendLabel`: a decorative triangle or dash in the success or danger colour before the muted meta text, the direction also said in words) and `trendLine` (a `Sparkline` under the value, at the start of the cell). Measure: `check:type` (`packages/grammar/scripts/check-type-roles.mts`).

No size. The card holds its content 16 in (`--grammar-inset-card`), its label stands 8 above the surface (4 in a cards
`Grid`) and its head `description` 4 under the label ([../presentation.md](../presentation.md#space) G6). Width follows measure rules; a form card caps itself with the surface's form measure (MEASURE-4).

## States
`isLoading` renders the same card from its own fields: a list draws the rows it was given, or three, from the same row, figures and a
tile keep their cells, the label stays real text (STATE-8, the [loading table](loading.md)). A failed card
fails in place through its `error` slot (message, description, action), beside its `empty` slot.

## Owner split
- **Grammar owns:** face, corner (one accent corner through `accentCorner`), elevation, inset, the
  drawing of every kind, bands and seams, highlight, form measure.
- **Knowledge decides:** which kind, list card vs section, bands vs inner cards, hairline budget.
- **App author decides:** the subject, its content, the label.

## Rules
COLLECTION-1, COLLECTION-2, COLLECTION-4, DISCIPLINE-1 (`budgets.hairlinesPerCard`), BOUNDARY-1..4, SURFACE-2..6. Lint:
`starci-fe/no-app-surface-paint`, `divider-full-bleed`, `starci-grammar/no-raised-surface-in-surface` (R340),
`surface-card-kind` (R355), `single-child-card` (COLLECTION-4: a card whose only body child is a `DataTable` or a chart, with no `headers`/`footers`/`labelEnd`; list and key-value cards are valid since 0.37.8), `no-label-in-grid` (R366), `starci-fe/no-heading-above-card` (R354),
`starci-grammar/surface-in-surface` (a list of rows inside the card body is a nested surface, BOUNDARY-7),
`starci-grammar/gap-proximity`. Proof: TASTE-7.

## Measure (0.37.5)
`measure` is a prop of every card kind: `content` (default, the card fills its host), `narrow` (30rem, start-aligned: an order card in a chat bubble; `standard` 40rem is too wide for a bubble) and the centred form measures `form` / `formCompact` of a `body` card. On a white ground (`Pane surface`, `Drawer`, `Dialog`, `Popover`) a card is bordered with no shadow; on the pink well it has the shadow and no border (SURFACE-ELEVATION, automatic).

## Owner laws of 0.37.5 (read before drawing a card)

### A card has no description (CARD-NO-DESCRIPTION)
A card head is the label, a count chip, one fact and one end action. `SurfaceCard` has no `description` or `subtitle` prop: the type refuses it. The words that explain the card's data (a legend, a source, a period) go in `note`, 12px muted under the card; the words that explain a row are that row's subtitle. A free-standing muted `Text` directly above a card is the same description drawn by hand and is an error (lint `starci-grammar/no-card-lead-description`).

### Flat fields on the well (FLAT-FIELDS-ON-WELL)
A group of fields or a single setting on the pink well is a title and its content: no card, no dividers. Use a card only when the content is a collection or a distinct group (CARDS-FOR-COLLECTIONS).

### Cards only for collections or distinct groups (CARDS-FOR-COLLECTIONS)
A card holds a collection (a list, table, graph, figures) or one distinct group with its own head. One field, one sentence or one control is never a card of its own.

### Row titles are nouns (ROW-TITLES-NOUNS)
A row title names the thing (Telegram, Đơn DH-1001, Chế độ trả lời), never a sentence or a verb phrase; what the row says about it is its subtitle or its value.

### The choice list is `SurfaceCard kind="select"` (CHOICE-LIST-SELECT)
Every choice list (a mode, a permission, a set of options) is `SurfaceCard kind="select"`: HeroUI Checkbox rows with a title and a subtitle, the whole row the hit target, `selectionMode="single"` unchecking the others with the same checkbox look. Never segmented pills, loose switches or a radio look for a choice list. A subtitle exists only under a title in the same row.

### A choice row carries one control at its end (CHOICE-ROW-CONTROL)
A `select` row's `control` (0.37.13, the same slot as a list row's `control`, owner 2026-11-10: "the last cell is JSX, put in what you like") takes Grammar content: a primary `Tabs` pill ("Tự động | Hỏi", 2 to 4 options, the mode of a write capability; lint `tabs-switch-zone` allows a primary pill written as the value of a row `control`, 0.37.16, and still rejects it anywhere else outside the card's `switch` zone), a `Switch`, a `Badge`, a `Checkbox`. Grammar seats it at the row's end centred on the title line; the title and subtitle wrap before it (also at 390). The slot is its own hit target: presses, clicks and keys inside never toggle the row, it is outside the row's accessible name (name the control itself, e.g. the Tabs `label` = the row title), and a disabled row dims and blocks it. An unchecked row's control stays drawn: the app passes it disabled when the choice depends on the check. Never raw elements with handlers in `control` (held by review: no lint rule reads a slot's content yet).

### Lists on white are a bordered card (WHITE-LIST-BORDERED-CARD)
On a white drawer or dialog a list or key-value rows are a card with a 1px border and no shadow; on the pink well the same card has a shadow and no border. In a white ASIDE (`Pane surface`) it is the same: the list is a bordered, rounded frame (1px separator, the card radius, NO shadow) with full-width row dividers inside, the rows keeping the card's inline padding (SURFACE-ELEVATION: a surface on a white surface is bordered, never flat). Grammar switches the edge by itself from the ground (SURFACE-ELEVATION), a `SurfaceCard` on a white surface is allowed, and rows with no card are refused (lint `starci-grammar/rows-in-card`).

### Row padding follows what a side touches (ROW-EDGE-PADDING)
In a card, a side of a row that touches the card's edge is p-4 (`--grammar-card-padding-block` and `--grammar-card-padding-inline`, 16): the left and right, the FIRST row's top when no header zone stands above it, the LAST row's bottom when no footer zone stands below it; a single-row card is p-4 above and below. A side that touches a separator (between two rows, or under a zone's divider) is p-3 (`--grammar-row-gap`, 12). Controls included: a Tabs pill, a Switch, a Select, a Button or a Badge in a row's `control` or actions keeps the same padding, and the row GROWS around a tall control (`min-block-size` in a row slot, never a fixed `block-size`). It covers select, list, details and table rows and the header and footer zones (a first header zone keeps p-4 to the card's top, a last footer zone p-4 to its bottom, a switch zone p-3 to its divider; a tab strip stands on its own line). Law `DNA-COMMON-ROW-EDGE-PADDING`.

### A row's control and its checkbox + text are centred on each other (ROW-CONTROL-CENTRE)
In a `select` row (and a list row) with a `control`, the checkbox and the text block (title, subtitle) are one group, and the group and the control are vertically centred on each other, within 1px. Both stretch to the row and keep its padding (ROW-EDGE-PADDING); on a phone the group keeps its 40px touch target with its content centred in it. A row without a control keeps its top alignment. Law `DNA-COMMON-ROW-CONTROL-CENTRE`.

### Header zones are divided by full-width dividers (HEADER-ZONES-DIVIDERS)
The zones of a card head (search, filter, tabs, toolbar) are separated from each other and from the body by a 1px divider across the full card width (no inset), in a colour visible on the white card (a table card is white too since 0.37.8: no grey frame).

### A row that opens something is pressable whole, with a chevron (LIST-ROW-NAVIGATION)
A list row that opens something (a detail, a page, a drawer) is clickable as a WHOLE row (`href` or `onPress` on the row) and ends in a trailing chevron. An internal `href` row keeps its real anchor but its title is plain text colour with NO ↗ (0.37.14: the ↗ is for `kind="external"` links only). There is no per-row small "Xem" or "Mở" button, and no navigation Link beside the row. Row actions that DO something (not navigation: Tạm dừng, Gỡ, Xoá) go in the row menu. Since 0.37.6 `href` rows stretch their title Link over the whole row exactly as `onPress` rows do.

### One Label per section, Sublabels for the groups inside (LABEL-SUBLABEL-HIERARCHY)
A section has exactly ONE Label (its head, 14 / 500) and Grammar sets it 12px (`--grammar-row-gap`, gap-3) above its content, in `Section` and in `SurfaceCard label`. The groups nested inside a labelled section are named by a Sublabel (12 / 500 muted), set 8px (`--grammar-inline-gap`, gap-2) above the card: `Section sublabel="..."` or `SurfaceCard sublabel="..."`, which draw the Sublabel and the 8px gap themselves, so an app never composes a `Sublabel` and a card by hand. Sibling groups inside the same Label are ALSO 8px apart (gap-2), so they visibly belong to it; the larger step (24px) applies only BETWEEN top-level Label sections. Never a Label inside a labelled Section: `sublabel` and `title` / `label` are never given together (the types refuse it) and the lint rule `starci-grammar/no-nested-label` flags a labelled Section or SurfaceCard nested in a labelled one of the same file. Example: the Label "Agent hiểu gì về việc của bạn" holds two groups, the Sublabels "Được tự làm" and "Phải hỏi bạn", each over its `SurfaceCard kind="select"`. Story: `Surfaces/Label hierarchy`.
