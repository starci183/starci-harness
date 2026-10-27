---
slots: [be.feature.reactors]
---
# Reactors

Decides who listens when another context announces a fact this context must remember or act on: a reactor that keeps a local copy
or triggers a projection recompute. The consumer door is BE-EVENT-BUS-4, its claim BE-IDEMPOTENCY-1, its composition
BE-BACKGROUND-1, and that it never reaches into the other context BE-PERSISTENCE-11.

Edition: whether lite admits this pattern is open ([project/lite.md](../../project/lite.md) "Patterns").

## BE-REACTORS-1 A reactor is a consumer plus plain CQRS
`features/reactors/<reactor>/` holds `transport/message/<event>.consumer.ts`, `<reactor>-message.module.ts` and an `application/` of
plain CQRS. The consumer maps the delivery and dispatches one command forwarding `delivery.eventId`; the domain service of the
reactor's own context does the work in one transaction. Everything it needs from the other context arrives in the event.

Why: delivery is at least once; the reactor stays a door and the decision stays in the domain.

Enforced by: R153 BE_EVENT_CONSUMER_SHAPE, R203 BE_FEATURE_THIN, R156 BE_KIND_ISOLATION.

## BE-REACTORS-3 The local copy lives in the reactor's own context and is replayable
The copy is a table of the context that owns the reactor, on its connection, written by a domain service of that context. The write
is an idempotent upsert keyed by the aggregate id and guarded by the event version or id, so replaying the stream from the start
rebuilds the same rows and a duplicate delivery changes nothing.

Why: a copy that cannot be rebuilt is a second source of truth.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R80 BE_INBOX_DEDUPE_MISSING.
