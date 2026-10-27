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

/** The domain work whose JSON result commits with the client receipt. */
export type ClientOperationEffect<T> = () => Promise<T>

/** The signed provider header may omit its delivery identity; the adapter refuses that delivery. */
export type InboxEventId = string | undefined

/** Deduplicates a delivery inside the transaction that records its receipt or applies its effect. */
export interface Inbox {
    /** Claims once per source and event id; a rolled-back transaction gives the claim back automatically. */
    claim(source: string, eventId: InboxEventId, tx: EntityManager): Promise<boolean>
    /** Claims, applies and records one JSON outcome inside the caller transaction; retries replay it. */
    runClient<T>(request: ClientOperation, tx: EntityManager, effect: ClientOperationEffect<T>): Promise<T>
    /** Deletes one bounded batch of completed client claims older than the cutoff. */
    sweepClients(cutoff: Date, tx: EntityManager): Promise<number>
}
