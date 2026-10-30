# Card

Contract: [Card](../../grammars/contract.md#card). Vendor: [Card](../../vendor/heroui.md#card).

## Job
Present **one subject** as one bounded object with its own face (COLLECTION-2).

## Choose

Choice `card.choose.role`: what presents the subject. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| collection | three or more entities of one kind on a page | not a card: a section with a list (`list-table.choose.role`) | candidate: no card holds three or more sibling cards |
| rail-list | a standalone list in a rail (choices, suggestions, how it works) | `SurfaceListCard`: label outside, rows inside | `DNA-COMMON-LISTCARD-LABEL-OUTSIDE` |
| disclosure | one summary that reveals a rarely changed region | `SurfaceAccordionCard`, closed by default | judgement |
| figures | a row of key figures | one default card holding a stat strip (DISCIPLINE-2) | candidate: stat cells at most `budgets.ribbonCells` |
| whole | the whole card is one destination or command | `SurfaceCard` with its whole action (STATE-5) | judgement |
| kinds | several kinds of content about one subject | one joined `SurfaceCard`, its bands divided by separators, never inner cards | candidate: separators per card at most `budgets.hairlinesPerCard` |
| entity | one entity or one summary of one subject | `SurfaceCard` | judgement |

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

## Variants
The face is the grammar's. Depth is resolved from context: a top-level card is raised, a nested card subordinate
(`DNA-COMMON-NO-RAISED-SURFACE-IN-SURFACE`). A decorative slab belongs to the joined card's first face, edge to
edge (SURFACE-6).

## Size
No size. Width follows measure rules; a form card caps itself with the surface's form measure (MEASURE-4).

## States
Loading renders the same card in skeleton mode; a failed card fails in place (STATE-8).

## Owner split
- **Grammar owns:** face, corner, elevation by depth, inset, band and joined composition, highlight, form measure.
- **Knowledge decides:** card vs section, bands vs inner cards, hairline budget, nesting depth.
- **App author decides:** the subject, its content, the label.

## Rules
COLLECTION-1, COLLECTION-2, DISCIPLINE-1 (`budgets.hairlinesPerCard`), BOUNDARY-1..6, SURFACE-2..6. Lint:
`starci-fe/no-app-surface-paint`, `divider-full-bleed`. Proof: TASTE-7 (`budgets.cardDepth`).
