// proves: STACK_BUILD_BUILDER_HOST
// proves: STACK_BUILD_BUILDER_HOST
// proves: STACK_BUILD_REMOTE_UNREACHABLE
// proves: STACK_BUILD_REMOTE_UNREACHABLE
// The remote BuildKit of a managed VPS on the client side (contexts/harness/managed-vps.md "Remote BuildKit"): images.yml renders exactly as before unless the app
// declares ci.imageBuilder remote; with it, the job tries the builder over ssh with the repository's key and falls back to the runner's builder,
// ci.yml passes the three builder secrets, a multi-architecture build stays on the runner; `starci app stack build --builder-host` creates and
// bootstraps the buildx builder `starci-remote` and builds through it, and refuses an unreachable one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTargets } from '../sync/index.mjs';
import type { DeclaredStack } from '../sync/stack-images.mjs';
import { declaredStack } from '../sync/stack-images.mjs';
import { BUILDER_SECRETS, REMOTE_BUILDER, RUNNER_FALLBACK } from '../stack/remote-builder.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { workflowContextsFindings } from '../runtime/scripts/hfs/rules/workflow-contexts.mjs';
import { supplyChainFindings } from '../runtime/scripts/hfs/rules/supply-chain.mjs';
import { ensureRemoteBuilder, remoteBuilderEndpoint } from '../stack/build.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { RunResult, StackContext } from '../stack/context.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

// reason: a workflow document is parsed-YAML-shaped data the cases read freely.
type Doc = any;
// reason: the stub carries only the facts the workflow templates read.
type AppSource = NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;

const environment = (name: string, platforms = ['linux/amd64']) => ({ name, auto: true, approval: 'none' as const, platforms });
const STACK: DeclaredStack = {
  images: [{ service: 'api', app: 'core', buildArgs: false, sealed: false }, { service: 'web', app: 'web', buildArgs: true, sealed: true }],
  passEnv: [],
  imageEnvironments: { production: ['core', 'web'] },
  environments: [environment('production')],
  imageCache: 'gha',
};

function rendered(stack: DeclaredStack): Record<string, string> {
  const source = { files: [], read: () => '', stack, hasImage: () => true } as unknown as AppSource;
  const targets = renderTargets({ ...structuredClone(APP), edition: 'lite' }, PRESETS, { source });
  return Object.fromEntries(targets.filter((target) => target.path.startsWith('.github/workflows/')).map((target) => [path.basename(target.path, '.yml'), target.content]));
}

const stepIndex = (steps: Doc[], test: (step: Doc) => boolean): number => steps.findIndex(test);

test('without ci.imageBuilder (or with runner) images.yml and ci.yml render exactly as before: no remote step, no builder secret', () => {
  const plain = rendered(STACK);
  assert.deepEqual(rendered({ ...STACK, imageBuilder: 'runner' }), plain);
  for (const text of [plain['images']!, plain['ci']!]) assert.doesNotMatch(text, /STARCI_BUILDER|starci-remote|remote builder/u);
  const images: Doc = parseWorkflow(plain['images']!);
  assert.equal(images.on.workflow_call.secrets, undefined);
  for (const id of ['image', 'image-sealed']) {
    const setup = images.jobs[id].steps.find((step: Doc) => String(step.uses).startsWith('docker/setup-buildx-action@'));
    assert.equal(setup.if, undefined);
  }
  assert.equal((parseWorkflow(plain['ci']!) as Doc).jobs.images.secrets, undefined);
});

test('with ci.imageBuilder remote every image job tries the remote builder first and falls back to the runner, and ci.yml passes the secrets by inheritance', () => {
  const workflows = rendered({ ...STACK, imageBuilder: 'remote' });
  const images: Doc = parseWorkflow(workflows['images']!);
  assert.equal(images.on.workflow_call.secrets, undefined, 'no declared secrets: they would hide the SOPS_AGE_KEY of the release environment');
  const ci: Doc = parseWorkflow(workflows['ci']!);
  assert.equal(ci.jobs.images.secrets, 'inherit');
  for (const id of ['image', 'image-sealed']) {
    const steps: Doc[] = images.jobs[id].steps;
    const remote = stepIndex(steps, (step) => step.id === 'builder');
    const setup = stepIndex(steps, (step) => String(step.uses).startsWith('docker/setup-buildx-action@'));
    const build = stepIndex(steps, (step) => String(step.uses).startsWith('docker/build-push-action@'));
    const cleanup = stepIndex(steps, (step) => step.name === 'remove the remote builder');
    assert.ok(remote >= 0 && remote < setup && setup < build && build < cleanup && cleanup === steps.length - 1, `${id}: remote, fallback, build, cleanup in order`);
    assert.equal(steps[setup].if, "${{ steps.builder.outputs.remote != 'true' }}");
    assert.equal(steps[cleanup].if, "${{ always() && steps.builder.outputs.remote == 'true' }}");
    const step = steps[remote];
    assert.deepEqual(Object.values(step.env).map(String), BUILDER_SECRETS.map((name) => `\${{ secrets.${name} }}`));
    assert.deepEqual(step.env, { BUILDER_KEY: '${{ secrets.STARCI_BUILDER_SSH_KEY }}', BUILDER_HOST: '${{ secrets.STARCI_BUILDER_HOST }}', BUILDER_KNOWN_HOSTS: '${{ secrets.STARCI_BUILDER_KNOWN_HOSTS }}' });
    const run = String(step.run);
    assert.ok(run.includes(RUNNER_FALLBACK));
    assert.ok(run.includes(`docker buildx create --name ${REMOTE_BUILDER.builder} --driver remote --use ssh://${REMOTE_BUILDER.user}@${REMOTE_BUILDER.alias}`));
    assert.match(run, /timeout 60 docker buildx inspect --bootstrap starci-remote/u);
    assert.match(run, /StrictHostKeyChecking yes/u);
    assert.match(run, /set \+e/u, 'a failure falls back instead of failing the job');
    assert.doesNotMatch(run, /\$\{\{/u, 'no expression in the script; the secrets come through env');
    assert.doesNotMatch(run, /echo[^\n]*\$(?:BUILDER_KEY|BUILDER_HOST|host|BUILDER_KNOWN_HOSTS)/u, 'nothing printed names the host or the key');
  }
  const text = workflows['images']!;
  assert.doesNotMatch(text, /continue-on-error|\|\| true/u);
  const root = '/repo';
  const ctx = { repoRoot: root, files: ['.github/workflows/images.yml', '.github/workflows/ci.yml'], repo: { kind: 'app', edition: 'lite' }, isRoot: true, read: (file: string) => workflows[path.basename(file, '.yml')] ?? null };
  assert.deepEqual(workflowContextsFindings(ctx), []);
  assert.deepEqual(supplyChainFindings(ctx).filter((finding) => finding.code === 'HFS_WORKFLOW_PIN'), []);
});

test('actionlint accepts the pipeline with the remote builder when the machine has it', (t) => {
  const probe = spawnSync('actionlint', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (probe.error || probe.status !== 0) return t.skip('actionlint is not installed here');
  const workflows = rendered({ ...STACK, imageBuilder: 'remote' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-remote-builder-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) fs.writeFileSync(path.join(root, '.github', 'workflows', `${name}.yml`), text);
  const out = spawnSync('actionlint', ['-shellcheck=', ...Object.keys(workflows).map((name) => path.join(root, '.github', 'workflows', `${name}.yml`))], { encoding: 'utf8', windowsHide: true });
  assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
});

test('a multi-architecture build stays on the runner even when the remote builder is declared (the builder is the server\'s amd64)', () => {
  const workflows = rendered({ ...STACK, imageBuilder: 'remote', environments: [environment('production', ['linux/amd64', 'linux/arm64'])] });
  assert.doesNotMatch(workflows['images']!, /STARCI_BUILDER|starci-remote/u);
  assert.doesNotMatch(workflows['ci']!, /STARCI_BUILDER/u);
});

test('the declaration projects ci.imageBuilder: remote when declared, runner otherwise', () => {
  assert.equal(declaredStack({ ci: { imageBuilder: 'remote' } }).imageBuilder, 'remote');
  assert.equal(declaredStack({ ci: { imageBuilder: 'elsewhere' } }).imageBuilder, 'runner');
  assert.equal(declaredStack({}).imageBuilder, 'runner');
});

const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });
const failed = (stderr: string): RunResult => ({ status: 1, stdout: '', stderr });

function fakeCtx(answers: (args: readonly string[]) => RunResult): { ctx: StackContext; calls: { args: readonly string[]; timeout: unknown }[] } {
  const calls: { args: readonly string[]; timeout: unknown }[] = [];
  const spawn = (command: string, args: readonly string[], options: { timeout?: unknown } = {}): RunResult => {
    assert.equal(command, 'docker');
    calls.push({ args, timeout: options.timeout });
    return answers(args);
  };
  return { ctx: { spawn, env: {} } as unknown as StackContext, calls }; // reason: ensureRemoteBuilder uses the spawn seam alone
}
const config = { repoRoot: '/repo' } as DeployConfig; // reason: ensureRemoteBuilder reads the repository root alone

test('stack build --builder-host builds through ssh://starci-build@<host>: an alias or host[:port], nothing else', () => {
  assert.equal(remoteBuilderEndpoint('sv-hk-1'), 'ssh://starci-build@sv-hk-1');
  assert.equal(remoteBuilderEndpoint('203.0.113.7:2222'), 'ssh://starci-build@203.0.113.7:2222');
  for (const bad of ['', 'user@host', 'host;id', '-oProxyCommand=x', 'host/path', 'ssh://host']) {
    assert.throws(() => remoteBuilderEndpoint(bad), (error: { code?: string }) => error.code === 'STACK_BUILD_BUILDER_HOST', bad);
  }
});

test('the dev builder is created when missing, re-created when it points elsewhere, kept when it is the same, and bootstrapped under a timeout', () => {
  const endpoint = 'ssh://starci-build@sv-hk-1';
  const missing = fakeCtx((args) => (args[1] === 'inspect' && args.length === 3 ? failed('no builder') : ok()));
  assert.equal(ensureRemoteBuilder(missing.ctx, config, endpoint), 'starci-remote');
  assert.deepEqual(missing.calls.map((call) => call.args.join(' ')), ['buildx inspect starci-remote', `buildx create --name starci-remote --driver remote ${endpoint}`, 'buildx inspect --bootstrap starci-remote']);
  assert.equal(missing.calls.at(-1)?.timeout, REMOTE_BUILDER.bootstrapSeconds * 1000);
  const elsewhere = fakeCtx((args) => (args[1] === 'inspect' && args.length === 3 ? ok('Name: starci-remote\nDriver: remote\nNodes:\nName: starci-remote0\nEndpoint: ssh://starci-build@other\n') : ok()));
  ensureRemoteBuilder(elsewhere.ctx, config, endpoint);
  assert.deepEqual(elsewhere.calls.map((call) => call.args[1]), ['inspect', 'rm', 'create', 'inspect']);
  const same = fakeCtx((args) => (args[1] === 'inspect' && args.length === 3 ? ok(`Name: starci-remote\nEndpoint: ${endpoint}\n`) : ok()));
  ensureRemoteBuilder(same.ctx, config, endpoint);
  assert.deepEqual(same.calls.map((call) => call.args[1]), ['inspect', 'inspect']);
});

test('an unreachable remote builder is a refusal that names the endpoint; nothing is built', () => {
  const endpoint = 'ssh://starci-build@sv-hk-1';
  const unreachable = fakeCtx((args) => (args.includes('--bootstrap') ? failed('ssh: connect to host sv-hk-1 port 22: Connection timed out') : args[1] === 'inspect' ? failed('no builder') : ok()));
  assert.throws(() => ensureRemoteBuilder(unreachable.ctx, config, endpoint), (error: { code?: string; message?: string }) => error.code === 'STACK_BUILD_REMOTE_UNREACHABLE' && String(error.message).includes(endpoint));
  const refusedCreate = fakeCtx((args) => (args[1] === 'create' ? failed('invalid endpoint') : args[1] === 'inspect' ? failed('no builder') : ok()));
  assert.throws(() => ensureRemoteBuilder(refusedCreate.ctx, config, endpoint), (error: { code?: string }) => error.code === 'STACK_BUILD_REMOTE_UNREACHABLE');
  assert.ok(!unreachable.calls.some((call) => call.args[1] === 'build'));
});
