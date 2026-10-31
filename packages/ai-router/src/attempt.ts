import type { QuotaWindow } from "./providers.ts"
import type { RateLimitInfo } from "./headers.ts"
import type { ErrorClass } from "./types.ts"

/** What an `AttemptError` may carry beyond its class and message. */
export interface AttemptErrorOptions {
    readonly status?: number
    readonly info?: RateLimitInfo | null
    readonly missingKey?: boolean
    /** The provider's error code, for the blacklist event. */
    readonly code?: string
    /** A quota window the provider's answer named. */
    readonly window?: QuotaWindow
}

/** A failed attempt inside the router, before it becomes part of an `AiRouterError`. */
export class AttemptError extends Error {
    readonly errorClass: ErrorClass
    readonly status: number | undefined
    readonly info: RateLimitInfo | null
    readonly missingKey: boolean
    readonly code: string | undefined
    readonly window: QuotaWindow | undefined

    /** Builds the error. */
    constructor(errorClass: ErrorClass, message: string, options: AttemptErrorOptions = {}) {
        super(message)
        this.errorClass = errorClass
        this.status = options.status
        this.info = options.info ?? null
        this.missingKey = options.missingKey ?? false
        this.code = options.code
        this.window = options.window
    }

    /** The same failure with another message (a scrubbed one). */
    withMessage(message: string): AttemptError {
        return new AttemptError(this.errorClass, message, {
            ...(this.status === undefined ? {} : { status: this.status }),
            info: this.info,
            missingKey: this.missingKey,
            ...(this.code === undefined ? {} : { code: this.code }),
            ...(this.window === undefined ? {} : { window: this.window }),
        })
    }
}
