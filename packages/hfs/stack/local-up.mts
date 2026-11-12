// local-up.mts - `starci app stack up --env <dev env> [--execute]`: the one command that brings the whole dev environment up (PROJECT-STACKS-6).
// Order: the base port range against the machine's other projects (an overlap refuses before anything starts), host prerequisites, dev custody, setup (install, codegen), compose services and their health, the environment's own database role,
// migrations with a receipt, the seed levels with their receipts, the seed commands, native app processes, readiness, origins. Idempotent: what runs is kept, what changed is converged.
// A dry run prints the plan. It never generates a replacement secret, never removes a volume and touches only its own compose project.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { firstLine } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { dbTarget } from '../db/postgres.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import type { LocalConfig } from './local-config.mjs';
import { missingKeys, missingStep, openCustody } from './local-custody.mjs';
import type { Custody } from './local-custody.mjs';
import { hostRefusal, preflight, runSetup } from './local-prepare.mjs';
import { DEFAULT_TIMEOUT_SECONDS, makeDataDirectories, commandDigest, compose, composeValues, databaseUrl, isAlive, probe, runCommand, runEnvironment, serviceReady, startProcess, stateOf, waitFor } from './local-run.mjs';
import type { LocalDeps } from './local-run.mjs';
import { launch } from './local-host.mjs';
import { baseOverlap, overlapLine, peersOf } from './local-peers.mjs';
import { readRecord, writeRecord } from './local-state.mjs';
import { SEED_RECEIPTS, seedStep } from './seeds.mjs';

const SAFE_PASSWORD = /^[A-Za-z0-9_-]{8,}$/u;

/** The digest of the migration folder (names and contents): what a migrate receipt records. */
export function migrationsDigest(repoRoot: string): string {
  const directory = path.join(repoRoot, 'db', 'migrations');
  const hash = crypto.createHash('sha256');
  let names: string[] = [];
  try { names = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort(); } catch { return 'none'; }
  for (const name of names) hash.update(name).update(fs.readFileSync(path.join(directory, name)));
  return hash.digest('hex').slice(0, 16);
}

/** Creates the environment's own login role and database if absent and sets its password (psql in the db container, SQL on stdin, never argv). */
async function provisionDatabase(ctx: StackContext, local: LocalConfig, custody: Custody): Promise<string> {
  if (!local.database) return 'database: none declared';
  const lines = [await provisionOne(ctx, local, custody, local.database)];
  for (const database of local.databases) lines.push(await provisionOne(ctx, local, custody, database));
  return lines.join('; ');
}

/** Creates one database and its own login role (the `database` block's, or a connection's of `databases`). */
async function provisionOne(ctx: StackContext, local: LocalConfig, custody: Custody, database: NonNullable<LocalConfig['database']>): Promise<string> {
  const password = custody.values.get(database.password.key) ?? '';
  if (!SAFE_PASSWORD.test(password)) throw refusal('STACK_LOCAL_DB_PASSWORD', `${database.password.key} must be at least 8 characters of letters, digits, dash and underscore (the generated password kind is); the owner replaces it with secret unset and secret init`);
  const sql = [
    `DO $do$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${database.role}') THEN CREATE ROLE "${database.role}" LOGIN SUPERUSER PASSWORD '${password}'; ELSE ALTER ROLE "${database.role}" LOGIN SUPERUSER PASSWORD '${password}'; END IF; END $do$;`,
    `SELECT 'CREATE DATABASE "${database.name}" OWNER "${database.role}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${database.name}')\\gexec`,
    '',
  ].join('\n');
  const result = await compose(ctx, local, ['exec', '-T', database.service, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', database.adminUser, '-d', 'postgres'], { values: composeValues(local, custody), input: sql });
  if (result.status !== 0) throw failure('STACK_LOCAL_DB_ROLE', `could not provision the role ${database.role}: ${(result.stderr.trim().split(/\r?\n/u)[0] ?? '').replaceAll(password, '[redacted]')}`);
  return `database: role ${database.role} and database ${database.name} ready on port ${local.ports[database.port]}${'connection' in database ? ` (connection ${String((database as { connection: string }).connection)})` : ''}`;
}

/** Gives the app role the migrations created its own password for this environment (cluster roles are never shared: the db container is this environment's alone). */
async function appRolePassword(ctx: StackContext, local: LocalConfig, custody: Custody): Promise<string> {
  const database = local.database;
  if (!database?.appRole || !database.appPassword) return '';
  const password = custody.values.get(database.appPassword.key) ?? '';
  if (!SAFE_PASSWORD.test(password)) throw refusal('STACK_LOCAL_DB_PASSWORD', `${database.appPassword.key} must be at least 8 characters of letters, digits, dash and underscore`);
  const sql = `DO $do$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${database.appRole}') THEN ALTER ROLE "${database.appRole}" LOGIN PASSWORD '${password}'; ELSE RAISE EXCEPTION 'role ${database.appRole} does not exist: the migrations create it'; END IF; END $do$;\n`;
  const result = await compose(ctx, local, ['exec', '-T', database.service, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', database.adminUser, '-d', database.name], { values: composeValues(local, custody), input: sql });
  if (result.status !== 0) throw failure('STACK_LOCAL_DB_ROLE', `could not set the password of ${database.appRole}: ${(result.stderr.trim().split(/\r?\n/u)[0] ?? '').replaceAll(password, '[redacted]')}`);
  return `, ${database.appRole} password set`;
}

/** Migrates through `starci app db migrate` in this process; the URL stays in the environment of that call. */
async function migrate(ctx: StackContext, local: LocalConfig, custody: Custody, deps: LocalDeps): Promise<string> {
  const database = local.database;
  const url = databaseUrl(local, custody);
  if (!database || url === null) return 'migrate: no database declared';
  const container = firstLine((await compose(ctx, local, ['ps', '-q', database.service])).stdout);
  const env = { ...ctx.env, DATABASE_URL: url, STARCI_DB_CONTAINER: container };
  const run = deps.migrate ?? (async (urlEnv: string, environment: NodeJS.ProcessEnv, cwd: string): Promise<number> => {
    const { main } = await import('../src/main.mjs');
    return main(['db', 'migrate', '--db-url-env', urlEnv, '--execute'], { cwd, env: environment, stdout: () => {}, stderr: () => {} }) as Promise<number>;
  });
  const code = await run('DATABASE_URL', env, local.repoRoot);
  if (code !== 0) throw failure('STACK_LOCAL_MIGRATE', `starci app db migrate exited ${code}; run it with --db-url-env DATABASE_URL to read its report`);
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  record.receipts.migrate = { at: new Date(ctx.now()).toISOString(), digest: migrationsDigest(local.repoRoot) };
  writeRecord(dir, record);
  return `migrate: applied, receipt ${record.receipts.migrate.digest}${await appRolePassword(ctx, local, custody)}`;
}

/**
 * Applies the seed levels (seeds.mts, PROJECT-STACKS-12) on the environment's database under its owner role, the role the migrations ran as: the
 * receipts in the database keep a rerun from applying anything that did not change. A document entry's app command runs from the app root in
 * the environment the app's api process gets (the first declared process: its env with the ports expanded, its custody files, the app
 * role's database URL; runEnvironment owns that), the documents on its stdin.
 */
async function seedLevels(ctx: StackContext, local: LocalConfig, custody: Custody): Promise<string[]> {
  const database = local.database;
  const url = databaseUrl(local, custody);
  if (!database || url === null) return [];
  const container = firstLine((await compose(ctx, local, ['ps', '-q', database.service])).stdout);
  const target = dbTarget({ ...ctx, env: { ...ctx.env, DATABASE_URL: url, STARCI_DB_CONTAINER: container } }, 'DATABASE_URL');
  const [api] = local.processes;
  const env = runEnvironment(ctx, local, api ?? { name: 'seed', argv: [], cwd: '.', heavy: 'none', skipIfExists: null, env: {}, files: [], after: 'migrate' }, custody, 'app');
  const command = (argv: readonly string[], input: string): RunResult => {
    const [program, args] = launch(ctx.platform, argv[0] ?? '', argv.slice(1));
    return ctx.spawn(program, args, { cwd: local.repoRoot, env, input });
  };
  return seedStep({ ctx, repoRoot: local.repoRoot, env: local.env, target, execute: true, command }).lines;
}

/** Runs the seed commands once each (a receipt keyed by the command's digest); the seed owns its idempotence beyond that. */
async function seed(ctx: StackContext, local: LocalConfig, custody: Custody, after: 'migrate' | 'ready'): Promise<string[]> {
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const out: string[] = [];
  for (const run of local.seed.filter((item) => item.after === after)) {
    if (record.receipts.seed[run.name]?.digest === commandDigest(run)) { out.push(`seed ${run.name}: already done`); continue; }
    await runCommand(ctx, local, run, runEnvironment(ctx, local, run, custody, 'owner'));
    record.receipts.seed[run.name] = { at: new Date(ctx.now()).toISOString(), digest: commandDigest(run) };
    writeRecord(dir, record);
    out.push(`seed ${run.name}: done`);
  }
  return out;
}

/** Starts each native process that is not already running. */
function startProcesses(ctx: StackContext, local: LocalConfig, custody: Custody, deps: LocalDeps): string[] {
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const out: string[] = [];
  const alive = deps.alive ?? isAlive;
  for (const run of local.processes) {
    const known = record.processes[run.name];
    if (known && alive(known.pid)) { out.push(`process ${run.name}: running (pid ${known.pid})`); continue; }
    const pid = startProcess(ctx, local, run, runEnvironment(ctx, local, run, custody, 'app'));
    record.processes[run.name] = { pid, startedAt: new Date(ctx.now()).toISOString(), port: run.port === null ? null : (local.ports[run.port] ?? null) };
    out.push(`process ${run.name}: started (pid ${pid})`);
  }
  record.ports = { ...local.ports };
  writeRecord(dir, record);
  return out;
}

/** The plan a dry run prints. */
function plan(local: LocalConfig, missing: string[]): string[] {
  return [
    `plan custody: ${missing.length ? `missing ${missing.join(', ')}: ${missingStep(local, missing)}` : 'open the sealed dev values into host-local files'}`,
    ...local.setup.map((run) => `plan setup ${run.name}: ${run.argv.join(' ')}`),
    `plan services: ${local.services.map((service) => `${service.name} (wait ${service.wait})`).join(', ')}`,
    ...(local.database ? [`plan database: own role ${local.database.role}, database ${local.database.name}, then starci app db migrate`, ...local.databases.map((database) => `plan database (connection ${database.connection}): own role ${database.role}, database ${database.name}`), `plan seed levels: .starcistacks/seeds, then .starcistacks/${local.env}/seeds, each entry once per content hash (receipts in ${SEED_RECEIPTS})`] : []),
    ...local.seed.map((run) => `plan seed ${run.name}: ${run.argv.join(' ')}`),
    ...local.processes.map((run) => `plan process ${run.name}: ${run.argv.join(' ')}`),
    ...local.ready.map((row) => `plan ready ${row.name}: ${row.url}`),
  ];
}

/** The refusal of `stack up` on a dev environment whose hundred another project of the machine owns (PROJECT-STACKS-10). */
export const BASE_PORT_TAKEN = 'STACK_LOCAL_BASE_PORT_TAKEN';

/**
 * Refuses, dry run and --execute alike, before anything starts, an environment whose base port range overlaps another registered project's: both
 * stacks would bind the same ports and the second up fails half way, or worse, serves the other project's process on a probe. Names the other
 * project and the next free base. An environment that declares no base is not judged here (R389 asks it for one).
 */
function refuseTakenRange(ctx: StackContext, local: LocalConfig, deps: LocalDeps): void {
  if (local.basePort === null) return;
  const overlap = baseOverlap(local.basePort, peersOf(ctx, local, deps.peers));
  if (overlap.clashes.length === 0) return;
  throw refusal(BASE_PORT_TAKEN, `${local.env}: ${overlapLine(overlap)}; nothing was started: ${overlap.fix as string} (starci app stack doctor --env ${local.env} shows the same row)`);
}

/** `up` for a dev environment. */
export async function upLocal(ctx: StackContext, local: LocalConfig, { execute = false, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }: { execute?: boolean; timeoutSeconds?: number } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  refuseTakenRange(ctx, local, deps);
  const host = await preflight(ctx, local, deps);
  if (!host.ok) return hostRefusal(host.lines);
  const missing = missingKeys(local);
  if (!execute) return { ok: missing.length === 0, lines: [...host.lines, ...plan(local, missing), 'dry run: nothing was started; arm it with --execute'], data: { rows: host.rows } };
  const lines = [...host.lines];
  const custody = openCustody(ctx, local);
  lines.push(`custody: ${custody.values.size} key file(s) in the host-local directory`);
  lines.push(...await runSetup(ctx, local, custody));
  makeDataDirectories(ctx, local);
  const values = composeValues(local, custody);
  const started = await compose(ctx, local, ['up', '-d', ...local.services.map((service) => service.name)], { values, heavy: true, label: 'compose up' });
  if (started.status !== 0) throw failure('STACK_LOCAL_COMPOSE', `docker compose up failed: ${(started.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 200)}`);
  const deadline = ctx.now() + timeoutSeconds * 1000;
  for (const service of local.services) {
    const ready = await serviceReady(ctx, local, service.name, deadline, deps);
    lines.push(`service ${ready.detail}`);
    if (!ready.ok) throw failure('STACK_LOCAL_SERVICE', `${service.name} did not become ready in ${timeoutSeconds}s (${ready.detail}); read it with: starci app stack logs --env ${local.env} --service ${service.name}`);
  }
  lines.push(await provisionDatabase(ctx, local, custody), await migrate(ctx, local, custody, deps), ...await seedLevels(ctx, local, custody), ...await seed(ctx, local, custody, 'migrate'), ...startProcesses(ctx, local, custody, deps));
  for (const row of local.ready) {
    const result = await waitFor(ctx, deadline, () => probe(ctx, local, row));
    lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}ready ${result.detail}`);
    if (!result.ok) throw failure('STACK_LOCAL_READY', `${row.name} is not ready: ${result.detail}; read a process log with: starci app stack logs --env ${local.env} --service ${local.processes.map((run) => run.name).join('|')}`);
  }
  lines.push(...await seed(ctx, local, custody, 'ready'));
  lines.push(...local.origins.map((origin) => `origin ${origin.name}: ${origin.url.replaceAll(/\$\{port\.([a-z][a-z0-9-]*)\}/gu, (_whole, name: string) => String(local.ports[name]))}`));
  return { ok: true, lines, data: { origins: local.origins } };
}
