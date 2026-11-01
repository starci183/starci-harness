# Situations

An author says what the thing is; the grammar decides how it looks. This file is the front door: one row per situation of a
screen, each naming the component that is the answer, the spacing role the structure gives it, the one story that draws it,
and the type, lint or gate that refuses the wrong version. A wrong composition does not compile, and every allowed input
looks right (ruling `situation-tables`). The Choose tables of [components](components/README.md) and the rules of
[composition](composition.md) own the finer decisions; this table routes to them and is not cited itself, except the
[loading table](#loading), which has no other owner.

A story is a Storybook id (`<title>--<export>`, lowercased) and names the baseline picture `core-light-<id>.png` under
[packages/grammar/proof/baselines](../../packages/grammar/proof/README.md), so a row's reference image is its story. A baseline
detects change and approves no look; the owner's eye does ([proof](proof.md#who-holds-each-proof)). A cell that says
`none yet` is a gap listed in [open-grammar](../decisions/open-grammar.md) G-22, not a judgement.

## The situations

Spacing is a role, never a number: identity 4, inline 8, row 12, section 24, region 32; a card holds 12 inside, a box in a
card 8, an empty region 24 ([presentation](presentation.md#space)). The author writes no gap, margin, padding or px; the role
comes from the structure.

| Situation | Use | Spacing | Story | Refused by | Choose |
|---|---|---|---|---|---|
| A bounded list to work through (setup items, required steps, a rail's choices) | `SurfaceCard kind="list"`, label outside, `footer` for its note | rows divided by lines (seam 0), label row inline 8, label to card row 12 | `surfaces--surface-card-list` | type: a list needs `items` and `empty`; R355 hand rows; R354 a heading over one card | [card](components/card.md) `card.choose.role:task-list` |
| A long list with search or filter | `Section kind="list"` of rows, a `FilterButtonGroup` in its filter slot | head, filter and rows one section step apart (24) | `surfaces--section` | R355 a `Section` around one card; R353 a selectable tag group | [list-table](components/list-table.md) `list-table.choose.role:entity` |
| Repeated tiles (providers, templates, products) | `SurfaceCard kind="tile"` in `Grid kind="cards"`: name and mark inside, status and button at the bottom | card grid: section 24 on both axes (see [open-ui](../decisions/open-ui.md) UI-21) | `surfaces--surface-card-tile` | type: a tile has no `label`; R366 a labelled card repeated in a grid | [card](components/card.md) `card.choose.role:tile` |
| Compare a fact across columns | `DataTable`, no card, a muted note below | note inline 8 below the table | `navigation-data--data-table` | R351 a table in a card | [list-table](components/list-table.md) `list-table.choose.role:table` |
| Key figures | `SurfaceCard kind="figures"` | cells 8, dividers between cells and rows | `surfaces--surface-card-figures` | type: figures are typed items; R355 a hand stat list | [card](components/card.md) `card.choose.role:figures` |
| Regions that touch (list, detail, info) | `PaneGrid` of `Pane`s in `Page chrome="panes"` | gap 0 and one divider, pane inset 12 | `compositions-renderers--pane-inset` | R345 to R349 | [pane-grid](components/pane-grid.md) `pane-grid.choose.frame` |
| Peer filters over a collection | `FilterButtonGroup`: `sm` toggle buttons on one row, a "+n" dropdown with search | inline 8 | `status-pair--filter-button-group` | R353 | [chip](components/chip.md) `chip.choose.role:filter` |
| One of two to five values in a form or toolbar | `SegmentedControl` | field | `forms--segmented-control` | type: sizes `sm` and `md`; review | [segmented-control](components/segmented-control.md) `segmented-control.choose.role` |
| A page command | `Button intent="commit"` hugging its label, at the end of the header row | inline 8 | `compositions-renderers--page` | R352 a command filling its header; R319 | [button](components/button.md) `button.choose.width` |
| Empty | `EmptyNotice`: one line and its one action; the region keeps its place and the box collapses | line to action row 12, region inset 24 | `surfaces--empty-notice` | type: `empty` required on a list; `DNA-COMMON-EMPTY-ONE-ACTION` | [empty-state](components/empty-state.md) `empty-state.choose.cause:empty` |
| Not ready (needs setup before it works) | the state in plain words on a `Badge`, and the one next step as the item's action; a region that cannot work is an `EmptyNotice` with that action | inline 8 | `surfaces--empty-notice` | R322 chip label case; CTA-1; review | [empty-state](components/empty-state.md) `empty-state.choose.cause:not-ready` |
| A long process with stages (read, index, extract, review) | `Stepper` with its stages | row 12 | `navigation-data--stepper` | type: stages are typed data | [list-table](components/list-table.md) `list-table.choose.role:process` |
| A contradiction between two sources | `Section` whose title is the question, two `Quote`s side by side, the answers as a decision group | row 12 | none yet | review; `Quote` is not a surface | [quote](components/quote.md) `quote.choose.words` |
| Needs approval (what, who, why, a named action) | `SurfaceCard` labelled with what, a `DescriptionList` of who and why, a decision group whose commit is named for the act | row 12 | none yet | R319 one commit per view; CTA-5 group order | [action-group](components/action-group.md) `action-group.choose.kind:decision` |
| Chat | `MessageBubble` in a thread the app keeps: mine `side="outgoing"` on the accent, theirs on the surface | one sender identity 4, a sender change row 12, a day divider section 24 | `compositions-renderers--message-bubble` | type: `side`; ruling `message-bubble-primary-and-surface`; the approved picture | [message-bubble](components/message-bubble.md) `message-bubble.choose.side` |
| One route | `Page` with its `header` as data | region 32 between header and body | `compositions-renderers--page` | R323 to R325 | [page-header](components/page-header.md) `page-header.choose.head` |
| A form | `Form` of `Grid kind="form"` fields, one commit | field rows 12 | `forms--form` | R319; `DNA-COMMON-FIELD-ROW-CONTROL-LINE` | [text-field](components/text-field.md) `text-field.choose.columns` |
| An outcome in the page, or a passing one | `Alert` in the page; `Toast` for a transient confirmation | inline 8 inside | `overlays--alert` | type: tone is a settled fact; FEEDBACK-3 | [toast-alert](components/toast-alert.md) `toast-alert.choose.owner` |
| One irreversible confirm | `AlertDialog`, dismiss first and focused, the destructive confirm last | footer inline 8 | `overlays--alert-dialog` | R319 CTA-4 | [dialog-drawer](components/dialog-drawer.md) `dialog-drawer.choose.role` |
| A task that interrupts, or a task beside the page | `Dialog` that interrupts; `Drawer` that stays beside the page | overlay inset 12 | `overlays--dialog`, `overlays--drawer` | `DNA-COMMON-OVERLAY-IN-ROOT`; no surface in an overlay (R340) | [dialog-drawer](components/dialog-drawer.md) `dialog-drawer.choose.role` |

## Loading

Four states cover every region that reads data. The fact picks the state; the author passes one boolean and draws nothing.

| State | The data fact | The reader sees | Never |
|---|---|---|---|
| skeleton | a first load: `isLoading` and no data yet | the region's own frame with its known text real and the unresolved content as inert geometry, shaped by the frame from its own structure | a refresh, a revalidation or an `isValidating` flag; a fake item list; a hand-drawn bar |
| content | data exists | the data, and it stays through every refresh | a skeleton or a blank while it revalidates |
| error | the read failed: `isError` | the region fails in place: an `EmptyNotice` naming what could not load, with a retry of exactly that read | an empty region, a `0`, or the notice painted in a sibling region |
| empty | loading ended with no items | the region's `EmptyNotice` with its one action | any empty line while a read is still loading |

Choice `loading.choose.situation`: what a region reads decides when it is a skeleton. The first row that applies wins.

| Row | When | Shows | Mechanism | Story | Refused by |
|---|---|---|---|---|---|
| one read | a region fed by one read | skeleton on the first load, then content; a later refresh keeps the content | the block's slot (`isLoading`, `isError`) passes `isSkeleton` to the frame, which derives its shape from its own data fields | `leaves-skeleton-parity--collections-loading` | R92 `no-placeholder-prop`, `slot-status-through-slotview`; review for a hand skeleton |
| several reads | one frame fed by several reads (a header, a count, a list) | one skeleton until every read has settled its first load, then all of it at once; a count of an unsettled read is hidden, never `0` | loading is any read loading with no data, latched once the frame first drew; every read reaches the frame through one status, never `data ?? []` | `leaves-skeleton-parity--rows-loading` | review; candidate lint: a hook that returns `data ?? []` without that read's `isLoading` |
| key change | a key (a selected room, a filter, a page) changes and its data is not cached | only the region keyed by it returns to skeleton; regions that do not read the key keep their content | each region reads its own slot; a slot is never built from another read's status | `leaves-skeleton-parity--collections-loading` | review; candidate lint: a slot built from another slot's `isLoading` or `isError` |
| background refresh | data exists and is being revalidated | the content unchanged; at most the pending cue of the control that asked (CTA-3) | `isValidating` never feeds a loading decision | `leaves-skeleton-parity--rows-ready` | candidate lint: `isValidating` in a field named `isLoading` or `status` |
| error | one read failed | that region's notice with its retry; every other region unaffected | `isError` is a state, never an empty array | `surfaces--empty-notice` | review; candidate lint as for several reads |
| empty | loading ended with no items | `EmptyNotice` in the collection's place | empty is reached only from a settled read; a list requires `empty` | `surfaces--empty-notice` | type: `empty` required; `DNA-COMMON-EMPTY-ONE-ACTION` |

A skeleton equals the ready box: the shape comes from the same fields the ready render draws (leading, trailing, description
lines, bands), so nothing jumps when the data lands (TASTE-10, `SkeletonParity`). Where the grammar cannot yet derive a shape
from the structure, the gap is [open-grammar](../decisions/open-grammar.md) G-21, not a licence for an app to draw one.

## Where the other decision tables live

| Decision | Table |
|---|---|
| Gap, margin and padding by component and by relation | [presentation](presentation.md#space), "The table" |
| Which tier may do what | [contributing](../grammars/contributing.md#which-tier) |
| Card kinds and where the label sits | [card](components/card.md) `card.choose.kind` |
| What behind a mark picks its colour token | [presentation](presentation.md#type) `tone.choose.pair` |
| Filter, empty, not ready, approval, chat | the Choose anchors in the table above |
