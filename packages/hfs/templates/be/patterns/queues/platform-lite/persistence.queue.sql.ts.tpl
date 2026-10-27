import { sql } from "@modules/platform/database"

/** Writes one job in the outbox ($1 queue, $2 payload, $3 instant, $4 correlation id); the relay hands it to BullMQ after the commit. */
export const INSERT_QUEUE_ROW = sql`INSERT INTO public.queue (queue, payload, created_at, correlation_id)
    VALUES ($1, $2::jsonb, $3, $4)`

/** Locks and reads the oldest rows that wait ($1 batch size); a second relay skips the rows this one holds. */
export const SELECT_WAITING_ROWS = sql`SELECT id, queue, payload, coalesce(correlation_id, id::text) AS "correlationId" FROM public.queue
    WHERE sent_at IS NULL ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`

/** Marks the rows as handed to BullMQ ($1 ids, $2 instant). */
export const MARK_ROWS_SENT = sql`UPDATE public.queue SET sent_at = $2 WHERE id = ANY($1::uuid[])`
