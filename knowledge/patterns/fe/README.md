# Front-end patterns

How the code of a Next.js front end is written: where a unit lives, what its files are called, how a component
function is shaped, where data, text and colour come from, how a failure travels. A pattern never chooses a
visual; [ui](../../ui/README.md) and the [grammar](../../grammars/README.md) do. Libraries are chosen once in
[stack/fe.yaml](../../stack/fe.yaml); a topic here exists only where using a library still leaves a decision.

Read by: an agent before it writes or reviews front-end code (the topic of each slot it touches); a generator
reads each file's front matter (`slots`, the slot ids it teaches) to map a slot to its topics.

## The placement test (FE-RULE-OWNERSHIP)

Every requirement and its check is placed by four questions, asked in order:

1. Would it hold for any design system? The meaning belongs to universal knowledge: [ui](../../ui/README.md) for
   interface semantics, [hfs](../../hfs/README.md) and these patterns for code law.
2. Is it one grammar's visual choice (a value, token, shape, effect)? That grammar owns it in code (`dna.ts`, its
   stylesheet), explained in [grammars](../../grammars/README.md).
3. Is it about calling the grammar's components (names, props, variants, sizes)? The grammar lint package owns the
   check (`@starci/eslint-grammar-common`, plus `@starci/eslint-grammar-<id>`).
4. Is it checkable on any code whatever the grammar? The universal canon `@starci/eslint-canon-fe` owns the check;
   it names no grammar component, prop, variant or size.

One owner for meaning, one for values, one for checks: a grammar change never rewrites universal law, and the
universal canon never couples to one component API.

## What the app decides

The app supplies product facts, copy keys, routes, data and **layout on the boundaries it owns**. It never makes
a visual choice: a component, its variant, size, tone, paint, radius or depth is either decided by a rule in
[ui](../../ui/README.md) or resolved by the grammar from context. If a screen seems to need a visual choice the
app could make two ways, the grammar is missing an API or ui is missing a rule; record the gap
(`COMMON_CAPABILITY_MISSING`) and add it there first ([ui.md](ui.md) FE-UI-1).

## Data status of a region

A region that reads data renders its status by one recipe, in every app and grammar:

- The connected half folds each read into a resource with `toSlot` (`Slot<T>`: value, `isLoading`, `isError`,
  `isUnauthorized`, `isForbidden`, empty). 401 stays unauthorized and 403 forbidden, never error; any other
  failure is error.
- The pure half renders the region through the product's one status view (`components/composites/SlotView`) in
  the region's own place, inside the unchanged surface: loading draws the region's skeleton from
  `xDefaultState`; error shows the failure notice with a retry that re-runs exactly that read; a primary
  unauthorized region shows one sign-in prompt that returns to this address, a primary forbidden region the
  forbidden notice, and a secondary region unmounts for either; empty shows the region's empty notice.
- Copy comes from the shared status namespace (`useSlotLabels`); `XState` never holds a data status
  ([function.md](function.md) FE-FUNCTION-2).
- A missing resource behind a route is `notFound()` in the route file, never a region status.

Owner of the recipe files: one copy each of `components/composites/SlotView`, `modules/slot` (`Slot`, `toSlot`)
and `hooks/slot/useSlotLabels`. The look of each notice and skeleton is the grammar's
([common](../../grammars/common.md)).

## Topics

| Topic | Decides | Rules |
|---|---|---|
| [architecture.md](architecture.md) | route adapters, responsibility direction, world ownership, apps and packages, the front end serves no API | FE-ARCHITECTURE-1..5, FE-ROUTE |
| [folder.md](folder.md) | tier directories, the file set of a unit, framework-pinned root files, hooks and modules, apps and packages | FE-FOLDER-1..4, 6, FE-APPS-1..3, FE-PACKAGES-1..4 |
| [naming.md](naming.md) | unit, export, contract, class-name, hook, operation and file names | FE-NAMING-1..7 |
| [function.md](function.md) | component shape, the `{ state, props, on }` drawing law, connected and pure halves, route files, function budget | FE-FUNCTION-1..9 |
| [imports.md](imports.md) | paths, direction, vendor boundaries, re-exports, forbidden imports | FE-IMPORTS-1, 3, 5-7 |
| [typing.md](typing.md) | strict flags, readonly, literal unions, wire vs feature vs view contracts | FE-TYPING-1..8 |
| [comment.md](comment.md) | docblocks, decision prose, what a comment never holds | FE-COMMENT-1..5 |
| [boundaries.md](boundaries.md) | error, not-found and loading boundaries, server first, cookies, the layout overlay host | FE-BOUNDARY-1..5 |
| [error.md](error.md) | the response envelope, hard stops, propagation | FE-ERROR-2..4 |
| [transport.md](transport.md) | Apollo clients and operations, generated wire types, REST and uploads, the auth client | FE-API-GRAPHQL, FE-WIRE-GENERATED, FE-API-REST, FE-UPLOAD, FE-AUTH |
| [data.md](data.md) | SWR hooks, which store owns which state, browser storage | FE-DATA-SWR, FE-STATE-1, FE-STORAGE |
| [form.md](form.md) | forms, contract-derived input bounds, mutation feedback | FE-FORM, FE-TOAST |
| [i18n.md](i18n.md) | next-intl placement, no literal copy, catalog parity, navigation, formatting owners | FE-I18N, FE-I18N-1..5 |
| [realtime.md](realtime.md) | the three push doors and how the front end reads each | FE-REALTIME, FE-REALTIME-2 |
| [ui.md](ui.md) | composing the grammar, app CSS (layout only), the brand file, glyphs | FE-UI-1, FE-CSS-1..4, FE-ICON |

## Reading order

- **A screen on a grammar:** [ui](../../ui/README.md) for the decisions, the [grammar contract](../../grammars/contract.md)
  for the API, then [ui.md](ui.md), [function.md](function.md), this file's status recipe, [folder.md](folder.md),
  [naming.md](naming.md), [data.md](data.md), [i18n.md](i18n.md); lint proves the rest.
- **A new data read or write:** [transport.md](transport.md), [data.md](data.md), [error.md](error.md), [form.md](form.md).
- **A new route:** [architecture.md](architecture.md), [boundaries.md](boundaries.md), [function.md](function.md) FE-FUNCTION-7.

## House rules

One place per rule: each rule lives in exactly one file under one id, and every other file links to it. Feedback
hardens the rule in that place (a stricter sentence, a grammar API that removes the choice, or a lint rule);
it is never a case note added beside it. Rule ids cite the HFS catalog ([hfs/rules.yaml](../../hfs/rules.yaml));
what a lint rule flags is the rule's own documentation, not repeated here.
