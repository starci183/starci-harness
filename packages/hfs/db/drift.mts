// drift.mjs - `starci app db drift`: the TypeORM entities of an app against the schema its SQL migrations build.
// The migrations (db/migrations/*.sql, after db/bootstrap.sql when present) are the only DDL and `synchronize` is false, so an entity only
// maps tables that already exist and can drift from them. The verb builds TypeORM's metadata from the app's entity list
// (be/src/modules/platform/database/entities.ts, compiled in-process with the app's own typescript and loaded with the app's own typeorm) through a
// DataSource that never connects, applies the migrations to a scratch database (a throwaway container of the image the app's managed
// .starcistacks/images/db/Dockerfile builds, or the empty database named by --db-url-env), reads that schema from
// information_schema.columns and pg_catalog, and reports every entity column whose table or column is missing, whose type differs (both
// normalised to PostgreSQL's format_type names) or whose nullability differs, under BE_ENTITY_SCHEMA_DRIFT. Database columns no entity maps
// are fine. Exit 0 is green, 1 is drift (or a migration that does not apply to an empty database), 2 is a refusal: no verdict, which is
// also what a host without Docker gets ("needs a database"), never a green.
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { runVerb } from '../release/index.mjs';
import type { FlagSpec, SpawnResult, VerbContext, VerbIo, VerbResult } from '../release/index.mjs';
import { failure, refusal } from '../stack/errors.mjs';
import { firstLine, tool } from '../stack/context.mjs';
import { ENTITY_LIST, hasEntityList } from './entity-list.mjs';
import { DB_DOCKERFILE, DB_IMAGE_CONTEXT } from './image.mjs';
import { BOOTSTRAP_FILE } from '../runtime/scripts/hfs/rules/database-constants.mjs';

export { BOOTSTRAP_FILE };

export const DRIFT_CODE = 'BE_ENTITY_SCHEMA_DRIFT';
export const MIGRATIONS_DIR = 'db/migrations';
const NEEDS_DATABASE = 'DB_DRIFT_NEEDS_DATABASE';
const KEY = /^[A-Z][A-Z0-9_]*$/u;
const MIGRATION = /^\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u;
const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 500;

// reason: typescript, typeorm and pg are the app's own, loaded by createRequire from its be/ install; their surfaces are not this package's dependencies
type AppModule = any;

/** One entity column as the comparison reads it. */
export interface EntityColumn { entity: string; schema: string; table: string; column: string; type: string; enumName: string | null; nullable: boolean; view: boolean }
/** One column of the migrated schema, as SCHEMA_SQL answers it. */
export interface SchemaColumn { schema: string; table: string; column: string; type: string; enumName: string | null; nullable: boolean; view: boolean }
/** One drift finding. */
export interface DriftFinding { code: string; level: 'error'; kind: string; entity: string; schema: string; table: string; column: string; message: string; expected?: unknown; actual?: unknown }
/** A connection of the scratch database, with how to stop it. */
interface Scratch { connection: Record<string, unknown>; stop: () => void; how: string }

const needsDatabase = (reason: string): Error => refusal(NEEDS_DATABASE, `needs a database: ${reason}`);

/* ---- the entity side */

/** The be/tsconfig.json `paths` as [prefix, absolute target prefix] pairs (only `name/*` -> `dir/*` forms, the canon's). */
function aliases(ts: AppModule, root: string): [string, string][] {
  const file = path.join(root, 'be', 'tsconfig.json');
  if (!fs.existsSync(file)) return [];
  const { config } = ts.readConfigFile(file, ts.sys.readFile);
  const options = config?.compilerOptions ?? {};
  const base = path.resolve(path.dirname(file), options.baseUrl ?? '.');
  return (Object.entries(options.paths ?? {}) as [string, string[] | undefined][]).flatMap(([pattern, targets]): [string, string][] => (pattern.endsWith('/*') && targets?.[0]?.endsWith('/*')
    ? [[pattern.slice(0, -1), path.resolve(base, targets[0].slice(0, -1))]] : []));
}

/** The source file a relative or aliased specifier names (exact, .ts, .js -> .ts, /index.ts), or null for a package. */
function sourceFile(specifier: string, from: string, pairs: readonly [string, string][]): string | null {
  const alias = pairs.find(([prefix]) => specifier.startsWith(prefix));
  const target: string | null = alias ? path.join(alias[1], specifier.slice(alias[0].length))
    : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null;
  if (!target) return null;
  const candidates = [target, `${target}.ts`, target.replace(/\.js$/u, '.ts'), path.join(target, 'index.ts')];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

/** The slice of Node's CommonJS loader internals the `.ts` hook touches: the extension table and a module's `_compile`. */
interface CjsLoader {
  _extensions: Record<string, ((module: { _compile(code: string, filename: string): void }, filename: string) => void) | undefined>;
}

/**
 * Requires the entity list with a `.ts` loader that transpiles each source file with the app's typescript (CommonJS, legacy decorators and
 * their design metadata, as Nest compiles them) and points every relative or aliased require at its source file. The previous loader is
 * restored afterwards.
 */
function requireEntityList(ts: AppModule, appRequire: NodeJS.Require, root: string): unknown {
  const pairs = aliases(ts, root);
  // reason: Module._extensions and Module#_compile are Node internals the loader hook needs; they are not in @types/node, so the table is
  // read by name and its shape stated by the declaration.
  const extensions: CjsLoader['_extensions'] = Reflect.get(Module, '_extensions');
  const previous = extensions['.ts'];
  extensions['.ts'] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true,
      esModuleInterop: true, useDefineForClassFields: false } });
    const code = outputText.replace(/require\("([^"]+)"\)/gu, (call: string, specifier: string) => {
      const file = sourceFile(specifier, filename, pairs);
      return file ? `require(${JSON.stringify(file)})` : call;
    });
    module._compile(code, filename);
  };
  try { return appRequire(path.join(root, ENTITY_LIST)); }
  finally {
    if (previous) extensions['.ts'] = previous;
    else delete extensions['.ts'];
  }
}

/** The entity classes an entity-list module exports: every class, directly or inside an exported array, once. */
const entityClasses = (exports: unknown): Function[] => [...new Set((Object.values((exports ?? {}) as object) as unknown[]).flat(Infinity).filter((value): value is Function => typeof value === 'function'))];

/** PostgreSQL spellings TypeORM's normalizeType passes through unchanged, mapped to the name format_type answers. */
const PG_ALIASES = new Map([['serial', 'integer'], ['serial4', 'integer'], ['bigserial', 'bigint'], ['serial8', 'bigint'], ['smallserial', 'smallint'],
  ['serial2', 'smallint'], ['bool', 'boolean'], ['int', 'integer'], ['float', 'double precision'], ['dec', 'numeric']]);

/** One entity column as the comparison reads it: { entity, schema, table, column, type, enumName, nullable, view }. */
function entityColumn(driver: AppModule, metadata: AppModule, column: AppModule): EntityColumn {
  const base = String(driver.normalizeType(column)).toLowerCase();
  const type = `${PG_ALIASES.get(base) ?? base}${column.isArray ? '[]' : ''}`;
  return { entity: metadata.name, schema: metadata.schema ?? driver.options.schema ?? 'public', table: metadata.tableName, column: column.databaseName,
    type, enumName: column.enumName ?? null, nullable: column.isNullable === true, view: metadata.tableType === 'view' };
}

/**
 * The columns of every entity the app's entity list names, from TypeORM's own metadata: a postgres DataSource with synchronize false is
 * built and its metadata derived (buildMetadatas), never initialized, so no connection is opened. typeorm, its pg driver and typescript are
 * the app's (resolved from be/); an app without them gets no verdict.
 */
export async function loadEntityColumns(appRoot: string): Promise<EntityColumn[]> {
  const root = path.resolve(appRoot);
  const appRequire = createRequire(path.join(root, 'be', 'package.json'));
  const load = (name: string): AppModule => {
    try { return appRequire(name); } catch { throw needsDatabase(`the app's ${name} is not installed (npm ci first)`); }
  };
  const ts = load('typescript');
  load('reflect-metadata');
  const { DataSource } = load('typeorm');
  load('pg');
  const entities = entityClasses(requireEntityList(ts, appRequire, root));
  if (entities.length === 0) return [];
  const source = new DataSource({ type: 'postgres', synchronize: false, migrationsRun: false, entities });
  try { await source.buildMetadatas(); } catch (error) { throw refusal('DB_DRIFT_ENTITIES_INVALID', `TypeORM refuses the entity list: ${firstLine((error as Error).message)}`); }
  return source.entityMetadatas.flatMap((metadata: AppModule) => metadata.columns.filter((column: AppModule) => !column.isVirtual && !column.isVirtualProperty)
    .map((column: AppModule) => entityColumn(source.driver, metadata, column)));
}

/* ---- the schema side */

/** Every column of the scratch schema with its format_type spelling (enums as `enum`, domains as their base type) and nullability. */
export const SCHEMA_SQL = `select c.table_schema as "schema", c.table_name as "table", c.column_name as "column", c.is_nullable = 'YES' as "nullable",
  case when t.typtype = 'e' then 'enum' when e.typtype = 'e' then 'enum[]' when t.typtype = 'd' then pg_catalog.format_type(t.typbasetype, null)
    else pg_catalog.format_type(a.atttypid, null) end as "type",
  case when t.typtype = 'e' then t.typname when e.typtype = 'e' then e.typname end as "enumName",
  cl.relkind in ('v', 'm') as "view"
from information_schema.columns c
join pg_catalog.pg_namespace n on n.nspname = c.table_schema
join pg_catalog.pg_class cl on cl.relnamespace = n.oid and cl.relname = c.table_name
join pg_catalog.pg_attribute a on a.attrelid = cl.oid and a.attname = c.column_name and a.attnum > 0 and not a.attisdropped
join pg_catalog.pg_type t on t.oid = a.atttypid
left join pg_catalog.pg_type e on e.oid = t.typelem and t.typcategory = 'A'
where c.table_schema not in ('pg_catalog', 'information_schema')`;

const PUBLIC_RELATIONS_SQL = `select count(*)::int as "count" from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')`;

/** The SQL files the scratch database receives, in order: db/bootstrap.sql when present, then the active migrations by stamp. */
export function migrationFiles(root: string): string[] {
  const dir = path.join(root, MIGRATIONS_DIR);
  if (!fs.existsSync(dir)) throw refusal('DB_DRIFT_NO_MIGRATIONS', `${MIGRATIONS_DIR}/ is missing: the migrations are the schema the entities are checked against`);
  const migrations = fs.readdirSync(dir).filter((name) => MIGRATION.test(name)).sort().map((name) => `${MIGRATIONS_DIR}/${name}`);
  return [...(fs.existsSync(path.join(root, BOOTSTRAP_FILE)) ? [BOOTSTRAP_FILE] : []), ...migrations];
}

/**
 * Builds the app's db image from its managed Dockerfile (DB_DOCKERFILE) and starts a throwaway container of it on a loopback port;
 * returns { connection, stop }. Docker missing or failing is no verdict; an app without that Dockerfile is refused (sync writes it).
 */
function startScratch(ctx: VerbContext, root: string): Scratch {
  if (!fs.existsSync(path.join(root, DB_DOCKERFILE))) throw refusal('DB_DRIFT_NO_IMAGE', `${DB_DOCKERFILE} is missing: run "npx starci app sync --execute" (the scratch database runs the app's own db image) or pass --db-url-env`);
  const docker = (args: string[], env?: Record<string, string>): SpawnResult => tool(ctx, 'docker', args, { env: { ...ctx.env, ...env } });
  const probe = docker(['version', '--format', '{{.Server.Version}}']);
  if (probe.error || probe.status !== 0) throw needsDatabase('Docker is not available on this host; start it, or pass --db-url-env naming an empty database');
  const build = docker(['build', '--quiet', '--file', path.join(root, DB_DOCKERFILE), path.join(root, DB_IMAGE_CONTEXT)]);
  const image = /sha256:[a-f0-9]{64}/u.exec(String(build.stdout ?? ''))?.[0];
  if (build.status !== 0 || !image) throw needsDatabase(`docker could not build ${DB_DOCKERFILE}: ${firstLine(build.stderr)}`);
  const password = randomBytes(18).toString('hex');
  const name = `starci-db-drift-${randomBytes(6).toString('hex')}`;
  const run = docker(['run', '-d', '--rm', '--name', name, '--label', 'starci.db-drift=1', '-e', 'POSTGRES_PASSWORD', '-p', '127.0.0.1::5432', image], { POSTGRES_PASSWORD: password });
  const stop = () => { docker(['rm', '-f', name]); };
  if (run.status !== 0) { stop(); throw needsDatabase(`docker could not start the image of ${DB_DOCKERFILE}: ${firstLine(run.stderr)}`); }
  const port = docker(['port', name, '5432/tcp']);
  const match = /:(\d+)\s*$/mu.exec(String(port.stdout ?? '').split('\n')[0] as string);
  if (port.status !== 0 || !match) { stop(); throw needsDatabase('docker published no port for the scratch database'); }
  return { connection: { host: '127.0.0.1', port: Number(match[1]), user: 'postgres', password, database: 'postgres' }, stop, how: `scratch container of the image ${DB_DOCKERFILE} builds` };
}

/** Connects with the app's pg, retrying while a fresh container is still initialising; gives up after READY_TIMEOUT_MS. */
async function connect(ctx: VerbContext, Client: new (connection: Record<string, unknown>) => AppModule, connection: Record<string, unknown>, retry: boolean): Promise<AppModule> {
  const started = ctx.now();
  for (;;) {
    const client = new Client(connection);
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('select 1');
      return client;
    } catch (error) {
      await client.end().catch(() => {});
      if (!retry || ctx.now() - started > READY_TIMEOUT_MS) throw needsDatabase(`the database did not accept a connection (${firstLine((error as Error).message)})`);
      await ctx.sleep(READY_POLL_MS);
    }
  }
}

/**
 * The columns of the migrated schema: a scratch database (a container of the app's db image, or the empty database `urlEnv` names) receives
 * db/bootstrap.sql and every active migration, each file in one transaction, then is read with SCHEMA_SQL. A file that does not apply to an
 * empty database is a red result of its own (DB_DRIFT_MIGRATION_FAILED). The container is removed in every case.
 */
export async function migratedSchema(ctx: VerbContext, appRoot: string, { urlEnv }: { urlEnv?: string | undefined } = {}): Promise<{ columns: SchemaColumn[]; files: string[]; how: string }> {
  const root = path.resolve(appRoot);
  const files = migrationFiles(root);
  let Client: new (connection: Record<string, unknown>) => AppModule;
  try { ({ Client } = createRequire(path.join(root, 'be', 'package.json'))('pg')); } catch { throw needsDatabase('the app\'s pg is not installed (npm ci first)'); }
  let scratch: Scratch;
  let secrets: string[] = [];
  if (urlEnv !== undefined) {
    if (!KEY.test(urlEnv)) throw refusal('DB_USAGE', '--db-url-env must name an UPPER_CASE environment variable');
    const value = ctx.env[urlEnv];
    if (typeof value !== 'string' || !/^postgres(?:ql)?:\/\//u.test(value)) throw needsDatabase(`${urlEnv} holds no postgres connection URL`);
    secrets = [value];
    scratch = { connection: { connectionString: value }, stop: () => {}, how: `the database ${urlEnv} names` };
  } else scratch = startScratch(ctx, root);
  const scrub = (text: unknown): string => secrets.reduce((out, secret) => out.replaceAll(secret, '[value]'), String(text));
  let client: AppModule;
  try {
    client = await connect(ctx, Client, scratch.connection, urlEnv === undefined);
    if (urlEnv !== undefined) {
      const { rows: [{ count }] } = await client.query(PUBLIC_RELATIONS_SQL);
      if (count > 0) throw refusal('DB_DRIFT_TARGET_NOT_EMPTY', `the database ${urlEnv} names already holds ${count} relation(s) in public; drift migrates an empty scratch database itself`);
    }
    for (const file of files) {
      try { await client.query(fs.readFileSync(path.join(root, file), 'utf8')); }
      catch (error) { throw failure('DB_DRIFT_MIGRATION_FAILED', `${file} does not apply to an empty database: ${scrub(firstLine((error as Error).message))}`); }
    }
    const { rows } = await client.query(SCHEMA_SQL);
    return { columns: rows.map((row: SchemaColumn) => ({ ...row, type: String(row.type).toLowerCase() })), files, how: scratch.how };
  } finally {
    await client?.end().catch(() => {});
    scratch.stop();
  }
}

/* ---- the comparison */

const key = (...parts: string[]): string => parts.join('\u0000');

/**
 * The drift findings of `entityColumns` against `schemaColumns` ({schema, table, column, type, enumName, nullable, view} each): a missing
 * table once per entity, then per column a missing column, a type mismatch (an enum matches an enum, by name when the entity names one) and,
 * outside views, a nullability mismatch. Schema columns no entity maps are not findings.
 */
export function compareSchema(entityColumns: readonly EntityColumn[], schemaColumns: readonly SchemaColumn[]): DriftFinding[] {
  const tables = new Set(schemaColumns.map((column) => key(column.schema, column.table)));
  const columns = new Map(schemaColumns.map((column) => [key(column.schema, column.table, column.column), column]));
  const findings: DriftFinding[] = [];
  const missingTables = new Set<string>();
  const found = (column: EntityColumn, kind: string, message: string, extra: Record<string, unknown> = {}): void => { findings.push({ code: DRIFT_CODE, level: 'error', kind, entity: column.entity,
    schema: column.schema, table: column.table, column: column.column, message: `${column.entity} ${column.schema}.${column.table}${kind === 'missing-table' ? '' : `.${column.column}`}: ${message}`, ...extra }); };
  for (const column of entityColumns) {
    const table = key(column.schema, column.table);
    if (!tables.has(table)) {
      if (!missingTables.has(table)) found(column, 'missing-table', 'the table is missing from the migrated schema');
      missingTables.add(table);
      continue;
    }
    const actual = columns.get(key(column.schema, column.table, column.column));
    if (!actual) { found(column, 'missing-column', 'the column is missing from the migrated schema'); continue; }
    const sameEnum = column.type === actual.type && actual.type.startsWith('enum') && (!column.enumName || column.enumName === actual.enumName);
    const typeMatches = actual.type.startsWith('enum') ? sameEnum : column.type === actual.type;
    if (!typeMatches) {
      const name = (type: string, enumName: string | null): string => (type.startsWith('enum') && enumName ? `${type} ${enumName}` : type);
      found(column, 'type-mismatch', `type mismatch: entity ${name(column.type, column.enumName)}, schema ${name(actual.type, actual.enumName)}`,
        { expected: column.type, actual: actual.type });
    }
    if (!actual.view && !column.view && column.nullable !== actual.nullable) {
      found(column, 'nullable-mismatch', `nullability mismatch: entity ${column.nullable ? 'nullable' : 'not null'}, schema ${actual.nullable ? 'nullable' : 'not null'}`,
        { expected: column.nullable, actual: actual.nullable });
    }
  }
  return findings;
}

/**
 * `starci app db drift`. options: { urlEnv, entityColumns(root), schema(ctx, root, { urlEnv }) }, the last two seams for specs. An app with
 * no entity list is green with nothing to compare.
 */
export async function driftCheck(ctx: VerbContext, options: {
  urlEnv?: string | undefined; entityColumns?: (root: string) => Promise<EntityColumn[]> | EntityColumn[];
  schema?: (ctx: VerbContext, root: string, flags: { urlEnv?: string | undefined }) => Promise<{ columns: SchemaColumn[]; files?: string[]; how?: string }>;
} = {}): Promise<VerbResult> {
  const root = path.resolve(ctx.cwd);
  if (!hasEntityList(root)) return { ok: true, lines: [`no entity list (${ENTITY_LIST}): nothing to compare`], data: { entities: 0, columns: 0, findings: [] } };
  const entityColumns = await (options.entityColumns ?? loadEntityColumns)(root);
  const schema = await (options.schema ?? migratedSchema)(ctx, root, { urlEnv: options.urlEnv });
  const findings = compareSchema(entityColumns, schema.columns);
  const entities = new Set(entityColumns.map((column) => column.entity)).size;
  const head = `${entities} entit${entities === 1 ? 'y' : 'ies'}, ${entityColumns.length} column(s) against ${schema.files?.length ?? 0} SQL file(s) applied to ${schema.how ?? 'the schema'}`;
  const lines = [head, ...findings.map((finding) => `${DRIFT_CODE} ${finding.message}`),
    findings.length === 0 ? 'green: every entity column matches the migrated schema' : `red: ${findings.length} drift finding(s)`];
  return { ok: findings.length === 0, lines, data: { entities, columns: entityColumns.length, files: schema.files ?? [], findings } };
}

/** Entry of the verb: `starci app db drift [--db-url-env NAME] [--json] [--cwd <dir>]`. */
/** The flags of `starci app db drift`; the parser refuses every other. */
export const SPEC: FlagSpec = { boolean: ['--json'], value: ['--db-url-env'] };

export function dbDriftMain(argv: string[], io: VerbIo = {}): Promise<number> {
  return runVerb({ label: 'starci app db drift', name: 'db drift', code: 'DB_USAGE', io, argv,
    spec: SPEC,
    run: (ctx, flags, positional) => {
      if (positional.length) throw refusal('DB_USAGE', 'drift takes flags only');
      return driftCheck(ctx, { urlEnv: flags['db-url-env'] as string | undefined });
    } });
}
