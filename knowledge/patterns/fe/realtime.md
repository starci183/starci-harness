---
slots: [fe.hooks.socketio, fe.hooks.swr, fe.components.providers, fe.modules.api, fe.transport.stream]
---
# Realtime

How the front end receives pushes. The back end decides which door serves a channel
([patterns/be/realtime.md](../be/realtime.md)); the front end uses that door, in both editions.

## FE-REALTIME-2 The door follows what is pushed and which way

| Channel | Door | Front-end reader |
|---|---|---|
| one-way push (a changing status, job progress, streamed tokens) | server-sent events, the default | the event-stream instance |
| two-way messages (chat, presence, collaborative input) | socket.io | the socket singletons of `hooks/socketio` |
| a typed push of a schema type the client already reads through GraphQL | GraphQL subscription | the Apollo clients folder (graphql-ws) |

Every door is opened by the transport client layer, exposed as an operation and consumed through an SWR subscription
hook (a socket through the one side-effect component); nothing loads data inside an effect. A resource is refreshed
by one door only: a pushed resource's query hook does not poll.

Why: the stream is cheaper and resumable; the choice is made by what is pushed and which way, not by the API default.

Enforced by: R65.

## FE-REALTIME The readers

- **Server-sent events.** The app creates one `@starci/event-stream` instance in
  `modules/api/sse/clients/event-stream.ts` over the identity client's token (`createEventStream`); it resolves the
  back-end URL at the first connect. A stream operation `modules/api/sse/<area>/stream-<channel>.ts` follows a stream
  on it, and `hooks/swr/api/sse/subscriptions/useSubscribe<Channel>Swr.ts` (`useSWRSubscription`, keyed
  `SUBSCRIBE_<CHANNEL>_SWR_KEY` plus the stream's identity) starts it and returns the abort. Each push is written to the
  query's key with `mutate(key, data, { revalidate: false })`. No app keeps a hand-written stream reader; a token never
  travels in the URL.
- **GraphQL subscription.** Only the Apollo clients folder imports graphql-ws (the bearer token as a connection
  parameter). The operation is `modules/api/graphql/subscriptions/subscription-<name>.ts`; its hook is a
  `useSubscribe<Name>Swr` like the stream hook.
- **Snapshot on (re)open.** Every subscription hook passes its operation an `onOpen` that revalidates the snapshot
  query: the query carries the state, the subscription only the changes after it.
- **socket.io.** `hooks/socketio/sockets.ts` creates one socket per back-end namespace from one Manager (no
  auto-connect, websocket transport only, backoff, the token supplied per attempt through `socket.auth`).
  `SocketIoSideEffects.tsx`, mounted once in `components/providers`, connects on sign-in, disconnects on sign-out,
  registers listeners and writes each event to the store or the SWR keys it changes; `enums/` name the events and
  `types/` their payloads. A consumer gets a socket through a `use<X>SocketIo` hook only to emit.

A domain hook composes the query hook and the subscription hook.

Why: one connection per channel and one place that turns events into state avoid duplicate listeners, leaked
connections and gaps after a reconnect.

Enforced by: R50, R65.
