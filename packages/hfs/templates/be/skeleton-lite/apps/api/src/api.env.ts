import type { EnvSource } from "@modules/platform/config"
import { parseServerConfig } from "@modules/platform/config"
import { parsePrimaryDatabaseConfig } from "@modules/platform/database"
import { parseHttpSecurityConfig } from "@modules/platform/http-security"
import { parsePassportConfig } from "@modules/integrations/passport"
import { parseObjectStorageConfig } from "@modules/integrations/object-storage"

/** The API environment values required before composition. */
export interface ApiEnv {
    /** The HTTP listener. */
    readonly server: ReturnType<typeof parseServerConfig>
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: ReturnType<typeof parseHttpSecurityConfig>
    /** The least-privilege PostgreSQL connection to the app's own database. */
    readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
    /** Google OAuth, the app's own access tokens and the refresh cookie. */
    readonly passport: ReturnType<typeof parsePassportConfig>
    /** S3-compatible object storage. */
    readonly objectStorage: ReturnType<typeof parseObjectStorageConfig>
}

/** Reads the API environment; missing or invalid values fail boot, and secrets use `_FILE` first. */
export const readApiEnv = (env: EnvSource): ApiEnv => ({
    server: parseServerConfig(env),
    httpSecurity: parseHttpSecurityConfig(env),
    database: parsePrimaryDatabaseConfig(env),
    passport: parsePassportConfig(env),
    objectStorage: parseObjectStorageConfig(env),
})
