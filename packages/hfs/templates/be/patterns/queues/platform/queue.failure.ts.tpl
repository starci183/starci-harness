import { DomainError } from "@modules/platform/errors"

/**
 * The class of a flow failure (contexts/code/be/resilience.md BE-RESILIENCE-2): `transient` is retried by the queue attempts with
 * backoff; `input`, `code` and `config` park the flow as `failed_awaiting_fix`, because a retry cannot help until the input, the code
 * or the configuration changes.
 */
export type FailureClass = "transient" | "input" | "code" | "config"

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

const ownClassOf = (cause: object): FailureClass | undefined => {
    const own: unknown = Reflect.get(cause, "failureClass")
    return isFailureClass(own) ? own : undefined
}

const codeOf = (cause: object): string | undefined => {
    const code: unknown = Reflect.get(cause, "code")
    return typeof code === "string" ? code : undefined
}

/**
 * The class of a failure: a `failureClass` the error carries wins; a domain error is `config` when its code names a configuration or
 * connection and `input` otherwise; a dropped connection, a timeout or a database lock conflict is `transient`; anything else is
 * `code`, a defect only a fix resolves.
 */
export const classifyFailure = (cause: unknown): FailureClass => {
    if (typeof cause !== "object" || cause === null) return "code"
    const own = ownClassOf(cause)
    if (own !== undefined) return own
    const code = codeOf(cause) ?? ""
    if (cause instanceof DomainError) return CONFIG_CODE.test(code) ? "config" : "input"
    return TRANSIENT_CODES.has(code) ? "transient" : "code"
}
