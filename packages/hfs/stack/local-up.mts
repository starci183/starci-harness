// local-up.mts - `starci app stack up --env <dev env> [--execute]`: the one command that brings the whole dev environment up (PROJECT-STACKS-6).
// Order: the base port range against the machine's other projects (an overlap refuses before anything starts), host prerequisites, dev custody, setup (install, codegen), compose services and their health, the environment's own database role,
// migrations with a receipt, the migration runners (seed commands of mode always), the seed levels and the loader of the pinned seed-standards with their receipts, the other seed commands, native app processes, readiness, the dev tunnel routes (PROJECT-STACKS-15), origins. Idempotent: what runs is kept, what changed is converged.
// Native processes run built (their `serve` block: build, then the built artifact) unless `--watch` opts into their own watcher argv (local-run.mts ProcessMode).
// `compose up --build` rebuilds an image whose build inputs changed (the db image, the storage image with its statics/) and is a cached no-op otherwise.
// A dry run prints the plan. It never generates a replacement secret, never removes a volume and touches only its own compose project.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { firstLine } from './context.mjs';
import type { RunResult, StackContext } from './context.mjs';
import { dbTarget } from '../db/postgres.mjs';
import { loadDatabase } from '../db/migrate.mjs';
import { failure, refusal } from './errors.mjs';
import type { ActionResult } from './remote.mjs';
import { isAdvisoryRow, type LocalConfig } from './local-config.mjs';
import { missingKeys, missingStep, openCustody } from './local-custody.mjs';
import type { Custody } from './local-custody.mjs';
import { hostRefusal, preflight, runSetup } from './local-prepare.mjs';
import { DEFAULT_TIMEOUT_SECONDS, buildCommand, launchedCommand, modeOf, makeDataDirectories, commandDigest, processCommand, compose, composeValues, databaseUrl, ownedProcess, portHolder, probe, runCommand, runEnvironment, serviceReady, startProcess, stateOf, stopProcess, waitFor } from './local-run.mjs';
import type { LocalDeps, ProcessMode } from './local-run.mjs';
import type { LocalProcess } from '../runtime/scripts/hfs/stack-local-config.mjs';
import { launch } from './local-host.mjs';
import { baseOverlap, overlapLine, peersOf } from './local-peers.mjs';
import { readRecord, writeRecord } from './local-state.mjs';
import { SEED_RECEIPTS, seedStep } from './seeds.mjs';
import { planTunnel, routeTunnel } from './local-tunnel.mjs';

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

/** The route folder roots of a Next app, app-relative: `src/app` (the app template) or `app`. */
const ROUTE_ROOTS = ['src/app', 'app'];

/**
 * The digest of a Next app's route folder tree: the sorted relative paths of every folder under its route root (`(entry)/sign-in`), names only, no contents, so
 * reading it is one directory walk. null when the app has no route root.
 */
export function routeTreeDigest(appDir: string): string | null {
  const root = ROUTE_ROOTS.map((name) => path.join(appDir, name)).find((candidate) => fs.existsSync(candidate));
  if (root === undefined) return null;
  const folders: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
      folders.push(child);
      walk(path.join(dir, entry.name), child);
    }
  };
  walk(root, '');
  return crypto.createHash('sha256').update(folders.sort().join('\n')).digest('hex').slice(0, 16);
}

/**
 * Clears a front-end app's `.next` when its route folders moved since the last `up` (a renamed route group such as `(auth)` to `(entry)`): `next dev` keeps the
 * compiled routes of the old tree in `.next` and goes on serving the groups that no longer exist. The check is the recorded digest of each app's route folder tree
 * (routeTreeDigest), so an unchanged tree keeps its cache and its fast start; a tree with no digest yet (the first up that records one) clears it once, since an older
 * `.next` cannot be trusted either. While a process of the environment still runs, its `next dev` holds `.next`: nothing is cleared and nothing recorded, so the next
 * up after a `stack down` clears it.
 */
export async function clearMovedRoutes(ctx: StackContext, local: LocalConfig, deps: LocalDeps = {}): Promise<string[]> {
  const appsDir = path.join(local.repoRoot, 'fe', 'apps');
  let apps: string[] = [];
  try { apps = fs.readdirSync(appsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); } catch { return []; }
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const held = record.receipts.routes ?? {};
  const moved = apps.flatMap((app) => {
    const digest = routeTreeDigest(path.join(appsDir, app));
    return digest === null || held[`fe/apps/${app}`] === digest ? [] : [{ app, digest }];
  });
  if (moved.length === 0) return [];
  for (const [name, known] of Object.entries(record.processes)) {
    if ((await ownedProcess(ctx, known, deps)).ours) return [`routes: the route folders of ${moved.map(({ app }) => app).join(', ')} moved, .next kept while process ${name} runs; run stack down and up again to clear it`];
  }
  const lines: string[] = [];
  for (const { app, digest } of moved) {
    const cache = path.join(appsDir, app, '.next');
    const had = fs.existsSync(cache);
    if (had) fs.rmSync(cache, { recursive: true, force: true });
    held[`fe/apps/${app}`] = digest;
    if (had) lines.push(`routes: fe/apps/${app} route folders changed since the last up; cleared its .next`);
  }
  record.receipts.routes = held;
  writeRecord(dir, record);
  return lines;
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
  const report: string[] = [];
  const run = deps.migrate ?? (async (urlEnv: string, environment: NodeJS.ProcessEnv, cwd: string): Promise<number> => {
    const { main } = await import('../src/main.mjs');
    const keep = (text: string): void => { report.push(...String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)); };
    return main(['db', 'migrate', '--db-url-env', urlEnv, '--execute'], { cwd, env: environment, stdout: keep, stderr: keep }) as Promise<number>;
  });
  const code = await run('DATABASE_URL', env, local.repoRoot);
  if (code !== 0) {
    const coded = report.find((line) => /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u.test(line)) ?? report[0];
    throw failure('STACK_LOCAL_MIGRATE', `starci app db migrate exited ${code}${coded === undefined ? '' : `: ${coded.slice(0, 400).replaceAll(url, '[redacted]')}`}; run it with --db-url-env DATABASE_URL to read its full report`);
  }
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  record.receipts.migrate = { at: new Date(ctx.now()).toISOString(), digest: migrationsDigest(local.repoRoot) };
  writeRecord(dir, record);
  return `migrate: applied, receipt ${record.receipts.migrate.digest}${await appRolePassword(ctx, local, custody)}`;
}

/**
 * Adopts the started database when it holds a schema another tool built and no migration history (`starci app db adopt --execute --if-pending`, in this process): the schema compare
 * against bootstrap + baseline refuses on any difference and its report (the diff) is the refusal. A fresh empty database and an already migrated one adopt nothing. Runs only for an
 * app that declares `database.baseline`; `migrate` follows and refuses (DB_MIGRATE_NOT_ADOPTED) a database this step did not take.
 */
async function adopt(ctx: StackContext, local: LocalConfig, custody: Custody, deps: LocalDeps): Promise<string> {
  const database = local.database;
  const url = databaseUrl(local, custody);
  if (!database || url === null) return 'adopt: no database declared';
  let baseline: string | null = null;
  try { baseline = loadDatabase(local.repoRoot).baseline; } catch { baseline = null; }
  if (baseline === null) return 'adopt: no database.baseline declared';
  const container = firstLine((await compose(ctx, local, ['ps', '-q', database.service])).stdout);
  const env = { ...ctx.env, DATABASE_URL: url, STARCI_DB_CONTAINER: container };
  const report: string[] = [];
  const keep = (text: string): void => { report.push(...String(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)); };
  const run = deps.adopt ?? (async (urlEnv: string, environment: NodeJS.ProcessEnv, cwd: string, sink: string[]): Promise<number> => {
    const { main } = await import('../src/main.mjs');
    return main(['db', 'adopt', '--db-url-env', urlEnv, '--execute', '--if-pending'], { cwd, env: environment, stdout: (text: string) => { keep(text); sink.push(...report.splice(0)); }, stderr: (text: string) => { keep(text); sink.push(...report.splice(0)); } }) as Promise<number>;
  });
  const lines: string[] = [];
  const code = await run('DATABASE_URL', env, local.repoRoot, lines);
  const shown = lines.map((line) => line.replaceAll(url, '[redacted]'));
  if (code !== 0) throw failure('STACK_LOCAL_ADOPT', `the database holds a schema that is not the baseline's, nothing was changed and migrate did not run:\n${shown.slice(0, 40).map((line) => `  ${line}`).join('\n')}`);
  const adopted = shown.find((line) => /^adopted:/u.test(line));
  return adopted === undefined ? `adopt: ${shown.find((line) => /nothing to adopt|already recorded/u.test(line)) ?? 'nothing to adopt'}` : `adopt: ${adopted}`;
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
  return (await seedStep({ ctx, repoRoot: local.repoRoot, env: local.env, target, execute: true, command })).lines;
}

/**
 * The identity of the data a seed command wrote into: the names and creation times of the compose project's volumes. A receipt holds it,
 * so a seed command runs again on volumes created after its receipt (a wiped or new stack) instead of answering "already done" from a
 * state file that outlived the data.
 */
export function volumesIdentity(ctx: StackContext, local: LocalConfig): string {
  const lines = (text: unknown): string[] => String(text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).sort();
  const names = lines(ctx.spawn('docker', ['volume', 'ls', '--filter', `label=com.docker.compose.project=${local.project}`, '--format', '{{.Name}}']).stdout);
  if (names.length === 0) return 'none';
  const inspected = ctx.spawn('docker', ['volume', 'inspect', '--format', '{{.Name}} {{.CreatedAt}}', ...names]);
  return crypto.createHash('sha256').update(lines(inspected.stdout).join('\n')).digest('hex').slice(0, 16);
}

/**
 * Runs the seed commands: a `once` command once per volume set (a receipt keyed by the command's digest and the volumes' identity), the seed
 * owning its idempotence beyond that; an `always` command (a migration runner such as TypeORM's, idempotent by its own ledger) on every up,
 * so a new migration reaches an existing stack. `up` runs the `always` commands of `after: migrate` right after `db migrate`, before the
 * seed levels and the loader of the pinned seed-standards (whose doors write into the tables those runners create), and the `once` commands
 * after them.
 */
async function seed(ctx: StackContext, local: LocalConfig, custody: Custody, after: 'migrate' | 'ready', mode: 'once' | 'always' | 'any' = 'any'): Promise<string[]> {
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const out: string[] = [];
  const volumes = volumesIdentity(ctx, local);
  for (const run of local.seed.filter((item) => item.after === after && (mode === 'any' || (item.mode ?? 'once') === mode))) {
    const held = record.receipts.seed[run.name];
    if (run.mode !== 'always' && held?.digest === commandDigest(run) && held.volumes === volumes) { out.push(`seed ${run.name}: already done`); continue; }
    await runCommand(ctx, local, run, runEnvironment(ctx, local, run, custody, 'owner'));
    record.receipts.seed[run.name] = { at: new Date(ctx.now()).toISOString(), digest: commandDigest(run), volumes };
    writeRecord(dir, record);
    out.push(`seed ${run.name}: done${run.mode === 'always' ? ' (always)' : ''}`);
  }
  return out;
}

/**
 * Builds (serve mode, when the process declares a build) and starts one native process, recording its pid, port, command line and mode.
 * The build gets the process's own non-secret env (a Next build inlines its NEXT_PUBLIC_* values) and no custody file.
 */
export async function launchProcess(ctx: StackContext, local: LocalConfig, run: LocalProcess, custody: Custody, mode: ProcessMode, record: ReturnType<typeof readRecord>): Promise<string> {
  const build = buildCommand(run, mode);
  if (build !== null) await runCommand(ctx, local, build, runEnvironment(ctx, local, build, custody, null));
  const launched = launchedCommand(run, mode);
  const pid = startProcess(ctx, local, launched, runEnvironment(ctx, local, run, custody, 'app'));
  const actual = modeOf(run, mode);
  record.processes[run.name] = { pid, startedAt: new Date(ctx.now()).toISOString(), port: run.port === null ? null : (local.ports[run.port] ?? null), command: processCommand(ctx, local, launched), mode: actual };
  return `process ${run.name}: ${build === null ? '' : 'built, '}started (pid ${pid}, ${actual === 'serve' ? 'built artifact' : 'watch'})`;
}

/**
 * Starts each native process that is not already running: built and served by default, its watcher only with `--watch`. One copy of each process
 * runs per environment: a recorded tree that still runs its command with its port silent (a watcher whose server died) is stopped before the fresh
 * start, and a port some other process already listens on refuses STACK_LOCAL_SECOND_COPY, naming that process, instead of starting a second copy
 * beside it (each copy a watcher with its own crons and consumers).
 */
async function startProcesses(ctx: StackContext, local: LocalConfig, custody: Custody, deps: LocalDeps, mode: ProcessMode): Promise<string[]> {
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  const out: string[] = [];
  for (const run of local.processes) {
    const known = record.processes[run.name];
    if (known) {
      const owned = await ownedProcess(ctx, known, deps);
      if (owned.ours) { out.push(`process ${run.name}: running (pid ${known.pid})`); continue; }
      if (owned.silent === true) {
        stopProcess(ctx, known.pid, deps);
        out.push(`process ${run.name}: stopped its previous tree (pid ${known.pid}): ${owned.stale ?? 'its port is silent'}; starting fresh`);
      } else if (owned.stale !== null) {
        out.push(`process ${run.name}: discarded a stale record: ${owned.stale}; starting fresh`);
      }
    }
    const port = run.port === null ? null : (local.ports[run.port] ?? null);
    const holder = port === null ? null : (deps.portHolder ?? ((value: number) => portHolder(ctx, value)))(port);
    if (holder !== null) {
      throw failure('STACK_LOCAL_SECOND_COPY', `process ${run.name}: port ${port} already listens (pid ${holder.pid}${holder.command === null ? '' : `, ${holder.command.slice(0, 160)}`}), which this environment's record does not hold: a second copy is refused; stop that one (starci app stack down --env ${local.env} from the checkout that started it, or end pid ${holder.pid}) and run up again`);
    }
    out.push(await launchProcess(ctx, local, run, custody, mode, record));
    writeRecord(dir, record);
  }
  record.ports = { ...local.ports };
  writeRecord(dir, record);
  return out;
}

/** The plan lines of one process in `mode`: its build, then the command it runs. */
export const processPlan = (run: LocalProcess, mode: ProcessMode): string[] => {
  const build = buildCommand(run, mode);
  return [...(build === null ? [] : [`plan build ${run.name}: ${build.argv.join(' ')}`]), `plan process ${run.name} (${modeOf(run, mode)}): ${launchedCommand(run, mode).argv.join(' ')}`];
};

/** The plan a dry run prints. */
function plan(local: LocalConfig, missing: string[], mode: ProcessMode): string[] {
  return [
    `plan custody: ${missing.length ? `missing ${missing.join(', ')}: ${missingStep(local, missing)}` : 'open the sealed dev values into host-local files'}`,
    ...local.setup.map((run) => `plan setup ${run.name}: ${run.argv.join(' ')}`),
    `plan services: compose up -d --build ${local.services.map((service) => `${service.name} (wait ${service.wait})`).join(', ')} (a changed build input rebuilds, cached otherwise)`,
    ...(local.database ? [`plan database: own role ${local.database.role}, database ${local.database.name}, then starci app db migrate`, ...local.databases.map((database) => `plan database (connection ${database.connection}): own role ${database.role}, database ${database.name}`), `plan seed levels: .starcistacks/seeds, then .starcistacks/${local.env}/seeds, each entry once per content hash (receipts in ${SEED_RECEIPTS})`] : []),
    ...local.seed.map((run) => `plan seed ${run.name}: ${run.argv.join(' ')}`),
    ...local.processes.flatMap((run) => processPlan(run, mode)),
    ...local.ready.map((row) => `plan ready ${row.name}: ${row.url}`),
    ...planTunnel(local),
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

/**
 * Waits for each readiness row. The first failing row of the api, the web or a service stops `up` with STACK_LOCAL_READY; a failing gallery row (isAdvisoryRow)
 * is listed in `advisory` and the wait goes on, so the rest of the stack is reported and stays running while `up` still exits non-zero.
 */
export async function waitReady(ctx: StackContext, local: LocalConfig, deadline: number, advisory: string[]): Promise<string[]> {
  const lines: string[] = [];
  for (const row of local.ready) {
    const result = await waitFor(ctx, deadline, () => probe(ctx, local, row));
    lines.push(`${result.ok ? 'ok    ' : 'FAIL  '}ready ${result.detail}`);
    if (!result.ok && isAdvisoryRow(row.name)) { advisory.push(row.name); continue; }
    if (!result.ok) throw failure('STACK_LOCAL_READY', `${row.name} is not ready: ${result.detail}; read a process log with: starci app stack logs --env ${local.env} --service ${local.processes.map((run) => run.name).join('|')}`);
  }
  return lines;
}

/** `up` for a dev environment. */
/**
 * The environment `up` starts: every process but the on-demand ones (`onDemand`, the gallery) not named in `--with`, and no readiness row of a
 * gallery left out. The owner: one web and one backend server per app run on the dev stack; a gallery or a landing runs only when asked for.
 */
export const withOnDemand = (local: LocalConfig, names: readonly string[]): LocalConfig => {
  const wanted = new Set(names);
  const runs = local.processes.filter((run) => run.onDemand !== true || wanted.has(run.name));
  const galleries = runs.some((run) => isAdvisoryRow(run.name));
  return { ...local, processes: runs, ready: local.ready.filter((row) => galleries || !isAdvisoryRow(row.name)) };
};

export async function upLocal(ctx: StackContext, declared: LocalConfig, { execute = false, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, only, watch = false, with: withNames }: { execute?: boolean; timeoutSeconds?: number; only?: string | undefined; watch?: boolean; with?: string | undefined } = {}, deps: LocalDeps = {}): Promise<ActionResult> {
  const named = (withNames ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '');
  const unknown = named.filter((name) => !declared.processes.some((run) => run.name === name && run.onDemand === true));
  if (unknown.length > 0) throw refusal('STACK_USAGE', `--with names an on-demand process (${declared.processes.filter((run) => run.onDemand === true).map((run) => run.name).join(', ') || 'none declared'}), not ${unknown.join(', ')}`);
  const local = withOnDemand(declared, named);
  const mode: ProcessMode = watch ? 'watch' : 'serve';
  refuseTakenRange(ctx, local, deps);
  const host = await preflight(ctx, local, deps);
  if (!host.ok) return hostRefusal(host.lines);
  const missing = missingKeys(local);
  if (!execute) return { ok: missing.length === 0, lines: [...host.lines, ...plan(local, missing, mode), 'dry run: nothing was started; arm it with --execute'], data: { rows: host.rows } };
  if (only !== undefined && !local.services.some((service) => service.name === only)) throw refusal('STACK_USAGE', `--only names no service of ${local.env} (${local.services.map((service) => service.name).join(', ')})`);
  const lines = [...host.lines];
  const custody = openCustody(ctx, local);
  lines.push(`custody: ${custody.values.size} key file(s) in the host-local directory`);
  const advisory: string[] = [];
  lines.push(...await runSetup(ctx, local, custody, advisory));
  makeDataDirectories(ctx, local);
  const values = composeValues(local, custody);
  const deadline = ctx.now() + timeoutSeconds * 1000;
  const bring = async (names: string[]): Promise<void> => {
    if (names.length === 0) return;
    const started = await compose(ctx, local, ['up', '-d', '--build', ...names], { values, heavy: true, label: 'compose up' });
    if (started.status !== 0) throw failure('STACK_LOCAL_COMPOSE', `docker compose up failed: ${(started.stderr.trim().split(/\r?\n/u)[0] ?? '').slice(0, 200)}`);
    for (const name of names) {
      const ready = await serviceReady(ctx, local, name, deadline, deps);
      lines.push(`service ${ready.detail}`);
      if (!ready.ok) throw failure('STACK_LOCAL_SERVICE', `${name} did not become ready in ${timeoutSeconds}s (${ready.detail}); read it with: starci app stack logs --env ${local.env} --service ${name}`);
    }
  };
  const dbService = local.database?.service;
  if (only !== undefined) {
    // `--only <service>`: that service alone, ready; the database service also gets its own role and database, so it can be inspected. Nothing is adopted or migrated.
    await bring([only]);
    if (only === dbService) lines.push(await provisionDatabase(ctx, local, custody));
    lines.push(`only ${only}: started; nothing else ran (no adopt, no migrate, no process)`);
    return { ok: true, lines, data: { only } };
  }
  let provisioned = false;
  if (dbService !== undefined && local.services.some((service) => service.name === dbService)) {
    // The database service first, alone: a database restored from elsewhere is adopted before anything else starts, so no service and no migrate meets an unadopted schema.
    await bring([dbService]);
    lines.push(await provisionDatabase(ctx, local, custody), await adopt(ctx, local, custody, deps));
    provisioned = true;
    await bring(local.services.map((service) => service.name).filter((name) => name !== dbService));
  } else await bring(local.services.map((service) => service.name));
  lines.push(...(provisioned ? [] : [await provisionDatabase(ctx, local, custody)]), await migrate(ctx, local, custody, deps), ...await seed(ctx, local, custody, 'migrate', 'always'), ...await seedLevels(ctx, local, custody), ...await seed(ctx, local, custody, 'migrate', 'once'), ...await clearMovedRoutes(ctx, local, deps), ...await startProcesses(ctx, local, custody, deps, mode));
  lines.push(...await waitReady(ctx, local, deadline, advisory));
  lines.push(...await seed(ctx, local, custody, 'ready'));
  lines.push(...await routeTunnel(ctx, local));
  lines.push(...(local.tunnel?.routes ?? []).map((route) => `origin ${route.name} (public): https://${route.host}`));
  lines.push(...local.origins.map((origin) => `origin ${origin.name}: ${origin.url.replaceAll(/\$\{port\.([a-z][a-z0-9-]*)\}/gu, (_whole, name: string) => String(local.ports[name]))}`));
  if (advisory.length > 0) {
    lines.push(`FAIL  ${advisory.join(', ')}: the gallery did not come up; the api, the web and the other services are running (read it with: starci app stack logs --env ${local.env} --service gallery)`);
    return { ok: false, lines, data: { origins: local.origins, failed: advisory } };
  }
  return { ok: true, lines, data: { origins: local.origins } };
}
