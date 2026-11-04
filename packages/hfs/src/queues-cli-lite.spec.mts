// queues-cli-lite.spec.mjs - `cli queues resume [--job <id>]` of a lite app (BE-RESILIENCE-2): rendered once the app has both its cli app
// and its jobs platform, whichever `add` comes second, with the cli app's platform group composing the outbox writer and the jobs
// capability's resume requests; an existing group is never overwritten, and a cli tree the renderer cannot read is refused.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addKind } from '../scaffold/add.mjs';
import { ensureLiteQueuesCli } from '../scaffold/queues-cli-lite.mjs';

type CodedError = Error & { code?: string };
const SCAFFOLDED = Date.parse('2026-11-04T00:00:00Z');
const PLATFORM = 'be/apps/cli/src/compose/platform.ts';
const CLI_MODULE = 'be/src/features/cli/cli.module.ts';

function liteApp(t: TestContext): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-queues-cli-lite-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  const { root } = scaffoldApp({
    name: 'demo', into, harness: { version: '1.1.0-alpha.3' }, edition: 'lite', presets: bundledPresets(),
    lock: (dir: string) => { fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n'); return { ok: true as const }; }, initGit: init,
    now: () => new Date(SCAFFOLDED),
  });
  return root;
}

const read = (root: string, relative: string): string => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');
const addCli = (root: string) => addKind({ repoRoot: root, noun: 'cli', name: 'migrate', now: () => SCAFFOLDED + 30_000 });
const addJob = (root: string) => {
  addKind({ repoRoot: root, noun: 'queue', name: 'receipt', options: { noTypes: true }, now: () => SCAFFOLDED + 60_000 });
  return addKind({ repoRoot: root, noun: 'job', name: 'digest', options: { noTypes: true }, now: () => SCAFFOLDED + 120_000 });
};

const assertRendered = (root: string): void => {
  assert.match(read(root, 'be/src/features/cli/queues/subs/resume.cli.ts'), /@SubCommand\(\{ name: "resume"/);
  assert.match(read(root, 'be/src/features/cli/queues/subs/resume.cli.ts'), /this\.requests\.request\(options\?\.job\)/);
  assert.match(read(root, CLI_MODULE), /QueuesModule\.register\(\{\}\)/);
  const platform = read(root, PLATFORM);
  assert.match(platform, /^import \{ DatabaseModule, PRIMARY_ENTITY_MANAGER \} from "@modules\/platform\/database"$/m);
  assert.match(platform, /^ {4}JobsModule\.register\(\{ isGlobal: true, requestsOnly: true, connection: PRIMARY_ENTITY_MANAGER \}\),$/m);
  assert.match(platform, /^ {4}QueueModule\.register\(\{ isGlobal: true, outboxOnly: true \}\),$/m);
  assert.doesNotMatch(platform, /HTTP_ERROR_KINDS|HTTP_MESSAGES/);
};

test('add job renders the queues group into an app that has its cli app, and a second render changes nothing', (t) => {
  const root = liteApp(t);
  addCli(root);
  assert.equal(fs.existsSync(path.join(root, 'be', 'src', 'features', 'cli', 'queues')), false, 'no jobs platform yet, no group');
  const created = addJob(root).created;
  assert.ok(created.includes('be/src/features/cli/queues/subs/resume.cli.spec.ts'));
  assert.ok(created.includes(PLATFORM));
  assertRendered(root);
  const platform = read(root, PLATFORM);
  assert.deepEqual(ensureLiteQueuesCli(root), [], 'an existing group is the app\'s');
  assert.equal(read(root, PLATFORM), platform);
});

test('add cli renders the queues group into an app that has its jobs platform, with the cli module-definitions it composes', (t) => {
  const root = liteApp(t);
  addJob(root);
  const created = addCli(root).created;
  assert.ok(created.includes('be/src/features/cli/queues/queues.cli.ts'));
  for (const file of ['be/src/features/cli/cli.module-definition.ts', 'be/src/features/cli/migrate/migrate.module-definition.ts', 'be/src/features/cli/seed/seed.module-definition.ts']) {
    assert.ok(created.includes(file), file);
  }
  assert.match(read(root, 'be/src/features/cli/seed/seed.module.ts'), /export class SeedModule extends ConfigurableModuleClass \{\}/);
  assert.match(read(root, 'be/src/modules/platform/database/index.ts'), /export \{ PRIMARY_CONNECTION \} from "\.\/primary\.connection"/);
  assertRendered(root);
});

test('an app missing either half renders nothing, and a cli tree the renderer cannot read is refused', (t) => {
  const root = liteApp(t);
  assert.deepEqual(ensureLiteQueuesCli(root), []);
  addJob(root);
  assert.deepEqual(ensureLiteQueuesCli(root), [], 'no cli app yet');
  addCli(root);
  const group = path.join(root, 'be', 'src', 'features', 'cli', 'queues');
  const refused = (code: string) => (error: CodedError) => error.code === code;
  const retry = (edit: () => void, code: string) => {
    fs.rmSync(group, { recursive: true, force: true });
    edit();
    assert.throws(() => ensureLiteQueuesCli(root), refused(code));
  };
  const platform = path.join(root, ...PLATFORM.split('/'));
  const cliModule = path.join(root, ...CLI_MODULE.split('/'));
  const kept = fs.readFileSync(platform, 'utf8');
  retry(() => fs.writeFileSync(platform, kept.replace('import { DatabaseModule, PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"\n', '')), 'HFS_ADD_WIRE_INVALID');
  retry(() => fs.writeFileSync(platform, 'export const platformModules = () => null\n'), 'HFS_ADD_WIRE_INVALID');
  retry(() => fs.rmSync(platform), 'HFS_ADD_WIRE_MISSING');
  fs.writeFileSync(platform, kept);
  retry(() => fs.rmSync(cliModule), 'HFS_ADD_WIRE_MISSING');
});

test('a platform group that already composes a capability gains only what it lacks', (t) => {
  const root = liteApp(t);
  addJob(root);
  addCli(root);
  const group = path.join(root, 'be', 'src', 'features', 'cli', 'queues');
  fs.rmSync(group, { recursive: true, force: true });
  ensureLiteQueuesCli(root);
  const platform = read(root, PLATFORM);
  assert.equal(platform.split('JobsModule.register(').length, 2);
  assert.equal(platform.split('import { QueueModule }').length, 2);
});
