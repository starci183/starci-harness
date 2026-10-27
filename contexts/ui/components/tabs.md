# Tabs

Contract: [Tabs](../../grammars/contract.md#tabs). Vendor: [Tabs](../../vendor/heroui.md#tabs).

## Job
Switch which **panel of content** is shown. Each tab owns a panel; one controlled value selects it (STATE-6).

## Choose

Choice `tabs.choose.role`: what the peer choice changes. Four roles switch or choose among peers.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| panels | the choice swaps whole panels of content | `Tabs`, then `tabs.choose.level` | `DNA-COMMON-TABS-OWN-PANEL` |
| value | the choice sets one value of a form or toolbar (audience, period, density); nothing is swapped out | `segmented-control.choose.role` | `DNA-COMMON-SEGMENTED-RADIO` |
| filter | the choice narrows a collection that stays in place, single or multiple | selectable `TagGroup` (`chip.choose.role:filter`) | judgement |
| nav-item | the choice picks one item of a navigation-like list | `ListBox` selecting by fill with no check (`list-table.choose.role:pick`) | lint `selection-fill-no-check` |

Choice `tabs.choose.level`: page tabs or region tabs. A set nested inside another set's panel is region tabs;
two sets of the same level never nest.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| region | the tabs switch a panel inside a drawer, dialog, card or rail; never reflected in the URL | region tabs, placed inside that surface | `DNA-COMMON-TABS-BY-LAYER` |
| page | the tabs switch the page's main area under the page header and may reflect the URL; one set per page | page tabs, placed on the page outside any surface | `DNA-COMMON-TABS-BY-LAYER`; candidate: at most one page set per page |

## Variants
None for the app: placing the tabs is the choice, and the grammar draws page tabs as the underline and region
tabs as the neutral pill from surface nesting ([contract](../../grammars/contract.md#tabs), UI-9). The pill keeps
its neutral paint: in the accent-soft chip family it would read as a row of buttons, not a view switch.

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
