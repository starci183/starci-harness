import type { MailSecurity } from "@starci/mail"
import type { EnvSource } from "@modules/platform/config"
import type { MailLanguage, MailOptions } from "./mail.options"

const DEFAULT_PORT = 587
const CONFIRM_TTL_SECONDS = 86_400
const RESET_TTL_SECONDS = 3_600

const readSecurity = (env: EnvSource): MailSecurity => {
    const value = env.optional("MAIL_SECURITY") ?? "starttls"
    if (value !== "tls" && value !== "starttls" && value !== "none") throw new Error("MAIL_SECURITY must be tls, starttls or none")
    return value
}

const readLanguage = (env: EnvSource): MailLanguage => {
    const value = env.optional("MAIL_DEFAULT_LANGUAGE") ?? "en"
    if (value !== "vi" && value !== "en") throw new Error("MAIL_DEFAULT_LANGUAGE must be vi or en")
    return value
}

/** Reads the mail configuration with no credential or server defaults; the login is optional and its password reads `<KEY>_FILE` first. */
export const parseMailConfig = (env: EnvSource): MailOptions => ({
    host: env.string("MAIL_HOST"),
    port: env.int("MAIL_PORT", DEFAULT_PORT),
    security: readSecurity(env),
    ...(env.has("MAIL_USER") ? { auth: { user: env.string("MAIL_USER"), pass: env.secret("MAIL_PASSWORD") } } : {}),
    from: { name: env.string("MAIL_FROM_NAME"), address: env.string("MAIL_FROM") },
    webOrigin: new URL(env.url("AUTH_WEB_ORIGIN")).origin,
    brandName: env.string("MAIL_FROM_NAME"),
    defaultLanguage: readLanguage(env),
    confirmTtlSeconds: env.int("MAIL_CONFIRM_TTL_SECONDS", CONFIRM_TTL_SECONDS),
    resetTtlSeconds: env.int("MAIL_RESET_TTL_SECONDS", RESET_TTL_SECONDS),
})
