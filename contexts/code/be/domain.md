---
slots: [be.domain, be.domain.messages]
---
# Domain capabilities

Where a business decision lives: a capability that owns its rules, its tables and its transaction. Persistence shape
is persistence.md, failures error.md, copy messages.md.

## BE-DOMAIN-1 A capability owns its rules, its tables and its transaction

`modules/domain/<capability>/` holds `index.ts`, its module files, one or more `<name>.service.ts` each with its spec,
`<capability>.contracts.ts` (the plain types its services take and answer), pure `<name>.policy.ts` and
`<name>.mapper.ts` helpers, `errors/`, `messages/` and `persistence/`. A service is the only writer of its tables; it
reads and writes through the injected `EntityManager` and its `persistence/*.sql.ts` constants, never a repository or
store class. It answers views or contract types, mapped from rows by its mapper; a row type never leaves through a
door. A capability is named for the business capability, never a layer; a large one splits into several services
(`OrdersService` writes, `OrdersReadService` serves the authenticated reads).

Why: a capability that owns its rules and tables changes them without asking anyone, and one writer per table keeps
every invariant in one reviewed place.

```ts
@Injectable()
/** The orders of a workspace: the only writer of the orders table. */
export class OrdersService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** Cancels a draft and answers it; null when the order is no longer a draft, so a repeat changes nothing. */
    async cancel(workspaceId: string, orderId: string): Promise<OptionalOrder> {
        const rows = returnedRows(await this.entityManager.query(CANCEL_ORDER, [workspaceId, orderId]), isOrderRow)
        return rows[0] ?? null
    }
}
```

Enforced by: `context-owner`, `sql-owner`, `no-repository-class`, `em-injection-slots`, `import-owner-entry` (R174,
R86, R83, R88, R30).

## BE-DOMAIN-2 Work that answers now is a direct call; work that runs later is enqueued

Inside one database the handler's service calls the other domain services it needs in the same transaction and
returns the result: no event, queue or bus. Work that is slow, external or retried (a provider call, a model run, a
notification) is enqueued by the service in its transaction through a typed queue producer (BE-QUEUES-1) and runs in a
job. A change other clients must see is pushed through the realtime hub (BE-REALTIME-2). In full, another context's
facts arrive as events (event-bus.md) and are never read from its tables.

Why: an event inside one transaction turns one atomic decision into a chain that can half-fail, and an external call
inside a request ties the user's wait to a provider.

- When a confirmation must reach a customer after an order is confirmed → the order service writes the order and
  enqueues the delivery job in one transaction; the job sends it.

Enforced by: `outbox-write-tx`, `no-external-call-in-transaction` (R152, R82); same-context direct calls are review
only.
