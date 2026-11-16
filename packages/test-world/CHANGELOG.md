# Changelog

## 2.2.1 - 2026-11-17

- Fixed: a run whose later slot finds no free Redis database (live runs hold all 16) goes on with the slots it already made and says so on stderr (`test-world: 2 of 3 slot(s): ...`), instead of failing the whole run; the spec files share fewer slots. The first slot, and any other failure, still fails the run (`provisionSlots`, `isSlotsExhausted` in `jest/setup.ts`; the run state records the slots actually made).
- Added: `TestWorldErrorCode.SlotsExhausted` (`TEST_WORLD_SLOTS_EXHAUSTED`), thrown by the Redis DB lease when none is free (it was `TEST_WORLD_INFRASTRUCTURE_FAILED`). Specs: `src/jest/slots.spec.ts`.

## 2.2.0 - 2026-11-16

- Added: the slots of a run are the workers the app declares, `tests: { integration: { workers: n }, e2e: { workers: n } }` in `.starcistacks/application-stacks.yaml` (`readTestWorkers`, `TEST_KINDS`, `MAX_SLOTS`): an integer from 1 to 8 for each kind, one when absent (a sequential run); any other shape is `TEST_WORLD_CONFIG_INVALID`. A run provisions the most `workers` of the kinds its command line selects (`selectedKinds` of `--selectProjects`, both when none), or `STARCI_TEST_WORLD_WORKERS=<n>` when it asks for them explicitly (`starci test <kind> --workers <n>`), and publishes the workers of each kind in its state file (`workers`, additive: the protocol stays 2).
- Added: `exclusive?: boolean` on `AppsWorldSpec` and `ModulesWorldSpec`: a spec that declares `useTestWorld({ ..., exclusive: true })` (a latency budget, a soak, a load run) runs alone after the parallel batch of its kind; the world runner of `@starci/jest-preset` reads the literal, the library gives it no other effect.
- Changed: jest's `--maxWorkers` is no longer read to size the slots (the harness sizes it for unit runs), and the `workers` of the declaration is a cap only when it is set (it had a default of 2); `DEFAULT_WORKERS` is gone, `MAX_SLOTS` (8, the Kafka broker's slot listeners) bounds a run. `requestedWorkers`, `selectedKinds`, `workersOfRun` and `WORKERS_ENV` are exported from `src/jest/setup.ts`.
- Unchanged: the state file protocol (2). `@starci/jest-preset` 2.11.0 is the pair: its world runner runs the files of a kind on the workers published, the exclusive ones alone afterwards, and holds the result cache of the integration and e2e kinds.
- Specs: the slot and worker cases of `src/jest/slots.spec.ts` (the cap, the explicit request, the stacks block and its wrong shapes, the selected kinds).

## 2.1.0 - 2026-11-16

- Added: `stacks.postgresql.logicalReplication: true` starts the shared Postgres with logical decoding on (`wal_level=logical`, `max_replication_slots=16`, `max_wal_senders=16`: one slot and one walsender for each of the 8 data slots a machine runs at once, doubled for the leftovers of a crashed run). It changes the container identity: the container name is keyed by the image plus these arguments (`serviceContainerName(service, image, logicalReplication)`), so a logical Postgres is a warm container of its own and the default container other repositories share is neither started with the arguments nor altered. `StackImageRequest.logicalReplication` carries the flag; `POSTGRES_LOGICAL_ARGS` and `POSTGRES_LOGICAL_CAPACITY` are exported from the stack naming.
- Added: `debezium`, a stack service: `stacks: { debezium: { connections?, tables?, stream?, properties?, image? } }` runs Debezium Server as the change-data-capture road of the slot's database to the slot's Redis DB, always real (`stacks.debezium: { fakedBy }` is `TEST_WORLD_CONFIG_INVALID`; it needs `stacks.postgresql` with `logicalReplication: true` and `stacks.redis`). The image is pinned like Kafka's: exactly `DEBEZIUM_IMAGE` (`quay.io/debezium/server:3.0.8.Final@sha256:b898e370...`), found in the stack definition as the compose service `debezium` or any service on the `quay.io/debezium/server` image; any other tag, an undigested reference or another image is `TEST_WORLD_STACK_DEFINITION`. `debezium` joins `INFRA_SERVICES`.
- Added: one Debezium Server container per data slot (`starci-ts-debezium-<hash of image#<namespace.snake>>`), started by the slot's attach after its databases and Redis DB exist (a service definition may now be `after` the services it is configured from, and `proxied: false` for one the app never talks to), held by the slot's lease. It reads the slot's database through its own replication slot and publication `<namespace.snake>_cdc` (shortened with a hash of the namespace past Postgres's 63 characters), writes to the slot's own Redis DB with topic prefix `<namespace.kebab>` (streams `<prefix>.<schema>.<table>`, or the one declared `stream` through `RegexRouter`), captures changes only over a `FOR ALL TABLES` publication, takes the declaration's `properties` after its defaults and refuses the properties it owns. Health is `/q/health/live` and then the replication slot being active; it has no toxiproxy proxy (`RunDebezium.proxy` is empty). Teardown (and the reclaim of a crashed run) removes the container, ends its walsender and drops the replication slot and the publication before the database that holds them is dropped; a leftover container of the namespace is removed before the next attach drops the database, because it would hold the slot. A server that never answers is removed and the attach is undone.
- Added: `w.debezium.{url,slotName,publicationName,streamPrefix,stream(table)}` on the wiring, and the types `DebeziumStack` and `WiredDebezium`.
- Added: `world.infra.debezium`: `cut()` (stops the container; Postgres keeps the WAL for its slot), `restore()` (starts it and waits until it holds its slot again, so what was committed meanwhile is delivered in order), `during(fn)`, `restart()` and `drain()` (waits until every change committed so far is in its stream, through a transactional `pg_logical_emit_message` waited for in the message stream: no table is touched), under the run's outage lock like every outage; a world that stops with it cut starts it again. The type is `DebeziumInfraHandle`; `WorldDependencies.docker` replaces the docker CLI of the handle in the library's own specs.
- Added: the per-spec reset drains the connector after the database and the Redis DB were emptied and then empties the Redis DB, so no spec reads another's events.
- Changed: `ProvisionInput`, `ResetInput` and `DeprovisionInput` carry the `infra` provisioned so far (library internals); a run is torn down in the order services configured from others first.
- Unchanged: the state file protocol (2), so `@starci/jest-preset` 2.10.0 stays the pair. The Postgres default container, every other service's container identity and the existing declarations are unchanged.
- Specs: the debezium cases of `src/stack/services/services.spec.ts` (plan, properties, environment, readiness, provision, drain, reset, deprovision retry and tolerance), `src/stack/index.spec.ts` (a logical Postgres is another container than the default, the server starts after its postgres and redis and is configured from them, one server per slot, detach order, reset order and the reclaim of a crashed run, a stale container, a server that never answers), `src/config/stack-file.spec.ts` (the pin, the logical flag), `src/config/validate.spec.ts` (the violating and passing declarations), `src/nest/wiring.spec.ts` and `src/nest/world.spec.ts` (the outage lock and the handle); README "Change data capture (Debezium)". Proven once against real Docker (Postgres 17 with logical decoding, Redis 7.4 and the pinned Debezium Server): two slots with their own slots and streams, no cross-slot events, a change committed while the server was stopped delivered once after its start, `drain`, the reset, and the teardown leaving no slot, database or container.

## 2.0.0 - 2026-11-13

- Removed (breaking): the fakes of four payment gateways (`sepayFake`, `momoFake`, `vnpayFake`, `payosFake`, their payload and signature helpers and `payment-kit`) leave `@starci/test-world/fakes`. A provider's fake belongs to the app that integrates the provider: it lives in the app's `be/src/tests/world/fakes/<provider>/`, built with `defineHttpFake`. The world, the fake framework and the generic fakes (the OpenAI-compatible, SMTP and OIDC issuer fakes) are unchanged; the world's own spec proves webhook routing with a small neutral fake.
- Upgrade, per existing app: an app that imports one of the four fakes copies it into its own world fakes folder before taking 2.0.0; no app of the harness's own tree imports one.

## 1.4.0 - 2026-11-08

- Added: `mail`, a stack service: `stacks: { mail: {} }` runs the stack definition's mailpit (the compose service `mail`, or any service on the `axllent/mailpit` image) as the real mail sink, with chaos enabled. It is one container per data slot, named from its image and the slot's namespace, started by the slot's attach and removed by its detach (a dead run's by the next attach's reclaim), because mailpit keeps its messages and chaos per server and a shared container would let one slot's refusal or reset reach another repository. SMTP is the toxiproxy-fronted endpoint; the HTTP API is published beside it and read directly, so an outage on SMTP does not blind the reader. `starci app world up` leaves it to the slot's attach. `mail` joins `INFRA_SERVICES`; it is stateful, so `stacks.mail: { fakedBy }` is `TEST_WORLD_CONFIG_INVALID`, as the hfs rule `BE_TEST_TOPOLOGY` never accepts a fake of a stack mail service.
- Added: `w.mail.{host,port,url,apiUrl}` on the wiring (the SMTP host and port the app sends to; `apiUrl` is the sink's API base).
- Added: `world.mail`, the reader of the sink: `messages(to?)`, `read(id)`, `waitFor(to, { subject?, timeoutMs?, intervalMs? })` (the newest match, whole: `subject`, `text`, `html`, addresses, attachments) and `clear()`; every spec file starts with an empty sink and no refusal.
- Added: failure injection through mailpit's chaos: `world.mail.refuse("sender" | "recipient" | "authentication", { status = 550, probability = 100 })` answers `MAIL FROM`, `RCPT TO` or `AUTH` with an SMTP code from 400 to 599 until `world.mail.acceptAll()`. Chaos has no delay and no connection-level trigger; those are the toxiproxy outages below.
- Added: `stall()` on every `world.infra.<svc>` handle (and `ProxyToxics`): the service keeps accepting connections and nothing it says reaches the client until `restore()`, so the client's own timeout fires (a `timeout` toxic of 0 on the downstream); it takes the outage lock like `latency` and `cut`. `world.infra.mail` carries the SMTP side's `stall()`, `cut()` and `latency(ms)`.
- Added: the types `MailStack`, `WiredMail`, `WorldMail`, `MailMessage`, `MailSummary`, `MailAddress`, `MailAttachment`, `MailRefusal`, `MailRefusalPoint`, `MailRefuseOptions` and `MailWaitOptions`. Specs: `src/stack/mail-api.spec.ts`, `src/nest/mail.spec.ts`, and the mail cases of `src/stack/services/services.spec.ts`, `src/stack/index.spec.ts`, `src/stack/toxiproxy.spec.ts`, `src/config/stack-file.spec.ts`, `src/config/validate.spec.ts`, `src/nest/wiring.spec.ts` and `src/nest/world.spec.ts`; README.
- Unchanged: the state file protocol (2), so `@starci/jest-preset` 2.9.0 is the pair.
- Changed: `TestWorldError` extends `DomainError` of `@starci/common` (now a dependency): `isDomainError` recognises it; its name, codes, `params`, `cause` and message (`<code>: <detail>`) are unchanged. The `params` values are strings or numbers (`ErrorParams`), so the fake-control failure leaves `status` out when no answer arrived instead of carrying `null`.
- Changed: five local object guards (`isRecord` of the subscription, world lock, registry, Keycloak and toxiproxy modules) are `isPlainRecord` / `isRecord` of `@starci/common` with the same behaviour.
- Changed: the package compiles with `module: nodenext`, since it now requires an ES module (`@starci/common`); Node 22.13 or later loads it with `require`.
- Changed: requires `@starci/common` 1.0.1 (exact), the one copy an app installs, so `DomainError` stays one class (this version had not reached npm).

## 1.3.5 - 2026-11-07

- A patch: the CHANGELOG carries no ruling attribution; nothing it ships changed.

## 1.3.4

- Added: the `TestWorldApi` type, the world API of a declaration whose apps are not named in its type, so a config exports `useTestWorld` and `useSandbox` with explicit types (R368).

## 1.3.3 - 2026-10-30

- Changed: the stack contracts and the README name the test world's command, `starci app world up|down|status`.

## 1.3.2 - 2026-10-30

- Added: a `useSandbox` handle answers `request({ method, url, headers?, form? })`, a browser-style call for a contract spec that walks a provider sign-in (`method` `GET` or `POST`): one request with `redirect: "manual"`, so a redirect is returned (its `location` among the headers) and never followed, answering `{ status, headers, body }` with the text body and every `set-cookie` kept as a separate entry. Each handle keeps its own cookie jar (domain, host-only, path, `Secure`, expiry by `Max-Age` or `Expires`) and sends the matching cookies on its later calls; `form` sends `application/x-www-form-urlencoded` fields and is refused on a `GET`. The index exports the types `SandboxBrowserRequest` and `SandboxBrowserAnswer`. Spec: `src/nest/sandbox.spec.ts` (cookies per handle, the redirect returned, the encoded form); README.

## 1.3.1 - 2026-10-29

- Changed: the README's HTTPS fake section names the option an app trusts the run's CA through: `HttpOptions.trustedCa` of the hfs skeleton's `platform/http`, read from `HTTP_TRUSTED_CA` of the environment the declaration builds the app's options from. No code changed.

## 1.3.0 - 2026-10-29

- Added: `defineHttpFake({ https: true, ... })` serves HTTPS on `https://127.0.0.1:<port>` with a server certificate signed by the run's ephemeral fake CA (made in memory once per process over `node:crypto`, X.509 v3, ECDSA P-256, valid for `127.0.0.1`, `::1`, `localhost` and `host.docker.internal`; no new dependency), for a provider whose contract requires TLS such as an OIDC issuer.
- Added: the fake's CA PEM is published as `ca` on the started fake, the run state and the wiring (`w.fake.<name>.ca`), absent for a plain-HTTP or SMTP fake; the app trusts it through its own HTTP client option. Verification is never turned off and nothing is added to the process-wide trust store.
- Added: `fakeTls()` (the run's `{ ca, cert, key }`) and `issueFakeTls()` (fresh, unrelated material) from `@starci/test-world/fakes`. Specs: `src/fakes/framework/https-fake.spec.ts` (an https fake answers, a client trusting the CA succeeds by every covered name, an untrusted client, another CA and global fetch are refused, the certificate shape), `src/nest/wiring.spec.ts` (the scheme and CA reach the wiring on every host).

## 1.2.3 - 2026-10-22

- Changed: `sandbox.describe` no longer skips: when a required sandbox key is missing it registers one failing test naming the keys and never runs the body.
- Changed: no inline suppression: lazy loads go through one `lazyRequire`, the type tests assert the compiler's diagnostics, and the package lint (inline config refused, every ts directive banned) runs in `npm test`.
- Changed: the package compiles with `exactOptionalPropertyTypes` on (no loosening; it was off): optional options that callers pass an `undefined` through say `| undefined`, and a `fetch` body or header that may be absent is spread in only when present.

## 1.2.0 - 2026-10-02

- Breaking: remove the `starci-test-stack` bin; the stack CLI is exported at `@starci/test-world/cli` for `starci app stack`.
- Added: Kafka as real own infrastructure, Apache Kafka in KRaft mode only. The stack definition must name exactly
  `apache/kafka:4.2.2@sha256:1213eb3943d551e5ed1fca7a4e109001cee35770b66a02a0c37a8964efe09b69` (`KAFKA_IMAGE`, the one pin
  shared with the dev stacks); Redpanda, cp-kafka and an undigested tag fail with `TEST_WORLD_STACK_DEFINITION`, and
  `stacks.kafka` can never be `fakedBy`.
- Added: per-slot Kafka. The broker has 8 slot listeners, each advertising its own toxiproxy port; a slot leases one
  (`RunKafka.listener`), so `world.infra.kafka.cut()` reaches its slot alone (the stack-wide Kafka proxy exception is gone).
  Topics, consumer groups and client ids of a slot begin with `<namespace>.`: `w.kafka.group(name)`, `w.kafka.clientId(name)`.
  Readiness is the topics script on the INTERNAL listener plus an ApiVersions round trip through the slot's proxy (no Kafka
  client dependency). Before each file the slot's topics are emptied up to the high watermark and its idle groups deleted;
  teardown deletes only the slot's groups (waiting out a dead member's session timeout, then failing by name) and topics.
- Added: schema-per-context Postgres. A connection may name a shared `database` and its `schema`: the connections of one
  database share it (one copy per slot), each in its own schema with its own login role (`search_path` = the schema).
  `w.db.<name>.schema`; reset empties only the context's schema; `infra.postgresql.connection(name).cut()` of a schema context
  stops its login only (`NOLOGIN`), so the contexts beside it keep serving. Contexts sharing a database must each declare a
  distinct schema (never `public` or `pg_*`).
- Changed: extensions are created in `public` of each database.
- Added: `apps.<name>.rawBody` (default false): the world creates that app with Nest's `rawBody`, as a `main.ts` that verifies
  signed webhooks over the exact body (`request.rawBody`) does.
- Added: `webhookApp` on the four payment fakes (sepay, payos, momo, vnpay): the declared app whose listener receives their
  webhooks, for a world with several listening apps (default unchanged: the first listening app). An HTTP fake's `client`
  now receives the declared options.
- Added: crash reclaim. A run records on its lease what it provisioned, service by service; when its process dies (a crash,
  a killed jest) the lease is kept, and the next attach (or `down`) claims it and tears it down through the same detach as a
  normal run: its databases, roles, realm, Redis DB, buckets, topics, consumer groups, namespaces and proxies. One live
  process claims a dead lease at a time; a dead lease that provisioned nothing is dropped as before. A Kafka teardown waits up
  to 60 s (the default session timeout is 45 s) for a group whose dead member has not expired.
- Fixed: the Kafka probe answers false when a cut proxy closes the connection without a reply (it left the promise pending).
- Added: GraphQL subscriptions in the test API. `api.subscribe(operation, { variables, timeoutMs })` (and on any bound caller,
  `api.as(token).subscribe(...)`) opens a graphql-ws (`graphql-transport-ws`) subscription at the app's GraphQL path on
  Node's own WebSocket (no new dependency), with the caller's bearer as `connectionParams.authorization`. The handle has
  `next(timeoutMs)` (waits for the next unread frame, TEST_WORLD_TIMED_OUT at the deadline), `frames()`, `errors()`,
  `closed()` and `close()`; a refused connection rejects with its close code, and the world closes any subscription a spec
  left open before the apps stop. For EX-KINDS (ecommerce realtime scenarios).
- Changed: the SePay fake signs every delivery with a timestamp: `x-sepay-timestamp: <epoch ms>` and `x-sepay-signature:
  sha256=<hmac of "<timestamp>.<exact body>">` (`sepaySignature`, `sepayVerifySignature`; the body-only `sepayBodySignature`
  and `sepayVerifyBody` are removed). `replayWebhook(reference, { ageMs })` and `delayWebhook({ ..., ageMs })` deliver the
  captured body validly re-signed `ageMs` in the past, so a spec proves the app's replay window refuses a stale delivery
  (`failNext({ badSignature })` still covers a tampered signature). For EX-KINDS (ecommerce webhook scenarios).

## 1.1.0 - 2026-10-02

- Added: per-worker data slots, so world spec files run in parallel. The globalSetup provisions N slots, N = min(jest
  `maxWorkers`, the declaration's new `workers` cap, default 2). A slot is a complete, independent run: its own namespace
  `<package>_<hash>_w<k>` and run token `<run>-w<k>`, so its own Postgres database per connection (migrated and seeded per slot),
  its own Keycloak realm, its own leased Redis DB index, its own MinIO/Qdrant/Kafka/k3d prefixes, its own fakes host, its own
  toxiproxy proxies and its own outage lock (in the slot's run directory). The teardown disposes every slot; a failed setup
  disposes the slots already made.
- Changed: the state file is protocol 2 (`{ version: 2, library, runId, slots }`); a spec process reads the slot named by
  `STARCI_TEST_WORLD_SLOT`, which `@starci/jest-preset` 2.2.4's world runner sets per file. The pair is exact: a state file of
  another protocol, or a process with no slot of the run, is the new `TEST_WORLD_PAIR_MISMATCH` naming both versions (re-pin
  both per canon-pins). `RunContext.version` is replaced by `RunContext.slot`; `namespaceOf(root, slot)` takes the slot.
- Fixed: a realm file that pins entity ids (a user `id` that a seed row names as the token `sub`) could be imported once per Keycloak server only: ids are unique server-wide, so a second slot (or a second checkout) failed with 409 Conflict. The import remaps each pinned user id to a per-namespace UUID (`namespacedId`, sha256 of `<namespace>:<id>`), drops the ids of clients, roles, groups, client scopes and components, and the slot's seeds are applied with the same user-id rewrite (`RunKeycloak.userIds`).
- Fixed: the stack, namespace and registry specs built their fixtures under a host path; they use the OS temp directory.
- Known limitation: Kafka's proxy is stack-wide (the broker advertises its proxied address), so a Kafka outage in one slot
  reaches the others; Redis has 16 DB indexes machine-wide, so slots x concurrent repositories must stay within 16.

## 1.0.5

- Added: a modules world boots real peer apps beside its modules: `useTestWorld({ modules, apps: ["order"] })` reserves the
  peers' ports first and wires `w.apps.<peer>.url`, so the integration client of one app runs against the real other app.
- Added: `world.apps.<name>.during(fn)`, the outage of an app as its peers see it: stop it, run `fn`, boot it again with the
  same options and port; it takes and keeps the run's outage lock like every other outage.
- Added: `w.keycloak.clientSecret(client)`. The realm import gives every confidential client (not public, not bearer-only) a
  secret generated for the run, whatever the realm file says; a repository never commits a client secret.

## 1.0.4

- Changed: `world.resolve(token)` and `scope.resolve(token)` take any Nest provider token (`ProviderToken<T>`: a class, a
  string or a symbol), so a modules spec resolves an integration client bound to a symbol (`{ provide: SEPAY, useClass:
  SepayClient }`) through the world instead of reaching into `world.context`. `ProviderToken` is exported.

## 1.0.3

- Fixed: the globalSetup registers the path aliases of the declaration exactly as TypeScript resolves them. It walks the
  `extends` chain of `src/tests/tsconfig.json` (or `tsconfig.json`): a string or an array (later entries win), relative paths
  and package specifiers, JSONC. `paths` comes from the nearest config that declares it, and its targets are relative to the
  effective `baseUrl` (resolved against the folder of the config that declares it) or, without one, to the folder of the
  config that declares `paths`. Before, a tests tsconfig that only extended the side's tsconfig resolved `@modules/*` under
  `src/tests/`, so a declaration importing an alias could not be loaded (`TEST_WORLD_CONFIG_INVALID`) although tsc was clean.

## 1.0.2

- Changed: every path a declaration names (`stack`, seeds, the Keycloak realm, k3d Dockerfiles) resolves from the app root: `appRootOf` finds the directory of the app's `hfs.json` from the jest rootDir (the rootDir itself or its parent, the be side's app). `.starcistacks` lives at the app root, never under `be/`. An explicit `root` still wins.

## 1.0.1

- Added: `world.keycloak.events(personId)` and `world.keycloak.sessions(personId)`: the user events the repository realm
  stored for a person (LOGIN, LOGIN_ERROR, LOGOUT, ... with client, session, error and time; the realm import enables events)
  and the person's live sessions with the clients that hold their tokens, read through the realm's admin API. The admin
  credentials stay inside the library.
- Added: `world.infra.postgresql.connection(name)` with `cut()`, `restore()` and `during(fn)`: the outage of ONE declared
  connection's database (it stops accepting connections and its sessions are terminated) while the other connections keep
  serving. It takes and keeps the run's outage lock like every other outage, and a world that stops with a database still
  down restores it. `world.interruptDatabase(fn, connection?)` takes the connection.

## 1.0.0

First release, pinned in `knowledge/hfs/canon-pins.yaml` for back ends.

- Added: `defineTestWorld` and the frozen spec-facing API (`useTestWorld({ apps } | { modules })`, `world.apps.<name>.api`, `world.db.<connection>`, `world.fake.<name>`, `world.infra.<service>` latency/cut/restore, `world.cluster`, `world.http`, `world.services`, `world.waitFor`, `world.commandBus/queryBus`, `world.signedInPerson`/`actAs`, `useSandbox` for contract specs).
- Added: the shared warm stack for all repositories (`starci-test-stack up|down|status`): postgres, redis, minio, qdrant, kafka, Keycloak behind toxiproxy, keyed by image; per-repository isolation by namespace (database names, Keycloak realm, Redis DB index, bucket/collection/topic prefixes, k3d namespaces, per-run proxies); k3d with a local registry and pull-through mirrors, own images built by content hash with GC of `src-*` tags.
- Added: the fakes framework (`@starci/test-world/fakes`) with request recording and failure injection, and the shared fakes `smtp`, `openai-compatible`, `vnpay`, `momo`, `payos`, `sepay`.
- Added: `@starci/test-world/global-setup` and `/global-teardown` (thin re-exports in `src/tests/world/`), the migrate step once per run, seeds, per-spec reset.
- Replaces the infrastructure the per-repository world carried; `src/tests/world/` keeps `test-world.config.ts`, `use-test-world.ts`, the two jest hook re-exports and `fakes/` (R47).
- Added: the run's outage lock. Every world holds it shared while it boots, around every test and while it stops; every outage
  (`world.infra.<service>.cut()`, `latency(ms)`, `during(fn)`, `keycloak.rotateClientSecret`) takes it exclusively itself and keeps
  it until `restore()` (a rotation until the world stops), so outage specs are serialized against every other spec file of the
  run under `--maxWorkers` > 1 without the spec doing anything. Writers win, an outage spec gives its own shared hold up while it
  waits (no deadlock between two outage specs), a dead holder is broken, and only the world that injected an outage restores the
  proxies at its stop.
- Added: `world.apps.<name>.restart()`, `world.applicationOrigin(app?)`, `world.withRequest(...)`, `world.buckets.<name>`,
  `world.registerPerson`, `world.scratchDir`, `infra.keycloak.rotateClientSecret(client)` and typed wiring by declared names.
