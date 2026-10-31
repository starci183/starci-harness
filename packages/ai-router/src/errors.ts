import { classifyFailure } from "./classify.ts"
import type { ErrorClass } from "./types.ts"

/** One failed attempt as an error lists it: where it went and why it failed, never a key value. */
export interface AttemptFailure {
    readonly provider: string
    readonly key: string
    readonly model: string
    readonly errorClass: ErrorClass
    readonly status?: number
    readonly message: string
}

/** The fields an `AiRouterError` is built from. */
export interface AiRouterErrorInit {
    readonly errorClass: ErrorClass
    readonly message: string
    readonly status?: number
    readonly provider?: string
    readonly key?: string
    readonly model?: string
    readonly requestId?: string
    readonly attempts?: readonly AttemptFailure[]
    readonly afterFirstToken?: boolean
    /** Epoch milliseconds a 429 asked to wait until. */
    readonly retryAt?: number
}

const RETRYABLE: ReadonlySet<ErrorClass> = new Set<ErrorClass>(["rate_limit", "quota", "auth", "transient", "timeout", "network", "stream"])

/** True for a class another key, provider or model may succeed at. */
export function isRetryable(errorClass: ErrorClass): boolean {
    return RETRYABLE.has(errorClass)
}

/** The one error the router throws. `errorClass` says why; `attempts` lists every failed attempt of the call. */
export class AiRouterError extends Error {
    readonly errorClass: ErrorClass
    readonly retryable: boolean
    readonly status: number | undefined
    readonly provider: string | undefined
    readonly key: string | undefined
    readonly model: string | undefined
    readonly requestId: string | undefined
    readonly attempts: readonly AttemptFailure[]
    readonly afterFirstToken: boolean
    readonly retryAt: number | undefined

    /** Builds the error from its fields. */
    constructor(init: AiRouterErrorInit) {
        super(init.message)
        this.name = "AiRouterError"
        this.errorClass = init.errorClass
        this.retryable = isRetryable(init.errorClass)
        this.status = init.status
        this.provider = init.provider
        this.key = init.key
        this.model = init.model
        this.requestId = init.requestId
        this.attempts = init.attempts ?? []
        this.afterFirstToken = init.afterFirstToken ?? false
        this.retryAt = init.retryAt
    }
}

/** Classifies an HTTP status alone, with no body: 402 quota, 429 rate, 401/403 auth, 408/409/425/498/5xx transient, any other 4xx an invalid request. */
export function classifyStatus(status: number): ErrorClass {
    return classifyFailure("openai-compatible", status, undefined).errorClass
}

/** Replaces every occurrence of each secret with `[redacted]`, so an echoed key never leaves the router. */
export function scrub(text: string, secrets: readonly string[]): string {
    let out = text
    for (const secret of secrets) {
        if (secret.length > 0) out = out.split(secret).join("[redacted]")
    }
    return out
}
