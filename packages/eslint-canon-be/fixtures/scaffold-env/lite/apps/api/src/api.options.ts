import type { StorageOptions } from "@modules/integrations/storage"
import type { ServerOptions } from "@modules/platform/config"
import type { DatabaseConnectionOptions } from "@modules/platform/database"
import type { HttpSecurityOptions } from "@modules/platform/http-security"

/** Everything the API needs from its environment, parsed by `api.env.ts` and handed to `AppModule.register`. */
export interface ApiOptions {
    /** The HTTP listener. */
    readonly server: ServerOptions
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: HttpSecurityOptions
    /** The least-privilege PostgreSQL connection to the app database. */
    readonly database: DatabaseConnectionOptions
    /** The S3-compatible object storage configuration. */
    readonly storage: StorageOptions
}
