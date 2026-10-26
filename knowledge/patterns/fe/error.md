---
slots: [fe.route, fe.feature, fe.modules.api, fe.transport, fe.package.api]
---
# Failures

How a front-end failure is represented and where it goes: a read failure becomes a region status
([README](README.md#data-status-of-a-region)), a command failure a field error or a toast, a render failure a boundary
([boundaries.md](boundaries.md)).

## FE-ERROR-2 A failure is kept, typed and never folded into empty data

A GraphQL failure rejects (the hook throws when an answer carries no data, so SWR holds it as `error`); a non-Apollo
call that can fail as a business outcome (an identity-provider action, the toast runner) returns the one
`GraphQLResponse<T>` (`success`, `message`, `error`, `data`) declared once in the outcome slot; an unauthenticated
answer is refreshed once and then refused; nothing turns a failure into `null`, `[]` or a silent default.

Why: one vocabulary keeps a failure distinct from valid empty data, and a collapsed failure renders as "nothing here".

```ts
const result = await queryWorkbench({ signal })
if (!result.data) throw new Error("workbench answered no data")
return result.data.workbench
```

Enforced by: R51 (`no-failure-collapse`, `one-outcome-union`, `client-maps-auth-to-refused`, `outcome-kinds-exhaustive`).

## FE-ERROR-3 Hard stops where silence would be wrong

`throw new Error(...)` marks what the code cannot continue without: an answer with no data, a required environment
value missing when `modules/config` is read (no localhost fallback), a part rendered outside its owner; every `catch`
handles, maps or rethrows, and no `console` call stands in for handling.

Why: a silent fallback ships a broken screen that looks working; a throw lands in a boundary or a toast where it is seen.

Enforced by: R49 (`no-hardcoded-endpoint-fallback`), R65 (`no-empty-catch`, `no-console`).

## FE-ERROR-4 Server text never becomes the reason a user reads

A failure the user sees is worded from the catalog by its kind (refused, not found, conflict, generic) or by a known
error code mapped in the domain's `.shared.ts`; a raw `error.message` from the server is never rendered.

Why: server text is in the wrong language, leaks internals and changes without the front end knowing.

Enforced by: review only.
