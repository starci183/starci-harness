import type { EntityManager } from "typeorm"

/** A same-named runner declared by a platform owner that cannot own write transactions. */
export interface WriteTransaction {
    transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>
}
