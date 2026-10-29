// postgres.mjs - the one door of the `starci app db` verbs to a self-hosted PostgreSQL: psql and pg_dump through ctx.spawn (never a
// shell). The database is named by an environment variable holding a postgres connection URL (`--url-env <NAME>`, default
// DATABASE_URL); the password travels only in the child's PGPASSWORD, never in argv, a file, a line or an error.
import { failure, refusal } from '../stack/errors.mjs';
import { firstLine, tool } from '../stack/context.mjs';

/** The default environment variable that names the app's database. */
export const DEFAULT_DB_URL_ENV = 'DATABASE_URL';
/** The history table `starci app db migrate` records applied migrations in (the layout the supabase/postgres image already ships). */
export const HISTORY_TABLE = 'supabase_migrations.schema_migrations';

const KEY = /^[A-Z][A-Z0-9_]*$/u;

const scrub = (text, secrets) => secrets.reduce((out, secret) => out.replaceAll(secret, '[value]'), String(text));

/** { url, password } of a postgres connection URL with the password removed, or null when `value` is not one. */
export function parseConnection(value) {
  try {
    const url = new URL(value);
    if (!/^postgres(?:ql)?:$/u.test(url.protocol)) return null;
    const password = decodeURIComponent(url.password);
    url.password = '';
    return { url: url.toString(), password };
  } catch { return null; }
}

/** The database `name` (an UPPER_CASE environment variable, default DATABASE_URL) names: { how, url, env, secrets }. */
export function dbTarget(ctx, name = DEFAULT_DB_URL_ENV) {
  if (!KEY.test(name)) throw refusal('DB_USAGE', '--url-env must name an UPPER_CASE environment variable');
  const value = ctx.env[name];
  if (typeof value !== 'string' || value === '') throw refusal('DB_URL_ENV_MISSING', `${name} is not set`);
  const parsed = parseConnection(value);
  if (!parsed) throw refusal('DB_URL_INVALID', `${name} is not a postgres connection URL`);
  return { kind: 'url', how: `connection string from ${name}`, urlEnv: name, url: parsed.url, env: parsed.password ? { PGPASSWORD: parsed.password } : {}, secrets: [value, parsed.password].filter(Boolean) };
}

/** Runs a PostgreSQL client tool against `target`; a failure names the first stderr line with every secret scrubbed (or withholds it). */
export function pgTool(ctx, target, command, args, { withhold = false, code = 'DB_CLI_FAILED' } = {}) {
  const run = tool(ctx, command, args, { cwd: ctx.cwd, env: { ...ctx.env, ...target.env } });
  if (run.error) throw failure('DB_CLI_MISSING', `cannot run ${command}; install the PostgreSQL client tools (psql, pg_dump)`);
  if (run.status !== 0) throw failure(code, withhold ? `${command} failed; output withheld` : `${command} failed: ${scrub(firstLine(run.stderr), target.secrets)}`);
  return { stdout: run.stdout ?? '', text: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

const PSQL = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];

/** Runs SQL statements (`-c`) and files (`-f`) in ONE transaction: each step is { sql } or { file }. */
export function psqlTransaction(ctx, target, steps, options = {}) {
  const args = [...PSQL, '-1', '-d', target.url, ...steps.flatMap((step) => (step.file !== undefined ? ['-f', step.file] : ['-c', step.sql]))];
  return pgTool(ctx, target, 'psql', args, options);
}

/** The rows of one read-only query as plain objects (json_agg on the server, so no psql formatting is parsed). */
export function queryRows(ctx, target, sql, options = {}) {
  const wrapped = `select coalesce(json_agg(row_to_json(q)), '[]'::json) from (${sql.replace(/;\s*$/u, '')}) q`;
  const { stdout } = pgTool(ctx, target, 'psql', [...PSQL, '-A', '-t', '-d', target.url, '-c', wrapped], options);
  let rows;
  try { rows = JSON.parse(stdout.trim() || '[]'); } catch { throw failure('DB_QUERY_UNREADABLE', 'the database answered rows psql could not print as JSON; output withheld'); }
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw failure('DB_QUERY_UNREADABLE', 'the database answer is not a rows array');
  return rows;
}

/** A SQL string literal of `value`. */
export const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

/** The versions the history table records; an absent table is an empty history (a database `migrate` has never touched). */
export function historyVersions(ctx, target) {
  const [presence] = queryRows(ctx, target, `select pg_catalog.to_regclass(${literal(HISTORY_TABLE)}) is not null as present`);
  if (presence?.present !== true) return new Set();
  return new Set(queryRows(ctx, target, `select version from ${HISTORY_TABLE} order by version`).map((row) => String(row.version)));
}

/** The statement that creates the history table when it is absent (same columns as the image's own: version, statements, name). */
export const HISTORY_DDL = `create schema if not exists supabase_migrations; create table if not exists ${HISTORY_TABLE} (version text primary key, statements text[], name text)`;

/** Records `version` (named `name`) as applied. */
export const markApplied = (version, name) => `insert into ${HISTORY_TABLE} (version, name) values (${literal(version)}, ${literal(name)}) on conflict (version) do update set name = excluded.name`;

/** Removes `version` from the history. */
export const markReverted = (version) => `delete from ${HISTORY_TABLE} where version = ${literal(version)}`;
