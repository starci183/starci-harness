# PaneGrid

Contract: [PaneGrid](../../grammars/contract.md#panegrid). Vendor: [Drawer](../../vendor/heroui.md) for a collapsing pane.

## Job
Divide a full-bleed, bounded area into named panes (A B C side by side, D below) laid out flush and separated by
dividers, so an app can place its own pieces (a list, a main column, an info rail) in the cells. It only divides the
space; what goes in a cell is the app's.

## Choose

Choice `pane-grid.choose.frame`: what frames a multi-pane screen.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| grid | several regions share one bounded height or width, touching, divided by lines (list, main, details) | `PaneGrid` with one `Pane` per area | judgement |
| rail | one persistent supporting column beside a page | `PrimaryRailLayout` or `Rail` | judgement |
| cards | separate subjects with their own faces | `SurfaceCard`s in a `Page`, never inside a `PaneGrid` | judgement |

Never wrap the panes in a `SurfaceCard`: the panes are the faces, the dividers are the only edges.

Choice `pane-grid.choose.ground`: what a pane stands on.

| Row | When | Choose |
| --- | --- | --- |
| surface | the pane is a raised face on the canvas (a list column, a header, a footer, an info rail) | `surface` |
| canvas | the pane shows the host canvas (a main reading area) | no `surface` |

## Variants
- **Areas:** `areas` rows of names (`["a b c", "d d d"]`, `.` is empty); an object keyed by `base`, `medium` (from 48rem)
  and `wide` (from 70rem) rearranges at each breakpoint, mobile first. A pane missing at a breakpoint is hidden there, or
  becomes a drawer when it has `collapse="drawer"`. A single `areas` collapses its drawer panes below 48rem.
- **Tracks:** `auto`, `fill` (1fr), `fill-2` (2fr), `fill-3` (3fr), and the Rail widths `compact`, `standard`, `wide`.
  No arbitrary lengths.
- **Pane:** `surface`, `scroll` (its own vertical scroll owner; needs a `label`), `collapse="drawer"`. A header or
  footer row is a plain pane; the line under it is the same divider as every other.

## Size
It fills its host's block and inline size; the host supplies a definite height. Panes sit with no gap.

## States
A drawer is open or closed (`isOpen`, `onOpenChange`). While it is open its pane renders a second time inside it.

## Owner split
- **Grammar owns:** the grid and its flush cells, the divider on every touching edge (n-1 lines, never doubled, none on
  an outer edge, at every breakpoint, one colour and weight), the flat surface ground, the scroll owner, the
  drawer and its trigger.
- **Knowledge decides:** grid vs rail vs cards; surface vs canvas per pane (the tables above).
- **App author decides:** the areas and tracks, which panes are surface, scroll or drawer, and everything inside a
  pane: padding, layout, content and short separators in it. A pane imposes none of it.

## Rules
Ruling pane-grid (replaces the multi-pane frame with fixed slots). BOUNDARY-1 for the dividers; OVERFLOW-4 and
OVERFLOW-5 for a scroll pane; RESPONSIVE-2 names the owner of the breakpoints (the grid's own width).
