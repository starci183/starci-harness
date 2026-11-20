import type { EnvSource } from "@modules/platform/config"
import type { DatabaseConnectionOptions } from "./database.options"
import { PRIMARY_CONNECTION } from "./primary.connection"

/** Reads the least-privilege PostgreSQL connection with no default. */
export const parsePrimaryDatabaseConfig = (env: EnvSource): DatabaseConnectionOptions => ({
    name: PRIMARY_CONNECTION,
    provider: "postgres",
    url: env.secret("PRIMARY_DB_URL"),
    schema: env.string("PRIMARY_DB_SCHEMA"),
})
