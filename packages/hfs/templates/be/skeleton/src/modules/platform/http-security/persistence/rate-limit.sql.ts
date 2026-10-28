import { sql } from "@modules/platform/database"

/**
 * Counts one hit in the caller's window and answers the hits of that window: a missing or expired window opens afresh at one
 * hit and ends at $3 ($1 tier and address key, $2 instant, $3 end of a fresh window).
 */
export const HIT_RATE_WINDOW = sql`INSERT INTO http_security_rate_windows (key, hits, reset_at)
    VALUES ($1::varchar, 1, $3::timestamptz)
    ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN http_security_rate_windows.reset_at <= $2::timestamptz THEN 1
            ELSE http_security_rate_windows.hits + 1 END,
        reset_at = CASE WHEN http_security_rate_windows.reset_at <= $2::timestamptz THEN EXCLUDED.reset_at
            ELSE http_security_rate_windows.reset_at END
    RETURNING hits`

/** Deletes a bounded batch of the windows that ended by $1; a second replica skips the rows this one holds. */
export const PRUNE_RATE_WINDOWS = sql`DELETE FROM http_security_rate_windows WHERE key IN (
    SELECT key FROM http_security_rate_windows WHERE reset_at <= $1::timestamptz
    LIMIT 100 FOR UPDATE SKIP LOCKED
)`
