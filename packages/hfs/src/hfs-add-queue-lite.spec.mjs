// hfs-add-queue-lite.spec.mjs - `starci app add queue|job` in a lite app (ruling:R212/case-10): the queue is full's BullMQ adapter
// on the declared Redis, so the verb writes full's trees with a Supabase migration in place of the TypeORM schema files, declares
// redis in sides.be.backing with its bullmq client, and renders the one persisted Redis into every docker-swarm environment of the
// stack while keeping the owner's comments. The scaffolded app judged after the verb gains only the scenario proofs it owes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { appSource, bundledPresets, checkTargets, renderTargets } from '../sync/index.mjs';
import { scaffoldApp, bundledPins } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { refuseFullAdapterInLite, LiteAdapterRefusal } from '../scaffold/edition-gate.mjs';
import { YamlBlockEdit } from '../scaffold/yaml-block-edit.mjs';

const SCAFFOLDED = Date.parse('2026-10-25T00:00:00Z');
const lockedOk = (root) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

function liteApp(t) {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-add-queue-lite-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root } = scaffoldApp({
    name: 'demo', into, edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init,
    emitTypes: () => 'export type Database = Record<string, never>\n', now: () => new Date(SCAFFOLDED),
  });
  return root;
}

const listFiles = (root, dir = root) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (['.git', 'node_modules', '.claude'].includes(entry.name)) return [];
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? listFiles(root, full) : [path.relative(root, full).split(path.sep).join('/')];
});
const findingKeys = (root) => checkRepo({ repoRoot: root, files: listFiles(root) }).findings.map(({ code, path: file, message }) => `${code} ${file} ${message}`);
const read = (root, file) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const yamlOf = (root, file) => parseYaml(read(root, file));

test('lite add job writes full\'s queue and jobs trees on a Supabase migration and declares the persisted Redis', (t) => {
  const root = liteApp(t);
  const before = new Set(findingKeys(root));
  const emitted = [];
  const emitTypes = ({ root: at }) => {
    emitted.push(fs.readdirSync(path.join(at, 'supabase', 'migrations')).filter((file) => file.endsWith('_queue-outbox-jobs.sql')).length);
    return 'export type Database = { public: { Tables: { queue: object; jobs: object } } }\n';
  };
  const { created, registered } = addKind({ repoRoot: root, noun: 'job', name: 'send-receipt', options: { emitTypes }, now: () => SCAFFOLDED + 60_000 });
  assert.deepEqual(emitted, [1], 'the database types are regenerated once, after the migration is written');
  assert.ok(created.includes('supabase/types/database.types.ts'));
  assert.match(read(root, 'supabase/types/database.types.ts'), /queue: object; jobs: object/);
  assert.match(read(root, 'be/src/modules/platform/database/index.ts'), /^export \{ (?:[A-Z_]+, )?sql \} from "\.\/database\.sql"$/m);
  assert.match(read(root, 'be/src/modules/platform/primitives/index.ts'), /^export \{ eachInOrder \} from "\.\/sequence\.policy"$/m);

  assert.deepEqual(registered.patterns.filter((pattern) => ['fenced-job', 'queue'].includes(pattern)), ['fenced-job', 'queue']);
  assert.ok(!created.some((file) => /\/persistence\/(?:connection\.ts|entities\/|migrations\/)/.test(file)), 'no TypeORM schema file in lite');
  assert.ok(created.includes('be/src/features/jobs/send-receipt/transport/queue/send-receipt.processor.ts'));
  assert.match(read(root, 'be/src/modules/platform/queue/persistence/queue.sql.ts'), /INSERT INTO public\.queue/);
  assert.match(read(root, 'be/src/modules/platform/jobs/persistence/jobs.sql.ts'), /INSERT INTO public\.jobs/);
  assert.match(read(root, 'be/src/modules/platform/queue/queue.options.ts'), /redisPassword\?: Secret/);
  assert.doesNotMatch(read(root, 'be/src/modules/platform/queue/index.ts'), /persistence\/connection/);
  const migration = created.find((file) => /^supabase\/migrations\/\d{14}_queue-outbox-jobs\.sql$/.test(file));
  assert.ok(migration, `one migration for both tables: ${created.join(', ')}`);
  assert.match(read(root, migration), /create table public\.queue[\s\S]*create table public\.jobs/);

  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.backing, ['redis']);
  const pkg = JSON.parse(read(root, 'package.json'));
  assert.equal(pkg.dependencies.bullmq, bundledPins().bullmq.version);
  assert.equal(pkg.dependencies.ioredis, bundledPins().ioredis.version, 'bullmq loads ioredis as an optional peer and cannot connect without it');
  assert.match(read(root, 'be/src/modules/platform/queue/queue-relay.service.ts'), /await this\.transport\.persist\(/, 'the relay marks a row sent only once Redis has persisted its job');
  assert.match(read(root, 'be/src/modules/platform/queue/bullmq-queue-transport.client.ts'), /"WAITAOF", 1, 0,/);
  assert.match(read(root, 'be/src/modules/platform/queue/errors/queue.error.ts'), /QUEUE_ERROR_KINDS: Record<QueueErrorCode, ErrorKind>/);
  assert.match(read(root, 'be/src/modules/platform/queue/index.ts'), /^export \{ QUEUE_MESSAGES \} from "\.\/messages\/queue\.messages"$/m);
  assert.match(pkg.scripts['redis:create'], /^docker create --name demo-dev-redis .* -v demo-dev-redis-data:\/data redis:7@sha256:[0-9a-f]{64} redis-server --appendonly yes$/);
  const scripts = renderTargets(JSON.parse(read(root, 'hfs.json')), bundledPresets(), { source: appSource(root) }).filter((target) => target.mode === 'scripts');
  assert.deepEqual(checkTargets(root, scripts).map(({ status }) => status), ['ok'], 'the scripts block is the one app sync renders for the declared Redis');

  const stacks = yamlOf(root, '.starcistacks/application-stacks.yaml');
  assert.equal(stacks.components.redis.role, 'stateful');
  assert.match(read(root, '.starcistacks/application-stacks.yaml'), /# Scaffolding seals generated placeholders/, 'the owner\'s comments stay');
  for (const env of ['dev', 'production']) {
    const environment = stacks.environments[env];
    assert.deepEqual(environment.components.redis, { replicas: 1, port: 6379 });
    assert.equal(environment.backup.find((entry) => entry.component === 'redis').restoreProof, `.starcistacks/${env}/infra/swarm/recovery/redis.yaml`);
    assert.equal(environment.secrets.find((entry) => entry.name === 'redis-password').runtimeName, `demo-${env}-redis-password-v1`);
    const stack = yamlOf(root, `.starcistacks/${env}/infra/swarm/stack.yaml`);
    assert.match(stack.services.redis.command.join(' '), /--appendonly yes/);
    assert.deepEqual(stack.services.redis.volumes, ['redis-data:/data']);
    assert.deepEqual(stack.services.api.networks, ['app', 'backing']);
    assert.equal(stack.services.api.environment.QUEUE_REDIS_PASSWORD_FILE, '/run/secrets/redis-password');
    assert.equal(stack.networks.backing.internal, true);
    assert.equal(yamlOf(root, `.starcistacks/${env}/infra/swarm/releases/images.lock.yaml`).images.redis, stack.services.redis.image);
    assert.ok(fs.existsSync(path.join(root, '.starcistacks', env, 'infra', 'swarm', 'recovery', 'redis.yaml')));
    assert.match(read(root, `.starcistacks/${env}/runtime/env/KEYS.md`), /`QUEUE_REDIS_PASSWORD`.*\/run\/secrets\/redis-password/);
    assert.ok(fs.existsSync(path.join(root, '.starcistacks', env, 'secrets', 'redis-password.enc')), `${env} seals its redis-password placeholder`);
  }
  assert.deepEqual(stacks.environments.production.deploy.secrets.grants.find((grant) => grant.service === 'redis'), { service: 'redis', from: [{ member: 'redis-password' }] });
  assert.ok(stacks.environments.production.deploy.secrets.grants.find((grant) => grant.service === 'api').from.some((entry) => entry.member === 'redis-password'));

  // The scenario proofs stay owed to the author, as in full (the topics carry no template for a behaviour proof).
  const added = findingKeys(root).filter((key) => !before.has(key));
  const owed = added.filter((key) => /^(?:BE_PATTERN_SPEC_MISSING|BE_LITE_PROOF_LANE_MISSING) hfs\.json /.test(key));
  assert.deepEqual(added.filter((key) => !owed.includes(key)), [], 'the verb adds no other finding to the scaffolded app');
  assert.deepEqual(owed.map((key) => /`((?:queue|fenced-job)\/[a-z-]+)/.exec(key)?.[1]).filter(Boolean).sort(), [
    'fenced-job/claim-bumps-token', 'fenced-job/redispatch-isolated', 'fenced-job/zombie-fenced-out',
    'queue/enqueue-atomic-with-transaction', 'queue/relay-job-id-is-outbox-id', 'queue/scheduler-fires-once',
  ]);
});

test('a second lite add queue reuses the declared Redis and its tables', (t) => {
  const root = liteApp(t);
  const types = read(root, 'supabase/types/database.types.ts');
  addKind({ repoRoot: root, noun: 'queue', name: 'receipt', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 });
  assert.equal(read(root, 'supabase/types/database.types.ts'), types, '--no-types leaves the database types alone');
  const stacks = read(root, '.starcistacks/application-stacks.yaml');
  const { created } = addKind({ repoRoot: root, noun: 'queue', name: 'invoice', options: { emitTypes: () => assert.fail('no new migration, no types run') }, now: () => SCAFFOLDED + 120_000 });
  assert.deepEqual(created.filter((file) => !file.startsWith('be/src/modules/queues/invoice/')), []);
  assert.equal(read(root, '.starcistacks/application-stacks.yaml'), stacks);
  assert.equal(fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((file) => file.includes('queue-outbox')).length, 1);
});

test('lite add queue on a Redis an earlier capability declared still adds bullmq and renders the Redis the stack lacks', (t) => {
  const root = liteApp(t);
  const declaration = JSON.parse(read(root, 'hfs.json'));
  declaration.sides.be.backing = ['redis'];
  fs.writeFileSync(path.join(root, 'hfs.json'), `${JSON.stringify(declaration, null, 2)}\n`);
  const pkg = JSON.parse(read(root, 'package.json'));
  pkg.dependencies = { ...pkg.dependencies, ioredis: '5.4.1' };
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

  addKind({ repoRoot: root, noun: 'queue', name: 'receipt', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 });

  const after = JSON.parse(read(root, 'package.json'));
  assert.equal(after.dependencies.bullmq, bundledPins().bullmq.version, 'the queue imports bullmq, so it is pinned although redis was declared');
  assert.equal(after.dependencies.ioredis, '5.4.1');
  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.backing, ['redis']);
  assert.equal(yamlOf(root, '.starcistacks/application-stacks.yaml').components.redis.role, 'stateful');
  assert.match(yamlOf(root, '.starcistacks/production/infra/swarm/stack.yaml').services.redis.command.join(' '), /--appendonly yes/);
});

test('lite add queue wires every service that runs the queue, a worker as well as the api', (t) => {
  const root = liteApp(t);
  const declaration = JSON.parse(read(root, 'hfs.json'));
  declaration.sides.be.apps.push({ name: 'worker', kind: 'worker' });
  fs.writeFileSync(path.join(root, 'hfs.json'), `${JSON.stringify(declaration, null, 2)}\n`);
  const production = '.starcistacks/production/infra/swarm/stack.yaml';
  const worker = '  worker:\n    image: "demo/worker:v0.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000"\n    networks: [app]\n';
  fs.writeFileSync(path.join(root, ...production.split('/')), read(root, production).replace(/\nnetworks:\n/, `\n${worker}networks:\n`));

  addKind({ repoRoot: root, noun: 'queue', name: 'receipt', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 });

  const stack = yamlOf(root, production);
  for (const service of ['api', 'worker']) {
    assert.deepEqual(stack.services[service].networks, ['app', 'backing'], `${service} joins the internal backing network`);
    assert.equal(stack.services[service].environment.QUEUE_REDIS_HOST, 'redis');
    assert.equal(stack.services[service].environment.QUEUE_REDIS_PASSWORD_FILE, '/run/secrets/redis-password');
    assert.deepEqual(stack.services[service].secrets.at(-1), { source: 'redis-password', target: 'redis-password' });
  }
  const grants = yamlOf(root, '.starcistacks/application-stacks.yaml').environments.production.deploy.secrets.grants;
  assert.deepEqual(grants.find((grant) => grant.service === 'worker'), { service: 'worker', from: [{ member: 'redis-password' }] });
  assert.ok(grants.find((grant) => grant.service === 'api').from.some((entry) => entry.member === 'redis-password'));
  assert.equal(yamlOf(root, '.starcistacks/dev/infra/swarm/stack.yaml').services.worker, undefined, 'an environment without the worker wires its api only');
});

test('lite add queue refuses a stack with no service of an api or worker app before writing anything', (t) => {
  const root = liteApp(t);
  const production = '.starcistacks/production/infra/swarm/stack.yaml';
  fs.writeFileSync(path.join(root, ...production.split('/')), read(root, production).replace(/^ {2}api:$/m, '  backend:'));
  const hfs = read(root, 'hfs.json');
  assert.throws(() => addKind({ repoRoot: root, noun: 'queue', name: 'receipt', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 }),
    (error) => error.code === 'HFS_ADD_STACK_SHAPE' && /production\/infra\/swarm\/stack\.yaml has no service of a back-end api or worker app \(api\)/.test(error.message));
  assert.equal(read(root, 'hfs.json'), hfs);
});

test('the lite edition gate refuses only lite-adapted topics the package carries no lite template for', () => {
  const topics = [{ id: 'queues', doc: { liteAdapter: {} } }, { id: 'jobs', doc: { liteAdapter: {} } }, { id: 'saga', doc: { liteAdapter: {} } }];
  assert.throws(() => refuseFullAdapterInLite({ edition: 'lite', topics, command: 'add saga', liteTemplated: ['jobs', 'queues'] }),
    (error) => error instanceof LiteAdapterRefusal && /full adapter of saga;/.test(error.message));
  assert.doesNotThrow(() => refuseFullAdapterInLite({ edition: 'lite', topics: topics.slice(0, 2), command: 'add job', liteTemplated: ['jobs', 'queues'] }));
  assert.doesNotThrow(() => refuseFullAdapterInLite({ edition: 'full', topics, command: 'add saga' }));
});

test('a stack edit that does not reproduce the expected document refuses before writing', () => {
  const text = '# owner note\nservices:\n  api:\n    networks: [app]\n';
  const edit = new YamlBlockEdit(text, 'stack.yaml');
  edit.extendFlow(['services', 'api', 'networks'], 'backing');
  assert.throws(() => edit.text(), (error) => error.code === 'HFS_ADD_STACK_SHAPE');
  edit.value.services.api.networks.push('backing');
  assert.equal(edit.text(), '# owner note\nservices:\n  api:\n    networks: [app, backing]\n');
  assert.throws(() => new YamlBlockEdit(text, 'stack.yaml').append(['volumes'], 'data: {}\n'), (error) => error.code === 'HFS_ADD_STACK_SHAPE');
  const grants = new YamlBlockEdit('grants:\n  - service: web\n    from: []\n  - service: api\n    from:\n      - member: a\n', 'g.yaml');
  grants.append(['grants', { item: 'service', is: 'api' }, 'from'], '- member: b\n');
  grants.value.grants[1].from.push({ member: 'b' });
  assert.equal(grants.text(), 'grants:\n  - service: web\n    from: []\n  - service: api\n    from:\n      - member: a\n      - member: b\n');
});
