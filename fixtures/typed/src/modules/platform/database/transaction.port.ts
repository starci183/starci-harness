import type { EntityManager } from "typeorm"

/** Fixture stand-in for the write transaction runner the `platform/database` owner declares. */
export interface WriteTransaction {
    /** Commits when the work resolves and rolls back when it throws. */
    transaction<T>(work: (tx: EntityManager) => Promise<T>): Promise<T>
}
