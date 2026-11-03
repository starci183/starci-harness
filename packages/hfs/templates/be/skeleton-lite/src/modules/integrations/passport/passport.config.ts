import type { EnvSource } from "@modules/platform/config"
import type { PassportOptions } from "./passport.options"

const ACCESS_TTL_SECONDS = 900
const REFRESH_TTL_SECONDS = 2_592_000
const BCRYPT_COST = 10
const LOGIN_ATTEMPTS = 10
const RESET_ATTEMPTS = 5
const ATTEMPT_WINDOW_MS = 900_000

/** The Google client, or null when the deployment declares none (the Google door is then unavailable). */
const readGoogle = (env: EnvSource): PassportOptions["google"] =>
    env.has("GOOGLE_CLIENT_ID")
        ? {
              clientId: env.string("GOOGLE_CLIENT_ID"),
              clientSecret: env.secret("GOOGLE_CLIENT_SECRET"),
              callbackUrl: env.url("GOOGLE_CALLBACK_URL"),
          }
        : null

/** The key set: the signing key, and the previous public key while its access tokens are still valid (a rotation). */
const readKeys = (env: EnvSource): PassportOptions["keys"] => {
    const previous = env.optional("AUTH_JWT_PREVIOUS_PUBLIC_KEY")
    return [
        { privateKey: env.secret("AUTH_JWT_PRIVATE_KEY"), keyId: env.optional("AUTH_JWT_KEY_ID") },
        ...(previous === undefined ? [] : [{ publicKey: previous, keyId: env.optional("AUTH_JWT_PREVIOUS_KEY_ID") }]),
    ]
}

/** Reads the sign-in configuration with no credential or localhost defaults; secrets read `<KEY>_FILE` first. */
export const parsePassportConfig = (env: EnvSource): PassportOptions => ({
    issuer: env.url("AUTH_JWT_ISSUER"),
    audience: env.optional("AUTH_JWT_AUDIENCE"),
    keys: readKeys(env),
    accessTtlSeconds: env.int("AUTH_ACCESS_TTL_SECONDS", ACCESS_TTL_SECONDS),
    refreshTtlSeconds: env.int("AUTH_REFRESH_TTL_SECONDS", REFRESH_TTL_SECONDS),
    bcryptCost: env.int("AUTH_BCRYPT_COST", BCRYPT_COST),
    returnOrigin: new URL(env.url("AUTH_WEB_ORIGIN")).origin,
    google: readGoogle(env),
    cookie: { name: "refresh_token", domain: env.optionalDomain("AUTH_COOKIE_DOMAIN") },
    budget: {
        loginAttempts: env.int("AUTH_LOGIN_ATTEMPTS", LOGIN_ATTEMPTS),
        resetAttempts: env.int("AUTH_RESET_ATTEMPTS", RESET_ATTEMPTS),
        windowMs: env.duration("AUTH_ATTEMPT_WINDOW", ATTEMPT_WINDOW_MS),
    },
})
