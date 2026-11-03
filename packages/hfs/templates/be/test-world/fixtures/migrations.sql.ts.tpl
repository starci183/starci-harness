import type { EntityManager } from "typeorm"
import { sql } from "@modules/platform/database"

/** One row of a connection's migration ledger: the name of a migration the cli migrate step applied. */
export interface AppliedMigrationRow {
    /** The migration class name. */
    readonly name: string
}
{{migrationQueries}}
/** Reads the ledger of one connection with one of the queries above; a connection the world did not wire fails the spec. */
export const appliedMigrations = (
    manager: EntityManager | undefined,
    query: ReturnType<typeof sql>,
): Promise<ReadonlyArray<AppliedMigrationRow>> =>
    manager === undefined ? Promise.reject(new Error("The test world wired no such connection")) : manager.query(query)
