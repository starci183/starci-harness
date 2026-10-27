// Spec: deploy.postDeploy runs declared release tasks after convergence and before the read-only verification
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { deployRelease } from '../stack/deploy.mjs';
import { postDeployStack } from '../stack/post-deploy.mjs';

const probe = { exists: () => true, services: new Set(['api']), members: new Set() };
const declaredTasks = { 'seed-modules': { service: 'api', command: ['node', 'dist/cli.js', 'seed-modules', 'ensure'] }, 'warm-cache': { service: 'api', command: ['node', 'dist/cli.js', 'warm'], timeoutSeconds: 60 } };
const tasks = { 'seed-modules': { ...declaredTasks['seed-modules'], timeoutSeconds: 600 }, 'warm-cache': declaredTasks['warm-cache'] };
const block = (extra) => ({ remote: { host: 'vps' }, tasks: declaredTasks, ...extra });
const problemsOf = (extra) => normalizeDeploy(block(extra), { project: 'shop', probe }).problems.map((item) => `${item.at}: ${item.message}`).join('\n');

test('postDeploy lists declared tasks in run order and defaults to none', () => {
  assert.deepEqual(normalizeDeploy(block({ postDeploy: ['seed-modules', 'warm-cache'] }), { project: 'shop', probe }).config.postDeploy, ['seed-modules', 'warm-cache']);
  assert.deepEqual(normalizeDeploy(block({}), { project: 'shop', probe }).config.postDeploy, []);
});

test('a task timeout defaults to 600 seconds and is a whole number of seconds from 1 to 3600', () => {
  const config = normalizeDeploy(block({}), { project: 'shop', probe }).config;
  assert.deepEqual([config.tasks['seed-modules'].timeoutSeconds, config.tasks['warm-cache'].timeoutSeconds], [600, 60]);
  for (const bad of [0, 3601, 1.5, '60']) {
    const refused = normalizeDeploy(block({ tasks: { 'seed-modules': { ...declaredTasks['seed-modules'], timeoutSeconds: bad } } }), { project: 'shop', probe });
    assert.match(refused.problems.map((item) => `${item.at}: ${item.message}`).join('\n'), /deploy\.tasks\.seed-modules\.timeoutSeconds: must be a whole number of seconds/u, String(bad));
  }
});

test('postDeploy refuses a name no deploy.tasks entry declares, a repeat and a non-list', () => {
  assert.match(problemsOf({ postDeploy: ['seed-modules', 'nope'] }), /deploy\.postDeploy\[1\]: must name a task declared under deploy\.tasks/u);
  assert.match(problemsOf({ postDeploy: ['seed-modules', 'seed-modules'] }), /deploy\.postDeploy\[1\]: seed-modules is listed twice/u);
  assert.match(problemsOf({ postDeploy: 'seed-modules' }), /deploy\.postDeploy: must be a list/u);
  assert.match(problemsOf({ postDeploy: ['seed-modules'], tasks: undefined }), /deploy\.postDeploy\[0\]: must name a task declared/u);
});

/** A daemon whose docker calls are recorded; `exec` answers by the task command's second argument. */
const daemon = (exits = {}) => {
  const calls = [];
  const spawn = (command, args, options) => {
    assert.equal(command, 'docker');
    calls.push(Object.assign([...args], { options }));
    if (args[0] === 'ps') return { status: 0, stdout: 'abc123def456\n', stderr: '' };
    if (args[0] === 'exec') { const status = exits[args[4]] ?? 0; return { status, stdout: `ran ${args[4]} postgres://app:hunter2@db/prod\n`, stderr: status === 0 ? '' : 'boom secret-token\n' }; }
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, spawn };
};
const configOf = (postDeploy) => ({ stack: 'shop', tasks, postDeploy });

test('post-deploy tasks exec in the running container in order and run with their configured timeout and withhold their output', async () => {
  const { calls, spawn } = daemon();
  const result = await postDeployStack({ spawn, env: {} }, configOf(['seed-modules', 'warm-cache']));
  assert.equal(result.ok, true);
  const execs = calls.filter((args) => args[0] === 'exec');
  assert.deepEqual(execs.map((args) => [...args]), [['exec', 'abc123def456', 'node', 'dist/cli.js', 'seed-modules', 'ensure'], ['exec', 'abc123def456', 'node', 'dist/cli.js', 'warm']]);
  assert.deepEqual(execs.map((args) => args.options.timeout), [600_000, 60_000]);
  assert.deepEqual(result.lines, ['PASS  post-deploy seed-modules  ok (1 output line withheld)', 'PASS  post-deploy warm-cache  ok (1 output line withheld)']);
});

test('the first failing post-deploy task stops the list', async () => {
  const { calls, spawn } = daemon({ 'seed-modules': 3 });
  const result = await postDeployStack({ spawn, env: {} }, configOf(['seed-modules', 'warm-cache']));
  assert.equal(result.ok, false);
  assert.equal(calls.filter((args) => args[0] === 'exec').length, 1);
  assert.deepEqual(result.lines, ['FAIL  post-deploy seed-modules  exit 3 (2 output lines withheld)']);
  assert.doesNotMatch(result.lines.join('\n'), /hunter2|secret-token|postgres:/u, 'the output of a task never reaches the deploy log');
});

test('a post-deploy task that runs past its timeout fails the step instead of hanging the deploy', async () => {
  const spawn = (command, args) => (args[0] === 'ps' ? { status: 0, stdout: 'abc123def456\n', stderr: '' } : { status: null, stdout: '', stderr: '', error: { code: 'ETIMEDOUT' } });
  const result = await postDeployStack({ spawn, env: {} }, configOf(['seed-modules', 'warm-cache']));
  assert.equal(result.ok, false);
  assert.deepEqual(result.lines, ['FAIL  post-deploy seed-modules  timed out after 600s (0 output lines withheld)']);
});

/** deployRelease over stubbed collaborators; `order` records the phases in the order they ran. */
const release = async (t, { postDeploy, failPost = false }) => {
  const out = fs.mkdtempSync(path.join(tempRoot(), 'hfs-post-deploy-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const order = [];
  const ok = (name) => async () => { order.push(name); return { ok: true, lines: [] }; };
  const store = { current: async () => 'a'.repeat(16), store: ok('store'), accept: ok('accept'), fetch: async () => { order.push('fetch'); fs.writeFileSync(path.join(out, 'previous-fetched'), ''); }, previous: async () => null };
  const deps = {
    renderRelease: async (ctx, config, options) => { fs.writeFileSync(path.join(options.out, 'stack.yaml'), 'services:\n  api:\n    image: registry.example/shop-api@sha256:' + 'e'.repeat(64) + '\n'); return { ok: true, lines: [] }; },
    provisionRelease: ok('provision'),
    releaseStore: () => store,
    ssh: async () => ({ cleanup() {} }),
    reconcileEdge: ok('edge'),
    convergeStack: ok('converge'),
    postDeployStack: async () => { order.push('post-deploy'); return { ok: !failPost, lines: [] }; },
    verifyStack: ok('verify'),
    pruneStack: ok('prune'),
  };
  const spawn = (command, args) => { if (args[0] === 'stack') order.push(args.includes('-c') ? 'stack-deploy' : 'other'); return { status: 0, stdout: '', stderr: '' }; };
  const config = { stack: 'shop', ingress: null, tasks, postDeploy };
  const result = await deployRelease({ spawn, env: {}, now: () => 1000 }, config, { sourceSha: 'f'.repeat(40), execute: true, out }, deps);
  return { result, order };
};

test('deploy runs the post-deploy phase after convergence and before verification', async (t) => {
  const { result, order } = await release(t, { postDeploy: ['seed-modules'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.steps.map((entry) => entry.step), ['render', 'provision', 'store', 'pre-pull', 'deploy', 'edge', 'converge', 'post-deploy', 'verify', 'accept']);
  assert.ok(order.indexOf('converge') < order.indexOf('post-deploy') && order.indexOf('post-deploy') < order.indexOf('verify'));
});

test('a deploy without postDeploy keeps its phases, and a failed post-deploy task never reaches verification and rolls back', async (t) => {
  const plain = await release(t, { postDeploy: [] });
  assert.equal(plain.result.data.steps.some((entry) => entry.step === 'post-deploy'), false);
  const failed = await release(t, { postDeploy: ['seed-modules'], failPost: true });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.order.includes('verify'), false);
  assert.equal(failed.result.data.rolledBack, true);
  assert.match(failed.result.lines.join('\n'), /deploy failed at post-deploy/u);
});
