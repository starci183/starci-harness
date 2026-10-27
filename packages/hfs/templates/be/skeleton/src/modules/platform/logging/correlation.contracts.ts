/** Headers accepted at the logging boundary; repeated values are not correlation identities. */
export interface CorrelationHeaders {
    /** An inbound HTTP header value. */
    readonly [name: string]: string | ReadonlyArray<string> | undefined
}

/** The request identity copied explicitly into transport commands and downstream envelopes. */
export interface CorrelationRequest {
    /** The inbound headers read by logging. */
    readonly headers: CorrelationHeaders
    /** The validated or minted correlation identity. */
    readonly correlationId: string
}

/** Work entered by infrastructure with an explicit identity; its result and failure pass through unchanged. */
export type CorrelationWork<T> = () => T
