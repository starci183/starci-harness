# Tabs

Contract: [Tabs](../../grammars/contract.md#tabs). Vendor: [Tabs](../../vendor/heroui.md#tabs).

## Job
Switch which **panel of content** is shown. Each tab owns a panel; one controlled value selects it (STATE-6).

## Choose
Four roles switch or choose among peers. The question is what the choice changes:

| The choice changes | Role | Why |
| --- | --- | --- |
| the page's main area, under the page header, may be in the URL | **page tabs** | a page-level navigation; at most one set per page |
| a panel inside a drawer, dialog, card or rail; never in the URL | **region tabs** | a view switch scoped to its surface |
| one value of a form or toolbar (audience, period, density) | [segmented-control](segmented-control.md) | it sets a value; nothing is swapped out |
| a filter or category over one collection, single or multiple | selectable `TagGroup` ([chip](chip.md)) | it narrows content that stays in place |
| one item of a navigation-like list | `ListBox` with fill selection, no check ([list-table](list-table.md)) | a list destination, not a peer strip |

Never nest two tab sets of the same kind; a nested set is region tabs. Tabs never swap a single value, and a
segmented control never swaps whole panels.

## Variants
The look follows placement and is resolved by the grammar from surface nesting: page tabs outside a painted
surface, region tabs inside one. The app does not pass the variant, the same way it does not pass a field variant.
Page tabs are an underline bar; region tabs are the vendor's pill strip, kept in its neutral paint: painted in the
accent-soft chip family they would read as a row of buttons beside a button group, not as a view switch.
The grammar's prop names for these looks are the contract's ([open-ui UI-9](../../decisions/open-ui.md)).

## Size
No size prop: the bar lands on `md` ([../scale.md](../scale.md)). A tab without a leading glyph always shows its
label, at every width. Overflowing tabs scroll with edge carets (OVERFLOW-4).

## States
Selected is a persistent value with a non-colour cue (indicator geometry); hover and focus never carry it
(ACCENT-3). Loading keeps the tab labels as real text (STATE-8).

## Owner split
- **Grammar owns:** both looks, the nesting-based default, indicator motion, page inset, overflow carets.
- **Knowledge decides:** tabs vs segmented vs tags vs list; page vs region placement; one page set per page.
- **App author decides:** the items, their labels and panels, the controlled `selectedKey`, whether page tabs
  reflect the URL.

## Rules
STATE-6, CTA-1, ACCENT-3, HIERARCHY-3. Proof: FOCUS-2 (arrow traversal), COLOR-3, UX-7 (tab survives reload).
