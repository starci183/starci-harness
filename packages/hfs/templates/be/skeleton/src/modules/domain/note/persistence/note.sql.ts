import { sql, type SqlText } from "@modules/platform/database"

/** Writes one note ($1 body, $2 written at) and answers the stored row. */
export const INSERT_NOTE: SqlText = sql`INSERT INTO notes (body, created_at) VALUES ($1, $2) RETURNING id, body, created_at`
