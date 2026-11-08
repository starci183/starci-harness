/**
 * The class of a flow failure (BE-RESILIENCE-2): `transient` is retried with backoff; `input`, `code` and `config` park the flow,
 * because a retry cannot help until the input, the code or the configuration changes.
 */
export type FailureClass = "transient" | "input" | "code" | "config"

/** The base class of the coded error family, `DomainError` of `@starci/common` (which an app's `platform/errors` re-exports), whose errors carry a stable `code`. */
export type DomainErrorBase = abstract new (...args: never[]) => Error

/** The system and driver codes of a failure that a later attempt can outlive: a dropped or refused connection, a timeout, a lock or serialisation conflict. */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "EPIPE",
    "40001",
    "40P01",
    "57P01",
])

/** A domain code that names a missing or invalid configuration or connection of the app. */
const CONFIG_CODE = /_(?:CONFIG|CONNECTION)_/u

const FAILURE_CLASSES: ReadonlySet<string> = new Set(["transient", "input", "code", "config"])

const isFailureClass = (value: unknown): value is FailureClass => typeof value === "string" && FAILURE_CLASSES.has(value)

const stringField = (cause: object, field: string): string | undefined => {
    const value: unknown = Reflect.get(cause, field)
    return typeof value === "string" ? value : undefined
}

/**
 * The class of a failure, the one rule every consumer of a back end applies (a job runner, a pgmq consumer, an event runner): a
 * `failureClass` the error carries wins; an error of the app's domain family (an instance of `domainError`) is `config` when its code names a
 * configuration or connection and `input` otherwise; a dropped connection, a timeout or a database lock conflict is `transient`;
 * anything else is `code`, a defect only a fix resolves.
 */
export const classifyFailure = (cause: unknown, domainError: DomainErrorBase): FailureClass => {
    if (typeof cause !== "object" || cause === null) return "code"
    const own: unknown = Reflect.get(cause, "failureClass")
    if (isFailureClass(own)) return own
    const code = stringField(cause, "code") ?? ""
    if (cause instanceof domainError) return CONFIG_CODE.test(code) ? "config" : "input"
    return TRANSIENT_CODES.has(code) ? "transient" : "code"
}
