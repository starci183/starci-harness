import type { CorrelationHeaders, CorrelationWork } from "./correlation.contracts"

/** Runs infrastructure work under a supplied identity so logging stamps its async descendants. */
export interface CorrelationRunner {
    /** Restores the surrounding logging scope when the work returns or throws. */
    run<T>(correlationId: string, work: CorrelationWork<T>): T
}

/** Resolves explicit request identities without exposing the logger's ambient state. */
export interface CorrelationIds {
    /** Uses a valid W3C trace id, then a bounded request id, otherwise asks the Ids port. */
    fromHeaders(headers: CorrelationHeaders): string
    /** Mints an identity for work that starts without an inbound request. */
    create(): string
}
