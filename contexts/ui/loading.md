# Loading states

A skeleton is the ready structure with its data missing. It is drawn by the Grammar component from the structure it will draw,
and it is driven by the reads the region shows. Four defects come from the page believing something its reads do not say.

## Choose

Choice `loading.choose.status`: what drives a loading flag. The first row that applies wins.

| Row | When | Choose | Measure |
| --- | --- | --- | --- |
| first read | the region has no data yet | `isLoading` of the read, and nothing else | R367 `no-validating-as-loading` |
| refresh | the region has data and the read revalidates | keep the content; show a quiet suffix at most, never the skeleton | R367 `no-validating-as-loading` |
| several reads | a frame draws from more than one read | loading is any read loading with no data, latched after the first draw; an error reads as an error, never as empty | R367 `no-swr-default-array` |
| key change | the key of one region changes | reload only the region keyed by it | R367 `no-foreign-slot-status` |

Choice `loading.choose.shape`: who draws the skeleton. The Grammar component, from the structure it draws (rows, leading mark,
trailing badge, description lines). An app passes the loading flag and no count; it writes no `Skeleton`, no placeholder object
that is the ready data emptied, and no twin component (R367 `no-placeholder-object`, `no-hand-skeleton`).

## Rules
R367: `starci-fe/no-swr-default-array` (a hook that folds a read to `[]` returns that read's `isLoading`),
`no-foreign-slot-status` (a slot never copies another slot's loading or error; build it from every read it draws with the one
`slotOfReads` helper), `no-validating-as-loading`, `no-placeholder-object`, and `no-hand-skeleton` (written and tested, published when the
Grammar owns the loading shape on `Section`, the list card and the row components: the plugin requests every published rule at error). The older LOADING-1 to LOADING-5 laws
(`no-resting-twin-component`, `no-placeholder-prop`, `no-resting-branch-at-call-site`) stand beside them.
