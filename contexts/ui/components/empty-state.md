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
| first-run | the page has never held content | `EmptyNotice` with `artwork` (the brand's mascot, when the brand record allows it on this surface, drawn as `Mascot` `md` and tied to its `assetSlot`), else its glyph; this is the page's signature moment (DISCIPLINE-3), so no other art band shares the page | judgement |
| empty | a collection has no items | `EmptyNotice` in the collection's place: title, one line, the action that ends the emptiness | `DNA-COMMON-EMPTY-ONE-ACTION` |

## Variants
While the region is empty, its notice owns the region's command as the view's commit and the header omits it
(CTA-1). A notice that only explains is a dead end (UX-6). Its one mark is a glyph (`iconSource`) or, on the
first-run row only, the `artwork`; the props refuse both at once, and a failed, filtered or drawing notice never
carries art (DISCIPLINE-3).

## Size
Its action takes `md`; a large glyph is allowed as the standalone mark ([../scale.md](../scale.md)). The artwork
takes the mascot's `md` step (`mascot.choose.size:support`), set by the grammar, never by the app.

## States
Recovery pending is forwarded through the notice (CTA-3). The empty state keeps the region's place and size so
the layout does not jump (TASTE-10).

## Owner split
- **Grammar owns:** notice anatomy, its inset, the action button, pending forwarding, the artwork's step and ground.
- **Knowledge decides:** empty vs failed vs filtered vs first-run, who owns the command, where the notice sits,
  whether the mark is art.
- **App author decides:** the copy, the action and its handler, the artwork's file and its asset slot.

## Rules
CTA-1, FEEDBACK-2, STATE-8, DISCIPLINE-3, BRAND-2. The artwork's `assetSlot` is a required field of
`EmptyNoticeArtwork`, so the compiler holds the provenance lint R338 holds on a written `Mascot`. Proof: TASTE-10,
UX-6.
