// cache-verify-workflow.spec.mts - the managed cache-verify.yml is sharded like ci.yml: one job per family (the lint family once per side), each
// `app check --env prod --fresh --gate <family>`, and a verdict job. It runs nightly on the default branch and on dispatch on any branch, so a green run for a release
// candidate's sha can clear the verify lock (contexts/project/check-cache.md "The nightly verify"). `app sync` writes what `renderTargets` renders.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { LockResult } from '../scaffold/app.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { addModule } from '../scaffold/add-module.mjs';
import { appSource, bundledPresets, renderTargets } from '../sync/index.mjs';
import { ciWorkflowCommands, verifyShards } from '../sync/ci-commands.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

const GATES = ['hfs', 'secrets', 'format', 'db', 'wiring', 'types', 'test', 'build'];
const listed = (block: string | undefined): string[] => (block ?? '').split(String.fromCharCode(10)).map((line) => JSON.parse(line.replace(/^ +- /u, '')) as string);
const shardsOf = (sides: readonly string[]): string[] => [...GATES.map((gate) => `--gate ${gate}`), ...sides.map((side) => `--gate lint --side ${side}`)];

function newApp(t: TestContext, edition: 'lite' | 'full'): string {
  const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, 'starci-cache-verify-'), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock: lockedOk, initGit: init });
  return root;
}

const renderOf = (root: string): { text: string; ci: string } => {
  const targets = renderTargets(JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8')), bundledPresets(), { source: appSource(root) });
  const body = (file: string): string => targets.find((target) => target.path === file)?.content ?? '';
  return { text: body('.github/workflows/cache-verify.yml'), ci: body('.github/workflows/ci.yml') };
};

type Job = { 'timeout-minutes'?: number; needs?: string[] | string; strategy?: { 'fail-fast'?: boolean; matrix?: { args?: string[] } }; steps?: { name?: string; run?: string; if?: string }[]; if?: string };

test('the shards are the cached families once each and the lint family once per side of the lint matrix', () => {
  assert.deepEqual(listed(verifyShards(['be', 'fe'])), shardsOf(['be', 'fe']));
  assert.deepEqual(listed(verifyShards(['be', 'fe', 'packages'])), shardsOf(['be', 'fe', 'packages']));
  assert.deepEqual(listed(ciWorkflowCommands({ files: [] }, 'be/coverage/lcov.info', undefined, { packages: true, rootPackages: true }).ciVerifyShards), shardsOf(['be', 'fe', 'packages']));
  assert.deepEqual(listed(ciWorkflowCommands({ files: [] }, 'be/coverage/lcov.info').ciVerifyShards), shardsOf(['be', 'fe']));
  assert.ok(!JSON.stringify(shardsOf([])).includes('audit') && !JSON.stringify(shardsOf([])).includes('sonar'), 'the audit and the Sonar scan keep no record');
});

for (const edition of ['lite', 'full'] as const) {
  test(`app sync renders a sharded cache-verify.yml for a ${edition} app: one fresh job per family, a verdict, any-branch dispatch`, (t) => {
    const root = newApp(t, edition);
    const { text, ci } = renderOf(root);
    const doc = parseWorkflow(text) as unknown as { jobs: Record<string, Job> };
    assert.deepEqual(Object.keys(doc.jobs), ['verify', 'verdict']);
    const verify = doc.jobs.verify as Job;
    assert.deepEqual(verify.strategy?.matrix?.args, shardsOf(['be', 'fe']));
    assert.equal(verify.strategy?.['fail-fast'], false, 'one red family never hides the others');
    const steps = verify.steps ?? [];
    const fresh = steps.find((step) => step.name === 'verify the committed cache');
    assert.equal(fresh?.run, 'npx --no-install starci app check --env prod --fresh ${{ matrix.args }}');
    assert.match(steps.find((step) => step.name === 'build the lint inputs')?.if ?? '', /startsWith\(matrix\.args, '--gate lint'\)/u);
    assert.ok(steps.some((step) => (step.run ?? '').includes('git status --porcelain --untracked-files=all -- .starcistacks/cache')), 'the job asserts the cache folder is unchanged');
    const verdict = doc.jobs.verdict as Job;
    assert.equal(verdict.needs?.toString(), 'verify');
    assert.match(String(verdict.if), /always\(\)/u);
    assert.match(text, /^ {2}schedule:\n {4}- cron: "17 2 \* \* \*"\n {2}workflow_dispatch:$/mu);
    assert.doesNotMatch(text, /^ {4}if: .*(default_branch|refs\/heads)/mu, 'no job is skipped off the default branch: a dispatch on dev or a candidate runs the verify');
    assert.match(text, /group: cache-verify-\$\{\{ github\.ref \}\}/u, 'the concurrency is per ref');
    const lintTimeout = /^ {4}timeout-minutes: (\d+)\n {4}runs-on: ubuntu-latest\n {4}strategy:\n {6}fail-fast: false\n {6}matrix:\n {8}side:/mu.exec(ci)?.[1];
    assert.ok(Number(verify['timeout-minutes']) >= Number(lintTimeout) && Number(verify['timeout-minutes']) < 180, 'a shard takes the time of a CI job, far under the 180 minutes of one whole fresh run');
    const written = fs.readFileSync(path.join(root, '.github', 'workflows', 'cache-verify.yml'), 'utf8');
    assert.equal(written, text, 'the scaffold wrote what sync renders');
  });
}

test('an app with root packages verifies the packages side as a shard of its own, after building them', (t) => {
  const root = newApp(t, 'lite');
  fs.mkdirSync(path.join(root, 'packages', 'agent-sdk', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'agent-sdk', 'package.json'), '{"name":"@demo/agent-sdk","version":"0.0.0","private":true}\n');
  fs.writeFileSync(path.join(root, 'packages', 'agent-sdk', 'src', 'index.ts'), 'export {}\n');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { workspaces: string[] };
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ ...manifest, workspaces: [...manifest.workspaces, 'packages/*'] }, null, 2)}\n`);
  addModule({ root, name: 'loyalty' });
  const doc = parseWorkflow(renderOf(root).text) as unknown as { jobs: Record<string, Job> };
  const verify = doc.jobs.verify as Job;
  assert.deepEqual(verify.strategy?.matrix?.args, shardsOf(['be', 'fe', 'packages']));
  const names = (verify.steps ?? []).map((step) => step.name ?? '');
  assert.ok(names.indexOf('build the workspace packages') >= 0 && names.indexOf('build the workspace packages') < names.indexOf('verify the committed cache'));
});
