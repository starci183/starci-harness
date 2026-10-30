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
export const isActiveMigration = (file: string) => file.startsWith(`${MIGRATIONS_DIR}/`) && !file.startsWith(`${MIGRATIONS_ARCHIVE_DIR}/`);
export const SEED_FILE = `${DB_DIR}/seed.sql`;
/** The managed pre-migration bootstrap (slot app.db.bootstrap): `starci app sync` renders it, and `db baseline --squash` owns one marked section. */
export const BOOTSTRAP_FILE = `${DB_DIR}/bootstrap.sql`;
export const BOOTSTRAP_SQUASH_BEGIN = '-- >>> starci app db baseline --squash: roles, role settings and grants a per-database dump loses (regenerate with the verb; do not edit) >>>';
export const BOOTSTRAP_SQUASH_END = '-- <<< starci app db baseline --squash <<<';
/**
 * db/bootstrap.sql split into the part sync renders (`head`) and the squash section (`section`, from its begin line through its end line, or
 * null). A begin marker without its end marker is no section, so the whole text stays the rendered part and differs from the render.
 */
export function bootstrapSection(text: string) {
  const start = text.indexOf(BOOTSTRAP_SQUASH_BEGIN);
  const end = start < 0 ? -1 : text.indexOf(BOOTSTRAP_SQUASH_END, start);
  if (start < 0 || end < 0 || (start > 0 && text[start - 1] !== '\n')) return { head: text, section: null };
  const newline = text.indexOf('\n', end);
  const stop = newline < 0 ? text.length : newline + 1;
  return { head: text.slice(0, start) + text.slice(stop), section: text.slice(start, stop) };
}
