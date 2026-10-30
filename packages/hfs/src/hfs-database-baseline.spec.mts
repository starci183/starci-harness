// proves: DB_BASELINE_SHAPE@lite DB_BASELINE_SHAPE@full DB_ARCHIVE_MUTATED@lite DB_ARCHIVE_MUTATED@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { baselineMarkers, baselineSourceFindings, databaseBaselineFindings } from '../runtime/scripts/hfs/rules/database-baseline.mjs';
import { dbBaselineMain, dbSqlFiles } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import type { DbOperation, DbResult } from '../runtime/scripts/hfs/db-baseline-verb.mjs';
import { dbRestampMain } from '../runtime/scripts/hfs/db-restamp-verb.mjs';
import { dbPlanMain } from '../runtime/scripts/hfs/db-plan-verb.mjs';
import { a15Findings } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { databaseQueuesFindings } from '../runtime/scripts/hfs/rules/database-queues.mjs';

const made: string[] = [];
type Git = (args: string[]) => { ok: boolean; stdout: string };
type Answer = DbResult | Record<string, unknown> | ((args: string[]) => DbResult);
const migrations = 'db/migrations';
const archive = `${migrations}/archive`;
const first = '20260101000000';
const second = '20260102000000';
const replacement = '20260103000000';
const old = `${migrations}/${first}_start.sql`;
const retired = `${archive}/${first}_start.sql`;
const baseline = `${migrations}/${replacement}_baseline.sql`;
const marked = `-- starci:baseline ${first}\nselect 1;\n`;
/** A database port that only records its calls and answers nothing. */
const recordInto = (list: unknown[]) => (...args: [string, DbOperation]): undefined => { list.push(args); };
const noHistory: Git = () => ({ ok: false, stdout: '' });

test.after(() => {
  for (const dir of made) {
    assert.ok(path.basename(dir).startsWith('hfs-db-baseline-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(edition: string, contents: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-baseline-'));
  made.push(root);
  write(root, { 'hfs.json': JSON.stringify({ kind: 'app', edition }), ...contents });
  return root;
}

/** The legacy argument shape the assertions read, from one runDbPostgres operation (query, dump or a history repair). */
const legacyArgs = (op: DbOperation): string[] => (op.kind === 'query' ? ['db', 'query', op.sql] : op.kind === 'dump' ? ['db', 'dump'] : ['migration', 'repair', op.stamp, '--status', op.status]);

function write(root: string, contents: Record<string, string>) {
  for (const [file, text] of Object.entries(contents)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
}

function history(contents: Record<string, string>): Git {
  return (args: string[]) => {
    if (args[0] === 'merge-base') return { ok: true, stdout: 'base' };
    if (args[0] === 'ls-tree') return { ok: true, stdout: `${Object.keys(contents).join('\0')}\0` };
    const file = args[1]?.split(':./')[1] ?? '';
    return Object.hasOwn(contents, file) ? { ok: true, stdout: contents[file] as string } : { ok: false, stdout: '' };
  };
}

function judge(root: string, edition: string, contents: Record<string, string>, git: Git = noHistory, extra: Record<string, unknown> = {}) {
  return databaseBaselineFindings({ repoRoot: root, files: Object.keys(contents), all: Object.keys(contents), repo: { kind: 'app', edition }, isRoot: true, inScope: () => true, git, ...extra });
}

function io(root: string, result?: Answer) {
  const calls: string[][] = [];
  const out: string[] = [];
  const err: string[] = [];
  const committed = Object.fromEntries([...dbSqlFiles(root), ...dbSqlFiles(root, archive)].map((entry) => [entry.file, fs.readFileSync(path.join(root, entry.file), 'utf8')]));
  return { calls, out, err, ports: { cwd: root, git: history(committed), stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text), runPostgres: (cwd: string, op: DbOperation): DbResult => {
    const args = legacyArgs(op);
    assert.equal(cwd, root);
    calls.push(args);
    if (result !== undefined) return typeof result === 'function' ? result(args) : result as DbResult;
    if (args[1] !== 'query') return { status: 0, stdout: 'create table public.demo(id integer);\n' };
    const sql = args[2] as string;
    let rows: unknown[] = [];
    if (sql.includes('to_regclass')) rows = [{ migrations: true, cron: true, queues: true, vault: true }];
    else if (sql.includes('schema_migrations')) rows = Object.keys(committed).filter((file) => !file.includes('/archive/')).map((file) => ({ version: /\/(\d{14})_/.exec(file)![1] }));
    return { status: 0, stdout: JSON.stringify(rows) };
  } } };
}

const command = "select pgmq.send('events', '{}');";
const ownedStateSql = `select pgmq.create('events');\nselect cron.schedule('events-tick', '* * * * *', $job$${command}$job$);\n`;
function remoteInventory(root: string, overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    presence: [{ migrations: true, cron: true, queues: true, vault: true }],
    migrations: [{ version: first }],
    cron: [{ name: 'events-tick', schedule: '* * * * *', commandHash: createHash('sha256').update(command).digest('hex'), active: true }],
    queues: [{ name: 'events' }],
    vault: [{ name: 'webhook' }],
    ...overrides,
  };
  return io(root, (args: string[]) => {
    assert.equal(args[0], 'db');
    assert.equal(args[1], 'query');
    const sql = args[2] as string;
    assert.ok(/^select\s/i.test(sql));
    assert.equal(/(?:decrypted_secret|\bsecret\s+from|select\s+\*)/i.test(sql), false);
    const kind = sql.includes('to_regclass') ? 'presence' : Object.keys(state).find((key) => sql.includes(({ migrations: 'schema_migrations', cron: 'cron.job', queues: 'pgmq.meta', vault: 'vault.secrets' } as Record<string, string>)[key] ?? 'unmatched-inventory'));
    return { status: 0, stdout: JSON.stringify(state[kind as string]) };
  });
}

for (const edition of ['lite', 'full']) {
  test(`DB_BASELINE_SHAPE passing ${edition}: one valid header baseline and an intact archive`, () => {
    const contents = { [retired]: 'select 1;\n', [baseline]: marked };
    const root = fixture(edition, contents);
    assert.deepEqual(judge(root, edition, contents, history(contents)), []);
    assert.deepEqual(judge(fixture(edition, { [old]: 'select 1;' }), edition, { [old]: 'select 1;' }), []);
  });

  test(`DB_BASELINE_SHAPE ${edition}: an archived file with an impossible stamp is accepted, the active baseline stays strict`, () => {
    const impossible = `${archive}/20261006300000_x.sql`;
    const valid = { [retired]: 'select 1;', [impossible]: 'select 1;', [baseline]: marked };
    assert.deepEqual(judge(fixture(edition, valid), edition, valid, history(valid)), []);
    const impossibleBaseline = `${migrations}/20261006300000_baseline.sql`;
    const active = { [retired]: 'select 1;', [impossibleBaseline]: marked };
    assert.ok(judge(fixture(edition, active), edition, active).some((item) => item.code === 'DB_BASELINE_SHAPE' && item.path === impossibleBaseline));
    const misnamed = { [retired]: 'select 1;', [`${archive}/x_20261006300000.sql`]: 'select 1;', [baseline]: marked };
    assert.ok(judge(fixture(edition, misnamed), edition, misnamed).some((item) => item.code === 'DB_BASELINE_SHAPE'));
  });

  test(`DB_BASELINE_SHAPE violating ${edition}: missing, duplicate, mismatched and invalid baseline markers`, () => {
    for (const text of ['select 1;', `${marked}\n-- starci:baseline ${first}\n`, `-- starci:baseline ${second}\nselect 1;`, '-- starci:baseline 20261301000000\nselect 1;']) {
      // A marker after SQL is deliberately ignored, so duplicate headers are a separate case.
      const contents = { [retired]: 'select 1;', [baseline]: text };
      const findings = judge(fixture(edition, contents), edition, contents);
      const shouldFail = !text.startsWith(marked);
      assert.equal(findings.some((item) => item.code === 'DB_BASELINE_SHAPE'), shouldFail);
    }
    const duplicate = { [retired]: 'select 1;', [baseline]: `-- starci:baseline ${first}\n${marked}` };
    assert.ok(judge(fixture(edition, duplicate), edition, duplicate).some((item) => item.code === 'DB_BASELINE_SHAPE'));
    const invalidFile = { [`${archive}/notes.sql`]: 'select 1;', [baseline]: marked };
    assert.ok(judge(fixture(edition, invalidFile), edition, invalidFile).some((item) => item.code === 'DB_BASELINE_SHAPE'));
  });

  test(`DB_BASELINE_SHAPE ${edition}: backdated baseline needs the exact explicit restamp header`, () => {
    const backdated = `${migrations}/20251201000000_baseline.sql`;
    const contents = { [retired]: 'select 1;', [backdated]: marked };
    const root = fixture(edition, contents);
    assert.ok(judge(root, edition, contents).some((item) => item.code === 'DB_BASELINE_SHAPE'));
    contents[backdated] = `-- starci:restamp ${replacement} 20251201000000\n${marked}`;
    write(root, contents);
    assert.deepEqual(judge(root, edition, contents), []);
    contents[backdated] = `-- starci:restamp ${replacement} 20251202000000\n${marked}`;
    write(root, contents);
    assert.ok(judge(root, edition, contents).some((item) => item.code === 'DB_BASELINE_SHAPE'));
  });

  test(`DB_ARCHIVE_MUTATED passing ${edition}: an unchanged active chain moves with a new baseline`, () => {
    const contents = { [retired]: 'select 1;\n', [baseline]: marked };
    assert.deepEqual(judge(fixture(edition, contents), edition, contents, history({ [old]: 'select 1;\n' })), []);
  });

  test(`DB_ARCHIVE_MUTATED violating ${edition}: archive additions and active moves require the same-diff baseline`, () => {
    const contents = { [retired]: 'select 1;\n', [baseline]: marked };
    assert.ok(judge(fixture(edition, contents), edition, contents, history({})).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    const moved = { [retired]: 'select 1;\n' };
    assert.ok(judge(fixture(edition, moved), edition, moved, history({ [old]: 'select 1;\n' })).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    const edited = { [retired]: 'select 2;\n', [baseline]: marked };
    assert.ok(judge(fixture(edition, edited), edition, edited, history({ [old]: 'select 1;\n' })).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    // An already committed baseline cannot authorize a later move.
    assert.ok(judge(fixture(edition, contents), edition, contents, history({ [old]: 'select 1;\n', [baseline]: marked })).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
  });

  test(`DB_ARCHIVE_MUTATED ${edition}: committed archive content and paths are immutable`, () => {
    const prior = { [retired]: 'select 1;\n', [baseline]: marked };
    const changed = { [retired]: 'select 2;\n', [baseline]: marked };
    assert.ok(judge(fixture(edition, changed), edition, changed, history(prior)).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    const removed = { [baseline]: marked };
    assert.ok(judge(fixture(edition, removed), edition, removed, history(prior)).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    const normalized = { [retired]: 'select 1;\r\n', [baseline]: marked };
    assert.deepEqual(judge(fixture(edition, normalized), edition, normalized, history(prior)), []);
  });

  test(`app db baseline ${edition}: preview only dumps schema; --execute performs the explicit cutover`, () => {
    const root = fixture(edition, { [old]: 'select 1;\n' });
    const preview = io(root);
    assert.equal(dbBaselineMain(['--stamp', replacement], preview.ports), 0);
    assert.deepEqual(preview.calls.filter((args) => args[1] === 'dump'), [['db', 'dump']]);
    assert.ok(preview.calls.every((args) => ['query', 'dump'].includes(args[1] as string)));
    assert.ok(fs.existsSync(path.join(root, old)));
    assert.equal(fs.existsSync(path.join(root, baseline)), false);
    assert.ok(preview.out.join('').includes(`history reverted ${first}`));
    const apply = io(root);
    assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], apply.ports), 0);
    assert.equal(fs.existsSync(path.join(root, old)), false);
    assert.equal(fs.readFileSync(path.join(root, retired), 'utf8'), 'select 1;\n');
    assert.deepEqual(baselineMarkers(fs.readFileSync(path.join(root, baseline), 'utf8')), [first]);
    assert.deepEqual(apply.calls.slice(-3), [['db', 'dump'], ['migration', 'repair', first, '--status', 'reverted'], ['migration', 'repair', replacement, '--status', 'applied']]);
    const contents = { [retired]: 'select 1;\n', [baseline]: fs.readFileSync(path.join(root, baseline), 'utf8') };
    assert.deepEqual(judge(root, edition, contents, history({ [old]: 'select 1;\n' })), []);
  });

  test(`app db baseline ${edition}: a frozen archive of snake_case names, an impossible time and shared stamps previews; a future active stamp is no breach`, () => {
    const root = fixture(edition, {
      [`${archive}/20260929000000_nivo_prototype.sql`]: 'select 1;\n',
      [`${archive}/20261013100000_first_shared.sql`]: 'select 1;\n',
      [`${archive}/20261013100000_second-shared.sql`]: 'select 1;\n',
      [`${archive}/20261014300000_account-sessions-shell-be.sql`]: 'select 1;\n',
      [`${migrations}/20261020000000_baseline.sql`]: '-- starci:baseline 20261013100000\nselect 1;\n',
      [`${migrations}/20991231000000_future-step.sql`]: 'select 1;\n',
    });
    assert.deepEqual(dbSqlFiles(root, archive).map((entry) => entry.name), ['20260929000000_nivo_prototype.sql', '20261013100000_first_shared.sql', '20261013100000_second-shared.sql', '20261014300000_account-sessions-shell-be.sql']);
    const preview = io(root);
    assert.equal(dbBaselineMain(['--stamp', '20991231000600'], preview.ports), 0, preview.err.join(''));
    assert.ok(preview.out.join('').startsWith(`preview baseline ${migrations}/20991231000600_baseline.sql; archive 2 migrations`));
    assert.ok(fs.existsSync(path.join(root, `${migrations}/20991231000000_future-step.sql`)));
    assert.equal(fs.existsSync(path.join(root, `${migrations}/20991231000600_baseline.sql`)), false);
    const early = io(root);
    assert.equal(dbBaselineMain(['--stamp', '20991230000000'], early.ports), 2);
    assert.ok(early.err.join('').includes(`after the archive boundary 20991231000000 (${migrations}/20991231000000_future-step.sql)`));
  });

  test(`app db baseline ${edition}: every misnamed file is named with the rule it broke, before any database call`, () => {
    const root = fixture(edition, {
      [`${migrations}/20260101000000_Bad_Name.sql`]: 'select 1;',
      [`${migrations}/20260230000000_bad-time.sql`]: 'select 1;',
      [`${migrations}/20260301000000_fine.sql`]: 'select 1;',
    });
    const err: string[] = [];
    const calls: unknown[] = [];
    assert.equal(dbBaselineMain(['--stamp', replacement], { cwd: root, stdout: () => {}, stderr: (text: string) => err.push(text), runPostgres: recordInto(calls) }), 2);
    assert.equal(err.join(''), [
      'starci app db baseline: migration filenames break their chain rules:',
      `  ${migrations}/20260101000000_Bad_Name.sql: name is not <ts14>_<kebab>.sql (R213)`,
      `  ${migrations}/20260230000000_bad-time.sql: stamp 20260230000000 is no valid UTC time (R213)`,
    ].join('\n') + '\n');
    assert.deepEqual(calls, []);
    const unstamped = fixture(edition, { [old]: 'select 1;', [`${archive}/prototype.sql`]: 'select 1;' });
    assert.throws(() => dbSqlFiles(unstamped, archive), /db\/migrations\/archive\/prototype\.sql: an archived name starts with its 14-digit stamp/);
    const twice = fixture(edition, { [old]: 'select 1;', [retired]: 'select 1;' });
    const twiceErr: string[] = [];
    assert.equal(dbBaselineMain(['--stamp', replacement], { cwd: twice, stdout: () => {}, stderr: (text: string) => twiceErr.push(text), runPostgres: recordInto(calls) }), 2);
    assert.ok(twiceErr.join('').includes(`${old}: also archived as ${retired}; a migration is active or archived, never both (R257)`));
    assert.deepEqual(calls, []);
  });

  test(`app db baseline ${edition}: invalid cutovers and private CLI failures never mutate files`, () => {
    for (const argv of [['--stamp', first], ['--stamp', '20260230000000'], ['--execute', '--unknown'], ['--execute', '--execute']]) {
      const root = fixture(edition, { [old]: 'select 1;' });
      const ports = io(root);
      assert.equal(dbBaselineMain(argv, ports.ports), 2);
      assert.deepEqual(ports.calls, []);
      assert.ok(fs.existsSync(path.join(root, old)));
    }
    const root = fixture(edition, { [old]: 'select 1;' });
    const failed = io(root, { status: 1, stderr: 'PRIVATE_CLI_DIAGNOSTIC' });
    assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], failed.ports), 2);
    assert.equal(failed.out.join('').includes('PRIVATE_CLI_DIAGNOSTIC'), false);
    assert.equal(failed.err.join('').includes('PRIVATE_CLI_DIAGNOSTIC'), false);
    assert.ok(fs.existsSync(path.join(root, old)));
    assert.equal(fs.existsSync(path.join(root, baseline)), false);
  });

  test(`DB_ARCHIVE_MUTATED ${edition}: a baseline cutover refuses uncommitted, changed or missing source history`, () => {
    const root = fixture(edition, { [old]: 'select 1;' });
    assert.ok(baselineSourceFindings({ repoRoot: root, files: [old], git: history({}) }).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    assert.ok(baselineSourceFindings({ repoRoot: root, files: [old], git: history({ [old]: 'select 2;' }) }).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    assert.ok(baselineSourceFindings({ repoRoot: root, files: [old], git: history({ [old]: 'select 1;', [`${migrations}/${second}_removed.sql`]: 'select 2;' }) }).some((item) => item.code === 'DB_ARCHIVE_MUTATED'));
    const ports = io(root);
    assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], { ...ports.ports, git: history({}) }), 2);
    assert.deepEqual(ports.calls, []);
    assert.ok(fs.existsSync(path.join(root, old)));
  });

  test(`app db baseline ${edition}: remote version drift cannot discard an unapplied local migration`, () => {
    const root = fixture(edition, { [old]: 'create table public.pending(id integer);' });
    const ports = remoteInventory(root, { migrations: [], cron: [], queues: [], vault: [] });
    assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], ports.ports), 2);
    assert.ok(ports.calls.every((args) => args[1] === 'query'));
    assert.ok(fs.existsSync(path.join(root, old)));
    assert.equal(fs.existsSync(path.join(root, baseline)), false);
  });

  test(`app db baseline ${edition}: role, queues, grants and cron ownership survive the cutover and plan comparison`, () => {
    const tickCommand = 'select public.events_tick();';
    const role = 'create role app_be nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole;';
    const tickSql = "create function public.events_tick() returns void language sql as $$insert into public.queue (queue, payload, created_at) values ('sweep', '{}'::jsonb, now());$$;";
    const initialSql = `${role}\nselect pgmq.create('events');\nselect pgmq.create('events__dead');\ngrant select, insert on pgmq.q_events to app_be;\n${tickSql}\nselect cron.schedule('events-tick', '* * * * *', '${tickCommand}');\n`;
    // The pgmq queue is an event-bus topic queue with its dead-letter queue (ruling:lite-pgmq-bus-bullmq-jobs); the tick enqueues through the queue outbox.
    const deadQueues = [{ name: 'events' }, { name: 'events__dead' }];
    const topic = 'be/src/modules/platform/event-bus/event-bus.contracts.ts';
    const queue = 'be/src/modules/queues/sweep/sweep.queue.ts';
    const contents = { [old]: initialSql, [topic]: "export const EVENTS_TOPIC_QUEUE = 'events';\n", [queue]: "export const SWEEP_QUEUE = 'sweep';\n" };
    const root = fixture(edition, contents);
    const inventories = remoteInventory(root, { queues: deadQueues, cron: [{ name: 'events-tick', schedule: '* * * * *', commandHash: createHash('sha256').update(tickCommand).digest('hex'), active: true }], vault: [] });
    const query = inventories.ports.runPostgres;
    inventories.ports.runPostgres = (cwd, op) => op.kind === 'query' ? query(cwd, op) : { status: 0, stdout: op.kind === 'dump' ? tickSql : '' };
    assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], inventories.ports), 0, inventories.err.join(''));
    const sql = fs.readFileSync(path.join(root, baseline), 'utf8');
    const roleDeclaration = /create role "?app_be"?/i.exec(sql);
    assert.ok(roleDeclaration && roleDeclaration.index < sql.indexOf('create function public.events_tick'));
    assert.match(sql, /pgmq\.create\s*\(\s*'events'/);
    assert.match(sql, /grant\s+(?:select,\s*insert|insert,\s*select)\s+on\s+(?:table\s+)?"?pgmq"?\."?q_events"?\s+to\s+"?app_be"?/i);
    assert.match(sql, /cron\.schedule\s*\(\s*'events-tick'/);
    const all = [baseline, retired, topic, queue];
    assert.deepEqual(databaseQueuesFindings({ repoRoot: root, all, files: all, repo: { kind: 'app', edition }, inScope: () => true }), []);
    assert.deepEqual(judge(root, edition, { [baseline]: sql, [retired]: initialSql }, history({ [old]: initialSql })), []);
    const planned = remoteInventory(root, { migrations: [{ version: replacement }], queues: deadQueues, cron: [{ name: 'events-tick', schedule: '* * * * *', commandHash: createHash('sha256').update(tickCommand).digest('hex'), active: true }], vault: [] });
    assert.equal(dbPlanMain(['--json'], planned.ports), 0, planned.err.join(''));
  });

  test(`app db baseline ${edition}: excluded-schema changes and data migrations are refused before repair or archival`, () => {
    for (const initialSql of ['create policy objects_app_be_select on storage.objects for select to app_be using (bucket_id = \'demo\');', "insert into public.settings(name) values ('initial');"]) {
      const root = fixture(edition, { [old]: initialSql });
      const ports = io(root);
      assert.equal(dbBaselineMain(['--stamp', replacement, '--execute'], ports.ports), 2);
      assert.ok(ports.calls.every((args) => args[1] === 'query' || args[1] === 'dump'));
      assert.ok(ports.err.join('').includes(`baseline cannot rebuild the active chain from a schema-only dump:\n  ${old}: baseline cannot reconstruct`));
      assert.ok(fs.existsSync(path.join(root, old)));
      assert.equal(fs.existsSync(path.join(root, baseline)), false);
    }
  });

  test(`app db restamp ${edition}: explicit map previews repairs and --execute preserves SQL with a version header`, () => {
    const root = fixture(edition, { [old]: 'select 1;\n', 'restamp.yaml': `"${first}": "${second}"\n` });
    const preview = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml'], preview.ports), 0);
    assert.deepEqual(preview.calls, []);
    assert.equal(fs.readFileSync(path.join(root, old), 'utf8'), 'select 1;\n');
    const apply = io(root);
    assert.equal(dbRestampMain(['--map=restamp.yaml', '--execute'], apply.ports), 0);
    const renamed = `${migrations}/${second}_start.sql`;
    assert.equal(fs.existsSync(path.join(root, old)), false);
    assert.equal(fs.readFileSync(path.join(root, renamed), 'utf8'), `-- starci:restamp ${first} ${second}\nselect 1;\n`);
    assert.deepEqual(apply.calls, [['migration', 'repair', first, '--status', 'reverted'], ['migration', 'repair', second, '--status', 'applied']]);
  });

  test(`app db restamp ${edition}: partial maps, collisions, duplicate keys and archive sources are refused before effects`, () => {
    const next = `${migrations}/${second}_next.sql`;
    for (const map of [`"${first}": "${replacement}"`, `"${first}": "${second}"`, `"${first}": "20260230000000"`, `"${first}": "${replacement}"\n"${first}": "20260104000000"`, '"20200101000000": "20210101000000"', '[]']) {
      const root = fixture(edition, { [old]: 'select 1;', [next]: 'select 2;', 'restamp.yaml': map });
      const ports = io(root);
      assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], ports.ports), 2, map);
      assert.deepEqual(ports.calls, []);
      assert.ok(fs.existsSync(path.join(root, old)));
    }
    const root = fixture(edition, { [retired]: 'select 1;', [baseline]: marked, 'restamp.yaml': `"${first}": "${second}"` });
    const ports = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], ports.ports), 2);
    assert.deepEqual(ports.calls, []);
    assert.equal(dbRestampMain([], ports.ports), 2);
  });

  test(`app db restamp ${edition}: two migrations sharing a version restamp the named file to the next free version without a history repair`, () => {
    const keep = `${migrations}/${first}_alpha.sql`;
    const move = `${migrations}/${first}_beta.sql`;
    const later = `${migrations}/20260101000100_gamma.sql`;
    const files = { [keep]: 'select 1;\n', [move]: 'select 2;\n', [later]: 'select 3;\n' };
    const bare = fixture(edition, { ...files, 'restamp.yaml': `"${first}": "${second}"\n` });
    const refused = io(bare);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], refused.ports), 2);
    assert.match(refused.err.join(''), /alpha\.sql, .*beta\.sql/);
    assert.ok(fs.existsSync(path.join(bare, move)));
    const root = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  file: beta\n` });
    // the history names the file that stays (alpha) under the shared version: the file that moves never ran, so no repair
    const recorded = (name: string | null) => (_args: string[]) => ({ status: 0, stdout: JSON.stringify(name === null ? [] : [{ name }]) });
    const queryOnly = (calls: string[][]) => calls.every((args: string[]) => args[0] === 'db' && args[1] === 'query' && /^select name from supabase_migrations\.schema_migrations where version = '\d{14}'$/.test(args[2] as string));
    const preview = io(root, recorded('alpha'));
    assert.equal(dbRestampMain(['--map', 'restamp.yaml'], preview.ports), 0);
    assert.equal(queryOnly(preview.calls), true, 'the preview reads the history with one SELECT');
    assert.ok(fs.existsSync(path.join(root, move)));
    const apply = io(root, recorded('alpha'));
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], apply.ports), 0);
    const renamed = `${migrations}/20260101000001_beta.sql`;
    assert.equal(fs.readFileSync(path.join(root, renamed), 'utf8'), `-- starci:restamp ${first} 20260101000001\nselect 2;\n`);
    assert.equal(fs.readFileSync(path.join(root, keep), 'utf8'), 'select 1;\n');
    assert.equal(fs.existsSync(path.join(root, move)), false);
    assert.equal(queryOnly(apply.calls), true, 'no repair is issued for the unapplied file');
    // no history row: nothing ran, no repair either
    const empty = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  file: beta\n` });
    const none = io(empty, recorded(null));
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], none.ports), 0);
    assert.equal(queryOnly(none.calls), true);
    // the history names the file that moves: it is the applied one, so the old version is reverted and the new one marked applied
    const ran = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  file: beta\n` });
    const repaired = io(ran, (args: string[]) => (args[1] === 'query' ? recorded('beta')(args) : { status: 0, stdout: '' }));
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], repaired.ports), 0);
    assert.deepEqual(repaired.calls.slice(1), [['migration', 'repair', first, '--status', 'reverted'], ['migration', 'repair', '20260101000001', '--status', 'applied']]);
    // an unreadable history is never guessed
    const blind = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  file: beta\n` });
    const unreadable = io(blind, { status: 1, stdout: '' });
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], unreadable.ports), 2);
    assert.match(unreadable.err.join(''), /say which one ran/);
    assert.ok(fs.existsSync(path.join(blind, move)));
  });

  test(`app db restamp ${edition}: a shared version moves to an explicit target, repairs history only when the moved file was applied, and keeps the order`, () => {
    const keep = `${migrations}/${first}_alpha.sql`;
    const move = `${migrations}/${first}_beta.sql`;
    const files = { [keep]: 'select 1;\n', [move]: 'select 2;\n' };
    const root = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  file: ${first}_beta.sql\n  to: "${second}"\n  applied: true\n` });
    const apply = io(root);
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], apply.ports), 0);
    assert.deepEqual(apply.calls, [['migration', 'repair', first, '--status', 'reverted'], ['migration', 'repair', second, '--status', 'applied']]);
    for (const entry of [`file: gamma`, `file: beta\n  to: "${first}"`, `file: beta\n  applied: yes-please`, `file: beta\n  extra: 1`]) {
      const refusedRoot = fixture(edition, { ...files, 'restamp.yaml': `"${first}":\n  ${entry}\n` });
      const refused = io(refusedRoot);
      assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], refused.ports), 2, entry);
      assert.deepEqual(refused.calls, []);
      assert.ok(fs.existsSync(path.join(refusedRoot, move)));
    }
    const crowded = fixture(edition, { ...files, [`${migrations}/20260101000001_gamma.sql`]: 'select 3;\n', 'restamp.yaml': `"${first}":\n  file: beta\n  to: "20260101000001"\n` });
    assert.equal(dbRestampMain(['--map', 'restamp.yaml', '--execute'], io(crowded).ports), 2);
  });

  test(`app db migrate plan ${edition}: compares all four inventories using SELECT-only queries and emits counts`, () => {
    const contents = { [old]: ownedStateSql };
    const root = fixture(edition, contents);
    const ports = remoteInventory(root);
    assert.equal(dbPlanMain(['--json'], ports.ports), 0);
    const report = JSON.parse(ports.out.join(''));
    assert.equal(report.readOnly, true);
    assert.equal(report.drift, false);
    for (const key of ['migrations', 'cron', 'queues']) assert.deepEqual(report[key], { expected: 1, remote: 1, missing: 0, unexpected: 0, changed: 0 });
    assert.equal(ports.calls.length, 4);
    assert.equal(ports.out.join('').includes('WEBHOOK_TOKEN'), false);
    assert.equal(ports.out.join('').includes('events-tick'), false);
    for (const [file, text] of Object.entries(contents)) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text);
    const applied = remoteInventory(root);
    assert.equal(dbPlanMain(['--apply'], applied.ports), 2);
    assert.equal(applied.err.join(''), 'starci app db migrate: unknown or duplicate database option --apply\n');
    assert.equal(applied.calls.length, 0);
  });

  test(`app db migrate plan ${edition}: remote extra jobs, missing queues, cron changes and migration drift fail without exposing data`, () => {
    const root = fixture(edition, { [old]: ownedStateSql });
    const ports = remoteInventory(root, { migrations: [{ version: replacement }], queues: [], cron: [
      { name: 'events-tick', schedule: '0 * * * *', commandHash: createHash('sha256').update('PRIVATE_REMOTE_COMMAND').digest('hex'), active: true },
      { name: 'PRIVATE_REMOTE_JOB', schedule: '* * * * *', commandHash: createHash('sha256').update('PRIVATE_REMOTE_COMMAND').digest('hex'), active: true },
    ], vault: [{ name: 'PRIVATE_VAULT_NAME' }] });
    assert.equal(dbPlanMain(['--json'], ports.ports), 1);
    const report = JSON.parse(ports.out.join(''));
    assert.equal(report.migrations.missing, 1);
    assert.equal(report.migrations.unexpected, 1);
    assert.equal(report.queues.missing, 1);
    assert.equal(report.cron.changed, 1);
    assert.equal(report.cron.unexpected, 1);
    assert.equal(report.vault, undefined);
    assert.equal(ports.out.join('').includes('PRIVATE_'), false);
  });

  test(`app db migrate plan ${edition}: absent optional catalogs, archived SQL and inert function declarations are handled read-only`, () => {
    const contents = { [old]: "select 'pgmq.create(''inert'')';\ncreate function public.probe() returns void language sql as $$select pgmq.create('deferred')$$;", [retired]: ownedStateSql };
    const root = fixture(edition, contents);
    const ports = remoteInventory(root, { presence: [{ migrations: true, cron: false, queues: false, vault: false }], cron: [], queues: [], vault: [] });
    assert.equal(dbPlanMain([], ports.ports), 0);
    assert.equal(ports.calls.length, 2);
  });

  test(`app db migrate plan ${edition}: malformed inventory and private failures return a sanitized refusal`, () => {
    const root = fixture(edition, { [old]: 'select 1;' });
    for (const result of [{ status: 1, stderr: 'PRIVATE_CLI_DIAGNOSTIC' }, { status: 0, stdout: 'PRIVATE_DATABASE_OUTPUT' }, { status: 0, stdout: '{}' }]) {
      const ports = io(root, result);
      assert.equal(dbPlanMain([], ports.ports), 2);
      assert.equal(ports.out.join('').includes('PRIVATE_'), false);
      assert.equal(ports.err.join('').includes('PRIVATE_'), false);
    }
  });

  test(`app db migrate plan ${edition}: dynamic blocks refuse naming every EXECUTE by file and line, before querying the database`, () => {
    const later = `${migrations}/${second}_later.sql`;
    const root = fixture(edition, {
      [old]: "select 1;\n-- é widens the byte offsets past the character offsets\ndo $x$\nbegin\n  execute format('select %s', 1);\n  perform 1;\n  execute 'select 2';\nend\n$x$;\n",
      [later]: "do $$begin execute 'select 3'; end$$;\n",
    });
    const ports = io(root);
    assert.equal(dbPlanMain([], ports.ports), 2);
    assert.deepEqual(ports.calls, []);
    assert.equal(ports.err.join(''), [
      'starci app db migrate: dynamic migration blocks cannot prove database inventory:',
      `  ${old}:5: EXECUTE builds its SQL at run time`,
      `  ${old}:7: EXECUTE builds its SQL at run time`,
      `  ${later}:1: EXECUTE builds its SQL at run time`,
      '',
    ].join('\n'));
  });

  test(`app db baseline ${edition}: passes the plan's refusal through and names the inventories that drift`, () => {
    const refused = io(fixture(edition, { [old]: 'select 1;\n' }), { status: 0, stdout: '{"PRIVATE_DATABASE_OUTPUT": 1}' });
    assert.equal(dbBaselineMain(['--stamp', replacement], refused.ports), 2);
    assert.equal(refused.err.join(''), 'starci app db baseline: baseline requires a clean database plan with every migration already applied; the plan refused: the database returned an invalid inventory; database output was withheld\n');
    const drifted = remoteInventory(fixture(edition, { [old]: 'select 1;\n' }), { migrations: [{ version: first }, { version: second }], cron: [], queues: [], vault: [] });
    assert.equal(dbBaselineMain(['--stamp', replacement], drifted.ports), 2);
    assert.equal(drifted.err.join(''), 'starci app db baseline: baseline requires a clean database plan with every migration already applied; the plan found drift:\n  migrations: missing 0, unexpected 1, changed 0\n');
  });

  test(`app db migrate plan ${edition}: inert and conditional declarations refuse before querying the database`, () => {
    for (const sql of ["create view public.inert as select pgmq.create('events');", "explain select pgmq.create('events');", "select pgmq.create('events') where false;", "do $$begin if false then perform pgmq.create('events'); end if; end$$;"]) {
      const root = fixture(edition, { [old]: sql });
      const ports = io(root);
      assert.equal(dbPlanMain([], ports.ports), 2, sql);
      assert.deepEqual(ports.calls, []);
    }
  });

  test(`app db migrate plan ${edition}: unconditional migration DO declarations are inventoried safely`, () => {
    const sql = `do $$begin perform pgmq.create('events'); end$$;\nselect cron.schedule('events-tick', '* * * * *', $job$${command}$job$);`;
    const config = '[auth]\nlabel = """ignored""""\n[db.vault]\nwebhook = "env(WEBHOOK_TOKEN)"\n';
    const root = fixture(edition, { [old]: sql, 'supabase/config.toml': config });
    const ports = remoteInventory(root);
    assert.equal(dbPlanMain(['--json'], ports.ports), 0, ports.err.join(''));
    assert.equal(JSON.parse(ports.out.join('')).queues.expected, 1);
  });
}

test('DB_BASELINE_SHAPE markers cannot be impersonated by SQL literals or comments after a statement', () => {
  assert.deepEqual(baselineMarkers(`select '-- starci:baseline ${first}';\n-- starci:baseline ${first}`), []);
  assert.deepEqual(baselineMarkers(`/* -- starci:baseline ${first} */\nselect 1;`), []);
});

test('R257 participates in the synchronous alpha.15 finder and fast cross-file inventory', () => {
  const contents = { [retired]: 'select 1;', [baseline]: 'select 1;' };
  const root = fixture('lite', contents);
  const findings = a15Findings({ repoRoot: root, files: [baseline], all: Object.keys(contents), repo: { kind: 'app', edition: 'lite' }, isRoot: true, inScope: (file: string) => file === baseline, git: noHistory });
  assert.equal(typeof (findings as unknown as Promise<unknown>).then, 'undefined');
  assert.ok(findings.some((item) => item.code === 'DB_BASELINE_SHAPE'));
});

