import { sql } from "@modules/platform/database"

/** The unique source and delivery id let only one transaction record or process each delivery. */
export const CLAIM_EVENT = sql`INSERT INTO public.inbox (source, event_id)
VALUES ($1, $2)
ON CONFLICT (source, event_id) DO NOTHING
RETURNING event_id`

/** A conflicting insert locks the existing row and returns its committed fingerprint and outcome after the winner commits. */
export const CLAIM_CLIENT = sql`INSERT INTO public.inbox (source, event_id, request_fingerprint, claimed_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (source, event_id) DO UPDATE SET outcome = COALESCE(inbox.outcome, '{}'::jsonb)
RETURNING request_fingerprint, outcome, (outcome IS NOT NULL AND (jsonb_typeof(outcome) <> 'object' OR NOT (outcome ? 'value'))) AS incomplete`

/** The JSON envelope distinguishes a completed null result from an uncompleted claim in this transaction. */
export const SAVE_CLIENT_OUTCOME = sql`WITH saved AS (
    UPDATE public.inbox SET outcome = $3::jsonb
    WHERE source = $1 AND event_id = $2
    RETURNING outcome
)
SELECT outcome FROM saved LIMIT 1`

/** Retention never deletes delivery rows or an incomplete claim; its bounded batch skips rows held by active retries. */
export const SWEEP_CLIENTS = sql`WITH expired AS (
    SELECT source, event_id FROM public.inbox
    WHERE source LIKE 'client:%' AND request_fingerprint IS NOT NULL AND outcome IS NOT NULL AND jsonb_typeof(outcome) = 'object' AND outcome ? 'value' AND claimed_at < $1
    ORDER BY claimed_at, source, event_id LIMIT $2 FOR UPDATE SKIP LOCKED
), deleted AS (
DELETE FROM public.inbox AS claims USING expired
WHERE claims.source = expired.source AND claims.event_id = expired.event_id
RETURNING claims.event_id
)
SELECT count(*)::int AS deleted_count FROM deleted`
