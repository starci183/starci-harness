# Card

Contract: [Card](../../grammars/contract.md#card). Vendor: [Card](../../vendor/heroui.md#card).

## Job
Present **one subject** as one bounded object with its own face (COLLECTION-2).

## Choose

| Need | Use |
| --- | --- |
| one entity or one summary of one subject | `SurfaceCard` |
| a standalone list in a rail (choices, suggestions, how it works) | `SurfaceListCard`: label outside, rows inside |
| one summary that reveals a rarely changed region | `SurfaceAccordionCard`, closed by default |
| three or more entities of one kind on a page | not a card: a section with a list ([list-table](list-table.md)) |
| several kinds of content about one subject | bands of one card, divided by separators |
| a row of key figures | one default card holding a stat strip (DISCIPLINE-2) |
| the whole card is one destination or command | the card's whole-action contract (STATE-5) |

## Variants
The face is the grammar's. Depth is resolved from context: a top-level card is raised, a nested card subordinate
(BOUNDARY-6). One highlighted card per view at most, and only as a claim about the task. A decorative slab belongs
to the joined card's first face, edge to edge (SURFACE-6).

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
