/** The options of the http capability: what the outbound client trusts beyond Node's bundled certificate authorities. */
export interface HttpOptions {
    /**
     * PEM of one more certificate authority the client trusts, beside Node's bundled roots and never instead of them, so
     * every other host is still verified as before (the test world passes its per-run fake CA, `w.fake.<name>.ca`).
     * Absent, the client trusts the bundled roots alone. Verification is never turned off.
     */
    readonly trustedCa?: string
}
