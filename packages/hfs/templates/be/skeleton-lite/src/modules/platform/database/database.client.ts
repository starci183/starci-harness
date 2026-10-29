import type { EntityManager } from "typeorm"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"

declare const functionPartBrand: unique symbol
declare const parameterListBrand: unique symbol

/** One part of a database function name that passed the identifier check: the only caller text a call statement holds. */
type DbFunctionPart = string & { readonly [functionPartBrand]: true }

/** The numbered parameters `$1, ..., $n` of one call, built from a count alone. */
type DbParameterList = string & { readonly [parameterListBrand]: true }

/** A function the call statement names: its schema and its name, each part checked. */
interface DbFunctionTarget {
    readonly schema: DbFunctionPart
    readonly name: DbFunctionPart
}

/** The pg built-ins the canon lists bare in ruleParams.be.dbFunctions; each is called in pg_catalog. */
const PG_BUILTINS: ReadonlySet<string> = new Set([
    "pg_advisory_xact_lock",
    "hashtextextended",
    "pg_notify",
    "to_regproc",
    "gen_random_uuid",
])

/** The schema that holds the pg built-ins. */
const BUILTIN_SCHEMA = "pg_catalog"

/** One unquoted lower-case identifier: a part of this shape needs no escaping inside double quotes. */
const PART_PATTERN = /^[a-z_][a-z0-9_]*$/

function assertFunctionPart(_value: string): asserts _value is DbFunctionPart {
    // The brand is compile-time only; `functionPart` is the single caller after checking the part.
}

function assertParameterList(_value: string): asserts _value is DbParameterList {
    // The brand is compile-time only; `parameterList` is the single caller.
}

/** The refusal of a name that is not a callable database function. */
const rejected = (name: string): DatabaseError =>
    new DatabaseError({ code: DatabaseErrorCode.IdentifierRejected, params: { name } })

/** Checks one part of a function name against the identifier shape and brands it. */
const functionPart = (part: string, name: string): DbFunctionPart => {
    if (!PART_PATTERN.test(part)) throw rejected(name)
    assertFunctionPart(part)
    return part
}

/**
 * The function a name calls: `schema.name` for a function of a migration (never in pg_catalog), or a bare pg built-in of
 * the canon's list, called in pg_catalog. Anything else is refused before any SQL is built.
 */
const functionTarget = (name: string): DbFunctionTarget => {
    const parts = name.split(".")
    if (parts.length === 1 && PG_BUILTINS.has(name)) {
        return { schema: functionPart(BUILTIN_SCHEMA, name), name: functionPart(name, name) }
    }
    const [schema, fn] = parts
    if (parts.length !== 2 || schema === undefined || fn === undefined || schema === BUILTIN_SCHEMA) throw rejected(name)
    return { schema: functionPart(schema, name), name: functionPart(fn, name) }
}

/** The numbered parameter list of a call with `count` arguments. */
const parameterList = (count: number): DbParameterList => {
    const list = Array.from({ length: count }, (_, index) => `$${String(index + 1)}`).join(", ")
    assertParameterList(list)
    return list
}

/**
 * Calls one database function TypeORM cannot express (a pg built-in or a SECURITY DEFINER function of a migration) with
 * numbered parameters. The name is schema-qualified (`public.job_claim`) or a bare built-in of the canon's list, each part
 * is checked and double-quoted, and the arguments are values, never text of the statement (R334, R68).
 */
export const callDbFunction = <T>(manager: EntityManager, name: string, args: ReadonlyArray<unknown>): Promise<ReadonlyArray<T>> => {
    const target = functionTarget(name)
    const parameters = parameterList(args.length)
    return manager.query<Array<T>>(`SELECT * FROM "${target.schema}"."${target.name}"(${parameters})`, [...args])
}

/** Takes a transaction-scoped advisory lock on the 64-bit hash of `key`; it is released when the manager's transaction ends. */
export const advisoryXactLock = async (manager: EntityManager, key: string): Promise<void> => {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key])
}

/** Sends one NOTIFY on `channel` with `payload`, delivered when the manager's transaction commits. */
export const notify = async (manager: EntityManager, channel: string, payload: string): Promise<void> => {
    await manager.query("SELECT pg_notify($1, $2)", [channel, payload])
}
