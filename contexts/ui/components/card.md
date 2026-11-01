# Card

Contract: [Card](../../grammars/contract.md#card). Vendor: [Card](../../vendor/heroui.md#card).

## Job
Present **one subject** as one bounded object with its own face (COLLECTION-2).

## Choose

Choice `card.choose.role`: what presents the subject. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| task-list | a bounded set the reader works through as one group, with no search, filter or paging | `SurfaceCard kind="list"`: label outside, rows inside (`list-table.choose.role:task`) | judgement |
| collection | three or more entities of one kind on a page | not a card: a section with a list (`list-table.choose.role`) | candidate: no card holds three or more sibling cards |
| rail-list | a standalone list in a rail (choices, suggestions, how it works) | `SurfaceCard kind="list"`: label outside, rows inside | `DNA-COMMON-LISTCARD-LABEL-OUTSIDE` |
| disclosure | one summary that reveals a rarely changed region | `SurfaceCard kind="accordion"`, closed by default | judgement |
| figures | a row of key figures | `SurfaceCard kind="figures"` (DISCIPLINE-2): touching cells, lines between cells and rows; a Meter is a second band of `kind="bands"` | candidate: stat cells at most `budgets.ribbonCells` |
| whole | the whole card is one destination or command | `SurfaceCard` with its whole action (STATE-5) | judgement |
| kinds | several kinds of content about one subject | `SurfaceCard kind="bands"`, its faces divided by seams the shell draws, never inner cards or a `Divider` | candidate: separators per card at most `budgets.hairlinesPerCard` |
| tile | one of several peers repeated in a grid, each a thing to recognise or open (a provider, a template, a product) | a tile: its name inside with its logo or mark, no outside label (ruling `card-label-by-kind`) | candidate: no labelled card repeated in a `Grid` |
| entity | one entity or one summary of one subject, heading its section | `SurfaceCard`: label outside | judgement |

Choice `card.choose.highlight`: whether a card claims the next step.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| highlight | peers share the view and this card is the task's next step | `isHighlight` on this card only | `DNA-COMMON-ONE-HIGHLIGHT` |
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
and the note its `footer` (`SurfaceCard`). A `Section` around a single card is a heading over one card and
is refused (R354, ruling `card-carries-its-own-label`), as is a card whose `ariaLabel` repeats that title; several cards under one
`Section` stay legal.

## Variants
The face is the grammar's. Depth is resolved from context: a top-level card is raised, a nested card subordinate
(`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`). A decorative slab belongs to the joined card's first face, edge to
edge (SURFACE-6).

## Size
No size. Width follows measure rules; a form card caps itself with the surface's form measure (MEASURE-4).

## States
Loading renders the same card in skeleton mode; a failed card fails in place (STATE-8).

## Owner split
- **Grammar owns:** face, corner (one accent corner through `accentCorner`, ruling accent-corner), elevation by depth, inset, band and joined composition, highlight, form measure.
- **Knowledge decides:** card vs section, bands vs inner cards, hairline budget, nesting depth.
- **App author decides:** the subject, its content, the label.

## Rules
COLLECTION-1, COLLECTION-2, DISCIPLINE-1 (`budgets.hairlinesPerCard`), BOUNDARY-1..6, SURFACE-2..6. Lint:
`starci-fe/no-app-surface-paint`, `divider-full-bleed`, `starci-grammar/no-raised-surface-in-surface` (R340). Proof: TASTE-7 (`budgets.cardDepth`).

## Across files
R356 (`FE_SURFACE_NESTING`, the render graph of the architecture machine) closes the one-file card laws across files. It replaces
every component by what it draws and every `children` by what its caller handed it, then reports at the inner element: a card
in a card, in `Pane surface` or in an overlay; a `DataTable` in a card; a `PaneGrid` outside `Page chrome="panes"`; a `Section`
or `Heading` whose only content is one card; a labelled card repeated in a `Grid`. R359 (`starci-grammar/one-highlight-per-render`)
keeps one `isHighlight` in a render.

R355 (`starci-grammar/surface-card-kind`) and R366 (`starci-grammar/no-label-in-grid`) judge the card by its `kind` in one file: what a `body` card may hold, and that a labelled card repeated in a `Grid` is a tile.
