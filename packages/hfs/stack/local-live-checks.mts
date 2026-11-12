// local-live-checks.mts - the checks of `starci app check --env local` that read the LIVE state of the dev environment and of the machine instead of
// the tree (contexts/project/stacks.md PROJECT-STACKS-10, PROJECT-STACKS-11), so a green check means the running dev stack is sound, not only that its files are:
//   base-port-overlap    STACK_BASE_PORT_OVERLAP     the hundred of a dev environment's local.basePort overlaps another project the machine registries enrol
//                                                    (stack/local-peers.mts, the doctor's `port range` row); a warning, report-only: the tree may be lawful
//                                                    and either project may move, CI has no machine registry to compare (`--env prod` never asks), and the
//                                                    command that would collide, `starci app stack up`, refuses it (STACK_LOCAL_BASE_PORT_TAKEN);
//   pending-migrations   STACK_PENDING_MIGRATIONS    the migration files the repository holds that the dev database has not applied (the plan `starci app db migrate`
//                                                    would run, read from supabase_migrations.schema_migrations); error, naming the files and the command that applies them;
//   dead-letter-repeat   STACK_DEAD_LETTER_REPEAT    a queue or job that dead-lettered more than once in the last 24 hours of the api log of the environment
//                                                    (<state base>/stack/<project>/<env>/logs/api.log); error, naming the queue, the job and the last error message.
// All are read-only and never cached (a cache of live state is a lie). A stack that is not up is not judged: there is nothing live to read, and the check says so in one line.
// The database is reached the way the deploy reaches its own: `docker exec` in the db container with the credentials the container holds (no custody is opened, no value is read).
import fs from 'node:fs';
import path from 'node:path';
import { buildModel, loadDatabase, planMigration } from '../db/migrate.mjs';
import { historyVersions, ownContainerTarget } from '../db/postgres.mjs';
import { STACKS_DIR, STACKS_FILE, readYaml } from './config.mjs';
import type { StackContext } from './context.mjs';
import { firstLine } from './context.mjs';
import { isLocalEnvironment, loadLocalConfig } from './local-config.mjs';
import type { LocalConfig } from './local-config.mjs';
import { baseOverlap, overlapLine, peersOf } from './local-peers.mjs';
import type { PeerBase } from './local-peers.mjs';
import { compose, stateOf } from './local-run.mjs';
import { logFile } from './local-state.mjs';

export const PENDING_MIGRATIONS = 'STACK_PENDING_MIGRATIONS';
export const DEAD_LETTER_REPEAT = 'STACK_DEAD_LETTER_REPEAT';
export const BASE_PORT_OVERLAP = 'STACK_BASE_PORT_OVERLAP';
/** The codes this module reports, for the failure-code catalog of `app check`. */
export const LIVE_CODES = Object.freeze([BASE_PORT_OVERLAP, PENDING_MIGRATIONS, DEAD_LETTER_REPEAT]);

/** The window the dead-letter check looks back over, and the most of the log it reads (the tail; a bigger log is judged by its last bytes). */
export const DEAD_LETTER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LOG_TAIL_BYTES = 64 * 1024 * 1024;
/** The longest error message a finding carries. */
const MESSAGE_LIMIT = 300;

/** A finding of the live checks, in the shape `app check` merges. */
export interface LiveFinding { code: string; level: 'error' | 'warning'; path: string; message: string }
/** What the live checks answer: the findings and one line per check that ran or was skipped. */
export interface LiveResult { findings: LiveFinding[]; lines: string[] }

/** The docker-compose environments of the app that declare a database, by name. */
export function liveEnvironments(repoRoot: string): string[] {
  let declaration: { environments?: Record<string, { runtime?: unknown }> } | undefined;
  try { declaration = readYaml(path.join(repoRoot, STACKS_DIR, STACKS_FILE), STACKS_FILE); } catch { return []; }
  return Object.keys(declaration?.environments ?? {}).filter((env) => isLocalEnvironment(repoRoot, env));
}

/** The running container of the database service, or null when the stack is not up. */
async function databaseContainer(ctx: StackContext, local: LocalConfig): Promise<string | null> {
  if (!local.database) return null;
  try {
    const run = await compose(ctx, local, ['ps', '-q', local.database.service]);
    const id = run.status === 0 ? firstLine(run.stdout) : '';
    return id === '' ? null : id;
  } catch { return null; }
}

/** The migration files the dev database has not applied, as `starci app db migrate` would run them; null when the stack is not up (nothing live to read). */
export async function pendingMigrations(ctx: StackContext, local: LocalConfig): Promise<{ files: string[]; directory: string } | null> {
  const database = local.database;
  if (!database) return null;
  const container = await databaseContainer(ctx, local);
  if (container === null) return null;
  const decl = loadDatabase(local.repoRoot);
  const model = buildModel(local.repoRoot, decl);
  const own = ownContainerTarget(ctx, container);
  const url = new URL(own.url);
  url.pathname = `/${database.name}`;
  const applied = historyVersions(ctx, { ...own, url: url.toString() });
  const plan = planMigration(model, applied);
  const files = plan.push.map((version) => model.files.find((file) => file.startsWith(`${version}_`)) ?? version);
  return { files, directory: decl.migrationsDir };
}

/** The finding for the pending files of one environment, or none. */
function pendingFinding(local: LocalConfig, pending: { files: string[]; directory: string }): LiveFinding[] {
  if (pending.files.length === 0) return [];
  const shown = pending.files.length > 8 ? `${pending.files.slice(0, 8).join(', ')} and ${String(pending.files.length - 8)} more` : pending.files.join(', ');
  return [{
    code: PENDING_MIGRATIONS, level: 'error', path: `${pending.directory}/${pending.files[0] as string}`,
    message: `the dev database of ${local.env} (${local.database?.name ?? 'db'}) has not applied ${String(pending.files.length)} migration file(s) the repository holds: ${shown}; a code path that needs them fails at run time with a check or relation error. Apply them with \`starci app stack up --env ${local.env} --execute\` (it runs \`starci app db migrate\` on this database and records the receipt)`,
  }];
}

/** One dead-lettered delivery read from the log. */
interface Delivery { key: string; queue: string; job: string; at: number; message: string }

/** The dead-letter line of a log record, or null: the queue runner's `queue.delivery.dead-lettered` (queue, job, errorMessage) and the event bus's `event-bus.delivery.dead` (consumer, event, reason). */
function deliveryOf(line: string): Delivery | null {
  if (!line.includes('dead')) return null;
  let record: Record<string, unknown>;
  try { record = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
  const at = Date.parse(String(record.time ?? ''));
  if (Number.isNaN(at)) return null;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  if (record.event === 'queue.delivery.dead-lettered') {
    const queue = text(record.queue) || '(unnamed queue)';
    const job = text(record.job) || text(record.jobName);
    return { key: `${queue}\u0000${job}`, queue, job, at, message: text(record.errorMessage) || text(record.reason) };
  }
  if (record.event === 'event-bus.delivery.dead') {
    const queue = text(record.consumer) || '(unnamed consumer)';
    const job = text(record.eventName) || text(record.domainEvent);
    return { key: `${queue}\u0000${job}`, queue, job, at, message: text(record.reason) };
  }
  return null;
}

/** The last bytes of a log as text, whole lines only. */
function logTail(file: string): string | null {
  let descriptor: number;
  try { descriptor = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return size > length ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { fs.closeSync(descriptor); }
}

/** Findings for every queue/job that dead-lettered more than once within `windowMs` before `now`, read from `file`; null when there is no log. */
export function deadLetterRepeats(file: string, now: number, windowMs: number = DEAD_LETTER_WINDOW_MS): { findings: Omit<LiveFinding, 'path'>[]; read: number } | null {
  const text = logTail(file);
  if (text === null) return null;
  const groups = new Map<string, { delivery: Delivery; count: number }>();
  let read = 0;
  for (const line of text.split('\n')) {
    const delivery = deliveryOf(line);
    if (delivery === null || delivery.at < now - windowMs || delivery.at > now + 60_000) continue;
    read += 1;
    const group = groups.get(delivery.key);
    if (!group) groups.set(delivery.key, { delivery, count: 1 });
    else { group.count += 1; if (delivery.at >= group.delivery.at) group.delivery = delivery; }
  }
  const findings = [...groups.values()].filter((group) => group.count > 1).sort((a, b) => b.count - a.count).map(({ delivery, count }) => ({
    code: DEAD_LETTER_REPEAT, level: 'error' as const,
    message: `queue ${delivery.queue}${delivery.job === '' ? '' : `, job ${delivery.job}`} dead-lettered ${String(count)} times in the last 24 hours (last at ${new Date(delivery.at).toISOString()}); last error: ${delivery.message.slice(0, MESSAGE_LIMIT) || '(no message)'}. A job that dead-letters again and again is a defect nothing retries away: read the log, fix the cause, then resume or requeue it (BE-RESILIENCE-2)`,
  }));
  return { findings, read };
}

/** The dead-letter finding(s) of one environment, with the path of its log. */
function deadLetterFindings(ctx: StackContext, local: LocalConfig, now: number): { findings: LiveFinding[]; line: string } {
  const file = logFile(stateOf(ctx, local), 'api');
  const display = `state/stack/${local.project}/${local.env}/logs/api.log`;
  const repeats = deadLetterRepeats(file, now);
  if (repeats === null) return { findings: [], line: `  live ${local.env}: dead-letter-repeat not judged, no api log at ${display}` };
  const findings = repeats.findings.map((finding) => ({ ...finding, path: display }));
  return { findings, line: `  live ${local.env}: dead-letter-repeat ${findings.length === 0 ? 'clean' : `${String(findings.length)} queue(s) repeat`} (${String(repeats.read)} dead letter(s) in the last 24 hours of ${display})` };
}

/** The base port overlap of one environment with the machine's other projects: a report-only warning naming them and the next free base, or none. */
export function baseOverlapFindings(ctx: Pick<StackContext, 'env'>, local: LocalConfig, peers?: () => PeerBase[]): { findings: LiveFinding[]; line: string } | null {
  if (local.basePort === null) return null;
  const overlap = baseOverlap(local.basePort, peersOf(ctx, local, peers));
  const line = `  machine ${local.env}: base-port-overlap ${overlap.clashes.length === 0 ? 'none' : `${String(overlap.clashes.length)} project(s)`} (${overlapLine(overlap)})`;
  if (overlap.clashes.length === 0) return { findings: [], line };
  return {
    line,
    findings: [{
      code: BASE_PORT_OVERLAP, level: 'warning', path: `${STACKS_DIR}/${STACKS_FILE}`,
      message: `environments.${local.env}.local.basePort: ${overlapLine(overlap)}; ${overlap.fix as string}. Report-only: starci app stack up --env ${local.env} refuses to start on it (STACK_LOCAL_BASE_PORT_TAKEN)`,
    }],
  };
}

/** The live checks over every dev environment of the app: the base port overlap of each, then, where it declares a database, its pending migrations and dead letters; a stack that is not up is reported in one line, never as a finding. */
export async function liveStateFindings({ ctx, repoRoot, peers }: { ctx: StackContext; repoRoot: string; peers?: () => PeerBase[] }): Promise<LiveResult> {
  const result: LiveResult = { findings: [], lines: [] };
  for (const env of liveEnvironments(repoRoot)) {
    let local: LocalConfig;
    try { local = loadLocalConfig({ repoRoot, env }); } catch { continue; }
    const overlap = baseOverlapFindings(ctx, local, peers);
    if (overlap !== null) { result.findings.push(...overlap.findings); result.lines.push(overlap.line); }
    if (!local.database) continue;
    try {
      const pending = await pendingMigrations(ctx, local);
      if (pending === null) result.lines.push(`  live ${env}: pending-migrations not judged, the ${local.database.service} service is not running (starci app stack up --env ${env} --execute)`);
      else {
        result.findings.push(...pendingFinding(local, pending));
        result.lines.push(`  live ${env}: pending-migrations ${pending.files.length === 0 ? 'none pending' : `${String(pending.files.length)} pending`}`);
      }
    } catch (error) {
      result.findings.push({ code: PENDING_MIGRATIONS, level: 'warning', path: STACKS_DIR, message: `the dev database of ${env} could not be compared with the migration files: ${firstLine((error as Error).message)}` });
      result.lines.push(`  live ${env}: pending-migrations could not read the database`);
    }
    const dead = deadLetterFindings(ctx, local, ctx.now());
    result.findings.push(...dead.findings);
    result.lines.push(dead.line);
  }
  return result;
}
