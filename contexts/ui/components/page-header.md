# Page header

Contract: [PageHeader](../../grammars/contract.md#pageheader). Vendor: [Tabs](../../vendor/heroui.md#tabs),
[small members](../../vendor/heroui.md#small-members) (Breadcrumbs, Separator).

## Job
Name **one page**: where it sits (the trail), what it is (the page heading, its mark, status and summary), what the
reader can do to it (the page's commands) and which of its views shows (the page tabs), on one band above the
content (HIERARCHY-3: header first).

## Choose

Choice `page-header.choose.head`: what heads the content. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| page | the top of a routed page or of the layout that frames its pages | `PageHeader`, first in the primary region and outside the content's `PageContainer`, with the content's `measure`; never `Breadcrumbs` and `SectionHeader` composed by hand | lint `starci-grammar/no-hand-rolled-page-header`; `DNA-COMMON-PAGE-HEADER-ONE-H1` |
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
| views | the page's main area switches between views | `tabs` (`tabs.choose.level:page`) | `DNA-COMMON-PAGE-HEADER-TABS-ON-SEPARATOR` |

## Variants
None for the app. The band, its inset, its separator and where tabs stand are the grammar's
([contract](../../grammars/contract.md#pageheader)); `measure` only repeats the content's measure so the edges agree.

## Size
No size. Commands keep the ramp (`scale.choose.step`); the tab bar lands on `md`. At phone width the commands wrap
under the heading.

## States
Loading renders the same header with `isSkeleton`: every slot keeps its box, the trail and the tab labels stay real
(STATE-8).

## Owner split
- **Grammar owns:** the surface band, its top and inline inset, the separator at its bottom edge, the heading rank,
  the slot arrangement and wrapping, tabs on the separator, the space to the content below.
- **Knowledge decides:** page header vs section header; which slot carries a fact; one commit.
- **App author decides:** the trail, the heading, the mark, the facts, the commands and the tabs.

## Rules
HIERARCHY-3, FONT-4, CTA-1, CTA-6, STATE-6, STATE-8, BOUNDARY-1. Lint: `starci-grammar/no-hand-rolled-page-header`
(R323).
