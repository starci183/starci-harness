# Front-end patterns

How the code of a Next.js front end is written: where a unit lives, what its files are called, how a component
function is shaped, where data, text and colour come from, how a failure travels. A pattern never chooses a
visual; [ui](../../ui/README.md) and the [grammar](../../grammars/README.md) do. Libraries are chosen once in
[stack/fe.yaml](../../stack/fe.yaml); a topic here exists only where using a library still leaves a decision. The
rules both sides share (strict tsconfig, no type escape, docblocks, identifier case, named and arrow exports, owner
entries, Prettier, no suppression, no front-end tests) are [shared](../shared/README.md) and are not repeated here.

Read by: an agent before it writes or reviews front-end code (the topic of each slot it touches); a generator
reads each file's front matter (`slots`, the slot ids it teaches) to map a slot to its topics.

<a id="the-placement-test-fe-rule-ownership"></a>
## FE-RULE-OWNERSHIP The placement test puts each requirement and its check with one owner

Every requirement and its check is placed by four questions, asked in order:

1. Would it hold for any design system? The meaning belongs to universal knowledge: [ui](../../ui/README.md) for
   interface semantics, [hfs](../../hfs/README.md) and these patterns for code law.
2. Is it one grammar's visual choice (a value, token, shape, effect)? That grammar owns it in code, explained in
   [grammars](../../grammars/README.md).
3. Is it about calling the grammar's components (names, props, variants, sizes)? The grammar lint package owns the
   check (`@starci/eslint-grammar-<family>`).
4. Is it checkable on any code whatever the grammar? The universal canon `@starci/eslint-canon-fe` owns the check;
   it names no grammar component, prop, variant or size.

What the app decides, and that it makes no visual choice, is FE-UI-1 in [ui.md](ui.md).

## Data status of a region

FE-ERROR-1: the slot axis of [function.md](function.md) FE-FUNCTION-2. A region that reads data shows its status
through the one status view, in its own place, by one recipe in every app and grammar. A read is folded into a
`DataSlot<T>` (`items`, `isLoading`, `isError`, `isForbidden`; none set means empty) by `slotOfSwr`, and `mapSlot`
carries the status over to the view made of its items. The pure half renders the region through
`components/composites/SlotView` in the region's place, inside the unchanged surface: on error the failure notice with a
retry that re-runs exactly that read; on forbidden the notice for a primary region (`forbidden="notice"`) or nothing
for a secondary one (`"hide"`); empty shows the region's empty sentence. The copy comes from the shared status
namespace through `useSlotLabels`. A signed-out viewer never reaches a region: the proxy and the session gate send them
to sign-in. A missing resource behind a route is `notFound()` in the page owner, never a region status.

Loading is skeleton parity, end to end: `slot.isLoading` makes `SlotView` call `children(placeholder, true)`, so the
loading tree is the ready tree drawn from a `placeholder` value of the same shape, with the same boxes. `isSkeleton` is
passed down to every leaf, and each leaf draws the grammar's skeleton in its own box 
([ui composition](../../ui/composition.md) STATE-8). The one allowed `isSkeleton` branch hides a part that cannot be drawn
without real data (`{isSkeleton ? null : <OrderDisclosure ... />}`); a part that only waits (a button, a field) takes
its flag and rests as itself, and no branch picks between two different elements. A pure block never branches on a
status flag, and nothing draws a page-level loading view except the route's `*LoadingPage` ([boundaries.md](boundaries.md)
FE-BOUNDARY-1).

```tsx
<SlotView slot={props.props.leads} placeholder={LEADS_PLACEHOLDER} labels={props.props.slotLabels} onRetry={props.on.retry}>
    {(leads, isSkeleton) => <LeadRows rows={leads} isSkeleton={isSkeleton} />}
</SlotView>
```

Owners, one copy each: `DataSlot` and `SlotLabels` in `modules/types`, `slotOfSwr`/`mapSlot`/`loadingSlot` in
`hooks/slot/slot.shared.ts`, `useSlotLabels` in `hooks/slot`, the view in `components/composites/SlotView`, a region's
placeholder beside the pure half that draws it. The look of each notice and skeleton is the grammar's.

Why: a region that draws its own loading, error or empty branch is one more variant somebody has to draw, and a
skeleton that is not the ready tree jumps when the data lands.

Enforced by: R92 (`slot-status-through-slotview`, `no-placeholder-prop`, `no-resting-branch-at-call-site`,
`no-resting-twin-component`, `no-data-status-shape`); the DNA gate `skeleton-parity` compares the loading tree with
the ready tree.

## Topics

| Topic | Decides | Rules |
|---|---|---|
| [architecture.md](architecture.md) | tiers and their direction, who owns a world, apps and packages, the front end serves no API | FE-ARCHITECTURE-1..4, FE-ROUTE |
| [folder.md](folder.md) | the source root, the file set of a unit, hooks and modules folders, apps and packages | FE-FOLDER-1..4, FE-APPS-1, FE-PACKAGES-1..3 |
| [naming.md](naming.md) | unit, contract, class-name, hook, operation, key and file names | FE-NAMING-1..5 |
| [function.md](function.md) | the connected and pure halves, `{ shape?, props, on? }`, the shape, slot and error axes per tier, every shape member drawn and storied, route files, page owners | FE-FUNCTION-1..7 |
| [imports.md](imports.md) | the grammar entry, data through hooks, vendor imports | FE-IMPORTS-1..3 |
| [typing.md](typing.md) | readonly props, literal unions, wire vs feature vs view | FE-TYPING-1..3 |
| [comment.md](comment.md) | field and decision comments | FE-COMMENT-1 |
| [boundaries.md](boundaries.md) | error, not-found and loading files, server first, providers, cookies | FE-BOUNDARY-1..4 |
| [error.md](error.md) | the outcome vocabulary, hard stops, where a failure goes | FE-ERROR-2..4 |
| [transport.md](transport.md) | Apollo clients and operations, generated wire types, REST and uploads, the auth client | FE-API-GRAPHQL, FE-WIRE-GENERATED, FE-API-REST, FE-UPLOAD, FE-AUTH |
| [data.md](data.md) | SWR hooks and keys, commands, which store owns which state, browser storage | FE-DATA-SWR, FE-DATA-KEY, FE-DATA-COMMAND, FE-STATE-1, FE-STORAGE |
| [form.md](form.md) | form hooks, contract input bounds, mutation feedback | FE-FORM, FE-TOAST |
| [i18n.md](i18n.md) | next-intl placement, no literal copy, catalogs, navigation, formatting owners | FE-I18N-1..5 |
| [realtime.md](realtime.md) | the push doors and how a push reaches the cache | FE-REALTIME-2, FE-REALTIME |
| [ui.md](ui.md) | composing the grammar, app CSS (layout only), the brand file, glyphs | FE-UI-1, FE-CSS-1..3, FE-ICON |

## Reading order

- **A screen:** [ui](../../ui/README.md) for the decisions, the [grammar contract](../../grammars/contract.md) for the
  API, then [function.md](function.md), this file's status recipe, [ui.md](ui.md), [folder.md](folder.md),
  [naming.md](naming.md), [data.md](data.md), [i18n.md](i18n.md).
- **A new read or write:** [transport.md](transport.md), [data.md](data.md), [form.md](form.md), [error.md](error.md).
- **A new route:** [architecture.md](architecture.md), [function.md](function.md) FE-FUNCTION-5,
  [boundaries.md](boundaries.md).

Every rule here takes the form of [code/README.md](../README.md); an enforcer is a front-end canon or grammar lint
rule id with its HFS rule, or "review only".
