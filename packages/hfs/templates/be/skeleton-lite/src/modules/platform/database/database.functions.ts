import type { EntityManager } from "typeorm"

/** The database functions this app may call, each listed with its reason in ruleParams.be.dbFunctions or hfs.json sides.be.dbFunctions. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*(?:.[a-z_][a-z0-9_]*)?$/

/**
 * Calls one database function TypeORM cannot express (a pg built-in or a SECURITY DEFINER function of a migration) with numbered
 * parameters; the function name is an identifier the canon lint holds to the listed set, never a value.
 */
export const callDbFunction = async <T>(manager: EntityManager, name: string, args: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>> => {
    if (!IDENTIFIER.test(name)) throw new TypeError(`${name} is not a database function name`)
    const placeholders = args.map((_, index) => `$${String(index + 1)}`).join(", ")
    return manager.query<Array<T>>(`SELECT * FROM ${name}(${placeholders})`, [...args])
}

/** Takes a transaction-scoped advisory lock on the 64-bit hash of `key`; it is released when the manager's transaction ends. */
export const advisoryXactLock = async (manager: EntityManager, key: string): Promise<void> => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])
}

/** Sends one NOTIFY on `channel` with `payload`, delivered when the manager's transaction commits. */
export const notify = async (manager: EntityManager, channel: string, payload: string): Promise<void> => {
    await manager.query("SELECT pg_notify($1, $2)", [channel, payload])
}
