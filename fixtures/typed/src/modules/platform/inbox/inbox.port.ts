import type { EntityManager } from "typeorm"

/** Claims a provider event once. */
export interface Inbox {
    /** True when the event is new; with tx the claim shares the caller transaction. */
    claim(source: string, eventId: string, tx?: EntityManager): Promise<boolean>
    /** Runs one client operation in the caller's transaction and replays its outcome. */
    runClient<T>(request: { principalId: string; operation: string; idempotencyKey: string; request: object }, tx: EntityManager, effect: () => Promise<T>): Promise<T>
}
