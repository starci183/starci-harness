---
slots: [be.feature.realtime, be.feature.realtime.sse, be.feature.realtime.websocket, be.feature.realtime.graphql, be.feature.realtime.dto]
---
# Realtime channels

How a state change reaches a connected client: a realtime channel whose one door only reads and pushes through the
`RealtimeHub` of `platform/realtime`, on topics built from the principal, published by the domain service that commits
the change. Doors and rules are the same in both editions; scale is the hub binding.

## BE-REALTIME-1 A channel is a kind folder with one door

`features/realtime/<channel>/` holds `index.ts` and `transport/<protocol>/` with `<channel>-<protocol>.module.ts` and
one door with its spec: `<channel>.controller.ts` with one `@Sse` method (the default), `<channel>.gateway.ts` (a socket
gateway, only for two-way messages) or `<channel>.subscription.ts` (a GraphQL subscription, only for a typed payload on
a GraphQL client). A door holds no query, mutation or other route; only an api app composes it.

Why: SSE is plain HTTP, self-reconnecting and resumable, so the heavier doors are chosen only for what only they give.

Enforced by: `realtime-shape` (R184), `rest-door-needs-a-reason` (R278).

## BE-REALTIME-2 A door reads the hub and nothing else; the committing service publishes

A door injects only `@InjectRealtimeHub() private readonly hub: RealtimeHub` and returns
`this.hub.stream(topic, { after: lastEventId })`. No manager, bus, queue or domain service, so a long-lived connection
cannot write. It sends no snapshot: the client reads current state through a membership-checked query on every open.
The domain service that commits a change publishes the frames: on the Postgres hub inside its transaction (`within`),
on Redis or memory after the transaction resolved.

Why: a door that can only touch the hub cannot change business state, and a frame pushed before commit can announce a
change that rolls back.

Enforced by: `realtime-read-only` (R185), `feature-thin` (R203), `infra-import-owner` (R90).

## BE-REALTIME-3 The topic starts with the principal; membership is enforced on publish

Every stream takes `@CurrentPrincipal()` and builds its topic with the owning domain's pure topic builder
(`<name>.policy.ts`, exported by the capability, returning a typed `RealtimeTopic<Frame>`) from the principal's id plus
any client selector inside that prefix. The publisher reads the current members and publishes one frame per member
topic, so a non-member's stream stays silent. A stream is never `@Public`; the browser authenticates with its bearer
token, never a token in the URL, and `Last-Event-ID` only resumes inside the caller's own topic.

Why: a topic taken from client input alone lets anyone who knows an id watch it.

```ts
/** The typing frames of one room the caller may see, as server-sent events. */
@Sse()
stream(
    @CurrentPrincipal() principal: Principal,
    @WorkspaceId() workspaceId: string,
    @Query() query: TypingStreamQuery,
    @Headers("last-event-id") lastEventId?: string,
): Observable<MessageEvent> {
    return this.hub.stream(typingTopic(principal.id, workspaceId, query.room), { after: lastEventId })
}
```

Enforced by: `realtime-topic-scope` (R186), `public-needs-reason` (R41).

## BE-REALTIME-5 A stream resumes, beats and stays unbuffered

Each frame's `id` is unique within its topic; the hub keeps a bounded replay per topic, so a reconnect with
`Last-Event-ID` gets what it missed (an expired id replays the buffer; the client refetches its snapshot on open). The
heartbeat stays below the ingress idle timeout, and the ingress neither compresses nor buffers the stream.

Why: a quiet stream is cut by proxies, a buffered one delivers nothing, and a stream without ids loses every push made
during a reconnect.

Enforced by: `realtime-shape` (R184); ingress settings are review only.

## BE-REALTIME-7 One hub port, a shared adapter when replicas share traffic

`platform/realtime` binds the `RealtimeHub` port to memory (one process, tests), Postgres (a `realtime_events` table
with NOTIFY and LISTEN on a session connection, swept by a bounded job) or Redis (a capped stream per topic), selected by
`parseRealtimeConfig`; more than one api replica uses Postgres or Redis. On a lost listener the shared hubs pause and
reload each followed topic from its last position, skipping and duplicating nothing.

Why: an in-process hub loses every push published on another replica and every replay a reconnect lands away from.

Enforced by: `infra-import-owner` (R90), R266.

## BE-REALTIME-4 Delivery is proven with a real client

An app declaring `realtime` proves `subscriber-receives-push`, `foreign-topic-is-isolated`,
`disconnect-releases-subscription`, `push-crosses-replicas` and `resume-after-reconnect` in specs titled
`realtime/<scenario>: ...`, with a real event-stream or socket client carrying the principal's token (integration in
lite). The door's spec covers its wiring with a hub double.

Why: the door has no logic; the risk is delivery, isolation and leaks on a real connection.

Enforced by: R155, R284.
