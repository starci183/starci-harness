// The urgent path takes the deploy's own database steps, in the same place (stack/urgent-floor.mts over stack/db-phases.mts and stack/deploy.mts).
// Nature: a deploy's safety steps run where the data is, whichever path triggered the deploy. So an urgent deploy of a `stack` database
//   - backs up, receipts and test-decrypts ON THE MANAGER through the deploy's ssh runner, never on the operator's machine (no database client,
//     no route to the database, no DATABASE_URL, no SOPS_AGE_KEY_FILE needed there), and ALWAYS (the floor is never skipped);
//   - gives the app role its sealed password on a first start, explicit (--first-start) or chosen by itself on an empty database;
//   - runs the seed step after convergence, as every deploy does (PROJECT-STACKS-12), and its dry run names it.
// Collaborators are doubles; no registry, VPS or database is reached.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { recordsDouble } from './stack-records-double.mjs';
import { deployRelease } from '../stack/deploy.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';
import type { StackContext } from '../stack/context.mjs';
import type { DbTarget as PostgresTarget } from '../db/postgres.mjs';

const DIGEST = 'e'.repeat(64);
const STACK = ['services:', '  db:', `    image: registry.example/db@sha256:${DIGEST}`, '    deploy:', '      replicas: 1', '  api:', `    image: registry.example/api@sha256:${DIGEST}`, '    deploy:', '      replicas: 2', ''].join('\n');
const RECIPIENT = `age1${'q'.repeat(58)}`;
const CONTAINER = 'abcdef012345';
const PREVIOUS = 'a'.repeat(16);
const SHA = 'f'.repeat(40);
const EXPAND = ['20261102000000_orders-total.sql'];
const PARTS = ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json'];
const SECRET = 'Sealed-app-pw_0123456789';

interface Scenario {
  target?: 'stack' | 'external';
  expand?: string[];
  /** The running database is empty (no history, no public table). */
  empty?: boolean;
  firstStart?: boolean;
  dbService?: string;
  managerBackupFails?: boolean;
  seeds?: boolean;
  execute?: boolean;
  /** The operator's environment: nothing by default, as on a machine with no database client and no identity. */
  env?: Record<string, string>;
}

/** An app root with a pushed urgent record of SHA, a `database:` block naming the app role's sealed password, and (optionally) a seed entry. */
function app(t: TestContext, scenario: Scenario): string {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const records = path.join(root, '.git', 'starci-release');
  fs.mkdirSync(records, { recursive: true });
  fs.writeFileSync(path.join(records, `${SHA}.urgent.json`), JSON.stringify({ schema: 'starci-app-urgent-record/1', head: SHA, tag: 'v1.0.0', role: 'owner', reason: 'tonight', pushed: true }));
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `database:\n  target: ${scenario.target ?? 'stack'}\n  service: db\n  appPassword: {member: postgres, key: APP_BE_DB_PASSWORD}\n`);
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ project: 'shop', db: { appRole: 'app_be' } }));
  fs.writeFileSync(path.join(root, '.sops.yaml'), `creation_rules:\n  - age: ${RECIPIENT}\n`);
  if (scenario.seeds) {
    const level = path.join(root, '.starcistacks', 'production', 'seeds');
    fs.mkdirSync(path.join(level, 'sql'), { recursive: true });
    fs.writeFileSync(path.join(level, 'seeds.yaml'), 'schema: starci/seeds@1\nentries:\n  - {id: first-run, kind: sql, path: sql/first.sql, target: primary, mode: once}\n');
    fs.writeFileSync(path.join(level, 'sql', 'first.sql'), 'insert into settings values (1) on conflict do nothing;\n');
  }
  return root;
}

/** An urgent deployRelease over doubles; `order` records every effect in the order it happened. */
async function urgent(t: TestContext, scenario: Scenario = {}) {
  const root = app(t, scenario);
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-db-out-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const order: string[] = [];
  const psql: string[] = [];
  const state = { expand: [...(scenario.expand ?? [])] };
  const ok = (name: string) => async () => { order.push(name); return { ok: true, lines: [] }; };
  const store = {
    ...recordsDouble(),
    current: async () => PREVIOUS, store: ok('store'), accept: ok('accept'),
    fetch: async (_release: unknown, dir: string) => { order.push('fetch'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), STACK); },
  };
  const floor = {
    dbContainer: async () => { order.push('container'); return CONTAINER; },
    // reason: the phases read only url, container and own of the target; the double is not a full connection description.
    containerTarget: () => ({ url: 'postgresql://postgres@127.0.0.1:5432/app', container: CONTAINER, own: true, env: {}, secrets: [], how: 'double' }) as unknown as PostgresTarget,
    emptiness: async () => {
      order.push(order.includes('deploy-hold') ? 'empty?' : 'choice:empty?');
      return scenario.empty ? { empty: true, history: false, publicTables: 0 } : { empty: false, history: true, publicTables: 2 };
    },
    sealedValue: async (_ctx: unknown, _config: unknown, ref: { member: string; key: string }) => { order.push(`sealed:${ref.member}:${ref.key}`); return SECRET; },
    containerPsql: async (_ctx: unknown, _target: unknown, sql: string) => { order.push('psql'); psql.push(sql); return { status: 0, stderr: '' }; },
    migrate: async (_ctx: unknown, { execute, phase }: { target: Record<string, unknown>; execute: boolean; phase?: string | undefined }) => {
      order.push(`migrate:${phase ?? 'first-start'}:${execute ? 'run' : 'preview'}`);
      const files = phase === 'contract' ? [] : state.expand;
      if (!execute) return { ok: true, lines: [`plan ${files.length}`], data: { done: files.length === 0, pushFiles: files } };
      const applied = phase === 'contract' ? [] : state.expand.splice(0);
      return { ok: true, lines: [`applied ${applied.length}`], data: { done: true, pushed: applied.map((file) => file.slice(0, 14)) } };
    },
    managerBackup: async (_ctx: unknown, _config: unknown, args: { recipients: string[] }) => {
      order.push('manager-backup');
      assert.ok(args.recipients.includes(RECIPIENT), 'the dump is encrypted to the app\'s .sops.yaml recipients');
      if (scenario.managerBackupFails) throw new Error('docker exec failed');
      const body = `age-encryption.org/v1\n${'x'.repeat(100)}`;
      const sha256 = createHash('sha256').update(body).digest('hex');
      const receipt = { schemaOnly: false, at: new Date().toISOString(), file: 'orders-backup.tar.age', bytes: body.length, sha256, parts: PARTS };
      return { receiptPath: '/var/backups/shop/db/orders-backup.receipt.json', archive: '/var/backups/shop/db/orders-backup.tar.age', receipt, facts: { exists: true, size: body.length, header: true, sha256 } };
    },
    managerDecrypt: async () => { order.push('manager-decrypt'); return PARTS; },
    // The operator's machine: a local dump needs a PostgreSQL client and a route to the database, which an urgent deploy of a stack database must not.
    backup: async () => { order.push('local-backup'); throw Object.assign(new Error('no psql here'), { code: 'DB_CLI_MISSING' }); },
    decrypt: async () => { order.push('local-decrypt'); return { parts: PARTS }; },
  };
  const deps = {
    renderRelease: async (_ctx: unknown, _config: unknown, options: { out: string }) => { fs.writeFileSync(path.join(options.out, 'stack.yaml'), STACK); return { ok: true, lines: [] }; },
    provisionRelease: ok('provision'), releaseStore: () => store, ssh: async () => ({ cleanup() {} }),
    reconcileEdge: ok('edge'), convergeStack: ok('converge'), verifyStack: ok('verify'), pruneStack: ok('prune'), postDeployStack: ok('post-deploy'),
    seedRelease: async () => { order.push('seed'); return { ok: true, lines: ['seed production/first-run: applied (sql, once)'] }; },
    floor,
  };
  const spawn = (command: string, args: string[]) => {
    if (command === 'git') return { status: 0, stdout: path.join(root, '.git'), stderr: '' };
    if (args[0] === 'stack' && args[1] === 'deploy') order.push(args.filter((_arg, index) => args[index - 1] === '-c').length > 1 ? 'deploy-hold' : 'deploy');
    return { status: 0, stdout: '', stderr: '' };
  };
  // reason: deployRelease reads only spawn, env, now and cwd of the context and repoRoot, stack, env, project, remote, backup, ingress, tasks and postDeploy of the config.
  const ctx = { spawn, env: { STARCI_ROLE: 'owner', ...(scenario.env ?? {}) }, now: () => Date.now(), sleep: async () => {}, cwd: root } as unknown as StackContext;
  const config = { stack: 'shop', env: 'production', project: 'shop', repoRoot: root, remote: { serverRecipient: null }, backup: null, ingress: null, tasks: {}, postDeploy: [], services: new Set(['db', 'api']) } as unknown as DeployConfig;
  const options = { sourceSha: SHA, execute: scenario.execute ?? true, out, urgent: true, reason: 'tonight', firstStart: scenario.firstStart, dbService: scenario.dbService };
  const result = await deployRelease(ctx, config, options, deps as unknown as Partial<DeployDeps>);
  const steps = ((result.data?.steps ?? []) as { step: string }[]).map((entry) => entry.step);
  return { result, order, steps, psql };
}

const LOCAL = ['local-backup', 'local-decrypt'];
const AFTER_STORE = (order: string[]) => order.slice(order.indexOf('store') + 1).filter((name) => !['provision', 'edge', 'converge', 'verify', 'prune', 'container', 'post-deploy', 'fetch'].includes(name));

test('U2: an urgent deploy of a stack database backs up, receipts and test-decrypts on the manager, with nothing on the operator\'s machine', async (t) => {
  const { result, order, steps } = await urgent(t, { expand: EXPAND });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data!.urgent, 'v1.0.0');
  assert.ok(!order.some((name) => LOCAL.includes(name)), `no dump or decrypt on the operator's machine: ${order.join(' ')}`);
  assert.deepEqual(AFTER_STORE(order), ['choice:empty?', 'migrate:all:preview', 'manager-backup', 'manager-decrypt', 'migrate:expand:run', 'deploy', 'accept', 'migrate:contract:preview']);
  assert.deepEqual(steps.slice(4, 8), ['db-preview', 'backup', 'migrate', 'deploy']);
  const record = result.data!.migrations as { backup: { where: string } };
  assert.equal(record.backup.where, 'manager');
  assert.ok(result.lines.some((line) => line.startsWith('db: backup orders-backup.tar.age on the manager')));
  assert.ok(result.lines.some((line) => line.startsWith('db: test decrypt on the manager listed 4 part(s)')));
});

test('U2: the floor is never skipped: with nothing pending the urgent deploy still takes the verified backup on the manager', async (t) => {
  const { result, order } = await urgent(t);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(AFTER_STORE(order), ['choice:empty?', 'migrate:all:preview', 'manager-backup', 'manager-decrypt', 'deploy', 'accept', 'migrate:contract:preview']);
  assert.ok(result.lines.some((line) => line.includes('the urgent floor took its backup all the same')));
});

test('U2: a failed backup on the manager is refused with the shared code, and nothing is migrated or deployed', async (t) => {
  const { result, order } = await urgent(t, { expand: EXPAND, managerBackupFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.refused!.code, 'STACK_DEPLOY_BACKUP_FAILED');
  assert.ok(!order.includes('migrate:expand:run') && !order.includes('deploy') && !order.includes('accept'));
  assert.ok(!order.some((name) => LOCAL.includes(name)));
});

test('U2: an external database keeps its backup where the deploy runs, and still needs the identity of its test decrypt', async (t) => {
  await assert.rejects(urgent(t, { target: 'external', expand: EXPAND, env: { DATABASE_URL: 'postgresql://owner:s3cret@db.example:5432/app' } }), (error: { code?: string }) => error.code === 'STACK_DEPLOY_BACKUP_DECRYPT_UNAVAILABLE');
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-db-id-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = path.join(root, 'identity.txt');
  fs.writeFileSync(identity, 'stand-in identity\n');
  const { result, order } = await urgent(t, { target: 'external', expand: EXPAND, env: { SOPS_AGE_KEY_FILE: identity, DATABASE_URL: 'postgresql://owner:s3cret@db.example:5432/app' } });
  assert.equal(result.refused?.code, 'STACK_DEPLOY_BACKUP_FAILED', 'the local dump is the external database\'s, as on the automatic path');
  assert.ok(order.includes('local-backup') && !order.includes('manager-backup'));
  assert.ok(!result.lines.join('\n').includes('s3cret'));
});

test('U1: an urgent --first-start gives the app role its sealed password after the migrations, before the real deploy', async (t) => {
  const { result, order, steps, psql } = await urgent(t, { firstStart: true, empty: true });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data!.firstStart, true);
  assert.deepEqual(steps.slice(4, 7), ['deploy-hold', 'first-start', 'deploy']);
  assert.ok(order.indexOf('migrate:first-start:run') < order.indexOf('psql') && order.indexOf('psql') < order.lastIndexOf('deploy'), order.join(' '));
  assert.ok(order.includes('sealed:postgres:APP_BE_DB_PASSWORD'));
  assert.equal(psql.length, 1);
  assert.match(psql[0] as string, /ALTER ROLE "app_be" LOGIN PASSWORD/u);
  assert.ok(result.lines.includes('first start: the app role app_be has its password from the sealed postgres APP_BE_DB_PASSWORD'));
  assert.ok(!JSON.stringify(result).includes(SECRET), 'the value is in no line and no data');
  assert.ok(!order.some((name) => LOCAL.includes(name) || name === 'manager-backup'), 'a first start backs nothing up');
});

test('U1: an urgent deploy over an empty stack database takes the first start by itself, app role password included', async (t) => {
  const { result, order, psql } = await urgent(t, { empty: true, expand: EXPAND });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(order.indexOf('choice:empty?') < order.indexOf('deploy-hold'));
  assert.equal(psql.length, 1);
  assert.ok(!order.includes('manager-backup'));
});

test('U1: --db-service of a stack database must be its declared service; an external database must name one', async (t) => {
  await assert.rejects(urgent(t, { firstStart: true, empty: true, dbService: 'postgres' }), (error: { code?: string }) => error.code === 'STACK_FIRST_START_USAGE');
  await assert.rejects(urgent(t, { target: 'external', firstStart: true, empty: true }), (error: { code?: string }) => error.code === 'STACK_FIRST_START_USAGE');
  const named = await urgent(t, { firstStart: true, empty: true, dbService: 'db' });
  assert.equal(named.result.ok, true, named.result.lines.join('\n'));
});

test('U3: an urgent deploy runs the seed step after convergence, as every deploy does', async (t) => {
  const { result, order, steps } = await urgent(t, { seeds: true });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(steps.indexOf('converge') < steps.indexOf('seed') && steps.indexOf('seed') < steps.indexOf('verify'), steps.join(' '));
  assert.ok(order.includes('seed'));
  assert.ok(result.lines.includes('seed production/first-run: applied (sql, once)'));
});

test('U3: an urgent first start seeds the database it just made', async (t) => {
  const { result, steps } = await urgent(t, { seeds: true, firstStart: true, empty: true });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(steps.indexOf('first-start') < steps.indexOf('seed'), steps.join(' '));
});

test('U3: an urgent dry run names the backup on the manager and every seed entry, and touches nothing', async (t) => {
  const { result, order } = await urgent(t, { seeds: true, execute: false });
  assert.equal(result.ok, true, result.lines.join('\n'));
  const text = result.lines.join('\n');
  assert.match(text, /floor \(never skipped\).*on the manager.*seed/u);
  assert.match(text, /a verified backup made and test-decrypted on the manager \(always: the urgent floor\)/u);
  assert.match(text, /seed after convergence, each entry unless its receipt in public\.starci_seed_receipts holds: production\/first-run \(sql, once\)/u);
  assert.deepEqual(order, []);
});
