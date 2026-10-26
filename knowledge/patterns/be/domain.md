---
slots: [be.domain]
files:
  - path: src/modules/domain/<capability>/index.ts
    slot: be.domain
    role: The public surface (services, contracts, errors and the entity and migration arrays), never an entity class used elsewhere.
    rules: [BE_PUBLIC_SURFACE]
  - path: src/modules/domain/<capability>/<capability>.module.ts
    slot: be.domain
    role: Registers the services of the capability.
  - path: src/modules/domain/<capability>/<capability>.service.ts
    slot: be.domain
    role: The rules, in one transaction on the connection of the context.
    rules: [BE_CONTEXT_TRANSACTION, BE_OUTBOX_WRITE_TX]
  - path: src/modules/domain/<capability>/<capability>.service.spec.ts
    slot: be.domain
    role: The unit spec beside the service, with a few mocks.
  - path: src/modules/domain/<capability>/<capability>.contracts.ts
    slot: be.domain
    role: The plain types the service takes and returns.
  - path: src/modules/domain/<capability>/errors/<capability>.error.ts
    slot: be.errors
    role: The error family of the capability.
  - path: src/modules/domain/<capability>/messages/<capability>.messages.ts
    slot: be.domain.messages
    role: The keyed text of the capability in every locale.
  - path: src/modules/domain/<capability>/persistence/connection.ts
    slot: be.persistence
    role: The entity and migration arrays the apps register on the connection of the context.
  - path: src/modules/domain/<capability>/persistence/entities/<table>.entity.ts
    slot: be.persistence
    role: One table of the capability; no relation to another context.
    rules: [BE_CONTEXT_COUPLING]
  - path: src/modules/domain/<capability>/persistence/migrations/<epochMs13>-<name>.ts
    slot: be.persistence
    role: One migration; no foreign key onto another context.
    rules: [BE_CONTEXT_COUPLING]
  - path: src/modules/domain/<capability>/persistence/<name>.sql.ts
    slot: be.persistence
    role: The statements of the capability, one owner per table.
---
# Domain capabilities

Decides where a business decision lives: a capability of one bounded context that owns its rules, tables and transaction, and
when work crosses into an event. Context coupling and transaction scope are persistence.md (BE-PERSISTENCE-11 to 13); the outbox
is BE-PERSISTENCE-5.

## BE-DOMAIN-1 A capability owns its rules, its tables and its transaction
`modules/domain/<capability>/` holds `index.ts`, its module files, `<capability>.service.ts` with its spec beside it,
`<capability>.contracts.ts`, `errors/`, `messages/` and `persistence/` on the connection of its context. The service owns the
scenario: it authorizes, opens one transaction on that connection, coordinates the other capabilities of its context and
publishes its events inside that transaction. Data access is `entityManager` calls and `*.sql.ts` constants, never a store or
repository class (BE-PERSISTENCE-7). Name a capability after the business capability, never a technical layer.

Why: a capability that owns its rules and tables can change them without asking another team, and a transaction on one connection
stays atomic.

Enforced by: R174 BE_CONTEXT_OWNER, R175 BE_CONTEXT_COUPLING, R176 BE_CONTEXT_TRANSACTION, R30 BE_PUBLIC_SURFACE.

## BE-DOMAIN-2 Inside one context the work is synchronous; an event crosses contexts or starts async work
Work inside one context (one connection, one set of tables) is synchronous: the handler delegates to that context's service, which
calls the other services of the context in the same transaction and returns the result; no event, queue or bus is involved. A
fact is published only when (a) another context must react, or (b) the work it starts is asynchronous by nature (a job, a saga
step, a reactor, a projection recompute). No handler waits on an event of its own context, and no context publishes only to tell
itself something. A feature never reads or writes another context's state directly: it receives that context's facts as events
into a local copy or reads a projection its own context owns.

Why: an event inside one context turns one atomic decision into a chain that can half-fail; a direct read of another context
couples two owners through storage and bypasses the owner's rules.

- When a cart item is added (same context, answer needed now) → `CartService.addItem` updates the rows in one transaction and
  returns the cart; no event.
- When the order flow needs whether a payment settled (another context) → the payment service publishes `PaymentSettled` in its
  transaction; an order reactor records it in an order-owned table the order service reads. Querying the payment tables or calling
  the payment service is the violation.
- When a confirmation mail must follow an order → the order service enqueues it in its transaction; the mail runs later, never
  inside the order transaction.

Enforced by: R152 BE_OUTBOX_WRITE_TX, R175 BE_CONTEXT_COUPLING, R86 BE_SQL_TABLE_OWNER.
