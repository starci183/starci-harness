---
slots: [be.transport.message, be.feature.reactors, be.integrations, be.feature.application, be.transport.graphql, be.transport.http, be.platform]
files:
  - path: src/modules/platform/idempotency/index.ts
    slot: be.platform
    template: idempotency/platform/idempotency/index.ts.tpl
  - path: src/modules/platform/idempotency/errors/idempotency.error.ts
    slot: be.platform
    template: idempotency/platform/idempotency/errors/idempotency.error.ts.tpl
  - path: src/modules/platform/idempotency/messages/idempotency.messages.ts
    slot: be.domain.messages
    template: idempotency/platform/idempotency/messages/idempotency.messages.ts.tpl
  - path: src/modules/platform/inbox/index.ts
    slot: be.platform
    template: idempotency/platform/inbox/index.ts.tpl
  - path: src/modules/platform/inbox/inbox.port.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.port.ts.tpl
  - path: src/modules/platform/inbox/inbox.decorators.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.decorators.ts.tpl
  - path: src/modules/platform/inbox/effectful.decorators.ts
    slot: be.platform
    template: idempotency/platform/inbox/effectful.decorators.ts.tpl
  - path: src/modules/platform/inbox/inbox.options.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.options.ts.tpl
  - path: src/modules/platform/inbox/inbox.module-definition.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.module-definition.ts.tpl
  - path: src/modules/platform/inbox/inbox.module.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.module.ts.tpl
  - path: src/modules/platform/inbox/inbox.service.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.service.ts.tpl
  - path: src/modules/platform/inbox/inbox.service.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/inbox.service.spec.ts.tpl
  - path: src/modules/platform/inbox/request-fingerprint.policy.ts
    slot: be.platform
    template: idempotency/platform/inbox/request-fingerprint.policy.ts.tpl
  - path: src/modules/platform/inbox/request-fingerprint.policy.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/request-fingerprint.policy.spec.ts.tpl
  - path: src/modules/platform/inbox/client-operation.policy.ts
    slot: be.platform
    template: idempotency/platform/inbox/client-operation.policy.ts.tpl
  - path: src/modules/platform/inbox/client-operation.policy.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/client-operation.policy.spec.ts.tpl
  - path: src/modules/platform/inbox/errors/inbox.error.ts
    slot: be.platform
    template: idempotency/platform/inbox/errors/inbox.error.ts.tpl
  - path: src/modules/platform/inbox/messages/inbox.messages.ts
    slot: be.domain.messages
    template: idempotency/platform/inbox/messages/inbox.messages.ts.tpl
  - path: src/modules/platform/inbox/persistence/connection.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/connection.ts.tpl
  - path: src/modules/platform/inbox/persistence/inbox.sql.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/inbox.sql.ts.tpl
  - path: src/modules/platform/inbox/persistence/inbox.rows.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/inbox.rows.ts.tpl
  - path: src/modules/platform/inbox/client-outcome-backfill.client.ts
    slot: be.platform
    template: idempotency/platform/inbox/client-outcome-backfill.client.ts.tpl
  - path: src/modules/platform/inbox/client-outcome-backfill.client.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/client-outcome-backfill.client.spec.ts.tpl
  - path: src/modules/platform/inbox/delivery-claim-backfill.client.ts
    slot: be.platform
    template: idempotency/platform/inbox/delivery-claim-backfill.client.ts.tpl
  - path: src/modules/platform/inbox/delivery-claim-backfill.client.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/delivery-claim-backfill.client.spec.ts.tpl
  - path: src/modules/platform/inbox/delivery-claim-release.client.ts
    slot: be.platform
    template: idempotency/platform/inbox/delivery-claim-release.client.ts.tpl
  - path: src/modules/platform/inbox/delivery-claim-release.client.spec.ts
    slot: be.platform
    template: idempotency/platform/inbox/delivery-claim-release.client.spec.ts.tpl
  - path: src/modules/platform/inbox/persistence/entities/inbox-claim.entity.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/entities/inbox-claim.entity.ts.tpl
  - path: src/modules/platform/inbox/persistence/migrations/1789800005000-create-inbox-claims.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/migrations/1789800005000-create-inbox-claims.ts.tpl
  - path: src/modules/platform/inbox/persistence/migrations/1792800000000-client-operation-outcomes.ts
    slot: be.persistence
    template: idempotency/platform/inbox/persistence/migrations/1792800000000-client-operation-outcomes.ts.tpl
---
# Inbox dedupe and client operation receipts

Decides how a repeated delivery (a signed webhook, a queue message, a relayed outbox row) or a retried client mutation becomes a
no-op instead of a second charge, mail or transition: one inbox table owned by `platform/inbox`, claimed in the receiver's own
transaction. The files tree is the full-edition adapter; lite keeps the same port and API over its own migration-owned table.

## BE-IDEMPOTENCY-1 The delivery service claims the event before it acts
A consumer or reactor is a thin door that forwards the delivery's `eventId` through one command; a signed webhook verifies and calls
one recording intake (BE-WEBHOOK-3). The domain service method that takes the delivery (its first parameter carries `eventId`)
injects `@InjectInbox() private readonly inbox: Inbox` and claims `(source, eventId)` first: inside its transaction, the first
awaited work of the callback is `this.inbox.claim(source, eventId, manager)` with that callback's own manager, and a `false` answer
returns, ending the callback with no further work. The claim, the domain writes and the outbox rows commit or roll back together;
never move the claim to the shared manager outside the transaction to satisfy a check. `source` names the provider or publisher;
`eventId` comes from the delivery, never generated by the receiver. A relay that only produces is not a delivery service. Inbox and
manager are identified by declared type.

Why: a sender without a timely reply resends; a claim persisted before the effect finishes would lose the event on a crash, while a
claim in the effect's transaction makes effect and claim one atomic fact.

Enforced by: R80 BE_INBOX_DEDUPE_MISSING, R85 BE_RAW_INJECT.

## BE-IDEMPOTENCY-2 The inbox is one table, owned by platform, shared by every door
`platform/inbox` owns one table keyed by `(source, event_id)`, with `claimed_at` and the nullable client-receipt columns
`request_fingerprint` and `outcome`, created by its own migrations. `Inbox.claim(source, eventId, tx?)` inserts atomically on the
supplied manager (or the configured one without a caller transaction) with a conflict-safe insert
(`ON CONFLICT (source, event_id) DO NOTHING RETURNING event_id`): `true` for a new row, `false` for a duplicate, without aborting the
caller's transaction. It never reads first and writes after. No capability creates another dedupe table or unique request-key
constraint.

Why: one table with one owner keeps "this event claims at most once" in one place, and the conflict-safe insert is safe under
concurrent delivery and keeps a duplicate's transaction usable.

Enforced by: R80 BE_INBOX_DEDUPE_MISSING, R35 BE_SCHEMA_OWNER.

## BE-IDEMPOTENCY-3 Effectful client commands require a key and replay their committed outcome
Every command that starts an effectful client operation carries the `Effectful()` marker of `platform/inbox` (deciding that a
command is effectful is design review: the check judges marked commands and cannot find an unmarked one) and a required, bounded
string `idempotencyKey` (a GraphQL input field, or REST `Idempotency-Key` through a validated input). Clients keep one key across
retries of one intent and a new key per intent. The thin handler forwards the key to one domain service whose transaction callback
returns `inbox.runClient({ principalId, operation, idempotencyKey, request }, manager, effect)`: the verified principal, a stable
operation name, and every business input that changes the meaning except the key. The inbox canonicalizes and hashes the request,
claims `(client:<principalId>:<operation>, key)` on that manager, and on a matching repeat returns the stored complete outcome
(refusals included) without running `effect`; a different fingerprint throws `IDEMPOTENCY_KEY_REUSED`, a conflict. Claim, local
writes, outbox rows and the JSON outcome commit together, and an exception rolls them all back; the outcome must be JSON data. A
concurrent claimant waits for the first transaction, then replays its outcome or claims after its rollback. No interceptor owns a
claim or transaction. External effects still need an outbox or the provider's own idempotency; the local receipt does not prove
remote dedupe. A fenced job sweeps completed client receipts in bounded batches after the configured retention, keeping delivery
claims; clients retry within the advertised window. Declare `idempotency` and prove its scenarios of `ruleParams.be.patternScenarios`
on real Postgres.

Why: a timeout leaves a client unsure whether a mutation committed; the receipt binds the intent to its durable result while the
fingerprint stops one key from authorizing different work.

- When a transaction fails before commit → let the exception escape; receipt and mutation roll back together and the same key can
  retry.

Enforced by: R310 BE_MUTATION_IDEMPOTENT, R155 BE_PATTERN_SPEC_MISSING, R83 BE_UNNAMED_DATA_ACCESS.
