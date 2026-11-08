// `starci app add queue|job` in a lite app (R212): the queue is full's BullMQ adapter on the declared Redis, so lite
// generates full's queue and jobs trees with three differences. The outbox and job tables are a db migration instead of the
// TypeORM entity, connection and migration; the SQL names the public schema; and the queue options read the Redis password of
// its sealed secret. The verb also declares redis in hfs.json sides.be.backing with its bullmq client, and renders the one
// declared Redis into every docker-swarm environment of the stack: the stateful component, its backup and restore record, the
// sealed redis-password member and its grants, the AOF service on a named volume and an internal network, and the images lock.
// A full app gets the same persisted Redis through planFullQueue, which runs the stack renderer below with `sealed: false`: full's
// queue config reads QUEUE_REDIS_HOST and QUEUE_REDIS_PORT and no password, so the full Redis has no sealed member and no grants; it
// reaches the api and worker services over the internal backing network only, and the dev environment runs it from its compose file.
import { nextMigrationStamp } from './migration-stamp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { configuredRecipients } from '../runtime/scripts/hfs/secret-init.mjs';
import { materializeDeclaredPlaceholders } from '../runtime/scripts/hfs/sealed-members.mjs';
import { REDIS_IMAGE, TEMPLATES_DIR, redisDevScripts, render } from '../sync/index.mjs';
import { byCodeUnit } from '../report/order.mjs';
import { withSqlIdentifierError } from './add-database-lite.mjs';
import { jsonText, packageJsonText } from './app.mjs';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { registerLiteExports } from './lite-exports.mjs';
import { ScaffoldError } from './service.mjs';
import { YamlBlockEdit } from './yaml-block-edit.mjs';
import type { TreeEntry } from './add-plan.mjs';

// reason: a node of a parsed YAML document (the application stacks, a Swarm model); the shape is the repository's, edited in place by YamlBlockEdit.
type YamlNode = any;

/** A file the verb creates, relative to the app root. */
interface GeneratedFile {
  readonly relative: string;
  readonly text: string;
}

/** A change to an existing file, by absolute path. */
interface FilePatch {
  readonly file: string;
  readonly text: string;
}

/** The part of the app declaration the lite queue plan reads. */
interface LiteRepo {
  readonly edition?: string;
  readonly project: string;
  readonly sides?: { readonly be?: { readonly apps?: ReadonlyArray<{ readonly name: string; readonly kind: string }> } };
}

/** The pattern topics whose lite templates this package carries; `starci app add` refuses the other lite-adapted topics. */
export const LITE_TEMPLATED_TOPICS = Object.freeze(['jobs', 'queues']);

const LITE_TEMPLATES: Readonly<Record<string, string>> = Object.freeze({
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
  'queues/platform/queue-outbox.service.ts.tpl': 'queues/platform-lite/queue-outbox.service.ts.tpl',
  'queues/platform/queue-outbox.service.spec.ts.tpl': 'queues/platform-lite/queue-outbox.service.spec.ts.tpl',
  'jobs/platform/jobs.index.ts.tpl': 'jobs/platform-lite/jobs.index.ts.tpl',
  'jobs/platform/job-claim.service.ts.tpl': 'jobs/platform-lite/job-claim.service.ts.tpl',
  'jobs/platform/job-claim.service.spec.ts.tpl': 'jobs/platform-lite/job-claim.service.spec.ts.tpl',
  // The jobs module composes the one tick scheduler (R335): ScheduleModule.forRoot() and JobTickService.
  'jobs/platform/jobs.module.ts.tpl': 'jobs/platform-lite/jobs.module.ts.tpl',
});

/** The tick scheduler of platform/jobs the lite jobs capability adds beside full's tree: the ticks as data, the scheduler and its spec (R335). */
export const TICK_FILES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['be/src/modules/platform/jobs/job-ticks.contracts.ts', 'jobs/platform-lite/job-ticks.contracts.ts.tpl'],
  ['be/src/modules/platform/jobs/job-tick.service.ts', 'jobs/platform-lite/job-tick.service.ts.tpl'],
  ['be/src/modules/platform/jobs/job-tick.service.spec.ts', 'jobs/platform-lite/job-tick.service.spec.ts.tpl'],
]);

/** The tick files of a jobs capability the verb adds for the first time; an app that already has platform/jobs keeps its own. */
function tickFiles({ beRoot, patterns }: { beRoot: string, patterns: readonly string[] }): GeneratedFile[] {
  if (!patterns.includes('fenced-job') || fs.existsSync(path.join(beRoot, 'src', 'modules', 'platform', 'jobs', 'index.ts'))) return [];
  return TICK_FILES.map(([relative, source]) => ({ relative, text: template(`be/patterns/${source}`) }));
}

/**
 * The persistence files lite leaves out: the TypeORM schema (its authority is db/migrations) and the SQL text and row files (the
 * statements are database functions of the lite migration, called through callDbFunction; R334 and the be.persistence lite overlay).
 */
const TYPEORM_ONLY = /\/persistence\/(?:connection\.ts$|entities\/|migrations\/|[^/]+\.(?:sql|rows)\.ts$)/;

/** The e2e proof slot lite forbids (R212); a lite pattern proves itself with optional integration specs (the topic's liteAdapter proof). */
const E2E_SLOT = 'be.tests.e2e';

/**
 * The lite entries of a queue or jobs topic tree: no TypeORM schema file or e2e proof, and the lite body where the package carries one.
 */
export const selectLiteQueueEntries = (topic: string, entries: TreeEntry[]): TreeEntry[] => (LITE_TEMPLATED_TOPICS.includes(topic)
  ? [...entries.filter((entry) => !TYPEORM_ONLY.test(entry.path) && entry.slot !== E2E_SLOT)
    .map((entry): TreeEntry => {
      const lite = entry.template === undefined ? undefined : LITE_TEMPLATES[entry.template];
      return lite ? { ...entry, template: lite } : entry;
    })]
  : entries);

const MIGRATION = /^(\d{14})_[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.sql$/;
const REDIS_PURPOSE = 'The declared Redis of the queue (hfs.json sides.be.backing) - one instance with AOF persistence (appendonly yes) on the named volume redis-data, on the internal backing network only, reached by the api and worker services as redis:6379 with the password of its sealed secret.';
const REDIS_PURPOSE_UNSEALED = 'The declared Redis of the queue (hfs.json sides.be.backing) - one instance with AOF persistence (appendonly yes) and no eviction (maxmemory-policy noeviction) on the named volume redis-data, on the internal backing network only, reached by the api and worker services as redis:6379.';
const purposeOf = (sealed: boolean) => (sealed ? REDIS_PURPOSE : REDIS_PURPOSE_UNSEALED);
const MEMBER = 'redis-password';
const quoted = (value: unknown) => JSON.stringify(value);
const read = (file: string) => fs.readFileSync(file, 'utf8');
const template = (relative: string) => read(path.join(TEMPLATES_DIR, ...relative.split('/'))).replace(/\r\n/g, '\n');

const DATABASE_ERROR = 'be/src/modules/platform/database/errors/database.error.ts';

/** Skeleton files the lite starter leaves out and the queue capabilities use, each from its skeleton template. */
const SKELETON_FILES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['be/src/modules/platform/database/database.sql.ts', 'skeleton-lite/src/modules/platform/database/database.sql.ts'],
  ['be/src/modules/platform/primitives/sequence.policy.ts', 'skeleton/src/modules/platform/primitives/sequence.policy.ts'],
]);

/** The sql tag of the outbox and claim statements (with its identifier error) and the in-order relay the queue adapters walk their rows with. */
function skeletonFiles(repoRoot: string): { created: GeneratedFile[], patches: FilePatch[] } {
  const created = SKELETON_FILES.filter(([relative]) => !fs.existsSync(path.join(repoRoot, ...relative.split('/'))))
    .map(([relative, source]) => ({ relative, text: render(template(`be/${source}`), {}) }));
  const errorFile = path.join(repoRoot, ...DATABASE_ERROR.split('/'));
  const before = fs.existsSync(errorFile) ? read(errorFile).replace(/\r\n/g, '\n') : null;
  const after = before === null ? null : withSqlIdentifierError(before);
  return { created, patches: after !== null && after !== before ? [{ file: errorFile, text: after }] : [] };
}

/** The capability tables a platform capability the verb adds for the first time needs, as one forward-only db migration. */
function migrationFiles({ repoRoot, beRoot, patterns, now }: { repoRoot: string, beRoot: string, patterns: readonly string[], now: () => number }): GeneratedFile[] {
  const candidates: Array<[string, string, string, string]> = [
    ['queue-outbox', 'queue', 'queues/platform-lite/queue-outbox.sql.tpl', 'queue'],
    ['jobs', 'fenced-job', 'jobs/platform-lite/jobs.sql.tpl', 'jobs'],
  ];
  const sections = candidates.filter(([, pattern, , capability]) => patterns.includes(pattern) && !fs.existsSync(path.join(beRoot, 'src', 'modules', 'platform', capability, 'index.ts')));
  if (!sections.length) return [];
  const folder = path.join(repoRoot, 'db', 'migrations');
  const migrations = fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => MIGRATION.test(file)).sort(byCodeUnit) : [];
  const latest = migrations.at(-1)?.slice(0, 14);
  const stamp = nextMigrationStamp(now, latest);
  const text = sections.map(([, , source]) => template(`be/patterns/${source}`)).join('\n');
  return [{ relative: `db/migrations/${stamp}_${sections.map(([name]) => name).join('-')}.sql`, text }];
}

/** The queue imports bullmq, which loads ioredis as an optional peer and cannot connect without it. */
const QUEUE_CLIENTS = Object.freeze(['bullmq', 'ioredis']);
/** The jobs capability's tick scheduler imports @nestjs/schedule and its CronJob (R335). */
const SCHEDULER_CLIENTS = Object.freeze(['@nestjs/schedule', 'cron']);

/**
 * hfs.json declares redis in sides.be.backing; the package.json gains the queue's clients (and, for fenced-job, the tick
 * scheduler's) at their canon pins, and the managed
 * development scripts of the declared Redis that `starci app sync` renders for it. Each is added when it is missing, so a Redis an
 * earlier capability declared (a cache on ioredis) still gains bullmq; a file already complete is left alone.
 */
function declarationPatches(repoRoot: string, project: string, patterns: readonly string[]): FilePatch[] {
  const packageFile = path.join(repoRoot, 'package.json');
  const pkg = withClients(JSON.parse(read(packageFile)), [...QUEUE_CLIENTS, ...(patterns.includes('fenced-job') ? SCHEDULER_CLIENTS : [])]);
  pkg.scripts = { ...pkg.scripts, ...redisDevScripts(project) };
  return [backingPatch(repoRoot), { file: packageFile, text: packageJsonText(pkg) }].filter((patch) => patch.text !== read(patch.file));
}

/** hfs.json with redis in sides.be.backing, the Redis the queue's clients connect to. */
function backingPatch(repoRoot: string): FilePatch {
  const file = path.join(repoRoot, 'hfs.json');
  const declaration = JSON.parse(read(file));
  declaration.sides.be.backing = [...new Set([...(declaration.sides.be.backing ?? []), 'redis'])].sort(byCodeUnit);
  return { file, text: jsonText(declaration) };
}

/** The package manifest with each client it lacks added at its canon pin; a client it already depends on is left as it is. */
function withClients(pkg: { dependencies?: Record<string, string> }, clients: readonly string[]): { dependencies?: Record<string, string>, scripts?: Record<string, string> } {
  const pins = bundledPins();
  const added = clients.filter((name) => typeof pkg.dependencies?.[name] !== 'string').map((name): [string, string] => {
    const pin = pins[name];
    if (!pin) throw new ScaffoldError('HFS_SCAFFOLD_PIN_MISSING', `${name} has no canon pin in knowledge/hfs/canon-pins.yaml`);
    return [name, pin.version];
  });
  if (!added.length) return pkg;
  return { ...pkg, dependencies: Object.fromEntries(Object.entries({ ...pkg.dependencies, ...Object.fromEntries(added) }).sort(([a], [b]) => a.localeCompare(b))) };
}

/**
 * `add queue|job` in a full app: hfs.json declares redis in sides.be.backing and the package.json gains the queue's clients at their
 * canon pins, so the generated platform/queue compiles; the stack declares the one Redis the queue needs, persisted (AOF on a named
 * volume, no eviction), as lite does but without a password (full's queue config reads QUEUE_REDIS_HOST and QUEUE_REDIS_PORT alone).
 * A stack that already declares a redis component is the owner's and is left as it is.
 */
export function planFullQueue({ repoRoot, repo, noun, planned }: { repoRoot: string, repo: LiteRepo, noun: string, planned: ReadonlyArray<{ absolute: string, body: string }> }): { apply(): string[] } | null {
  if (repo.edition === 'lite' || !['queue', 'job'].includes(noun)) return null;
  requirePlatform(repoRoot, noun, planned);
  const packageFile = path.join(repoRoot, 'package.json');
  const stack = stackFiles(repoRoot, { project: repo.project, consumers: queueServicesOf(repo), sealed: false });
  const patches = [backingPatch(repoRoot), { file: packageFile, text: packageJsonText(withClients(JSON.parse(read(packageFile)), QUEUE_CLIENTS)) }, ...stack.patches]
    .filter((patch) => patch.text !== read(patch.file));
  const clashes = stack.created.filter((entry) => fs.existsSync(path.join(repoRoot, ...entry.relative.split('/')))).map((entry) => entry.relative);
  if (clashes.length) throw new ScaffoldError('HFS_ADD_EXISTS', `add ${noun} would overwrite ${clashes.join(', ')}`);
  return {
    apply() {
      for (const entry of stack.created) {
        const target = path.join(repoRoot, ...entry.relative.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, entry.text);
      }
      for (const patch of patches) fs.writeFileSync(patch.file, patch.text);
      return [...stack.created.map((entry) => entry.relative), ...patches.map((patch) => path.relative(repoRoot, patch.file).split(path.sep).join('/'))];
    },
  };
}

const PLATFORM_IMPORT = /from "@modules\/platform\/([a-z][a-z0-9-]*)"/g;
const PLATFORM_DIR = 'be/src/modules/platform';
const LOGGING_CORRELATION = Object.freeze({ files: ['correlation.policy.ts', 'correlation.port.ts'], symbols: ['CORRELATION_RUNNER', 'InjectCorrelationRunner'] });

/**
 * A full app's queue and jobs trees import the platform capabilities the canon skeleton carries (platform/ids, the logging
 * correlation runner, ...). The verb writes none of them into an app that predates them, and a barrel patched to export
 * files that are not there breaks the build, so it refuses before it writes anything, naming each missing piece.
 */
function requirePlatform(repoRoot: string, noun: string, planned: ReadonlyArray<{ absolute: string, body: string }>): void {
  const platform = path.join(repoRoot, ...PLATFORM_DIR.split('/'));
  const generated = new Set(planned.map((file) => path.relative(platform, file.absolute).split(path.sep)[0]));
  const imported = new Set(planned.flatMap((file) => [...file.body.matchAll(PLATFORM_IMPORT)].map((match) => match[1]!)));
  const missing = [...imported].filter((name) => !generated.has(name) && !fs.existsSync(path.join(platform, name, 'index.ts'))).map((name) => `${PLATFORM_DIR}/${name}`);
  const logging = path.join(platform, 'logging');
  const decorators = fs.existsSync(path.join(logging, 'logging.decorators.ts')) ? read(path.join(logging, 'logging.decorators.ts')) : '';
  const absent = [...LOGGING_CORRELATION.files.filter((file) => !fs.existsSync(path.join(logging, file))).map((file) => `${PLATFORM_DIR}/logging/${file}`),
    ...LOGGING_CORRELATION.symbols.filter((symbol) => !new RegExp(String.raw`\bexport (?:const|function) ${symbol}\b`).test(decorators)).map((symbol) => `${symbol} in ${PLATFORM_DIR}/logging/logging.decorators.ts`)];
  if (!missing.length && !absent.length) return;
  throw new ScaffoldError('HFS_ADD_PLATFORM_MISSING', `add ${noun} needs platform capabilities this app lacks: ${[...missing, ...absent].join(', ')}; the canon skeleton carries them under templates/be/skeleton/src/modules/platform of @starci/hfs - copy them in and register their modules in the composition (IdsModule.register({ isGlobal: true })), then run the verb again. Nothing was written`);
}

const redisComponent = (sealed: boolean) => `redis:
  role: stateful
  image: ${REDIS_IMAGE}
  compose: infra/swarm/stack.yaml
  volumes: [redis-data]
  purpose: ${quoted(purposeOf(sealed))}
  required: true
`;

/** The back-end app kinds that run the queue (its relay, workers and schedulers); a cli app only writes the outbox. */
const QUEUE_APP_KINDS = Object.freeze(['api', 'worker']);

/** The stack services of the back-end apps that run the queue: each reaches the declared Redis. */
const queueServicesOf = (repo: LiteRepo): string[] => (repo.sides?.be?.apps ?? []).filter((app) => QUEUE_APP_KINDS.includes(app.kind)).map((app) => app.name);

/** The application-stacks.yaml additions of one docker-swarm environment, applied to its text and to its document. */
function declareEnvironment(edit: YamlBlockEdit, name: string, environment: YamlNode, { project, consumers, sealed }: { project: string, consumers: readonly string[], sealed: boolean }): { recovery: string, runtimeName: string } {
  const model = edit.value.environments[name];
  edit.append(['environments', name, 'components'], 'redis: {replicas: 1, port: 6379}\n');
  model.components.redis = { replicas: 1, port: 6379 };
  const [backup] = environment.backup ?? [];
  const recovery = `.starcistacks/${name}/infra/swarm/recovery/redis.yaml`;
  const entry = { component: 'redis', target: 'Owner-provisioned encrypted off-host storage for the Redis volume (its AOF and RDB files)', retention: backup?.retention ?? 'Thirty daily snapshots', owner: backup?.owner ?? 'Product operator', restoreProof: recovery };
  const backupText = `- component: redis\n  target: ${quoted(entry.target)}\n  retention: ${quoted(entry.retention)}\n  owner: ${quoted(entry.owner)}\n  restoreProof: ${entry.restoreProof}\n`;
  if (Array.isArray(model.backup)) {
    edit.append(['environments', name, 'backup'], backupText);
    model.backup.push(entry);
  } else {
    edit.append(['environments', name], `backup:\n${backupText.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`);
    model.backup = [entry];
  }
  const runtimeName = `${project}-${name}-${MEMBER}-v1`;
  const deploy = environment.deploy;
  if (Array.isArray(deploy?.volumes)) {
    edit.append(['environments', name, 'deploy', 'volumes'], `- ${quoted(`${project}-${name}-redis-data`)}\n`);
    model.deploy.volumes.push(`${project}-${name}-redis-data`);
  }
  if (sealed) declareSealedMember(edit, name, environment, { consumers, runtimeName });
  return { recovery, runtimeName };
}

/** The sealed redis-password member of one environment and the grants that hand it to the redis service and every service that runs the queue. */
function declareSealedMember(edit: YamlBlockEdit, name: string, environment: YamlNode, { consumers, runtimeName }: { consumers: readonly string[], runtimeName: string }): void {
  const model = edit.value.environments[name];
  const [secret] = environment.secrets ?? [];
  const member = { name: MEMBER, runtimeName, version: 1, where: `secrets/${MEMBER}`, recipientPolicy: secret?.recipientPolicy ?? "This app's own age recipient configured in .sops.yaml", keyCustody: secret?.keyCustody ?? "SOPS_AGE_KEY in the host's untracked .claude/secret.env" };
  edit.append(['environments', name, 'secrets'], `- name: ${MEMBER}\n  runtimeName: ${quoted(runtimeName)}\n  version: 1\n  where: secrets/${MEMBER}\n  recipientPolicy: ${quoted(member.recipientPolicy)}\n  keyCustody: ${quoted(member.keyCustody)}\n`);
  model.secrets.push(member);
  const grants = environment.deploy?.secrets?.grants;
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
}

/** The services of one Swarm model that run the queue; a model with none of them cannot reach the Redis it would gain. */
function queueServicesIn(file: string, relative: string, consumers: readonly string[]): string[] {
  const services = parseYaml(read(file))?.services ?? {};
  const present = consumers.filter((name) => services[name]);
  if (!present.length) throw new ScaffoldError('HFS_ADD_STACK_SHAPE', `${relative} has no service of a back-end api or worker app (${consumers.join(', ') || 'none declared'}); add the declared Redis by hand`);
  return present;
}

const QUEUE_ENVIRONMENT = Object.freeze({ QUEUE_REDIS_HOST: 'redis', QUEUE_REDIS_PORT: '6379', QUEUE_REDIS_PASSWORD_FILE: `/run/secrets/${MEMBER}` });
const QUEUE_ENVIRONMENT_TEXT = `QUEUE_REDIS_HOST: redis\nQUEUE_REDIS_PORT: "6379"\nQUEUE_REDIS_PASSWORD_FILE: /run/secrets/${MEMBER}\n`;
/** A full app's queue config reads the Redis address alone (queue.config.ts), so its services get no password file and no secret. */
const QUEUE_ENVIRONMENT_UNSEALED = Object.freeze({ QUEUE_REDIS_HOST: 'redis', QUEUE_REDIS_PORT: '6379' });
const QUEUE_ENVIRONMENT_UNSEALED_TEXT = 'QUEUE_REDIS_HOST: redis\nQUEUE_REDIS_PORT: "6379"\n';
const SECRET_TEXT = `- source: ${MEMBER}\n  target: ${MEMBER}\n`;

/** Adds `block` under the service's `key`, or opens the key with it when the service has none. */
export function appendToService(edit: YamlBlockEdit, service: string, key: string, block: string, apply: (current: YamlNode) => unknown): void {
  if (edit.value.services[service][key] === undefined) {
    edit.append(['services', service], `${key}:\n${block.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`);
    edit.value.services[service][key] = apply(undefined);
  } else {
    edit.append(['services', service, key], block);
    edit.value.services[service][key] = apply(edit.value.services[service][key]);
  }
}

/** One service that runs the queue reaches the Redis: its address and password file, the secret and the internal network. */
function wireQueueService(edit: YamlBlockEdit, service: string, sealed: boolean): void {
  appendToService(edit, service, 'environment', sealed ? QUEUE_ENVIRONMENT_TEXT : QUEUE_ENVIRONMENT_UNSEALED_TEXT,
    (environment: YamlNode) => Object.assign(environment ?? {}, sealed ? QUEUE_ENVIRONMENT : QUEUE_ENVIRONMENT_UNSEALED));
  if (sealed) appendToService(edit, service, 'secrets', SECRET_TEXT, (secrets: YamlNode) => [...(secrets ?? []), { source: MEMBER, target: MEMBER }]);
  if (edit.value.services[service].networks?.includes('backing')) return; // a full stack's backing network already carries its database
  edit.extendFlow(['services', service, 'networks'], 'backing');
  edit.value.services[service].networks.push('backing');
}

/** The Swarm model additions: every service that runs the queue reaches the Redis on an internal network with the shared secret, the Redis persists AOF. */
function stackPatch(file: string, relative: string, { name, project, runtimeName, consumers, sealed }: { name: string, project: string, runtimeName: string, consumers: readonly string[], sealed: boolean }): FilePatch {
  const edit = new YamlBlockEdit(read(file), relative);
  const model = edit.value;
  for (const service of consumers) wireQueueService(edit, service, sealed);
  const constraints = model.services[consumers[0]!].deploy?.placement?.constraints ?? [];
  const redis = {
    image: REDIS_IMAGE,
    command: sealed
      ? ['sh', '-c', `exec redis-server --appendonly yes --appendfsync everysec --requirepass "$$(cat /run/secrets/${MEMBER})"`]
      : ['redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--maxmemory-policy', 'noeviction'],
    ...(sealed ? { secrets: [{ source: MEMBER, target: MEMBER }] } : {}),
    volumes: ['redis-data:/data'],
    networks: ['backing'],
    healthcheck: { test: sealed ? ['CMD-SHELL', `REDISCLI_AUTH="$$(cat /run/secrets/${MEMBER})" redis-cli ping | grep -q PONG`] : ['CMD', 'redis-cli', 'ping'], interval: '30s', timeout: '5s', start_period: '10s', retries: 3 },
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
    ...(sealed ? ['  secrets:', `    - source: ${MEMBER}`, `      target: ${MEMBER}`] : []),
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
  if (model.networks?.backing === undefined) {
    edit.append(['networks'], 'backing:\n  driver: overlay\n  internal: true\n');
    model.networks.backing = { driver: 'overlay', internal: true };
  }
  if (sealed) {
    edit.append(['secrets'], `${MEMBER}:\n  external: true\n  name: ${quoted(runtimeName)}\n`);
    model.secrets[MEMBER] = { external: true, name: runtimeName };
  }
  edit.append(['volumes'], `redis-data:\n  external: true\n  name: ${quoted(`${project}-${name}-redis-data`)}\n`);
  model.volumes['redis-data'] = { external: true, name: `${project}-${name}-redis-data` };
  return { file, text: edit.text() };
}

function imagesLockPatch(file: string, relative: string): FilePatch {
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

/** The rows of a full app: its queue config reads the Redis address alone (the Redis has no password). */
const KEY_ROWS_UNSEALED = [
  '| `QUEUE_REDIS_HOST` | API queue transport: the declared Redis (the service `redis` on the internal backing network of a Swarm environment, the loopback compose service of dev) |',
  '| `QUEUE_REDIS_PORT` | API queue transport: the port of the declared Redis |',
];

/** The key roster gains the queue keys after the last row of its first table; a roster that lists them already is left alone. */
function keysPatch(file: string, sealed: boolean): FilePatch | null {
  const text = read(file);
  if (text.includes('`QUEUE_REDIS_HOST`')) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.startsWith('|'));
  if (first < 0) return null;
  let last = first;
  while (lines[last + 1]?.startsWith('|')) last += 1;
  lines.splice(last + 1, 0, ...(sealed ? KEY_ROWS : KEY_ROWS_UNSEALED));
  return { file, text: lines.join('\n') };
}

const DEV_REDIS_PORT = 56379;

/** The redis service a dev compose file gains: loopback only, append-only with no eviction, on the host port the environment declares. */
const devRedisService = `redis:
  image: ${REDIS_IMAGE}
  command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec", "--maxmemory-policy", "noeviction"]
  ports:
    - "127.0.0.1:\${STACK_PORT_REDIS}:6379"
  volumes:
    - redis-data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 20
  restart: unless-stopped
`;

/** The document form of devRedisService, for the edit that checks the compose file still parses to what it was plus this service. */
const devRedisValue = {
  image: REDIS_IMAGE,
  command: ['redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--maxmemory-policy', 'noeviction'],
  ports: ['127.0.0.1:${STACK_PORT_REDIS}:6379'],
  volumes: ['redis-data:/data'],
  healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '5s', timeout: '3s', retries: 20 },
  restart: 'unless-stopped',
};

/**
 * The dev compose file with the redis service at the end of its services and the named volume redis-data; the owner's comments and other
 * keys stay. A queue service the compose file runs itself (`inCompose`) reaches the Redis by its service name, on the networks it is on.
 */
function devComposePatch(file: string, relative: string, inCompose: readonly string[]): FilePatch {
  const edit = new YamlBlockEdit(read(file), relative);
  const networks: string[] | undefined = inCompose.length ? edit.value.services[inCompose[0]!].networks : undefined;
  const joined = Array.isArray(networks) && networks.length ? { text: `  networks: [${networks.join(', ')}]\n`, networks: [...networks] } : null;
  edit.append(['services'], `${devRedisService}${joined?.text ?? ''}`);
  edit.value.services.redis = { ...devRedisValue, ...(joined ? { networks: joined.networks } : {}) };
  for (const service of inCompose) {
    appendToService(edit, service, 'environment', QUEUE_ENVIRONMENT_UNSEALED_TEXT, (environment: YamlNode) => Object.assign(environment ?? {}, QUEUE_ENVIRONMENT_UNSEALED));
  }
  if (edit.value.volumes === undefined) {
    edit.lines.push('volumes:', '  redis-data: {}');
    edit.value.volumes = { 'redis-data': {} };
  } else {
    edit.append(['volumes'], 'redis-data: {}\n');
    edit.value.volumes['redis-data'] = {};
  }
  return { file, text: `${edit.text().replace(/\n*$/, '')}\n` };
}

/**
 * A docker-compose dev environment (runtime docker-compose, a `local` block) runs the declared Redis from its compose file, on its own loopback
 * port, and the queue processes reach it there: the compose service, the port, the service entry and the api and worker processes' queue settings.
 */
function devQueuePatches(repoRoot: string, manifest: YamlNode, edit: YamlBlockEdit, { consumers, sealed }: { consumers: readonly string[], sealed: boolean }): FilePatch[] {
  const patches: FilePatch[] = [];
  const dev = Object.entries<YamlNode>(manifest?.environments ?? {}).filter(([, environment]) => environment?.runtime === 'docker-compose' && environment.local);
  for (const [name, environment] of dev) {
    const composeRelative = `.starcistacks/${name}/${environment.composeFiles?.[0] ?? 'infra/compose/compose.yaml'}`;
    const composeFile = path.join(repoRoot, ...composeRelative.split('/'));
    if (/^ {2}redis:/m.test(read(composeFile).replace(/\r\n/g, '\n'))) continue;
    const base = ['environments', name] as const;
    const value = edit.value.environments[name];
    edit.append([...base, 'components'], `redis: {port: ${DEV_REDIS_PORT}}\n`);
    value.components.redis = { port: DEV_REDIS_PORT };
    edit.append([...base, 'local', 'ports'], `redis: ${DEV_REDIS_PORT}\n`);
    value.local.ports.redis = DEV_REDIS_PORT;
    // A queue service the compose file runs waits for the Redis, so the Redis comes first in the dependency order of the services.
    const inCompose = sealed ? [] : consumers.filter((consumer) => parseYaml(read(composeFile))?.services?.[consumer] !== undefined);
    if (inCompose.length) {
      edit.prepend([...base, 'local', 'services'], '- {name: redis, wait: healthy}\n');
      value.local.services.unshift({ name: 'redis', wait: 'healthy' });
    } else {
      edit.append([...base, 'local', 'services'], '- {name: redis, wait: healthy}\n');
      value.local.services.push({ name: 'redis', wait: 'healthy' });
    }
    for (const run of value.local.processes ?? []) {
      if (!consumers.includes(run.name)) continue;
      const entries = { ...(sealed ? { QUEUE_ENABLED: 'true' } : {}), QUEUE_REDIS_HOST: '127.0.0.1', QUEUE_REDIS_PORT: '${port.redis}' };
      const text = Object.entries(entries).map(([key, entry]) => `${key}: ${entry === '127.0.0.1' ? entry : JSON.stringify(entry)}\n`).join('');
      const target = [...base, 'local', 'processes', { item: 'name', is: run.name }] as const;
      if (run.env === undefined) {
        edit.append(target, `env:\n${text.replace(/\n$/, '').split('\n').map((line) => `  ${line}`).join('\n')}\n`);
        run.env = entries;
      } else {
        edit.append([...target, 'env'], text);
        Object.assign(run.env, entries);
      }
    }
    patches.push(devComposePatch(composeFile, composeRelative, inCompose));
    const keys = path.join(repoRoot, '.starcistacks', name, 'runtime', 'env', 'KEYS.md');
    const roster = sealed || !fs.existsSync(keys) ? null : keysPatch(keys, false);
    if (roster) patches.push(roster);
  }
  return patches;
}

/** Every stack file the declared Redis adds to or changes, planned before anything is written. */
function stackFiles(repoRoot: string, { project, consumers, sealed }: { project: string, consumers: readonly string[], sealed: boolean }): { patches: FilePatch[], created: GeneratedFile[], environments: string[] } {
  const manifestRelative = '.starcistacks/application-stacks.yaml';
  const manifestFile = path.join(repoRoot, ...manifestRelative.split('/'));
  if (!fs.existsSync(manifestFile)) return { patches: [], created: [], environments: [] };
  const manifest = parseYaml(read(manifestFile));
  if (manifest?.components?.redis) return { patches: [], created: [], environments: [] };
  const swarm = Object.entries<YamlNode>(manifest?.environments ?? {}).filter(([, environment]) => environment?.runtime === 'docker-swarm');
  const edit = new YamlBlockEdit(read(manifestFile), manifestRelative);
  edit.append(['components'], redisComponent(sealed));
  edit.value.components.redis = { role: 'stateful', image: REDIS_IMAGE, compose: 'infra/swarm/stack.yaml', volumes: ['redis-data'], purpose: purposeOf(sealed), required: true };
  const patches: Array<FilePatch | null> = [];
  const created: GeneratedFile[] = [];
  for (const [name, environment] of swarm) {
    const compose = `.starcistacks/${name}/${environment.composeFiles?.[0] ?? 'infra/swarm/stack.yaml'}`;
    const composeFile = path.join(repoRoot, ...compose.split('/'));
    const services = queueServicesIn(composeFile, compose, consumers);
    const { recovery, runtimeName } = declareEnvironment(edit, name, environment, { project, consumers: services, sealed });
    patches.push(stackPatch(composeFile, compose, { name, project, runtimeName, consumers: services, sealed }));
    const lock = environment.release?.imagesLock;
    if (lock && fs.existsSync(path.join(repoRoot, ...lock.split('/')))) patches.push(imagesLockPatch(path.join(repoRoot, ...lock.split('/')), lock));
    const keys = path.join(repoRoot, '.starcistacks', name, 'runtime', 'env', 'KEYS.md');
    if (fs.existsSync(keys)) patches.push(keysPatch(keys, sealed));
    if (!fs.existsSync(path.join(repoRoot, ...recovery.split('/')))) created.push({ relative: recovery, text: recoveryRecord });
  }
  patches.push(...devQueuePatches(repoRoot, manifest, edit, { consumers, sealed }));
  patches.unshift({ file: manifestFile, text: edit.text() });
  return { patches: patches.filter((patch): patch is FilePatch => patch !== null), created, environments: swarm.map(([name]) => name) };
}

/**
 * Plans the lite additions of `add queue|job` before any file is written; returns null outside lite or for another noun. The
 * plan's apply() writes them and returns the app-relative paths it created or changed.
 */
export function planLiteQueue({ repoRoot, repo, noun, patterns, now }: { repoRoot: string, repo: LiteRepo, noun: string, patterns: readonly string[], now: () => number }): { apply(): string[] } | null {
  if (repo.edition !== 'lite' || !['queue', 'job'].includes(noun)) return null;
  const beRoot = path.join(repoRoot, 'be');
  const migrations = migrationFiles({ repoRoot, beRoot, patterns, now });
  const database = skeletonFiles(repoRoot);
  const declaration = declarationPatches(repoRoot, repo.project, patterns);
  const stack = stackFiles(repoRoot, { project: repo.project, consumers: queueServicesOf(repo), sealed: true });
  const created = [...migrations, ...tickFiles({ beRoot, patterns }), ...database.created, ...stack.created];
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
      const exported = [
        ...registerLiteExports({ root: repoRoot, generator: 'queue' }),
        ...(patterns.includes('fenced-job') ? registerLiteExports({ root: repoRoot, generator: 'jobs' }) : []),
      ];
      const sealed = sealRedisMembers(repoRoot, stack.environments);
      const changed = patches.map((patch) => path.relative(repoRoot, patch.file).split(path.sep).join('/'));
      return [...new Set([...created.map((entry) => entry.relative), ...changed, ...exported, ...sealed])];
    },
  };
}

/** Seals a placeholder redis-password member to the app's configured recipient; without one, `starci app secret init` seals it. */
function sealRedisMembers(repoRoot: string, environments: readonly string[]): string[] {
  if (!environments.length || !fs.existsSync(path.join(repoRoot, '.sops.yaml'))) return [];
  const recipients = (env: string) => configuredRecipients(repoRoot, path.join(repoRoot, '.starcistacks', env, 'secrets', `${MEMBER}.enc`));
  let single: boolean;
  try { single = environments.every((env) => recipients(env).length === 1); } catch { single = false; }
  if (!single) return [];
  return materializeDeclaredPlaceholders(repoRoot, {
    recipientsForFile: (file: string) => configuredRecipients(repoRoot, file),
    only: (member: { slug: string, env: string }) => member.slug === MEMBER && environments.includes(member.env),
  }).members;
}
