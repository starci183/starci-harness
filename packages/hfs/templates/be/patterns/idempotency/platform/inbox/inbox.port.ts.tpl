import type { EntityManager } from "typeorm"

/** The authenticated scope and complete normalized body of a client operation; the key is never part of the body. */
export interface ClientOperation {
    /** The authenticated principal, mapped by the transport rather than supplied by its client. */
    readonly principalId: string
    /** A stable operation name; neither it nor the principal may contain a colon. */
    readonly operation: string
    /** The client's nonempty key, at most 64 characters. */
    readonly idempotencyKey: string
    /** JSON data that identifies every client-controlled input affecting the result. */
    readonly request: unknown
}

/** The original identity of a delivery receipt. */
export interface DeliveryClaim {
    /** The original publisher or consumer namespace, preserved exactly. */
    readonly source: string
    /** The original delivered event identity. */
    readonly eventId: string
}

/** A delivery receipt transferred from a capability's legacy dedupe store by its data migration. */
export interface DeliveryClaimBackfill extends DeliveryClaim {
    /** The instant the original receiver claimed the event. */
    readonly claimedAt: Date
}

/** The domain work whose JSON result commits with the client receipt. */
export type ClientOperationEffect<T> = () => Promise<T>

/** Deduplicates deliveries by the source and event id of their consumer. */
export interface Inbox {
    /** True for the first claim; with `tx`, the claim commits or rolls back with the caller's effect. */
    claim(source: string, eventId: string, tx?: EntityManager): Promise<boolean>
    /** Gives a separately committed claim back after a failed attempt; a transaction-owned claim rolls back with its effect. */
    release(source: string, eventId: string): Promise<void>
    /** Claims, applies and records one JSON outcome inside the caller's transaction; repeats replay it without running the effect. */
    runClient<T>(request: ClientOperation, tx: EntityManager, effect: ClientOperationEffect<T>): Promise<T>
    /** Deletes at most one bounded batch of completed client claims before the cutoff, keeping delivery claims intact. */
    sweepClients(cutoff: Date, tx: EntityManager): Promise<number>
}
