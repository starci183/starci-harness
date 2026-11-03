import { readFileSync } from "node:fs"

/** The file name of the migration that creates the session tables. */
export const IDENTITY_SESSIONS_MIGRATION_FILE = "identity-sessions.sql"

/**
 * The SQL of the tables this package owns (`public.identity_sessions`, `public.identity_refresh_tokens`), read from the package's
 * `migrations/` folder. The app renders it into `db/migrations/<stamp>_identity-sessions.sql` (the starter's baseline carries it); the package
 * and the template hold the same text, and a spec of the template proves it.
 */
export const identitySessionsMigration = (): string =>
    readFileSync(new URL(`../../migrations/${IDENTITY_SESSIONS_MIGRATION_FILE}`, import.meta.url), "utf8")
