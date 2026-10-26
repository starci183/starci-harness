---
slots: [fe.feature, fe.components, fe.route]
---
# Function shape and the drawing law

What a component, hook or route function takes and returns. The connected half owns the world; the pure half draws
atoms.

## FE-FUNCTION-1 A component is a named arrow with one props parameter

App components are `export const X = (props: XProps) => ...`, never destructured at the signature, never default
exported (route files excepted, FE-FUNCTION-7). A component that takes nothing declares no parameter.

Why: one props object keeps the three-part contract readable.

Enforced by: R91 FE_SOURCE_FORM.

## FE-FUNCTION-2 The pure half takes `{ state, props, on }` of atoms

A split unit's `component.tsx` exports `XBase(props: XBaseProps)` with:

- `state`: an `XState` value, one of the drawn shapes the owner approved, never a data status;
- `props`: atoms only (strings, numbers, booleans, arrays, plain objects), one resource (`Slot<T>`) per read, and
  resolved labels;
- `on`: actions whose arguments are atoms; a resolved navigation is an href or an action, never a router, mutation or
  transport object.

The children `XBase` renders are written inside it; only a layout also takes `children` (the router's slot).
`component.tsx` exports `xDefaultState`, the shape the skeleton follows while a read loads. A read's status renders
only through the status view ([README](README.md#data-status-of-a-region)). Pure lower tiers take their narrow fields
directly.

Why: a pure half of atoms renders from a fixture, so an audit can draw every shape; keeping status out of `state`
keeps every approved drawing free of states nobody drew.

Enforced by: R92 FE_COMPONENT_API; lint `base-props-atom`, `no-data-status-shape`.

## FE-FUNCTION-3 Contracts live with their owner

A public feature, module or render contract is declared beside its owner and exported from its public entry; a local
render helper keeps an unexported local props type.

## FE-FUNCTION-4 What each half does

When a unit owns a world boundary, its `index.tsx` is the connected `X`: it is `"use client"` when it reads or writes
data, calls `hooks/swr` and `hooks/rhf` hooks (never `modules/api` itself), holds translations, locale, session and
data, folds each read with `toSlot`, picks the shape from data, resolves every label and renders `XBase`. It exports
`X` only. Each block reads its own data; page and layout owners compose overlays and blocks with atoms and read
none; an overlay runs commands and may read list identities. The pure sibling has no runtime world or transport
dependency, and always mounts the same child (never a choice between a connected block and its pure twin).

Why: separating world access keeps presentation pure and requests visible, without boilerplate where no render
contract exists.

Enforced by: R55, R56, R92; layout overlay hosts are [boundaries.md](boundaries.md) FE-BOUNDARY-5.

## FE-FUNCTION-5 When a helper is extracted

Predicates, string builders, repeated JSX fragments stay in the same file; class variants go to `classNames.ts`; a
helper several hooks of one domain share goes to `<domain>.shared.ts`, defined once.

Enforced by: R21 HFS_DUPLICATE_CODE.

## FE-FUNCTION-6 One read, one lifecycle, one resource

A `hooks/swr` hook wraps one `modules/api` operation: a read feeds one resource. A missing input gives a `null` key;
every identity that changes the result, the viewer included, is part of the key; a mutation key includes the
resource it changes. The hook maps the response and wire data to the feature contract and never calls `fetch` or
runs its own poll loop ([data.md](data.md) FE-DATA-SWR).

Why: cache identity is product behaviour; a key without the viewer leaks one user's data to the next.

## FE-FUNCTION-7 The route file

`page.tsx` declares `const Page`, ends `export default Page` and exports `generateMetadata`. It resolves framework
inputs, turns params into atoms and mounts one page owner. A resource that does not exist ends in `notFound()` here:
404 is never a page state, shape or resource status. A route holds no inline component, drawing decision or hook.

Enforced by: R54 FE_ROUTE_FILES_THIN.

## FE-FUNCTION-8 No measured smells

No `await` in a loop (independent steps run with `Promise.all`), no `async` that awaits nothing, no nested
conditional expression, `void` only on a call, no unread props member, no deprecated API (the request locale comes
from `next/root-params`).

Why: the scan measures these on every commit; the lint says it earlier, on the line.

Enforced by: R235 SCAN_SMELL.

## FE-FUNCTION-9 The function line budget

Every function body stays within `ruleParams.common.functionLines` ([hfs/slots.yaml](../../hfs/slots.yaml)); a larger
body is split by responsibility.

Enforced by: R291 HFS_FUNCTION_BUDGET.
