import type { EntityManager } from "typeorm"

/** Claims a provider event once. */
export interface Inbox {
    /** True when the event is new; with tx the claim shares the caller transaction. */
    claim(source: string, eventId: string, tx?: EntityManager): Promise<boolean>
    /** Runs one client operation in the caller's transaction and replays its outcome. */
    runClient<T>(request: { principalId: string; operation: string; idempotencyKey: string; request: object }, tx: EntityManager, effect: () => Promise<T>): Promise<T>
}

/** A provider's receipt row: its entity and the complete row. */
export interface InboxEntityReceipt<Row extends object> {
    readonly entity: new () => Row
    readonly row: Partial<Row>
}

/** The inbox of a capability whose provider receipt is an entity row. */
export interface EntityInbox extends Inbox {
    /** Claims, then inserts the receipt row for the winning claim only; answers its id, undefined on a repeat. */
    claimRow<Row extends object>(source: string, eventId: string, tx: EntityManager, receipt: InboxEntityReceipt<Row>): Promise<string | undefined>
}
