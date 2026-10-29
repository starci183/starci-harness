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
import { scaffoldApp } from '../scaffold/app.mjs';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
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
    name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(), lock: lockedOk, initGit: init,
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

test('lite add job writes the platform/jobs tick scheduler, its minute claim and its pinned clients (R335)', (t) => {
  const root = liteApp(t);

  addKind({ repoRoot: root, noun: 'job', name: 'digest', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 });

  const jobs = 'be/src/modules/platform/jobs';
  assert.match(read(root, `${jobs}/job-ticks.contracts.ts`), /export const JOB_TICKS: ReadonlyArray<JobTick> = \[\]/);
  const service = read(root, `${jobs}/job-tick.service.ts`);
  assert.match(service, /advisoryXactLock\(tx, `tick:\$\{tick\.name\}`\)/);
  assert.match(service, /callDbFunction<TickClaim>\(tx, "public\.job_tick_claim"/);
  assert.match(read(root, `${jobs}/job-tick.service.spec.ts`), /enqueues nothing when another replica already fired the tick this minute/);
  assert.match(read(root, `${jobs}/jobs.module.ts`), /ScheduleModule\.forRoot\(\)/);
  const migrations = fs.readdirSync(path.join(root, 'db', 'migrations')).filter((file) => file.endsWith('.sql'));
  assert.ok(migrations.some((file) => /create function public\.job_tick_claim/.test(read(root, `db/migrations/${file}`))), 'the jobs migration carries the minute claim');
  const after = JSON.parse(read(root, 'package.json'));
  assert.equal(after.dependencies['@nestjs/schedule'], bundledPins()['@nestjs/schedule'].version);
  assert.equal(after.dependencies.cron, bundledPins().cron.version);
});
