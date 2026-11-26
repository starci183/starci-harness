---
slots: [be.feature.realtime, be.feature.realtime.sse, be.feature.realtime.websocket, be.feature.realtime.graphql, be.feature.realtime.dto]
---
# Realtime channels

How a state change reaches a connected client: a realtime channel whose one door only reads and pushes through the
`RealtimeHub` of `platform/realtime`, on topics built from the principal, published by the domain service that commits
the change. Scale is the hub binding.

## BE-REALTIME-1 A channel is a kind folder with one door

`features/realtime/<channel>/` holds `index.ts` and `transport/<protocol>/` with `<channel>-<protocol>.module.ts` and
one door with its spec: `<channel>.controller.ts` with one `@Sse` method (the default), `<channel>.gateway.ts` (a socket
gateway, only for two-way messages) or `<channel>.subscription.ts` (a GraphQL subscription, only for a typed payload on
a GraphQL client). A door holds no query, mutation or other route; only an api app composes it. The gateway file (and its spec)
is the only feature file that imports `@nestjs/websockets` (`@WebSocketGateway`, `@SubscribeMessage`, `@WebSocketServer`);
`platform/realtime` is its other owner, and every other file reaches a socket through the hub. A realtime integration spec
drives the gateway with `socket.io-client`, a test library that no source file imports.

Why: SSE is plain HTTP, self-reconnecting and resumable, so the heavier doors are chosen only for what only they give.
The socket decorators declare a transport, so the infrastructure owner table gives them to the slot of that transport
(`slot:be.feature.realtime.websocket`) and to `platform/realtime`, and to no other file; the pattern's mandatory gateway file
is therefore legal without a re-export.

Enforced by: `realtime-shape` (R184), `rest-door-needs-a-reason` (R278), `infra-import-owner` (R90).

## BE-REALTIME-2 A door reads and nothing else; the committing service publishes

A door injects `@InjectRealtimeHub() private readonly hub: RealtimeHub` and returns `this.hub.stream(topic, { after: lastEventId })`.
When a stream must begin with the current state (a late subscriber to a view of rows, BE-REALTIME-8), the door injects instead ONE
stream read service, a class whose public methods only read and answer an `Observable`, and returns one call on it that passes the
principal, the client's selector and `lastEventId`: the read (the membership check, the current state) happens in that service,
which builds the principal-first topic (BE-REALTIME-3) and follows it through the hub, so the door stays one call. No manager, bus,
queue or other domain service reaches a door, so a long-lived connection cannot write. A door that needs no first state sends no
snapshot: the client reads current state through a membership-checked query on every open.
The domain service that commits a change publishes the frames: on the Postgres hub inside its transaction (`within`),
on Redis or memory after the transaction resolved.

Why: a door that can only touch the hub or one read service cannot change business state, and a frame pushed before commit can
announce a change that rolls back. Putting the first-state read in one service keeps it the single place that checks membership and
orders "current state, then live".

Enforced by: `realtime-read-only` (R185), `feature-thin` (R203), `infra-import-owner` (R90).

## BE-REALTIME-3 The topic starts with the principal; membership is enforced on publish

Every stream takes `@CurrentPrincipal()` and builds its topic with the owning domain's pure topic builder
(`<name>.policy.ts`, exported by the capability, returning a typed `RealtimeTopic<Frame>`) from the principal's id plus
any client selector inside that prefix; a door that calls a stream read service passes it the principal, which builds the topic the
same way. The publisher reads the current members and publishes one frame per member
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
`parseRealtimeConfig`; more than one api replica uses Postgres or Redis, so every replica serves any request or reconnect
with no sticky session. On a lost listener the shared hubs pause and
reload each followed topic from its last position, skipping and duplicating nothing.

Why: an in-process hub loses every push published on another replica and every replay a reconnect lands away from.

Enforced by: `infra-import-owner` (R90), R266.

## BE-REALTIME-4 Delivery is proven with a real client

An app declaring `realtime` proves `subscriber-receives-push`, `foreign-topic-is-isolated`,
`disconnect-releases-subscription`, `push-crosses-replicas` and `resume-after-reconnect` in specs titled
`realtime/<scenario>: ...`, with a real event-stream or socket client carrying the principal's token (integration). The door's spec covers its wiring with a hub double.

Why: the door has no logic; the risk is delivery, isolation and leaks on a real connection.

Enforced by: R155.

## BE-REALTIME-8 One generic door streams the progress of jobs, current state first

The progress of a job chain (BE-JOBS-10) is served by ONE generic realtime door of the app, not one per job: it reads the rows through
the stream read service of `platform/jobs` (BE-REALTIME-2) and returns that one call. The stream is for one chain root, a bounded set
of roots, or the workspace, on one connection; its topic is principal-first and the service checks membership before anything is
read (BE-REALTIME-3). A late or reconnecting subscriber first gets the current state of each job of the stream read from its row,
including the next retry time, then the live frames, and `Last-Event-ID` resumes inside the caller's own topic (BE-REALTIME-5). The
frames carry keys only. A domain method never publishes job progress to the hub: it reports through the `JobProgress` port of the
frame (BE-JOBS-10).

Why: a view of job rows must show the state a client missed before it shows what is new, and one door means one place for isolation,
membership and replay.

Enforced by: `realtime-read-only` (R185), `realtime-topic-scope` (R186), `job-progress-shape` (R404). Known gap: the rules judge
that a door calls one stream read service with the principal; that the service checks membership before reading, and reads the
current state before it follows the topic, is proven by the service's own specs and the realtime scenarios (BE-REALTIME-4).

