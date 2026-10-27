# Empty state

Contract: [EmptyState](../../grammars/contract.md#emptystate).

## Job
Tell the reader a region has nothing yet (or could not load) and offer the one action that ends it.

## Choose

Choice `empty-state.choose.cause`: why the region is empty, and what its notice offers. The first row that
applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| failed | the region's read failed | `EmptyNotice` naming what could not load, with a retry when it is safe (FEEDBACK-2) | judgement |
| filtered | a filter left no results | `EmptyNotice` offering to clear the filter | judgement |
| drawing | a chart, map or graph has no data | the drawing still renders what is known; the notice is the card's last band | judgement |
| first-run | the page has never held content | `EmptyNotice`; the page's signature moment may live here (DISCIPLINE-3) | judgement |
| empty | a collection has no items | `EmptyNotice` in the collection's place: title, one line, the action that ends the emptiness | `DNA-COMMON-EMPTY-ONE-ACTION` |

## Variants
While the region is empty, its notice owns the region's command as the view's commit and the header omits it
(CTA-1). A notice that only explains is a dead end (UX-6).

## Size
Its action takes `md`; a large glyph is allowed as the standalone mark ([../scale.md](../scale.md)).

## States
Recovery pending is forwarded through the notice (CTA-3). The empty state keeps the region's place and size so
the layout does not jump (TASTE-10).

## Owner split
- **Grammar owns:** notice anatomy, its inset, the action button, pending forwarding.
- **Knowledge decides:** empty vs failed vs filtered, who owns the command, where the notice sits.
- **App author decides:** the copy, the action and its handler.

## Rules
CTA-1, FEEDBACK-2, STATE-8, DISCIPLINE-3. Proof: TASTE-10, UX-6.
