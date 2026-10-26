---
slots: [fe.feature, fe.components, fe.route]
---
# Function shape and the drawing law

What a component, route or page owner takes and returns. The connected half owns the world; the pure half draws from
atoms.

## FE-FUNCTION-1 A component takes one `props` parameter of a named type

An exported component is `export const X = (props: XProps) => ...` with `XProps` declared in the file, never
destructured in the signature; a component that takes nothing declares no parameter.

Why: one props object reads the same in every file, and a named type is the unit's documented contract.

Enforced by: R92 (`public-component-signature`, `no-inline-parameter-type`), R91 (`prefer-arrow-export`).

## FE-FUNCTION-2 The pure half takes `{ state, props, on }` of atoms

A split unit's `component.tsx` exports `XBase(props: XBaseProps)` where `props` holds resolved atoms (strings,
numbers, booleans, arrays and plain objects of them, a `DataSlot<T>` per read, the labels), `on` holds actions whose
arguments are atoms, and `state` (only when the unit has more than one drawn shape) names the shape, never a data
status; it calls no hook of the world, writes its children inside itself, and a layout alone also takes `children`.

Why: a pure half of atoms renders from a fixture, so every shape can be drawn and audited without standing the world
up, and a status kept out of `state` leaves no shape nobody drew.

```tsx
/** Copy, values and actions the connected profile card supplies. */
export interface ProfileCardBaseProps {
    readonly props: {
        readonly title: string
        readonly name: string
        readonly saveLabel: string
        readonly isPending: boolean
        readonly isLoading: boolean
        readonly error?: string | undefined
    }
    readonly on: { readonly setName: (value: string) => void; readonly submit: () => void }
}
```

Enforced by: R92 (`base-props-atom`, `no-data-status-shape`, `presentational-purity`, `component-purity`,
`base-import-pair`).

## FE-FUNCTION-3 The connected half resolves everything and renders its twin

A connected block's `index.tsx` is `"use client"`, calls the query hooks, domain command hooks, form hooks and
`useTranslations` it needs, folds each read, resolves every label and every handler, and on every path that draws
renders only its own `XBase`; a page or layout owner does the same on the server with `getTranslations` and no data.

Why: world access sits in one visible place per unit, and the twin it renders is the one an audit draws.

```tsx
"use client"

/** The connected profile card: saves the display name and reports the outcome through the account commands. */
export const ProfileCard = () => {
    const t = useTranslations("account")
    const { data, isLoading } = useQueryMyAccountSwr()
    const { saveProfile, isSaving } = useAccountCommands()
    const form = useProfileForm(data?.name ?? "")
    const submit = form.handleSubmit(async (values) => void (await saveProfile(values.name)))
    return (
        <ProfileCardBase
            props={{ title: t("profileTitle"), name: form.watch("name"), saveLabel: t("save"), isPending: isSaving, isLoading }}
            on={{ setName: (value) => form.setValue("name", value), submit: () => void submit() }}
        />
    )
}
```

Enforced by: R92 (`connected-block-has-presentational-twin`), R55 (`use-client-only-at-boundary`), R65
(`unit-hook-budget`).

## FE-FUNCTION-4 A lower tier takes narrow resolved fields

A composite, branch or leaf has no twin and takes the flat fields it draws (`label`, `items`, `isSkeleton`,
`onRetry`), already resolved by its block; it never resolves copy, reads data or chooses between a component and its
resting copy.

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

Every function body stays within `ruleParams.common.functionLines` ([hfs/slots.yaml](../../hfs/slots.yaml)) and holds
no `await` in a loop (independent steps run with `Promise.all`), nested conditional expression, `void` on anything
but a call, unread prop, or more parameters than the Sonar way allows; a larger body is split by responsibility,
and a helper several hooks of one domain share is defined once in `<domain>.shared.ts`.

Why: the scan measures these on every commit; the lint says it earlier, on the line.

Enforced by: R291 (`function-line-budget`), R235 (`no-await-in-loop`, `no-nested-conditional`, `no-void-operator`,
`no-unused-prop-types`, `max-params`), R21 (`duplicate-code`).
