# Loading states

A region is in exactly one of four states, and the Grammar owns how each looks. The block owns which state a read is in. A
skeleton is the ready structure with its data missing, drawn by the Grammar component; it never jumps when the data lands. The
two meet in one recipe: the block's `SlotView` hands the pure half `render(placeholder, true)`, so the loading tree is the ready
tree drawn once, from a placeholder of the same shape, and each Grammar component receives `isLoading`. That recipe is owned by
[code/fe README](../code/fe/README.md#data-status-of-a-region) (FE-ERROR-1) and is not restated here; this page owns which read
drives which state and who draws what.

## The four states

The data fact picks the state; precedence is loading, then error, then empty, then content.

| State | The data fact | The reader sees | Never |
|---|---|---|---|
| skeleton | a first load: `isLoading` and no data yet | the region's own frame with its title kept, its count hidden and its known text real; every unresolved row, mark and line as inert geometry of the ready structure | a refresh, a revalidation or `isValidating`; a second loading component; a row count the app chose |
| content | data exists | the data, and it stays still through every refresh | a skeleton or a blank while it revalidates |
| error | the read failed: `isError` | the region fails in place: the `error` slot of the component (a message, one line, a retry of exactly that read), a live alert with its own mark | an empty region, a `0`, or the notice painted in a sibling region |
| empty | the read finished with no items: `isEmpty` | the component's `empty` slot with its one action | any empty line while a read is still loading |

A `DataSlot` is a union over these flags (`isLoading`, `isError`, `isForbidden`, `isEmpty`, and `items` on the ready member), so
loading and error together cannot be built. `isValidating` is the one flag that sits beside data; it never draws a skeleton.
`isForbidden` stays because a 403 has its own drawing in `SlotView`.

## What the Grammar takes

`Section`, every kind of `SurfaceCard`, `ListBox`, `Timeline`, `DataTable`, `MessageBubble` and `PaneSection` take one `isLoading`
and one `error` slot (`{ message, description?, actionLabel?, onAction? }`); every leaf, branch and composite takes `isLoading` and
nothing else. The component derives its skeleton from the rows and fields it was given (the same-shape placeholder), or draws a
default of three rows when it was given none. `PaneSection` and `Section` tell every Grammar component inside them, so one flag
covers the band. `loadingRows`, `loadingContent` and `isSkeleton` no longer exist.

## The region carries it

Loading is published by the region and read by every component inside it (ruling `region-loading`). `Section`, `PaneSection`, `SurfaceCard`,
`Form` and a `Dialog` or `Drawer` body take the first-load flag and tell everything inside; an app never passes `isLoading` to each field or
button. A component draws the box it has when ready, inert (not focusable) and under the region's one `aria-busy`:

- static chrome keeps its real words and only goes inert: titles, tab labels, "Cancel", field labels, links and icon buttons;
- data becomes geometry: values, counts, rows, chips with data, avatars, a button labelled with a count (that button says so with its own
  `isLoading`, which overrides the region for one control, as does a `Select` waiting for its options);
- loading is not pending: `isPending` keeps its spinner inside the control and never becomes a skeleton;
- only a first load counts: a refresh keeps the old data, with no skeleton flash;
- a `Dialog`, `Drawer` or `Popover` starts a fresh region (the context crosses the portal, so the boundary resets it), and a nested region
  with its own state overrides its parent;
- a create form is never loading, an edit form is while it waits for the existing data.

`aria-busy` has one owner: the region. `Section`, `PaneSection`, `SurfaceCard`, `Form` and a `Dialog` or `Drawer` body carry it, and nothing inside them adds
another (the components read `useRegionOwnsBusy`). A component that loads on its own, outside any region (an explicit `isLoading`: a field, `ChoiceChips`,
`DescriptionList`, `Alert`, `Calendar`, `BarChart`, `Meter`, `Board`, `ScheduleGrid`, a table or list that publishes its own scope), is its own region and carries it.
A `Dialog`, `Drawer`, `Popover`, `DropdownMenu`, `Select` and `ComboBox` popover starts a fresh region, so their content never inherits the page's loading.

The size is held too: `DNA-COMMON-LOADING-SAME-BOX` measures a loading component against its ready twin (story `states-loading-keeps-the-box--loading-keeps-the-box`).
The measure is `DNA-COMMON-LOADING-REGION-INERT` and the story `states-every-component-loading--every-component-loading`; the contract check
`scripts/check-region-loading.mts` lists the components that do not honour the region, each with its reason, in
`packages/grammar/src/common/region-loading.ts`.

## Choose

Choice `loading.choose.status`: what drives a loading flag. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| first read | the region has no data yet | `isLoading` of the read, and nothing else | R367 `no-validating-as-loading` |
| refresh | the region has data and the read revalidates | keep the content; show a quiet suffix at most, never the skeleton | R367 `no-validating-as-loading` |
| several reads | a frame draws from more than one read | build the slot with `slotOfReads` over every read of the frame: loading is any read loading with no data, latched after the first draw; an error reads as an error, never as empty; a count of an unsettled read is hidden, never `0` | R367 `no-swr-default-array` |
| key change | the key of one region changes | reload only the region keyed by it; a slot is never built from another read's status | R367 `no-foreign-slot-status` |
| error | a read failed | that region's `error` slot with its retry; every other region unaffected | R367 `no-swr-default-array`: a failed read is never an empty array |

Choice `loading.choose.shape`: who draws what. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| geometry | the region shows a list, rows, a thread, figures or a card | the Grammar component draws the skeleton from the structure it draws (rows, leading mark, trailing badge, description lines); the block passes `isLoading` and no count | story `states-loading-states--*`; R367 `no-hand-skeleton` |
| placeholder | the block renders its pure half before the data exists | `SlotView` hands `render` one placeholder of the ready shape (known text real, nothing a fake row of data), and the same tree draws with `isLoading` | R92 `slot-status-through-slotview`, `no-placeholder-prop` |
| twin | an author wants a separate loading component | none: the ready tree rests on `isLoading`, never a second tree | R92 `no-resting-twin-component`, `no-resting-branch-at-call-site` |

A placeholder is not the ready data with its lists emptied: that second description of the shape drifts from it (a missing chip,
a different row count), and R367 `no-placeholder-object` refuses a `*Placeholder` object built that way. The block's lowercase
`placeholder` prop and the `render(placeholder, true)` call are the recipe and are never refused.

Choice `loading.choose.situation`: how a situation reads the rows above. The story column names the picture of each; each
component has one story with its states side by side, in both families, both modes and both widths.

| Situation | Loading is | Story |
|---|---|---|
| one read feeds a region | skeleton on the first load, then content; a later refresh keeps the content | `states-loading-states--section-states` |
| several reads feed one frame | one skeleton until every read has settled its first load, then all of it at once | `states-loading-states--pane-section-states` |
| a key changes (a selected room, a filter, a page) | only the region keyed by it returns to skeleton | `states-loading-states--list-box-states` |
| background refresh | the content unchanged; at most the pending cue of the control that asked (CTA-3) | `leaves-skeleton-parity--rows-ready` |
| a read failed | that region's `error` slot with its retry | `states-loading-states--data-table-states` |
| loading ended with no items | the `empty` slot in the collection's place; a list requires `empty` | `states-loading-states--surface-card-list-states` |

A skeleton equals the ready box: the shape comes from the same fields the ready render draws, so nothing jumps when the data lands
(TASTE-10, `SkeletonParity`). Where a block cannot give a same-shape placeholder, the component's default of three rows stands.

## Rules
R367: `starci-fe/no-swr-default-array` (a hook that folds a read to `[]` returns that read's `isLoading`),
`no-foreign-slot-status` (a slot never copies another slot's loading or error; build it from every read it draws with the one
`slotOfReads` helper of hooks/slot), `no-validating-as-loading`, `no-placeholder-object` and `no-hand-skeleton` (an app draws no
`Skeleton` or a hand-drawn bubble skeleton; the plugin requests every published rule at error). The older
LOADING-1 to LOADING-5 laws (`no-resting-twin-component`, `no-placeholder-prop`, `no-resting-branch-at-call-site`) stand beside
them. The codemod `starci app codemod loading-states` renames `isSkeleton` to `isLoading`, drops `loadingRows`, rewrites the old
slot literals, and reports with a code what it cannot rewrite.
