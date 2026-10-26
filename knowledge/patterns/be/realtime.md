---
slots: [be.feature.realtime, be.feature.realtime.sse, be.feature.realtime.websocket, be.feature.realtime.graphql, be.feature.realtime.dto]
files:
  - path: src/modules/domain/<capability>/<name>.policy.ts
    slot: be.domain
    role: The pure typed topic builder and frame predicate of BE-REALTIME-3, exported by the domain contract for publisher and door.
    spec: src/modules/domain/<capability>/<name>.policy.spec.ts
    optional: true
  - path: src/features/realtime/<channel>/index.ts
    slot: be.feature.realtime
    template: realtime/channel.index.ts.tpl
    role: The public surface of the kind folder, the module class an api-kind app composes.
  - path: src/features/realtime/<channel>/transport/graphql/<channel>-graphql.options.ts
    slot: be.feature.realtime.graphql
    template: realtime/channel.graphql.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/realtime/<channel>/transport/graphql/<channel>-graphql.module-definition.ts
    slot: be.feature.realtime.graphql
    template: realtime/channel.graphql.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/realtime/<channel>/transport/graphql/<channel>-graphql.module.ts
    slot: be.feature.realtime.graphql
    template: realtime/channel.graphql.module.ts.tpl
    role: Nest module of the subscription door, composed only by an api-kind app.
  - path: src/features/realtime/<channel>/transport/websocket/<channel>-websocket.options.ts
    slot: be.feature.realtime.websocket
    template: realtime/channel.websocket.options.ts.tpl
    role: The options of the gateway door's module - the cryptographic verifier that authenticates each connection.
    optional: true
  - path: src/features/realtime/<channel>/transport/websocket/<channel>-websocket.module-definition.ts
    slot: be.feature.realtime.websocket
    template: realtime/channel.websocket.module-definition.ts.tpl
    role: The configurable-module base of the gateway door's module, registered as register.
    optional: true
  - path: src/features/realtime/<channel>/transport/websocket/<channel>-websocket.module.ts
    slot: be.feature.realtime.websocket
    template: realtime/channel.websocket.module.ts.tpl
    role: Nest module of the gateway door, composed only by an api-kind app.
    optional: true
  - path: src/features/realtime/<channel>/transport/websocket/<channel>.gateway.ts
    slot: be.feature.realtime.websocket
    template: realtime/channel.gateway.ts.tpl
    role: A socket door (one WebSocketGateway class); exactly one of gateway or subscription per channel file name.
    rules: [BE_REALTIME_SHAPE, BE_REALTIME_WRITES, BE_REALTIME_TOPIC_SCOPE]
    spec: src/features/realtime/<channel>/transport/websocket/<channel>.gateway.spec.ts
    optional: true
  - path: src/features/realtime/<channel>/transport/websocket/<channel>.gateway.spec.ts
    slot: be.feature.realtime.websocket
    template: realtime/channel.gateway.spec.ts.tpl
    role: Unit spec of the gateway beside it.
    optional: true
  - path: src/features/realtime/<channel>/transport/graphql/<channel>.subscription.ts
    slot: be.feature.realtime.graphql
    template: realtime/channel.subscription.ts.tpl
    role: A GraphQL subscription door (one Resolver class).
    rules: [BE_REALTIME_SHAPE, BE_REALTIME_WRITES, BE_REALTIME_TOPIC_SCOPE]
    spec: src/features/realtime/<channel>/transport/graphql/<channel>.subscription.spec.ts
  - path: src/features/realtime/<channel>/transport/graphql/<channel>.subscription.spec.ts
    slot: be.feature.realtime.graphql
    template: realtime/channel.subscription.spec.ts.tpl
    role: Unit spec of the subscription beside it.
  - path: src/features/realtime/<channel>/transport/graphql/dto/<channel>-changed.type.ts
    slot: be.feature.realtime.dto
    template: realtime/channel.type.ts.tpl
    role: "The typed frame of the door, what the subscriber may see of a change."
  - path: src/features/realtime/<channel>/transport/graphql/dto/<channel>.input.ts
    slot: be.feature.realtime.dto
    template: realtime/channel.input.ts.tpl
    role: The typed, bounded arguments of the door.
    rules: [BE_INPUT_BOUNDED]
  - path: src/features/realtime/<channel>/transport/sse/<channel>-sse.options.ts
    slot: be.feature.realtime.sse
    template: realtime/channel.sse.options.ts.tpl
    role: The options of the SSE door's module; empty, the app's default-deny guards authenticate the stream.
    optional: true
  - path: src/features/realtime/<channel>/transport/sse/<channel>-sse.module-definition.ts
    slot: be.feature.realtime.sse
    template: realtime/channel.sse.module-definition.ts.tpl
    role: The configurable-module base of the SSE door's module, registered as register.
    optional: true
  - path: src/features/realtime/<channel>/transport/sse/<channel>-sse.module.ts
    slot: be.feature.realtime.sse
    template: realtime/channel.sse.module.ts.tpl
    role: Nest module of the SSE door, composed only by an api-kind app.
    optional: true
  - path: src/features/realtime/<channel>/transport/sse/<channel>.controller.ts
    slot: be.feature.realtime.sse
    template: realtime/channel.controller.ts.tpl
    role: A server-sent-events door (one Controller class with one Sse method); the default door for one-way push.
    rules: [BE_REALTIME_SHAPE, BE_REALTIME_WRITES, BE_REALTIME_TOPIC_SCOPE, BE_REST_DOOR_EVIDENCE]
    spec: src/features/realtime/<channel>/transport/sse/<channel>.controller.spec.ts
    optional: true
  - path: src/features/realtime/<channel>/transport/sse/<channel>.controller.spec.ts
    slot: be.feature.realtime.sse
    template: realtime/channel.controller.spec.ts.tpl
    role: Unit spec of the SSE controller beside it.
    optional: true
  - path: src/modules/platform/realtime/realtime.port.ts
    slot: be.platform
    role: RealtimeHub, the one port of the realtime kind (publish, subscribe, stream) and the typed topic; its three adapters are the files below.
    optional: true
  - path: src/modules/platform/realtime/realtime-config.mapper.ts
    slot: be.platform
    template: realtime/realtime-config.mapper.ts.tpl
    role: parseRealtimeConfig maps EnvSource to the hub options at boot; hub-selection logic is a covered mapper role.
    spec: src/modules/platform/realtime/realtime-config.mapper.spec.ts
    optional: true
  - path: src/modules/platform/realtime/memory-realtime-hub.service.ts
    slot: be.platform
    role: "MemoryRealtimeHub, the non-scale adapter: one process, tests and a single-replica dev run, replay from an in-process ring buffer."
    spec: src/modules/platform/realtime/memory-realtime-hub.service.spec.ts
    optional: true
  - path: src/modules/platform/realtime/postgres-realtime-hub.service.ts
    slot: be.platform
    role: "PostgresRealtimeHub: publish locks the topic, writes a realtime_events row and NOTIFYs (in the publisher's transaction when given), every replica LISTENs and fans out, replay reads the table, and a lost LISTEN connection is reloaded per topic (both editions)."
    spec: src/modules/platform/realtime/postgres-realtime-hub.service.spec.ts
    optional: true
  - path: src/modules/platform/realtime/redis-realtime-hub.service.ts
    slot: be.platform
    role: "RedisRealtimeHub: a Redis Stream per topic for replay and Pub/Sub for the live push, published by one atomic script over ioredis, reloaded per topic after a subscriber reconnect (when Redis is declared)."
    spec: src/modules/platform/realtime/redis-realtime-hub.service.spec.ts
    optional: true
  - path: src/modules/platform/realtime/realtime-subscriptions.policy.ts
    slot: be.platform
    role: "The subscriptions of one replica, shared by the shared hubs: join, replay then live without a duplicate, release on stop."
    spec: src/modules/platform/realtime/realtime-subscriptions.policy.spec.ts
    optional: true
  - path: src/modules/platform/realtime/postgres-listener.client.ts
    slot: be.platform
    role: "The LISTEN connection of the Postgres hub: proves itself with a probe at boot, reconnects, closes the dead client and tells the hub it was lost and when it resumed."
    spec: src/modules/platform/realtime/postgres-listener.client.spec.ts
    optional: true
  - path: src/modules/platform/realtime/realtime-retention.service.ts
    slot: be.platform
    role: The bounded, batched delete of the replay table that the fenced sweep job runs, asking the fence before every batch.
    spec: src/modules/platform/realtime/realtime-retention.service.spec.ts
    optional: true
  - path: src/modules/platform/realtime/no-realtime-retention.service.ts
    slot: be.platform
    role: "The retention of a hub with no replay table (memory, Redis): a scheduled sweep tick is acknowledged and deletes nothing."
    spec: src/modules/platform/realtime/no-realtime-retention.service.spec.ts
    optional: true
  - path: src/modules/platform/realtime/redis-stream-id.policy.ts
    slot: be.platform
    role: Orders two Redis stream ids, so the Redis hub reloads only what a topic has not delivered.
    spec: src/modules/platform/realtime/redis-stream-id.policy.spec.ts
    optional: true
  - path: src/modules/platform/realtime/postgres-io.adapter.ts
    slot: be.platform
    role: "PostgresIoAdapter: socket.io over @socket.io/postgres-adapter, websocket only, so no sticky session."
    spec: src/modules/platform/realtime/postgres-io.adapter.spec.ts
    optional: true
  - path: src/modules/platform/realtime/redis-io.adapter.ts
    slot: be.platform
    role: "RedisIoAdapter: socket.io over the sharded @socket.io/redis-adapter (ioredis), websocket only."
    spec: src/modules/platform/realtime/redis-io.adapter.spec.ts
    optional: true
  - path: src/modules/platform/realtime/realtime-io.adapter.ts
    slot: be.platform
    role: "realtimeIoAdapter(app), the one call main.ts makes to install the socket.io adapter the selected hub provides."
    spec: src/modules/platform/realtime/realtime-io.adapter.spec.ts
    optional: true
  - path: src/modules/platform/realtime/event-stream.mapper.ts
    slot: be.platform
    role: eventStream, the one place that turns hub frames into server-sent events (opening frame, ids, comment heartbeat) and owns the heartbeat timer.
    spec: src/modules/platform/realtime/event-stream.mapper.spec.ts
    optional: true
  - path: src/modules/platform/realtime/persistence/migrations/<epochMs13>-create-realtime-events.ts
    slot: be.persistence
    role: Full edition migration of the realtime_events replay table and the socket_io_attachments table of the Postgres adapter.
    optional: true
  - path: supabase/migrations/<timestamp>_realtime-events.sql
    slot: repo.side-root-forbidden
    role: Lite edition migration (created with supabase migration new) of the same two tables, forced row level security for the declared application role, and the pg_cron tick of the retention queue.
    optional: true
  - path: src/features/reactors/<name>/transport/message/<event>.consumer.ts
    slot: be.transport.message
    role: The reactor consumer that receives the domain event and pushes the frame through the hub.
    optional: true
  - path: src/tests/e2e/<area>/<channel>-push.e2e-spec.ts
    slot: be.tests.e2e
    role: "Titles realtime/<scenario>: ... prove the pattern against a real client."
    spec: realtime/subscriber-receives-push, realtime/foreign-topic-is-isolated, realtime/disconnect-releases-subscription
    rules: [BE_PATTERN_SPEC_MISSING]
    optional: true
---
# Realtime channels

Decides how a state change reaches a connected client without asking: a realtime feature whose one door reads and pushes only,
injecting just the `RealtimeHub` of `platform/realtime`, subscribed to principal-scoped topics that a reactor or the committing domain
service publishes to. Doors, hubs and rules are the same in lite and full; scale is the hub binding, never a different door. Replay
and retention bounds (frames per topic, frame age, heartbeat interval) are `platform/realtime` constants. The front-end reader is the
front-end realtime pattern.

## BE-REALTIME-1 A channel is a kind folder with one door, its module and its spec
`features/realtime/<channel>/` (enabled by declaring `realtime`) holds `index.ts`, `transport/<protocol>/<channel>-<protocol>.module.ts`
and exactly one door with its spec: `transport/sse/<channel>.controller.ts` (one `@Controller` with one `@Sse` method),
`transport/websocket/<channel>.gateway.ts` (one `@WebSocketGateway` of `@SubscribeMessage` handlers) or
`transport/graphql/<channel>.subscription.ts` (one `@Resolver` of `@Subscription` operations), plus optional `dto/`. A door holds no
query, mutation, field resolver or plain REST route; the `@Sse` stream is event-stream evidence only in the sse slot. Only an api app
composes the module, and all three doors are served from the api process in both editions.

Why: one file per door keeps a protocol's machinery in one place, and keeping queries and mutations out means all a client can do
through a realtime door is listen.

Enforced by: R184 BE_REALTIME_SHAPE, R278 BE_REST_DOOR_EVIDENCE, R47 BE_TEST_TOPOLOGY.

## BE-REALTIME-2 A realtime door reads and pushes; it never writes
A door is thin and its one injected value is the `RealtimeHub` (`subscribe(topic, { after })` returns an async iterable of frames;
`stream(topic, { after })` returns the `Observable<MessageEvent>` an SSE method needs: an opening frame with the reconnect delay, one
event per frame with its `id`, a comment heartbeat; `publish(topic, frame, within?)` settles once the hub accepted the frame). No
EntityManager, bus, event bus, queue or domain service is injected, since a domain service may write. Topics are typed
`RealtimeTopic<T>` values built by the owning domain contract, never strings in a door. Socket, pub/sub and LISTEN engines and the
heartbeat timer are owned by `platform/realtime` (`ruleParams.be.infraOwners`). Because the door reads only the hub, it sends no
snapshot on connect: the client reads current state through a membership-checked query operation on every open, and the stream
carries changes.

Why: a door that can only touch the hub cannot change business state, so a write through a long-lived connection is removed by type.

Enforced by: R185 BE_REALTIME_WRITES, R90 BE_INFRA_OWNER, R203 BE_FEATURE_THIN.

## BE-REALTIME-3 The topic is built from the principal; membership is enforced on publish
Every `@SubscribeMessage`, `@Subscription` and `@Sse` handler takes `@CurrentPrincipal()` and builds its topic from the principal's id
(plus a client-supplied id only inside that prefix) with the owning domain's topic builder. The builder is a pure `<name>.policy.ts` of
the domain capability, exported through its `index.ts`, returning `RealtimeTopic<Frame>` with the principal-prefixed name and the
frame's narrowing `accepts` predicate (frame types in `*.contracts.ts`), with no injection or lookup; publisher and door import that
one builder. Membership is enforced by the publisher: the domain service that owns the change reads the current members and publishes
one frame per member topic, so a non-member can open only its own idle topic, and a removed member's open stream receives nothing from
the next publish on (already delivered or retained frames are not revoked). Snapshot and history queries check membership
independently. Default-deny applies: a stream is never `@Public`; the browser reads SSE with `fetch` and the bearer token, never a
token in the URL. `Last-Event-ID` only picks where replay resumes inside the principal's own topic.

Why: a topic taken from client input alone is an authorization hole, where knowing an id is enough to watch it.

- When a room has several members and membership changes → `roomMessageTopic(memberId, roomId)` in the domain's
  `room-message.policy.ts`; the door streams `roomMessageTopic(principal.id, roomId)`; the publisher fans out to the current members.

Enforced by: R186 BE_REALTIME_TOPIC_SCOPE, R41 BE_DEFAULT_DENY, R204 HFS_COVERAGE_SCOPE_DRIFT.

## BE-REALTIME-4 Realtime behaviours are proven with a real client
Declaring `realtime` requires tests titled `realtime/<scenario>: ...` for each scenario of `ruleParams.be.patternScenarios`: a
subscriber receives the frame pushed after the domain event, another principal on the same channel receives nothing, a disconnect
leaves no subscription in the hub, and, with two api replicas, a push crosses replicas and a reconnect to the other replica resumes
from `Last-Event-ID`. The client is a real socket, GraphQL-over-WebSocket or `fetch` event-stream client with the principal's bearer
token, waiting with `waitFor`. The door's unit spec covers its wiring with a recording hub double.

Why: the door has no logic; the risk is delivery, isolation and leaks on a real connection, which only a client against the real app
shows.

Enforced by: R155 BE_PATTERN_SPEC_MISSING, R284 BE_LITE_PROOF_LANE_MISSING.

## BE-REALTIME-5 An SSE stream stays open, resumes and is bounded
An SSE method returns `hub.stream(topic, { after: lastEventId })` and nothing else. Each frame's `id` is the domain event id, unique
within the topic. The hub retains the last frames of a topic that carry a string id in a bounded buffer (frames per topic and topics,
oldest dropped first) so a reconnect with `Last-Event-ID` receives what it missed; an id the buffer no longer holds replays the whole
buffer without signalling the gap, so the client refetches its snapshot on every open. The heartbeat stays below the ingress idle
timeout. At the ingress the stream is never compressed or buffered (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`,
no compression middleware in front of the app), and the edge speaks HTTP/2 so the per-origin connection limit does not starve tabs.

Why: a quiet stream is cut by every proxy that sees no bytes, a buffered one delivers nothing until it fills, a stream without ids
loses every push made during a reconnect, and an unbounded buffer grows with its history.

Enforced by: R184 BE_REALTIME_SHAPE, R278 BE_REST_DOOR_EVIDENCE, R90 BE_INFRA_OWNER.

## BE-REALTIME-6 What is pushed and which way picks the door
The API defaults to GraphQL, but the realtime door follows the push, in both editions:
- One-way server-to-client push (a status, job progress, streamed tokens): SSE, the default; plain HTTP through every proxy,
  self-reconnecting, resumable from `Last-Event-ID`, cheapest per connection.
- A typed schema payload on a client that already uses GraphQL: the GraphQL subscription, restricted to that case; it shares schema,
  codegen and guards, but has no replay (the screen refetches on reconnect), costs more per connection and needs the WebSocket upgrade.
- Two-way messages (chat, presence, collaborative input): the socket gateway, the only door where the client sends messages.

Why: a reader who knows the API is GraphQL assumes subscriptions everywhere, but SSE is cheaper, easier to proxy and resumable, so the
heavier doors are chosen only for what only they give.

Enforced by: R184 BE_REALTIME_SHAPE, R185 BE_REALTIME_WRITES, R186 BE_REALTIME_TOPIC_SCOPE, R212 HFS_EDITION_INVALID.

## BE-REALTIME-7 A channel scales horizontally on one hub port with a shared hub
`platform/realtime` keeps one port and three adapters, selected by `REALTIME_HUB` and parsed once by `parseRealtimeConfig`
(`realtime-config.mapper.ts`, a covered mapper) and validated at boot. Unset, it selects `redis` when the realtime Redis URL is
declared and `postgres` otherwise, never `memory`:
- Memory: one process, tests or a single replica only; replay from an in-process ring buffer.
- Postgres: `publish` takes a per-topic advisory lock, writes a `realtime_events` row and NOTIFYs; every replica LISTENs and fans out;
  replay reads the table. LISTEN needs a session-mode connection, proved at boot by hearing a probe sent from another session. A
  fenced batched sweep job bounds the table.
- Redis: one atomic script appends to a capped per-topic stream with an expiry and publishes; replay reads the stream; every key and
  channel carries the app prefix.

On a lost LISTEN or subscriber connection the shared hubs pause live delivery and reload each followed topic from the minimum last
position of its open subscriptions, each subscription dropping positions it already took, so no frame is skipped or duplicated; a
failed reload keeps the pause and retries, and only the current loss generation's reload resumes. Only the Postgres hub publishes
inside the domain transaction (pass it as `within`); Redis and memory push immediately, so a service on them, or on a selectable hub,
publishes only after its awaited transaction resolves (a rollback publishes nothing; a publish failure after commit leaves the write
and the client resyncs by query). Socket adapters live in `platform/realtime`, installed by `realtimeIoAdapter(app)` in `main.ts`
(the default adapter on memory, the Postgres or sharded Redis adapter otherwise), forcing the websocket transport so no sticky session
exists; neither shared adapter recovers connection state, so socket and GraphQL clients refetch on reconnect. The realtime tables are
migrations of the app. A stack running more than one api replica with a realtime feature selects `postgres` or `redis`.

Why: an in-process hub loses every push published on another replica and every replay buffer a reconnect lands away from; shared
state, a websocket-only transport and a client that resyncs by query let any replica serve any request or reconnect.

- When a domain service changes state on the Redis or memory hub → collect the topic/frame pairs while committing, then publish after
  the transaction resolves:
  ```ts
  const pushes = await this.entityManager.transaction(async (tx) => { /* read members, write through tx */ return pending })
  await eachInOrder(pushes, ({ topic, frame }) => this.hub.publish(topic, frame))
  ```

Enforced by: R90 BE_INFRA_OWNER, R266 STACKS_SECRET_NOT_EXTERNAL, R155 BE_PATTERN_SPEC_MISSING.
