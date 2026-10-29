// proves: DB_PGMQ_DECLARED@lite DB_PGMQ_DECLARED@full
// ruling:lite-pgmq-bus-bullmq-jobs: pgmq is the event bus and jobs run on BullMQ, so a queue constant has no pgmq queue, every pgmq queue left
// is an event-bus topic queue named by a *_TOPIC_QUEUE constant under platform/event-bus, and a topic binding names a literal pattern and a
// declared queue.
// queue named by a *_TOPIC_QUEUE constant under platform/event-bus, and a live pg_cron job enqueues only through the queue outbox table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { databaseQueueDeclarations, databaseQueuesFindings } from '../runtime/scripts/hfs/rules/database-queues.mjs';
import { a15Findings, FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
const MIGRATION = 'db/migrations/20261014010000_queues.sql';
const NEXT = 'db/migrations/20261014020000_ticks.sql';
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
const BIND_TOPIC = `select pgmq.bind_topic('billing.receipt-paid', '${TOPIC}');`;

function fixture(t, edition, contents, db = {}, be = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-db-queues-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const repo = { hfs: 3, kind: 'app', project: 'queues', edition, db, sides: { be: { apps: [{ name: 'api', kind: 'api' }], ...be } } };
  const files = { 'hfs.json': JSON.stringify(repo), ...contents };
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repoRoot, ...file.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { repoRoot, repo, files: Object.keys(files), all: Object.keys(files), inScope: () => true };
}

function judge(t, edition, contents, db, be) {
  const findings = databaseQueuesFindings(fixture(t, edition, contents, db, be));
  assert.equal(Array.isArray(findings), true, 'the finder is synchronous');
  assert.ok(findings.every((finding) => finding.level === 'error' && finding.path && finding.message));
  return findings;
}

function expectCode(t, edition, contents, code, db, be) {
  // A full app without a db/ tree runs no pgmq and is not judged (ruling lite-self-hosted-postgres-passport-minio).
  if (edition === 'full' && !Object.keys(contents).some((file) => file.startsWith('db/'))) return [];
  const findings = judge(t, edition, contents, db, be);
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
  ['pgmq.create in a seed', { 'db/seed.sql': CREATE }],
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

  test(`${edition}: an unowned or renamed pgmq queue is refused`, (t) => {
    assert.deepEqual(codes(judge(t, edition, { [MIGRATION]: "select pgmq.create('jobs');" })), ['DB_PGMQ_DECLARED']);
    const renamed = judge(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: "select pgmq.create('receipts_v2');" });
    assert.equal(renamed.filter((finding) => finding.code === 'DB_PGMQ_DECLARED').length, 1);
  });

  test(`${edition}: a topic queue bound to its event name by a literal binding after its creation passes`, (t) => {
    assert.deepEqual(judge(t, edition, topicMigration(BIND_TOPIC)), []);
    assert.deepEqual(judge(t, edition, { ...topicMigration(BIND_TOPIC), [NEXT]: `select pgmq.unbind_topic('billing.receipt-paid', '${TOPIC}');` }), []);
  });

  for (const [name, contents] of [
    ['a binding of a queue no migration created', { [TOPIC_FILE]: TOPIC_CONSTANT, [MIGRATION]: `${BIND_TOPIC}\n${CREATE_TOPIC}` }],
    ['a binding with a dynamic pattern', topicMigration(`select pgmq.bind_topic(current_setting('bus.pattern'), '${TOPIC}');`)],
    ['a binding with a dynamic queue', topicMigration("select pgmq.bind_topic('billing.receipt-paid', current_setting('bus.queue'));")],
    ['a binding in application SQL', { [TOPIC_FILE]: TOPIC_CONSTANT, [MIGRATION]: CREATE_TOPIC, 'be/src/modules/platform/event-bus/persistence/bind.sql.ts': `export const bind = sql\`${BIND_TOPIC}\`;` }],
    ['a binding inside a function', topicMigration(`create function private.bind_topics() returns void language sql as $$${BIND_TOPIC}$$;`)],
    ['a binding by dynamic SQL', topicMigration(`do $$begin execute 'select pgmq.bind_topic(''billing.receipt-paid'', ''${TOPIC}'')'; end$$;`)],
  ]) {
    test(`${edition}: DB_PGMQ_DECLARED ${name}`, (t) => expectCode(t, edition, contents, 'DB_PGMQ_DECLARED'));
  }

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
  });

  test(`${edition}: queue inventory ignores source comments, inert literals and test files`, (t) => {
    assert.deepEqual(judge(t, edition, {
      [QUEUE]: `${CONSTANT}\n// export const MISSING_QUEUE = 'missing';\nexport const documentation = "select pgmq.create('missing'); cron.schedule('bad', '* * * * *', 'update public.x')";`,
      [MIGRATION]: "select 'pgmq.create(''missing'')';",
      'be/src/modules/queues/receipts/receipts.queue.spec.ts': "const TEST_QUEUE = 'test'; sql`select cron.schedule('bad', 'x', 'x')`;",
    }), []);
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

  test(`${edition}: baseline metadata preserves final active queues and the pg_cron jobs an archived chain still schedules`, (t) => {
    const context = fixture(t, edition, {
      [QUEUE]: CONSTANT,
      [TOPIC_FILE]: TOPIC_CONSTANT,
      [MIGRATION]: `${CREATE_TOPIC}\nselect pgmq.create('retired'); select pgmq.drop_queue('retired');\n${CREATE}\nselect cron.schedule('receipt-tick', '* * * * *', 'select 1');\ndo $$begin perform cron.unschedule('receipt-tick'); end$$;\n${DROP}`,
      [NEXT]: "select cron.schedule('current-tick', '* * * * *', 'select 1');",
    });
    assert.deepEqual(databaseQueueDeclarations(context), {
      queues: [TOPIC],
      cron: [{ name: 'current-tick', schedule: '* * * * *', command: 'select 1' }],
      grants: [],
      findings: [],
    });
  });

  test(`${edition}: baseline metadata reports invalid ownership before a cutover`, (t) => {
    const metadata = databaseQueueDeclarations(fixture(t, edition, { [QUEUE]: CONSTANT, [MIGRATION]: CREATE }));
    assert.deepEqual(codes(metadata.findings), ['DB_PGMQ_DECLARED']);
  });

  test(`${edition}: retiring a queue and its grants passes`, (t) => {
    const context = fixture(t, edition, {
      [MIGRATION]: `${CREATE}\ngrant select, insert on pgmq.q_receipts to app_be;`,
      [NEXT]: DROP,
    });
    assert.deepEqual(databaseQueuesFindings(context), []);
    assert.deepEqual(databaseQueueDeclarations(context), { queues: [], cron: [], grants: [], findings: [] });
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
