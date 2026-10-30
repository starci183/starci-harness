# Page header

Contract: [PageHeader](../../grammars/contract.md#pageheader), [Page](../../grammars/contract.md#page). Vendor: [Tabs](../../vendor/heroui.md#tabs),
[small members](../../vendor/heroui.md#small-members) (Breadcrumbs, Separator).

## Job
Name **one page**: where it sits (the trail), what it is (the page heading, its mark, status and summary), what the
reader can do to it (the page's commands) and which of its views shows (the page tabs), on one band above the
content (HIERARCHY-3: header first). A route page is one `Page`: that band full width, then the page body in the
page measure and gutter, the band and the body's sections a region step apart.

## Choose

Choice `page-header.choose.head`: what heads the content. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| auth | a sign-in, sign-up, password or auth callback page, mounted only under the auth route group `(auth)` whose own layout draws the auth frame | no `Page`: the auth frame is the page frame, and the page draws its card into it | lint `starci-grammar/route-page-is-one-page` |
| segment | the routes of one subject switched by page tabs (an instance's setup, settings, logs), each tab its own route | the segment's `layout` draws the one `Page` of every route under it: its owner, its pure half or its one root block draws `Page` with `header` and `header.tabs` as link tabs (items with `href`), the routed page as its body. Nothing sits beside that `Page`: the head goes into `header`, never a `PageHeader` beside it. The page owners under it draw body content only and no `Page` | lint `starci-grammar/route-page-is-one-page` |
| page | the top of a route page | exactly one `Page` with `header` (the PageHeader slots as data) and the page's `measure`; the page's content is its children. The page owner draws it, its pure half does, or, when client data builds the header a server owner may not, the one connected block the owner renders as its root does, the owner's content passed as that block's children (one level: a block it relays to does not count). Nothing sits beside the `Page`, no second `Page` sits inside it, and the page owner never draws a `PageHeader` or `PageContainer` of its own; a workbench is such a page; a layout frame draws no page head except the segment `Page` above. A page owner that draws no UI (it only redirects, calls `notFound()` or returns null) draws no `Page` | lint `starci-grammar/route-page-is-one-page`, `starci-grammar/no-hand-rolled-page-header`; `DNA-COMMON-PAGE-HEADER-FIRST`, `DNA-COMMON-PAGE-HEADER-ONE-H1` |
| app-surface | a chat or a split editor: one joined surface that fills the viewport below the chrome, edge to edge | `Page chrome="bleed"`: no inline gutter, no block padding, no clip, the body fills the region; the surface sits in a `FillViewport` in the body, which keeps the one bottom inset. Its `header` is the trail alone (`{ breadcrumbs }`, no heading band) or, when the page has a heading or tabs, the band (`title` given) | `DNA-COMMON-PAGE-BLEED-BODY` |
| no-band | the top of a route page with nothing to head (a landing hero) | `Page` without `header`: the body starts one region step down | `DNA-COMMON-PAGE-BODY-GAP` |
| region | a region inside the page, under the page heading | `SectionHeader` at the level the outline needs | judgement |
| card | one subject's own face | the card's label (`card.choose.role`) | `DNA-COMMON-CARD-LABEL-HEADING` |

Choice `page-header.choose.slot`: which slot carries a fact about the page. Each fact has one carrier.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| trail | the page has ancestors the reader can go back to | `breadcrumbs`; the last item is this page | judgement |
| identity | the page is one subject with an identity mark (a provider, a person, an agent) | `mark`: a decorative `Avatar`, `IconTile` or provider mark | judgement |
| status | an outcome authority settled about the subject (connected, test mode) | `status`: `Badge` or `StatusDot` chips beside the heading (`chip.choose.role`) | `DNA-COMMON-BADGE-BELOW-RAMP` |
| summary | short neutral facts that identify the subject (provider, account, count) | `meta`, one line | judgement |
| explanation | a sentence saying what the page is for | `description`, one line | judgement |
| command | a command on the whole page | `actions`: `Button`s by intent (`button.choose.intent`), the decision placement | candidate: at most one commit (CTA-1) |
| views | the page's main area switches between views | `header.tabs` (`tabs.choose.level:page`), never a `Tabs` first in the body | lint `starci-grammar/page-tabs-in-header`; `DNA-COMMON-PAGE-HEADER-TABS-ON-SEPARATOR` |

## Variants
`Page`'s `chrome` is the app's, by `page-header.choose.head`: `standard` (the default) or `bleed` for an app surface.
Nothing else: the band, its inset, its separator and where tabs stand are the grammar's
([contract](../../grammars/contract.md#pageheader)); `Page`'s `measure` is the one measure of the header content and the
body, so their edges agree by construction.

## Size
No size. Commands keep the ramp (`scale.choose.step`); the tab bar lands on `md`. At phone width the commands wrap
under the heading.

## States
Loading renders the same page with `isSkeleton`, which `Page` passes to the header: every slot keeps its box, the trail
and the tab labels stay real (STATE-8); the body's blocks own their own loading.

## Owner split
- **Grammar owns:** the surface band, its top and inline inset, the separator at its bottom edge, the heading rank,
  the slot arrangement and wrapping, tabs on the separator; through `Page`, the body's measure and gutter, the region
  step between the band and the body and between its sections, and the clip that keeps the body inside the gutter.
  Layout frames (`WorkspaceShell`, `PrimaryRailLayout`, `PaneLayout`) place regions only and never inset a page.
  A full-bleed multi-pane frame (a list column, a scrolling main region with a pinned bottom bar, an optional side rail
  that becomes a drawer when narrow) is a `PaneLayout`, never a `SurfaceCard` wrapped around the panes.
- **Knowledge decides:** page header vs section header; which slot carries a fact; one commit.
- **App author decides:** the trail, the heading, the mark, the facts, the commands and the tabs.

## Rules
HIERARCHY-3, FONT-4, CTA-1, CTA-6, STATE-6, STATE-8, BOUNDARY-1. Lint: `starci-grammar/no-hand-rolled-page-header`
(R323), `starci-grammar/page-tabs-in-header` (R324), `starci-grammar/route-page-is-one-page` (R325).
