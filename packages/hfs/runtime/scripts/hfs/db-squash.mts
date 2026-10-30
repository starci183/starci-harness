// app db baseline --squash: the whole active chain becomes ONE baseline read from a database the chain is applied to (--db-url-env), for a
// cutover whose production starts on an empty database. Nothing is rebuilt from migration SQL: the source's schema is dumped with its
// privileges, the objects of the extensions the target image lacks (--drop-extension) and every function or view whose body reaches their
// schemas are left out by name, the role facts a per-database dump loses go to a marked section of db/bootstrap.sql, and the reference rows
// of --seed-tables go to db/seed.sql. The verb proves its own output before it writes anything: a scratch container of the app's db image
// replays bootstrap + baseline + seed (the seed twice) and the same projection read back from the replay must equal the source's, or it
// refuses with the differences. The source is only read; its migration history is never changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DB_DOCKERFILE, DB_IMAGE_CONTEXT } from '../../../db/image.mjs';
import { DbVerbError } from './db-errors.mjs';
import type { DbOperation, DbResult } from './db-baseline-verb.mjs';
import { BOOTSTRAP_FILE, BOOTSTRAP_SQUASH_BEGIN, BOOTSTRAP_SQUASH_END, SEED_FILE, bootstrapSection } from './rules/database-constants.mjs';

/** The result of one docker invocation. */
interface DockerResult { ok: boolean; stdout: string; stderr: string }

/** A throwaway container of the app's db image. */
export interface Scratch { name: string; password: string; image: string; stop: () => DockerResult }

/** Where a target's client tools run. */
interface Client { head: string[]; ref: string }

/** A database the squash reads or replays on: its URL, password and the container that reaches it. */
export interface Target { url: string; password: string; label: string; client: Client }

/** The source connection of `--db-url-env`: the URL without its password and the environment carrying it. */
export interface SquashConnection { url: string; env: NodeJS.ProcessEnv }

/** The runPostgres port of the db verbs. */
export type RunPostgres = (root: string, op: DbOperation) => DbResult;

/** The psql / pg_dump invocation of one operation. */
export type CommandOf = (op: DbOperation, url: string) => [string, string[]];

interface RoleFact { name: string; super: boolean; replication: boolean; login: boolean; inherit: boolean; createdb: boolean; createrole: boolean; bypassrls: boolean; connlimit: number }
interface MemberFact { role: string; member: string }
interface SettingFact { role: string; config: string[] }
interface ExtensionFact { name: string; schema: string; members: string[] }
interface RoutineFact { schema: string; name: string; kind: string; types: string; args: string; text: string }
interface ViewFact { schema: string; name: string; kind: string; text: string }
/** The one read-only catalog query of the source (FACTS_SQL). */
interface Facts { user: string; roles: RoleFact[]; members: MemberFact[]; settings: SettingFact[]; extensions: ExtensionFact[]; schemas: string[]; routines: RoutineFact[]; views: ViewFact[] }
interface QueueFact { name: string; partitioned: boolean; unlogged: boolean }
interface SeedColumn { name: string; identity: string; sequence: boolean }
interface SeedTable { schema: string; table: string; unique: boolean; references: Array<[string, string]>; columns: SeedColumn[] }

/** One object of a plain pg_dump. */
export interface DumpEntry { name: string; type: string; schema: string; body: string }
/** A plain pg_dump as its preamble and entries. */
export interface Dump { preamble: string[]; entries: DumpEntry[] }

interface Owner { schema?: string; schemaLevel?: boolean; extension?: string; global?: boolean; publication?: string; eventTrigger?: string; database?: boolean }
interface Excluded { label: string; schema: string; name: string; keys: string[]; call: boolean }
interface Scope {
  kept: ExtensionFact[]; appSchemas: Set<string>; extensionHomes: Set<string>; droppedSchemas: Set<string>;
  reaches: RegExp | null; excluded: Excluded[]; droppedQueues: Set<string>;
}
interface LostGrant { line: string; schema: string }
interface Report {
  extensions: string[]; objects: Set<string>; eventTriggers: string[]; platformSchemas: Map<string, number>; platformStatements: number;
  ownerGrants: number; lostGrants: LostGrant[] | string[]; droppedQueues: string[]; queues: string[];
}
interface AclItem { entry?: DumpEntry; body?: string; schemaLevel?: boolean | undefined }
interface Seed { counts: Array<[string, number]>; text: string }
/** One database projected to the files a squash writes. */
interface Projection {
  facts: Facts; scope: Scope; dump: Dump; entries: DumpEntry[]; tail: string[]; section: string; seed: Seed | null;
  carried: Set<string>; report: Report; refusals: string[];
}
/** What the squash was asked to carry or drop. */
export interface SquashConfig {
  dropped: string[]; droppedQueues: string[]; seedTables: string[];
  bootstrap: { schemas: Set<string>; roles: Set<string>; publications: Set<string> };
  managedSchema: (name: string) => boolean;
}
/** The options of `starci app db baseline --squash`. */
export interface SquashOpts {
  image?: string | undefined; execute?: boolean | undefined;
  'seed-tables'?: string | undefined; 'drop-extension'?: string | undefined; 'drop-pgmq-queue'?: string | undefined;
}
/** The baseline plan the squash replaces. */
export interface SquashPlan { file: string; last: string; active: Array<{ file: string; name: string; stamp: string }> }

/** The inputs of `squashBaseline`. */
export interface SquashInput {
  root: string; opts: SquashOpts; plan: SquashPlan; urlEnv: string; connection: SquashConnection; commandOf: CommandOf;
  precondition: (runPostgres: RunPostgres) => void; managedSchema: (name: string) => boolean; archive: () => void;
  stdout: (text: string) => unknown;
}

/** The extensions a lite app's db image does not ship, dropped unless --drop-extension names others (pgmq stays: it is the lite event bus). */
export const DEFAULT_DROPPED_EXTENSIONS = Object.freeze(['pg_net', 'pg_cron']);
export const SEED_HEADER = '-- Generated by starci app db baseline --squash';
// Roles of a hosted platform (Supabase) that a self-hosted lite database never has; a grant naming one is platform state, not the app's.
const PLATFORM_ROLE = /^(?:supabase_\w+|authenticator|dashboard_user|pgbouncer)$/;
// Role-level settings carried to the bootstrap; any other setting of a carried role is refused, so no secret travels.
const ROLE_SETTINGS = new Set(['search_path', 'statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout']);
const QUERY_OPTIONS = '-c search_path= -c TimeZone=UTC -c DateStyle=ISO -c IntervalStyle=postgres -c extra_float_digits=3';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const REPLAY_DB = 'starci_squash_replay';
const READY_TIMEOUT_MS = 120_000;
const DIFF_LIMIT = 40;

const ident = (name: unknown): string => `"${String(name).replaceAll('"', '""')}"`;
const literal = (value: unknown): string => `'${String(value).replaceAll("'", "''")}'`;
const unquote = (name: string): string => (/^".*"$/s.test(name) ? name.slice(1, -1).replaceAll('""', '"') : name);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleep = (ms: number): 'ok' | 'not-equal' | 'timed-out' => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sorted = (items: Iterable<string>): string[] => [...items].sort((left, right) => (left < right ? -1 : Number(left > right)));

/** A comma list flag as distinct names, or `fallback` when the flag is absent. */
export const flagList = (value: unknown, fallback: readonly string[]): string[] => (value === undefined ? [...fallback] : [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))]);

/* ---- docker: every client tool runs in a container of the db image, so the host needs Docker and no PostgreSQL client */

function docker(args: string[], { input, env = {}, secrets = [] }: { input?: string | undefined; env?: Record<string, string>; secrets?: string[] } = {}): DockerResult {
  const result = spawnSync('docker', args, { input, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 600_000, windowsHide: true });
  const scrub = (text: unknown): string => secrets.filter(Boolean).reduce((out: string, secret: string) => out.replaceAll(secret, '[value]'), String(text ?? ''));
  return { ok: !result.error && result.status === 0, stdout: String(result.stdout ?? ''), stderr: scrub(result.stderr || result.error?.message) };
}

const firstLines = (text: unknown, count = 4): string => String(text).trim().split('\n').filter(Boolean).slice(0, count).join(' | ');

/** A throwaway container of `image` that can reach the host as host.docker.internal; refused without Docker. */
function startScratch(image: string): Scratch {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) throw new DbVerbError('baseline --squash needs Docker for its scratch replay; start it');
  const password = randomBytes(18).toString('hex');
  const name = `starci-db-squash-${randomBytes(6).toString('hex')}`;
  const scratch: Scratch = { name, password, image, stop: () => docker(['rm', '-f', name]) };
  const started = docker(['run', '-d', '--rm', '--name', name, '--label', 'starci.db-squash=1', '--add-host', 'host.docker.internal:host-gateway', '-e', 'POSTGRES_PASSWORD', image], { env: { POSTGRES_PASSWORD: password } });
  if (!started.ok) { scratch.stop(); throw new DbVerbError(`docker could not start ${image}: ${firstLines(started.stderr, 1)}`); }
  const since = Date.now();
  // TCP, not the socket: the image's init server listens on the socket only, and restarts before it serves TCP.
  while (!docker(['exec', '-e', 'PGPASSWORD', name, 'psql', '-X', '-h', '127.0.0.1', '-U', 'postgres', '-Atqc', 'select 1'], { env: { PGPASSWORD: password } }).ok) {
    if (Date.now() - since > READY_TIMEOUT_MS) { scratch.stop(); throw new DbVerbError(`the scratch database of ${image} did not start`); }
    sleep(500);
  }
  return scratch;
}

/** The app's own db image, built from its managed Dockerfile (DB_DOCKERFILE); its id names it. */
function buildImage(root: string): string {
  if (!docker(['version', '--format', '{{.Server.Version}}']).ok) throw new DbVerbError('baseline --squash needs Docker for its scratch replay; start it');
  const build = docker(['build', '--quiet', '--file', path.join(root, DB_DOCKERFILE), path.join(root, DB_IMAGE_CONTEXT)]);
  const image = /sha256:[a-f0-9]{64}/.exec(build.stdout)?.[0];
  if (!build.ok || !image) throw new DbVerbError(`docker could not build ${DB_DOCKERFILE}: ${firstLines(build.stderr, 2)}`);
  return image;
}

/** Where a target's client tools run: `docker exec` in the scratch container, or a one-shot container of its image on the host's network. */
const inScratch = (scratch: Scratch): Client => ({ head: ['exec', '-i'], ref: scratch.name });
const onHostNetwork = (scratch: Scratch): Client => ({ head: ['run', '--rm', '-i', '--network', 'host', '--label', 'starci.db-squash=1'], ref: scratch.image });

const scratchTarget = (scratch: Scratch, database: string): Target => ({ url: `postgresql://postgres@127.0.0.1:5432/${database}`, password: scratch.password, label: `the scratch ${database}`, client: inScratch(scratch) });

function exec(target: Target, tool: string, args: string[], { input, query = false }: { input?: string | undefined; query?: boolean } = {}): string {
  const env = { PGPASSWORD: target.password, ...(query ? { PGOPTIONS: QUERY_OPTIONS } : {}) };
  const result = docker([...target.client.head, '-e', 'PGPASSWORD', ...(query ? ['-e', 'PGOPTIONS'] : []), target.client.ref, tool, ...args], { input, env, secrets: [target.password, target.url] });
  if (!result.ok) throw new DbVerbError(`${tool} against ${target.label} failed: ${firstLines(result.stderr)}`);
  return result.stdout;
}

const psqlArgs = (target: Target): string[] => ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', target.url];
// reason: the rows psql returns as JSON; each call site names the shape it expects.
const queryJson = <T,>(target: Target, sql: string): T => JSON.parse(exec(target, 'psql', [...psqlArgs(target), '-A', '-t', '-c', sql], { query: true }));

/**
 * The source as a container reaches it. A remote host is reached from the scratch container. A loopback host is the host's own: Docker
 * Desktop reaches it from the scratch container as host.docker.internal, a Linux engine only from a container on the host's network (its
 * bridge gateway never reaches a port bound to 127.0.0.1, as the app's own dev database is). The first route psql connects on is kept;
 * when none does, the verb refuses with each route's failure.
 */
export function sourceTarget(scratch: Scratch, connection: SquashConnection, label: string): Target {
  const password = connection.env.PGPASSWORD ?? '';
  const url = new URL(connection.url);
  if (!LOCAL_HOSTS.has(url.hostname)) return { url: url.toString(), password, label, client: inScratch(scratch) };
  const gateway = new URL(connection.url);
  gateway.hostname = 'host.docker.internal';
  const routes: Target[] = [{ url: gateway.toString(), password, label, client: inScratch(scratch) }, { url: url.toString(), password, label, client: onHostNetwork(scratch) }];
  const failures: string[] = [];
  for (const route of routes) {
    try { exec(route, 'psql', [...psqlArgs(route), '-At', '-c', 'select 1']); return route; } catch (error) { failures.push((error as Error).message); }
  }
  throw new DbVerbError(`no container of ${scratch.image} reaches ${label}:\n${failures.map((line) => `  ${line}`).join('\n')}`);
}

/** The runPostgres port of db-baseline-verb.mjs, served by the target's container: the history precondition needs no host psql. */
export function targetRunner(target: Target, commandOf: CommandOf): RunPostgres {
  return (_root, op) => {
    const [tool, args] = commandOf(op, target.url);
    return { status: 0, stdout: exec(target, tool, args) };
  };
}

/* ---- the source facts: one read-only catalog query */

const notMember = (classid: string, column: string): string => `not exists (select 1 from pg_catalog.pg_depend d where d.classid = '${classid}'::pg_catalog.regclass and d.objid = ${column} and d.deptype = 'e')`;
const userSchema = (column: string): string => `${column} !~ '^pg_' and ${column} <> 'information_schema'`;
const FACTS_SQL = `select pg_catalog.json_build_object(
  'user', current_user,
  'roles', (select coalesce(json_agg(json_build_object('name', r.rolname, 'super', r.rolsuper, 'replication', r.rolreplication, 'login', r.rolcanlogin,
    'inherit', r.rolinherit, 'createdb', r.rolcreatedb, 'createrole', r.rolcreaterole, 'bypassrls', r.rolbypassrls, 'connlimit', r.rolconnlimit) order by r.rolname), '[]')
    from pg_catalog.pg_roles r where r.rolname !~ '^pg_'),
  'members', (select coalesce(json_agg(json_build_object('role', r.rolname, 'member', m.rolname) order by r.rolname, m.rolname), '[]')
    from pg_catalog.pg_auth_members a join pg_catalog.pg_roles r on r.oid = a.roleid join pg_catalog.pg_roles m on m.oid = a.member),
  'settings', (select coalesce(json_agg(json_build_object('role', r.rolname, 'config', s.setconfig) order by r.rolname, s.setdatabase), '[]')
    from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid = s.setrole
    where s.setdatabase in (0, (select d.oid from pg_catalog.pg_database d where d.datname = current_database()))),
  'extensions', (select coalesce(json_agg(json_build_object('name', e.extname, 'schema', n.nspname, 'members', (select coalesce(json_agg(m.nspname order by m.nspname), '[]')
    from pg_catalog.pg_depend d join pg_catalog.pg_namespace m on m.oid = d.objid
    where d.classid = 'pg_catalog.pg_namespace'::pg_catalog.regclass and d.refobjid = e.oid and d.deptype = 'e')) order by e.extname), '[]')
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace),
  'schemas', (select coalesce(json_agg(n.nspname order by n.nspname), '[]') from pg_catalog.pg_namespace n where ${userSchema('n.nspname')}),
  'routines', (select coalesce(json_agg(json_build_object('schema', n.nspname, 'name', p.proname, 'kind', p.prokind, 'types', pg_catalog.oidvectortypes(p.proargtypes),
    'args', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'text', concat_ws(' ', p.prosrc, pg_catalog.pg_get_function_arguments(p.oid), pg_catalog.pg_get_function_result(p.oid))) order by n.nspname, p.proname, p.oid), '[]')
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where ${userSchema('n.nspname')} and ${notMember('pg_catalog.pg_proc', 'p.oid')}),
  'views', (select coalesce(json_agg(json_build_object('schema', n.nspname, 'name', c.relname, 'kind', c.relkind, 'text', pg_catalog.pg_get_viewdef(c.oid)) order by n.nspname, c.relname), '[]')
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and ${userSchema('n.nspname')} and ${notMember('pg_catalog.pg_class', 'c.oid')}))`;

const QUEUES_SQL = `select coalesce(json_agg(json_build_object('name', m.queue_name, 'partitioned', m.is_partitioned, 'unlogged', m.is_unlogged) order by m.queue_name), '[]') from pgmq.meta m`;

/** Whether a queue name matches one --drop-pgmq-queue entry: a name, or a pattern where `*` matches any run of characters. */
export const queueDropped = (name: string, patterns: string[]): boolean => patterns.some((pattern) => new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`).test(name));

/* ---- the dump as entries */

const ENTRY = /^-- (?:Data for )?Name: (.*); Type: (.*); Schema: (.*); Owner: (.*)$/;
const LOOSE_SET = /^SET default_(?:tablespace|table_access_method) = .*;$/;

/** A plain pg_dump as { preamble, entries: [{ name, type, schema, body }] }; psql's \restrict guard and the version comments are dropped. */
export function dumpEntries(text: unknown): Dump {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter((line) => !/^\\(?:un)?restrict\b/.test(line));
  const starts = lines.flatMap((line, index) => (ENTRY.test(line) && lines[index - 1] === '--' && lines[index + 1] === '--' ? [index] : []));
  const preamble = lines.slice(0, starts.length ? (starts[0] as number) - 1 : lines.length).filter((line) => /^(?:SET|SELECT) /.test(line));
  const entries = starts.map((start, index) => {
    const [, name, type, schema] = ENTRY.exec(lines[start] as string) as unknown as [string, string, string, string];
    const end = index + 1 < starts.length ? (starts[index + 1] as number) - 1 : lines.length;
    const body = lines.slice(start + 2, end).filter((line) => {
      if (!LOOSE_SET.test(line)) return true;
      if (!preamble.includes(line)) preamble.push(line);
      return false;
    }).join('\n').replace(/\n--\n-- PostgreSQL database dump complete\n--\s*$/, '').trim();
    return { name, type, schema, body };
  });
  return { preamble, entries };
}

const entryKey = (entry: DumpEntry): string => `${entry.type}|${entry.schema}|${entry.name}`;
const renderEntry = (entry: DumpEntry): string => `--\n-- Name: ${entry.name}; Type: ${entry.type}; Schema: ${entry.schema}; Owner: -\n--\n\n${entry.body}\n\n\n`;

const ROLE_NAMES = /\b(?:TO|FROM|FOR ROLE|SESSION AUTHORIZATION)\s+((?:"(?:[^"]|"")+"|[\w$]+)(?:\s*,\s*(?:"(?:[^"]|"")+"|[\w$]+))*)/gi;
/** The roles a statement grants to, revokes from, acts for or switches to. */
const rolesOf = (text: unknown): string[] => [...String(text).matchAll(ROLE_NAMES)].flatMap((match) => (match[1] as string).split(/\s*,\s*/).map(unquote));

/* ---- the projection: what a squash of one database writes */

/** The names a bootstrap's own SQL creates: its schemas, roles and publications. */
export function bootstrapDeclares(head: string): SquashConfig['bootstrap'] {
  const created = (kind: string): Set<string> => new Set([...head.matchAll(new RegExp(`create\\s+${kind}\\s+(?:if\\s+not\\s+exists\\s+)?("(?:[^"]|"")+"|[\\w$]+)`, 'gi'))].map((match) => unquote(match[1] as string)));
  return { schemas: created('schema'), roles: created('role'), publications: created('publication') };
}

function ownerOf(entry: DumpEntry): Owner {
  if (entry.schema !== '-') return { schema: entry.schema };
  const target = /^(SCHEMA|EXTENSION) (.+)$/.exec(entry.name);
  if (entry.type === 'SCHEMA') return { schema: unquote(entry.name) };
  if (entry.type === 'EXTENSION') return { extension: unquote(entry.name) };
  if (['ACL', 'COMMENT'].includes(entry.type) && target) return target[1] === 'SCHEMA' ? { schema: unquote(target[2] as string), schemaLevel: true } : { extension: unquote(target[2] as string) };
  if (entry.type === 'DEFAULT ACL') return { global: true };
  if (entry.type === 'PUBLICATION') return { publication: unquote(entry.name) };
  if (entry.type === 'EVENT TRIGGER') return { eventTrigger: unquote(/EXECUTE FUNCTION\s+("(?:[^"]|"")+"|[\w$]+)\./i.exec(entry.body)?.[1] ?? '') };
  return { database: true };
}

function routineKeys(routine: RoutineFact): string[] {
  const kind = ({ p: 'PROCEDURE', a: 'AGGREGATE' } as Record<string, string>)[routine.kind] ?? 'FUNCTION';
  const signature = `${routine.name}(${routine.args})`;
  return [`${kind}|${routine.schema}|${routine.name}(${routine.types})`, `ACL|${routine.schema}|${kind} ${signature}`, `COMMENT|${routine.schema}|${kind} ${signature}`];
}

function viewKeys(view: ViewFact): string[] {
  const kind = view.kind === 'm' ? 'MATERIALIZED VIEW' : 'VIEW';
  return [`${kind}|${view.schema}|${view.name}`, `ACL|${view.schema}|TABLE ${view.name}`, `COMMENT|${view.schema}|${kind} ${view.name}`, `MATERIALIZED VIEW DATA|${view.schema}|${view.name}`];
}

/** Which schemas are the app's, which belong to a dropped extension, and which objects reach the dropped ones. */
function squashScope(facts: Facts, config: SquashConfig): Scope {
  const kept = facts.extensions.filter((extension) => !config.dropped.includes(extension.name));
  const keptHomes = new Set(kept.map((extension) => extension.schema));
  const droppedSchemas = new Set<string>();
  for (const extension of facts.extensions.filter((item) => config.dropped.includes(item.name))) {
    for (const member of extension.members) droppedSchemas.add(member);
    if (!['public', 'pg_catalog'].includes(extension.schema) && !keptHomes.has(extension.schema) && !config.bootstrap.schemas.has(extension.schema)) droppedSchemas.add(extension.schema);
  }
  const appSchemas = new Set(facts.schemas.filter((schema) => !config.managedSchema(schema) && !droppedSchemas.has(schema) && !config.bootstrap.schemas.has(schema) && !keptHomes.has(schema)));
  // A kept extension's own schema (pgmq) is created by the baseline before its extension; grants on it follow in the baseline's tail.
  const extensionHomes = new Set([...keptHomes].filter((schema) => !['public', 'pg_catalog'].includes(schema) && !config.bootstrap.schemas.has(schema)));
  const reaches = droppedSchemas.size ? new RegExp(`(?<![\\w$."])"?(?:${sorted(droppedSchemas).map(escape).join('|')})"?\\s*\\.`, 'i') : null;
  const excluded = [
    ...facts.routines.filter((item) => appSchemas.has(item.schema) && reaches?.test(item.text)).map((item) => ({ label: `${item.schema}.${item.name}(${item.args})`, schema: item.schema, name: item.name, keys: routineKeys(item), call: true })),
    ...facts.views.filter((item) => appSchemas.has(item.schema) && reaches?.test(item.text)).map((item) => ({ label: `${item.schema}.${item.name}`, schema: item.schema, name: item.name, keys: viewKeys(item), call: false })),
  ];
  return { kept, appSchemas, extensionHomes, droppedSchemas, reaches, excluded, droppedQueues: new Set<string>() };
}

/** Kept entries naming a dropped schema or an excluded object: each pair is a refusal line. */
function danglingReferences(entries: DumpEntry[], scope: Scope): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const where = `${entry.type} ${entry.schema === '-' ? '' : `${entry.schema}.`}${entry.name}`;
    const schema = scope.reaches?.exec(entry.body);
    if (schema) lines.push(`${where} references the dropped schema ${schema[0].replace(/[\s.]+$/, '')}`);
    for (const object of scope.excluded) {
      const qualified = new RegExp(`(?<![\\w$])"?${escape(object.schema)}"?\\."?${escape(object.name)}"?(?![\\w$])`, 'i');
      const bare = object.call && /^(?:FUNCTION|PROCEDURE|VIEW|MATERIALIZED VIEW|TRIGGER|POLICY)$/.test(entry.type) ? new RegExp(`(?<![\\w$."])${escape(object.name)}\\s*\\(`, 'i') : null;
      if (qualified.test(entry.body) || bare?.test(entry.body)) lines.push(`${where} references the excluded ${object.label}`);
    }
    for (const match of entry.body.matchAll(/\bpgmq\s*\.\s*\w+\s*\(\s*'((?:[^']|'')+)'/gi)) {
      const queue = (match[1] as string).replaceAll("''", "'");
      if (scope.droppedQueues.has(queue)) lines.push(`${where} uses the dropped pgmq queue ${queue}`);
    }
  }
  return lines;
}

function roleSql(role: RoleFact, existing: boolean): [string, string | null] {
  const attributes = [role.login ? 'login' : 'nologin', role.inherit ? 'inherit' : 'noinherit', role.createdb ? 'createdb' : 'nocreatedb',
    role.createrole ? 'createrole' : 'nocreaterole', role.bypassrls ? 'bypassrls' : 'nobypassrls', `connection limit ${role.connlimit}`].join(' ');
  return [`    if not exists (select 1 from pg_catalog.pg_roles where rolname = ${literal(role.name)}) then create role ${ident(role.name)}; end if;`,
    existing ? null : `alter role ${ident(role.name)} with ${attributes};`];
}

function settingSql(role: string, entry: string, refusals: string[]): string | null {
  const at = entry.indexOf('=');
  const [key, value] = [entry.slice(0, at), entry.slice(at + 1)];
  if (!ROLE_SETTINGS.has(key)) { refusals.push(`role ${role} carries the setting ${key}, which a squash does not carry (allowed: ${sorted(ROLE_SETTINGS).join(', ')})`); return null; }
  if (key !== 'search_path') return `alter role ${ident(role)} set ${key} = ${literal(value)};`;
  if (!/^[\w$", ]+$/.test(value)) { refusals.push(`role ${role} has a search_path the squash cannot restate: ${value}`); return null; }
  return `alter role ${ident(role)} set search_path = ${value};`;
}

/** The bootstrap section: carried roles, their memberships and settings, schema-level grants on bootstrap schemas, database-wide default privileges. */
function sectionText({ facts, carried, bootstrapRoles, schemaGrants, defaultGrants, refusals }: { facts: Facts; carried: Set<string>; bootstrapRoles: Set<string>; schemaGrants: string[]; defaultGrants: string[]; refusals: string[] }): string {
  const roles = facts.roles.filter((role) => carried.has(role.name));
  const create = roles.map((role) => roleSql(role, false));
  const known = new Set([...carried, ...bootstrapRoles]);
  const members = facts.members.filter((item) => known.has(item.role) && known.has(item.member)).map((item) => `grant ${ident(item.role)} to ${ident(item.member)};`);
  const settings = facts.settings.filter((item) => known.has(item.role)).flatMap((item) => item.config.map((entry) => settingSql(item.role, entry, refusals))).filter(Boolean);
  const body = [
    '-- The source\'s app roles (passwords are set out of band), their memberships and role-level settings, the grants on schemas this bootstrap',
    '-- creates, and the database-wide default privileges: a per-database dump keeps none of them.',
    ...(create.length ? ['do $starci_squash$', 'begin', ...create.map(([line]) => line), 'end', '$starci_squash$;', ...create.map(([, line]) => line)] : []),
    ...members, ...settings, ...schemaGrants, ...defaultGrants,
  ];
  return `${BOOTSTRAP_SQUASH_BEGIN}\n${body.join('\n')}\n${BOOTSTRAP_SQUASH_END}\n`;
}

/** Partition one dump: baseline entries, statements for the bootstrap section and the baseline tail, and what was left out and why. */
function partition(dump: Dump, scope: Scope, config: SquashConfig): { kept: DumpEntry[]; bootstrapAcl: AclItem[]; extensionAcl: AclItem[]; globalAcl: AclItem[]; report: Report } {
  const excludedKeys = new Map(scope.excluded.flatMap((object) => object.keys.map((key): [string, Excluded] => [key, object])));
  const report: Report = { extensions: [], objects: new Set<string>(), eventTriggers: [], platformSchemas: new Map<string, number>(), platformStatements: 0, ownerGrants: 0, lostGrants: [] as LostGrant[], droppedQueues: [], queues: [] };
  const kept: DumpEntry[] = [];
  const bootstrapAcl: AclItem[] = [];
  const extensionAcl: AclItem[] = [];
  const globalAcl: AclItem[] = [];
  for (const entry of dump.entries) {
    const owner = ownerOf(entry);
    if (owner.extension !== undefined) {
      if (config.dropped.includes(owner.extension) || owner.extension === 'plpgsql') { if (entry.type === 'EXTENSION') report.extensions.push(owner.extension); }
      else kept.push(entry);
    } else if (owner.global) globalAcl.push(entry);
    else if (owner.publication !== undefined) {
      // An empty publication (Supabase's supabase_realtime) is platform state: lite realtime is LISTEN/NOTIFY plus Redis.
      const publishes = /\bFOR\s+(?:ALL\s+)?TABLES?\b/i.test(entry.body) || dump.entries.some((other) => other.type.startsWith('PUBLICATION TABLE') && other.name.startsWith(`${entry.name} `));
      if (publishes && !config.bootstrap.publications.has(owner.publication)) kept.push(entry);
      else if (!publishes) report.objects.add(`publication ${owner.publication} (publishes no table)`);
    }
    else if (owner.eventTrigger !== undefined) { if (scope.appSchemas.has(owner.eventTrigger)) kept.push(entry); else report.eventTriggers.push(unquote(entry.name)); }
    else if (owner.database || scope.appSchemas.has(owner.schema as string)) {
      const object = excludedKeys.get(entryKey(entry));
      if (object) report.objects.add(`${object.label} (reaches ${sorted(scope.droppedSchemas).join(', ')})`);
      else kept.push(entry);
    } else if (scope.extensionHomes.has(owner.schema as string)) {
      if (entry.type === 'SCHEMA') kept.push(entry);
      else if (entry.type === 'ACL') extensionAcl.push({ entry, schemaLevel: false });
    } else if (config.bootstrap.schemas.has(owner.schema as string) && entry.type === 'ACL') bootstrapAcl.push({ entry, schemaLevel: owner.schemaLevel === true });
    else {
      report.platformSchemas.set(owner.schema as string, (report.platformSchemas.get(owner.schema as string) ?? 0) + 1);
      // reason: lostGrants holds { line, schema } here and is narrowed to lines in project().
      if (entry.type === 'ACL') (report.lostGrants as LostGrant[]).push(...entry.body.split('\n').filter((line) => /^(?:GRANT|REVOKE)\b/.test(line)).map((line) => ({ line, schema: owner.schema as string })));
    }
  }
  return { kept, bootstrapAcl, extensionAcl, globalAcl, report };
}

/** One database projected to the files a squash writes; the same function reads the source and the replay. */
function project(target: Target, config: SquashConfig): Projection {
  const facts = queryJson<Facts>(target, FACTS_SQL);
  const scope = squashScope(facts, config);
  const queues = facts.extensions.some((extension) => extension.name === 'pgmq') && !config.dropped.includes('pgmq') ? queryJson<QueueFact[]>(target, QUEUES_SQL) : [];
  scope.droppedQueues = new Set(queues.filter((queue) => queueDropped(queue.name, config.droppedQueues)).map((queue) => queue.name));
  const keptQueues = queues.filter((queue) => !scope.droppedQueues.has(queue.name));
  const dump = dumpEntries(exec(target, 'pg_dump', ['--schema-only', '--no-owner', '-d', target.url]));
  const parts = partition(dump, scope, config);
  const refusals = danglingReferences(parts.kept, scope);
  const roleNames = new Set(facts.roles.map((role) => role.name));
  const platform = new Set(facts.roles.filter((role) => (role.super && role.name !== facts.user) || PLATFORM_ROLE.test(role.name)).map((role) => role.name));
  const base = new Set([...config.bootstrap.roles, facts.user, 'postgres', 'public', 'PUBLIC']);
  const statementLines = (body: string): string[] => body.split('\n');
  const naming = (line: string): string[] => rolesOf(line).filter((role) => roleNames.has(role) && !base.has(role) && !platform.has(role));
  // A statement naming a platform role is the platform's own state and is left out; the rest stays as dumped.
  const keepLine = (line: string): boolean => { const platformRole = rolesOf(line).some((role) => platform.has(role)); if (platformRole) parts.report.platformStatements += 1; return !platformRole; };
  // Every replayed object is owned by the migrating role, so a grant to it, spelled out on a source object a platform role owns, is implied.
  const owners = new Set([facts.user, 'postgres']);
  const ownerGrant = (entry: DumpEntry, line: string): boolean => entry.type === 'ACL' && /^GRANT\b/.test(line) && rolesOf(line).every((role) => owners.has(role));
  const entries = parts.kept.flatMap((entry): DumpEntry[] => {
    if (!['ACL', 'DEFAULT ACL'].includes(entry.type)) return [entry];
    const body = statementLines(entry.body).filter((line) => {
      if (!keepLine(line)) return false;
      if (!ownerGrant(entry, line)) return true;
      parts.report.ownerGrants += 1;
      return false;
    }).join('\n').trim();
    return body ? [{ ...entry, body }] : [];
  });
  const carried = new Set(entries.flatMap((entry) => naming(entry.body)));
  const aclLines = (items: AclItem[]) => items.flatMap((item) => statementLines((item.entry?.body ?? item.body) as string).filter((line) => /^(?:GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/.test(line) && keepLine(line)).map((line) => ({ line, schemaLevel: item.schemaLevel })));
  const queueTable = new RegExp(`\\bpgmq\\.[aq]_(?:${[...scope.droppedQueues].map(escape).join('|') || '(?!)'})\\b`);
  const outside = [...aclLines(parts.bootstrapAcl), ...aclLines(parts.extensionAcl)].filter((item) => naming(item.line).length && !queueTable.test(item.line));
  for (const item of outside) for (const role of naming(item.line)) carried.add(role);
  const defaultGrants = aclLines(parts.globalAcl).map((item) => item.line);
  for (const line of defaultGrants) for (const role of naming(line)) carried.add(role);
  parts.report.lostGrants = (parts.report.lostGrants as LostGrant[]).filter((lost) => naming(lost.line).length).map((lost) => lost.line);
  for (const role of facts.roles.filter((item) => carried.has(item.name) && (item.super || item.replication))) refusals.push(`role ${role.name} is a superuser or replication role; a squash carries no such role`);
  const section = sectionText({ facts, carried, bootstrapRoles: config.bootstrap.roles, schemaGrants: outside.filter((item) => item.schemaLevel).map((item) => item.line), defaultGrants, refusals });
  for (const queue of keptQueues.filter((item) => item.partitioned)) refusals.push(`pgmq queue ${queue.name} is partitioned; a squash recreates plain and unlogged queues only`);
  const creates = keptQueues.filter((queue) => !queue.partitioned).map((queue) => `SELECT pgmq.${queue.unlogged ? 'create_unlogged' : 'create'}(${literal(queue.name)});`);
  const tail = [...creates, ...outside.filter((item) => !item.schemaLevel).map((item) => item.line)];
  parts.report.droppedQueues = sorted(scope.droppedQueues);
  parts.report.queues = keptQueues.map((queue) => queue.name);
  const seed = config.seedTables.length ? seedText(target, config.seedTables, scope, refusals) : null;
  return { facts, scope, dump, entries, tail, section, seed, carried, report: parts.report, refusals };
}

/* ---- the seed */

function seedFactsSql(tables: Array<[string, string]>): string {
  const pairs = tables.map(([schema, table]) => `(${literal(schema)}, ${literal(table)})`).join(', ');
  return `select coalesce(json_agg(json_build_object('schema', n.nspname, 'table', c.relname,
    'unique', exists (select 1 from pg_catalog.pg_index i where i.indrelid = c.oid and i.indisunique and i.indpred is null),
    'references', (select coalesce(jsonb_agg(distinct jsonb_build_array(rn.nspname, rc.relname)), '[]') from pg_catalog.pg_constraint f
      join pg_catalog.pg_class rc on rc.oid = f.confrelid join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace where f.conrelid = c.oid and f.contype = 'f' and f.confrelid <> c.oid),
    'columns', (select json_agg(json_build_object('name', a.attname, 'identity', a.attidentity, 'sequence', pg_catalog.pg_get_serial_sequence(pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname), a.attname) is not null)
      order by a.attnum) from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '')) order by n.nspname, c.relname), '[]')
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and (n.nspname, c.relname) in (${pairs})`;
}

/** Seed tables in foreign-key order (a referenced table first), ties by name; a cycle among them is refused. */
function seedOrder(tables: SeedTable[], refusals: string[]): SeedTable[] {
  const name = (table: SeedTable): string => `${table.schema}.${table.table}`;
  const pending = new Map(tables.map((table) => [name(table), table]));
  const order: SeedTable[] = [];
  while (pending.size) {
    const ready = sorted([...pending.keys()].filter((key) => (pending.get(key) as SeedTable).references.every(([schema, table]) => !pending.has(`${schema}.${table}`) || `${schema}.${table}` === key)));
    if (!ready.length) { refusals.push(`seed tables reference each other in a cycle: ${sorted(pending.keys()).join(', ')}`); return order; }
    for (const key of ready) { order.push(pending.get(key) as SeedTable); pending.delete(key); }
  }
  return order;
}

function seedText(target: Target, requested: string[], scope: Scope, refusals: string[]): Seed {
  const pairs = requested.map((name): [string, string] => (name.includes('.') ? name.split('.') as [string, string] : ['public', name]));
  const facts = queryJson<SeedTable[]>(target, seedFactsSql(pairs));
  const found = new Set(facts.map((table) => `${table.schema}.${table.table}`));
  for (const [schema, table] of pairs) {
    if (!found.has(`${schema}.${table}`)) refusals.push(`seed table ${schema}.${table} does not exist in the source`);
    else if (!scope.appSchemas.has(schema)) refusals.push(`seed table ${schema}.${table} is outside the app schemas (${sorted(scope.appSchemas).join(', ')})`);
  }
  for (const table of facts.filter((item) => !item.unique)) refusals.push(`seed table ${table.schema}.${table.table} has no primary key or unique constraint, so its rows cannot be seeded idempotently`);
  const blocks = seedOrder(facts, refusals).map((table) => {
    const qualified = `${ident(table.schema)}.${ident(table.table)}`;
    const columns = table.columns.map((column) => ident(column.name)).join(', ');
    const overriding = table.columns.some((column) => column.identity === 'a') ? 'overriding system value ' : '';
    const values = `pg_catalog.concat_ws(', ', ${table.columns.map((column) => `pg_catalog.quote_nullable(${ident(column.name)})`).join(', ')})`;
    const rows = queryJson<string[]>(target, `select coalesce(json_agg(line order by line collate "C"), '[]') from (select 'insert into ${qualified.replaceAll("'", "''")} (${columns.replaceAll("'", "''")}) ${overriding}values (' || ${values} || ') on conflict do nothing;' as line from ${qualified}) q`);
    const sequences = table.columns.filter((column) => column.sequence).map((column) => `select pg_catalog.setval(pg_catalog.pg_get_serial_sequence(${literal(qualified)}, ${literal(column.name)}), coalesce(max(${ident(column.name)}), 0) + 1, false) from ${qualified};`);
    return { name: `${table.schema}.${table.table}`, count: rows.length, sql: [`-- ${table.schema}.${table.table}: ${rows.length} row(s)`, ...rows, ...sequences].join('\n') };
  });
  return { counts: blocks.map((block): [string, number] => [block.name, block.count]), text: `${SEED_HEADER} from the reference rows of ${blocks.map((block) => block.name).join(', ')}; rerun the verb to regenerate.\n${blocks.map((block) => `${block.sql}\n`).join('\n')}` };
}

/* ---- rendering, proof and writing */

function baselineText(projection: Projection, last: string, urlEnv: string): string {
  const header = [`-- starci:baseline ${last}`,
    `-- Generated by starci app db baseline --squash from the database ${urlEnv} names: the schema of ${sorted(projection.scope.appSchemas).join(', ')} with its privileges,`,
    `-- without the extensions ${sorted(projection.report.extensions).join(', ') || '(none)'} and the objects that reach them. Roles and database-wide grants live in ${BOOTSTRAP_FILE}.`];
  const tail = projection.tail.length ? [renderEntry({ name: 'pgmq queues and grants on objects outside the app schemas', type: 'ACL', schema: '-', body: projection.tail.join('\n') })] : [];
  return `${header.join('\n')}\n\n${projection.dump.preamble.join('\n')}\n\n${[...projection.entries.map(renderEntry), ...tail].join('')}`;
}

/** The differences between the source's projection and the replay's, as `-`/`+` lines; none means the replay is the source minus the drops. */
function projectionDiff(source: Projection, replay: Projection): string[] {
  const lines: string[] = [];
  const keyed = (projection: Projection): Map<string, string> => new Map(projection.entries.map((entry): [string, string] => [entryKey(entry), entry.body]));
  const [want, have] = [keyed(source), keyed(replay)];
  for (const [key, body] of want) {
    if (!have.has(key)) lines.push(`- baseline ${key}`);
    else if (have.get(key) !== body) lines.push(`~ baseline ${key}: ${firstDifference(body, have.get(key) as string)}`);
  }
  for (const key of have.keys()) if (!want.has(key)) lines.push(`+ baseline ${key}`);
  const compare = (label: string, left: string | undefined, right: string | undefined): void => { if (left !== right) lines.push(`~ ${label}: ${firstDifference(left ?? '', right ?? '')}`); };
  compare('baseline tail grants', source.tail.join('\n'), replay.tail.join('\n'));
  compare(BOOTSTRAP_FILE, source.section, replay.section);
  compare(SEED_FILE, source.seed?.text, replay.seed?.text);
  return lines;
}

function firstDifference(left: string, right: string): string {
  const [want, have] = [left.split('\n'), right.split('\n')];
  const index = want.findIndex((line, at) => line !== have[at]);
  const at = index < 0 ? want.length : index;
  return `line ${at + 1} source ${JSON.stringify(want[at] ?? '(end)')}, replay ${JSON.stringify(have[at] ?? '(end)')}`;
}

function replay(scratch: Scratch, files: Array<[string, string]>): Target {
  const admin = scratchTarget(scratch, 'postgres');
  exec(admin, 'psql', [...psqlArgs(admin), '-c', `create database ${REPLAY_DB}`]);
  const target = scratchTarget(scratch, REPLAY_DB);
  for (const [label, text] of files) {
    try { exec(target, 'psql', [...psqlArgs(target), '-1', '-f', '-'], { input: text }); }
    catch (error) { throw new DbVerbError(`the replay of ${label} failed on ${scratch.image}: ${(error as Error).message}`); }
  }
  return target;
}

function printReport(stdout: (text: string) => unknown, projection: Projection, config: SquashConfig, files: Array<[string, string]>): void {
  const { report } = projection;
  stdout(`app schemas: ${sorted(projection.scope.appSchemas).join(', ')}\n`);
  stdout(`dropped extensions: ${config.dropped.map((name: string) => (report.extensions.includes(name) ? name : `${name} (not installed)`)).join(', ')}\n`);
  for (const label of sorted(report.objects)) stdout(`excluded ${label}\n`);
  if (report.queues.length) stdout(`pgmq queues kept: ${report.queues.join(', ')}\n`);
  for (const name of report.droppedQueues) stdout(`dropped pgmq queue ${name}\n`);
  for (const name of sorted(report.eventTriggers)) stdout(`excluded event trigger ${name} (its function is outside the app schemas)\n`);
  for (const [schema, count] of sorted(report.platformSchemas.keys()).map((key) => [key, report.platformSchemas.get(key)])) stdout(`left out ${count} entr${count === 1 ? 'y' : 'ies'} of schema ${schema} (not the app's)\n`);
  if (report.platformStatements) stdout(`left out ${report.platformStatements} grant statement(s) naming platform roles\n`);
  if (report.ownerGrants) stdout(`left out ${report.ownerGrants} grant statement(s) to the migrating role, which owns every replayed object\n`);
  for (const line of report.lostGrants as string[]) stdout(`left out a grant to a carried role on a schema the target lacks: ${line}\n`);
  stdout(`bootstrap section: roles ${sorted(projection.carried).join(', ') || '(none)'}; ${projection.section.split('\n').length - 2} line(s)\n`);
  for (const [name, count] of projection.seed?.counts ?? []) stdout(`seed ${name}: ${count} row(s)\n`);
  for (const [file, text] of files) stdout(`${file}: ${text.split('\n').length} line(s)\n`);
}

/**
 * `starci app db baseline --squash`: plan is db-baseline-verb.mjs's baselinePlan, connection the source of --db-url-env, precondition the
 * history check (the source holds exactly the active chain) run through the given runPostgres port, throwing its refusal, and archive
 * the move of the active chain. Dry run by default; `execute` writes the baseline, the bootstrap section and the seed, then archives.
 */
export function squashBaseline({ root, opts, plan, urlEnv, connection, commandOf, precondition, managedSchema, archive, stdout }: SquashInput): number {
  if (!opts.image && !fs.existsSync(path.join(root, DB_DOCKERFILE))) throw new DbVerbError(`baseline --squash replays on the app's db image: ${DB_DOCKERFILE} is missing (run "npx starci app sync --write") and no --image names one`);
  const bootstrapPath = path.join(root, BOOTSTRAP_FILE);
  if (!fs.existsSync(bootstrapPath)) throw new DbVerbError(`baseline --squash needs ${BOOTSTRAP_FILE}; run "npx starci app sync --execute" first`);
  const head = bootstrapSection(fs.readFileSync(bootstrapPath, 'utf8').replace(/\r\n/g, '\n')).head;
  const seedPath = path.join(root, SEED_FILE);
  const seedTables = flagList(opts['seed-tables'], []);
  if (seedTables.length && fs.existsSync(seedPath) && !fs.readFileSync(seedPath, 'utf8').startsWith(SEED_HEADER)) throw new DbVerbError(`${SEED_FILE} exists and was not generated by the squash; fold its rows into the source and remove it, or omit --seed-tables`);
  const config: SquashConfig = { dropped: flagList(opts['drop-extension'], DEFAULT_DROPPED_EXTENSIONS), droppedQueues: flagList(opts['drop-pgmq-queue'], []), seedTables, bootstrap: bootstrapDeclares(head), managedSchema };
  const image = opts.image ?? buildImage(root);
  const scratch = startScratch(image);
  try {
    const source = sourceTarget(scratch, connection, `the database ${urlEnv} names`);
    precondition(targetRunner(source, commandOf));
    const projected = project(source, config);
    if (projected.refusals.length) throw new DbVerbError(`baseline --squash cannot carry the source:\n${[...new Set(projected.refusals)].map((line) => `  ${line}`).join('\n')}`);
    const files: Array<[string, string]> = [[BOOTSTRAP_FILE, `${head}${projected.section}`], [plan.file, baselineText(projected, plan.last, urlEnv)], ...(projected.seed ? [[SEED_FILE, projected.seed.text] as [string, string]] : [])];
    const replayTarget = replay(scratch, [...files, ...(projected.seed ? [[`${SEED_FILE} (second run)`, projected.seed.text] as [string, string]] : [])]);
    const replayed = project(replayTarget, config);
    const diff = projectionDiff(projected, replayed);
    stdout(`${opts.execute ? 'apply' : 'preview'} squash baseline ${plan.file}; archive ${plan.active.length} migrations; the source is read only\n`);
    printReport(stdout, projected, config, files);
    if (diff.length) throw new DbVerbError(`the replay on ${image} differs from the source minus the dropped extensions:\n${diff.slice(0, DIFF_LIMIT).map((line) => `  ${line}`).join('\n')}${diff.length > DIFF_LIMIT ? `\n  ... ${diff.length - DIFF_LIMIT} more` : ''}`);
    stdout(`proof: bootstrap + baseline + seed (twice) replayed on ${image}; schema, grants, roles and seed rows equal the source minus ${config.dropped.join(', ')}\n`);
    if (!opts.execute) return 0;
    for (const [file, text] of files) fs.writeFileSync(path.join(root, file), text, { flag: file === plan.file ? 'wx' : 'w' });
    archive();
    return 0;
  } finally { scratch.stop(); }
}
