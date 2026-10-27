// `starci app add queue|job` in a lite app (ruling:R212/case-10): the queue is full's BullMQ adapter on the declared Redis, so lite
// generates full's queue and jobs trees with three differences. The outbox and job tables are a Supabase migration instead of the
// TypeORM entity, connection and migration; the SQL names the public schema; and the queue options read the Redis password of
// its sealed secret. The verb also declares redis in hfs.json sides.be.backing with its bullmq client, and renders the one
// declared Redis into every docker-swarm environment of the stack: the stateful component, its backup and restore record, the
// sealed redis-password member and its grants, the AOF service on a named volume and an internal network, and the images lock.
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { dbTypesPath, emitDbTypes } from '../emit/db-types.mjs';
import { configuredRecipients } from '../runtime/scripts/hfs/secret-init.mjs';
import { materializeDeclaredPlaceholders } from '../runtime/scripts/hfs/sealed-members.mjs';
import { REDIS_IMAGE, TEMPLATES_DIR, redisDevScripts, render } from '../sync/index.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { withSqlIdentifierError } from './add-database-lite.mjs';
import { bundledPins, jsonText, packageJsonText } from './app.mjs';
import { registerLiteExports } from './lite-exports.mjs';
import { ScaffoldError } from './service.mjs';
import { YamlBlockEdit } from './yaml-block-edit.mjs';

/** The pattern topics whose lite templates this package carries; `starci app add` refuses the other lite-adapted topics. */
export const LITE_TEMPLATED_TOPICS = Object.freeze(['jobs', 'queues']);

const LITE_TEMPLATES = Object.freeze({
  'queues/platform/queue.index.ts.tpl': 'queues/platform-lite/queue.index.ts.tpl',
  'queues/platform/queue.options.ts.tpl': 'queues/platform-lite/queue.options.ts.tpl',
  'queues/platform/queue.config.ts.tpl': 'queues/platform-lite/queue.config.ts.tpl',
  'queues/platform/bullmq-queue-transport.client.ts.tpl': 'queues/platform-lite/bullmq-queue-transport.client.ts.tpl',
  'queues/platform/bullmq-queue-transport.client.spec.ts.tpl': 'queues/platform-lite/bullmq-queue-transport.client.spec.ts.tpl',
  'queues/platform/queue-transport.port.ts.tpl': 'queues/platform-lite/queue-transport.port.ts.tpl',
  // The error family also refuses a mark Redis has not persisted (QUEUE_NOT_PERSISTED, QUEUE_JOB_LOST): R276 runs the lite Redis with AOF.
  'queues/platform/errors/queue.error.ts.tpl': 'queues/platform-lite/queue.error.ts.tpl',
  'queues/platform/messages/queue.messages.ts.tpl': 'queues/platform-lite/queue.messages.ts.tpl',
  'queues/platform/queue-relay.service.ts.tpl': 'queues/platform-lite/queue-relay.service.ts.tpl',
  'queues/platform/queue-relay.service.spec.ts.tpl': 'queues/platform-lite/queue-relay.service.spec.ts.tpl',
  'queues/platform/queue.module.ts.tpl': 'queues/platform-lite/queue.module.ts.tpl',
  'queues/platform/persistence.queue.sql.ts.tpl': 'queues/platform-lite/persistence.queue.sql.ts.tpl',
  'jobs/platform/jobs.index.ts.tpl': 'jobs/platform-lite/jobs.index.ts.tpl',
  'jobs/platform/persistence.jobs.sql.ts.tpl': 'jobs/platform-lite/persistence.jobs.sql.ts.tpl',
});

/** The TypeORM-only files of a platform capability: lite's schema authority is supabase/migrations (be.persistence lite overlay). */
const TYPEORM_ONLY = /\/persistence\/(?:connection\.ts$|entities\/|migrations\/)/;

/** The e2e proof slot lite forbids (R212); a lite pattern proves itself with optional integration specs (the topic's liteAdapter proof). */
const E2E_SLOT = 'be.tests.e2e';

/**
 * The lite entries of a queue or jobs topic tree: no TypeORM schema file or e2e proof, and the lite body where the package carries one.
 */
export const selectLiteQueueEntries = (topic, entries) => (LITE_TEMPLATED_TOPICS.includes(topic)
  ? [...entries.filter((entry) => !TYPEORM_ONLY.test(entry.path) && entry.slot !== E2E_SLOT)
    .map((entry) => (LITE_TEMPLATES[entry.template] ? { ...entry, template: LITE_TEMPLATES[entry.template] } : entry))]
  : entries);

const MIGRATION = /^(\d{14})_[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/;
const REDIS_PURPOSE = 'The declared Redis of the queue (hfs.json sides.be.backing) - one instance with AOF persistence (appendonly yes) on the named volume redis-data, on the internal backing network only, reached by the api and worker services as redis:6379 with the password of its sealed secret.';
const MEMBER = 'redis-password';
const quoted = (value) => JSON.stringify(value);
const read = (file) => fs.readFileSync(file, 'utf8');
const template = (relative) => read(path.join(TEMPLATES_DIR, ...relative.split('/'))).replace(/\r\n/g, '\n');

const DATABASE_ERROR = 'be/src/modules/platform/database/errors/database.error.ts';

/** Skeleton files the lite starter leaves out and the queue capabilities use, each from its skeleton template. */
const SKELETON_FILES = Object.freeze([
  ['be/src/modules/platform/database/database.sql.ts', 'skeleton-lite/src/modules/platform/database/database.sql.ts'],
  ['be/src/modules/platform/primitives/sequence.policy.ts', 'skeleton/src/modules/platform/primitives/sequence.policy.ts'],
  ['be/src/modules/platform/primitives/sequence.policy.spec.ts', 'skeleton/src/modules/platform/primitives/sequence.policy.spec.ts'],
]);

/** The sql tag of the outbox and claim statements (with its identifier error) and the in-order relay the queue adapters walk their rows with. */
function skeletonFiles(repoRoot) {
  const created = SKELETON_FILES.filter(([relative]) => !fs.existsSync(path.join(repoRoot, ...relative.split('/'))))
    .map(([relative, source]) => ({ relative, text: render(template(`be/${source}`), {}) }));
  const errorFile = path.join(repoRoot, ...DATABASE_ERROR.split('/'));
  const before = fs.existsSync(errorFile) ? read(errorFile).replace(/\r\n/g, '\n') : null;
  const after = before === null ? null : withSqlIdentifierError(before);
  return { created, patches: after === before ? [] : [{ file: errorFile, text: after }] };
}

/** The capability tables a platform capability the verb adds for the first time needs, as one forward-only Supabase migration. */
function migrationFiles({ repoRoot, beRoot, patterns, now }) {
  const sections = [
    ['queue-outbox', 'queue', 'queues/platform-lite/queue-outbox.sql.tpl', 'queue'],
    ['jobs', 'fenced-job', 'jobs/platform-lite/jobs.sql.tpl', 'jobs'],
  ].filter(([, pattern, , capability]) => patterns.includes(pattern) && !fs.existsSync(path.join(beRoot, 'src', 'modules', 'platform', capability, 'index.ts')));
  if (!sections.length) return [];
  const folder = path.join(repoRoot, 'supabase', 'migrations');
  const migrations = fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => MIGRATION.test(file)).sort(byCodeUnit) : [];
  const stamp = new Date(now()).toISOString().replace(/\D/g, '').slice(0, 14);
  const latest = migrations.at(-1)?.slice(0, 14);
  if (latest && stamp <= latest) throw new ScaffoldError('HFS_ADD_MIGRATION_ORDER', `the current UTC timestamp ${stamp} is not later than the latest migration ${latest}; fix the clock or wait for the next second`);
  const text = sections.map(([, , source]) => template(`be/patterns/${source}`)).join('\n');
  return [{ relative: `supabase/migrations/${stamp}_${sections.map(([name]) => name).join('-')}.sql`, text }];
}

/** The queue imports bullmq, which loads ioredis as an optional peer and cannot connect without it. */
const QUEUE_CLIENTS = Object.freeze(['bullmq', 'ioredis']);

/**
 * hfs.json declares redis in sides.be.backing; the package.json gains the queue's clients at their canon pins, and the managed
 * development scripts of the declared Redis that `starci app sync` renders for it. Each is added when it is missing, so a Redis an
 * earlier capability declared (a cache on ioredis) still gains bullmq; a file already complete is left alone.
 */
function declarationPatches(repoRoot, project) {
  const file = path.join(repoRoot, 'hfs.json');
  const declaration = JSON.parse(read(file));
  declaration.sides.be.backing = [...new Set([...(declaration.sides.be.backing ?? []), 'redis'])].sort(byCodeUnit);
  const packageFile = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(read(packageFile));
  const pins = bundledPins();
  const missing = QUEUE_CLIENTS.filter((name) => typeof pkg.dependencies?.[name] !== 'string');
  for (const name of missing) if (!pins[name]) throw new ScaffoldError('HFS_SCAFFOLD_PIN_MISSING', `${name} has no canon pin in knowledge/hfs/canon-pins.yaml`);
  if (missing.length)
    pkg.dependencies = Object.fromEntries(Object.entries({ ...pkg.dependencies, ...Object.fromEntries(missing.map((name) => [name, pins[name].version])) }).sort(([a], [b]) => a.localeCompare(b)));
  pkg.scripts = { ...pkg.scripts, ...redisDevScripts(project) };
  return [{ file, text: jsonText(declaration) }, { file: packageFile, text: packageJsonText(pkg) }]
    .filter((patch) => patch.text !== read(patch.file));
}

const redisComponent = `redis:
  role: stateful
  image: ${REDIS_IMAGE}
  compose: infra/swarm/stack.yaml
  volumes: [redis-data]
  purpose: ${quoted(REDIS_PURPOSE)}
  required: true
`;

/** The back-end app kinds that run the queue (its relay, workers and schedulers); a cli app only writes the outbox. */
const QUEUE_APP_KINDS = Object.freeze(['api', 'worker']);

/** The stack services of the back-end apps that run the queue: each reaches the declared Redis. */
const queueServicesOf = (repo) => (repo.sides?.be?.apps ?? []).filter((app) => QUEUE_APP_KINDS.includes(app.kind)).map((app) => app.name);

/** The application-stacks.yaml additions of one docker-swarm environment, applied to its text and to its document. */
function declareEnvironment(edit, name, environment, { project, consumers }) {
  const model = edit.value.environments[name];
  edit.append(['environments', name, 'components'], 'redis: {replicas: 1, port: 6379}\n');
  model.components.redis = { replicas: 1, port: 6379 };
  const [backup] = environment.backup ?? [];
  const recovery = `.starcistacks/${name}/infra/swarm/recovery/redis.yaml`;
  const entry = { component: 'redis', target: 'Owner-provisioned encrypted off-host storage for the Redis volume (its AOF and RDB files)', retention: backup?.retention ?? 'Thirty daily snapshots', owner: backup?.owner ?? 'Product operator', restoreProof: recovery };
  edit.append(['environments', name, 'backup'], `- component: redis\n  target: ${quoted(entry.target)}\n  retention: ${quoted(entry.retention)}\n  owner: ${quoted(entry.owner)}\n  restoreProof: ${entry.restoreProof}\n`);
  model.backup.push(entry);
  const [secret] = environment.secrets ?? [];
  const runtimeName = `${project}-${name}-${MEMBER}-v1`;
  const member = { name: MEMBER, runtimeName, version: 1, where: `secrets/${MEMBER}`, recipientPolicy: secret?.recipientPolicy ?? "This app's own age recipient configured in .sops.yaml", keyCustody: secret?.keyCustody ?? "SOPS_AGE_KEY in the host's untracked .claude/secret.env" };
  edit.append(['environments', name, 'secrets'], `- name: ${MEMBER}\n  runtimeName: ${quoted(runtimeName)}\n  version: 1\n  where: secrets/${MEMBER}\n  recipientPolicy: ${quoted(member.recipientPolicy)}\n  keyCustody: ${quoted(member.keyCustody)}\n`);
  model.secrets.push(member);
  const deploy = environment.deploy;
  if (Array.isArray(deploy?.volumes)) {
    edit.append(['environments', name, 'deploy', 'volumes'], `- ${quoted(`${project}-${name}-redis-data`)}\n`);
    model.deploy.volumes.push(`${project}-${name}-redis-data`);
  }
  const grants = deploy?.secrets?.grants;
  if (Array.isArray(grants)) {
    for (const service of [...consumers, 'redis']) {
      const at = grants.findIndex((grant) => grant?.service === service);
      if (at >= 0) {
        edit.append(['environments', name, 'deploy', 'secrets', 'grants', { item: 'service', is: service }, 'from'], `- member: ${MEMBER}\n`);
        model.deploy.secrets.grants[at].from.push({ member: MEMBER });
      } else {
        edit.append(['environments', name, 'deploy', 'secrets', 'grants'], `- service: ${service}\n  from:\n    - member: ${MEMBER}\n`);
        model.deploy.secrets.grants.push({ service, from: [{ member: MEMBER }] });
      }
    }
  }
  return { recovery, runtimeName };
}

/** The services of one Swarm model that run the queue; a model with none of them cannot reach the Redis it would gain. */
function queueServicesIn(file, relative, consumers) {
  const services = parseYaml(read(file))?.services ?? {};
  const present = consumers.filter((name) => services[name]);
  if (!present.length) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${relative} has no service of a back-end api or worker app (${consumers.join(', ') || 'none declared'}); add the declared Redis by hand`);
  return present;
}

const QUEUE_ENVIRONMENT = Object.freeze({ QUEUE_REDIS_HOST: 'redis', QUEUE_REDIS_PORT: '6379', QUEUE_REDIS_PASSWORD_FILE: `/run/secrets/${MEMBER}` });
const QUEUE_ENVIRONMENT_TEXT = `QUEUE_REDIS_HOST: redis\nQUEUE_REDIS_PORT: "6379"\nQUEUE_REDIS_PASSWORD_FILE: /run/secrets/${MEMBER}\n`;
const SECRET_TEXT = `- source: ${MEMBER}\n  target: ${MEMBER}\n`;

/** Adds `block` under the service's `key`, or opens the key with it when the service has none. */
function appendToService(edit, service, key, block, apply) {
  if (edit.value.services[service][key] === undefined) {
    edit.append(['services', service], `${key}:\n${block.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`);
    edit.value.services[service][key] = apply(undefined);
  } else {
    edit.append(['services', service, key], block);
    edit.value.services[service][key] = apply(edit.value.services[service][key]);
  }
}

/** One service that runs the queue reaches the Redis: its address and password file, the secret and the internal network. */
function wireQueueService(edit, service) {
  appendToService(edit, service, 'environment', QUEUE_ENVIRONMENT_TEXT, (environment) => Object.assign(environment ?? {}, QUEUE_ENVIRONMENT));
  appendToService(edit, service, 'secrets', SECRET_TEXT, (secrets) => [...(secrets ?? []), { source: MEMBER, target: MEMBER }]);
  edit.extendFlow(['services', service, 'networks'], 'backing');
  edit.value.services[service].networks.push('backing');
}

/** The Swarm model additions: every service that runs the queue reaches the Redis on an internal network with the shared secret, the Redis persists AOF. */
function stackPatch(file, relative, { name, project, runtimeName, consumers }) {
  const edit = new YamlBlockEdit(read(file), relative);
  const model = edit.value;
  for (const service of consumers) wireQueueService(edit, service);
  const constraints = model.services[consumers[0]].deploy?.placement?.constraints ?? [];
  const redis = {
    image: REDIS_IMAGE,
    command: ['sh', '-c', `exec redis-server --appendonly yes --appendfsync everysec --requirepass "$$(cat /run/secrets/${MEMBER})"`],
    secrets: [{ source: MEMBER, target: MEMBER }],
    volumes: ['redis-data:/data'],
    networks: ['backing'],
    healthcheck: { test: ['CMD-SHELL', `REDISCLI_AUTH="$$(cat /run/secrets/${MEMBER})" redis-cli ping | grep -q PONG`], interval: '30s', timeout: '5s', start_period: '10s', retries: 3 },
    deploy: {
      replicas: 1,
      placement: { constraints },
      update_config: { parallelism: 1, order: 'stop-first', failure_action: 'rollback', monitor: '30s' },
      rollback_config: { parallelism: 1, order: 'stop-first' },
      restart_policy: { condition: 'on-failure', delay: '5s' },
    },
  };
  edit.append(['services'], [
    'redis:',
    `  image: ${REDIS_IMAGE}`,
    `  command: ${JSON.stringify(redis.command)}`,
    '  secrets:',
    `    - source: ${MEMBER}`,
    `      target: ${MEMBER}`,
    '  volumes:',
    '    - redis-data:/data',
    '  networks: [backing]',
    '  healthcheck:',
    `    test: ${JSON.stringify(redis.healthcheck.test)}`,
    '    interval: 30s',
    '    timeout: 5s',
    '    start_period: 10s',
    '    retries: 3',
    '  deploy:',
    '    replicas: 1',
    '    placement:',
    `      constraints: ${JSON.stringify(constraints)}`,
    '    update_config: { parallelism: 1, order: stop-first, failure_action: rollback, monitor: 30s }',
    '    rollback_config: { parallelism: 1, order: stop-first }',
    '    restart_policy: { condition: on-failure, delay: 5s }',
    '',
  ].join('\n'));
  model.services.redis = redis;
  edit.append(['networks'], 'backing:\n  driver: overlay\n  internal: true\n');
  model.networks.backing = { driver: 'overlay', internal: true };
  edit.append(['secrets'], `${MEMBER}:\n  external: true\n  name: ${quoted(runtimeName)}\n`);
  model.secrets[MEMBER] = { external: true, name: runtimeName };
  edit.append(['volumes'], `redis-data:\n  external: true\n  name: ${quoted(`${project}-${name}-redis-data`)}\n`);
  model.volumes['redis-data'] = { external: true, name: `${project}-${name}-redis-data` };
  return { file, text: edit.text() };
}

function imagesLockPatch(file, relative) {
  const edit = new YamlBlockEdit(read(file), relative);
  edit.append(['images'], `redis: ${REDIS_IMAGE}\n`);
  edit.value.images.redis = REDIS_IMAGE;
  return { file, text: edit.text() };
}

const recoveryRecord = `component: "redis"
status: "pending-owner-restore-proof"
executedAt: null
plan: "Restore the encrypted redis-data volume backup in isolation, start redis-server with --appendonly yes on it and verify the queued and failed BullMQ jobs of every queue."
ownerAction: "Replace this record with the backup hash, isolated destination, timestamp and verification receipt before production."
`;

const KEY_ROWS = [
  '| `QUEUE_REDIS_HOST` | API queue transport: the declared Redis service `redis` on the internal backing network |',
  '| `QUEUE_REDIS_PORT` | API queue transport |',
  '| `QUEUE_REDIS_PASSWORD` | API queue transport and the redis service (`requirepass`); reads `QUEUE_REDIS_PASSWORD_FILE` at `/run/secrets/redis-password`; holds no trailing newline |',
];

/** The key roster gains the queue keys after the last row of its first table. */
function keysPatch(file) {
  const lines = read(file).replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  if (first < 0) return null;
  let last = first;
  while (lines[last + 1]?.startsWith('|')) last += 1;
  lines.splice(last + 1, 0, ...KEY_ROWS);
  return { file, text: lines.join('\n') };
}

/** Every stack file the declared Redis adds to or changes, planned before anything is written. */
function stackFiles(repoRoot, { project, consumers }) {
  const manifestRelative = '.starcistacks/application-stacks.yaml';
  const manifestFile = path.join(repoRoot, ...manifestRelative.split('/'));
  if (!fs.existsSync(manifestFile)) return { patches: [], created: [], environments: [] };
  const manifest = parseYaml(read(manifestFile));
  if (manifest?.components?.redis) return { patches: [], created: [], environments: [] };
  const swarm = Object.entries(manifest?.environments ?? {}).filter(([, environment]) => environment?.runtime === 'docker-swarm');
  const edit = new YamlBlockEdit(read(manifestFile), manifestRelative);
  edit.append(['components'], redisComponent);
  edit.value.components.redis = { role: 'stateful', image: REDIS_IMAGE, compose: 'infra/swarm/stack.yaml', volumes: ['redis-data'], purpose: REDIS_PURPOSE, required: true };
  const patches = [];
  const created = [];
  for (const [name, environment] of swarm) {
    const compose = `.starcistacks/${name}/${environment.composeFiles?.[0] ?? 'infra/swarm/stack.yaml'}`;
    const composeFile = path.join(repoRoot, ...compose.split('/'));
    const services = queueServicesIn(composeFile, compose, consumers);
    const { recovery, runtimeName } = declareEnvironment(edit, name, environment, { project, consumers: services });
    patches.push(stackPatch(composeFile, compose, { name, project, runtimeName, consumers: services }));
    const lock = environment.release?.imagesLock;
    if (lock && fs.existsSync(path.join(repoRoot, ...lock.split('/')))) patches.push(imagesLockPatch(path.join(repoRoot, ...lock.split('/')), lock));
    const keys = path.join(repoRoot, '.starcistacks', name, 'runtime', 'env', 'KEYS.md');
    if (fs.existsSync(keys)) patches.push(keysPatch(keys));
    if (!fs.existsSync(path.join(repoRoot, ...recovery.split('/')))) created.push({ relative: recovery, text: recoveryRecord });
  }
  patches.unshift({ file: manifestFile, text: edit.text() });
  return { patches: patches.filter(Boolean), created, environments: swarm.map(([name]) => name) };
}

/**
 * Plans the lite additions of `add queue|job` before any file is written; returns null outside lite or for another noun. The
 * plan's apply() writes them and returns the app-relative paths it created or changed. A new migration regenerates the
 * database types through `emitTypes` (the local Supabase stack, as `add table`); false is the `--no-types` seam.
 */
export function planLiteQueue({ repoRoot, repo, noun, patterns, now, emitTypes = emitDbTypes }) {
  if (repo.edition !== 'lite' || !['queue', 'job'].includes(noun)) return null;
  const beRoot = path.join(repoRoot, 'be');
  const migrations = migrationFiles({ repoRoot, beRoot, patterns, now });
  const database = skeletonFiles(repoRoot);
  const declaration = declarationPatches(repoRoot, repo.project);
  const stack = stackFiles(repoRoot, { project: repo.project, consumers: queueServicesOf(repo) });
  const created = [...migrations, ...database.created, ...stack.created];
  const patches = [...database.patches, ...declaration, ...stack.patches];
  const clashes = created.filter((entry) => fs.existsSync(path.join(repoRoot, ...entry.relative.split('/')))).map((entry) => entry.relative);
  if (clashes.length) throw new ScaffoldError('HFS_ADD_EXISTS', `add ${noun} would overwrite ${clashes.join(', ')}`);
  return {
    apply() {
      for (const entry of created) {
        const target = path.join(repoRoot, ...entry.relative.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.text);
      }
      for (const patch of patches) fs.writeFileSync(patch.file, patch.text);
      const exported = registerLiteExports({ root: repoRoot, generator: 'queue' });
      const sealed = sealRedisMembers(repoRoot, stack.environments);
      const changed = patches.map((patch) => path.relative(repoRoot, patch.file).split(path.sep).join('/'));
      const types = migrations.length && typeof emitTypes === 'function' ? writeTypes(repoRoot, emitTypes) : [];
      return [...new Set([...created.map((entry) => entry.relative), ...changed, ...exported, ...sealed, ...types])];
    },
  };
}

/** The SQL of the new capabilities names public.queue and public.jobs, which the generated database types must declare. */
function writeTypes(repoRoot, emitTypes) {
  const generated = emitTypes({ root: repoRoot });
  if (typeof generated !== 'string') return [];
  const target = path.join(repoRoot, ...dbTypesPath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generated);
  return [dbTypesPath];
}

/** Seals a placeholder redis-password member to the app's configured recipient; without one, `starci app secret init` seals it. */
function sealRedisMembers(repoRoot, environments) {
  if (!environments.length || !fs.existsSync(path.join(repoRoot, '.sops.yaml'))) return [];
  const recipients = (env) => configuredRecipients(repoRoot, path.join(repoRoot, '.starcistacks', env, 'secrets', `${MEMBER}.enc`));
  let single;
  try { single = environments.every((env) => recipients(env).length === 1); } catch { single = false; }
  if (!single) return [];
  return materializeDeclaredPlaceholders(repoRoot, {
    recipientsForFile: (file) => configuredRecipients(repoRoot, file),
    only: (member) => member.slug === MEMBER && environments.includes(member.env),
  }).members;
}
