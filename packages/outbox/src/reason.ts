/** The longest reason a parked or retried row keeps. */
export const REASON_MAX = 2000

/** How deep the `cause` chain of a failure is followed. */
const CAUSE_DEPTH = 5

const stringOf = (value: unknown): string | undefined => (typeof value === "string" || typeof value === "number" ? String(value) : undefined)

/** A coded failure: an error with a string code and an object of params, the shape of `DomainError` of any copy of `@starci/common`. */
const isCoded = (value: Error): boolean => typeof Reflect.get(value, "code") === "string" && typeof Reflect.get(value, "params") === "object"

const linkOf = (link: Error): string => {
    const code = stringOf(Reflect.get(link, "code"))
    if (isCoded(link)) return `${link.name} ${code ?? ""}`
    return `${link.name}${code === undefined ? "" : ` ${code}`}: ${link.message}`
}

const chainOf = (cause: unknown, depth: number): readonly string[] => {
    if (depth > CAUSE_DEPTH || !(cause instanceof Error)) return []
    const words = linkOf(cause)
    return isCoded(cause) ? [words, ...chainOf(cause.cause, depth + 1)] : [words]
}

/**
 * The reason a row keeps for a failure, for a person: each coded link by class and code, down to the first uncoded throw, which is
 * named by class, code and message (`JobsError JOBS_X <- QueryFailedError 42501: permission denied`); a value that is no error is
 * `unknown failure`. `redact` scrubs the text (the app's credential redaction) before it is bounded.
 */
export const reasonOf = (cause: unknown, redact: (text: string) => string = (text) => text): string => {
    const chain = chainOf(cause, 0)
    const text = chain.length === 0 ? "unknown failure" : chain.join(" <- ")
    return redact(text).slice(0, REASON_MAX)
}
