import type { LogFields } from "./logging.port"

/** What a redacted value is written as. */
export const REDACTED = "[redacted]"

/**
 * The endings of a field name whose value is a credential (`password`, `refreshToken`, `clientSecret`, `x-api-key`): the value
 * is replaced, the key is kept so the line still says one was there. Matched on the name without case and punctuation, at its
 * end, so `tokenCount` or `sessionId` stay readable.
 */
const SECRET_ENDINGS = Object.freeze([
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "cookie",
    "apikey",
    "privatekey",
    "credentials",
])

/** True when `key` names a credential. */
const isSecretKey = (key: string): boolean => {
    const plain = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
    return SECRET_ENDINGS.some((ending) => plain.endsWith(ending))
}

/** How deep nested plain objects and arrays are walked; anything deeper is written as the redaction mark. */
const MAX_DEPTH = 4

/** Masks credential-named keys of plain objects and arrays, walking at most MAX_DEPTH levels; any other value passes unchanged. */
const redactValue = (value: unknown, depth: number): unknown => {
    if (Array.isArray(value)) return depth >= MAX_DEPTH ? REDACTED : value.map((item) => redactValue(item, depth + 1))
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return value
    if (depth >= MAX_DEPTH) return REDACTED
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, isSecretKey(key) ? REDACTED : redactValue(item, depth + 1)]),
    )
}

/** Returns the caller's fields with every credential-named key masked; the logger applies it to every line before any transport sees it. */
export const redactLogFields = (fields: LogFields | undefined): LogFields => {
    if (fields === undefined) return {}
    const redacted = redactValue(fields, 0)
    return typeof redacted === "object" && redacted !== null ? { ...redacted } : {}
}
