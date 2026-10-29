import type { EnvSource } from "@modules/platform/config"
import { parseServerConfig } from "@modules/platform/config"
import { parsePrimaryDatabaseConfig } from "@modules/platform/database"
import { parseHttpConfig } from "@modules/platform/http"
import { parseHttpSecurityConfig } from "@modules/platform/http-security"

/** The {{app}} environment values required before composition. */
export interface {{appPascal}}Env {
    /** The HTTP listener. */
    readonly server: ReturnType<typeof parseServerConfig>
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: ReturnType<typeof parseHttpSecurityConfig>
    /** What the outbound HTTP client trusts beyond Node's bundled certificate authorities. */
    readonly http: ReturnType<typeof parseHttpConfig>
    /** The primary database connection. */
    readonly database: ReturnType<typeof parsePrimaryDatabaseConfig>
}

/** Reads the {{app}} environment; missing or invalid values fail boot, and secrets use `_FILE` first. */
export const read{{appPascal}}Env = (env: EnvSource): {{appPascal}}Env => ({
    server: parseServerConfig(env),
    httpSecurity: parseHttpSecurityConfig(env),
    http: parseHttpConfig(env),
    database: parsePrimaryDatabaseConfig(env),
})
