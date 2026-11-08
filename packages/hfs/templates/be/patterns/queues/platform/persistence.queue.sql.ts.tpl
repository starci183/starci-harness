import { sql, type SqlText } from "@modules/platform/database"

/** Writes one job in the outbox ($1 queue, $2 payload, $3 instant, $4 correlation id). */
export const INSERT_QUEUE_ROW: SqlText = sql`INSERT INTO queue_outbox (queue, payload, created_at, correlation_id)
    VALUES ($1, $2, $3, $4)`

/** Locks and reads the oldest rows that wait ($1 batch size); a second relay skips the rows this one holds. */
export const SELECT_WAITING_ROWS: SqlText = sql`SELECT id, queue, payload, correlation_id AS "correlationId" FROM queue_outbox
    WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`

/** Marks the rows as handed to BullMQ ($1 ids, $2 instant). */
export const MARK_ROWS_SENT: SqlText = sql`UPDATE queue_outbox SET sent_at = $2 WHERE id = ANY($1::uuid[])`
