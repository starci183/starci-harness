import type { EnvSource } from "@modules/platform/config"
import { parseServerConfig } from "@modules/platform/config"
import { parsePrimaryDatabaseConfig } from "@modules/platform/database"
import { parseHttpSecurityConfig } from "@modules/platform/http-security"

/** The api environment values required before composition. */
export interface ApiEnv {
    /** The HTTP listener. */
    readonly server: ReturnType<typeof parseServerConfig>
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: ReturnType<typeof parseHttpSecurityConfig>
    /** The primary database connection. */
    readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
}

/** Reads the api environment; missing or invalid values fail boot, and secrets use `_FILE` first. */
export const readApiEnv = (env: EnvSource): ApiEnv => ({
    server: parseServerConfig(env),
    httpSecurity: parseHttpSecurityConfig(env),
    database: parsePrimaryDatabaseConfig(env),
})
