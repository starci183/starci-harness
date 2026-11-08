/** How a failure travels: a transport maps each kind to one status. */
export type ErrorKind =
    "invalid" | "unauthenticated" | "forbidden" | "not-found" | "conflict" | "rate-limited" | "unavailable" | "internal"

/** Values that fill the named placeholders of an error text and travel next to the code; never prose. */
export interface ErrorParams {
    readonly [name: string]: string | number
}

/** What a coded error is built from: its code, optional text parameters and the failure that caused it. */
export interface DomainErrorInit<C extends string> {
    /** The stable code, `<CAPABILITY>_<WHAT>`. */
    readonly code: C
    /** Values for the placeholders of the display text; `undefined` is the same as absent, as under `exactOptionalPropertyTypes` a caller may pass `params: maybe`. */
    readonly params?: ErrorParams | undefined
    /** The failure that caused this one, kept for the log; `undefined` is the same as absent. */
    readonly cause?: unknown
}

/**
 * The base of every coded error, in an app and in a package: a stable code, text parameters and the cause. The message is the code
 * itself; display text is resolved from the message catalog by code, so an error never carries prose.
 */
export abstract class DomainError<C extends string> extends Error {
    /** The stable machine code, `<CAPABILITY>_<WHAT>`. */
    readonly code: C

    /** Values for the placeholders of the display text. */
    readonly params: ErrorParams

    constructor(init: DomainErrorInit<C>) {
        super(init.code, init.cause === undefined ? undefined : { cause: init.cause })
        this.name = new.target.name
        this.code = init.code
        this.params = init.params ?? {}
    }
}

/** True for a DomainError of any capability or package. A generic class narrows `unknown` to `DomainError<any>`; this guard narrows to `DomainError<string>`, so its code is a string. */
export const isDomainError = (value: unknown): value is DomainError<string> => value instanceof DomainError
