// proves: DB_PGMQ_DECLARED@lite DB_PGMQ_DECLARED@full DB_CRON_OWNED@lite DB_CRON_OWNED@full
// ruling:R212/case-10: the queue is BullMQ on Redis, so a queue constant has no pgmq queue, every pgmq queue left is an event-bus topic
// queue named by a *_TOPIC_QUEUE constant under platform/event-bus, and a live pg_cron job enqueues only through the queue outbox table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseQueueDeclarations, databaseQueuesFindings } from '../runtime/scripts/hfs/rules/database-queues.mjs';
import { a15Findings, FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { ruleParamsProblems } from '../runtime/scripts/hfs/rule-params-shape.mjs';

const MIGRATION = 'supabase/migrations/20261014010000_queues.sql';
const NEXT = 'supabase/migrations/20261014020000_ticks.sql';
const QUEUE = 'be/src/modules/queues/receipts/receipts.queue.ts';
const CREATE = "select pgmq.create('receipts');";
const DROP = "select pgmq.drop_queue('receipts');";
const CONSTANT = "export const RECEIPTS_QUEUE = 'receipts' as const;";
const TOPIC = 'billing__receipt_paid__mailer';
const TOPIC_FILE = 'be/src/modules/platform/event-bus/event-bus.contracts.ts';
const TOPIC_CONSTANT = `export const RECEIPT_PAID_MAILER_TOPIC_QUEUE = '${TOPIC}' as const;`;
const CREATE_TOPIC = `select pgmq.create('${TOPIC}');`;
const topicMigration = (sql) => ({ [TOPIC_FILE]: TOPIC_CONSTANT, [MIGRATION]: `${CREATE_TOPIC}\n${sql}` });
const codes = (findings) => [...new Set(findings.map((finding) => finding.code))].sort();
const ENQUEUE = "insert into public.queue (queue, payload, created_at) values ('receipts', '{}'::jsonb, now())";
const SEND = "select pgmq.send('receipts', '{}'::jsonb)";
const SCHEDULE = `select cron.schedule('receipt-tick', '* * * * *', $$${ENQUEUE}$$);`;
const LEGACY_SCHEDULE = `select cron.schedule('receipt-tick', '* * * * *', $$${SEND}$$);`;
const TICK = `create function private.receipt_tick() returns void language sql as $$${ENQUEUE}$$;`;
const LEGACY_TICK = `create function private.receipt_tick() returns bigint language sql as $$${SEND}$$;`;
const CALL_TICK = "select cron.schedule('receipt-tick', '* * * * *', $$select private.receipt_tick()$$);";

function fixture(t, edition, contents, supabase = {}, be = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-queues-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const repo = { hfs: 3, kind: 'app', project: 'queues', edition, supabase, sides: { be: { apps: [{ name: 'api', kind: 'api' }], ...be } } };
  const files = { 'hfs.json': JSON.stringify(repo), ...contents };
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repoRoot, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { repoRoot, repo, files: Object.keys(files), all: Object.keys(files), inScope: () => true };
}

function judge(t, edition, contents, supabase, be) {
  const findings = databaseQueuesFindings(fixture(t, edition, contents, supabase, be));
  assert.equal(Array.isArray(findings), true, 'the finder is synchronous');
  assert.ok(findings.every((finding) => finding.level === 'error' && finding.path && finding.message));
  return findings;
}

function expectCode(t, edition, contents, code, supabase, be) {
  const findings = judge(t, edition, contents, supabase, be);
  assert.ok(findings.some((finding) => finding.code === code), `${code}: ${JSON.stringify(findings)}`);
  return findings;
}

const pgmqFailures = [
  ['a pgmq queue left for a queue constant', { [QUEUE]: CONSTANT, [MIGRATION]: CREATE }],
  ['a quoted named-argument pgmq queue for a queue constant', { [QUEUE]: CONSTANT, [MIGRATION]: `select "pgmq"."create"(queue_name => 'receipts'::text);` }],
  ['a queue constant recreated after its drop', { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\n${DROP}`, [NEXT]: CREATE }],
  ['dynamic queue constant', { [QUEUE]: "export const RECEIPTS_QUEUE = queueName();" }],
  ['dynamic pgmq.create name', { [MIGRATION]: "select pgmq.create(current_setting('queue.name'));" }],
  ['pgmq.create in application SQL', { 'be/src/modules/platform/queue/persistence/queue.sql.ts': "export const createQueue = sql`select pgmq.create('receipts')`;" }],
  ['pgmq.create in a seed', { 'supabase/seed.sql': CREATE }],
  ['deferred SQL function queue creation', { [MIGRATION]: "create function private.install_queue() returns void language sql as $$select pgmq.create('receipts')$$;" }],
  ['deferred PLpgSQL function queue creation', { [MIGRATION]: "create function private.install_queue() returns void language plpgsql as $$begin perform pgmq.create('receipts'); end$$;" }],
  ['deferred SQL-standard function queue creation', { [MIGRATION]: "create function private.install_queue() returns void language sql return pgmq.create('receipts');" }],
  ['dynamic SQL cannot own a queue', { [MIGRATION]: "do $$begin execute 'select pgmq.create(''receipts'')'; end$$;" }],
  ['formatted SQL cannot own a queue', { [MIGRATION]: `${CREATE}\ndo $$begin execute format('select pgmq.create(%L)', 'receipts'); end$$;` }],
  ['a pgmq queue with no event-bus owner', { [MIGRATION]: "select pgmq.create('jobs');" }],
  ['a renamed queue constant left in pgmq', { [QUEUE]: CONSTANT, [MIGRATION]: "select pgmq.create('receipts_v2');" }],
  ['a topic queue constant outside platform/event-bus owns nothing', { 'be/src/modules/platform/queue/queue.contracts.ts': TOPIC_CONSTANT, [MIGRATION]: CREATE_TOPIC }],
  ['an event-bus topic queue constant with no pgmq queue', { [TOPIC_FILE]: TOPIC_CONSTANT }],
  ['an event-bus topic queue constant whose pgmq queue was dropped', { [TOPIC_FILE]: TOPIC_CONSTANT, [MIGRATION]: CREATE_TOPIC, [NEXT]: `select pgmq.drop_queue('${TOPIC}');` }],
  ['a dynamic event-bus topic queue constant', { [TOPIC_FILE]: 'export const RECEIPT_PAID_MAILER_TOPIC_QUEUE = topicName();' }],
];

const badGrants = [
  `grant select on pgmq.q_${TOPIC} to anon;`,
  `grant select on pgmq.q_${TOPIC} to authenticated;`,
  `grant select on pgmq.q_${TOPIC} to public;`,
  `grant select on pgmq.q_${TOPIC} to app_be, anon;`,
  'grant usage on schema pgmq to app_be;',
  'grant select on pgmq.meta to app_be;',
  'grant select on pgmq.q_missing to app_be;',
  'grant execute on function pgmq.send(text, jsonb) to app_be;',
  'grant execute on function pgmq_public.send(text, jsonb) to anon;',
  'grant select on all tables in schema pgmq to app_be;',
  'alter default privileges in schema pgmq grant select on tables to app_be;',
];

const outboxRow = (values) => `insert into public.queue (queue, payload, created_at) values ${values}`;
const badCommands = [
  "update public.orders set status = 'expired'",
  "select net.http_post('https://host.example/tick', '{}'::jsonb)",
  outboxRow("('missing', '{}'::jsonb, now())"),
  `${ENQUEUE}; delete from public.orders`,
  "insert into public.queue (queue, payload, created_at) select 'receipts', '{}'::jsonb, now() from public.orders",
  outboxRow("('receipts', '{}'::jsonb, now()), ('receipts', '{}'::jsonb, now())"),
  outboxRow("('receipts', public.expire_orders(), now())"),
  outboxRow("('receipts', (with expired as (delete from public.orders returning id) select jsonb_build_object('id', id) from expired), now())"),
  `${ENQUEUE} returning id`,
  "insert into public.queue (payload, created_at) values ('{}'::jsonb, now())",
  "insert into public.orders (queue, status) values ('receipts', 'expired')",
  "insert into orders (queue, status) values ('receipts', 'expired')",
  "insert into private.queue (queue, payload, created_at) values ('receipts', '{}'::jsonb, now())",
  outboxRow("('receipts', '{}'::jsonb, now(), now())").replace('created_at)', 'created_at, sent_at)'),
  "select pgmq.send('missing', '{}'::jsonb)",
  SEND,
  'select private.missing_tick()',
];

for (const edition of ['lite', 'full']) {
  test(`${edition}: the app root judges the migrations while a side scope is not judged twice`, (t) => {
    const context = fixture(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: CREATE });
    assert.ok(databaseQueuesFindings({ ...context, isRoot: true }).some((finding) => finding.code === 'DB_PGMQ_DECLARED'));
    assert.deepEqual(databaseQueuesFindings({ ...context, isRoot: false, appSide: true }), []);
  });

  test(`${edition}: a standalone back-end scope reads its queue constants against the migrations`, (t) => {
    const queue = QUEUE.slice(3);
    const context = fixture(t, edition, { [queue]: CONSTANT, [MIGRATION]: CREATE });
    const standalone = { ...context, repo: { ...context.repo, profile: 'be' }, isRoot: false, appSide: false };
    assert.ok(databaseQueuesFindings(standalone).some((finding) => finding.code === 'DB_PGMQ_DECLARED' && finding.path === MIGRATION));
    const retired = fixture(t, edition, { [queue]: CONSTANT, [MIGRATION]: CREATE, [NEXT]: DROP });
    assert.deepEqual(databaseQueuesFindings({ ...retired, repo: { ...retired.repo, profile: 'be' }, isRoot: false, appSide: false }), []);
  });

  test(`${edition}: a queue constant on Redis and an owned event-bus topic queue with its app grants pass`, (t) => {
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT }), []);
    assert.deepEqual(judge(t, edition, {
      [TOPIC_FILE]: TOPIC_CONSTANT,
      [MIGRATION]: `-- select pgmq.create('inert');\nselect "pgmq"."create"(queue_name => '${TOPIC}'::text);\ngrant select, insert, update, delete on pgmq.q_${TOPIC}, pgmq.a_${TOPIC} to app_be;`,
    }), []);
    assert.deepEqual(judge(t, edition, { [TOPIC_FILE.slice(3)]: TOPIC_CONSTANT, [MIGRATION]: CREATE_TOPIC }), []);
  });

  test(`${edition}: an unowned or renamed pgmq queue and its live pgmq.send job are both refused`, (t) => {
    const unowned = judge(t, edition, { [MIGRATION]: "select pgmq.create('jobs'); select cron.schedule('jobs-tick', '* * * * *', $$select pgmq.send('jobs', '{}'::jsonb)$$);" });
    assert.deepEqual(codes(unowned), ['DB_CRON_OWNED', 'DB_PGMQ_DECLARED']);
    const renamed = judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: "select pgmq.create('receipts_v2'); select cron.schedule('receipt-tick', '* * * * *', $$select pgmq.send('receipts_v2', '{}'::jsonb)$$);" });
    assert.equal(renamed.filter((finding) => finding.code === 'DB_PGMQ_DECLARED').length, 1);
    assert.ok(renamed.some((finding) => finding.code === 'DB_CRON_OWNED'));
  });

  test(`${edition}: a pgmq queue of a queue constant dropped by a later migration passes`, (t) => {
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\ngrant select, insert on pgmq.q_receipts to app_be;`, [NEXT]: DROP }), []);
  });

  for (const [name, contents] of pgmqFailures) {
    test(`${edition}: DB_PGMQ_DECLARED ${name}`, (t) => expectCode(t, edition, contents, 'DB_PGMQ_DECLARED'));
  }

  for (const grant of badGrants) {
    test(`${edition}: DB_PGMQ_DECLARED refuses ${grant}`, (t) => {
      assert.deepEqual(codes(judge(t, edition, topicMigration(grant))), ['DB_PGMQ_DECLARED']);
      assert.deepEqual(judge(t, edition, topicMigration(`grant select on pgmq.q_${TOPIC} to app_be;`)), []);
    });
  }

  test(`${edition}: DB_PGMQ_DECLARED uses the declared application role`, (t) => {
    const contents = topicMigration(`grant select on pgmq.q_${TOPIC}, pgmq.a_${TOPIC} to receipt_be;`);
    assert.deepEqual(judge(t, edition, contents, { appRole: 'receipt_be' }), []);
    expectCode(t, edition, contents, 'DB_PGMQ_DECLARED');
  });

  test(`${edition}: DB_PGMQ_DECLARED catches grants inside DO, function and dynamic SQL bodies`, (t) => {
    for (const body of [
      `do $$begin grant select on pgmq.q_${TOPIC} to authenticated; end$$;`,
      `create function private.expose_queue() returns void language sql as $$grant select on pgmq.q_${TOPIC} to anon$$;`,
      `do $$begin execute 'grant select on pgmq.q_${TOPIC} to anon'; end$$;`,
    ]) assert.deepEqual(codes(judge(t, edition, topicMigration(body))), ['DB_PGMQ_DECLARED']);
  });

  test(`${edition}: static migration DO declaration and non-secret SQL payload strings pass`, (t) => {
    assert.deepEqual(judge(t, edition, {
      [TOPIC_FILE]: TOPIC_CONSTANT,
      [MIGRATION]: `do $$begin perform pgmq.create('${TOPIC}'); end$$;`,
    }), []);
    assert.deepEqual(judge(t, edition, {
      [QUEUE]: CONSTANT,
      [NEXT]: `select cron.schedule('receipt-tick', '* * * * *', $job$${outboxRow("('receipts', jsonb_build_object('text', 'update public.orders; net.http_post'), now())")}$job$);`,
    }), []);
  });

  test(`${edition}: queue inventory ignores source comments, inert literals and test files`, (t) => {
    assert.deepEqual(judge(t, edition, {
      [QUEUE]: `${CONSTANT}\n// export const MISSING_QUEUE = 'missing';\nexport const documentation = "select pgmq.create('missing'); cron.schedule('bad', '* * * * *', 'update public.x')";`,
      [MIGRATION]: "select 'pgmq.create(''missing'')';",
      'be/src/modules/queues/receipts/receipts.queue.spec.ts': "const TEST_QUEUE = 'test'; sql`select cron.schedule('bad', 'x', 'x')`;",
    }), []);
  });

  test(`${edition}: DB_CRON_OWNED passing outbox enqueue, named arguments and a historical pgmq send of a retired job`, (t) => {
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE }), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `select cron.schedule(command => $$${ENQUEUE}$$, schedule => '* * * * *', job_name => 'receipt-tick');` }), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `select cron.schedule('receipt-tick', '* * * * *', $$${ENQUEUE.replace('public.queue', 'queue')}$$);` }), []);
    assert.deepEqual(judge(t, edition, { [MIGRATION]: `${CREATE}\n${LEGACY_SCHEDULE}`, [NEXT]: `select cron.unschedule('receipt-tick'); ${DROP}` }), []);
  });

  test(`${edition}: DB_CRON_OWNED a live job never enqueues with pgmq.send, even to an owned topic queue`, (t) => {
    const send = `select pgmq.send('${TOPIC}', '{}'::jsonb)`;
    assert.deepEqual(codes(judge(t, edition, topicMigration(`select cron.schedule('topic-tick', '* * * * *', $$${send}$$);`))), ['DB_CRON_OWNED']);
    assert.deepEqual(codes(judge(t, edition, topicMigration(`create function private.topic_tick() returns void language plpgsql as $$begin perform ${send.slice(7)}; end$$;\nselect cron.schedule('topic-tick', '* * * * *', $$select private.topic_tick()$$);`))), ['DB_CRON_OWNED']);
  });

  test(`${edition}: DB_CRON_OWNED the outbox table and its columns come from ruleParams.db.queueOutbox`, (t) => {
    const base = loadSlotManifest();
    const withOutbox = (queueOutbox) => ({ ...base, ruleParams: { ...base.ruleParams, db: { ...base.ruleParams.db, queueOutbox } } });
    assert.deepEqual(base.ruleParams.db.queueOutbox, { table: 'public.queue', columns: ['queue', 'payload', 'created_at', 'correlation_id'] });
    const contents = { [QUEUE]: CONSTANT, [MIGRATION]: "select cron.schedule('receipt-tick', '* * * * *', $$insert into jobs.outbox (queue, body) values ('receipts', '{}'::jsonb)$$);" };
    const context = fixture(t, edition, contents);
    assert.deepEqual(databaseQueuesFindings({ ...context, manifest: withOutbox({ table: 'jobs.outbox', columns: ['queue', 'body'] }) }), []);
    assert.deepEqual(codes(databaseQueuesFindings({ ...context, manifest: base })), ['DB_CRON_OWNED']);
    const { queueOutbox, ...db } = base.ruleParams.db;
    assert.ok(queueOutbox);
    const scheduled = fixture(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE });
    assert.deepEqual(codes(databaseQueuesFindings({ ...scheduled, manifest: { ...base, ruleParams: { ...base.ruleParams, db } } })), ['DB_CRON_OWNED']);
  });

  test(`${edition}: ruleParams.db.queueOutbox names one schema-qualified table and columns that include queue`, () => {
    const base = loadSlotManifest();
    assert.deepEqual(ruleParamsProblems(base), []);
    for (const queueOutbox of [
      { table: 'queue', columns: ['queue'] },
      { table: 'public.queue', columns: ['payload'] },
      { table: 'public.queue', columns: ['queue', 'queue'] },
      { table: 'public.queue', columns: [] },
      { table: 'public.queue', columns: ['queue'], extra: true },
      { table: 'Public.Queue', columns: ['queue'] },
    ]) {
      const manifest = { ...base, ruleParams: { ...base.ruleParams, db: { ...base.ruleParams.db, queueOutbox } } };
      assert.ok(ruleParamsProblems(manifest).some((problem) => problem.startsWith('ruleParams.db may contain only')), JSON.stringify(queueOutbox));
    }
  });

  for (const command of badCommands) {
    test(`${edition}: DB_CRON_OWNED refuses command ${command}`, (t) => {
      expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `select cron.schedule('receipt-tick', '* * * * *', $job$${command}$job$);` }, 'DB_CRON_OWNED');
    });
  }

  test(`${edition}: DB_CRON_OWNED duplicate name across active migrations`, (t) => {
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE, [NEXT]: SCHEDULE }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED literal name, cadence and command are required`, (t) => {
    for (const schedule of [
      `select cron.schedule('* * * * *', $$${ENQUEUE}$$);`,
      `select cron.schedule(current_setting('job.name'), '* * * * *', $$${ENQUEUE}$$);`,
      `select cron.schedule('receipt-tick', current_setting('job.cadence'), $$${ENQUEUE}$$);`,
      "select cron.schedule('receipt-tick', '* * * * *', current_setting('job.command'));",
      `select cron.schedule_in_database('receipt-tick', '* * * * *', $$${ENQUEUE}$$, 'other');`,
    ]) expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: schedule }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED source SQL and deferred functions cannot install jobs`, (t) => {
    for (const contents of [
      { 'be/src/modules/platform/queue/persistence/queue.sql.ts': `export const installTick = sql\`${SCHEDULE}\`;` },
      { 'be/src/modules/platform/queue/queue.client.ts': `manager.query(${JSON.stringify(SCHEDULE)});` },
      { 'supabase/seed.sql': SCHEDULE },
      { [NEXT]: `create function private.install_tick() returns void language sql as $fn$${SCHEDULE}$fn$;` },
      { [NEXT]: `create function private.install_tick() returns void language plpgsql as $fn$begin perform cron.schedule('receipt-tick', '* * * * *', $$${ENQUEUE}$$); end$fn$;` },
    ]) expectCode(t, edition, { [QUEUE]: CONSTANT, ...contents }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED one static SQL or PLpgSQL enqueue-only tick passes`, (t) => {
    for (const tick of [
      TICK,
      `create function private.receipt_tick() returns void language plpgsql as $$begin ${ENQUEUE}; end$$;`,
      `create function private.receipt_tick() returns void language sql begin atomic ${ENQUEUE}; end;`,
    ]) {
      assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${tick}\n${CALL_TICK}` }), []);
    }
  });

  test(`${edition}: DB_CRON_OWNED a catalog UUID constructor preserves enqueue-only correlation payloads`, (t) => {
    const insert = "insert into public.queue (queue, payload, created_at, correlation_id) values ('receipts', jsonb_build_object('tick', true), now(), pg_catalog.gen_random_uuid()::text)";
    for (const tick of [
      `create function private.receipt_tick() returns void language sql as $$${insert}$$;`,
      `create function private.receipt_tick() returns void language plpgsql set search_path = '' as $$begin ${insert}; end$$;`,
    ]) assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${tick}
${CALL_TICK}` }), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `select cron.schedule('receipt-tick', '* * * * *', $job$${insert}$job$);` }), []);
  });

  test(`${edition}: DB_CRON_OWNED a tick may take the root correlation id of its caller and write it`, (t) => {
    const tick = "create function private.receipt_tick(root_correlation_id text) returns void language plpgsql set search_path = '' as $$begin insert into public.queue (queue, payload, created_at, correlation_id) values ('receipts', jsonb_build_object('tick', true), now(), root_correlation_id); end$$;";
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${tick}
select cron.schedule('receipt-tick', '* * * * *', $$select private.receipt_tick('cron-root')$$);` }), []);
  });

  test(`${edition}: DB_CRON_OWNED UUID lookalikes, supplied arguments and decorated calls remain refused`, (t) => {
    for (const expression of [
      'gen_random_uuid()',
      'public.gen_random_uuid()',
      'private.gen_random_uuid()',
      "pg_catalog.gen_random_uuid('payload')",
      'pg_catalog.gen_random_uuid(public.expire_orders())',
      'pg_catalog.gen_random_uuid() filter (where true)',
      'pg_catalog.gen_random_uuid() over ()',
      "jsonb_build_array(pg_catalog.gen_random_uuid(), net.http_post('https://host.example/tick'))",
    ]) {
      const insert = `insert into public.queue (queue, payload, created_at, correlation_id) values ('receipts', '{}'::jsonb, now(), (${expression})::text)`;
      expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `create function private.receipt_tick() returns void language sql as $$${insert}$$;
${CALL_TICK}` }, 'DB_CRON_OWNED');
    }
  });

  test(`${edition}: DB_CRON_OWNED tick body DML, dynamic SQL and network calls fail`, (t) => {
    for (const tick of [
      "create function private.receipt_tick() returns void language sql as $$insert into public.orders (queue, status) values ('receipts', 'expired')$$;",
      "create function private.receipt_tick() returns void language plpgsql as $$begin insert into public.orders (queue, status) values ('receipts', 'expired'); end$$;",
      "create function private.receipt_tick() returns void language sql as $$insert into public.queue (queue, payload, created_at, sent_at) values ('receipts', '{}'::jsonb, now(), now())$$;",
      "create function private.receipt_tick() returns void language sql as $$update public.orders set status = 'expired'$$;",
      "create function private.receipt_tick() returns bigint language sql as $$select net.http_post('https://host.example/tick')$$;",
      `create function private.receipt_tick() returns void language plpgsql as $$begin update public.orders set status = 'expired'; ${ENQUEUE}; end$$;`,
      "create function private.receipt_tick() returns void language plpgsql as $$begin delete from public.orders; end$$;",
      `create function private.receipt_tick() returns void language plpgsql as $$begin execute '${ENQUEUE.replaceAll("'", "''")}'; end$$;`,
    ]) expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${tick}\n${CALL_TICK}` }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED tick arguments cannot hide business or network calls`, (t) => {
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${TICK}\nselect cron.schedule('receipt-tick', '* * * * *', $$select private.receipt_tick(net.http_post('https://host.example/tick'))$$);` }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED one tick cannot have two migration owners`, (t) => {
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${TICK}\n${CALL_TICK}`, [NEXT]: CALL_TICK.replace('receipt-tick', 'second-tick') }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED detects a tick also declared in api schedulers`, (t) => {
    for (const declaration of [
      "export const apiOptions = { schedulers: ['receipt-tick'] };",
      "export const apiOptions = { schedulers: ['private.receipt_tick'] };",
      "export const apiOptions = { schedulers: [{ queue: 'receipts' }] };",
    ]) expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${TICK}\n${CALL_TICK}`, 'be/apps/api/src/api.options.ts': declaration }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED follows imported scheduler constants`, (t) => {
    expectCode(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `${TICK}\n${CALL_TICK}`,
      'be/src/modules/platform/queue/queue.options.ts': "export const API_SCHEDULERS = [{ name: 'receipt-tick' }];",
      'be/apps/api/src/api.options.ts': "import { API_SCHEDULERS as schedules } from '@modules/platform/queue/queue.options'; export const apiOptions = { schedulers: schedules };",
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED follows shorthand scheduler options`, (t) => {
    expectCode(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `${TICK}\n${CALL_TICK}`,
      'be/apps/api/src/api.options.ts': "const schedulers = [{ name: 'receipt-tick' }]; export const apiOptions = { schedulers };",
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED follows barrel exports and namespace scheduler imports`, (t) => {
    for (const options of [
      "import { exportedSchedulers } from '@modules/platform/queue'; export const apiOptions = { schedulers: exportedSchedulers };",
      "import * as queueOptions from '@modules/platform/queue'; export const apiOptions = { schedulers: queueOptions.exportedSchedulers };",
      "import schedules from '../../../src/modules/platform/queue/default.js'; export const apiOptions = { schedulers: schedules };",
    ]) expectCode(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `${TICK}\n${CALL_TICK}`,
      'be/src/modules/platform/queue/queue.options.ts': "export const API_SCHEDULERS = [{ name: 'receipt-tick' }];",
      'be/src/modules/platform/queue/index.ts': "export * from './barrel.js';",
      'be/src/modules/platform/queue/barrel.ts': "export { API_SCHEDULERS as exportedSchedulers } from './queue.options.js';",
      'be/src/modules/platform/queue/default.ts': "import { API_SCHEDULERS } from './queue.options.js'; export default API_SCHEDULERS;",
      'be/apps/api/src/api.options.ts': options,
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED formatted dynamic SQL cannot install a cron job`, (t) => {
    expectCode(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `do $$begin execute format('select cron.schedule(%L, %L, %L)', 'receipt-tick', '* * * * *', '${ENQUEUE.replaceAll("'", "''")}'); end$$;`,
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED unrelated scheduler and archived old jobs pass`, (t) => {
    assert.deepEqual(judge(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `${TICK}\n${CALL_TICK}`,
      'supabase/migrations/_archive/20261013010000_old.sql': `${CALL_TICK}\n${CALL_TICK}`,
      'be/apps/api/src/api.options.ts': "export const apiOptions = { schedulers: ['other-job'] };",
    }), []);
  });

  test(`${edition}: DB_CRON_OWNED removing a tick requires unschedule in the same migration`, (t) => {
    const base = { [QUEUE]: CONSTANT, [MIGRATION]: `${TICK}\n${CALL_TICK}` };
    expectCode(t, edition, { ...base, [NEXT]: 'drop function private.receipt_tick();' }, 'DB_CRON_OWNED');
    expectCode(t, edition, { ...base, [NEXT]: "select cron.unschedule('other-job'); drop function private.receipt_tick();" }, 'DB_CRON_OWNED');
    assert.deepEqual(judge(t, edition, { ...base, [NEXT]: "select cron.unschedule('receipt-tick'); drop function private.receipt_tick();" }), []);
  });

  test(`${edition}: a legacy pgmq tick moves to the queue outbox and its pgmq queue is dropped`, (t) => {
    const legacy = { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\n${LEGACY_TICK}\n${CALL_TICK}` };
    const moved = TICK.replace('create function', 'create or replace function');
    assert.deepEqual(judge(t, edition, { ...legacy, [NEXT]: `${moved}\n${DROP}` }), []);
    expectCode(t, edition, { ...legacy, [NEXT]: DROP }, 'DB_CRON_OWNED');
    expectCode(t, edition, { ...legacy, [NEXT]: moved }, 'DB_PGMQ_DECLARED');
  });

  test(`${edition}: finder wiring and scope use all files for the cross-file check`, (t) => {
    assert.ok(FINDERS.includes(databaseQueuesFindings));
    const context = fixture(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: CREATE });
    context.files = [QUEUE];
    assert.ok(databaseQueuesFindings(context).some((finding) => finding.code === 'DB_PGMQ_DECLARED' && finding.path === MIGRATION));
    context.inScope = (file) => file === MIGRATION;
    assert.ok(a15Findings(context).some((finding) => finding.code === 'DB_PGMQ_DECLARED' && finding.path === MIGRATION));
    context.inScope = () => false;
    assert.deepEqual(databaseQueuesFindings(context), []);
  });

  test(`${edition}: baseline metadata preserves final active queue and cron declarations`, (t) => {
    const context = fixture(t, edition, {
      [QUEUE]: CONSTANT,
      [TOPIC_FILE]: TOPIC_CONSTANT,
      [MIGRATION]: `${CREATE_TOPIC}\nselect pgmq.create('retired'); select pgmq.drop_queue('retired');\n${CREATE}\n${LEGACY_SCHEDULE}\ndo $$begin perform cron.unschedule('receipt-tick'); end$$;\n${DROP}`,
      [NEXT]: SCHEDULE.replace('receipt-tick', 'current-tick'),
    });
    assert.deepEqual(databaseQueueDeclarations(context), {
      queues: [TOPIC],
      cron: [{ name: 'current-tick', schedule: '* * * * *', command: ENQUEUE }],
      grants: [],
      findings: [],
    });
  });

  test(`${edition}: baseline metadata reports invalid ownership before a cutover`, (t) => {
    const metadata = databaseQueueDeclarations(fixture(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\n${LEGACY_SCHEDULE.replace(SEND, 'delete from public.orders')}` }));
    assert.ok(metadata.findings.some((finding) => finding.code === 'DB_PGMQ_DECLARED'));
    assert.ok(metadata.findings.some((finding) => finding.code === 'DB_CRON_OWNED'));
  });

  test(`${edition}: retiring a queue, its grants and its scheduled job passes`, (t) => {
    for (const [install, remove] of [
      [LEGACY_SCHEDULE, ''],
      [`${LEGACY_TICK}\n${CALL_TICK}`, 'drop function private.receipt_tick();'],
    ]) {
      const context = fixture(t, edition, {
        [MIGRATION]: `${CREATE}\ngrant select, insert on pgmq.q_receipts to app_be;\n${install}`,
        [NEXT]: `select cron.unschedule('receipt-tick'); ${remove} ${DROP}`,
      });
      assert.deepEqual(databaseQueuesFindings(context), []);
      assert.deepEqual(databaseQueueDeclarations(context), { queues: [], cron: [], grants: [], findings: [] });
    }
  });

  test(`${edition}: retiring an unsafe original schedule still reports its unsafe command`, (t) => {
    expectCode(t, edition, {
      [MIGRATION]: `${CREATE}\nselect cron.schedule('receipt-tick', '* * * * *', $$delete from public.orders$$);`,
      [NEXT]: `select cron.unschedule('receipt-tick'); ${DROP}`,
    }, 'DB_CRON_OWNED');
    expectCode(t, edition, {
      [MIGRATION]: `${CREATE}\ncreate function private.receipt_tick() returns void language sql as $$delete from public.orders$$;\n${CALL_TICK}`,
      [NEXT]: `select cron.unschedule('receipt-tick'); drop function private.receipt_tick(); ${DROP}`,
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: a live job whose queue was removed remains an orphan`, (t) => {
    expectCode(t, edition, { [MIGRATION]: `${CREATE}\n${LEGACY_SCHEDULE}`, [NEXT]: DROP }, 'DB_CRON_OWNED');
  });

  test(`${edition}: an active job validates the latest tick body as well as its original body`, (t) => {
    expectCode(t, edition, {
      [QUEUE]: CONSTANT,
      [MIGRATION]: `${TICK}\n${CALL_TICK}`,
      [NEXT]: "create or replace function private.receipt_tick() returns bigint language sql as $$delete from public.orders returning 1$$;",
    }, 'DB_CRON_OWNED');
  });

  test(`${edition}: baseline metadata replays queue grants, revokes and grant options`, (t) => {
    const context = fixture(t, edition, {
      ...topicMigration(`grant select, insert on pgmq.q_${TOPIC} to receipt_be with grant option; grant select on pgmq.a_${TOPIC} to receipt_be;`),
      [NEXT]: `revoke insert on pgmq.q_${TOPIC} from receipt_be; revoke grant option for select on pgmq.q_${TOPIC} from receipt_be;`,
    }, { appRole: 'receipt_be' });
    assert.deepEqual(databaseQueueDeclarations(context), {
      queues: [TOPIC], cron: [],
      grants: [
        { privileges: ['select'], tables: [`pgmq.q_${TOPIC}`], roles: ['receipt_be'], grantOption: false },
        { privileges: ['select'], tables: [`pgmq.a_${TOPIC}`], roles: ['receipt_be'], grantOption: false },
      ],
      findings: [],
    });
  });

  test(`${edition}: deferred grants do not become baseline operational grants`, (t) => {
    const context = fixture(t, edition, {
      [MIGRATION]: `${CREATE}\ncreate function private.configure_queue() returns void language sql as $$grant select on pgmq.q_receipts to app_be$$;`,
    });
    assert.deepEqual(databaseQueueDeclarations(context).grants, []);
  });

  test(`${edition}: recreated queues do not retain old grants`, (t) => {
    const context = fixture(t, edition, {
      [MIGRATION]: `${CREATE}\ngrant select on pgmq.q_receipts to app_be;`,
      [NEXT]: `${DROP} ${CREATE}\ngrant insert on pgmq.q_receipts to app_be;`,
    });
    assert.deepEqual(databaseQueueDeclarations(context).grants, [
      { privileges: ['insert'], tables: ['pgmq.q_receipts'], roles: ['app_be'], grantOption: false },
    ]);
  });
}

test('full repositories without Supabase stay outside the queue rule', (t) => {
  const context = fixture(t, 'full', { [QUEUE]: CONSTANT });
  context.repo = { ...context.repo, supabase: undefined };
  fs.writeFileSync(path.join(context.repoRoot, 'hfs.json'), JSON.stringify(context.repo));
  assert.deepEqual(databaseQueuesFindings(context), []);
});

// An app that declares redis backing and its own queue outbox (hfs.json sides.be.queueOutbox) enqueues its ticks through the declared function.
const JOB_BE = { backing: ['redis'], queueOutbox: { table: 'public.job_outbox', enqueue: 'public.job_enqueue', queueParameter: 'p_queue' } };
const JOB_ENQUEUE = `create function public.job_enqueue(p_workspace uuid, p_queue text, p_name text, p_payload jsonb, p_dedupe text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.job_outbox (workspace_id, queue, name, payload, dedupe_key)
  values (p_workspace, p_queue, p_name, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.job_outbox where dedupe_key = p_dedupe; end if;
  return v_id;
end $$;`;
const JOB_CALL = "select public.job_enqueue(null::uuid, 'receipts', 'receipt.tick', '{}'::jsonb, 'receipt-tick:' || date_trunc('minute', clock_timestamp()))";
const jobSchedule = (command = JOB_CALL, name = 'receipt-tick') => `select cron.schedule('${name}', '* * * * *', $job$${command}$job$);`;
const jobFunction = (body) => JOB_ENQUEUE.replace(/begin[\s\S]*end \$\$;/, () => `begin\n${body}\nend $$;`);
const OUTBOX_INSERT = 'insert into public.job_outbox (queue, name, payload, dedupe_key) values (p_queue, p_name, p_payload, p_dedupe) on conflict (dedupe_key) do nothing returning id into v_id;';

for (const edition of ['lite', 'full']) {
  test(`${edition}: DB_CRON_OWNED a job unscheduled and scheduled again by a later migration passes, an active duplicate stays refused`, (t) => {
    const second = `select cron.unschedule('receipt-tick');\n${SCHEDULE.replace('now()', "now() + interval '1 second'")}`;
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE, [NEXT]: second }), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${SCHEDULE}\nselect cron.unschedule('receipt-tick');\n${SCHEDULE}` }), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${SCHEDULE}\ndo $$begin perform cron.unschedule('receipt-tick'); end$$;`, [NEXT]: SCHEDULE }), []);
    const findings = expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE, [NEXT]: SCHEDULE }, 'DB_CRON_OWNED');
    assert.ok(findings.some((finding) => finding.path === NEXT && /scheduled once while it is active/.test(finding.message)));
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${SCHEDULE}\nselect cron.unschedule('other-tick');`, [NEXT]: SCHEDULE }, 'DB_CRON_OWNED');
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `select cron.unschedule('receipt-tick');\n${SCHEDULE}\n${SCHEDULE}` }, 'DB_CRON_OWNED');
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${SCHEDULE}\nselect cron.unschedule('receipt-tick');`, [NEXT]: `${SCHEDULE}\n${SCHEDULE}` }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED a tick function is re-owned after its job was unscheduled, never by two live jobs`, (t) => {
    const first = `${TICK}\n${CALL_TICK}`;
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: first, [NEXT]: `select cron.unschedule('receipt-tick');\n${CALL_TICK}` }), []);
    const second = CALL_TICK.replace('receipt-tick', 'receipt-tick-2');
    const refused = expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: first, [NEXT]: second }, 'DB_CRON_OWNED');
    assert.ok(refused.some((finding) => /more than one cron owner/.test(finding.message)));
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: first, [NEXT]: `select cron.unschedule('receipt-tick');\n${second}` }), []);
  });

  test(`${edition}: DB_CRON_OWNED a re-scheduled tick keeps the live command rule`, (t) => {
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE, [NEXT]: `select cron.unschedule('receipt-tick');\n${jobSchedule("update public.orders set status = 'expired'")}` }, 'DB_CRON_OWNED');
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\n${LEGACY_SCHEDULE}`, [NEXT]: `select cron.unschedule('receipt-tick');\n${LEGACY_SCHEDULE}` }, 'DB_CRON_OWNED');
  });

  test(`${edition}: DB_CRON_OWNED the declared outbox enqueue passes, directly or through one tick, and replaces a pgmq job`, (t) => {
    const contents = { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${jobSchedule()}` };
    assert.deepEqual(judge(t, edition, contents, undefined, JOB_BE), []);
    const viaTick = "create function private.receipt_tick() returns void language plpgsql as $$begin perform public.job_enqueue(null::uuid, 'receipts', 'receipt.tick', '{}'::jsonb, 'receipt-tick'); end$$;";
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${viaTick}\n${CALL_TICK}` }, undefined, JOB_BE), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${CREATE}\n${JOB_ENQUEUE}\n${LEGACY_SCHEDULE}`, [NEXT]: `select cron.unschedule('receipt-tick');\n${DROP}\n${jobSchedule()}` }, undefined, JOB_BE), []);
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${jobFunction(`${OUTBOX_INSERT}
  return v_id;`)}
${jobSchedule()}` }, undefined, JOB_BE), []);
    const named = jobSchedule("select public.job_enqueue(p_dedupe => 'receipt-tick', p_queue => 'receipts', p_name => 'receipt.tick', p_payload => '{}'::jsonb, p_workspace => null)");
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${named}` }, undefined, JOB_BE), []);
  });

  test(`${edition}: DB_CRON_OWNED the declared outbox needs redis backing and a declaration; the canon table stays accepted`, (t) => {
    const contents = { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${jobSchedule()}` };
    expectCode(t, edition, contents, 'DB_CRON_OWNED');
    expectCode(t, edition, contents, 'DB_CRON_OWNED', undefined, { queueOutbox: JOB_BE.queueOutbox });
    expectCode(t, edition, contents, 'DB_CRON_OWNED', undefined, { backing: ['redis'] });
    expectCode(t, edition, contents, 'DB_CRON_OWNED', undefined, { backing: ['qdrant'], queueOutbox: JOB_BE.queueOutbox });
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: SCHEDULE }, undefined, JOB_BE), []);
  });

  test(`${edition}: DB_CRON_OWNED the declaration, not a name, selects the outbox function`, (t) => {
    const renamed = { backing: ['redis'], queueOutbox: { table: 'jobs.relay', enqueue: 'jobs.push', queueParameter: 'queue_name' } };
    const push = JOB_ENQUEUE.replace('public.job_enqueue', 'jobs.push').replace('p_queue text', 'queue_name text').replace('values (p_workspace, p_queue,', 'values (p_workspace, queue_name,').replaceAll('public.job_outbox', 'jobs.relay');
    const call = "select jobs.push(null::uuid, 'receipts', 'receipt.tick', '{}'::jsonb, 'receipt-tick')";
    assert.deepEqual(judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${push}\n${jobSchedule(call)}` }, undefined, renamed), []);
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${jobSchedule()}` }, 'DB_CRON_OWNED', undefined, renamed);
  });

  const badOutboxFunctions = [
    ['a second table written', jobFunction(`${OUTBOX_INSERT}\n  insert into public.audit (note) values (p_name);`)],
    ['an update of the outbox', jobFunction(`${OUTBOX_INSERT}\n  update public.job_outbox set state = 'queued';`)],
    ['a delete', jobFunction(`${OUTBOX_INSERT}\n  delete from public.job_outbox;`)],
    ['a network call', jobFunction(`${OUTBOX_INSERT}\n  perform net.http_post('https://host.example/tick');`)],
    ['dynamic SQL', jobFunction(`${OUTBOX_INSERT}\n  execute 'delete from public.orders';`)],
    ['a pgmq.send', jobFunction(`${OUTBOX_INSERT}\n  perform pgmq.send(p_queue, p_payload);`)],
    ['a read of another table', jobFunction(`${OUTBOX_INSERT}\n  select id into v_id from public.orders limit 1;`)],
    ['a loop', jobFunction(`${OUTBOX_INSERT}\n  for r in select 1 loop null; end loop;`)],
    ['an insert that does not bind the queue parameter', jobFunction(OUTBOX_INSERT.replace('values (p_queue,', "values ('receipts',"))],
    ['an insert with no queue column', jobFunction(OUTBOX_INSERT.replace('(queue, name,', '(name,').replace('values (p_queue, p_name,', 'values (p_name,'))],
    ['an insert from a select', jobFunction('insert into public.job_outbox (queue, name) select p_queue, name from public.orders;')],
    ['an upsert that updates', jobFunction(OUTBOX_INSERT.replace('do nothing', 'do update set name = excluded.name'))],
    ['a value that calls a function', jobFunction(OUTBOX_INSERT.replace('p_payload,', 'public.build_payload(),'))],
    ['no insert at all', jobFunction('select id into v_id from public.job_outbox limit 1;')],
    ['two inserts', jobFunction(`${OUTBOX_INSERT}\n  ${OUTBOX_INSERT}`)],
  ];
  for (const [name, definition] of badOutboxFunctions) {
    test(`${edition}: DB_CRON_OWNED refuses a declared enqueue function with ${name}`, (t) => {
      expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${definition}\n${jobSchedule()}` }, 'DB_CRON_OWNED', undefined, JOB_BE);
    });
  }

  test(`${edition}: DB_CRON_OWNED a declared enqueue function replaced by a bad definition refuses the live job only`, (t) => {
    const bad = JOB_ENQUEUE.replace('create function', 'create or replace function').replace('insert into', "update public.job_outbox set state = 'x';\n  insert into");
    const findings = expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${jobSchedule()}`, [NEXT]: bad }, 'DB_CRON_OWNED', undefined, JOB_BE);
    assert.ok(findings.every((finding) => finding.path === MIGRATION));
  });

  const badOutboxCommands = [
    ['an ad-hoc insert into the declared table', "insert into public.job_outbox (queue, name) values ('receipts', 'receipt.tick')"],
    ['a queue that is no queue constant', JOB_CALL.replace("'receipts'", "'missing'")],
    ['a queue chosen by an expression', JOB_CALL.replace("'receipts'", "current_setting('queue.name')")],
    ['an argument that does work', JOB_CALL.replace("'{}'::jsonb", 'public.build_payload()')],
    ['a sub-select argument', JOB_CALL.replace("'{}'::jsonb", '(select payload from public.orders limit 1)')],
    ['another function of the same schema', JOB_CALL.replace('job_enqueue', 'job_enqueue_all')],
    ['a second statement', `${JOB_CALL}; delete from public.orders`],
  ];
  for (const [name, command] of badOutboxCommands) {
    test(`${edition}: DB_CRON_OWNED refuses ${name} beside a declared outbox`, (t) => {
      expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE}\n${jobSchedule(command)}` }, 'DB_CRON_OWNED', undefined, JOB_BE);
    });
  }

  test(`${edition}: DB_CRON_OWNED a declared enqueue function that is not defined, or lacks the declared parameter, refuses its job`, (t) => {
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: jobSchedule() }, 'DB_CRON_OWNED', undefined, JOB_BE);
    expectCode(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: `${JOB_ENQUEUE.replace('p_queue text', 'other text')}\n${jobSchedule()}` }, 'DB_CRON_OWNED', undefined, JOB_BE);
  });
}
