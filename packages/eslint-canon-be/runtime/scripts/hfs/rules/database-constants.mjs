// Single source of database-rule finding codes and the owned db/ paths of a lite app (slot app.db).
export const DB_MIGRATION_SHAPE = 'DB_MIGRATION_SHAPE';
export const DB_RLS_REQUIRED = 'DB_RLS_REQUIRED';
export const DB_DYNAMIC_DDL = 'DB_DYNAMIC_DDL';
export const DB_POLICY_SHAPE = 'DB_POLICY_SHAPE';
export const DB_DEFINER_SAFE = 'DB_DEFINER_SAFE';
export const DB_STORAGE_POLICY = 'DB_STORAGE_POLICY';
export const LITE_DB_MIGRATION = 'LITE_DB_MIGRATION';
export const DB_BASELINE_SHAPE = 'DB_BASELINE_SHAPE';
export const DB_ARCHIVE_MUTATED = 'DB_ARCHIVE_MUTATED';
export const DB_PGMQ_DECLARED = 'DB_PGMQ_DECLARED';
export const DB_EXTENSION_ALLOWED = 'DB_EXTENSION_ALLOWED';
export const DB_MIGRATION_DESTRUCTIVE = 'DB_MIGRATION_DESTRUCTIVE';
export const HFS_SEED_PII = 'HFS_SEED_PII';
export const DB_VAULT_WRITE = 'DB_VAULT_WRITE';

export const DB_DIR = 'db';
export const MIGRATIONS_DIR = `${DB_DIR}/migrations`;
/** The migrations retired at a baseline cutover (slot app.db.migrations.archive): never applied, never judged by L02-L08. */
export const MIGRATIONS_ARCHIVE_DIR = `${MIGRATIONS_DIR}/archive`;
/** True for a migration `starci app db migrate` applies: a path under db/migrations/ outside the archive. */
export const isActiveMigration = (file) => file.startsWith(`${MIGRATIONS_DIR}/`) && !file.startsWith(`${MIGRATIONS_ARCHIVE_DIR}/`);
export const SEED_FILE = `${DB_DIR}/seed.sql`;
