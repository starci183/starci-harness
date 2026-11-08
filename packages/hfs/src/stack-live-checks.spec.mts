// proves: STACK_PENDING_MIGRATIONS@lite
// proves: STACK_PENDING_MIGRATIONS@full
// proves: STACK_DEAD_LETTER_REPEAT@lite
// proves: STACK_DEAD_LETTER_REPEAT@full
// R393 and R394 (stack/local-live-checks.mts, PROJECT-STACKS-10): `starci app check --env local` reads the running dev stack. The migration files the dev database has
// not applied are an error naming the files and the command that applies them; a queue or job that dead-lettered more than once in the last 24 hours of the api log is an
// error naming the queue, the job and the last message. A stack that is not up, or a log that is not there, is not judged, and nothing is asked of a stack with no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stackContext } from '../stack/context.mjs';
import type { RunResult, Spawn } from '../stack/context.mjs';
import { loadLocalConfig } from '../stack/local-config.mjs';
import { logFile } from '../stack/local-state.mjs';
import { stateOf } from '../stack/local-run.mjs';
import { DEAD_LETTER_REPEAT, PENDING_MIGRATIONS, deadLetterRepeats, liveStateFindings } from '../stack/local-live-checks.mjs';

const BLOCK = `
      ports: {db: 54322, api: 3001}
      services: [{name: db, wait: healthy}]
      database:
        service: db
        port: db
        urlEnv: PRIMARY_DB_URL
        appRole: app_be
        password: {member: db, key: OWNER_PASSWORD}
        adminPassword: {member: db, key: ADMIN_PASSWORD}
        appPassword: {member: db, key: APP_PASSWORD}
      composeEnv: [{name: POSTGRES_PASSWORD, member: db, key: ADMIN_PASSWORD}]
      custody:
        - {member: db, key: ADMIN_PASSWORD, kind: password}
        - {member: db, key: OWNER_PASSWORD, kind: password}
        - {member: db, key: APP_PASSWORD, kind: password}
      processes:
        - {name: api, argv: [node, api.mjs], port: api}`;

const MIGRATIONS = ['20261110000000_init.sql', '20261111000000_orders.sql', '20261112002400_chat-message-agent-message.sql'];
const VERSIONS = MIGRATIONS.map((name) => name.split('_')[0] as string);
const NOW = Date.parse('2026-11-09T12:00:00.000Z');

/** An app with a dev environment, a migrations folder, and a private state base. */
function app(t: { after: (fn: () => void) => void }, { block = BLOCK, migrations = MIGRATIONS }: { block?: string; migrations?: string[] } = {}): { root: string; state: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-live-checks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ project: 'demo' }));
  fs.mkdirSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks', 'dev', 'infra', 'compose', 'compose.yaml'), 'services:\n  db:\n    image: postgres\n');
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n    components: {}\n    runbook: README.md\n    secrets: []\n    local:${block}\n`);
  fs.mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
  for (const name of migrations) fs.writeFileSync(path.join(root, 'db', 'migrations', name), 'select 1;\n');
  return { root, state: path.join(root, '.state') };
}

/** A docker double: `up` says whether the db container runs, `applied` is the recorded history (null: the history table does not exist). */
function context(root: string, state: string, { up = true, applied = [] as string[] | null }: { up?: boolean; applied?: string[] | null } = {}) {
  const calls: string[] = [];
  const spawn = ((command: string, args: readonly string[]): RunResult => {
    calls.push([command, ...args].join(' '));
    const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
    if (command !== 'docker') return ok();
    if (args[0] === 'compose' && args.includes('ps')) return ok(up ? 'cid1\n' : '');
    const script = args.join(' ');
    if (script.includes('POSTGRES_USER')) return ok('postgres\napp\n');
    if (script.includes('to_regclass')) return ok(JSON.stringify([{ present: applied !== null }]));
    if (script.includes('schema_migrations order by')) return ok(JSON.stringify((applied ?? []).map((version) => ({ version }))));
    return ok();
  }) as unknown as Spawn;
  return { calls, ctx: stackContext({ cwd: root, env: { STARCI_LOCAL_ROOT: state }, spawn, platform: 'linux', now: () => NOW }) };
}

test('migration files the dev database has not applied are an error naming the files and the command that applies them', async (t) => {
  const { root, state } = app(t);
  const { ctx } = context(root, state, { applied: VERSIONS.slice(0, 2) });
  const result = await liveStateFindings({ ctx, repoRoot: root });
  const pending = result.findings.filter((finding) => finding.code === PENDING_MIGRATIONS);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.level, 'error');
  assert.match(pending[0]?.message ?? '', /20261112002400_chat-message-agent-message\.sql/);
  assert.doesNotMatch(pending[0]?.message ?? '', /20261110000000_init\.sql/);
  assert.match(pending[0]?.message ?? '', /starci app stack up --env dev --execute/);
  assert.equal(pending[0]?.path, 'db/migrations/20261112002400_chat-message-agent-message.sql');
});

test('a database with every file applied is clean; an empty one has every file pending', async (t) => {
  const { root, state } = app(t);
  const all = context(root, state, { applied: VERSIONS });
  assert.deepEqual((await liveStateFindings({ ctx: all.ctx, repoRoot: root })).findings.filter((finding) => finding.code === PENDING_MIGRATIONS), []);
  const none = context(root, state, { applied: null });
  const found = (await liveStateFindings({ ctx: none.ctx, repoRoot: root })).findings.filter((finding) => finding.code === PENDING_MIGRATIONS);
  assert.equal(found.length, 1);
  assert.match(found[0]?.message ?? '', /has not applied 3 migration file\(s\)/);
});

test('a stack that is not up is not judged and says so in one line', async (t) => {
  const { root, state } = app(t);
  const { ctx, calls } = context(root, state, { up: false });
  const result = await liveStateFindings({ ctx, repoRoot: root });
  assert.deepEqual(result.findings, []);
  assert.ok(result.lines.some((text) => /pending-migrations not judged, the db service is not running/.test(text)));
  assert.ok(!calls.some((call) => call.includes('psql')), 'no query is sent to a database that is not running');
});

test('a dev environment with no database is never asked', async (t) => {
  const { root, state } = app(t, { block: '\n      ports: {api: 3001}\n      processes:\n        - {name: api, argv: [node, api.mjs], port: api}' });
  const { ctx, calls } = context(root, state);
  const result = await liveStateFindings({ ctx, repoRoot: root });
  assert.deepEqual(result.findings, []);
  assert.equal(calls.filter((call) => call.startsWith('docker')).length, 0);
});

const line = (event: string, fields: Record<string, unknown>, at: string): string => `${JSON.stringify({ level: 'error', event, time: at, ...fields })}\n`;
const sweep = (at: string, message = 'new row for relation "job_outbox" violates check constraint "job_outbox_dedupe_key_check"'): string => line('queue.delivery.dead-lettered', { queue: 'parked_jobs_sweep', job: 'parked-jobs.sweep', errorMessage: message, attempt: 4 }, at);

function writeLog(root: string, state: string, text: string): void {
  const { ctx } = context(root, state);
  const local = loadLocalConfig({ repoRoot: root, env: 'dev' });
  const file = logFile(stateOf(ctx, local), 'api');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('a queue and job that dead-lettered more than once in 24 hours is an error naming the queue, the job and the last error', async (t) => {
  const { root, state } = app(t);
  writeLog(root, state, [
    sweep('2026-11-09T11:00:00.000Z', 'an earlier message'),
    line('queue.delivery.failed', { queue: 'parked_jobs_sweep', job: 'parked-jobs.sweep', errorMessage: 'a retry, not a dead letter' }, '2026-11-09T11:10:00.000Z'),
    sweep('2026-11-09T11:30:00.000Z'),
    sweep('2026-11-09T11:45:00.000Z'),
    line('queue.delivery.dead-lettered', { queue: 'mail', job: 'welcome', errorMessage: 'once only' }, '2026-11-09T11:50:00.000Z'),
    sweep('2026-11-07T11:45:00.000Z', 'older than the window'),
    'not json but mentions dead-lettered\n',
  ].join(''));
  const { ctx } = context(root, state, { applied: VERSIONS });
  const result = await liveStateFindings({ ctx, repoRoot: root });
  const repeats = result.findings.filter((finding) => finding.code === DEAD_LETTER_REPEAT);
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0]?.level, 'error');
  assert.match(repeats[0]?.message ?? '', /queue parked_jobs_sweep, job parked-jobs\.sweep dead-lettered 3 times in the last 24 hours/);
  assert.match(repeats[0]?.message ?? '', /job_outbox_dedupe_key_check/);
  assert.doesNotMatch(repeats[0]?.message ?? '', /an earlier message|once only|older than the window/);
  assert.equal(repeats[0]?.path, 'state/stack/demo-dev/dev/logs/api.log');
});

test('the event bus dead letter is read by consumer and event, and a single dead letter is clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-live-log-'));
  try {
    const file = path.join(dir, 'api.log');
    const bus = (at: string, reason: string): string => line('event-bus.delivery.dead', { consumer: 'orders__billing', eventName: 'order.placed', msgId: 7, reason }, at);
    fs.writeFileSync(file, bus('2026-11-09T10:00:00.000Z', 'code') + bus('2026-11-09T10:05:00.000Z', 'config'));
    const found = deadLetterRepeats(file, NOW);
    assert.equal(found?.findings.length, 1);
    assert.match(found?.findings[0]?.message ?? '', /queue orders__billing, job order\.placed dead-lettered 2 times/);
    assert.match(found?.findings[0]?.message ?? '', /last error: config/);
    fs.writeFileSync(file, bus('2026-11-09T10:00:00.000Z', 'code'));
    assert.deepEqual(deadLetterRepeats(file, NOW)?.findings, []);
    assert.equal(deadLetterRepeats(path.join(dir, 'missing.log'), NOW), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a missing api log is not judged, and an unreadable migration folder is a warning, never silence', async (t) => {
  const { root, state } = app(t);
  const { ctx } = context(root, state, { applied: VERSIONS });
  const clean = await liveStateFindings({ ctx, repoRoot: root });
  assert.deepEqual(clean.findings, []);
  assert.ok(clean.lines.some((text) => /dead-letter-repeat not judged, no api log/.test(text)));
  fs.rmSync(path.join(root, 'db', 'migrations'), { recursive: true });
  const broken = await liveStateFindings({ ctx, repoRoot: root });
  assert.equal(broken.findings[0]?.code, PENDING_MIGRATIONS);
  assert.equal(broken.findings[0]?.level, 'warning');
});
