import { sql, type SqlText } from "@modules/platform/database"

/**
 * Claims a delivery in one statement ($1 kind, $2 job key, $3 worker, $4 lease end, $5 payload, $6 instant). A new key inserts the row
 * with token 1; an existing key is claimed again only when the job failed or its lease expired, and then the token is bumped by the
 * store. A done job and a live claim match nothing, so no row comes back.
 */
export const CLAIM_JOB: SqlText = sql`INSERT INTO jobs (kind, job_key, status, fencing_token, claimed_by, lease_expires_at, payload, created_at, updated_at)
    VALUES ($1, $2, 'running', 1, $3, $4, $5::jsonb, $6, $6)
    ON CONFLICT (job_key) DO UPDATE
       SET fencing_token = jobs.fencing_token + 1, claimed_by = $3, lease_expires_at = $4, status = 'running', error = NULL, updated_at = $6
     WHERE jobs.status IN ('failed', 'failed_awaiting_fix') OR (jobs.status = 'running' AND jobs.lease_expires_at < $6)
    RETURNING id, kind, fencing_token, current_step, payload`

/** The guarded writes wrap their UPDATE in a CTE: TypeORM returns a bare `UPDATE ... RETURNING` as `[rows, count]`, a SELECT as rows. */

/** Records a step ($1 job id, $2 expected token, $3 step, $4 instant); no row comes back when the token is stale. */
export const ADVANCE_JOB: SqlText = sql`WITH changed AS (UPDATE jobs SET current_step = $3, updated_at = $4
    WHERE id = $1 AND fencing_token = $2 AND status = 'running'
       RETURNING id)
    SELECT id FROM changed`

/** Completes the job ($1 job id, $2 expected token, $3 instant). */
export const COMPLETE_JOB: SqlText = sql`WITH changed AS (UPDATE jobs SET status = 'done', lease_expires_at = NULL, updated_at = $3
    WHERE id = $1 AND fencing_token = $2 AND status = 'running'
       RETURNING id)
    SELECT id FROM changed`

/** Fails the job ($1 job id, $2 expected token, $3 reason, $4 instant). */
export const FAIL_JOB: SqlText = sql`WITH changed AS (UPDATE jobs SET status = 'failed', error = $3, lease_expires_at = NULL, updated_at = $4
    WHERE id = $1 AND fencing_token = $2 AND status = 'running'
       RETURNING id)
    SELECT id FROM changed`

/**
 * Parks the job ($1 job id, $2 expected token, $3 class, $4 reason, $5 build, $6 instant) as failed_awaiting_fix; the row answers
 * whether its one alert is still due. No row comes back when the token is stale.
 */
export const PARK_JOB: SqlText = sql`WITH before AS (SELECT alerted_at FROM jobs WHERE id = $1),
    changed AS (UPDATE jobs SET status = 'failed_awaiting_fix', failure_class = $3, error = $4, parked_build = $5, parked_at = $6,
           alerted_at = COALESCE(jobs.alerted_at, $6), lease_expires_at = NULL, updated_at = $6
     WHERE id = $1 AND fencing_token = $2 AND status = 'running'
       RETURNING id)
    SELECT (SELECT alerted_at FROM before) IS NULL AS alert_due FROM changed`

/**
 * Marks the parked jobs as resumed ($1 job id or null, $2 build or null, $3 sweep, $4 instant): one by id, those parked under another
 * build, or every one for the sweep, which keeps the alert raised. Each row answers its next resume number.
 */
export const RESUME_JOBS: SqlText = sql`WITH changed AS (UPDATE jobs SET resume_count = resume_count + 1,
           alerted_at = CASE WHEN $3 THEN alerted_at END, updated_at = $4
     WHERE status = 'failed_awaiting_fix' AND ($3 OR id = $1 OR ($2::varchar IS NOT NULL AND parked_build IS DISTINCT FROM $2))
       RETURNING id, kind, job_key, payload, resume_count)
    SELECT id, kind, job_key, payload, resume_count FROM changed`

/** The parked jobs, oldest first: the owner's work items. */
export const AWAITING_FIX_JOBS: SqlText = sql`SELECT id, kind, failure_class, COALESCE(error, '') AS error, parked_at,
    COALESCE(parked_build, '') AS parked_build, resume_count
    FROM jobs WHERE status = 'failed_awaiting_fix' ORDER BY parked_at, id`
