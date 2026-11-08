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
| single-child | the body would be one lone `DataTable`, list, chart or `Section kind="list"`, with no zones and no head actions | not a card: the part is the surface, its title a `Section title` above and one `Section caption` below (COLLECTION-4) | lint `single-child-card` (error) |
| disclosure | one summary that reveals a rarely changed region | `kind="accordion"`, closed by default | judgement |
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

## Variants
The face is the grammar's, and the card has one depth, raised. EVERY surface on the page ground is a card (0.32.0, owner 2026-11-09): the surface ground, the card radius, a 1px `--separator` border AND the card shadow, for `SurfaceCard` of every kind, form panels, the standalone `DataTable` (its own card wrapper, HeroUI's native grey-wrapper look kept inside), the `Section kind="list"` frame and a framed `EmptyNotice`. A surface nested in a card, pane, drawer, dialog or popover keeps the border and drops the shadow (the border is never doubled). Captions and titles stay outside the card. `check:type` pins it. A surface never stands inside another surface: a card in a
card, in `Pane surface`, in a `Dialog`, `Drawer`, `AlertDialog` or `Popover` is refused by a development throw and R340
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
`surface-card-kind` (R355), `single-child-card` (COLLECTION-4: a card whose only body child is a table, list or chart, with no `headers`/`footers`/`labelEnd`; also `kind="table"|"list"` with no zones), `no-label-in-grid` (R366), `starci-fe/no-heading-above-card` (R354),
`starci-grammar/surface-in-surface` (a list of rows inside the card body is a nested surface, BOUNDARY-7),
`starci-grammar/gap-proximity`. Proof: TASTE-7.
