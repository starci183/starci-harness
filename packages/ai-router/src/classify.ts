import type { QuotaWindow } from "./providers.ts"
import type { ErrorClass, ProviderKind } from "./types.ts"

/** The fields of a provider error, whatever shape it came in (docs/design.md, error shapes). */
export interface ProviderErrorInfo {
    /** The HTTP status, or the numeric `code` OpenRouter puts inside a 200 body. */
    readonly status: number | undefined
    /** `error.type` (Anthropic, OpenAI) or Gemini's gRPC `status` (`RESOURCE_EXHAUSTED`). */
    readonly type: string
    /** `error.code` as text (`insufficient_quota`, `Arrearage`, `quota_exceeded`), or a top-level `code` (DashScope). */
    readonly code: string
    /** A sub-code: Anthropic `error.details.error_code`, OpenRouter `error.metadata.limit_source` or `error_type`. */
    readonly detail: string
    readonly message: string
}

/** How one failed attempt is classified, and for a quota, until when its key stays out when the provider said so. */
export interface Classified {
    readonly errorClass: ErrorClass
    /** The provider's most specific code (detail, code or type), for telemetry. */
    readonly code: string | undefined
    /** A quota window the answer named; absent: the pool's `quotaBlacklistMs`. */
    readonly window?: QuotaWindow
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
    if (typeof value === "string") return value
    if (typeof value === "number") return String(value)
    return ""
}

/**
 * Reads a provider error body into its fields. It knows the OpenAI `{ error: { message, type, code, param } }`, the
 * Anthropic `{ type: "error", error: { type, message, details } }`, OpenRouter's `{ error: { code: <status>, message,
 * metadata } }`, Gemini's object or one-element list `[{ error: { code, message, status } }]` and DashScope's top-level
 * `{ code, message }`. Anything else leaves the fields empty and the raw text as the message.
 */
export function readProviderError(body: unknown, status: number | undefined): ProviderErrorInfo {
    const root: unknown = Array.isArray(body) ? body[0] : body
    const error = isRecord(root) ? (isRecord(root.error) ? root.error : typeof root.code === "string" ? root : undefined) : undefined
    if (error === undefined) return { status, type: "", code: "", detail: "", message: typeof body === "string" ? body : "" }
    const details = isRecord(error.details) ? error.details : {}
    const metadata = isRecord(error.metadata) ? error.metadata : {}
    const numeric = typeof error.code === "number" ? error.code : undefined
    return {
        status: status ?? numeric,
        type: text(error.type) || text(error.status),
        code: numeric === undefined ? text(error.code) : "",
        detail: text(details.error_code) || text(metadata.limit_source) || text(metadata.error_type),
        message: text(error.message),
    }
}

/** Codes and types that mean the key's quota, credit or billing is spent: another key may serve, this one will not soon. */
const QUOTA_CODES = new Set([
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
    "billing_error",
    "billing_not_active",
    "payment_required",
    "quota_exceeded",
    "insufficient_balance",
    "arrearage",
    "allocationquota.freetieronly",
    "enforced_spend_limit_reached",
    "openrouter_key_limit",
    "openrouter_credits",
])

/** Messages that mean the same where a provider sends no code (DeepSeek, Anthropic's own usage limits, OpenRouter's free tier). */
const QUOTA_MESSAGE =
    /credit balance is too low|insufficient (?:credits|balance)|reached your specified (?:workspace )?api usage limits|exceeded your current quota|credit balance is depleted|free-models-per-day|requests per day|per day limit|perday/i

/** Codes and types that mean the secret itself is refused: wrong, revoked, expired or leaked. */
const AUTH_CODES = new Set(["invalid_api_key", "authentication_error", "authentication", "invalidapikey", "unauthenticated", "permission_error", "permission_denied", "accessdenied", "model.accessdenied", "invalid_authentication"])
const AUTH_MESSAGE = /reported as leaked|incorrect api key|invalid api key|api key (?:not valid|is invalid|expired)|invalid authentication/i

/** Codes that mean the request was refused for what it is, not for the key: no retry. */
const INVALID_CODES = new Set(["context_length_exceeded", "invalid_request", "invalid_request_error", "invalidparameter", "datainspectionfailed", "modelnotfound", "model_not_found", "not_found", "not_found_error", "parameter_unknown", "request_too_large"])

/** Codes of a rate limit: a short cooldown of the key and model. */
const RATE_CODES = new Set(["rate_limit_exceeded", "rate_limit_error", "too_many_requests", "slow_down", "throttling", "throttling.ratequota", "throttling.allocationquota", "throttling.burstrate", "openrouter_in_flight_budget", "resource_exhausted"])

/** Codes of a provider that is overloaded or failing: transient. */
const TRANSIENT_CODES = new Set(["overloaded_error", "api_error", "server_error", "service_unavailable", "service_unavailable_error", "server_is_overloaded", "internalerror", "timeout_error", "deadline_exceeded"])

/** The quota window a provider's answer implies, beyond the default TTL (docs/design.md, the blacklist lifecycle). */
function windowOf(kind: ProviderKind, info: ProviderErrorInfo, codes: readonly string[]): QuotaWindow | undefined {
    const has = (code: string): boolean => codes.includes(code)
    // Anthropic's tier spend cap and OpenAI's monthly usage and spend limits reset at the start of the next UTC month.
    if (has("enforced_spend_limit_reached") || has("organization_usage_limit_exceeded") || has("organization_spend_limit_exceeded") || has("project_spend_limit_exceeded")) return { kind: "month-utc" }
    // Gemini's requests-per-day reset at midnight Pacific time.
    if (kind === "gemini" && (has("quota_exceeded") || /per ?day/i.test(info.message))) return { kind: "day", timeZone: "America/Los_Angeles" }
    // OpenRouter's free-model daily cap resets at 00:00 UTC.
    if (kind === "openrouter" && /free-models-per-day|per day/i.test(info.message)) return { kind: "day", timeZone: "UTC" }
    // Groq's request limit is per day (x-ratelimit-*-requests); its reset header carries the exact time instead.
    return undefined
}

/**
 * Classifies a failed attempt from its status and error body, per provider kind (docs/design.md, the classification
 * table). Order: a refused secret, then a spent quota (which some providers send as 429 or 400), then a rate limit,
 * then the status alone. Classes: `auth` and `quota` blacklist the key, `rate_limit` cools it down, `transient` feeds
 * the breakers, `invalid_request` is the caller's and is not retried.
 */
export function classifyFailure(kind: ProviderKind, status: number | undefined, body: unknown): Classified {
    const info = readProviderError(body, status)
    const codes = [info.detail, info.code, info.type].map((code) => code.toLowerCase()).filter((code) => code !== "")
    const code = [info.detail, info.code, info.type].find((value) => value !== "")
    const has = (set: ReadonlySet<string>): boolean => codes.some((value) => set.has(value))
    const effective = info.status
    const out = (errorClass: ErrorClass, window?: QuotaWindow): Classified => ({ errorClass, code, ...(window === undefined ? {} : { window }) })

    // OpenRouter's in-flight budget is a 402 that clears by itself: a short wait, not a spent quota.
    if (codes.includes("openrouter_in_flight_budget")) return out("rate_limit")
    if (effective === 401 || has(AUTH_CODES) || AUTH_MESSAGE.test(info.message)) {
        // OpenRouter answers 403 for a moderation or guardrail block: the request's fault, not the key's.
        if (kind === "openrouter" && effective === 403) return out("invalid_request")
        return out("auth")
    }
    // Gemini words its per-minute 429 like a spent quota; only a daily limit is one (the project's RPD, until midnight Pacific).
    if (kind === "gemini" && effective === 429 && !codes.includes("quota_exceeded") && !/per ?day/i.test(info.message)) return out("rate_limit")
    const billingPrecondition = codes.includes("failed_precondition") && /billing/i.test(info.message)
    if (effective === 402 || has(QUOTA_CODES) || QUOTA_MESSAGE.test(info.message) || billingPrecondition) return out("quota", windowOf(kind, info, codes))
    if (effective === 403) return out(kind === "openrouter" ? "invalid_request" : "auth")
    if (effective === 429 || has(RATE_CODES)) return out("rate_limit")
    if (effective !== undefined) {
        // Anthropic 529 overloaded, Groq 498 flex capacity, 408/409/425 and every 5xx are worth another lane.
        if (effective === 408 || effective === 409 || effective === 425 || effective === 498 || effective >= 500) return out("transient")
        if (effective >= 400) return out("invalid_request")
    }
    if (has(TRANSIENT_CODES)) return out("transient")
    if (has(INVALID_CODES) || codes.some((value) => /invalid|context_length|not_found/.test(value))) return out("invalid_request")
    return out("transient")
}

/** The parts of a wall-clock time in a time zone. */
function wallClock(time: number, timeZone: string): { hour: number; minute: number; second: number } {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(time))
    const part = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value ?? 0)
    return { hour: part("hour"), minute: part("minute"), second: part("second") }
}

/** The next midnight in a time zone after `now` (to the second; a DST day is corrected once). */
export function nextMidnight(now: number, timeZone: string): number {
    const elapsed = (clock: { hour: number; minute: number; second: number }): number => ((clock.hour * 60 + clock.minute) * 60 + clock.second) * 1000
    let candidate = now - (now % 1000) + 86_400_000 - elapsed(wallClock(now, timeZone))
    const off = elapsed(wallClock(candidate, timeZone))
    // On a DST change the candidate lands an hour off midnight: move it back (23:00) or forward (01:00).
    if (off !== 0) candidate += off > 43_200_000 ? 86_400_000 - off : -off
    return candidate
}

/** When a quota window ends after `now`. */
export function windowEnd(window: QuotaWindow, now: number): number {
    if (window.kind === "month-utc") {
        const date = new Date(now)
        return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
    }
    return nextMidnight(now, window.timeZone)
}
