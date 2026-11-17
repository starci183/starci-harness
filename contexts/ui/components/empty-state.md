# Empty state

Contract: [EmptyState](../../grammars/contract.md#emptystate).

## Job
Tell the reader a region or a page has nothing yet (or could not load) and offer the one action that ends it.

## Choose

Choice `empty-state.choose.cause`: what to show when a list or any region has no data, why it is empty, and what its notice offers. The first row that
applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| failed | the region's read failed | `EmptyNotice` naming what could not load, with a retry when it is safe (FEEDBACK-2) | judgement |
| filtered | a filter left no results | `EmptyNotice` offering to clear the filter | judgement |
| drawing | a chart, map or graph has no data | the drawing still renders what is known; the notice stands under it in its region | judgement |
| first-run | the whole page has never held content | `EmptyNotice scope="page"` with an `illustration` (the page's signature moment, DISCIPLINE-3, so no other art band shares the page) | judgement |
| not-ready | the region cannot work until a setup step is done (a connection not made, a key not set) | `EmptyNotice` stating the state in plain words with the one next step as its action; on an item, the state is a `Badge` and the item's one action | `DNA-COMMON-EMPTY-ACTIONS`; judgement |
| empty | a collection has no items | `EmptyNotice` in the collection's place: title, one line, the action that ends the emptiness | `DNA-COMMON-EMPTY-ACTIONS` |

Choice `empty-state.choose.scope`: how large the state is, which decides its media. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| page | the state is the whole page: a first visit, a page with nothing yet, a paywall, a not-found (404), a server failure (500) | `scope="page"`, and its `media` is an `illustration` (a statics key) | type: an `illustration` only on `scope="page"` |
| region | the state is inside a page: an empty Section, list or table, a no-match after a filter, a panel, a drawer | `scope="region"` (the default), and its `media` is an `icon` | type: `illustration` is refused on a region |

Why the scope decides: art belongs to the moment a page has no other content to carry it; inside a working page the same picture competes
with the data around it and repeats on every empty panel, so only the icon stands there (DISCIPLINE-3). The scope is a fact about the state, not a
look, and the type holds the rule so no lint is needed. A page-level state with no art takes an `icon` too.

Choice `empty-state.choose.actions`: what the notice offers.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| one | one next step ends the state | the primary action only | `DNA-COMMON-EMPTY-ACTIONS` |
| two | a page-level state has a second honest way out (a 500: "Back to the home page" and "Try again") | the primary and one `secondary`, neutral and text only | `DNA-COMMON-EMPTY-ACTIONS` |
| none | the state is information (a forbidden region with no way forward) | no action | judgement |

## Variants
Inside a chat thread (a `PaneSection scroll role="log"` band or a stack of `MessageBubble`s) an `EmptyNotice` draws no card surface: no fill, border, radius or shadow, detected by context ([message-bubble](message-bubble.md)).
While the region is empty, its notice owns the region's command as the view's commit and the header omits it
(CTA-1). A notice that only explains is a dead end (UX-6). Its one mark is the `media`: `{ icon }` or, on a page-scope notice,
`{ illustration }`, never both; a failed, filtered or drawing notice never carries art (DISCIPLINE-3).

## Size
Its media is the grammar's: the icon is the tile `md` on the accent soft pair (the soft brand-tone circle); the illustration is 160px square at 1440
and 120px below 48rem (`--grammar-illustration-state`). A page-scope notice fills 70% of the viewport height and centres its stack. Its primary
action takes `md` on a page-level state and `sm` inside a page; an action that leads somewhere (a page, a setup step) takes `actionEndArrow`,
one that does something stays plain (`button.choose.glyph`); in a secondary place (a rail, a side card) `actionIntent="neutral"` keeps it from
adding a second primary beside the page header's ([../scale.md](../scale.md)).

## States
Recovery pending is forwarded through the notice (CTA-3). The empty state keeps the region's place and size so
the layout does not jump (TASTE-10). Its illustration loads under a shimmer in its own box and keeps the stack when the file fails.

## Owner split
- **Grammar owns:** notice anatomy, its inset, the media step and its circle, the actions row, pending forwarding, the illustration's
  decorative treatment.
- **Knowledge decides:** empty vs failed vs filtered vs first-run, the scope, who owns the command, where the notice sits.
- **App author decides:** the copy, the actions and their handlers, the illustration's statics key and its asset slot.

## Frame
`frame="frameless"` (the default since 0.37.4) draws the notice as words on the ground of the pane or well: no border, background or shadow. `frame="card"` is opt-in: one surface card, for a notice that is itself the content of a page. Inside a card it is always words only.

## Page-level states every web app carries
The not-found (404), the server failure (500) and the last-resort failure are `EmptyNotice scope="page"` with an `illustration`, a title, a
description and actions: "Back to the home page" on all of them, and "Try again" (the boundary's reset) as the `secondary` of the 500. The
harness template ships them as the `not-found`, `error` and `global-error` files of the web app, composed only from `EmptyNotice` (R439
`FE_ERROR_PAGE_MISSING`, R440 `FE_ERROR_PAGE_NOT_EMPTY_NOTICE`); an app edits their words and art, never drops them. They are the gallery
screens `errors/not-found` and `errors/server-error`.

## Rules
CTA-1, FEEDBACK-2, STATE-8, DISCIPLINE-3, DISCIPLINE-4, BRAND-2. Proof: TASTE-10, UX-6.
