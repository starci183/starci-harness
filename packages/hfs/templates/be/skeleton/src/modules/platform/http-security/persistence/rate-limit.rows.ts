import { rowShape } from "@modules/platform/database"

/** The row HIT_RATE_WINDOW answers. */
export interface RateWindowRow {
    /** The hits of the caller's current window, this one included. */
    readonly hits: number
}

/** Proves one row HIT_RATE_WINDOW answered is a RateWindowRow. */
export const isRateWindowRow: (value: unknown) => value is RateWindowRow = rowShape({ hits: "number" })
