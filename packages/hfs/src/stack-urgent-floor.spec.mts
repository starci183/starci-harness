// The safety floor of an urgent deploy (stack/urgent-floor.mjs, owner ruling urgent-release 2026-10-29): every step is a refusal with its own
// code when it fails, the steps run in their order (backup, verify, test decrypt, rollback target, migrate preview, migrate, deploy), and nothing
// after a refused step runs.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { deployRelease } from '../stack/deploy.mjs';
import { urgentDeploy } from '../stack/urgent-floor.mjs';
import { recordsDouble } from './stack-records-double.mjs';
import type { FirstStartStepResult } from '../stack/urgent-floor.mjs';
import type { DbTarget } from '../db/postgres.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';
import type { StackContext } from '../stack/context.mjs';

/** The steps a floor double fails, by name. */
interface Fail { backup?: boolean; hash?: boolean; decrypt?: boolean; preview?: boolean; migrate?: boolean; noPrevious?: boolean; deploy?: string }
interface FirstFail { noContainer?: boolean; notEmpty?: boolean; preview?: boolean; noPrevious?: boolean }
interface AppShape { record?: boolean; pushed?: boolean; database?: boolean }
/** The stack context with its seams writable, as a spec edits them. */
type Ctx = { -readonly [K in keyof StackContext]: StackContext[K] };

const SHA = 'a'.repeat(40);
const PARTS = ['roles.sql', 'schema.sql', 'data.sql', 'rowcounts.json'];
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** An app root with the urgent record of SHA (pushed unless told otherwise), a database block and an identity file. */
function app(t: TestContext, { record = true, pushed = true, database = true }: AppShape = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-floor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const records = path.join(root, '.git', 'starci-release');
  fs.mkdirSync(records, { recursive: true });
  if (record) fs.writeFileSync(path.join(records, `${SHA}.urgent.json`), JSON.stringify({ schema: 'starci-app-urgent-record/1', head: SHA, tag: 'v1.0.0', role: 'owner', reason: 'tonight', pushed }));
  fs.mkdirSync(path.join(root, '.starcistacks'));
  fs.writeFileSync(path.join(root, '.starcistacks', 'application-stacks.yaml'), database ? 'database:\n  projectRef: abcdefghijklmnopqrst\n' : 'release: {}\n');
  const identity = path.join(root, 'identity.txt');
  fs.writeFileSync(identity, 'stand-in identity file; the decrypt is stubbed\n');
  const spawn = (command: string, args: string[]) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['rev-parse', '--git-common-dir']);
    return { status: 0, stdout: path.join(root, '.git'), stderr: '' };
  };
  // reason: the floor reads only cwd, env, now and spawn of the context and repoRoot, project and stack of the config; the doubles are not the full stack types.
  return { root, ctx: { cwd: root, env: { SOPS_AGE_KEY_FILE: identity }, now: Date.now, spawn } as unknown as Ctx, config: { repoRoot: root, project: 'floor', stack: 'floor' } as unknown as DeployConfig };
}

/** The collaborators, each recording its call; `fail` names the step that goes wrong and how. */
function world(root: string, fail: Fail = {}) {
  const calls: string[] = [];
  const out = path.join(root, 'backups');
  const deps = {
    backup: async () => {
      calls.push('backup');
      if (fail.backup) throw Object.assign(new Error('supabase is not reachable'), { code: 'DB_BACKUP_CLI_FAILED' });
      fs.mkdirSync(out, { recursive: true });
      const archive = path.join(out, 'floor.tar.age');
      fs.writeFileSync(archive, `age-encryption.org/v1\n${'x'.repeat(200)}`);
      const receipt = { schemaOnly: false, at: new Date().toISOString(), file: 'floor.tar.age', bytes: fs.statSync(archive).size, sha256: fail.hash ? '0'.repeat(64) : sha256(archive), parts: PARTS };
      return { receipt, receiptPath: path.join(out, 'floor.receipt.json') };
    },
    decrypt: async () => { calls.push('decrypt'); if (fail.decrypt) throw new Error('no identity matched'); return { parts: PARTS }; },
    migrate: async (_ctx: unknown, { execute }: { execute: boolean }) => {
      calls.push(execute ? 'migrate' : 'preview');
      if (!execute && fail.preview) return { ok: false, lines: ['RED: remote version 1 is unexplained'] };
      if (execute && fail.migrate) throw new Error('DB_FINAL_MISMATCH');
      return { ok: true, lines: [execute ? 'applied 1' : 'plan 1'] };
    },
  };
  const run = {
    render: async () => { calls.push('render'); return { releaseId: 'c'.repeat(16) }; },
    dryRun: async () => { calls.push('dry-run'); return { ok: true, lines: ['dry run: release would deploy'], data: { executed: false } }; },
    openStore: async () => ({ current: async () => { calls.push('current'); return fail.noPrevious ? '' : 'b'.repeat(16); } }),
    deployExecute: async (...args: unknown[]) => {
      calls.push('deploy');
      assert.deepEqual(args, [], 'a plain urgent deploy hands the deploy no first-start hooks: its stack is deployed whole, as before');
      if (fail.deploy === 'rolled-back') return { ok: false, lines: ['deploy failed at verify', 'rolled back'], data: { previous: 'b'.repeat(16), rolledBack: true, steps: [{ step: 'deploy', ok: true }, { step: 'verify', ok: false }] } };
      if (fail.deploy === 'stuck') return { ok: false, lines: ['ROLLBACK DID NOT CONVERGE'], data: { previous: 'b'.repeat(16), rolledBack: false, steps: [{ step: 'deploy', ok: true }, { step: 'verify', ok: false }] } };
      if (fail.deploy === 'early') return { ok: false, lines: ['deploy not started'], data: { rolledBack: false, steps: [{ step: 'render', ok: true }, { step: 'provision', ok: false }] } };
      return { ok: true, lines: ['deployed release c'], data: { releaseId: 'c'.repeat(16), steps: [{ step: 'deploy', ok: true }] } };
    },
    sha256,
  };
  return { calls, deps, run };
}

const OPTIONS = { sourceSha: SHA, execute: true, urgent: true };

test('the floor runs in order and the urgent deploy is accepted when every step is green', async (t) => {
  const { ctx, config, root } = app(t);
  const { calls, deps, run } = world(root);
  const result = await urgentDeploy(ctx, config, OPTIONS, run, deps);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data!.urgent, 'v1.0.0');
  assert.deepEqual(calls, ['backup', 'decrypt', 'render', 'current', 'preview', 'migrate', 'deploy']);
});

test('a dry run plans the floor and touches nothing', async (t) => {
  const { ctx, config, root } = app(t);
  const { calls, deps, run } = world(root);
  const result = await urgentDeploy(ctx, config, { ...OPTIONS, execute: false }, run, deps);
  assert.equal(result.ok, true);
  assert.ok(result.lines.some((line) => line.includes('floor (never skipped)')));
  assert.deepEqual(calls, ['dry-run']);
});

const REFUSALS: [string, Fail, string, string[]][] = [
  ['a failed backup', { backup: true }, 'STACK_URGENT_BACKUP_FAILED', ['backup']],
  ['a backup whose receipt does not match its archive', { hash: true }, 'STACK_URGENT_BACKUP_UNVERIFIED', ['backup']],
  ['a failed test decrypt', { decrypt: true }, 'STACK_URGENT_DECRYPT_FAILED', ['backup', 'decrypt']],
  ['no previous release to roll back to', { noPrevious: true }, 'STACK_URGENT_NO_ROLLBACK_TARGET', ['backup', 'decrypt', 'render', 'current']],
  ['a red migration preview', { preview: true }, 'STACK_URGENT_MIGRATE_PREVIEW_RED', ['backup', 'decrypt', 'render', 'current', 'preview']],
  ['a failed migration', { migrate: true }, 'STACK_URGENT_MIGRATE_FAILED', ['backup', 'decrypt', 'render', 'current', 'preview', 'migrate']],
  ['a red readiness verify that rolled back', { deploy: 'rolled-back' }, 'STACK_URGENT_RED_ROLLED_BACK', ['backup', 'decrypt', 'render', 'current', 'preview', 'migrate', 'deploy']],
  ['a red release whose rollback did not converge', { deploy: 'stuck' }, 'STACK_URGENT_ROLLBACK_FAILED', ['backup', 'decrypt', 'render', 'current', 'preview', 'migrate', 'deploy']],
  ['a release red before the stack deploy', { deploy: 'early' }, 'STACK_URGENT_DEPLOY_NOT_STARTED', ['backup', 'decrypt', 'render', 'current', 'preview', 'migrate', 'deploy']],
];

for (const [title, fail, code, steps] of REFUSALS) {
  test(`${code}: ${title} is refused and nothing after it runs`, async (t) => {
    const { ctx, config, root } = app(t);
    const { calls, deps, run } = world(root, fail);
    const result = await urgentDeploy(ctx, config, OPTIONS, run, deps);
    assert.equal(result.ok, false);
    assert.equal(result.refused!.code, code);
    assert.deepEqual(calls, steps);
  });
}

const PRECONDITIONS: [string, AppShape, { skipPublic?: boolean }, string][] = [
  ['no urgent record', { record: false }, {}, 'STACK_URGENT_NO_RECORD'],
  ['an urgent record that was never pushed', { pushed: false }, {}, 'STACK_URGENT_NOT_PUSHED'],
  ['no database block', { database: false }, {}, 'STACK_URGENT_NO_DATABASE'],
  ['the public checks skipped', {}, { skipPublic: true }, 'STACK_URGENT_SKIP_PUBLIC'],
];

for (const [title, shape, options, code] of PRECONDITIONS) {
  test(`${code}: ${title} is refused before any step`, async (t) => {
    const { ctx, config, root } = app(t, shape);
    const { calls, deps, run } = world(root);
    await assert.rejects(urgentDeploy(ctx, config, { ...OPTIONS, ...options }, run, deps), (error: { code?: string }) => error.code === code);
    assert.deepEqual(calls, []);
  });
}

test('STACK_URGENT_DECRYPT_UNAVAILABLE: without an age identity the backup cannot be proven, so nothing runs', async (t) => {
  const { ctx, config, root } = app(t);
  const { calls, deps, run } = world(root);
  await assert.rejects(urgentDeploy({ ...ctx, env: {} }, config, OPTIONS, run, deps), (error: { code?: string }) => error.code === 'STACK_URGENT_DECRYPT_UNAVAILABLE');
  assert.deepEqual(calls, []);
});

// The first start (--first-start --db-service): no backup and no test decrypt; the deploy's first-start step (between edge and converge) waits for
// the database container, proves it empty and migrates inside it; each failure is its own code and the deploy rolls back.
const FIRST = { ...OPTIONS, firstStart: true, dbService: 'postgres' };
const URL_ENV = { DATABASE_URL: 'postgresql://supabase_admin:s3cret@nivo-postgres:5432/postgres' };
const CONTAINER = 'f00dfeed0123456789';

/** The collaborators of a first start: the deploy runs the first-start step it is handed and rolls back when it is red. */
function firstWorld(fail: FirstFail = {}) {
  const calls: string[] = [];
  const deps = {
    backup: async () => { calls.push('backup'); throw new Error('a first start never backs up'); },
    decrypt: async () => { calls.push('decrypt'); throw new Error('a first start never decrypts'); },
    dbContainer: async () => { calls.push('container'); return fail.noContainer ? undefined : CONTAINER; },
    emptiness: async (_ctx: unknown, target: DbTarget) => {
      calls.push('empty?');
      assert.equal(target.container, CONTAINER);
      assert.ok(target.url.includes('127.0.0.1'), 'the in-container target reaches the database on loopback');
      return fail.notEmpty ? { empty: false, history: true, publicTables: 3 } : { empty: true, history: false, publicTables: 0 };
    },
    migrate: async (_ctx: unknown, { target, execute }: { target: Record<string, unknown>; execute: boolean }) => {
      calls.push(execute ? 'migrate' : 'preview');
      assert.equal((target.target as { container?: string }).container, CONTAINER);
      if (!execute && fail.preview) return { ok: false, lines: ['RED'] };
      return { ok: true, lines: [execute ? 'applied 3' : 'plan 3'] };
    },
  };
  const run = {
    render: async () => { calls.push('render'); return { releaseId: 'c'.repeat(16) }; },
    dryRun: async () => { calls.push('dry-run'); return { ok: true, lines: ['dry run'], data: { executed: false } }; },
    openStore: async () => ({ current: async () => { calls.push('current'); return fail.noPrevious ? '' : 'b'.repeat(16); } }),
    deployExecute: async (extra: { firstStartStep?: () => Promise<FirstStartStepResult>; firstStartDb?: string } = {}) => {
      calls.push('deploy');
      assert.equal(typeof extra.firstStartStep, 'function', 'a first start hands the deploy its first-start step');
      assert.equal(extra.firstStartDb, 'postgres', 'and the database service the hold deploy leaves running');
      const step = await extra.firstStartStep!();
      if (!step.ok) return { ok: false, lines: [...step.lines, 'rolled back'], data: { previous: 'b'.repeat(16), rolledBack: true, steps: [{ step: 'deploy', ok: true }, { step: 'first-start', ok: false }] } };
      calls.push('converge+verify');
      return { ok: true, lines: [...step.lines, 'deployed release c'], data: { releaseId: 'c'.repeat(16), steps: [{ step: 'deploy', ok: true }, { step: 'first-start', ok: true }] } };
    },
    sha256,
  };
  return { calls, deps, run };
}

test('a first start backs nothing up, proves the database empty and migrates it inside its container before converge', async (t) => {
  const { ctx, config } = app(t);
  ctx.env = { ...URL_ENV };
  const { calls, deps, run } = firstWorld();
  const result = await urgentDeploy(ctx, config, FIRST, run, deps);
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data!.urgent, 'v1.0.0');
  assert.deepEqual(calls, ['render', 'current', 'deploy', 'container', 'empty?', 'preview', 'migrate', 'converge+verify']);
  assert.ok(result.lines.some((line) => line.includes('is empty') && line.includes('nothing to back up')));
  assert.ok(!result.lines.join('\n').includes('s3cret'));
});

test('a first start dry run plans it and touches nothing', async (t) => {
  const { ctx, config } = app(t);
  ctx.env = { ...URL_ENV };
  const { calls, deps, run } = firstWorld();
  const result = await urgentDeploy(ctx, config, { ...FIRST, execute: false }, run, deps);
  assert.equal(result.ok, true);
  assert.ok(result.lines.some((line) => line.includes('first start of floor_postgres')));
  assert.ok(result.lines.some((line) => /hold deploy.*0 replicas.*migrate preview then execute.*then the real deploy/u.test(line)), 'the plan names the new order');
  assert.deepEqual(calls, ['dry-run']);
});

const FIRST_REFUSALS: [string, FirstFail, string, string[]][] = [
  ['no previous release to roll back to', { noPrevious: true }, 'STACK_URGENT_NO_ROLLBACK_TARGET', ['render', 'current']],
  ['no database container accepting connections', { noContainer: true }, 'STACK_FIRST_START_NO_DATABASE', ['render', 'current', 'deploy', 'container']],
  ['a database that is not empty', { notEmpty: true }, 'STACK_FIRST_START_NOT_EMPTY', ['render', 'current', 'deploy', 'container', 'empty?']],
  ['a red migration preview', { preview: true }, 'STACK_FIRST_START_MIGRATE_RED', ['render', 'current', 'deploy', 'container', 'empty?', 'preview']],
];

for (const [title, fail, code, steps] of FIRST_REFUSALS) {
  test(`${code}: a first start with ${title} is refused, rolled back, and nothing after it runs`, async (t) => {
    const { ctx, config } = app(t);
    ctx.env = { ...URL_ENV };
    const { calls, deps, run } = firstWorld(fail);
    const result = await urgentDeploy(ctx, config, FIRST, run, deps);
    assert.equal(result.ok, false);
    assert.equal(result.refused!.code, code);
    assert.deepEqual(calls, steps);
  });
}

test('STACK_FIRST_START_USAGE: a first start without --db-service is refused before any step', async (t) => {
  const { ctx, config } = app(t);
  const { calls, deps, run } = firstWorld();
  await assert.rejects(urgentDeploy(ctx, config, { ...FIRST, dbService: undefined }, run, deps), (error: { code?: string }) => error.code === 'STACK_FIRST_START_USAGE');
  assert.deepEqual(calls, []);
});

// The order of a first start inside the deploy (stack/deploy.mjs): the stack is first deployed with only the database running, so no app service
// starts against an empty schema (its healthcheck fails and update_config rolls it back); the first-start step migrates; then the real stack deploys.
const DIGEST = 'e'.repeat(64);
const STACK = [
  'services:',
  '  postgres:', `    image: registry.example/pg@sha256:${DIGEST}`, '    deploy:', '      replicas: 1',
  '  api:', `    image: registry.example/api@sha256:${DIGEST}`, '    deploy:', '      replicas: 3',
  '  worker:', `    image: registry.example/worker@sha256:${DIGEST}`,
  '  agent:', `    image: registry.example/agent@sha256:${DIGEST}`, '    deploy:', '      mode: global',
  '',
].join('\n');
const DEPLOY_CONFIG = { stack: 'shop', ingress: null, tasks: {}, postDeploy: [] };

/** deployRelease over stubbed collaborators and a recording docker; `order` holds the phases, `deploys` the files each `docker stack deploy` read. */
async function firstDeploy(t: TestContext, { stepOk = true, plain = false, db = 'postgres' }: { stepOk?: boolean; plain?: boolean; db?: string } = {}) {
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-first-start-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const order: string[] = [];
  const deploys: { name: string; text: string }[][] = [];
  const ok = (name: string) => async () => { order.push(name); return { ok: true, lines: [] }; };
  const store = { current: async () => 'a'.repeat(16), store: ok('store'), accept: ok('accept'), fetch: async (_release: unknown, dir: string) => { order.push('fetch'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'stack.yaml'), STACK); } };
  const deps = {
    renderRelease: async (_ctx: unknown, _config: unknown, options: { out: string }) => { fs.writeFileSync(path.join(options.out, 'stack.yaml'), STACK); return { ok: true, lines: [] }; },
    provisionRelease: ok('provision'), releaseStore: () => ({ ...store, ...recordsDouble() }), ssh: async () => ({ cleanup() {} }),
    reconcileEdge: ok('edge'), convergeStack: ok('converge'), verifyStack: ok('verify'), pruneStack: ok('prune'),
  };
  const spawn = (_command: string, args: string[]) => {
    if (args[0] === 'stack' && args[1] === 'deploy') {
      const files = args.filter((_arg, index) => args[index - 1] === '-c');
      order.push(files.length > 1 ? 'deploy-hold' : 'deploy');
      deploys.push(files.map((file) => ({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') })));
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const hooks = plain ? {} : { firstStartDb: db, firstStartStep: async () => { order.push('migrate'); return { ok: stepOk, lines: [] }; } };
  // reason: deployRelease reads only spawn, env and now of the context, the stack, ingress, tasks and postDeploy of the config, and the seams the doubles replace.
  const result = await deployRelease({ spawn, env: {}, now: () => 1000 } as unknown as StackContext, DEPLOY_CONFIG as unknown as DeployConfig, { sourceSha: 'f'.repeat(40), execute: true, out, ...hooks }, deps as unknown as Partial<DeployDeps>);
  return { result, order, deploys };
}

test('a first start deploys every service but the database at 0 replicas, migrates, and only then deploys the real stack', async (t) => {
  const { result, order, deploys } = await firstDeploy(t);
  assert.equal(result.ok, true);
  assert.deepEqual((result.data!.steps as { step: string }[]).map((entry) => entry.step), ['render', 'provision', 'store', 'pre-pull', 'deploy-hold', 'first-start', 'deploy', 'edge', 'converge', 'verify', 'accept']);
  assert.ok(order.indexOf('deploy-hold') < order.indexOf('migrate') && order.indexOf('migrate') < order.indexOf('deploy'), order.join(' '));
  assert.ok(order.indexOf('deploy') < order.indexOf('converge'), 'converge waits for the real deploy');
  const [hold, real] = deploys as [typeof deploys[number], typeof deploys[number]];
  assert.deepEqual(hold.map((file) => file.name), ['stack.yaml', 'stack.first-start-hold.yaml']);
  const { services } = JSON.parse(hold[1]!.text);
  assert.deepEqual(Object.keys(services).sort(), ['agent', 'api', 'worker'], 'the database is not overridden');
  assert.deepEqual(services.api, { deploy: { replicas: 0 } });
  assert.deepEqual(services.worker, { deploy: { replicas: 0 } }, 'a service without a replica count is held too');
  assert.deepEqual(services.agent.deploy.placement.constraints, ['node.labels.starci-first-start-hold == 1'], 'a global service has no replicas: no node may run it');
  assert.equal(hold[0]!.text, STACK);
  assert.deepEqual(real.map((file) => file.name), ['stack.yaml'], 'the real deploy is the stored stack, with no override');
  assert.equal(real[0]!.text, STACK);
});

test('a first start whose migration is red leaves no app service started and rolls back', async (t) => {
  const { result, order, deploys } = await firstDeploy(t, { stepOk: false });
  assert.equal(result.ok, false);
  assert.equal(result.data!.rolledBack, true);
  assert.deepEqual((result.data!.steps as { step: string }[]).map((entry) => entry.step).slice(4, 6), ['deploy-hold', 'first-start']);
  assert.equal(deploys.length, 2, 'the hold deploy and the rollback deploy; the real stack was never deployed');
  assert.equal(deploys[0]!.length, 2);
  assert.ok(order.indexOf('migrate') < order.indexOf('fetch'));
  assert.ok(!order.includes('verify') && !order.includes('accept'));
  assert.ok(order.indexOf('edge') > order.indexOf('fetch') && order.indexOf('converge') > order.indexOf('fetch'), 'edge and converge run only for the rollback');
});

test('a first start naming a database that is not a service of the stack is refused before anything is deployed', async (t) => {
  await assert.rejects(firstDeploy(t, { db: 'nope' }), (error: { code?: string }) => error.code === 'STACK_FIRST_START_USAGE');
});

test('a deploy without the first-start hooks deploys the whole stack once, as before', async (t) => {
  const { result, order, deploys } = await firstDeploy(t, { plain: true });
  assert.equal(result.ok, true);
  assert.deepEqual((result.data!.steps as { step: string }[]).map((entry) => entry.step), ['render', 'provision', 'store', 'pre-pull', 'deploy', 'edge', 'converge', 'verify', 'accept']);
  assert.equal(deploys.length, 1);
  assert.deepEqual(deploys[0]!.map((file) => file.name), ['stack.yaml']);
  assert.ok(!order.includes('deploy-hold'));
});
