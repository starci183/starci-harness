# PaneGrid

Contract: [PaneGrid](../../grammars/contract.md#panegrid). Vendor: [Drawer](../../vendor/heroui.md) for a collapsing pane.

## Job
Divide a full-bleed, bounded area into named panes (A B C side by side, D below) laid out flush and separated by
dividers, and give everything placed in them one padding system: each `Pane` owns its content inset and publishes it,
and every band in a pane is a `PaneSection` that applies it, so a search field, a tab row, a list row, a thread bubble
and a composer start at the same edge in every pane of every screen. An app chooses the areas and the bands, never an
inset.

## Choose

Choice `pane-grid.choose.frame`: what frames a multi-pane screen.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| grid | several regions share one bounded height or width, touching, divided by lines (list, main, details) | `PaneGrid` with one `Pane` per area | lint `starci-grammar/pane-grid-children`, `starci-fe/no-hand-built-panes` |
| rail | one persistent supporting column beside a page | `Grid kind="main-rail"` | judgement |
| cards | separate subjects with their own faces | `SurfaceCard`s in a `Page`, or on a canvas pane (no `surface`) where a bounded list or a figures row stands apart from its neighbours; never in a `Pane surface`, which is itself the face, and never wrapping the grid | lint `starci-grammar/no-raised-surface-in-surface` (R340) |

Never wrap the panes in a `SurfaceCard`: the panes are the faces, the dividers are the only edges.

Choice `pane-grid.choose.page`: where a pane grid is mounted.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| page | a tabbed app page (an instance's setup, a dossier browser, a chat) whose body is panes | `Page chrome="panes"` with the page header band or the trail, the tabs in `header.tabs`, and exactly one `PaneGrid` element written as its child (a component that renders the grid is not one; Page throws at run time): the grid attaches flush under the tab line, full width and to the viewport bottom, with no card, radius or gap, never a card around the panes | lint `starci-grammar/pane-grid-page`; `DNA-COMMON-PAGE-PANES-FLUSH` |
| nested | one pane of a grid is itself several panes (a routed tab's own list, thread and side) | a `PaneGrid` as the one child of a `Pane` with `inset="flush"` | lint `starci-grammar/pane-grid-page` |
| region | a grid inside a page of cards | none: a card page does not host a pane grid; use `SurfaceCard`s or a `Grid kind="main-rail"` | lint `starci-grammar/pane-grid-page` |

A tabbed route body that is panes is not a filled box or a card around a grid: `Page chrome="panes"` measures the
fill height itself and the tab line is the only line between the tabs and the grid.

Choice `pane-grid.choose.ground`: what a pane stands on.

| Row | When | Choose |
| --- | --- | --- |
| surface | the pane is a raised face on the canvas (a list column, a header, a footer, an info rail) | `surface` |
| canvas | the pane shows the host canvas (a main reading area) | no `surface` |

Choice `pane-grid.choose.band`: which `PaneSection` a band of a pane is.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| head | a title or identity row centred in a shared grid row | `PaneSection align="center"` holding a `PaneHeader` (`back` where a phone shows the pane alone, `headingLevel={1}` on the pane that holds the page's subject) | `DNA-COMMON-PANE-HEADER-TOUCH-HEIGHT` |
| fixed | a search field, a filter row, a meter, a composer, a hint line | `PaneSection`, one per band; its own children are spaced by `gap` | lint `starci-grammar/no-pane-section-padding` |
| list | a list or table that takes the rest of the height and scrolls | `PaneSection grow` holding the `ListBox`, or `scroll` when the band is its own scroll owner | lint `starci-fe/no-list-panel-padding` |
| thread | a log or conversation that scrolls beside a pinned composer | `PaneSection scroll={{ label, role: "log", tone: "background", scrollRef }}` | `OVERFLOW-4`, `OVERFLOW-5` |
| chips | one row of chips or tabs that scrolls horizontally and reaches both pane edges | `PaneSection bleed="inline"` | judgement |
| stack | blocks under one heading in a side or detail pane | `PaneSection gap="section"` | judgement |
| nested | the pane is only another grid | no section: one `PaneGrid` | lint `starci-grammar/pane-children` |

A raw element, a wrapper component or another Grammar component is never a direct child of a `Pane` or a `PaneGrid`, and
a padded wrapper is never the outermost element of a band.

## Variants
- **Areas:** `areas` rows of names (`["a b c", "d d d"]`, `.` is empty); an object keyed by `base`, `medium` (from 48rem)
  and `wide` (from 70rem) rearranges at each breakpoint, mobile first. A pane missing at a breakpoint is hidden there, or
  becomes a drawer when it has `collapse="drawer"`. A single `areas` collapses its drawer panes below 48rem.
- **Tracks:** `auto`, `fill` (1fr), `fill-2` (2fr), `fill-3` (3fr), and the Rail widths `compact`, `standard`, `wide`.
  No arbitrary lengths.
- **Pane:** `surface`, `scroll` (its own vertical scroll owner; needs a `label`), `collapse="drawer"`, and `inset`:
  `content` (the default: the pane publishes its inset to its sections) or `flush` (no inset, for a pane that holds a
  nested `PaneGrid` or a full-bleed canvas). A pane takes no class and no style.
- **PaneSection:** `grow` (takes the remaining height), `scroll` (its own scroll owner, full-bleed with the inset on
  its content; there is no scrollbar, the edge fades where content continues, OVERFLOW-6), `align` (`start`, `center`), `bleed="inline"` (the one
  horizontal scroller reaches both pane edges and takes the inset as scroll padding), `gap` (`inline`, `row`,
  `section`) between its own children, `as` (`div`, `header`, `footer`). A section takes no class and no style.

## Size
It fills its host's block and inline size; the host supplies a definite height, or `Page chrome="panes"` measures it.
Panes sit with no gap. The content inset is the container inset (PADDING-3) on every side, divider-facing or outer, and
one value at every breakpoint, so on `Page chrome="panes"` (whose header takes 12 at every width) the page gutter and the pane inset share one edge
([presentation](../presentation.md#space) P1, P8).

## States
A drawer is open or closed (`isOpen`, `onOpenChange`). While it is open its pane renders a second time inside it, under
the same inset, and the drawer header's inline padding is the pane inset, so the heading and the sections share one edge.

## Owner split
- **Grammar owns:** the grid and its flush cells, the divider on every touching edge (n-1 lines, never doubled, none on
  an outer edge, at every breakpoint, one colour and weight), the flat surface ground, the scroll owner, the drawer and
  its trigger; the content inset of every pane and the sections that apply it (the clearance per side by contact, the
  gap between a pane's sections, the full-bleed scroller with the inset inside it); a `ListBox` in a pane resolving the
  panel inset and an unpainted secondary tab track dropping its track padding, so a box starts at the pane content edge
  and text inside a box keeps the vendor's own padding; `Page chrome="panes"` and its measured fill box.
- **Knowledge decides:** grid vs rail vs cards; where the grid is mounted; surface vs canvas per pane; which band kind a
  piece of content is (the tables above).
- **App author decides:** the areas and tracks, which panes are surface, scroll, drawer or flush, and the bands with
  their content. Never a padding, margin, class or style on a pane or a band; a short separator inside a band's content
  is the app's own element.

## Pane content cap (MEASURE-9, the workspace form of MEASURE-8)
In a workspace page (`Page layout="workspace"`) the grid and its side panes ALWAYS span the full width: the aside is flush to the end edge. Only the CONTENT of a main pane that holds cards (a pink well with cards,
`Pane content="cards"`, the default for a pane on the canvas) is capped at `--grammar-content-max` (80rem) and centred INSIDE that pane; the pane and its pink ground fill the whole track. A pane that holds a chat thread
(`PaneSection scroll role="log"`), a `FlowGraph` canvas or an editor is `content="full"`: never capped, full-bleed (a surface pane is full by default; a chat or FlowGraph pane is full unless it says `content="cards"`).
A list or table in the white aside is a bordered list or frame with no shadow, never a floating card; the Section head rules apply there.

## Scroll law (0.36.0)
The sidebar and the page header band (breadcrumbs, title, tabs, sub-tabs) never scroll away: the band and the trail are sticky. Layout A (report): the pink well scrolls as one block under the band. Layout B (workspace): the page
does not scroll; each pane scrolls on its own with no visible scrollbar and its head (title, tabs, search) sticky; a chat pane keeps its head and composer fixed and scrolls only the thread (`PaneSection scroll`).

## Drawer opener
`PaneHeader drawerOpener` draws the opener of a `collapse="drawer"` pane inside the pane head. `PaneDrawerOpener` (`pane`, `icon`, `label`) is the same button for
any other place in the grid (a card head, a toolbar); it shows only where that pane's area is not arranged. The grid owns the open state.

## Rules
PADDING-3 and PADDING-4 by contact ([../presentation.md](../presentation.md) Space law 3), BOUNDARY-1 for the dividers,
GAP-3 between sections, OVERFLOW-4 and OVERFLOW-5 for a scroll pane or section, LAYOUT-1, RESPONSIVE-2 names the owner
of the breakpoints (the grid's own width). Lint: `starci-grammar/pane-grid-children` (R345),
`starci-grammar/pane-children` (R346), `starci-grammar/no-pane-section-padding` (R347),
`starci-grammar/pane-grid-page` (R348), `starci-fe/no-hand-built-panes` (R349), `starci-fe/no-list-panel-padding`.
