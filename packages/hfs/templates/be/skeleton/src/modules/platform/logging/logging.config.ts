import type { LokiCredential, LoggingOptions } from "./logging.options"

/**
 * The part of the app's environment reader logging needs. `EnvSource` of platform/config satisfies it; logging names only this
 * shape, so it imports nothing from config (config's errors depend on platform/errors, which logs through this capability).
 */
export interface LoggingEnv {
    /** The declared value of an optional key (its `<KEY>_FILE` already resolved), or undefined. */
    optional(key: string): string | undefined
}

/** Wraps the basic-auth pair so it serializes as a mask wherever the options travel. */
const credential = (value: string): LokiCredential => ({ reveal: () => value, toJSON: () => "[secret]" })

/**
 * Reads the logging options. `LOKI_URL` switches the Loki push on; `LOKI_APP`, `LOKI_ENV` and `LOKI_SERVICE` are its labels (the
 * stack render of a `monitoring.logPush` service sets all four), `LOKI_BASIC_AUTH` (`user:password`, sealed, or `LOKI_BASIC_AUTH_FILE`)
 * and `LOKI_TENANT` are for a Loki behind a door. `service` names the app's service when `LOKI_SERVICE` is undeclared.
 */
export const parseLoggingConfig = (env: LoggingEnv, service: string): LoggingOptions => {
    const url = env.optional("LOKI_URL")
    if (url === undefined) return {}
    const basicAuth = env.optional("LOKI_BASIC_AUTH")
    const tenant = env.optional("LOKI_TENANT")
    return {
        loki: {
            url,
            labels: {
                app: env.optional("LOKI_APP") ?? service,
                env: env.optional("LOKI_ENV") ?? "local",
                service: env.optional("LOKI_SERVICE") ?? service,
            },
            ...(basicAuth === undefined ? {} : { basicAuth: credential(basicAuth) }),
            ...(tenant === undefined ? {} : { tenant }),
        },
    }
}
