# Back-end patterns

How back-end code is placed and shaped, one Markdown file per topic, true to the lite reference app and to
`@starci/eslint-canon-be`, in the rule form of [code/README.md](../README.md). An enforcer here is an
`eslint-canon-be` rule id with its HFS rule, an hfs check, or "review only". Values (budgets, role lists, owner
tables, scenarios) live in [hfs/slots.yaml](../../hfs/slots.yaml) and are named, never restated. Rules both sides
share are [code/shared](../shared/README.md) and are read first. Which consistency or failure mechanism a scenario
takes is [BE-MECHANISM-1](#be-mechanism-1-choosing-a-mechanism-the-smallest-one-the-invariant-needs) below.

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
| [ai](ai.md) | Gateway and key custody, code chain or agent runtime, the LangChain integration, chains, scoped retrieval, the MCP boundary | BE-AI-1 … 6 |
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

## BE-MECHANISM-1 Choosing a mechanism: the smallest one the invariant needs

A scenario takes a consistency or failure mechanism only when one of its invariants calls for it, and then the
smallest one that holds it; no feature takes every mechanism, and a pattern named in a class or a design record is no
evidence that its guarantee holds. The design (an `sds` or `contract` record, [project/work.md](../../project/work.md))
names, per scenario, the question that applied, the mechanism chosen, the simpler one rejected and why, and the
behaviour that proves it; "not applicable" with its reason is a valid answer. The table maps the question to the
mechanism; the rule in its last column owns the code and the proof.

| the scenario asks | start with | take more only when | owner |
| --- | --- | --- | --- |
| where does the behaviour live? | the capability that owns the rule and its tables, reached through one use case | a provider or protocol needs its own adapter | BE-DOMAIN-1, BE-CQRS-3; BE-INFRA-3 |
| do reads and writes need different models? | commands and queries on the bus over one database | a read needs another context's data, which only a read model gives | BE-CQRS-1 … 4; BE-PROJECTIONS-1 |
| can concurrent writes break an invariant? | a constraint or conditional statement in the domain service's transaction | the competing write needs a row lock | BE-FUNCTION-6, BE-PERSISTENCE-10 |
| can a caller repeat a mutation? | a stable operation identity | the effect must not double (a charge, a message), which takes a replayed committed outcome | BE-IDEMPOTENCY-3 |
| must a commit lead to a job or an event? | the outbox row written in the same transaction | another context or service must react | BE-PERSISTENCE-5, BE-QUEUES-1; BE-EVENT-BUS-3 |
| can a delivery arrive twice? | the inbox claim in the receiver's transaction | never less: every delivery is at least once | BE-IDEMPOTENCY-1 |
| does the work cross independent transactions? | one local transaction, when the steps can share one | a later step can fail after an earlier one committed elsewhere and must be undone | BE-SAGA-1 … 4 |
| can a stalled or replaced worker still write? | the fenced job row and its guarded writes | the effect is remote, which takes a run key | BE-JOBS-2, BE-JOBS-3 |
| can a remote call fail transiently? | a required deadline on the call | the call must be retried, which only a job's bounded attempts do | BE-INFRA-2, BE-RESILIENCE-1 |
| can one failing dependency exhaust the app? | bounded lists, rate tiers and queue concurrency | isolation or a breaker is measured to be needed; no topic owns one, so it is held by review | BE-PERSISTENCE-9, BE-AUTH-4 |
| can contracts and read models evolve apart? | versioned event classes that only add | a read model must be rebuilt, which replay does | BE-EVENT-BUS-2, BE-PERSISTENCE-15; BE-PROJECTIONS-4 |
| who may act on this resource? | default deny and the domain service's resource check | never less: every door and job reaches the same check | BE-AUTH-1, BE-AUTH-2 |
| does a request outlive its connection? | a durable status the client reads again | the client must learn of a change, which a push with resume carries | BE-JOBS-1; BE-REALTIME-5, FE-REALTIME |
| who owns client state and its cache? | one owner per kind of state and identity-keyed reads | an optimistic write, which needs its rollback | FE-STATE-1, FE-DATA-KEY, FE-DATA-COMMAND |
| must history rebuild the state? | current-state tables, with an audit row where one is needed | never here: event sourcing is not a mechanism of this standard, and adopting it is an owner ruling | BE-PERSISTENCE-1 |
| can old and new code run side by side? | migrations as the only schema authority and contracts that only add, expanded before they contract | a backfill is needed, which runs as a fenced job | BE-PERSISTENCE-1, 2, 15; BE-JOBS-2 |

A mechanism that needs a pattern is legal only when `sides.be.patterns` declares it; each topic names its pattern, and the
harness declares it for the slots a workflow task's paths lie in, since no task writes `hfs.json`.

Why: every mechanism adds state, failure modes and proof; one taken for its name rather than an invariant is cost
with no guarantee, and one missing where an invariant needs it is a race no serial test shows.

Enforced by: review only; the declared patterns and each mechanism's shape are checked by the rules of its topic.
