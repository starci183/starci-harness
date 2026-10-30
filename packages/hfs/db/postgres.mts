// postgres.mjs - the one door of the `starci app db` verbs to a self-hosted PostgreSQL: psql and pg_dump through ctx.spawn (never a
// shell). The database is named by an environment variable holding a postgres connection URL (`--url-env <NAME>`, default
// DATABASE_URL); the password travels only in the child's PGPASSWORD, never in argv, a file, a line or an error. An in-container target
// (`inContainer`) runs the same tools inside the database's own container through docker exec, the password on stdin.
import path from 'node:path';
import { failure, refusal } from '../stack/errors.mjs';
import { firstLine, tool } from '../stack/context.mjs';
import type { SpawnResult, VerbContext } from '../release/index.mjs';

/** The default environment variable that names the app's database. */
export const DEFAULT_DB_URL_ENV = 'DATABASE_URL';
/** The history table `starci app db migrate` records applied migrations in (Supabase's layout, so a history restored from a hosted Supabase carries over; migrate creates it on an empty database). */
export const HISTORY_TABLE = 'supabase_migrations.schema_migrations';

const KEY = /^[A-Z][A-Z0-9_]*$/u;

const scrub = (text: unknown, secrets: readonly string[]): string => secrets.reduce((out, secret) => out.replaceAll(secret, '[value]'), String(text));

/** A database a verb reaches: its connection URL (password removed), the environment that carries the password, and the secrets to scrub from any text. */
export interface DbTarget {
  kind?: 'url';
  how: string;
  urlEnv?: string;
  url: string;
  env: Record<string, string>;
  secrets: string[];
  container?: string;
}

/** { url, password } of a postgres connection URL with the password removed, or null when `value` is not one. */
export function parseConnection(value: string): { url: string; password: string } | null {
  try {
    const url = new URL(value);
    if (!/^postgres(?:ql)?:$/u.test(url.protocol)) return null;
    const password = decodeURIComponent(url.password);
    url.password = '';
    return { url: url.toString(), password };
  } catch { return null; }
}

/** The database `name` (an UPPER_CASE environment variable, default DATABASE_URL) names: { how, url, env, secrets }. */
export function dbTarget(ctx: VerbContext, name = DEFAULT_DB_URL_ENV): DbTarget & { kind: 'url'; urlEnv: string } {
  if (!KEY.test(name)) throw refusal('DB_USAGE', '--url-env must name an UPPER_CASE environment variable');
  const value = ctx.env[name];
  if (typeof value !== 'string' || value === '') throw refusal('DB_URL_ENV_MISSING', `${name} is not set`);
  const parsed = parseConnection(value);
  if (!parsed) throw refusal('DB_URL_INVALID', `${name} is not a postgres connection URL`);
  return { kind: 'url', how: `connection string from ${name}`, urlEnv: name, url: parsed.url, env: parsed.password ? { PGPASSWORD: parsed.password } : {}, secrets: [value, parsed.password].filter(Boolean) };
}

/** Where a `-f` file of an in-container target is copied before the client reads it. */
const CONTAINER_DIR = '/tmp/starci-db';
/** The shell an in-container client runs under: the password comes in on stdin into PGPASSWORD, then the tool runs with its arguments. */
const STDIN_PASSWORD = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec "$@"';

/**
 * `target` reached inside the running container `container` (`docker exec` through this invocation's daemon), for a database only the stack's
 * network reaches (the first start of a self-hosted database, `stack deploy --urgent --first-start`): the image's own client tools run there
 * against the URL's database on 127.0.0.1, a `-f` file is copied in first, and the password travels on the exec's stdin, never in argv, a file
 * or an environment of this machine.
 */
export function inContainer(target: DbTarget, container: string): DbTarget & { container: string } {
  const url = new URL(target.url);
  url.hostname = '127.0.0.1';
  return { ...target, how: `${target.how}, inside container ${container.slice(0, 12)}`, url: url.toString(), container };
}

/** Runs `command` of an in-container target: copies each `-f` file in, then execs the tool through the stdin-password shell. */
function containerRun(ctx: VerbContext, target: DbTarget & { container: string }, command: string, args: readonly string[]): SpawnResult {
  const short = target.container.slice(0, 12);
  const step = (what: string, run: SpawnResult): void => {
    if (run.error || run.status !== 0) throw failure('DB_CLI_FAILED', `${what} in container ${short} failed: ${scrub(firstLine(run.stderr), target.secrets)}`);
  };
  step('mkdir', tool(ctx, 'docker', ['exec', target.container, 'mkdir', '-p', CONTAINER_DIR]));
  const inside = args.map((arg, index) => {
    if (args[index - 1] !== '-f') return arg;
    const copied = `${CONTAINER_DIR}/${index}-${path.basename(arg)}`;
    step(`docker cp of ${path.basename(arg)}`, tool(ctx, 'docker', ['cp', arg, `${target.container}:${copied}`]));
    return copied;
  });
  return tool(ctx, 'docker', ['exec', '-i', target.container, 'sh', '-c', STDIN_PASSWORD, 'sh', command, ...inside], { input: `${target.env.PGPASSWORD ?? ''}\n` });
}

/** Runs a PostgreSQL client tool against `target`; a failure names the first stderr line with every secret scrubbed (or withholds it). */
export function pgTool(ctx: VerbContext, target: DbTarget, command: string, args: readonly string[], { withhold = false, code = 'DB_CLI_FAILED' }: { withhold?: boolean; code?: string } = {}): { stdout: string; text: string } {
  const run = target.container ? containerRun(ctx, target as DbTarget & { container: string }, command, args) : tool(ctx, command, args, { cwd: ctx.cwd, env: { ...ctx.env, ...target.env } });
  if (run.error) throw failure('DB_CLI_MISSING', target.container ? `cannot run docker exec ${command} in container ${target.container.slice(0, 12)}` : `cannot run ${command}; install the PostgreSQL client tools (psql, pg_dump)`);
  if (run.status !== 0) throw failure(code, withhold ? `${command} failed; output withheld` : `${command} failed: ${scrub(firstLine(run.stderr), target.secrets)}`);
  return { stdout: run.stdout ?? '', text: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

const PSQL = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];

/** Runs SQL statements (`-c`) and files (`-f`) in ONE transaction: each step is { sql } or { file }. */
export function psqlTransaction(ctx: VerbContext, target: DbTarget, steps: readonly ({ sql: string; file?: undefined } | { file: string; sql?: undefined })[], options: { withhold?: boolean; code?: string } = {}): { stdout: string; text: string } {
  const args = [...PSQL, '-1', '-d', target.url, ...steps.flatMap((step) => (step.file !== undefined ? ['-f', step.file] : ['-c', step.sql as string]))];
  return pgTool(ctx, target, 'psql', args, options);
}

/** The rows of one read-only query as plain objects (json_agg on the server, so no psql formatting is parsed). */
export function queryRows(ctx: VerbContext, target: DbTarget, sql: string, options: { withhold?: boolean; code?: string } = {}): Record<string, any>[] { // reason: rows are JSON that psql printed; each caller reads the columns it selected
  const wrapped = `select coalesce(json_agg(row_to_json(q)), '[]'::json) from (${sql.replace(/;\s*$/u, '')}) q`;
  const { stdout } = pgTool(ctx, target, 'psql', [...PSQL, '-A', '-t', '-d', target.url, '-c', wrapped], options);
  let rows: any; // reason: JSON parsed from psql output, validated as an array of plain objects below
  try { rows = JSON.parse(stdout.trim() || '[]'); } catch { throw failure('DB_QUERY_UNREADABLE', 'the database answered rows psql could not print as JSON; output withheld'); }
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw failure('DB_QUERY_UNREADABLE', 'the database answer is not a rows array');
  return rows;
}

/** A SQL string literal of `value`. */
export const literal = (value: unknown): string => `'${String(value).replaceAll("'", "''")}'`;

/** The versions the history table records; an absent table is an empty history (a database `migrate` has never touched). */
export function historyVersions(ctx: VerbContext, target: DbTarget): Set<string> {
  const [presence] = queryRows(ctx, target, `select pg_catalog.to_regclass(${literal(HISTORY_TABLE)}) is not null as present`);
  if (presence?.present !== true) return new Set();
  return new Set(queryRows(ctx, target, `select version from ${HISTORY_TABLE} order by version`).map((row) => String(row.version)));
}

/** The statement that creates the history table when it is absent (same columns as the image's own: version, statements, name). */
export const HISTORY_DDL = `create schema if not exists supabase_migrations; create table if not exists ${HISTORY_TABLE} (version text primary key, statements text[], name text)`;

/** Records `version` (named `name`) as applied. */
export const markApplied = (version: string, name: string): string => `insert into ${HISTORY_TABLE} (version, name) values (${literal(version)}, ${literal(name)}) on conflict (version) do update set name = excluded.name`;

/** Removes `version` from the history. */
export const markReverted = (version: string): string => `delete from ${HISTORY_TABLE} where version = ${literal(version)}`;
