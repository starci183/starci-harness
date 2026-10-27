/** The JSON envelope makes a completed null value distinct from a pending SQL-null outcome. */
export interface ClientOutcomeRow<T> {
    /** The operation's complete JSON result, including expected refusals. */
    readonly value: T
}

/** The row returned by the atomic client claim. */
export interface ClaimClientRow<T> {
    /** The digest recorded by the first operation under this scoped key. */
    readonly request_fingerprint: string | null
    /** The saved result, or null only for a claim inserted by this transaction. */
    readonly outcome: ClientOutcomeRow<T> | null
    /** An existing row had no completed outcome, so it must never run an effect again. */
    readonly incomplete: boolean
}

/** The persisted outcome returned to the first caller. */
export interface SavedClientOutcomeRow<T> {
    /** The normalized JSON result as the database stores it. */
    readonly outcome: ClientOutcomeRow<T>
}

/** A claimed or deleted delivery key returned by inbox persistence. */
export interface InboxEventRow {
    /** The event or client key owned by the row. */
    readonly event_id: string
}

/** The bounded retention batch's aggregate result. */
export interface InboxSweepRow {
    /** Number of completed client claims removed by this transaction. */
    readonly deleted_count: number
}
