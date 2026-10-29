import type { HttpSecurityOptions } from "@modules/platform/http-security"
import type { ServerOptions } from "@modules/platform/config"
import type { DatabaseConnectionConfig } from "@modules/platform/database"
import type { HttpOptions } from "@modules/platform/http"

/** Everything the {{app}} app needs from its environment, parsed by `{{app}}.env.ts` and handed to `AppModule.register`. */
export interface {{appPascal}}Options {
    /** The HTTP listener. */
    readonly server: ServerOptions
    /** The origin allowlist and rate limits. */
    readonly httpSecurity: HttpSecurityOptions
    /** What the outbound HTTP client trusts beyond Node's bundled certificate authorities. */
    readonly http: HttpOptions
    /** The primary database connection. */
    readonly database: DatabaseConnectionConfig
}
