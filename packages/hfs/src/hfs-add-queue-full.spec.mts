// hfs-add-queue-full.spec.mts - `starci app add queue|job` in a full app: the queue is BullMQ on the declared Redis, so the verb declares
// redis in sides.be.backing with its clients and renders the one persisted Redis the queue needs: the stateful component of
// application-stacks.yaml, its backup and restore record, the AOF service on a named volume with no eviction in the dev compose file and in
// every docker-swarm stack, the images lock and the QUEUE_REDIS_HOST / QUEUE_REDIS_PORT keys the queue config reads. A full queue reads no password,
// so no sealed member is declared. The edit keeps the owner's comments, is idempotent, and leaves a Redis the owner declared alone.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { bundledPins } from '../runtime/scripts/hfs/canon-pins.mjs';
import { addKind } from '../scaffold/add.mjs';
import ts from 'typescript';
import { YamlBlockEdit } from '../scaffold/yaml-block-edit.mjs';
import { liteBackingIssues } from '../runtime/scripts/hfs/rules/stacks-lite-backing.mjs';

type CodedError = Error & { code?: string };
const SCAFFOLDED = Date.parse('2026-10-25T00:00:00Z');
const MANIFEST = '.starcistacks/application-stacks.yaml';
const PRODUCTION = '.starcistacks/production/infra/swarm/stack.yaml';
const DEV = '.starcistacks/dev/infra/compose/stack.yaml';
const lockedOk = (root: string) => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true as const };
};

function fullApp(t: TestContext) {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-add-queue-full-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root } = scaffoldApp({
    name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition: 'full', presets: bundledPresets(), lock: lockedOk, initGit: init,
    now: () => new Date(SCAFFOLDED),
  });
  return root;
}

const read = (root: string, file: string) => fs.readFileSync(path.join(root, ...file.split('/')), 'utf8');
const write = (root: string, file: string, text: string) => fs.writeFileSync(path.join(root, ...file.split('/')), text);
const yamlOf = (root: string, file: string) => parseYaml(read(root, file));
const STACK_FILES = [MANIFEST, PRODUCTION, DEV, '.starcistacks/production/infra/swarm/releases/images.lock.yaml', '.starcistacks/production/runtime/env/KEYS.md', '.starcistacks/dev/runtime/env/KEYS.md'];
const snapshot = (root: string) => Object.fromEntries(STACK_FILES.map((file) => [file, read(root, file)]));
const add = (root: string, noun: 'queue' | 'job', name: string, offset = 60_000) => addKind({ repoRoot: root, noun, name, options: { noTypes: true }, now: () => SCAFFOLDED + offset });

test('full add queue declares redis with its clients and renders the persisted Redis into the dev compose file and the production stack', (t) => {
  const root = fullApp(t);
  const before = snapshot(root);

  const result = add(root, 'queue', 'receipt');

  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.backing, ['redis']);
  const dependencies = JSON.parse(read(root, 'package.json')).dependencies;
  assert.equal(dependencies.bullmq, bundledPins().bullmq!.version);
  assert.equal(dependencies.ioredis, bundledPins().ioredis!.version);

  const manifest = yamlOf(root, MANIFEST);
  assert.equal(manifest.components.redis.role, 'stateful');
  assert.deepEqual(manifest.components.redis.volumes, ['redis-data']);
  assert.equal(manifest.components.redis.required, true);
  assert.deepEqual(manifest.environments.production.components.redis, { replicas: 1, port: 6379 });
  const backup = manifest.environments.production.backup.find((entry: { component: string }) => entry.component === 'redis');
  assert.equal(backup.restoreProof, '.starcistacks/production/infra/swarm/recovery/redis.yaml');
  assert.ok(manifest.environments.production.deploy.volumes.includes('demo-production-redis-data'));
  assert.equal(manifest.environments.dev.local.ports.redis, 56379);
  assert.deepEqual(manifest.environments.dev.local.services[0], { name: 'redis', wait: 'healthy' }, 'the Redis comes up before the core service that runs the queue');
  assert.equal(manifest.environments.dev.local.services.some((service: { name: string }) => service.name === 'core'), true);
  assert.equal(yamlOf(root, '.starcistacks/production/infra/swarm/recovery/redis.yaml').status, 'pending-owner-restore-proof');

  const stack = yamlOf(root, PRODUCTION);
  assert.deepEqual(stack.services.redis.command, ['redis-server', '--appendonly', 'yes', '--appendfsync', 'everysec', '--maxmemory-policy', 'noeviction']);
  assert.deepEqual(stack.services.redis.volumes, ['redis-data:/data']);
  assert.deepEqual(stack.services.redis.networks, ['backing']);
  assert.equal(stack.services.redis.secrets, undefined, 'the full queue reads no Redis password, so no sealed member is mounted');
  assert.equal(stack.volumes['redis-data'].name, 'demo-production-redis-data');
  assert.equal(stack.networks.backing.internal, true);
  assert.deepEqual(stack.services.core.networks, ['app', 'backing'], 'the api joins the internal network, which the scaffolded database already declares');
  assert.equal(stack.services.core.environment.QUEUE_REDIS_HOST, 'redis');
  assert.equal(stack.services.core.environment.QUEUE_REDIS_PORT, '6379');
  assert.equal(stack.secrets['redis-password'], undefined);
  assert.equal(yamlOf(root, '.starcistacks/production/infra/swarm/releases/images.lock.yaml').images.redis, manifest.components.redis.image);

  const dev = yamlOf(root, DEV);
  assert.equal(dev.services.redis.ports[0], '127.0.0.1:${STACK_PORT_REDIS}:6379');
  assert.match(dev.services.redis.command.join(' '), /--appendonly yes .*--maxmemory-policy noeviction/);
  assert.deepEqual(dev.services.redis.volumes, ['redis-data:/data']);
  assert.notEqual(dev.volumes['redis-data'], undefined);
  assert.deepEqual(dev.services.redis.networks, dev.services.core.networks, 'the Redis shares the network of the core service the compose file runs');
  assert.equal(dev.services.core.environment.QUEUE_REDIS_HOST, 'redis');

  for (const keys of ['.starcistacks/production/runtime/env/KEYS.md', '.starcistacks/dev/runtime/env/KEYS.md']) {
    assert.match(read(root, keys), /\| `QUEUE_REDIS_HOST` \|/);
    assert.match(read(root, keys), /\| `QUEUE_REDIS_PORT` \|/);
    assert.doesNotMatch(read(root, keys), /QUEUE_REDIS_PASSWORD/);
  }
  assert.ok(STACK_FILES.every((file) => result.created.includes(file)), 'the verb reports every stack file it changed');
  assert.ok(result.created.includes('.starcistacks/production/infra/swarm/recovery/redis.yaml'));
  assert.doesNotMatch(Object.values(snapshot(root)).join('\n'), /redis-password/);
  for (const file of STACK_FILES) {
    const comments = before[file]!.split('\n').filter((line) => line.trimStart().startsWith('#'));
    assert.ok(comments.length === 0 || comments.every((line) => read(root, file).includes(line)), `${file} keeps the owner's comments`);
  }
});

test('the full Redis passes the persistence judgement lite enforces on its Redis (R276 rule body)', (t) => {
  const root = fullApp(t);
  add(root, 'job', 'digest');

  const issues = liteBackingIssues({
    doc: yamlOf(root, MANIFEST), environment: 'production', model: yamlOf(root, PRODUCTION), repo: JSON.parse(read(root, 'hfs.json')), repoRoot: root, edition: 'lite',
  });

  assert.deepEqual(issues.filter((issue: { code: string }) => issue.code === 'STACKS_LITE_REDIS_PERSISTENCE'), [], 'AOF, a named volume at /data, noeviction, exactly one service');
});

test('full add job renders the same Redis and a second add changes no stack file', (t) => {
  const root = fullApp(t);
  add(root, 'job', 'digest');
  assert.equal(yamlOf(root, MANIFEST).components.redis.role, 'stateful');
  assert.match(yamlOf(root, PRODUCTION).services.redis.command.join(' '), /--appendonly yes/);
  const once = snapshot(root);

  const again = add(root, 'queue', 'invoice', 120_000);

  assert.deepEqual(snapshot(root), once);
  assert.equal(again.created.some((file) => STACK_FILES.includes(file)), false);
  assert.equal(Object.keys(yamlOf(root, PRODUCTION).services).filter((name) => name === 'redis').length, 1);
});

test('full add queue wires every service that runs the queue, a worker as well as the api', (t) => {
  const root = fullApp(t);
  const declaration = JSON.parse(read(root, 'hfs.json'));
  declaration.sides.be.apps.push({ name: 'worker', kind: 'worker' });
  write(root, 'hfs.json', `${JSON.stringify(declaration, null, 2)}\n`);
  const worker = '  worker:\n    image: "demo/worker:v0.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000"\n    networks: [app]\n';
  write(root, PRODUCTION, read(root, PRODUCTION).replace(/\nnetworks:\n/, `\n${worker}networks:\n`));

  add(root, 'queue', 'receipt');

  const stack = yamlOf(root, PRODUCTION);
  for (const service of ['core', 'worker']) {
    assert.deepEqual(stack.services[service].networks, ['app', 'backing'], `${service} joins the internal backing network`);
    assert.equal(stack.services[service].environment.QUEUE_REDIS_HOST, 'redis');
    assert.equal(stack.services[service].environment.QUEUE_REDIS_PORT, '6379');
  }
});

test('full add queue reaches the Redis from a native dev process of the local block', (t) => {
  const root = fullApp(t);
  const edit = new YamlBlockEdit(read(root, MANIFEST), MANIFEST);
  edit.append(['environments', 'dev', 'local'], 'processes:\n  - name: core\n    argv: [node, dist/main.js]\n    env:\n      NODE_ENV: development\n    health: {url: "http://localhost:3001/health/live"}\n');
  edit.value.environments.dev.local.processes = [{ name: 'core', argv: ['node', 'dist/main.js'], env: { NODE_ENV: 'development' }, health: { url: 'http://localhost:3001/health/live' } }];
  write(root, MANIFEST, edit.text());
  write(root, DEV, read(root, DEV).replace(/^ {2}core:$/m, '  corecontainer:'));

  add(root, 'queue', 'receipt');

  const dev = yamlOf(root, MANIFEST).environments.dev.local;
  assert.deepEqual(dev.processes[0].env, { NODE_ENV: 'development', QUEUE_REDIS_HOST: '127.0.0.1', QUEUE_REDIS_PORT: '${port.redis}' });
  assert.deepEqual(dev.services.at(-1), { name: 'redis', wait: 'healthy' });
  assert.equal(yamlOf(root, DEV).services.corecontainer.environment.QUEUE_REDIS_HOST, undefined, 'a service the compose file does not run for the queue gains no queue address');
  assert.equal(yamlOf(root, DEV).services.redis.networks, undefined);
});

test('full add queue refuses a stack with no service of an api or worker app before writing anything', (t) => {
  const root = fullApp(t);
  write(root, PRODUCTION, read(root, PRODUCTION).replace(/^ {2}core:$/m, '  backend:'));
  const hfs = read(root, 'hfs.json');
  const manifest = read(root, MANIFEST);
  assert.throws(() => add(root, 'queue', 'receipt'),
    (error: CodedError) => error.code === 'HFS_ADD_STACK_SHAPE' && /production\/infra\/swarm\/stack\.yaml has no service of a back-end api or worker app \(core\)/.test(error.message));
  assert.equal(read(root, 'hfs.json'), hfs);
  assert.equal(read(root, MANIFEST), manifest);
  assert.equal(fs.existsSync(path.join(root, 'be', 'src', 'modules', 'platform', 'queue')), false);
});

test('full add queue leaves a Redis component the owner declared as it is', (t) => {
  const root = fullApp(t);
  const edit = new YamlBlockEdit(read(root, MANIFEST), MANIFEST);
  edit.append(['components'], 'redis:\n  role: stateful\n  image: redis:7\n  purpose: The owner-managed Redis.\n');
  edit.value.components.redis = { role: 'stateful', image: 'redis:7', purpose: 'The owner-managed Redis.' };
  write(root, MANIFEST, edit.text());
  const before = snapshot(root);

  const result = add(root, 'queue', 'receipt');

  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, '.starcistacks', 'production', 'infra', 'swarm', 'recovery', 'redis.yaml')), false);
  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.backing, ['redis'], 'the queue still declares its backing service');
  assert.equal(result.created.includes(MANIFEST), false);
});

test('an app without a stack declaration gains the queue and its clients and no stack file', (t) => {
  const root = fullApp(t);
  fs.rmSync(path.join(root, '.starcistacks'), { recursive: true, force: true });

  const result = add(root, 'queue', 'receipt');

  assert.deepEqual(JSON.parse(read(root, 'hfs.json')).sides.be.backing, ['redis']);
  assert.equal(result.created.some((file) => file.startsWith('.starcistacks/')), false);
});

const listFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  if (['node_modules', '.git'].includes(entry.name)) return [];
  return entry.isDirectory() ? listFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)];
});

test('full add job in an app without platform/ids and the logging correlation refuses before it writes or patches anything', (t) => {
  const root = fullApp(t);
  const platform = path.join(root, 'be', 'src', 'modules', 'platform');
  fs.rmSync(path.join(platform, 'ids'), { recursive: true, force: true });
  for (const file of ['correlation.policy.ts', 'correlation.policy.spec.ts', 'correlation.port.ts']) fs.rmSync(path.join(platform, 'logging', file), { force: true });
  fs.writeFileSync(path.join(platform, 'logging', 'logging.decorators.ts'), 'export const LOGGER = Symbol("logger")\nexport const InjectLogger = () => undefined\n');
  const before = Object.fromEntries(listFiles(root).map((file) => [file, fs.readFileSync(file, 'utf8')]));

  assert.throws(() => add(root, 'job', 'digest'), (error: CodedError) => error.code === 'HFS_ADD_PLATFORM_MISSING'
    && error.message.includes('be/src/modules/platform/ids') && error.message.includes('logging/correlation.policy.ts')
    && error.message.includes('CORRELATION_RUNNER') && error.message.endsWith('Nothing was written'));

  assert.deepEqual(Object.fromEntries(listFiles(root).map((file) => [file, fs.readFileSync(file, 'utf8')])), before, 'no file was created, patched or removed');
});

/** The `@modules` imports of the files under `dirs` that resolve to no module or to a module that lacks the name (the breaks a half-patched barrel leaves). */
function unresolvedModuleImports(root: string, dirs: readonly string[]): string[] {
  const options = { baseUrl: root, paths: { '@modules/*': ['be/src/modules/*'], '@features/*': ['be/src/features/*'] }, noEmit: true, skipLibCheck: true, moduleResolution: ts.ModuleResolutionKind.Node10, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true };
  const rootNames = dirs.flatMap((dir) => listFiles(path.join(root, ...dir.split('/'))).filter((file) => file.endsWith('.ts')));
  const program = ts.createProgram({ rootNames, options });
  const text = (diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  return program.getSemanticDiagnostics()
    .filter((diagnostic) => (diagnostic.code === 2307 && /@modules\/|@features\/|'\.\//.test(text(diagnostic))) || [2305, 2614, 2724, 2459].includes(diagnostic.code))
    .map((diagnostic) => `${path.relative(root, diagnostic.file?.fileName ?? '')}: ${text(diagnostic)}`);
}

test('the platform trees full add job writes resolve every @modules import they and the patched logging barrel make', (t) => {
  const root = fullApp(t);
  const trees = ['be/src/modules/platform/logging', 'be/src/modules/platform/ids'];
  assert.deepEqual(unresolvedModuleImports(root, trees), [], 'the scaffolded prerequisites resolve before the verb');

  add(root, 'job', 'digest');

  assert.match(read(root, 'be/src/modules/platform/logging/index.ts'), /CORRELATION_RUNNER/);
  assert.deepEqual(unresolvedModuleImports(root, [...trees, 'be/src/modules/platform/queue', 'be/src/modules/platform/jobs', 'be/src/modules/platform/outbox']), []);

  fs.rmSync(path.join(root, 'be', 'src', 'modules', 'platform', 'ids'), { recursive: true });
  assert.ok(unresolvedModuleImports(root, [...trees.slice(0, 1), 'be/src/modules/platform/queue']).some((finding) => finding.includes('@modules/platform/ids')), 'the judge sees a missing capability');
});

test('a block edit prepends before the first child and keeps the comments around it', () => {
  const edit = new YamlBlockEdit('local:\n  # first the database\n  services:\n    - {name: postgres}\n    - {name: core}\n', 'x.yaml');
  edit.prepend(['local', 'services'], '- {name: redis}\n');
  edit.value.local.services.unshift({ name: 'redis' });
  assert.equal(edit.text(), 'local:\n  # first the database\n  services:\n    - {name: redis}\n    - {name: postgres}\n    - {name: core}\n');
});
