---
slots: [fe.hooks.swr, fe.hooks.zustand, fe.redux, fe.hooks.effects, fe.components.providers, fe.modules]
---
# Data and state

How a unit reads and writes server data and which store owns which state. Libraries are
[stack/fe.yaml](../../stack/fe.yaml).

## FE-DATA-SWR One SWR hook per operation, and it returns the feature's data

Each `modules/api` operation has one `hooks/swr` wrapper: a query uses `useSWR` (an on-demand read `useSWRMutation`),
passes SWR's abort `signal` to the operation, fails as [error.md](error.md) FE-ERROR-2 says and returns the field the
feature reads; a status that changes on the server refreshes by exactly one door, an SWR `refreshInterval` that returns `0`
once settled or a push ([realtime.md](realtime.md)); no unit fetches in an effect or runs its own timer.

Why: cache identity, deduplication and revalidation are one decision per resource; a unit that calls the transport
repeats it and drifts.

```ts
/** Cache identity of the knowledge read; the workspace id is part of the key. */
export const QUERY_KNOWLEDGE_SWR_KEY = "QUERY_KNOWLEDGE_SWR"

/** Reads the knowledge sources, polling only while one is still being read. */
export const useQueryKnowledgeSwr = () => {
    const key = useWorkspaceKey(QUERY_KNOWLEDGE_SWR_KEY, [])
    return useSWR(key, async ({ signal }: { signal?: AbortSignal } = {}) => {
        const result = await queryKnowledge({ signal })
        if (!result.data) throw new Error("knowledge answered no data")
        return result.data.knowledge
    }, { refreshInterval: (data) => (data?.some((one) => one.status === "reading") ? 4_000 : 0) })
}
```

Enforced by: R285 (`swr-only-in-family`, `operations-only-in-swr-hooks`), R50 (`no-data-fetch-in-effect`), R65
(`no-hand-rolled-polling`).

## FE-DATA-KEY A key carries every identity that changes the answer

A key is `[NAME, ...identities]` built by the app's key helpers (the tenant id read from the store, then the
request's own arguments), `null` while an input is missing; the viewer is isolated by the SWR cache the providers key
by viewer id ([boundaries.md](boundaries.md) FE-BOUNDARY-3), and a stream key also carries the viewer id.

Why: cache identity is product behaviour; a key without the tenant or the viewer shows one workspace's or one user's
data to the next.

Enforced by: R50 (`swr-data-lifecycle`); the use of the key helpers is review only.

## FE-DATA-COMMAND A user-started write runs through a domain command hook

A block calls a domain hook (`hooks/<domain>/use<X>Commands.ts`) that triggers the `useMutate<X>Swr` wrappers through
`useGraphQLWithToast`, returns `undefined` on failure, and on success revalidates exactly the reads the write changed
(the bound `mutate` of their query hooks, or a key matcher on the shared name and tenant id).

Why: one place per write owns its feedback and the reads it makes stale, so no screen shows old data after a save.

```ts
const runGraphQL = useGraphQLWithToast()
const saveProfile = useCallback(async (name: string) => {
    const saved = await runGraphQL(() => profile.trigger({ name }), { successMessage: t("profileSaved") })
    if (saved === undefined) return false
    await Promise.all([refreshAccount(), refreshWorkspaces()])
    return true
}, [runGraphQL, profile, t, refreshAccount, refreshWorkspaces])
```

Enforced by: R50 (`swr-data-lifecycle`), R286 (`no-copy-in-call`); calling a mutation wrapper from a block is review
only.

## FE-STATE-1 Each kind of state has one owner

| State | Owner |
|---|---|
| server data | its SWR hook (the cache) |
| app-wide identity (the viewer id, the active tenant id) | a slice of `redux/slices`, read with `useAppSelector`, written by a `hooks/effects` side effect |
| one feature's UI, wizard or editor state shared by several of its units | one store `hooks/zustand/<store>/store.ts` |
| one unit's own state | `useState` in that unit |

React context is not a store; zustand holds no server data and no app-wide state; redux holds no feature-local state.

Why: one owner per kind keeps shared state traceable and the global store small.

Enforced by: R65 (`unit-hook-budget`); the owner per kind is review only.

## FE-STORAGE Browser storage goes through `modules/storage`

Persistence uses the typed `LocalStorage` of `modules/storage` (an enum of keys, values serialized by
`modules/superjson`, every access guarded for the server and a full quota), the only file that touches `localStorage` or
`sessionStorage`; a cookie is read only by the module that owns it (the locale cookie by the locale link and the
proxy, the session by `modules/auth`).

Why: keys, types, serialization and the server guard live in one place.

Enforced by: R55 (`web-storage-only-in-modules`) for code outside `modules/`; inside `modules/` review only.
