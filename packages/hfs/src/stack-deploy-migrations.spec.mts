// The database phases of a deploy (stack/db-phases.mjs driven by stack/deploy.mjs, owner approval 2026-10-31): for an app that declares the
// `database:` block, every deploy previews the migrations inside the database container, backs up ONLY when something is pending, applies the expand
// migrations before the stack deploy, applies the contract migrations after the accept, and chooses the first start by itself when no release was ever
// accepted. A refusal before the stack deploy leaves the services untouched. Collaborators are doubles; no registry, VPS or database is reached.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { recordsDouble } from './stack-records-double.mjs';
import { acceptRelease, deployRelease } from '../stack/deploy.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { ReleaseStore } from '../stack/release-store.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';

import type { StackContext } from '../stack/context.mjs';
import type { DbTarget as PostgresTarget } from '../db/postgres.mjs';

const DIGEST = 'e'.repeat(64);
const STACK = ['services:', '  db:', `    image: registry.example/db@sha256:${DIGEST}`, '    deploy:', '      replicas: 1', '  api:', `    image: registry.example/api@sha256:${DIGEST}`, '    deploy:', '      replicas: 2', ''].join('\n');
const RECIPIENT = `age1${'q'.repeat(58)}`;
const CONTAINER = 'abcdef012345';
const PREVIOUS = 'a'.repeat(16);
const EXPAND = ['20261102000000_orders-total.sql'];
const CONTRACT = ['20261103000000_orders_contract_drop-legacy.sql'];

/** What the double database holds and what each double step does. */
interface Scenario {
  expand?: string[];
  contract?: string[];
  previous?: string;
  target?: 'stack' | 'external';
  previewRed?: boolean;
  noContainer?: boolean;
  backup?: 'fail' | 'unverified';
  decryptFails?: boolean;
  migrateFails?: boolean;
  contractFails?: boolean;
  notEmpty?: boolean;
  skipPublic?: boolean;
  dbUrlEnv?: string;
  execute?: boolean;
  services?: string[];
}

/** An app root declaring the `database:` block, with the recipient file the backup encrypts to. */
function app(t: TestContext, target: 'stack' | 'external') {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-deploy-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), `database:\n  target: ${target}\n  service: db\n`);
  fs.writeFileSync(path.join(root, '.sops.yaml'), `creation_rules:\n  - age: ${RECIPIENT}\n`);
  return root;
}

/** deployRelease over doubles; `order` records every effect in the order it happened. */
async function run(t: TestContext, scenario: Scenario = {}) {
  const target = scenario.target ?? 'stack';
  const root = app(t, target);
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-deploy-db-out-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const order: string[] = [];
  const state = { expand: [...(scenario.expand ?? [])], contract: [...(scenario.contract ?? [])] };
  const previous = scenario.previous ?? PREVIOUS;
  const ok = (name: string) => async () => { order.push(name); return { ok: true, lines: [] }; };
  const store = {
    ...recordsDouble(),
    current: async () => previous, store: ok('store'), accept: ok('accept'),
    fetch: async (_release: unknown, dir: string) => { order.push('fetch'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), STACK); },
  };
  const archive = path.join(root, 'orders-backup.tar.age');
  const floor = {
    dbContainer: async () => { order.push('container'); return scenario.noContainer ? undefined : CONTAINER; },
    // reason: the phases read only url, container and own of the target; the double is not a full connection description.
    containerTarget: () => ({ url: 'postgresql://app@127.0.0.1:5432/app', container: CONTAINER, own: true, env: {}, secrets: [], how: 'double' }) as unknown as PostgresTarget,
    emptiness: async () => { order.push('empty?'); return scenario.notEmpty ? { empty: false, history: true, publicTables: 2 } : { empty: true, history: false, publicTables: 0 }; },
    migrate: async (_ctx: unknown, { execute, phase }: { target: Record<string, unknown>; execute: boolean; phase?: string | undefined }) => {
      order.push(`migrate:${phase ?? 'first-start'}:${execute ? 'run' : 'preview'}`);
      const files = phase === 'contract' ? state.contract : phase === 'expand' ? state.expand : [...state.expand, ...state.contract];
      if (!execute) return scenario.previewRed && phase === 'all' ? { ok: false, lines: ['RED: unexplained version'] } : { ok: true, lines: [`plan ${files.length}`], data: { done: files.length === 0, pushFiles: files } };
      if (scenario.migrateFails && phase === 'expand') return { ok: false, lines: ['relation exists'] };
      if (scenario.contractFails && phase === 'contract') return { ok: false, lines: ['column in use'] };
      const applied = phase === 'contract' ? state.contract.splice(0) : phase === 'expand' ? state.expand.splice(0) : [...state.expand.splice(0), ...state.contract.splice(0)];
      return { ok: true, lines: [`applied ${applied.length}`], data: { done: true, pushed: applied.map((file) => file.slice(0, 14)) } };
    },
    managerBackup: async () => {
      order.push('backup');
      if (scenario.backup === 'fail') throw new Error('docker exec failed');
      const body = `age-encryption.org/v1\n${'x'.repeat(100)}`;
      const sha256 = createHash('sha256').update(body).digest('hex');
      const receipt = { schemaOnly: false, at: new Date().toISOString(), file: 'orders-backup.tar.age', bytes: body.length, sha256, parts: ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json'] };
      return { receiptPath: '/var/backups/shop/db/orders-backup.receipt.json', archive: '/var/backups/shop/db/orders-backup.tar.age', receipt, facts: { exists: true, size: body.length, header: true, sha256: scenario.backup === 'unverified' ? '0'.repeat(64) : sha256 } };
    },
    managerDecrypt: async () => { order.push('decrypt'); if (scenario.decryptFails) throw new Error('no identity matched'); return ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json']; },
    backup: async () => {
      order.push('backup');
      const body = `age-encryption.org/v1\n${'y'.repeat(80)}`;
      fs.writeFileSync(archive, body);
      const receipt = { schemaOnly: false, at: new Date().toISOString(), file: path.basename(archive), bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), parts: ['roles.sql'] };
      return { receiptPath: path.join(root, 'orders-backup.receipt.json'), receipt };
    },
    decrypt: async () => { order.push('decrypt'); return { parts: ['roles.sql'] }; },
  };
  const deps = {
    renderRelease: async (_ctx: unknown, _config: unknown, options: { out: string }) => { fs.writeFileSync(path.join(options.out, 'stack.yaml'), STACK); return { ok: true, lines: [] }; },
    provisionRelease: ok('provision'), releaseStore: () => store, ssh: async () => ({ cleanup() {} }),
    reconcileEdge: ok('edge'), convergeStack: ok('converge'), verifyStack: ok('verify'), pruneStack: ok('prune'), postDeployStack: ok('post-deploy'),
    floor,
  };
  const spawn = (_command: string, args: string[]) => {
    if (args[0] === 'stack' && args[1] === 'deploy') order.push(args.filter((_arg, index) => args[index - 1] === '-c').length > 1 ? 'deploy-hold' : 'deploy');
    return { status: 0, stdout: '', stderr: '' };
  };
  const identity = path.join(root, 'identity.txt');
  fs.writeFileSync(identity, 'stand-in identity\n');
  const env = { SOPS_AGE_KEY_FILE: identity, DATABASE_URL: 'postgresql://owner:s3cret@db.example:5432/app' };
  // reason: deployRelease reads only spawn, env, now and cwd of the context, repoRoot, stack, project, remote, backup, ingress, tasks and postDeploy of the config, and the seams the doubles replace.
  const ctx = { spawn, env, now: () => Date.now(), cwd: root } as unknown as StackContext;
  const config = { stack: 'shop', project: 'shop', repoRoot: root, remote: { serverRecipient: null }, backup: null, ingress: null, tasks: {}, postDeploy: [], ...(scenario.services ? { services: new Set(scenario.services) } : {}) } as unknown as DeployConfig;
  const result = await deployRelease(ctx, config, { sourceSha: 'f'.repeat(40), execute: scenario.execute ?? true, out, skipPublic: scenario.skipPublic, dbUrlEnv: scenario.dbUrlEnv }, deps as unknown as Partial<DeployDeps>);
  const steps = ((result.data?.steps ?? []) as { step: string; ok: boolean }[]).map((entry) => entry.step);
  return { result, order, steps, root, ctx, config, deps, state };
}

const AFTER_STORE = (order: string[]) => order.slice(order.indexOf('store') + 1).filter((name) => !['provision', 'edge', 'converge', 'verify', 'prune', 'container', 'post-deploy', 'fetch'].includes(name));

test('nothing pending: no backup, no migration, and the contract pass after accept is a green preview', async (t) => {
  const { result, order, steps } = await run(t);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(AFTER_STORE(order), ['migrate:all:preview', 'deploy', 'accept', 'migrate:contract:preview']);
  assert.equal((result.data!.migrations as { backup: unknown }).backup, null, 'the record says there was no backup');
  assert.ok(result.lines.some((line) => line.includes('no migration is pending: no backup was taken')));
  assert.deepEqual(steps.slice(0, 5), ['render', 'provision', 'store', 'pre-pull', 'db-preview']);
  assert.ok(!steps.includes('backup') && !steps.includes('migrate'));
});

test('expand migrations pending: verified backup and test decrypt first, expand migrate next, and only then the stack deploy', async (t) => {
  const { result, order, steps } = await run(t, { expand: EXPAND });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(AFTER_STORE(order), ['migrate:all:preview', 'backup', 'decrypt', 'migrate:expand:run', 'deploy', 'accept', 'migrate:contract:preview']);
  assert.deepEqual(steps.slice(4, 8), ['db-preview', 'backup', 'migrate', 'deploy']);
  const record = result.data!.migrations as { backup: { where: string; receiptPath: string }; applied: string[]; expand: string[] };
  assert.equal(record.backup.where, 'manager');
  assert.match(record.backup.receiptPath, /receipt\.json$/u);
  assert.deepEqual(record.applied, ['20261102000000']);
  assert.deepEqual(record.expand, EXPAND);
});

test('a contract migration waits for the accept; a release carrying both is backed up once before either', async (t) => {
  const { result, order, steps } = await run(t, { expand: EXPAND, contract: CONTRACT });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(steps.at(-1), 'contract', 'the contract pass is a recorded step after accept');
  assert.deepEqual(AFTER_STORE(order), ['migrate:all:preview', 'backup', 'decrypt', 'migrate:expand:run', 'deploy', 'accept', 'migrate:contract:preview', 'migrate:contract:run']);
  const record = result.data!.migrations as { contract: string[]; contractApplied: string[] };
  assert.deepEqual(record.contract, CONTRACT);
  assert.deepEqual(record.contractApplied, ['20261103000000']);
});

test('a release that only carries a contract migration still gets its backup before the data is destroyed', async (t) => {
  const { result, order } = await run(t, { contract: CONTRACT });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(order.indexOf('backup') < order.indexOf('deploy') && order.indexOf('deploy') < order.indexOf('migrate:contract:run'), order.join(' '));
});

const REFUSALS: [string, Scenario, string, string[]][] = [
  ['a red migration preview', { expand: EXPAND, previewRed: true }, 'STACK_DEPLOY_MIGRATE_PREVIEW_RED', ['migrate:all:preview']],
  ['a database container that never accepts connections', { noContainer: true }, 'STACK_DEPLOY_DB_UNAVAILABLE', []],
  ['a failed backup', { expand: EXPAND, backup: 'fail' }, 'STACK_DEPLOY_BACKUP_FAILED', ['migrate:all:preview', 'backup']],
  ['a backup whose receipt does not match its archive', { expand: EXPAND, backup: 'unverified' }, 'STACK_DEPLOY_BACKUP_UNVERIFIED', ['migrate:all:preview', 'backup']],
  ['a failed test decrypt', { expand: EXPAND, decryptFails: true }, 'STACK_DEPLOY_BACKUP_DECRYPT_FAILED', ['migrate:all:preview', 'backup', 'decrypt']],
  ['a failed expand migration', { expand: EXPAND, migrateFails: true }, 'STACK_DEPLOY_MIGRATE_FAILED', ['migrate:all:preview', 'backup', 'decrypt', 'migrate:expand:run']],
];

for (const [title, scenario, code, steps] of REFUSALS) {
  test(`${code}: ${title} is refused with the services untouched`, async (t) => {
    const { result, order } = await run(t, scenario);
    assert.equal(result.ok, false);
    assert.equal(result.refused!.code, code);
    assert.deepEqual(AFTER_STORE(order), steps, 'nothing after the refused step runs');
    assert.ok(!order.includes('deploy') && !order.includes('fetch') && !order.includes('accept'), 'no stack deploy, no rollback, no accept');
    assert.ok(result.lines.includes('deploy not started; the services are untouched'));
  });
}

test('a red contract migration leaves the release accepted: a red job, no rollback', async (t) => {
  const { result, order } = await run(t, { contract: CONTRACT, contractFails: true });
  assert.equal(result.ok, false);
  assert.equal(result.data!.accepted, true);
  assert.equal(result.data!.contractFailed, true);
  assert.ok(order.includes('accept') && order.filter((name) => name === 'deploy').length === 1, 'accepted, and no rollback redeployed the previous release');
  assert.ok(result.lines.some((line) => line.includes('is accepted and serving') && line.includes('the owner decides')));
});

test('no accepted release: the first start is chosen by itself (hold deploy, empty proof, migrate everything, real deploy), with no backup', async (t) => {
  const { result, order, steps } = await run(t, { previous: '', expand: EXPAND, contract: CONTRACT });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.deepEqual(steps.slice(4, 8), ['deploy-hold', 'first-start', 'deploy', 'edge']);
  assert.deepEqual(AFTER_STORE(order), ['deploy-hold', 'empty?', 'migrate:first-start:preview', 'migrate:first-start:run', 'deploy', 'accept']);
  assert.ok(!order.includes('backup'));
  assert.ok(result.lines.some((line) => line.includes('is empty') && line.includes('nothing to back up')));
  assert.equal(result.data!.migrations, undefined, 'the first start has no expand or contract pass: it applied everything on an empty database');
});

test('STACK_FIRST_START_NOT_EMPTY: no accepted release and a database holding data is refused for the owner', async (t) => {
  const { result, order } = await run(t, { previous: '', notEmpty: true });
  assert.equal(result.ok, false);
  assert.equal(result.refused!.code, 'STACK_FIRST_START_NOT_EMPTY');
  assert.ok(!order.some((name) => name.startsWith('migrate')) && !order.includes('backup') && !order.includes('accept'));
  assert.ok(result.lines.some((line) => line.includes('needs the owner')));
});

test('an external database keeps --db-url-env: migrate by the URL, backup where the deploy runs, no container', async (t) => {
  const { result, order } = await run(t, { target: 'external', expand: EXPAND, dbUrlEnv: 'DATABASE_URL' });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(!order.includes('container'), 'an external database has no container to reach');
  assert.deepEqual(AFTER_STORE(order), ['migrate:all:preview', 'backup', 'decrypt', 'migrate:expand:run', 'deploy', 'accept', 'migrate:contract:preview']);
  assert.equal((result.data!.migrations as { backup: { where: string } }).backup.where, 'local');
  assert.ok(!result.lines.join('\n').includes('s3cret'));
});

test('STACK_DEPLOY_DB_URL_UNEXPECTED: --db-url-env on a database that runs in the stack is refused, not silently ignored', async (t) => {
  const { result, order } = await run(t, { dbUrlEnv: 'DATABASE_URL' });
  assert.equal(result.refused!.code, 'STACK_DEPLOY_DB_URL_UNEXPECTED');
  assert.ok(!order.includes('deploy'));
});

test('skipPublic: the contract migrations wait for the accept verb, which applies them', async (t) => {
  const { result, order, ctx, config, deps, state } = await run(t, { expand: EXPAND, contract: CONTRACT, skipPublic: true });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data!.pendingAccept, true);
  assert.ok(!order.includes('migrate:contract:run') && !order.includes('accept'));
  assert.ok(result.lines.some((line) => line.includes('contract migrations (if any) run when the release is accepted')));
  assert.deepEqual(state.contract, CONTRACT);
  // reason: acceptRelease uses only current, fetch and accept of the store.
  const pointer = { ...recordsDouble(), current: async () => PREVIOUS, fetch: async (_id: string, dir: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), STACK); }, accept: async () => { order.push('accept'); } } as unknown as ReleaseStore;
  const accepted = await acceptRelease(ctx, config, { release: result.data!.releaseId as string, execute: true }, { ...(deps as unknown as Partial<DeployDeps>), releaseStore: () => pointer });
  assert.equal(accepted.ok, true, accepted.lines.join('\n'));
  assert.ok(order.indexOf('accept') < order.indexOf('migrate:contract:run'), 'the contract pass runs after the accept');
  assert.deepEqual(accepted.data!.contractApplied, ['20261103000000']);
});

test('a dry run names the database phases and makes no remote or database call', async (t) => {
  const { result, order } = await run(t, { execute: false, expand: EXPAND });
  assert.equal(result.ok, true);
  assert.ok(result.lines.some((line) => line.includes('migrate preview, a verified backup only when a migration is pending')));
  assert.deepEqual(order, []);
});

test('STACK_DEPLOY_DB_SERVICE_UNKNOWN: a database block whose service is not in the stack is refused for an app that should declare target: external', async (t) => {
  const { result, order } = await run(t, { services: ['api'], expand: EXPAND });
  assert.equal(result.refused!.code, 'STACK_DEPLOY_DB_SERVICE_UNKNOWN');
  assert.match(result.refused!.message, /database\.target: external/u);
  assert.ok(!order.includes('deploy') && !order.includes('container'));
  assert.equal((await run(t, { services: ['api', 'db'] })).result.ok, true, 'the service is there: the phases run');
  assert.equal((await run(t, { services: ['api'], target: 'external', dbUrlEnv: 'DATABASE_URL' })).result.ok, true, 'an external database needs no stack service');
});
