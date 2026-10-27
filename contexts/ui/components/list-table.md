# List and table

Contract: [List and Table](../../grammars/contract.md#list). Vendor: [ListBox, Table](../../vendor/heroui.md#table).

## Job
Show several of one kind of thing in a page section, with equal rows the reader can scan and compare
(COLLECTION-1).

## Choose

Choice `list-table.choose.role`: which collection carries the rows. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| rail | a standalone list in a rail (choices, suggestions, how it works) | `SurfaceListCard` (`card.choose.role:rail-list`) | `DNA-COMMON-LISTCARD-LABEL-OUTSIDE` |
| timeline | events in time order | `Timeline`; an entry that needs the reader (a failed step, a pending approval) takes `isAttention` | judgement |
| table | records compared across many columns, sorted or bulk-selected | `DataTable`; a row that opens its record takes `href`, a value edited in place takes the column `editor`, a column that may fold on a narrow table takes `priority="low"` | `DNA-COMMON-TABLE-ROW-LINK`, `DNA-COMMON-TABLE-FOLD` |
| pick | picking one item is the task (a list inside a panel) | `ListBox`; a navigation-like list selects by fill with no check | lint `selection-fill-no-check` |
| static | lines that only report (status facts, how it works) | `StaticStateRow` | `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE` |
| entity | entities with a name, one description line, a few facts and actions | `ListRow` rows in the section's list | `DNA-COMMON-ROW-DESCRIPTION-ONE-LINE` |

A list is never wrapped in a card (COLLECTION-1). Title, count, filters and the section's command belong to the
section header above it.

## Variants
Rows are separated by lines (n-1 lines) or by gap, never both (`DNA-COMMON-LIST-SEAMS`). Rows align their boxes to the panel's content edge
in panels. Per-item commands are `neutral` (CTA-6). Unread rows take the contract's unread weight.

## Size
List row leading slots and option rows sit on the ramp ([../scale.md](../scale.md)); row actions take `sm`.
Tables are dense by default; numeric columns align end (FLOW-1); a wide table has one horizontal scroll owner.

## States
Loading shows `budgets.skeletonRows` skeleton rows in the list's own container with the resolved row anatomy;
empty and failed states are the section's [empty-state](empty-state.md) (STATE-8, FEEDBACK-2).

## Owner split
- **Grammar owns:** row anatomy and order, description line limit, separators, selection fill, table density,
  skeleton rows, panel alignment.
- **Knowledge decides:** section not card, which row role, selection style, per-item intent, page size.
- **App author decides:** items, keys, copy, sort and filter facts.

## Rules
COLLECTION-1..3, BOUNDARY-2..3, OVERFLOW-4, LAYOUT-3. Lint: `starci-fe/selection-fill-no-check`,
`no-list-panel-padding`, `list-item-has-key`, `no-commit-in-collection-item`. Proof: TASTE-3, TASTE-10, UX-5.
