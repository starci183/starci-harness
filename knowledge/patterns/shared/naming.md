# Naming

The identifier forms both sides share. File and folder names, role suffixes, component contracts and type suffixes
are each side's naming topic.

## SHARED-NAMING-1 Identifier case follows what the identifier is

Types, interfaces, classes, enums and components are PascalCase; functions, variables, parameters and hooks are
camelCase; a frozen module-level value (a key, a SQL text, a table of constants) is UPPER_SNAKE. A name a framework or
generator fixes keeps its spelling.

Why: the case tells a reader whether a name is a type, a value or a constant before they open its declaration.

```ts
/** Cache identity of the invoice list. */
export const QUERY_INVOICES_SWR_KEY = "QUERY_INVOICES_SWR"

/** Loads the invoices of the active workspace. */
export const useQueryInvoicesSwr = (workspaceId: string | undefined) => useSWR(/* ... */)
```

Enforced by: back end R89 BE_SOURCE_FORM; front end review only.

## SHARED-NAMING-2 Exports are named; a default export only where a framework loads one

Every export is named. A default export exists only in a file the framework loads by its default: a Next.js route
file (`page.tsx`, `layout.tsx`, `loading.tsx`, `not-found.tsx`, `error.tsx`), which declares a local `const` and ends
`export default Page`, and the test world's `global-setup.ts` and `global-teardown.ts`.

Why: a named export is found by search and renamed in one place; a default lets every importer pick its own name.

```tsx
const Page = async (props: PageProps) => <InvoicesScreen workspaceId={(await props.params).workspaceId} />

export default Page
```

Enforced by: back end `no-default-export` (R89); front end R91 FE_SOURCE_FORM (`route-slot-fixed-name`,
`export-matches-folder`).

## SHARED-NAMING-3 Module-level functions are arrow constants

A function declared at module level, exported or not, is `const name = (...) => ...`, never a `function` declaration.
The one exception is a back-end overload set, which TypeScript can only declare with `function`.

Why: a `const` cannot be used before the line that declares it, so the file reads in the order it runs.

```ts
/** Strips a provider prefix from an external id; a bare id passes through. */
export const bareId = (externalId: string): string => externalId.replace(/^[a-z]+:/, "")
```

Enforced by: front end `prefer-arrow-export` (R91); back end review only.
