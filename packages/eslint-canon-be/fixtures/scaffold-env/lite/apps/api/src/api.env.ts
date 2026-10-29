import type { EnvSource } from "@modules/platform/config"
import { parseServerConfig } from "@modules/platform/config"
import { parsePrimaryDatabaseConfig } from "@modules/platform/database"
import { parseHttpSecurityConfig } from "@modules/platform/http-security"
import { parseStorageConfig } from "@modules/integrations/storage"

/** The API environment values required before composition. */
export interface ApiEnv {
    /** The HTTP listener. */
    readonly server: ReturnType<typeof parseServerConfig>
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: ReturnType<typeof parseHttpSecurityConfig>
    /** The least-privilege PostgreSQL connection to the app database. */
    readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
    /** The S3-compatible object storage configuration. */
    readonly storage: ReturnType<typeof parseStorageConfig>
}

/** Reads the API environment; missing or invalid values fail boot, and secrets use `_FILE` first. */
export const readApiEnv = (env: EnvSource): ApiEnv => ({
    server: parseServerConfig(env),
    httpSecurity: parseHttpSecurityConfig(env),
    database: parsePrimaryDatabaseConfig(env),
    storage: parseStorageConfig(env),
})
