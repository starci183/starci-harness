---
slots: [fe.feature, fe.components, fe.route]
---
# Function shape: shapes, slots and the drawing law

What a component, route or page owner takes and returns. The connected half owns the world; the pure half draws from
atoms along three axes, its shape, its slots and its errors. This file owns that pattern; the slot's status recipe is
[README](README.md#data-status-of-a-region) FE-ERROR-1, and where every other failure goes is [error.md](error.md).

## FE-FUNCTION-1 A component takes one `props` parameter of a named type

An exported component is `export const X = (props: XProps) => ...` with `XProps` declared in the file, never
destructured in the signature; a component that takes nothing declares no parameter.

Why: one props object reads the same in every file, and a named type is the unit's documented contract.

Enforced by: R92 (`public-component-signature`, `no-inline-parameter-type`), R91 (`prefer-arrow-export`).

## FE-FUNCTION-2 A split unit is `X` over `XBase({ shape?, props, on? })`, drawn on three axes

A page, layout, overlay or block is split: the connected `X(props: XProps)` in `index.tsx` and the pure
`XBase(props: XBaseProps)` in `component.tsx`, where `XBaseProps` is `{ shape?, props, on? }`. `props` holds atoms
(strings, numbers, booleans, arrays and plain objects of them, one `DataSlot<T>` per read, the resolved labels, and for
feature composition a named `render` callback that takes data), `on` holds actions whose arguments are atoms, a layout
alone also takes `children`, and the pure half calls no hook of the world. Only its sibling `index.tsx` imports
`component.tsx`, which never re-exports `XBase`, so only `X` leaves the folder.

The unit is drawn on three axes, and none stands in for another:

- **Shape** (`shape`): `XShape` is the unit's drawn shapes, a string-literal union with product meaning
  (`"prepared" | "sent" | "returned"`); each member is one drawing and one story (FE-FUNCTION-7). A unit with one
  drawing takes no `shape`, and a pure-half input named `state` is refused. No member is a word of data status
  (`pending`, `loading`, `failed`, `error`, `empty`, `forbidden`, `closed`, `idle`); open or closed is a boolean atom.
- **Slot** (inside `props`): one API read is one `DataSlot<T>`, and its status (loading, error, forbidden, empty)
  renders by formula through `SlotView` (FE-ERROR-1). A slot's status is never a shape and is never drawn by hand.
- **Error**: a read failure is its slot's `isError` or `isForbidden`, drawn by `SlotView` with a retry; a write failure
  is a field error or a toast ([form.md](form.md)); a render failure is a boundary ([boundaries.md](boundaries.md)); a
  missing resource is `notFound()` in the page owner. No error is a shape ([error.md](error.md)).

| Tier | Shape | Slot | Error |
|---|---|---|---|
| page, layout, overlay | yes, the arrangement it approves | none: it reads no data and composes the blocks that do | its route's boundary; `notFound()` in the page owner |
| block | yes | one `DataSlot<T>` per read it owns | each slot's, through `SlotView`; its writes' through the toast runner or a field |
| composite | may take `shape` beside its flat fields (FE-FUNCTION-4) | none: it receives an item and `isSkeleton` from its block's `SlotView` | a resolved field error it is handed |
| branch | none: only intrinsic interaction (open, expanded) in its own `useState` | none | none |
| leaf | none | none: it takes `isSkeleton` | none |

Why: a pure half of atoms renders from a fixture, so every shape can be drawn and audited without standing the world
up; a status or a failure kept out of `shape` leaves no shape nobody drew, and a slot fails and waits alone.

Enforced by: R92 (`public-component-signature`, `base-props-atom`, `base-import-pair`, `no-data-status-shape`,
`presentational-purity`, `component-purity`); the shape words of a composite, which is not split, are review only.

## FE-FUNCTION-3 The connected half resolves everything and renders its twin

A connected block's `index.tsx` is `"use client"`, calls the query hooks, domain command hooks, form hooks and
`useTranslations` it needs, folds each read into its slot (`slotOfSwr`, `mapSlot`), resolves every label and every
handler, picks `shape` from data, and on every path that draws renders only its own `XBase`. While the read that
decides the shape is loading, the shape is that slot's placeholder's own, so the skeleton and its shape come from one
value and no default shape is exported. A page or layout owner is the server-side twin of this
([architecture.md](architecture.md) FE-ARCHITECTURE-3).

Why: world access sits in one visible place per unit, and the twin it renders is the one an audit draws.

Enforced by: R92 (`connected-block-has-presentational-twin`), R55 (`use-client-only-at-boundary`), R65
(`unit-hook-budget`).

## FE-FUNCTION-4 A lower tier takes narrow resolved fields

A composite, branch or leaf has no twin and takes the flat fields it draws (`label`, `items`, `isSkeleton`,
`onRetry`, and `shape` for a composite with shapes), already resolved by its block; it never resolves copy, reads data
or chooses between a component and its resting copy, and a leaf hands `isSkeleton` to the grammar component it draws.

Why: a reusable unit stays reusable only while it knows nothing about the product, the session or the catalog.

Enforced by: R58 (`no-copy-resolution-below-block`), R92 (`component-purity`, `no-resting-branch-at-call-site`,
`no-placeholder-prop`).

## FE-FUNCTION-5 The route file adapts; the page owner holds the metadata

`page.tsx` declares `const Page` (async only when it awaits `params`), passes atoms to one page owner and re-exports
that owner's metadata function as `generateMetadata`; the page owner exports `<x>Metadata`, which reads its title from
the catalog with `getTranslations`, and calls `notFound()` for a resource that does not exist.

Why: the route stays a table of contents, and the title lives beside the copy of the page it names.

```tsx
import { LeadPage } from "@/features/pages/LeadPage"

/** The document title of this page. */
export { leadPageMetadata as generateMetadata } from "@/features/pages/LeadPage"

type PageProps = { readonly params: Promise<{ readonly id: string }> }

/** Adapts the lead route to its page owner. */
const Page = async (props: PageProps) => <LeadPage leadId={(await props.params).id} />

export default Page
```

Enforced by: R54 (`route-files-thin`, `route-adapter`, `page-exports-metadata`), R91 (`route-slot-fixed-name`).

## FE-FUNCTION-6 A function stays within its budget and free of measured smells

The function budget and parameter limit of [BE-FUNCTION-7](../be/function.md) and the measured smells of
[BE-FUNCTION-10](../be/function.md) hold for every front-end function; a larger body is split by responsibility, and a
helper several units need has its one home by [folder.md](folder.md) FE-FOLDER-3.

Why: the scan measures these on every commit; the lint says it earlier, on the line.

Enforced by: R291 (`function-line-budget`), R235 (`no-await-in-loop`, `no-nested-conditional`, `no-void-operator`,
`max-params`), R21 (`duplicate-code`).

## FE-FUNCTION-7 Every shape member is enumerated, drawn and storied

`XShape` is declared from its inventory (`export const X_SHAPES = [...] as const`, `type XShape = (typeof
X_SHAPES)[number]`); an author or generator lists every member before writing the unit, the pure half covers every
member in one exhaustive `switch` on `shape`, and every member has one story of `XBase` drawn from a fixture
(`args: { shape: "<member>" }`), plus one skeleton story in which each slot is loading so its `SlotView` draws its
placeholder (`parameters: { dna: { pair, phase: "loading" } }`, the pair the DNA gate compares). The standard states
of an interactive leaf or control (default, filled or selected, disabled, invalid, loading) are the grammar's to
render ([ui/components](../../ui/components/README.md) "States"), not a shape of the unit.

Why: a member nobody enumerated is a screen nobody drew, and it surfaces first in production.

Enforced by: R92 (`exhaustive-shape-switch`, `shape-has-story`).

## The pattern at work: a handoff block

A handoff block reads two APIs, the order and the handoff, so it holds two slots that wait and fail alone. Its shapes
are the handoff's statuses on the server, `prepared`, `sent` and `returned`, each its own arrangement: a sent handoff
shows its receipt, a returned one its reason and a resend action. The connected half folds both reads, takes `shape`
from the handoff (from `HANDOFF_PLACEHOLDER` while it loads) and resolves the labels; the pure half switches on `shape`, and
each region draws through `SlotView`. While the order loads, the summary draws its leaves in skeleton from the
placeholder, the send button rests as itself, and only the order-lines disclosure is hidden, because it cannot be
drawn without the real lines. Its stories are `prepared`, `sent`, `returned` and the skeleton.

```tsx
// HandoffBlock/component.tsx (excerpt)
/** The handoff shapes, in the order the owner approved them. */
export const HANDOFF_SHAPES = ["prepared", "sent", "returned"] as const
/** One drawing per handoff shape the owner approved. */
export type HandoffShape = (typeof HANDOFF_SHAPES)[number]

/** Fake data of the same shape: the skeleton reuses the ready tree. */
export const HANDOFF_PLACEHOLDER: Handoff = { status: "prepared", fingerprint: "fp-0000", revision: 0 }

export interface HandoffBlockBaseProps {
    readonly shape: HandoffShape
    readonly props: { readonly order: DataSlot<OrderView>; readonly handoff: DataSlot<Handoff>; readonly labels: HandoffLabels }
    readonly on: { readonly requestSend: (input: SendInput) => void; readonly retryOrder: () => void; readonly retryHandoff: () => void }
}

const HandoffOrder = (props: HandoffBlockBaseProps) => (
    <SlotView slot={props.props.order} placeholder={ORDER_PLACEHOLDER} labels={props.props.labels.orderSlot} onRetry={props.on.retryOrder}>
        {(order, isSkeleton) => (
            <>
                <OrderSummary customer={order.customer} amount={order.amountText} isSkeleton={isSkeleton} />
                {isSkeleton ? null : <OrderDisclosure lines={order.lines} title={props.props.labels.lines} />}
            </>
        )}
    </SlotView>
)

const HandoffBody = (props: HandoffBlockBaseProps) => {
    switch (props.shape) {
        case "prepared": return <HandoffPrepared {...props} />
        case "sent": return <HandoffSent {...props} />
        case "returned": return <HandoffReturned {...props} />
    }
}

// HandoffBlock/index.tsx (excerpt)
const handoffRead = useGetHandoffSwr({ handoffId: props.handoffId })
const handoff = slotOfSwr(handoffRead)
const shape = (handoff.items ?? HANDOFF_PLACEHOLDER).status
```
