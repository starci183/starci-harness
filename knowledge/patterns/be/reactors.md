---
slots: [be.feature.reactors]
files:
  - path: src/features/reactors/<reactor>/index.ts
    slot: be.feature.reactors
    template: reactors/reactor.index.ts.tpl
  - path: src/features/reactors/<reactor>/<reactor>.options.ts
    slot: be.feature.reactors
    template: reactors/reactor.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/reactors/<reactor>/<reactor>.module-definition.ts
    slot: be.feature.reactors
    template: reactors/reactor.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/reactors/<reactor>/<reactor>.module.ts
    slot: be.feature.reactors
    template: reactors/reactor.module.ts.tpl
  - path: src/features/reactors/<reactor>/application/<action>.command.ts
    slot: be.feature.application
    template: reactors/application.command.ts.tpl
  - path: src/features/reactors/<reactor>/application/<action>.handler.ts
    slot: be.feature.application
    template: reactors/application.handler.ts.tpl
  - path: src/features/reactors/<reactor>/application/<action>.contracts.ts
    slot: be.feature.application
    template: reactors/application.contracts.ts.tpl
  - path: src/features/reactors/<reactor>/transport/message/<event>.consumer.ts
    slot: be.transport.message
    template: reactors/consumer.ts.tpl
    role: The consumer door of one event.
    rules: [BE_EVENT_CONSUMER_SHAPE]
  - path: src/features/reactors/<reactor>/transport/message/<reactor>-message.options.ts
    slot: be.transport.message
    template: reactors/message.options.ts.tpl
    role: The options of the module (the configurable module base needs a type); empty until the module takes some.
  - path: src/features/reactors/<reactor>/transport/message/<reactor>-message.module-definition.ts
    slot: be.transport.message
    template: reactors/message.module-definition.ts.tpl
    role: The configurable-module base of the module, registered as register.
  - path: src/features/reactors/<reactor>/transport/message/<reactor>-message.module.ts
    slot: be.transport.message
    template: reactors/message.module.ts.tpl
    role: Registers the consumers with the registry.
  - path: src/tests/e2e/<area>/<event>.e2e-spec.ts
    slot: be.tests.e2e
    role: The reactor's event flow through the bus, redelivery included.
---
# Reactors

Decides who listens when another context announces a fact this context must remember or act on: a reactor that keeps a local copy
or triggers a projection recompute. The consumer door is BE-EVENT-BUS-4, its claim BE-IDEMPOTENCY-1, its composition
BE-BACKGROUND-1, and that it never reaches into the other context BE-PERSISTENCE-12.

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
