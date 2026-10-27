---
slots: []
---
# Naming

What a front-end folder, export, contract, constant or file is called. Identifier case, named exports and the route
file's `export default Page` are [shared naming](../shared/naming.md) SHARED-NAMING-1..3.

## FE-NAMING-1 The folder is the export

A unit folder `X` exports `X` from `index.tsx` and, when split, `XBase` from `component.tsx`; only `X` leaves the
folder, and a route file's local component is named after its slot (`Page`, `Layout`, `Template`, `Loading`,
`ErrorBoundary`, `GlobalError`, `NotFound`).

Why: the path predicts the name, and `Base` marks the pure half ([function.md](function.md) FE-FUNCTION-2 says who may
import it).

Enforced by: R91 (`export-matches-folder`, `route-slot-fixed-name`, `no-runtime-namespace`), R92 (`base-import-pair`).

## FE-NAMING-2 A unit's contract has fixed part names

`XProps` is the connected input, `XBaseProps` the pure input and `XShape` its union of drawn shapes, whose meaning is
[function.md](function.md) FE-FUNCTION-2; a pure half's actions are bare verbs inside `on` (`on.retry`, `on.select`), while a flat prop or a local handler that a
reader triggers is `onX`, never `handleX`; a boolean field starts with `is` or `has`.

Why: a predictable vocabulary lets a reader find the part they need, and `onX` keeps one name from the declaration to
the call site.

Enforced by: R92 (`base-props-atom`), R91 (`handler-on-prefix`); the `is`/`has` prefix is review only.

## FE-NAMING-3 Class-name exports are UPPER_SNAKE constants built with `cn`

`classNames.ts` exports one constant per layout role, `<ROLE>_CLASS_NAME` built with `cn` from single utility
tokens, a map of roles as `<ROLE>_CLASS_NAMES` (`as const`), and a call-time variant as `<role>ClassNameOf(...)`.

Why: a named constant per role keeps class strings out of the markup and lets a reader find every box a unit owns in
one file.

```ts
import { cn } from "@heroui/react"

/** The form column, capped to the form measure. */
export const FORM_CLASS_NAME = cn("flex", "max-w-md", "flex-col", "gap-4")

/** The action row under a form. */
export const ACTIONS_CLASS_NAME = cn("flex", "flex-wrap", "items-center", "gap-3")
```

Enforced by: R92 (`class-names-in-colocated-file`, `no-inline-class-name`, `cn-arguments-are-single-tokens`); the
export names are review only.

## FE-NAMING-4 Hooks, operations and cache keys name their family

A query is `modules/api/graphql/queries/query-<x>.ts` exporting `query<X>`, a mutation `mutations/mutation-<x>.ts`
exporting `mutate<X>`, a stream `sse/<area>/stream-<channel>.ts` exporting `stream<Channel>`; their hooks are
`hooks/swr/api/graphql/queries/useQuery<X>Swr.ts`, `.../mutations/useMutate<X>Swr.ts`, REST
`use{Get,Post,Put,Patch,Delete}<X>Swr` and `.../subscriptions/useSubscribe<X>Swr.ts`, each exporting its key
`QUERY_<X>_SWR_KEY = "QUERY_<X>_SWR"` (`MUTATE_`, `SUBSCRIBE_`); a form hook is `hooks/rhf/use<X>Form.ts`.

Why: the name says whether a file is an operation, a cache owner or a form, and which operation a hook wraps.

Enforced by: R56 (`hooks-folder-holds-hooks-only`), R285 (`swr-only-in-family`, `operations-only-in-swr-hooks`);
the operation and key names are review only.

## FE-NAMING-5 File and folder case follows the folder kind

Component and feature folders are PascalCase; hook files equal their export (`useActiveWorkspace.ts`); a hook domain
folder is camelCase (`hooks/bookingDesk/` with `bookingDesk.shared.ts`); module folders and files are kebab-case
(`modules/work-threads/`, `auth-routes.ts`, `put-presigned.ts`); generated names stay the generator's.

Why: the case tells a reader the kind of file before they open it, and one spelling per kind stops two folders for
one domain.

Enforced by: R91 (`export-matches-folder`, `no-second-language-in-path`), R56; the domain and module case is review
only.
