# Back-end patterns

How back-end code is placed and shaped, one Markdown file per topic, true to the lite reference app and to
`@starci/eslint-canon-be`. Each rule has a stable id, a one-sentence law, its reason and its enforcer: an
`eslint-canon-be` rule id (with the HFS rule of [hfs/rules.yaml](../../hfs/rules.yaml) it belongs to), an hfs check, or
"review only". Values (budgets, role lists, owner tables, scenarios) live in [hfs/slots.yaml](../../hfs/slots.yaml)
and are named, never restated. Rules both sides share are [patterns/shared](../shared/README.md) and are read first.

Readers: an authoring op reads the topics of the slots it codes; the anatomy generator reads each file's front matter
`slots`.

Reading order for a back-end feature: [shared](../shared/README.md) → architecture → folder → the topic of its trigger
kind (api, webhooks, realtime, jobs, cli) → domain, persistence → error, typing, naming → injection, config → test.

| Topic | Decides | Rule ids |
| --- | --- | --- |
| [architecture](architecture.md) | Tier direction, app files, module shape, kind isolation | BE-ARCHITECTURE-1 … 6 |
| [folder](folder.md) | Responsibility roots, kind folders, capability shape | BE-FOLDER-1, 2, 4 |
| [api](api.md) | Api feature shape, CQRS messages, thin handlers, operation proof, operation table | BE-API-1, 3, BE-CQRS-1 … 4, BE-OPERATIONS-1 |
| [transport](transport.md) | GraphQL default, REST evidence, one dispatch, no envelope | BE-TRANSPORT-1 … 3 |
| [api-auth](api-auth.md) | Default deny, identity and resource authorization, bounds, cursors, edge, probes | BE-AUTH-1 … 4, 6 … 8 |
| [webhooks](webhooks.md) | Signed door, verify first, durable intake, proof | BE-WEBHOOK-1 … 4 |
| [realtime](realtime.md) | Read-only doors, principal topics, resume, shared hubs, proof | BE-REALTIME-1 … 5, 7 |
| [jobs](jobs.md) | Fenced job row, guarded writes, run keys, processor and steps | BE-JOBS-1 … 5 |
| [queues](queues.md) | Typed producers, relay identity, schedules | BE-QUEUES-1 … 4 |
| [background](background.md) | Every background task has a composed runner | BE-BACKGROUND-1, 2 |
| [cli](cli.md) | The one cli app, groups and sub-commands, thin commands, argv ownership | BE-CLI-1 … 4 |
| [idempotency](idempotency.md) | Inbox claim first, one inbox table, client receipts | BE-IDEMPOTENCY-1 … 3 |
| [domain](domain.md) | Capability ownership, direct call versus enqueued work | BE-DOMAIN-1, 2 |
| [persistence](persistence.md) | Schema authority, SQL constants, transactions, connections, Supabase boundary | BE-PERSISTENCE-1 … 11, 16, 17, 19 |
| [error](error.md) | Error families, throw versus Outcome, catch, filter and formatter | BE-ERROR-1 … 5 |
| [typing](typing.md) | Shapes, layer contracts, mutability, enums, narrowing, zod placement | BE-TYPING-1 … 5, 8 |
| [naming](naming.md) | File suffixes, classes, tokens, methods, type suffixes, GraphQL fields | BE-NAMING-1, 2, 5 … 8 |
| [function](function.md) | Store-held invariants, helper ownership and budgets, function forms, scan smells | BE-FUNCTION-6, 7, 9, 10 |
| [imports](imports.md) | One flat index per owner, jest aliases | BE-IMPORTS-1, 7 |
| [comment](comment.md) | Docblock placement, member docs, no second language | BE-COMMENT-1, 3, 7 |
| [injection](injection.md) | Injectors, tokens, fixed names, no locator | BE-INJECTION-1 … 4 |
| [infra](infra.md) | One owner per raw library, HTTP timeout, integrations, cache keys | BE-INFRA-1 … 4 |
| [config](config.md) | Env reader, per-capability parsers, no default secrets, sealed custody | BE-CONFIG-1 … 4 |
| [logging](logging.md) | Logger port, enum identities, correlation when declared | BE-LOGGING-1, 2, 4 |
| [messages](messages.md) | Message bundles, locale resolution | BE-MESSAGES-1, 2 |
| [temporal](temporal.md) | The injected clock and ids | BE-TEMPORAL-1 |
| [resilience](resilience.md) | Retry through job attempts and the platform timer | BE-RESILIENCE-1 |
| [test](test.md) | Placement, testing module, kit doubles, cases, assertions, world, coverage, builders | BE-TEST-1, 2, 4, 5, 7, 9, 12, 13, 16 |
| [event-bus](event-bus.md) | Full: event classes, publish in the transaction, consumers, proof | BE-EVENT-BUS-2 … 5 |
| [reactors](reactors.md) | Full: consumers of another context, replayable local copies | BE-REACTORS-1, 3 |
| [saga](saga.md) | Full: step and compensation pairs, fenced run state, contracts, failure specs | BE-SAGA-1 … 4 |
| [projections](projections.md) | Full: read models with one writer, recompute and get, replay | BE-PROJECTIONS-1 … 4 |
| [services](services.md) | Full: service placement, pinned images, vendored contracts, additive events | BE-SERVICES-1 … 4, BE-PERSISTENCE-15 |

Gaps in a numbered range are ids merged into another rule; the id that absorbed them carries the decision.

House rule: one place per rule. Feedback hardens a rule in its one place, or becomes a lint rule or gate in the
harness; it never becomes a case note beside it.
