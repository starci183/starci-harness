---
slots: []
---
# Naming

What a front-end folder, export, type, constant or file is called. A name carries its slot and its role, so a reader
finds a part without opening the file and a duplicate shows up by name.

## FE-NAMING-1 The folder is the export

A unit's folder name is its public export. A split unit exports `X` from `index.tsx` and `XBase` from `component.tsx`;
only `X` leaves the folder. A lower tier without a world owner exports `X` alone. A route file declares a local
`const Page` (or `Layout`, `Loading`, `NotFound`, `ErrorBoundary`) and ends `export default Page`; every other export
is a named `export const`.

Why: matching names make ownership discoverable, and `Base` marks the pure half only its own `index.tsx` imports.

Enforced by: R91 FE_SOURCE_FORM.

## FE-NAMING-2 Contracts and their parts

`XProps` is the connected input; `XBaseProps` is `{ state, props, on }`; `XState` the union of drawn shapes; `XData`,
`XActions` and `XLabels` its parts; `xDefaultState` the skeleton's shape; `X_STATES` the exported inventory. One
public entry never exports two shapes under one `XProps` name. No `XState` member names a data status (pending,
loading, failed, empty, forbidden, closed).

Why: a predictable vocabulary lets a reader find the part they need.

Enforced by: R92 FE_COMPONENT_API.

## FE-NAMING-3 Class-name exports

`classNames.ts` exports one role as `xClassName`, a map of roles as `xClassNames` (`as const`) and a call-time
variant as `getXClassName(...)`. The strings hold layout classes only ([ui.md](ui.md) FE-CSS-1).

Why: a named export per role keeps class strings in one place and out of the component body.

## FE-NAMING-4 Hooks, operations and cache keys

Every authored hook lives under `hooks/`, starts with `use`, names the lifecycle it owns and is the only export of a
file named after it. Data hooks: `hooks/swr/api/graphql/queries/useQuery<X>Swr.ts`,
`.../mutations/useMutate<X>Swr.ts`, `.../subscriptions/useSubscribe<X>Swr.ts`, REST
`useGet|usePost|usePut|usePatch|useDelete<X>Swr`; keys `QUERY_<X>_SWR_KEY`, `MUTATE_<X>_SWR_KEY`,
`SUBSCRIBE_<X>_SWR_KEY`. Forms: `hooks/rhf/use<X>Form.ts`. Operations: `modules/api/graphql/queries/query-<x>.ts`
exporting `query<X>`, `.../mutations/mutation-<x>.ts` exporting `mutate<X>`. Generated names stay the generator's.

Why: the name says whether a file is a hook, an operation or a shared helper.

Enforced by: R56, R285 FE_SWR_OUTSIDE_FAMILY.

## FE-NAMING-5 Constants and vocabularies

Frozen module values are `UPPER_SNAKE`. Component vocabulary is a string-literal union, never an enum; wire and
provider enums stay in the transport adapter. A name a framework mandates in a pinned file keeps the framework's
spelling ([folder.md](folder.md) front matter).

## FE-NAMING-6 Handlers, booleans, local helpers

Actions on the pure half are bare verbs inside `on` (`on.send`, never `onSend`). Boolean props start with `is` or
`has`. Local helpers are camelCase; local sub-renders are PascalCase with their own props type.

Why: the pure half describes what can happen, not how the owner names its callbacks.

## FE-NAMING-7 File names outside component folders

Hook files are camelCase equal to the export (`useSessionToken.ts`); module files are kebab-case
(`create-client.ts`, `sales-summary.mapper.ts`).

Enforced by: R91.
