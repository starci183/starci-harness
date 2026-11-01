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
| disclosure | one summary that reveals a rarely changed region | `kind="accordion"`, closed by default | judgement |
| figures | a standalone row of key figures on the page canvas | `kind="figures"` (DISCIPLINE-2): touching cells with lines between cells and rows | type: typed figures; candidate: cells at most `budgets.ribbonCells` |
| whole | the whole card is one destination or command | `wholeAction`, present only where the card holds no inner control (STATE-5) | type: a nested interactive does not compile |
| kinds | several kinds of content about one subject | `kind="bands"`: `body`, `figures` and `media` faces, then at most one collection, last; the shell draws the seams, never inner cards or a `Divider` | type; R355; candidate: separators at most `budgets.hairlinesPerCard` |
| tile | one of several peers repeated in a grid, each a thing to recognise or open (a provider, a template, a product) | `kind="tile"`: its name inside with its typed mark or media poster, operational badges and one visible action; further commands use its menu, in `Grid kind="cards"` | type: poster image/absence, single/three badges and wholeAction/inner controls are exclusive; a tile has no `label`; R366 |
| entity | one entity or one summary of one subject, heading its section | `SurfaceCard` of the default `body` kind: label outside | judgement |

Choice `card.choose.label`: where the card's name sits. The kind decides, in both families (ruling `card-label-by-kind`).

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| section | the card heads a section: `body`, `list`, `accordion`, `figures`, `bands` | `label` as an unpainted row above the material, `fact` the count, `labelEnd` the action, `footer` the note | `DNA-COMMON-CARD-LABEL-ABOVE`, `DNA-CORE-CARD-LABEL-OUTSIDE`, `DNA-OFFSET-POP-CARD-LABEL-OUTSIDE`; R354 |
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
and the note its `footer`. A `Section` whose only child is one card is a heading over one card and is refused (R354, ruling
`card-carries-its-own-label`), as is a card whose `ariaLabel` repeats the section's title; several cards under one `Section`
stay legal.

## Variants
The face is the grammar's, and the card has one depth, raised. A surface never stands inside another surface: a card in a
card, in `Pane surface`, in a `Dialog`, `Drawer`, `AlertDialog` or `Popover` is refused by a development throw and R340
(`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`); across files the render graph refuses it too (R356). What sits in a surface is a box at the nested inset (a notice, a `Quote`, a
stat cell), not a card. A decorative slab belongs to the bands card's first face, edge to edge (SURFACE-6, ruling
`band-is-first-face`).

## Size
No size. Width follows measure rules; a form card caps itself with the surface's form measure (MEASURE-4).

## States
`isLoading` renders the same card from its own fields: a list draws the rows it was given, or three, from the same row, figures and a
tile keep their cells, the label stays real text (STATE-8, the [loading table](loading.md)). A failed card
fails in place through its `error` slot (message, description, action), beside its `empty` slot.

## Owner split
- **Grammar owns:** face, corner (one accent corner through `accentCorner`, ruling accent-corner), elevation, inset, the
  drawing of every kind, bands and seams, highlight, form measure.
- **Knowledge decides:** which kind, list card vs section, bands vs inner cards, hairline budget.
- **App author decides:** the subject, its content, the label.

## Rules
COLLECTION-1, COLLECTION-2, DISCIPLINE-1 (`budgets.hairlinesPerCard`), BOUNDARY-1..4, SURFACE-2..6. Lint:
`starci-fe/no-app-surface-paint`, `divider-full-bleed`, `starci-grammar/no-raised-surface-in-surface` (R340),
`surface-card-kind` (R355), `no-label-in-grid` (R366), `starci-fe/no-heading-above-card` (R354). Proof: TASTE-7.
