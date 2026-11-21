// stack-local-config.mts - reads and judges `environments.<env>.local`, the declaration of a dev environment (runtime docker-compose) that
// `starci app stack up|down|doctor|prepare|status|logs|verify --env <env>` runs (PROJECT-STACKS-6). It holds names, ports, argv lists and
// shapes only, never a value: custody keys are references into .starcistacks/<env>/secrets (PROJECT-STACKS-5). The authority for the fields is
// this module; the same normaliser serves `starci app check` (rule R340) and the verbs, so a block the check passes is a block the verbs run.
import path from 'node:path';
import { isPlainObject as plain } from '../../engine/plain-object.mjs';
import { closedFields, collector, patternField } from './stack-config-kit.mjs';
import type { Collector, StackProblem } from './stack-config-kit.mjs';

export const LOCAL_CONFIG_CODE = 'STACKS_LOCAL_CONFIG';

const NAME = /^[a-z][a-z0-9-]{0,40}$/u;
const KEY = /^[A-Z][A-Z0-9_]{0,63}$/u;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,40}$/u;
const SQL_NAME = /^[a-z][a-z0-9_]{0,62}$/u;
/** The generators `starci app secret init --env <env>` knows (PROJECT-STACKS-5: dev-only values, created once, never replaced). */
export const GENERATORS = Object.freeze(['hex', 'base64', 'password', 'uuid', 'rsa-pem', 'ec-pem', 'ed25519-pem']);

/** A key of a sealed member of the environment. */
export interface CustodyRef { member: string; key: string }
/** A command the verbs run: an argv list (never a shell line), run from `cwd` (app-root relative). */
export interface LocalCommand {
  name: string; argv: string[]; cwd: string; heavy: 'install' | 'build' | 'none'; skipIfExists: string | null; env: Record<string, string>; files: string[];
  /** Seed only: `migrate` runs it once the database is migrated, `ready` once the processes answer (a seed that signs up through the api). */
  after: 'migrate' | 'ready';
  /** Seed only: `once` (default) runs it once per volume set; `always` runs it on every up (a migration runner idempotent by its own ledger, such as TypeORM's). */
  mode?: 'once' | 'always' | undefined;
}
/** A compose service the environment starts and how its readiness is observed. */
export interface LocalService {
  name: string; wait: 'healthy' | 'started' | 'tcp'; port: string | null;
  /** `object-store`: an S3 API (MinIO) whose links reach browsers and providers (PROJECT-STACKS-15, R428); `port` is its S3 port, never its admin console. */
  kind?: 'object-store';
  /** An object store only: the declared port of its admin console, which no tunnel route may reach. */
  console?: string;
}
/** The route name and port name of the gallery in `local.tunnel.routes[]`: its port is derived (base + `ruleParams.gallery.portOffset`), not declared in `local.ports` (PROJECT-GALLERY-1 item 4). */
export const GALLERY_ROUTE = 'gallery';
/** One public hostname of the environment's dev tunnel and the loopback port it routes to. */
export interface LocalTunnelRoute { name: string; host: string; port: string }
/** The locally managed named tunnel of the environment and the hostnames it publishes (PROJECT-STACKS-15); `stack up --execute` routes them. */
export interface LocalTunnel { name: string; routes: LocalTunnelRoute[] }
/**
 * The built mode of a native process (`processes[].serve`): `build` once (the governor's build class) and then `argv`, the built artifact
 * served (next start, node dist/...), each from its own `cwd` (default: the process's). A process that declares it runs this way on `stack up`
 * and `stack restart`; its own `argv` (next dev, ts-node-dev, a watcher) runs only with `--watch`, the explicit opt-in for live coding.
 */
export interface LocalServe { argv: string[]; cwd: string | null; build: { argv: string[]; cwd: string | null } | null }
/** A native app process. */
export interface LocalProcess extends LocalCommand { port: string | null; health: HttpProbe | null; serve: LocalServe | null }
/** One HTTP probe: the readiness of a process, a `ready` row or a `verify` row. */
export interface HttpProbe { name: string; url: string; method: string; status: number; contains: string | null }
/** The per-environment database: its compose service, its own login role and where the app reads its URL. */
export interface LocalDatabase {
  service: string; port: string; name: string; role: string; urlEnv: string; urlAs: 'env' | 'file'; adminUser: string;
  password: CustodyRef; adminPassword: CustodyRef; appRole: string | null; appPassword: CustodyRef | null;
}
/** One more database of the environment: the database of one hfs.json connection, in the compose service the `database` block names. */
export interface LocalConnectionDatabase extends LocalDatabase {
  /** The hfs.json connection this database serves (its URL reaches only the runs that list `urlEnv` in `files`). */
  connection: string;
}
/** One dev-only value the owner-armed `secret init` creates once. */
export interface CustodyGenerator extends CustodyRef { kind: string; bytes: number; publicKey: string | null }

/** The normalised `local` block of one environment. */
export interface LocalBlock {
  project: string;
  /** The project base port (`local.basePort`): the native process ports follow its role table (stack-base-port.mts); null when the app declares none. */
  basePort: number | null;
  ports: Record<string, number>;
  services: LocalService[];
  database: LocalDatabase | null;
  /** The databases of the other connections (`local.databases`), provisioned beside `database` on its service. */
  databases: LocalConnectionDatabase[];
  composeEnv: Array<CustodyRef & { name: string }>;
  /** Least grants: the keys one compose service may read, mounted from `STACK_GRANT_<NAME>` (a directory holding only those keys). */
  grants: Array<{ name: string; keys: string[] }>;
  /** Data directories under the state base (`${data}/<name>`, `STACK_DATA_DIR`), created by `up` before anything starts: bind mounts and file stores of native processes. */
  dirs: string[];
  custody: CustodyGenerator[];
  setup: LocalCommand[];
  seed: LocalCommand[];
  processes: LocalProcess[];
  ready: HttpProbe[];
  verify: HttpProbe[];
  origins: Array<{ name: string; url: string }>;
  /** The dev tunnel (`local.tunnel`); absent when the environment publishes nothing. */
  tunnel?: LocalTunnel;
  resources: { diskGb: number; ramMb: number };
  /**
   * `local.dbUpgrade` (PROJECT-STACKS-19), exactly one of: `from`, the old docker volume `stack db-upgrade` restores into the database volume the compose file
   * declares (then empty); or `hold`, the volume that keeps the old major's data directory, byte for byte, when the declared volume is upgraded in place.
   * Absent unless declared.
   */
  dbUpgrade?: { from: string } | { hold: string };
}

const TOP = ['project', 'basePort', 'ports', 'services', 'database', 'databases', 'composeEnv', 'grants', 'dirs', 'custody', 'setup', 'seed', 'processes', 'ready', 'verify', 'origins', 'tunnel', 'resources', 'dbUpgrade'];
const COMMAND = ['name', 'argv', 'cwd', 'heavy', 'skipIfExists', 'env', 'files'];
const SEED = [...COMMAND, 'after', 'mode'];
const PROCESS = [...COMMAND, 'port', 'health', 'serve'];

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** A relative path inside the app root: no drive, no `..`, forward slashes. */
function relative(c: Collector, at: string, value: unknown): string {
  if (typeof value !== 'string' || value === '' || path.posix.isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.includes('\\') || path.posix.normalize(value).split('/').includes('..')) {
    c.problem(at, 'must be a relative path inside the app root');
    return '.';
  }
  return value;
}

function ref(c: Collector, at: string, value: unknown): CustodyRef {
  if (!closedFields(c, at, value, ['member', 'key'], 'local')) return { member: '', key: '' };
  const entry = value as Record<string, unknown>;
  patternField(c, `${at}.member`, entry.member, /^[a-z0-9][a-z0-9-]*$/u);
  patternField(c, `${at}.key`, entry.key, KEY);
  return { member: String(entry.member), key: String(entry.key) };
}

function strings(c: Collector, at: string, value: unknown, pattern: RegExp | null = null): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !text(item))) { c.problem(at, 'must be a list of non-empty strings'); return []; }
  if (pattern) value.forEach((item, index) => patternField(c, `${at}[${index}]`, item, pattern));
  return value as string[];
}

function command(c: Collector, at: string, value: unknown, allowed: readonly string[], names: Set<string>): LocalCommand {
  const empty: LocalCommand = { name: '', argv: [], cwd: '.', heavy: 'none', skipIfExists: null, env: {}, files: [], after: 'migrate' };
  if (!closedFields(c, at, value, allowed, 'local')) return empty;
  const entry = value as Record<string, unknown>;
  const name = String(entry.name ?? '');
  if (patternField(c, `${at}.name`, entry.name, NAME)) {
    if (names.has(name)) c.problem(`${at}.name`, `${name} is declared twice`);
    names.add(name);
  }
  const argv = strings(c, `${at}.argv`, entry.argv);
  if (argv.length === 0) c.problem(`${at}.argv`, 'must hold the command and its arguments (an argv list, never a shell line)');
  const heavy = entry.heavy ?? 'none';
  if (!['install', 'build', 'none'].includes(String(heavy))) c.problem(`${at}.heavy`, 'must be install, build or none (the heavy-command governor class of the command)');
  let env: Record<string, string> = {};
  if (entry.env !== undefined) {
    if (!plain(entry.env)) c.problem(`${at}.env`, 'must be a mapping of non-secret values');
    else {
      env = entry.env as Record<string, string>;
      for (const [key, item] of Object.entries(env)) {
        patternField(c, `${at}.env.${key}`, key, KEY);
        if (typeof item !== 'string') c.problem(`${at}.env.${key}`, 'must be a string');
      }
    }
  }
  return {
    name, argv, cwd: entry.cwd === undefined ? '.' : relative(c, `${at}.cwd`, entry.cwd), heavy: heavy as LocalCommand['heavy'],
    skipIfExists: entry.skipIfExists === undefined ? null : relative(c, `${at}.skipIfExists`, entry.skipIfExists), env,
    files: strings(c, `${at}.files`, entry.files, KEY), after: afterOf(c, at, entry.after),
    ...(entry.mode === undefined ? {} : { mode: modeOf(c, at, entry.mode) }),
  };
}

function modeOf(c: Collector, at: string, value: unknown): 'once' | 'always' {
  if (value !== 'once' && value !== 'always') c.problem(`${at}.mode`, 'must be once or always (always: a migration runner that runs on every up, idempotent by its own ledger)');
  return value === 'always' ? 'always' : 'once';
}

function serveOf(c: Collector, at: string, value: unknown): LocalServe | null {
  if (value === undefined) return null;
  if (!closedFields(c, at, value, ['argv', 'cwd', 'build'], 'local')) return null;
  const entry = value as Record<string, unknown>;
  const argv = strings(c, `${at}.argv`, entry.argv);
  if (argv.length === 0) c.problem(`${at}.argv`, 'must hold the command that serves the built artifact (next start, node dist/...), an argv list');
  let build: LocalServe['build'] = null;
  if (entry.build !== undefined && closedFields(c, `${at}.build`, entry.build, ['argv', 'cwd'], 'local')) {
    const item = entry.build as Record<string, unknown>;
    const buildArgv = strings(c, `${at}.build.argv`, item.argv);
    if (buildArgv.length === 0) c.problem(`${at}.build.argv`, 'must hold the build command (next build, the api build), an argv list');
    build = { argv: buildArgv, cwd: item.cwd === undefined ? null : relative(c, `${at}.build.cwd`, item.cwd) };
  }
  return { argv, cwd: entry.cwd === undefined ? null : relative(c, `${at}.cwd`, entry.cwd), build };
}

function afterOf(c: Collector, at: string, value: unknown): 'migrate' | 'ready' {
  if (value === undefined) return 'migrate';
  if (value !== 'migrate' && value !== 'ready') c.problem(`${at}.after`, 'must be migrate or ready');
  return value === 'ready' ? 'ready' : 'migrate';
}

function probe(c: Collector, at: string, value: unknown): HttpProbe {
  const empty: HttpProbe = { name: '', url: '', method: 'GET', status: 200, contains: null };
  if (!closedFields(c, at, value, ['name', 'url', 'method', 'status', 'contains'], 'local')) return empty;
  const entry = value as Record<string, unknown>;
  patternField(c, `${at}.name`, entry.name, NAME);
  const url = String(entry.url ?? '');
  if (!/^http:\/\/(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\$\{port\.[a-z][a-z0-9-]*\}|:[0-9]+)?(\/.*)?$/u.test(url)) c.problem(`${at}.url`, 'must be an http URL on the loopback (localhost, 127.0.0.1 or *.localhost), its port a literal or ${port.<name>}');
  const method = String(entry.method ?? 'GET');
  if (!['GET', 'HEAD', 'POST'].includes(method)) c.problem(`${at}.method`, 'must be GET, HEAD or POST');
  const status = entry.status === undefined ? 200 : entry.status;
  if (!Number.isInteger(status) || (status as number) < 100 || (status as number) > 599) c.problem(`${at}.status`, 'must be an HTTP status');
  return { name: String(entry.name ?? ''), url, method, status: status as number, contains: text(entry.contains) ? entry.contains : null };
}

function portsOf(c: Collector, value: unknown): Record<string, number> {
  const ports: Record<string, number> = {};
  if (!plain(value) || Object.keys(value as object).length === 0) { c.problem('ports', 'must name at least one port: the host ports the environment publishes or listens on'); return ports; }
  const seen = new Map<number, string>();
  for (const [name, port] of Object.entries(value as Record<string, unknown>)) {
    patternField(c, `ports.${name}`, name, NAME);
    if (!Number.isInteger(port) || (port as number) < 1024 || (port as number) > 65535) { c.problem(`ports.${name}`, 'must be a port from 1024 to 65535'); continue; }
    if (seen.has(port as number)) c.problem(`ports.${name}`, `is the port of ${seen.get(port as number)} too`);
    seen.set(port as number, name);
    ports[name] = port as number;
  }
  return ports;
}

/** The base port: a whole port with base .. base + 99 inside 1024 .. 65535 (the range a project owns, stack-base-port.mts). */
function basePortOf(c: Collector, value: unknown): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 1024 || (value as number) + 99 > 65535) { c.problem('basePort', 'must be a whole port from 1024 to 65436: the project owns basePort .. basePort + 99'); return null; }
  return value as number;
}

function servicesOf(c: Collector, value: unknown, ports: Record<string, number>): LocalService[] {
  if (!Array.isArray(value) || value.length === 0) { c.problem('services', 'must list the compose services `up` starts, dependencies first'); return []; }
  return value.map((item, index): LocalService => {
    const at = `services[${index}]`;
    if (!closedFields(c, at, item, ['name', 'wait', 'port', 'kind', 'console'], 'local')) return { name: '', wait: 'started', port: null };
    const entry = item as Record<string, unknown>;
    patternField(c, `${at}.name`, entry.name, NAME);
    const wait = String(entry.wait ?? 'healthy');
    if (!['healthy', 'started', 'tcp'].includes(wait)) c.problem(`${at}.wait`, 'must be healthy (the compose healthcheck), tcp (the port accepts) or started');
    const port = entry.port === undefined ? null : String(entry.port);
    if (wait === 'tcp' && (port === null || !Object.hasOwn(ports, port))) c.problem(`${at}.port`, 'must name a declared port when wait is tcp');
    if (port !== null && !Object.hasOwn(ports, port)) c.problem(`${at}.port`, `${port} is not a declared port`);
    const service: LocalService = { name: String(entry.name ?? ''), wait: wait as LocalService['wait'], port };
    if (entry.kind !== undefined) {
      if (entry.kind !== 'object-store') c.problem(`${at}.kind`, 'must be object-store (an S3 API whose links reach browsers and providers)');
      else service.kind = 'object-store';
    }
    if (entry.console !== undefined) {
      if (service.kind !== 'object-store') c.problem(`${at}.console`, 'belongs to an object-store service only');
      else if (typeof entry.console !== 'string' || !Object.hasOwn(ports, entry.console)) c.problem(`${at}.console`, 'must name a declared port (the admin console, which no tunnel route may reach)');
      else service.console = entry.console;
    }
    if (service.kind === 'object-store' && (port === null)) c.problem(`${at}.port`, 'an object-store service names its S3 port');
    return service;
  });
}

/** A public DNS name: lowercase labels, at least two, never an address or a loopback name. */
const PUBLIC_HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;

/** `local.tunnel`: the named tunnel (its credentials are the machine's cert.pem, never a value here) and its routes, each a public host and a declared port. */
function tunnelOf(c: Collector, value: unknown, ports: Record<string, number>, basePort: number | null): LocalTunnel | undefined {
  if (value === undefined) return undefined;
  if (!closedFields(c, 'tunnel', value, ['name', 'routes'], 'local')) return undefined;
  const entry = value as Record<string, unknown>;
  patternField(c, 'tunnel.name', entry.name, NAME);
  const hosts = new Set<string>();
  const routes = listOf(c, 'tunnel.routes', entry.routes, (item, index): LocalTunnelRoute => {
    const at = `tunnel.routes[${index}]`;
    if (!closedFields(c, at, item, ['name', 'host', 'port'], 'local')) return { name: '', host: '', port: '' };
    const route = item as Record<string, unknown>;
    patternField(c, `${at}.name`, route.name, NAME);
    const host = String(route.host ?? '');
    if (!PUBLIC_HOST.test(host) || host === 'localhost' || host.endsWith('.localhost')) c.problem(`${at}.host`, 'must be a public DNS name (not an address, localhost or a container name)');
    if (hosts.has(host)) c.problem(`${at}.host`, `${host} is routed twice`);
    hosts.add(host);
    const port = String(route.port ?? '');
    // The gallery route (PROJECT-GALLERY-1 item 4) reaches the derived gallery port (base + portOffset), which `local.ports` does not declare.
    if (route.name === GALLERY_ROUTE) {
      if (port !== GALLERY_ROUTE) c.problem(`${at}.port`, `the ${GALLERY_ROUTE} route's port is ${GALLERY_ROUTE} (the gallery port derives from local.basePort)`);
      if (basePort === null) c.problem(`${at}`, `the ${GALLERY_ROUTE} route needs local.basePort: the gallery port derives from it`);
    } else if (!Object.hasOwn(ports, port)) c.problem(`${at}.port`, `${port} is not a declared port`);
    return { name: String(route.name ?? ''), host, port };
  });
  if (routes.length === 0) c.problem('tunnel.routes', 'must list at least one route');
  return { name: String(entry.name ?? ''), routes };
}

function databaseOf(c: Collector, value: unknown, ports: Record<string, number>, services: LocalService[], role: string): LocalDatabase | null {
  if (value === undefined) return null;
  if (!closedFields(c, 'database', value, ['service', 'port', 'name', 'role', 'urlEnv', 'urlAs', 'adminUser', 'password', 'adminPassword', 'appRole', 'appPassword'], 'local')) return null;
  const entry = value as Record<string, unknown>;
  patternField(c, 'database.service', entry.service, NAME);
  if (!services.some((service) => service.name === entry.service)) c.problem('database.service', 'must be one of the started services');
  if (!Object.hasOwn(ports, String(entry.port))) c.problem('database.port', 'must name a declared port');
  const own = entry.role === undefined ? role : String(entry.role);
  patternField(c, 'database.role', own, SQL_NAME);
  const name = entry.name === undefined ? own : String(entry.name);
  patternField(c, 'database.name', name, SQL_NAME);
  patternField(c, 'database.urlEnv', entry.urlEnv, KEY);
  const urlAs = String(entry.urlAs ?? 'file');
  if (!['env', 'file'].includes(urlAs)) c.problem('database.urlAs', 'must be env (the URL in the process environment) or file (<KEY>_FILE, preferred)');
  const adminUser = String(entry.adminUser ?? 'postgres');
  patternField(c, 'database.adminUser', adminUser, SQL_NAME);
  if (own === adminUser || own === 'postgres') c.problem('database.role', 'must be a role of this environment alone, never the superuser and never a role another environment uses');
  const appRole = entry.appRole === undefined ? null : String(entry.appRole);
  if (appRole !== null) patternField(c, 'database.appRole', appRole, SQL_NAME);
  if ((appRole === null) !== (entry.appPassword === undefined)) c.problem('database.appPassword', 'is declared with appRole, both or neither: the app role the migrations create gets its own password per environment');
  if (appRole !== null && (appRole === own || appRole === adminUser)) c.problem('database.appRole', 'must be a role other than the owner role and the superuser');
  return {
    appRole, appPassword: entry.appPassword === undefined ? null : ref(c, 'database.appPassword', entry.appPassword),
    service: String(entry.service), port: String(entry.port), name, role: own, urlEnv: String(entry.urlEnv), urlAs: urlAs as 'env' | 'file', adminUser,
    password: ref(c, 'database.password', entry.password), adminPassword: ref(c, 'database.adminPassword', entry.adminPassword),
  };
}

/**
 * The `databases` list: one entry per further hfs.json connection, `{connection, urlEnv, password, name?, role?, urlAs?}`. The service, port,
 * administrator and its password are the `database` block's (a list entry may restate them); the role and database default to the
 * environment role suffixed with the connection (`<project>_<env>_<connection>`), and every role, database, URL key and password key is its own.
 */
function connectionDatabasesOf(c: Collector, value: unknown, base: LocalDatabase | null, ports: Record<string, number>, services: LocalService[], role: string): LocalConnectionDatabase[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { c.problem('databases', 'must be a list of {connection, urlEnv, password} entries'); return []; }
  if (value.length > 0 && base === null) c.problem('databases', 'needs the `database` block: it names the service, port and administrator the further databases share');
  const seen = new Set<string>();
  const out: LocalConnectionDatabase[] = [];
  value.forEach((item, index) => {
    const at = `databases[${index}]`;
    if (base === null || !closedFields(c, at, item, ['connection', 'service', 'port', 'name', 'role', 'urlEnv', 'urlAs', 'adminUser', 'password', 'adminPassword'], 'local')) return;
    const entry = item as Record<string, unknown>;
    patternField(c, `${at}.connection`, entry.connection, NAME);
    const connection = String(entry.connection);
    const own = entry.role === undefined ? `${role}_${connection.replaceAll('-', '_')}` : String(entry.role);
    patternField(c, `${at}.role`, own, SQL_NAME);
    const name = entry.name === undefined ? own : String(entry.name);
    patternField(c, `${at}.name`, name, SQL_NAME);
    patternField(c, `${at}.urlEnv`, entry.urlEnv, KEY);
    const service = entry.service === undefined ? base.service : String(entry.service);
    const port = entry.port === undefined ? base.port : String(entry.port);
    if (!services.some((candidate) => candidate.name === service)) c.problem(`${at}.service`, 'must be one of the started services');
    if (!Object.hasOwn(ports, port)) c.problem(`${at}.port`, 'must name a declared port');
    const urlAs = String(entry.urlAs ?? 'file');
    if (!['env', 'file'].includes(urlAs)) c.problem(`${at}.urlAs`, 'must be env (the URL in the process environment) or file (<KEY>_FILE, preferred)');
    const adminUser = entry.adminUser === undefined ? base.adminUser : String(entry.adminUser);
    patternField(c, `${at}.adminUser`, adminUser, SQL_NAME);
    if (own === adminUser || own === 'postgres') c.problem(`${at}.role`, 'must be a role of this connection alone, never the superuser');
    if (own === base.role || name === base.name) c.problem(`${at}`, 'must have its own role and database: the `database` block already owns that one');
    if (seen.has(connection) || seen.has(`role:${own}`) || seen.has(`db:${name}`) || seen.has(`url:${String(entry.urlEnv)}`)) c.problem(at, 'repeats a connection, role, database or URL key of an earlier entry');
    seen.add(connection); seen.add(`role:${own}`); seen.add(`db:${name}`); seen.add(`url:${String(entry.urlEnv)}`);
    if (String(entry.urlEnv) === base.urlEnv) c.problem(`${at}.urlEnv`, 'must differ from the URL key of the `database` block');
    out.push({
      connection, service, port, name, role: own, urlEnv: String(entry.urlEnv), urlAs: urlAs as 'env' | 'file', adminUser, appRole: null, appPassword: null,
      password: ref(c, `${at}.password`, entry.password),
      adminPassword: entry.adminPassword === undefined ? base.adminPassword : ref(c, `${at}.adminPassword`, entry.adminPassword),
    });
  });
  return out;
}

function custodyOf(c: Collector, value: unknown): CustodyGenerator[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { c.problem('custody', 'must be a list of generated dev values'); return []; }
  return value.map((item, index): CustodyGenerator => {
    const at = `custody[${index}]`;
    if (!closedFields(c, at, item, ['member', 'key', 'kind', 'bytes', 'publicKey'], 'local')) return { member: '', key: '', kind: 'hex', bytes: 32, publicKey: null };
    const entry = item as Record<string, unknown>;
    const base = ref(c, at, { member: entry.member, key: entry.key });
    if (!GENERATORS.includes(String(entry.kind))) c.problem(`${at}.kind`, `must be one of ${GENERATORS.join(', ')}`);
    const bytes = entry.bytes === undefined ? 32 : entry.bytes;
    if (!Number.isInteger(bytes) || (bytes as number) < 8 || (bytes as number) > 1024) c.problem(`${at}.bytes`, 'must be a whole byte count from 8 to 1024');
    if (entry.publicKey !== undefined) {
      if (entry.kind === 'rsa-pem' || entry.kind === 'ec-pem' || entry.kind === 'ed25519-pem') patternField(c, `${at}.publicKey`, entry.publicKey, KEY);
      else c.problem(`${at}.publicKey`, 'is only for kind rsa-pem, ec-pem or ed25519-pem');
    }
    return { ...base, kind: String(entry.kind), bytes: bytes as number, publicKey: text(entry.publicKey) ? entry.publicKey : null };
  });
}

function listOf<T>(c: Collector, at: string, value: unknown, each: (item: unknown, index: number) => T): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { c.problem(at, 'must be a list'); return []; }
  return value.map((item, index) => each(item, index));
}

function referencedPorts(c: Collector, block: LocalBlock): void {
  const known = new Set(Object.keys(block.ports));
  const check = (at: string, value: string): void => {
    for (const match of value.matchAll(/\$\{port\.([a-z][a-z0-9-]*)\}/gu)) if (!known.has(match[1] as string)) c.problem(at, `names the undeclared port ${match[1]}`);
  };
  for (const item of [...block.ready, ...block.verify]) check(`url of ${item.name}`, item.url);
  for (const origin of block.origins) check(`origin ${origin.name}`, origin.url);
  for (const run of [...block.setup, ...block.seed, ...block.processes]) {
    for (const part of run.argv) check(`argv of ${run.name}`, part);
    for (const value of Object.values(run.env)) check(`env of ${run.name}`, value);
  }
  for (const process of block.processes) {
    for (const part of [...(process.serve?.argv ?? []), ...(process.serve?.build?.argv ?? [])]) check(`serve of ${process.name}`, part);
    if (process.port !== null && !known.has(process.port)) c.problem(`processes.${process.name}.port`, `${process.port} is not a declared port`);
    if (process.health) check(`health of ${process.name}`, process.health.url);
  }
}

/** The normalised `local` block, or the problems that stop it. `project` and `env` name the defaults (`<project>-<env>`, the role). */
export function normalizeLocal(raw: unknown, { project, env }: { project: string; env: string }): { config: LocalBlock | null; problems: StackProblem[] } {
  const c = collector();
  if (!closedFields(c, 'local', raw, TOP, 'local')) return { config: null, problems: c.problems };
  const entry = raw as Record<string, unknown>;
  const compose = String(entry.project ?? `${project}-${env}`).toLowerCase().replaceAll(/[^a-z0-9_-]+/gu, '-');
  patternField(c, 'project', compose, PROJECT);
  const ports = portsOf(c, entry.ports);
  const services = servicesOf(c, entry.services, ports);
  const role = `${project}_${env}`.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '_').replace(/^[^a-z]+/u, 'a');
  const names = new Set<string>();
  const database = databaseOf(c, entry.database, ports, services, role);
  const block: LocalBlock = {
    project: compose, basePort: basePortOf(c, entry.basePort), ports, services,
    database,
    databases: connectionDatabasesOf(c, entry.databases, database, ports, services, role),
    composeEnv: listOf(c, 'composeEnv', entry.composeEnv, (item, index) => {
      const at = `composeEnv[${index}]`;
      if (!closedFields(c, at, item, ['name', 'member', 'key'], 'local')) return { name: '', member: '', key: '' };
      const value = item as Record<string, unknown>;
      patternField(c, `${at}.name`, value.name, KEY);
      return { name: String(value.name), ...ref(c, at, { member: value.member, key: value.key }) };
    }),
    grants: listOf(c, 'grants', entry.grants, (item, index) => {
      const at = `grants[${index}]`;
      if (!closedFields(c, at, item, ['name', 'keys'], 'local')) return { name: '', keys: [] };
      const value = item as Record<string, unknown>;
      patternField(c, `${at}.name`, value.name, NAME);
      const keys = strings(c, `${at}.keys`, value.keys, KEY);
      if (keys.length === 0) c.problem(`${at}.keys`, 'must list the keys the service reads');
      return { name: String(value.name), keys };
    }),
    dirs: strings(c, 'dirs', entry.dirs, NAME_PATTERN),
    custody: custodyOf(c, entry.custody),
    setup: listOf(c, 'setup', entry.setup, (item, index) => command(c, `setup[${index}]`, item, COMMAND, names)),
    seed: listOf(c, 'seed', entry.seed, (item, index) => command(c, `seed[${index}]`, item, SEED, names)),
    processes: listOf(c, 'processes', entry.processes, (item, index) => {
      const at = `processes[${index}]`;
      const base = command(c, at, item, PROCESS, names);
      const value = plain(item) ? item as Record<string, unknown> : {};
      return { ...base, port: value.port === undefined ? null : String(value.port), health: value.health === undefined ? null : probe(c, `${at}.health`, { name: base.name || 'health', ...(value.health as object) }), serve: serveOf(c, `${at}.serve`, value.serve) };
    }),
    ready: listOf(c, 'ready', entry.ready, (item, index) => probe(c, `ready[${index}]`, item)),
    verify: listOf(c, 'verify', entry.verify, (item, index) => probe(c, `verify[${index}]`, item)),
    origins: listOf(c, 'origins', entry.origins, (item, index) => {
      const at = `origins[${index}]`;
      if (!closedFields(c, at, item, ['name', 'url'], 'local')) return { name: '', url: '' };
      const value = item as Record<string, unknown>;
      patternField(c, `${at}.name`, value.name, NAME);
      return { name: String(value.name), url: String(value.url ?? '') };
    }),
    resources: { diskGb: 10, ramMb: 4096 },
  };
  const tunnel = tunnelOf(c, entry.tunnel, ports, Number.isInteger(entry.basePort) ? (entry.basePort as number) : null);
  if (tunnel !== undefined) block.tunnel = tunnel;
  if (entry.resources !== undefined && closedFields(c, 'resources', entry.resources, ['diskGb', 'ramMb'], 'local')) {
    const value = entry.resources as Record<string, unknown>;
    for (const [key, floor] of [['diskGb', 1], ['ramMb', 512]] as const) {
      if (value[key] === undefined) continue;
      if (!Number.isInteger(value[key]) || (value[key] as number) < floor) c.problem(`resources.${key}`, `must be a whole number from ${floor}`);
      else block.resources[key] = value[key] as number;
    }
  }
  if (entry.dbUpgrade !== undefined && closedFields(c, 'dbUpgrade', entry.dbUpgrade, ['from', 'hold'], 'local')) {
    const value = entry.dbUpgrade as Record<string, unknown>;
    const named = (['from', 'hold'] as const).filter((key) => value[key] !== undefined);
    const volume = named.length === 1 ? value[named[0] as 'from' | 'hold'] : undefined;
    if (named.length !== 1) c.problem('dbUpgrade', 'names exactly one of from (the old volume restored into the declared one) and hold (the volume that keeps the old data directory of an in-place upgrade)');
    else if (typeof volume !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(volume)) c.problem(`dbUpgrade.${named[0]}`, 'must name a docker volume');
    else block.dbUpgrade = named[0] === 'from' ? { from: volume } : { hold: volume };
  }
  referencedPorts(c, block);
  const generated = new Set(block.custody.flatMap((item) => [`${item.member}/${item.key}`, ...(item.publicKey ? [`${item.member}/${item.publicKey}`] : [])]));
  if (generated.size < block.custody.length) c.problem('custody', 'declares a key twice');
  return c.problems.length === 0 ? { config: block, problems: [] } : { config: null, problems: c.problems };
}

/** Replaces `${port.<name>}` with the chosen host port. */
export const expandPorts = (value: string, ports: Readonly<Record<string, number>>): string =>
  value.replaceAll(/\$\{port\.([a-z][a-z0-9-]*)\}/gu, (_whole, name: string) => String(ports[name] ?? ''));
