# Tabs

Contract: [Tabs](../../grammars/contract.md#tabs). Vendor: [Tabs](../../vendor/heroui.md#tabs).

## Job
Switch which **panel of content** is shown. Each tab owns a panel; one controlled value selects it (STATE-6).

## Choose

Choice `tabs.choose.role`: what the peer choice changes. Four roles switch or choose among peers.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| panels | the choice swaps whole panels of content | `Tabs`, then `tabs.choose.level` | `DNA-COMMON-TABS-OWN-PANEL` |
| value | the choice sets one value of a form or toolbar (audience, density, environment, a tool); nothing is swapped out. A tablist is not a form field | a dropdown `Select` (`select.choose.role:select`); `RadioGroup` only when each option needs a sentence | judgement |
| switch | the choice toggles a period or mode of the same data in one block without navigating ("7 days / 30 days", "Day / Week / Month"): two to four short, fixed options, no count, no destination | `Tabs appearance="primary"` (HeroUI's primary variant, a pill in a track): the `action` of the `Section` that holds the data it switches, at the end of its head row, or, for the mode choice of one row ("Auto | Ask" on an ability row), the value of that row's `control`; never loose in a page body, a pane or a drawer, never joined buttons | lint `starci-grammar/tabs-switch-zone` (a `<Tabs appearance="primary">` in JSX outside a `Section action` or a row `control`), `starci-fe/no-primary-tabs-misuse` (R380: items beyond two to four, a `count`, an `href` or `isAttention`) |
| filter | the choice narrows a collection that stays in place | `Tabs kind="filter"`: underline tabs drawn exactly as the page tabs (14, 40 high, the same padding, the selected tab in the tint pair at weight 500 over the 2px accent underline, a hairline under the row; a second tab row is never a smaller or compact variant), each with its `count` drawn as a 12px chip (grey always, selected or not; the pink accent soft pair ONLY on a tab marked `isAttention`, work waiting for the owner: to handle, to approve, an error; a filter tab keeps a grey 0, a page tab at layers 1 and 2 hides the chip at 0; a count is never written into the label as "· N"); a strip wider than its row scrolls sideways inside its own scroller with fading edges, every tab kept, the selected one scrolled into view (it never folds into a "+n" menu, which hides groups at 390) | `DNA-COMMON-TABS-FILTER-COMPACT`, `DNA-COMMON-TABS-FILTER-NO-FOLD`; `check:type` |
| nav-item | the choice picks one item of a navigation-like list | `ListBox` selecting by fill with no check (`list-table.choose.role:pick`) |

**Views are secondary**: anything that navigates (changes the route or URL) or switches a block's views ("Board / Calendar / List / Figures") is the underline, `appearance="secondary"` (the default) with `kind="views"`, and a list's status filter ("In progress / Done") is the same underline with `kind="filter"`, its count in the tab's `count` slot; the pill (`appearance="primary"`) is ONLY the period or mode toggle of the same data that does not navigate. Neither is ever drawn as a row of chips, and a value of a form or toolbar is a [select](select.md), never a tablist. A primary item never takes `href` (the type refuses it, and a development throw catches what the type cannot see).

Choice `tabs.choose.placement`: where a tab bar stands. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| filter | the tabs narrow one list | inside the list pane, under its search field and above its rows: `Tabs kind="filter"` | judgement |
| page | the tabs switch views of the page | the page head: `Page header.tabs` | lint `starci-grammar/page-tabs-in-header` |

Choice `tabs.choose.level`: page tabs or region tabs. A set nested inside another set's panel is region tabs;
two sets of the same level never nest, and a page stacks at most two underline layers (`TABS-DEPTH`): the page tabs and one
region set.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| region | the tabs switch a panel inside a drawer, dialog, card or rail, or the views of one page tab; never reflected in the URL | region tabs, placed inside that surface; for the views of one page tab, `Page header.subTabs` (the second row of the header band, under the page tabs, valid only with `tabs`, on its own full-width separator and the first label on the content edge), or a set in the page tab's panel, which draws its own separator | `DNA-COMMON-TABS-BY-LAYER`; lint `starci-grammar/tabs-depth` (a third underline layer in one file) |
| page | the tabs switch the page's main area under the page header and may reflect the URL; one set per page | page tabs, `header.tabs` of the `Page` (they stand on its band's separator) | `DNA-COMMON-TABS-BY-LAYER`, `DNA-COMMON-PAGE-HEADER-TABS-ON-SEPARATOR`; lint `starci-grammar/page-tabs-in-header`; candidate: at most one page set per page |

## Variants
The role is the choice (`tabs.choose.role`): the grammar draws page, region and filter (`kind="filter"`) tabs as the
underline, its labels text on the content edge they share with the title above and the box below
([contract](../../grammars/contract.md#tabs), [presentation](../presentation.md#space) Text edge), and a mode or
period switch as the pill of `appearance="primary"`. `Tabs` takes no `variant` to pass.

## Filter presets as pills
`Tabs kind="filter" shape="pill"` draws a filter strip as pills on a track. The decision: there is ONE pill look in the grammar, HeroUI's primary variant (the track and the pill) that `appearance="primary"` already draws, so the filter pill reuses that drawing and adds none; `shape` only picks which of the two looks a filter strip wears. The underline stays the default and the answer for tabs of statuses that stay in a table's `Section` filter row; the pill is for a short row of PRESETS (saved views: "All", "Mine", "Overdue") where choosing reads as picking a view. What a filter strip has stays (a `count` chip per tab, `isAttention`, the sideways scroll with the selected tab always visible, never a "+n" fold); what the pill has stays (no line under it). `appearance="primary"` is still the mode or period switch of two to four options with no count and no destination (R380); `shape="pill"` needs `kind="filter"` (a development error otherwise). Story `Navigation & Data/Filter pills (0.46.2)`.

## Size
No size prop: the bar lands on `md` ([../scale.md](../scale.md)). Every tab is 14 and 40 high (the control step), with one
selected weight, 500, plus the underline, whatever the layer: page tabs, region tabs, `subTabs`, filter tabs and the pill alike (FONT-7 in
[../presentation.md](../presentation.md#type); measure `check:type`, `packages/grammar/scripts/check-type-roles.mts`). A set is never drawn one size smaller than the set above it; the layer is
told by position and by the separator, not by type size, so a second row never reads as a footnote of the first. The pane line rule: region tabs inside a pane (a `Tabs` strip that ends a `PaneSection`) sit on ONE full-width separator, the
band's bottom edge through the pane inset; the strip draws no short line of its own, no padding stands under it, and the
neighbouring pane loses its block-start border, so there is no second border 12px lower. A tab
without a leading glyph always shows its label, at every width. Overflowing tabs scroll with edge carets (OVERFLOW-4), and the
selected tab opens fully in view on the first render and on every change of the selection, the list or the box: clear of the carets'
gutter and of the strip's fading edge on a side where more tabs wait, centred when it is wider than that room.

A command that belongs at the end of a strip (an "Add region" button) is the strip's `end` slot, inside the strip frame
after the tabs and centred in its height, so the strip's line (its own, or the page band's) spans the full column under it;
a `Cluster` placed beside the strip for this is refused by review, because it cuts the line.

## States
Selected is a persistent value with a non-colour cue (indicator geometry); hover and focus never carry it
(ACCENT-3). Loading keeps the tab labels as real text (STATE-8).
An unavailable tab carries `isDisabled` on its item; HeroUI keeps it out of selection and keyboard traversal and
blocks its link navigation. When an operation locks panel switching, disable every item while retaining the
controlled selection and its panel.

## Owner split
- **Grammar owns:** both looks, the nesting-based default, indicator motion, page inset, overflow carets, for
  link tabs the selected tab from the current path, and for page tabs the page body as the one panel every tab controls
  (`Page` names it by the tab list). Region tabs name their panels with `panelId`, one id for a single swapped panel or
  a function from the tab key to its panel's id.
- **Knowledge decides:** tabs vs select vs tags vs list; page vs region placement; one page set per page.
- **App author decides:** the items, their labels and panels, whether page tabs reflect the URL. Tabs that reflect
  the URL are link tabs: every item carries its `href`, and a server page passes them as data with no
  `selectedKey` or `onSelect`; other tabs are controlled by `selectedKey` and `onSelect`.

## The second layer
Spacing under a tab line (`--grammar-tab-line-gap`, 16): under a `Page` header that carries tabs, the body starts 16 below the band's bottom border (the line the page tabs stand on), not a region step; a second tab row at the top of the body (a `kind="filter"` strip) therefore starts 16 below the first, on the same left edge, its own underline on its own line, and what follows it in its `Stack` (the search and selects) starts 16 below that line. Both rows are the same size and look. Owner: `packages/grammar/src/common/styles.css` (the page body rule and the stack rule beside `--grammar-tab-line-gap`).

The second underline layer is `Page header.subTabs`: inside the white header band, under the page tabs, on its own full-width separator, the same size
as layer 1 (14, 40 high, selected weight 500, the 2px underline exactly on the separator) and flush with the band's left inset, the same x as layer 1, with
no extra indent. It never stands loose on the pink well or in a pane body: lint `starci-grammar/tabs-in-well` refuses an underline `Tabs` written in the body of a
`Page`, `Pane` or `PaneSection` outside a header row of its own or, `kind="filter"`, a `Section`'s `filter` row ([list-table.md](list-table.md) "Filter row").

## Rules
STATE-6, CTA-1, ACCENT-3, HIERARCHY-3. Lint: `starci-grammar/tabs-switch-zone`, `starci-grammar/tabs-depth`, `starci-grammar/tabs-in-well`,
`starci-fe/no-primary-tabs-misuse`, `starci-grammar/page-tabs-in-header`. Proof: FOCUS-2 (arrow traversal), COLOR-3, UX-7 (tab survives reload).
