---
slots: [fe.hooks.swr, fe.hooks.zustand, fe.redux, fe.hooks.effects, fe.components.providers, fe.modules]
---
# Data and state

How a component reads and writes data and which store owns which state. Libraries are [stack/fe.yaml](../../stack/fe.yaml).

## FE-DATA-SWR One SWR hook per operation; components call hooks only

Each `modules/api` operation has one `hooks/swr` hook ([naming.md](naming.md) FE-NAMING-4, [function.md](function.md)
FE-FUNCTION-6). A query hook may put its result into a store slice; a mutation revalidates the keys it changes on
success. App-wide queries with no component consumer run once in `SwrSideEffects.tsx`, mounted by
`components/providers`. A status that changes on the server is refreshed by exactly one door: SWR `refreshInterval`,
a push ([realtime.md](realtime.md)), never both and never a hand-written timer. Heavy work is a mutation that enqueues
a back-end job, followed through a status query or a push. Components, features and forms never call `modules/api`,
never fetch in an effect.

Why: cache identity, deduplication and revalidation are one decision per resource; a component that calls the
transport repeats it and drifts.

Enforced by: R50, R65, R285 FE_SWR_OUTSIDE_FAMILY.

## FE-STATE-1 Each kind of state has one owner

| State | Owner |
|---|---|
| server data | its SWR hook (the cache) |
| shared by several features (the signed-in user, the entity selected from the route, entities pushed by a socket) | a slice of `redux/slices`, read with the typed `useAppSelector` |
| one feature's UI, wizard or editor state read by several of its components | one store in `hooks/zustand/<store>` |
| one component's own state | `useState` in that component |

React context is not a store. A zustand store holds no server data and no app-wide state; redux holds no
feature-local state.

Why: one owner per kind keeps shared state traceable and the global store small.

## FE-STORAGE Browser storage has one owner

Browser persistence goes through `modules/storage/{local,session}` with an enum of keys and typed values, serialized
by `modules/superjson`. No component, hook or store touches `localStorage`, `sessionStorage` or `document.cookie`.

Why: keys, types and serialization live in one place.
