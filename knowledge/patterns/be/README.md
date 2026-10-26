# Back-end patterns

How back-end code is placed and shaped, one Markdown file per topic. Each rule states a decision with its reason and keeps its id
(`BE-API-1`, `BE-PERSISTENCE-7`, ...) so citations survive. The short laws and their finding codes are `hfs/rules.yaml`; values
(budgets, role lists, owners, scenarios, pins) live in `hfs/slots.yaml` and `stack/pins.yaml` and are named here, never restated.

Readers:
- An authoring agent reads the topics of a back-end slot before coding it.
- A generator reads each file's front matter: `slots` maps a slot to the topics that teach it, and `files` (where present) is the
  tree `app add` scaffolds.

Reading order for a back-end feature: architecture → folder → the topic of its trigger kind (api, webhooks, realtime, jobs,
reactors, saga, cli) → domain and persistence → error, typing, naming, function, imports, comment → test.

| Topic | Decides | Rule ids |
| --- | --- | --- |
| [architecture](architecture.md) | Tier matrix, app roles, module shape, composition, kind isolation | BE-ARCHITECTURE-1 … 6 |
| [folder](folder.md) | Responsibility roots, kind folders, capability shape | BE-FOLDER-1, 2, 4 |
| [api](api.md) | Api feature shape, CQRS messages and thin handlers, e2e per operation, operation table | BE-API-1, 3, BE-CQRS-1 … 4, BE-OPERATIONS-1 |
| [transport](transport.md) | GraphQL default, REST evidence, presigned transfer, one dispatch, no envelope | BE-TRANSPORT-1 … 3 |
| [api-auth](api-auth.md) | Default deny, identity verification, origin guard, input bounds, cursors, edge trust, probes | BE-AUTH-1 … 8 |
| [webhooks](webhooks.md) | Signed door, verify first, durable intake, provider-fake proof | BE-WEBHOOK-1 … 4 |
| [realtime](realtime.md) | Read-and-push doors, principal topics, door choice, shared hubs | BE-REALTIME-1 … 7 |
| [jobs](jobs.md) | Fenced job row, guarded writes, run keys, processor and steps | BE-JOBS-1 … 5 |
| [queues](queues.md) | Typed producers, relay identity, schedulers | BE-QUEUES-1 … 4 |
| [background](background.md) | Every background task has a composed runner | BE-BACKGROUND-1, 2 |
| [reactors](reactors.md) | Consumers of another context, replayable local copies | BE-REACTORS-1, 3 |
| [saga](saga.md) | Step/compensation pairs, fenced run state, contracts, failure specs | BE-SAGA-1 … 4 |
| [cli](cli.md) | The one cli app, command layout, action runners, argv ownership | BE-CLI-1 … 4 |
| [event-bus](event-bus.md) | Event classes, publish in the transaction, consumers, proof | BE-EVENT-BUS-2 … 5 |
| [idempotency](idempotency.md) | Inbox claim first, one inbox table, client receipts | BE-IDEMPOTENCY-1 … 3 |
| [projections](projections.md) | Read models with one writer, recompute/get, replay | BE-PROJECTIONS-1 … 4 |
| [services](services.md) | Service placement, pinned images, vendored contracts, additive events | BE-SERVICES-1 … 4, BE-PERSISTENCE-15 |
| [domain](domain.md) | Capability ownership, synchronous inside a context | BE-DOMAIN-1, 2 |
| [persistence](persistence.md) | Schema authority, SQL, outbox, connections, contexts, transactions, database access | BE-PERSISTENCE-1 … 14, 16 … 21 |
| [injection](injection.md) | Injectors, tokens, fixed catalog, no locator | BE-INJECTION-1 … 4 |
| [infra](infra.md) | One owner per raw library, HTTP timeout, integrations, cache keys | BE-INFRA-1 … 4 |
| [config](config.md) | Env reader, per-capability config, no default secrets, sealed custody | BE-CONFIG-1 … 4 |
| [logging](logging.md) | Logger port, enum identities, correlation | BE-LOGGING-1, 2, 4 |
| [messages](messages.md) | User copy catalogs, locale resolution | BE-MESSAGES-1, 2 |
| [temporal](temporal.md) | The injected clock | BE-TEMPORAL-1 |
| [resilience](resilience.md) | Retry through the shared helper | BE-RESILIENCE-1 |
| [error](error.md) | Error families, Outcome refusals, catch handling, filter and formatter | BE-ERROR-1 … 6 |
| [typing](typing.md) | Strict flags, named contracts, no escapes, DTOs, zod at non-DTO boundaries | BE-TYPING-1 … 5, 7, 8 |
| [naming](naming.md) | Suffixes, classes, enums, constants, methods, types, GraphQL fields | BE-NAMING-1, 2, 4 … 8 |
| [function](function.md) | Store-enforced invariants, helper ownership, function forms, scan smells | BE-FUNCTION-6, 7, 9, 10 |
| [imports](imports.md) | Owner entries, layout, named exports, jest aliases | BE-IMPORTS-1, 2, 6, 7 |
| [comment](comment.md) | Docblocks, line and block comments, no suppression | BE-COMMENT-1 … 7 |
| [test](test.md) | Placement, testing module, kit doubles, cases, real world, coverage, builders | BE-TEST-1 … 16 |

Gaps in a numbered range are ids merged into another rule; the id that absorbed them carries the decision.

House rule: one place per rule. Each rule lives in exactly one file under one id. Feedback hardens that rule in its one place, or
becomes a lint rule or gate in the harness; it never becomes a case note beside it.
