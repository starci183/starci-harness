import { DomainError } from "@starci/common"
import { AUTH_ERROR_KINDS } from "../contracts/index.ts"
import type { AuthErrorCode, AuthErrorKind } from "../contracts/index.ts"

/** The one error class of sign-in: a wire code, the kind it travels as and optional context for the log. */
export class AuthError extends DomainError<AuthErrorCode> {
    readonly kind: AuthErrorKind
    readonly context: Readonly<Record<string, unknown>>

    constructor(code: AuthErrorCode, options: { readonly cause?: unknown; readonly context?: Readonly<Record<string, unknown>> } = {}) {
        super(options.cause === undefined ? { code } : { code, cause: options.cause })
        this.kind = AUTH_ERROR_KINDS[code]
        this.context = options.context ?? {}
    }
}

/** The result of a check that can refuse with a code. */
export type Outcome<T, E extends string = AuthErrorCode> =
    | { readonly kind: "ok"; readonly value: T }
    | { readonly kind: "refused"; readonly code: E; readonly detail?: Readonly<Record<string, unknown>> }

/** An accepted outcome. */
export const ok = <T>(value: T): Outcome<T, never> => ({ kind: "ok", value })

/** A refused outcome. */
export const refused = <E extends string>(code: E, detail?: Readonly<Record<string, unknown>>): Outcome<never, E> =>
    detail === undefined ? { kind: "refused", code } : { kind: "refused", code, detail }
