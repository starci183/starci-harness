# Typing

How strict the compiler is and which spellings tell it something it cannot check. Which type expresses a contract
(wire, feature, view, DTO, projection) is each side's typing topic.

## SHARED-TYPING-1 The repository tsconfig extends the canon preset and adds only paths

Every `tsconfig.json` extends a preset of `@starci/tsconfig` (`be.json` for the back end, `next.json` for a front-end
app or package, the `build.json` and `e2e.json` overlays after the repository config) and sets only what a shared
file cannot hold: `paths`, `include`, `exclude`, `outDir`. It lowers no flag and restates none.

Why: the preset owns every strictness flag once, so both sides compile under the same law, and a restated flag is a
second owner that drifts when the preset changes.

```jsonc
// be/tsconfig.json
{
    "extends": "@starci/tsconfig/be.json",
    "compilerOptions": { "paths": { "@features/*": ["./src/features/*"], "@modules/*": ["./src/modules/*"] } }
}
// fe/apps/<app>/tsconfig.json
{ "extends": "../../tsconfig.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } }, "include": ["src/**/*.ts", "src/**/*.tsx"] }
```

Enforced by: R22 HFS_TS_STRICT (a lowered flag), the `typecheck` gate; a restated flag is review only.

## SHARED-TYPING-2 No type escape; untrusted values are `unknown` and narrowed

No `as T`, `<T>x`, `as unknown as T`, `x!` or `any`, specs included. The only assertion is `as const`; `satisfies`
checks a literal without widening it. A value whose shape is not proven (a caught error, a parsed payload, a provider
answer) is `unknown` and is narrowed by a guard, `in`, a discriminant or the side's parser.

Why: an assertion tells the compiler something it cannot check, so the error moves from the build to the user.

```ts
const isMissingTable = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) return false
    if ("code" in error && error.code === "42P01") return true
    return "driverError" in error && isMissingTable(error.driverError)
}
```

Enforced by: back end R72 BE_TYPE_ESCAPE (`@typescript-eslint/consistent-type-assertions` never,
`no-explicit-any`, `no-non-null-assertion`, `no-function-or-eval`); front end R22 (`no-type-assertion`,
`no-double-cast`, `no-non-null-assertion`, `no-explicit-any`). A single `x as unknown` still passes the front-end lint
and is review only there.

## SHARED-TYPING-3 Arrays are `Array<T>` or `ReadonlyArray<T>`

An array type is written `Array<T>` or `ReadonlyArray<T>`, never `T[]` or `readonly T[]`; a frozen literal uses
`as const`.

Why: one spelling reads the same in every file, and the generic form makes `readonly` a visible choice of the type.

```ts
readonly items: ReadonlyArray<AdjustmentRow>
list(workspaceId: string): Promise<Array<AdjustmentRow>>
```

Enforced by: back end `@typescript-eslint/array-type` (generic) in `@starci/eslint-canon-be`; front end review only.

## SHARED-TYPING-4 The type-aware rules hold on both sides

Every promise is awaited, returned or handled; a promise is never passed where a void callback is expected; a `switch`
over a union names every member; nothing flows out of an `any`; no deprecated API is called; no object is turned into
text by accident; an `async` function awaits.

Why: these are the failures the compiler accepts and production finds; with typed linting a rule asks what a value is,
not what it is called.

```ts
switch (outcome.kind) {
    case "ok":
        return outcome.value
    case "refused":
        throw new OrderError(outcome.code)
}
```

Enforced by: the typescript-eslint rules both canons borrow at `error` (`no-floating-promises`, `no-misused-promises`,
`switch-exhaustiveness-check`, the `no-unsafe-*` family, `no-deprecated`, `no-base-to-string`, `require-await`), plus
the Sonar way block of each canon.
