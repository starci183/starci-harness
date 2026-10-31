/** What a response's headers say about a key's headroom; times are epoch milliseconds, 0 when absent. */
export interface RateLimitInfo {
    readonly remainingRequests: number | null
    readonly requestsResetAt: number
    readonly remainingTokens: number | null
    readonly tokensResetAt: number
    /** From `retry-after-ms` or `retry-after` (seconds or an HTTP date). */
    readonly retryAt: number
}

const DURATION = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/

/** Parses an OpenAI reset duration (`1s`, `6m0s`, `20ms`, `1h2m`) or a plain number of seconds into milliseconds. */
export function parseDuration(value: string): number | null {
    const text = value.trim()
    if (text === "") return null
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000
    const match = DURATION.exec(text)
    if (match === null) return null
    const [, h, m, s, ms] = match
    if (h === undefined && m === undefined && s === undefined && ms === undefined) return null
    return Number(h ?? 0) * 3_600_000 + Number(m ?? 0) * 60_000 + Number(s ?? 0) * 1000 + Number(ms ?? 0)
}

function count(headers: Headers, names: readonly string[]): number | null {
    for (const name of names) {
        const raw = headers.get(name)
        if (raw === null) continue
        const value = Number(raw.trim())
        if (Number.isFinite(value) && value >= 0) return value
    }
    return null
}

function resetAt(headers: Headers, names: readonly string[], now: number): number {
    for (const name of names) {
        const raw = headers.get(name)
        if (raw === null) continue
        const plain = Number(raw.trim())
        // A plain number past 1e12 is an epoch in milliseconds (OpenRouter), past 1e9 one in seconds; smaller is a delta.
        if (Number.isFinite(plain) && plain > 1e12) return plain
        if (Number.isFinite(plain) && plain > 1e9) return plain * 1000
        const ms = parseDuration(raw)
        if (ms !== null) return now + ms
        // Anthropic's anthropic-ratelimit-*-reset is an RFC 3339 time.
        const date = /^\d{4}-\d{2}-\d{2}T/.test(raw.trim()) ? Date.parse(raw.trim()) : Number.NaN
        if (!Number.isNaN(date)) return date
    }
    return 0
}

/** Reads `retry-after-ms`, then `retry-after` as seconds or an HTTP date. */
export function retryAt(headers: Headers, now: number): number {
    const ms = headers.get("retry-after-ms")
    if (ms !== null && Number.isFinite(Number(ms))) return now + Number(ms)
    const after = headers.get("retry-after")
    if (after === null) return 0
    const seconds = Number(after.trim())
    if (Number.isFinite(seconds)) return now + seconds * 1000
    const date = Date.parse(after)
    return Number.isNaN(date) ? 0 : date
}

/** Reads the `x-ratelimit-*` (OpenAI, Groq, OpenRouter), `anthropic-ratelimit-*`, `ratelimit-*` and `retry-after` headers of a response. */
export function readRateLimit(headers: Headers, now: number): RateLimitInfo {
    return {
        remainingRequests: count(headers, ["x-ratelimit-remaining-requests", "anthropic-ratelimit-requests-remaining", "x-ratelimit-remaining", "ratelimit-remaining"]),
        requestsResetAt: resetAt(headers, ["x-ratelimit-reset-requests", "anthropic-ratelimit-requests-reset", "x-ratelimit-reset", "ratelimit-reset"], now),
        remainingTokens: count(headers, ["x-ratelimit-remaining-tokens", "anthropic-ratelimit-tokens-remaining"]),
        tokensResetAt: resetAt(headers, ["x-ratelimit-reset-tokens", "anthropic-ratelimit-tokens-reset"], now),
        retryAt: retryAt(headers, now),
    }
}
