import type { PassportOptions } from "@modules/integrations/passport"
import type { ObjectStorageOptions } from "@modules/integrations/object-storage"
import type { ServerOptions } from "@modules/platform/config"
import type { DatabaseConnectionOptions } from "@modules/platform/database"
import type { HttpOptions } from "@modules/platform/http"
import type { HttpSecurityOptions } from "@modules/platform/http-security"

/** Everything the API needs from its environment, parsed by `api.env.ts` and handed to `AppModule.register`. */
export interface ApiOptions {
    /** The HTTP listener. */
    readonly server: ServerOptions
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: HttpSecurityOptions
    /** What the outbound HTTP client trusts beyond Node's bundled certificate authorities. */
    readonly http: HttpOptions
    /** The least-privilege PostgreSQL connection to the app's own database. */
    readonly database: DatabaseConnectionOptions
    /** Google OAuth, the app's own access tokens and the refresh cookie. */
    readonly passport: PassportOptions
    /** S3-compatible object storage. */
    readonly objectStorage: ObjectStorageOptions
}
