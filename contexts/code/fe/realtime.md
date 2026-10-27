---
slots: [fe.hooks.socketio, fe.hooks.swr, fe.components.providers, fe.modules.api, fe.transport.stream]
---
# Realtime

How the front end receives pushes. The back end decides which door serves a channel
([code/be/realtime.md](../be/realtime.md)); the front end reads that door, in both editions.

## FE-REALTIME-2 The door follows what is pushed and which way

| Channel | Door | Front-end reader |
|---|---|---|
| one-way push (a changing status, job progress, activity, streamed tokens) | server-sent events, the default | a stream operation on the app's one `@starci/event-stream` instance |
| two-way messages (presence, collaborative input) | socket.io | the sockets of `hooks/socketio` and its one side-effect component |
| a typed push of a schema type the client already reads through GraphQL | GraphQL subscription | the Apollo clients folder (graphql-ws) |

Why: the stream is cheaper and resumable; the choice follows what is pushed and which way, not the API's default.

Enforced by: R50 (`fetch-only-in-api-client`: `EventSource` and native WebSocket are refused, socket.io lives only in
`hooks/socketio`); the choice of door is review only.

## FE-REALTIME A push is read by a subscription hook and makes the snapshot stale

`modules/api/sse/clients/event-stream.ts` creates the one instance over the identity client's token and refresh;
a stream operation `modules/api/sse/<area>/stream-<channel>.ts` follows a channel with `{ signal, onOpen, onPush,
report }` and narrows each frame with a guard; `hooks/swr/api/sse/subscriptions/useSubscribe<Channel>Swr.ts` starts it
in `useSWRSubscription` under its key ([data.md](data.md) FE-DATA-KEY), revalidates every read the channel feeds on
(re)open, revalidates the reads a push makes stale, and aborts in its cleanup; the token travels as [BE-REALTIME-3](../be/realtime.md) says.

Why: the query carries the state and the stream only its changes, so revalidating on open closes the gap a reconnect
leaves, and one subscription per channel avoids duplicate listeners and leaked connections.

```ts
return useSWRSubscription<ActivityPush, Error, ActivityKey>(key, ([, workspaceId], { next }) => {
    const controller = new AbortController()
    const staleIn = (names: ReadonlyArray<string>) => (read: unknown) =>
        Array.isArray(read) && read[1] === workspaceId && names.includes(String(read[0]))
    void streamActivity({
        signal: controller.signal,
        onOpen: () => void mutate(staleIn(ALL_READS)),
        onPush: (push) => { next(null, push); void mutate(staleIn(STALE_READS[push.kind])) },
        report: (line) => next(new Error(line)),
    })
    return () => controller.abort()
})
```

Enforced by: R285 (`subscription-refetches-snapshot`, `swr-only-in-family`), R65 (`effect-subscription-needs-cleanup`),
R52 (`no-hand-typed-wire`).
