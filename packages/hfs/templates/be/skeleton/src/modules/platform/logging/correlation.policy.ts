import { AsyncLocalStorage } from "node:async_hooks"
import type { Ids } from "@modules/platform/ids"
import type { CorrelationHeaders, CorrelationWork } from "./correlation.contracts"
import type { LogFields } from "./logging.port"

// Logging owns the process's sole ambient correlation store; envelopes carry identities across every other boundary.
const correlation = new AsyncLocalStorage<string>()

/** Enters a logging scope without making ambient reads part of the public logging port. */
export const runWithCorrelation = <T>(correlationId: string, work: CorrelationWork<T>): T =>
    correlation.run(correlationId, work)

/** Stamps the logger's fields last so caller-supplied fields cannot replace the active identity; outside any scope the logger's own root identity stands. */
export const stampLogFields = (fields: LogFields | undefined, rootId: string): LogFields => ({
    ...fields,
    correlationId: correlation.getStore() ?? rootId,
})

/** Parses the known W3C prefix; newer versions keep opaque additions, while version 00 permits none. */
const traceIdOf = (traceparent: string): string | undefined => {
    const match = /^(?!ff)([0-9a-f]{2})-((?!0{32})[0-9a-f]{32})-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}((?![\s\S])|-)/.exec(
        traceparent,
    )
    if (!match) return undefined
    if (match[1] === "00" && match[3] === "-") return undefined
    return match[2]
}

/** Reads a valid W3C trace identity or a safe request id; malformed headers cannot enter logs. */
export const correlationFromHeaders = (headers: CorrelationHeaders, ids: Ids): string => {
    const traceparent = headers["traceparent"]
    if (typeof traceparent === "string") {
        const traceId = traceIdOf(traceparent)
        if (traceId) return traceId
    }
    const requestId = headers["x-request-id"]
    return isCorrelationId(requestId) ? requestId : ids.next()
}

/** Accepts only bounded, header-safe identities on serialized async envelopes. */
export const isCorrelationId = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= 128 && !/[^A-Za-z0-9._:-]/.test(value)
