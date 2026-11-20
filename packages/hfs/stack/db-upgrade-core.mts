// db-upgrade-core.mts - the Postgres major upgrade both kinds of environment run (`starci app stack db-upgrade`, PROJECT-STACKS-19): a dump and restore
// from an old volume into a new one, in throwaway containers with no network, the old volume mounted read-only and measured before and after.
//   work copy   the old volume is copied (cp -a, read-only source) into a throwaway work volume: the old-major server starts on the copy, never on the
//               old volume, so the old bytes cannot change (the old volume's files, bytes, content and metadata digests are equal before and after)
//   old server  the old-major image on the work copy, no TCP (listen_addresses empty), its socket in a throwaway scratch volume, a trust-only local hba
//   new server  the target image initialises the new volume with its own entrypoint: the environment's superuser, database and initdb arguments, and the
//               sealed superuser password, handed in on stdin into a tmpfs file (never argv, a file on disk or a log line); no init script runs
//   dump        the old image's own pg_dumpall --roles-only (the SCRAM or md5 hashes as stored, so no password rotates) and pg_dump -Fc --create of
//               every database that allows connections, into the scratch volume. The old major's own tools know every catalog detail of its minor:
//               PostgreSQL 16.16 marks each column with the attribute option pg_attver, which its own pg_dump leaves out and pg_dump 17.11 copies
//               into the dump, where the 17.11 server refuses it; the target's pg_restore reads the older archive
//   restore     the roles first (the superuser's own CREATE ROLE left out: initdb made it), then every database dropped from the fresh cluster and
//               restored with --create --exit-on-error; refused when an extension the old cluster uses is not available in the target image
//   compare     both clusters are inventoried the same way: databases, extensions, the exact row count of every table, every sequence's position, the
//               count of every kind of relation and of functions (extension members left out), the roles with their attributes and password hashes,
//               and the role memberships; any difference refuses (STACK_DB_UPGRADE_MISMATCH) and the new volume is emptied again
//   logins      the sealed superuser password, and every sealed app password the caller names, log in on the restored cluster over TCP with md5/SCRAM
//               (STACK_DB_UPGRADE_PASSWORD_DRIFT otherwise)
// The scratch volume (it holds the dumps, password hashes included) and the work copy are removed whatever happens.
import { firstLine, lines as splitLines, tool } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { helper, measureVolume, volumeEmpty, volumeExists } from './volume.mjs';
import type { VolumeMeasure } from './volume.mjs';

/**
 * The Docker Official postgres images of the majors before the managed db image's (contexts/stack/pins.yaml `postgres-16`, `postgres-16-alpine`): the
 * old-major server of an upgrade when the image the database last ran is gone or is already the new major. A data directory owned by uid 70 was made by an
 * alpine image, one owned by uid 999 by a Debian one; the same family reads it.
 */
export const PREVIOUS_MAJOR_IMAGES: Readonly<Record<string, { debian: string; alpine: string }>> = Object.freeze({
  16: {
    debian: 'postgres:16.16@sha256:3950ad7c3148ca2175ef1b6c36c9efbf78957ae8fbe8b3a5d7c35af50500382f',
    alpine: 'postgres:16.16-alpine@sha256:1d5b02d3a9941fbd52437db4107f8c52d6297dac553ca1e5c299ebb3756b4857',
  },
});

/** Where the official image keeps its data directory, and so where a database volume is mounted. */
export const DATA_MOUNT = '/var/lib/postgresql/data';
/** The uid the alpine official images run postgres as (Debian: 999). */
const ALPINE_UID = 70;
const START_SECONDS = 180;
const SQL_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
const STDIN_PASSWORD = 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec "$@"';

/** One extra login the caller proves on the restored cluster: a role, its database and its sealed password (in memory only). */
export interface UpgradeLogin { role: string; database: string; what: string; password: () => string }

/** Everything one upgrade needs; every name comes from the environment's declaration or from the running service it replaces. */
export interface UpgradeSite {
  /** The old volume (the data directory of the old major) and the new volume (empty, or absent and then created). */
  oldVolume: string;
  newVolume: string;
  /** The old-major image the dump reads with, and the target image the new volume is initialised and restored with. */
  oldImage: string;
  image: string;
  /** The data directory inside the container (PGDATA), at or below the volume's mount point. */
  pgdata: string;
  mount: string;
  /** The superuser and its database, as the service starts them (POSTGRES_USER, POSTGRES_DB), and its POSTGRES_INITDB_ARGS. */
  superuser: string;
  database: string;
  initdbArgs: string | null;
  /** The sealed superuser password, opened when the new volume is initialised and never written, printed or put in an argument list. */
  password: () => string;
  logins: UpgradeLogin[];
  /** The prefix of the throwaway containers and volumes of this run. */
  prefix: string;
}

/** The inventory of one database. */
export interface DatabaseInventory { extensions: Record<string, string>; rows: Record<string, number>; sequences: Record<string, string>; objects: Record<string, number> }
/** The inventory of one cluster. */
export interface ClusterInventory { databases: Record<string, DatabaseInventory>; roles: { count: number; digest: string }; members: { count: number; digest: string } }

/** The phase seam: the swarm verb records each phase in the deploy journal, the dev verb in its own journal file. */
export type PhaseRunner = <T>(name: string, action: () => T | Promise<T>, passed?: (value: T) => boolean) => Promise<T>;

/** A step that did not pass: its refusal code and what it found. */
export class UpgradeStop extends Error {
  /** The lines the upgrade printed before it stopped. */
  lines: string[] = [];
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** The collaborators a caller may replace. `beforeCompare` runs on the restored cluster's container just before the inventories are compared. */
export interface UpgradeDeps { beforeCompare?: ((ctx: StackContext, container: string) => void) | undefined }

/** What a finished upgrade keeps (names, counts and digests only). */
export interface UpgradeRecord {
  from: string; to: string; oldMajor: string; newMajor: string; oldImage: string; image: string;
  before: VolumeMeasure; after: VolumeMeasure | null; inventory: ClusterInventory | null; createdTarget: boolean;
}

const docker = (ctx: Pick<StackContext, 'spawn'>, args: readonly string[], input?: string): RunResult => tool(ctx, 'docker', args, input === undefined ? {} : { input });
const failed = (run: RunResult): boolean => run.status !== 0 || Boolean(run.error);
const reason = (run: RunResult): string => firstLine(run.stderr || run.error?.message || run.stdout) || `exit ${String(run.status)}`;

/** The major of an image's server: `postgres --version` inside it, no network. */
export function imageMajor(ctx: Pick<StackContext, 'spawn'>, image: string): string | null {
  const run = docker(ctx, ['run', '--rm', '--network', 'none', '--entrypoint', 'postgres', image, '--version']);
  const found = /\(PostgreSQL\)\s+(\d+)/u.exec(String(run.stdout));
  return failed(run) || !found ? null : (found[1] as string);
}

/** The data directory below the volume's root ('' when PGDATA is the mount point itself). */
export function dataSubpath(pgdata: string, mount: string): string | null {
  const clean = (value: string): string => value.replace(/\/+$/u, '');
  if (clean(pgdata) === clean(mount)) return '';
  return clean(pgdata).startsWith(`${clean(mount)}/`) ? clean(pgdata).slice(clean(mount).length + 1) : null;
}

/** What the old volume holds: PG_VERSION, the uid that owns it and the settings of postgresql.auto.conf (names only). Read with the volume mounted read-only. */
export function readCluster(ctx: Pick<StackContext, 'spawn'>, image: string, volume: string, sub: string): { version: string | null; uid: number | null; autoSettings: string[] } {
  const dir = sub === '' ? '/v' : `/v/${sub}`;
  const script = `d='${dir}'; if [ -f "$d/PG_VERSION" ]; then printf 'version=%s\\n' "$(head -n 1 "$d/PG_VERSION")"; printf 'uid=%s\\n' "$(stat -c %u "$d/PG_VERSION")"; fi; if [ -f "$d/postgresql.auto.conf" ]; then grep -v '^[[:space:]]*#' "$d/postgresql.auto.conf" | grep '=' | sed 's/[[:space:]]*=.*//; s/^/setting=/' || true; fi`;
  const run = helper(ctx, image, [`${volume}:/v:ro`], script);
  if (!run.ok) throw new UpgradeStop('STACK_DB_UPGRADE_NOT_A_CLUSTER', `cannot read the volume ${volume} with ${image}: ${firstLine(run.stderr)}`);
  const values = splitLines(run.stdout);
  const pick = (key: string): string | undefined => values.find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();
  const uid = pick('uid');
  return { version: pick('version') ?? null, uid: uid === undefined ? null : Number(uid), autoSettings: values.filter((line) => line.startsWith('setting=')).map((line) => line.slice('setting='.length).trim()) };
}

/** The pinned official image of `major` for a data directory owned by `uid`, or null when no pin exists. */
export function pinnedOldImage(major: string, uid: number | null): string | null {
  const pins = PREVIOUS_MAJOR_IMAGES[major];
  if (!pins) return null;
  return uid === ALPINE_UID ? pins.alpine : pins.debian;
}

/* ---- inventory */

const DIGEST = (rows: string): string => `encode(sha256(convert_to(coalesce(string_agg(${rows}, E'\\n' order by ${rows}), ''), 'UTF8')), 'hex')`;
/** The cluster's databases, its roles (attributes and stored password hashes) and the memberships of its own roles, as digests. */
export const CLUSTER_SQL = [
  "select 'db|' || datname from pg_database where datallowconn and not datistemplate order by datname;",
  `select 'roles|' || count(*) || '|' || ${DIGEST('r')} from (select concat_ws('|', rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, coalesce(rolpassword, ''), coalesce(rolvaliduntil::text, '')) as r from pg_authid where rolname !~ '^pg_') as s;`,
  `select 'members|' || count(*) || '|' || ${DIGEST('m')} from (select concat_ws('|', r.rolname, u.rolname, a.admin_option) as m from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles u on u.oid = a.member where u.rolname !~ '^pg_') as s;`,
  '',
].join('\n');
const USER_SCHEMA = "n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_toast'";
const NOT_MEMBER = (catalog: string, oid: string): string => `not exists (select 1 from pg_depend d where d.classid = '${catalog}'::regclass and d.objid = ${oid} and d.deptype = 'e')`;
/** One database: its extensions, every table's exact row count, every sequence's position, and the count of each kind of relation and of functions. */
export const DATABASE_SQL = [
  "select 'ext|' || extname || '|' || extversion from pg_extension order by extname;",
  `select 'obj|' || c.relkind::text || '|' || count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where ${USER_SCHEMA} and ${NOT_MEMBER('pg_class', 'c.oid')} group by c.relkind order by c.relkind;`,
  `select 'obj|function|' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${USER_SCHEMA} and ${NOT_MEMBER('pg_proc', 'p.oid')};`,
  `select format('select %L || ''|'' || count(*) from %I.%I;', 'rows|' || n.nspname || '.' || c.relname, n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and ${USER_SCHEMA} order by n.nspname, c.relname \\gexec`,
  `select format('select %L || ''|'' || last_value || ''|'' || is_called from %I.%I;', 'seq|' || n.nspname || '.' || c.relname, n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and ${USER_SCHEMA} and ${NOT_MEMBER('pg_class', 'c.oid')} order by n.nspname, c.relname \\gexec`,
  '',
].join('\n');

/** Splits `kind|rest` lines; `rest` keeps every later `|`. */
const tagged = (stdout: string, kind: string): string[] => splitLines(stdout).filter((line) => line.startsWith(`${kind}|`)).map((line) => line.slice(kind.length + 1));
/** `name|value` with the value after the LAST `|` (a table name may hold one). */
const lastPair = (line: string): [string, string] => [line.slice(0, line.lastIndexOf('|')), line.slice(line.lastIndexOf('|') + 1)];

/** The inventory of one database from the output of DATABASE_SQL. */
export function parseDatabase(stdout: string): DatabaseInventory {
  const inventory: DatabaseInventory = { extensions: {}, rows: {}, sequences: {}, objects: {} };
  for (const line of tagged(stdout, 'ext')) { const [name, version] = lastPair(line); inventory.extensions[name] = version; }
  for (const line of tagged(stdout, 'obj')) { const [kind, count] = lastPair(line); inventory.objects[kind] = Number(count); }
  for (const line of tagged(stdout, 'rows')) { const [table, count] = lastPair(line); inventory.rows[table] = Number(count); }
  for (const line of tagged(stdout, 'seq')) {
    const called = line.lastIndexOf('|');
    const value = line.lastIndexOf('|', called - 1);
    inventory.sequences[line.slice(0, value)] = line.slice(value + 1);
  }
  return inventory;
}

/** The database names and the role digests from the output of CLUSTER_SQL. */
export function parseCluster(stdout: string): { databases: string[]; roles: { count: number; digest: string }; members: { count: number; digest: string } } {
  const pair = (kind: string): { count: number; digest: string } => {
    const [count, digest] = (tagged(stdout, kind)[0] ?? '-1|').split('|');
    return { count: Number(count), digest: String(digest) };
  };
  return { databases: tagged(stdout, 'db'), roles: pair('roles'), members: pair('members') };
}

const keys = (record: Record<string, unknown>): string[] => Object.keys(record).sort();
const missingFrom = (a: Record<string, unknown>, b: Record<string, unknown>): string[] => keys(a).filter((key) => !Object.hasOwn(b, key));

/**
 * Every difference between the old cluster and the restored one (an empty list is a proven restore). Extension versions may differ (the target image
 * installs its own default version of the same extension); every other difference is listed.
 */
export function inventoryProblems(before: ClusterInventory, after: ClusterInventory): string[] {
  const problems: string[] = [];
  for (const name of missingFrom(before.databases, after.databases)) problems.push(`database ${name} is missing after the restore`);
  for (const name of missingFrom(after.databases, before.databases)) problems.push(`database ${name} exists only after the restore`);
  if (before.roles.count !== after.roles.count || before.roles.digest !== after.roles.digest) problems.push(`the roles differ (${before.roles.count} before, ${after.roles.count} after; attributes or password hashes changed)`);
  if (before.members.count !== after.members.count || before.members.digest !== after.members.digest) problems.push(`the role memberships differ (${before.members.count} before, ${after.members.count} after)`);
  for (const name of keys(before.databases).filter((key) => Object.hasOwn(after.databases, key))) {
    const [a, b] = [before.databases[name] as DatabaseInventory, after.databases[name] as DatabaseInventory];
    for (const ext of missingFrom(a.extensions, b.extensions)) problems.push(`${name}: the extension ${ext} is missing after the restore`);
    for (const ext of missingFrom(b.extensions, a.extensions)) problems.push(`${name}: the extension ${ext} exists only after the restore`);
    for (const table of new Set([...keys(a.rows), ...keys(b.rows)])) {
      if (a.rows[table] !== b.rows[table]) problems.push(`${name}: ${table} holds ${a.rows[table] ?? 'no table'} row(s) before and ${b.rows[table] ?? 'no table'} after`);
    }
    for (const sequence of new Set([...keys(a.sequences), ...keys(b.sequences)])) {
      if (a.sequences[sequence] !== b.sequences[sequence]) problems.push(`${name}: the sequence ${sequence} is at ${a.sequences[sequence] ?? 'nothing'} before and ${b.sequences[sequence] ?? 'nothing'} after`);
    }
    for (const kind of new Set([...keys(a.objects), ...keys(b.objects)])) {
      if ((a.objects[kind] ?? 0) !== (b.objects[kind] ?? 0)) problems.push(`${name}: ${a.objects[kind] ?? 0} object(s) of kind ${kind} before and ${b.objects[kind] ?? 0} after`);
    }
  }
  return problems;
}

/** One summary line per database, and the roles line, for the verb's output. */
export function inventoryLines(inventory: ClusterInventory, before: ClusterInventory | null = null): string[] {
  const out = Object.entries(inventory.databases).sort(([a], [b]) => a.localeCompare(b)).map(([name, db]) => {
    const rows = Object.values(db.rows).reduce((sum, count) => sum + count, 0);
    const extensions = Object.entries(db.extensions).map(([ext, version]) => {
      const old = before?.databases[name]?.extensions[ext];
      return old !== undefined && old !== version ? `${ext} ${old} -> ${version}` : `${ext} ${version}`;
    });
    return `  ${name}: ${Object.keys(db.rows).length} table(s), ${rows} row(s), ${Object.keys(db.sequences).length} sequence(s); extensions ${extensions.join(', ') || 'none'}`;
  });
  return [...out, `  roles: ${inventory.roles.count} (digest ${inventory.roles.digest.slice(0, 16)}, password hashes included), memberships: ${inventory.members.count}`];
}

/** The output of a script fed to psql on stdin inside `container`, as the superuser over the socket in `socket`; throws an UpgradeStop with `code`. */
function psql(ctx: StackContext, container: string, socket: string, site: UpgradeSite, database: string, sql: string, code: string): string {
  const run = docker(ctx, ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-U', site.superuser, '-d', database, '-f', '-'], sql);
  if (failed(run)) throw new UpgradeStop(code, `psql in ${container} on ${database} failed: ${reason(run)}`);
  return String(run.stdout);
}

/** The inventory of the cluster that `container` serves on `socket`. */
export function inventoryOf(ctx: StackContext, container: string, socket: string, site: UpgradeSite): ClusterInventory {
  const cluster = parseCluster(psql(ctx, container, socket, site, 'template1', CLUSTER_SQL, 'STACK_DB_UPGRADE_INVENTORY'));
  const databases: Record<string, DatabaseInventory> = {};
  for (const name of cluster.databases) databases[name] = parseDatabase(psql(ctx, container, socket, site, name, DATABASE_SQL, 'STACK_DB_UPGRADE_INVENTORY'));
  return { databases, roles: cluster.roles, members: cluster.members };
}

/* ---- containers */

/** Waits until `ready()` holds, failing early when the container stopped; the container's last log line names why. */
async function waitFor(ctx: StackContext, container: string, ready: () => boolean, code: string, what: string): Promise<void> {
  const deadline = ctx.now() + START_SECONDS * 1000;
  for (;;) {
    if (ready()) return;
    const state = docker(ctx, ['inspect', '--format', '{{.State.Running}}', container]);
    if (failed(state) || String(state.stdout).trim() !== 'true') {
      const logs = docker(ctx, ['logs', '--tail', '5', container]);
      throw new UpgradeStop(code, `${what} stopped: ${splitLines(`${String(logs.stdout)}\n${String(logs.stderr)}`).at(-1) ?? 'no log line'}`);
    }
    if (ctx.now() >= deadline) throw new UpgradeStop(code, `${what} did not accept connections within ${START_SECONDS}s`);
    await ctx.sleep(1000);
  }
}

const isReady = (ctx: StackContext, container: string, socket: string, site: UpgradeSite): boolean => !failed(docker(ctx, ['exec', container, 'pg_isready', '-q', '-h', socket, '-U', site.superuser, '-d', 'template1']));

/** The scratch volume's layout: the old server's socket, the dumps, and the two hba files the throwaway servers read. */
const SCRATCH_SCRIPT = [
  'set -e', 'mkdir -p /s/sock /s/dump /s/hba', 'chmod 1777 /s/sock', 'chmod 777 /s/dump', 'chmod 755 /s/hba',
  "printf 'local all all trust\\n' > /s/hba/trust.conf",
  "printf 'local all all trust\\nhost all all 127.0.0.1/32 md5\\n' > /s/hba/check.conf",
  'chmod 644 /s/hba/trust.conf /s/hba/check.conf',
].join('; ');

/** Starts the target image on the new volume: its own entrypoint initialises it once the password reaches the tmpfs file. */
async function startNew(ctx: StackContext, site: UpgradeSite, scratch: string): Promise<string> {
  const name = `${site.prefix}-new`;
  const env = ['-e', `POSTGRES_USER=${site.superuser}`, '-e', `POSTGRES_DB=${site.database}`, '-e', `PGDATA=${site.pgdata}`, '-e', 'POSTGRES_PASSWORD_FILE=/run/dbu/pw', ...(site.initdbArgs ? ['-e', `POSTGRES_INITDB_ARGS=${site.initdbArgs}`] : [])];
  const wait = 'while [ ! -s /run/dbu/pw ]; do sleep 0.2; done; exec docker-entrypoint.sh postgres -c listen_addresses=127.0.0.1 -c hba_file=/scratch/hba/check.conf';
  const started = docker(ctx, ['run', '-d', '--name', name, '--network', 'none', ...env, '--tmpfs', '/run/dbu:mode=0755', '--tmpfs', '/docker-entrypoint-initdb.d', '-v', `${site.newVolume}:${site.mount}`, '-v', `${scratch}:/scratch`, '--entrypoint', 'sh', site.image, '-c', wait]);
  if (failed(started)) throw new UpgradeStop('STACK_DB_UPGRADE_NEW_START', `cannot start ${site.image} on ${site.newVolume}: ${reason(started)}`);
  const secret = site.password();
  const fed = docker(ctx, ['exec', '-i', name, 'sh', '-c', 'umask 077; cat > /run/dbu/pw.tmp && chown postgres:postgres /run/dbu/pw.tmp && mv /run/dbu/pw.tmp /run/dbu/pw'], secret);
  if (failed(fed)) throw new UpgradeStop('STACK_DB_UPGRADE_NEW_START', `cannot hand the superuser password to ${name}: ${reason(fed).replaceAll(secret, '[redacted]')}`);
  const initialised = (): boolean => /PostgreSQL init process complete/u.test(`${String(docker(ctx, ['logs', name]).stdout)}${String(docker(ctx, ['logs', name]).stderr)}`);
  await waitFor(ctx, name, () => initialised() && isReady(ctx, name, '/var/run/postgresql', site), 'STACK_DB_UPGRADE_NEW_START', `the new server ${site.image} on ${site.newVolume}`);
  docker(ctx, ['exec', name, 'rm', '-f', '/run/dbu/pw']);
  return name;
}

/** Starts the old-major image on the work copy: no TCP, its socket in the scratch volume, the trust-only local hba. */
async function startOld(ctx: StackContext, site: UpgradeSite, work: string, scratch: string): Promise<string> {
  const name = `${site.prefix}-old`;
  const started = docker(ctx, ['run', '-d', '--name', name, '--network', 'none', '-e', `PGDATA=${site.pgdata}`, '-v', `${work}:${site.mount}`, '-v', `${scratch}:/scratch`, site.oldImage, 'postgres', '-c', 'listen_addresses=', '-c', 'unix_socket_directories=/scratch/sock', '-c', 'hba_file=/scratch/hba/trust.conf']);
  if (failed(started)) throw new UpgradeStop('STACK_DB_UPGRADE_OLD_START', `cannot start ${site.oldImage} on the work copy of ${site.oldVolume}: ${reason(started)}`);
  await waitFor(ctx, name, () => isReady(ctx, name, '/scratch/sock', site), 'STACK_DB_UPGRADE_OLD_START', `the old server ${site.oldImage} on the work copy of ${site.oldVolume} (name another image of that major with --old-image)`);
  return name;
}

/** Stops a throwaway server cleanly (its fast shutdown) and removes it. */
function stopServer(ctx: StackContext, name: string): void {
  docker(ctx, ['stop', '--time', '120', name]);
  docker(ctx, ['rm', '-f', name]);
}

/** A tool of the target image inside the new server's container; throws an UpgradeStop with `code`. */
function inNew(ctx: StackContext, name: string, args: string[], code: string, what: string): void {
  const run = docker(ctx, ['exec', name, ...args]);
  if (failed(run)) throw new UpgradeStop(code, `${what}: ${reason(run)}`);
}

/** Dumps the roles and every database of the old server with its own client tools (see the header), into the scratch volume. */
function dump(ctx: StackContext, site: UpgradeSite, server: string, databases: string[]): void {
  const hint = ' (an extension library the old image lacks: name the image the database ran with --old-image)';
  inNew(ctx, server, ['pg_dumpall', '-h', '/scratch/sock', '-U', site.superuser, '--roles-only', '-f', '/scratch/dump/roles.sql'], 'STACK_DB_UPGRADE_DUMP_FAILED', 'pg_dumpall --roles-only');
  databases.forEach((database, index) => {
    const run = docker(ctx, ['exec', server, 'pg_dump', '-h', '/scratch/sock', '-U', site.superuser, '-d', database, '-Fc', '--create', '-f', `/scratch/dump/${index}.dump`]);
    if (failed(run)) throw new UpgradeStop('STACK_DB_UPGRADE_DUMP_FAILED', `pg_dump of ${database}: ${reason(run)}${/could not access file|could not load library/u.test(String(run.stderr)) ? hint : ''}`);
  });
}

/** Restores the roles, then every database, into the new server; refused when an extension the old cluster uses is not available there. */
function restore(ctx: StackContext, site: UpgradeSite, server: string, before: ClusterInventory): void {
  const wanted = [...new Set(Object.values(before.databases).flatMap((db) => Object.keys(db.extensions)))].sort();
  const available = new Set(splitLines(psql(ctx, server, '/var/run/postgresql', site, 'template1', 'select name from pg_available_extensions;\n', 'STACK_DB_UPGRADE_RESTORE_FAILED')));
  const missing = wanted.filter((name) => !available.has(name));
  if (missing.length > 0) throw new UpgradeStop('STACK_DB_UPGRADE_EXTENSION_MISSING', `the target image ${site.image} does not ship the extension(s) ${missing.join(', ')} the old cluster uses: add them to the db image first`);
  // The superuser exists already (initdb made it); every other statement of the roles dump must apply, the superuser's ALTER ROLE (its hash) included.
  inNew(ctx, server, ['sh', '-c', 'grep -v -x -F "CREATE ROLE $1;" /scratch/dump/roles.sql > /scratch/dump/roles.apply.sql', 'sh', site.superuser], 'STACK_DB_UPGRADE_RESTORE_FAILED', 'preparing the roles dump');
  inNew(ctx, server, ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', site.superuser, '-d', 'template1', '-f', '/scratch/dump/roles.apply.sql'], 'STACK_DB_UPGRADE_RESTORE_FAILED', 'restoring the roles');
  const fresh = new Set(parseCluster(psql(ctx, server, '/var/run/postgresql', site, 'template1', CLUSTER_SQL, 'STACK_DB_UPGRADE_RESTORE_FAILED')).databases);
  Object.keys(before.databases).forEach((database, index) => {
    if (fresh.has(database)) psql(ctx, server, '/var/run/postgresql', site, 'template1', `DROP DATABASE "${database.replaceAll('"', '""')}";\n`, 'STACK_DB_UPGRADE_RESTORE_FAILED');
    inNew(ctx, server, ['pg_restore', '-U', site.superuser, '-d', 'template1', '--create', '--exit-on-error', `/scratch/dump/${index}.dump`], 'STACK_DB_UPGRADE_RESTORE_FAILED', `pg_restore of ${database}`);
  });
}

/** Each login over TCP (md5 or SCRAM against the stored hash) with its sealed password on stdin. */
function proveLogins(ctx: StackContext, site: UpgradeSite, server: string): string[] {
  const all: UpgradeLogin[] = [{ role: site.superuser, database: 'template1', what: 'the superuser', password: site.password }, ...site.logins];
  return all.map((login) => {
    if (!SQL_NAME.test(login.role)) throw new UpgradeStop('STACK_DB_UPGRADE_PASSWORD_DRIFT', `the role ${login.role} is not a plain identifier`);
    const secret = login.password();
    const run = docker(ctx, ['exec', '-i', server, 'sh', '-c', STDIN_PASSWORD, 'sh', 'psql', '-X', '-At', '-h', '127.0.0.1', '-U', login.role, '-d', login.database, '-c', 'select 1'], `${secret}\n`);
    if (failed(run) || String(run.stdout).trim() !== '1') throw new UpgradeStop('STACK_DB_UPGRADE_PASSWORD_DRIFT', `${login.what} ${login.role} does not log in on the restored cluster with its sealed password (${reason(run).replaceAll(secret, '[redacted]')}): custody and the database disagree; the old volume is untouched`);
    return `  login ${login.role}: ${login.what} logs in with its sealed password (the restored hash is the old one)`;
  });
}

/**
 * Runs the upgrade of `site` (see the header): every step through `phase`. Returns the lines and the record; a refusal is an UpgradeStop. The old volume is
 * mounted read-only only; the scratch and work volumes are removed whatever happens; on any failure the new volume is removed when this run created it,
 * emptied otherwise.
 */
export async function runUpgrade(ctx: StackContext, site: UpgradeSite, phase: PhaseRunner, record: UpgradeRecord, deps: UpgradeDeps = {}): Promise<string[]> {
  const lines: string[] = [];
  const work = `${site.prefix}-work`;
  const scratch = `${site.prefix}-scratch`;
  const containers: string[] = [];
  let done = false;
  try {
    record.before = await phase('measure-old', () => measureVolume(ctx, site.image, site.oldVolume));
    lines.push(`  old ${site.oldVolume}: files=${record.before.files} bytes=${record.before.bytes} content=${record.before.content.slice(0, 16)} meta=${record.before.meta.slice(0, 16)}`);
    await phase('volumes', () => {
      if (!volumeExists(ctx, site.newVolume)) {
        const made = docker(ctx, ['volume', 'create', site.newVolume]);
        if (failed(made)) throw new UpgradeStop('STACK_DB_UPGRADE_VOLUME', `cannot create ${site.newVolume}: ${reason(made)}`);
        record.createdTarget = true;
      }
      for (const volume of [work, scratch]) {
        const made = docker(ctx, ['volume', 'create', volume]);
        if (failed(made)) throw new UpgradeStop('STACK_DB_UPGRADE_VOLUME', `cannot create ${volume}: ${reason(made)}`);
      }
      const prepared = helper(ctx, site.image, [`${scratch}:/s`], SCRATCH_SCRIPT);
      if (!prepared.ok) throw new UpgradeStop('STACK_DB_UPGRADE_VOLUME', `cannot prepare ${scratch}: ${firstLine(prepared.stderr)}`);
    });
    await phase('work-copy', () => {
      const copied = helper(ctx, site.image, [`${site.oldVolume}:/from:ro`, `${work}:/to`], 'set -e; cp -a /from/. /to/');
      if (!copied.ok) throw new UpgradeStop('STACK_DB_UPGRADE_VOLUME', `cannot copy ${site.oldVolume} into the work copy ${work}: ${firstLine(copied.stderr)}`);
    });
    const fresh = await phase('init-new', () => startNew(ctx, site, scratch));
    containers.push(fresh);
    const old = await phase('start-old', () => startOld(ctx, site, work, scratch));
    containers.push(old);
    const before = await phase('inventory-old', () => inventoryOf(ctx, old, '/scratch/sock', site));
    lines.push(`  inventory of ${site.oldVolume} (PostgreSQL ${record.oldMajor}, ${site.oldImage}):`, ...inventoryLines(before));
    await phase('dump', () => dump(ctx, site, old, Object.keys(before.databases)));
    await phase('stop-old', () => { stopServer(ctx, old); containers.splice(containers.indexOf(old), 1); docker(ctx, ['volume', 'rm', work]); });
    await phase('restore', () => restore(ctx, site, fresh, before));
    deps.beforeCompare?.(ctx, fresh);
    const after = await phase('inventory-new', () => inventoryOf(ctx, fresh, '/var/run/postgresql', site));
    record.inventory = before;
    const problems = inventoryProblems(before, after);
    if (problems.length > 0) {
      lines.push(`  inventory of ${site.newVolume} (PostgreSQL ${record.newMajor}) after the restore:`, ...inventoryLines(after, before), ...problems.map((problem) => `  MISMATCH ${problem}`));
      throw new UpgradeStop('STACK_DB_UPGRADE_MISMATCH', `${problems.length} difference(s) between ${site.oldVolume} and the restored ${site.newVolume}: ${problems.slice(0, 3).join('; ')}`);
    }
    lines.push(`  restored into ${site.newVolume} (PostgreSQL ${record.newMajor}, ${site.image}): every database, table row count, sequence, object count, role and password hash is equal`, ...inventoryLines(after, before));
    lines.push(...await phase('logins', () => proveLogins(ctx, site, fresh)));
    await phase('stop-new', () => { stopServer(ctx, fresh); containers.splice(containers.indexOf(fresh), 1); });
    record.after = await phase('measure-old-after', () => measureVolume(ctx, site.image, site.oldVolume));
    const same = (['files', 'bytes', 'content', 'meta'] as const).every((key) => record.after?.[key] === record.before[key]);
    if (!same) throw new UpgradeStop('STACK_DB_UPGRADE_SOURCE_CHANGED', `${site.oldVolume} changed while it was upgraded: something wrote to it; do not switch`);
    lines.push(`  old ${site.oldVolume}: unchanged (files, bytes, content and metadata digests equal before and after)`);
    done = true;
    return lines;
  } catch (error) {
    if (error instanceof UpgradeStop) error.lines = lines;
    throw error;
  } finally {
    for (const name of containers) docker(ctx, ['rm', '-f', name]);
    for (const volume of [work, scratch]) docker(ctx, ['volume', 'rm', '-f', volume]);
    if (!done) {
      if (record.createdTarget) docker(ctx, ['volume', 'rm', '-f', site.newVolume]);
      else if (volumeExists(ctx, site.newVolume) && !volumeEmpty(ctx, site.image, site.newVolume)) helper(ctx, site.image, [`${site.newVolume}:/v`], 'find /v -mindepth 1 -delete');
    }
  }
}
