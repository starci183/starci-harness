---
slots: [fe.route, fe.feature, fe.modules.api, fe.transport, fe.package.api]
---
# Failures

How a front-end failure is represented and where it goes. A read failure becomes a region status
([README](README.md#data-status-of-a-region), FE-ERROR-1); a command failure becomes a field error or a toast; only a
render failure reaches a boundary.

## FE-ERROR-2 Failures cross the client as one envelope

Every `modules/api` operation returns the one `GraphQLResponse<T>` (`success`, `message`, `error`, `data`). The hook
handles it before returning data: valid empty data stays a value; a response without data or with `success: false`
is a failure the hook throws (SWR holds it) or the toast reports. The error link maps unauthenticated and forbidden
answers to a refusal (one token refresh, then sign-in). A raw server error text is never shown as the reason;
normal business outcomes (pending, refused by policy) stay typed data.

Why: one vocabulary keeps failure distinct from valid empty data and keeps server text out of the interface.

Enforced by: R51 FE_HTTP_STATUS_COLLAPSE.

## FE-ERROR-3 Hard stops where silence would be wrong

`throw new Error(...)` marks what the code cannot continue without: a required payload absent, a part rendered
outside its owner, a required environment value missing in production (thrown when `modules/config` loads, with no
localhost fallback). It never replaces a typed business outcome.

## FE-ERROR-4 Propagation stays with the owner of visible state

A hook does not catch what SWR stores; the connected half maps it. A write that needs feedback names one feedback
owner ([form.md](form.md) FE-TOAST). An uncaught render failure goes to the error boundaries
([boundaries.md](boundaries.md)). Error reporting is configured in the instrumentation files with its settings from
`modules/config`.

Enforced by: R53.
