import type { EnvSource } from "@modules/platform/config"
import type { PassportOptions } from "./passport.options"

/** Reads the passport configuration with no credential or localhost defaults; secrets read `<KEY>_FILE` first. */
export const parsePassportConfig = (env: EnvSource): PassportOptions => ({
    google: {
        clientId: env.string("GOOGLE_CLIENT_ID"),
        clientSecret: env.secret("GOOGLE_CLIENT_SECRET"),
        callbackUrl: env.url("GOOGLE_CALLBACK_URL"),
    },
    tokens: {
        issuer: env.url("AUTH_JWT_ISSUER"),
        audience: env.string("AUTH_JWT_AUDIENCE"),
        privateKey: env.secret("AUTH_JWT_PRIVATE_KEY"),
        keyId: env.string("AUTH_JWT_KEY_ID"),
        accessTtlSeconds: env.int("AUTH_ACCESS_TTL_SECONDS", 900),
    },
    refresh: {
        name: "refresh_token",
        path: "/auth/refresh",
        ttlSeconds: env.int("AUTH_REFRESH_TTL_SECONDS", 2_592_000),
        cookieDomain: env.optionalDomain("AUTH_COOKIE_DOMAIN"),
    },
})
