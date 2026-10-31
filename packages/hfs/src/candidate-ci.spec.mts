// The candidate CI of `starci app release push`: the exact sha goes to its candidate ref, and only a green ci.yml run of that sha (a red
// candidate never passes) lets the default branch and the tag move. Every subprocess and the clock are fakes.
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { VerbContext } from '../release/index.mjs';
import type { RenderedTarget } from '../sync/index.mjs';
import { renderTargets } from '../sync/index.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { gitTriggerFindings } from '../runtime/scripts/hfs/runtime-rules/git-triggers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { candidateRef, candidateStep, candidateVerdict, waitForCandidate } from '../release/candidate-ci.mjs';

const HEAD = 'a'.repeat(40);
const WAIT = Object.freeze({ pollSeconds: 30, graceMinutes: 10, waitMinutes: 90 });
type CiRow = NonNullable<Parameters<typeof candidateVerdict>[0]>[number];
// reason: GitHub answers conclusion null for a run still in progress; the source row type omits null, so the fixture row is cast to it.
const row = (overrides: Record<string, unknown> = {}): CiRow => ({ databaseId: 7, headSha: HEAD, status: 'completed', conclusion: 'success', url: 'https://example.invalid/runs/7', event: 'push', createdAt: '2026-10-18T00:00:00Z', ...overrides }) as CiRow;

/** A fake ctx: `reads` is the list of gh run list replies in order (the last one repeats); the clock advances by each sleep. */
function fakeCtx({ reads = [[row()]], jobs = { jobs: [] }, push = { status: 0 }, common = null }: {
  reads?: (CiRow[] | null)[]; jobs?: { jobs: unknown[] }; push?: { status: number; stderr?: string }; common?: string | null;
} = {}) {
  const calls: string[][] = [];
  let clock = 0;
  let index = 0;
  const spawn = (command: string, args: readonly string[]) => {
    calls.push([command, ...args]);
    if (command === 'git' && args[0] === 'push') return push;
    if (command === 'git' && args[0] === 'rev-parse') return common ? { status: 0, stdout: common } : { status: 128, stdout: '' };
    if (command === 'gh' && args[1] === 'list') {
      const reply = reads[Math.min(index, reads.length - 1)] as CiRow[] | null;
      index += 1;
      return reply === null ? { status: 1, stdout: '', stderr: 'gh: not logged in' } : { status: 0, stdout: JSON.stringify(reply) };
    }
    if (command === 'gh' && args[1] === 'view') return { status: 0, stdout: JSON.stringify(jobs) };
    throw new Error(`unexpected ${command} ${args.join(' ')}`);
  };
  // reason: the context is the four seams the candidate step reads (cwd, spawn, clock, sleep), not a full stack context.
  const ctx = { cwd: '/app', spawn, now: () => clock, sleep: async (ms: number) => { clock += ms; } } as unknown as VerbContext;
  return { calls, ctx };
}

test('the candidate ref names the version without the tag prefix', () => {
  assert.equal(candidateRef('v0.2.3', 'v'), 'refs/heads/release/candidate-0.2.3');
  assert.equal(candidateRef('rel1.0.0', 'rel'), 'refs/heads/release/candidate-1.0.0');
});

test('the newest non-cancelled run of the sha decides; no run is pending', () => {
  assert.equal(candidateVerdict([]).state, 'pending');
  assert.equal(candidateVerdict([row({ conclusion: 'cancelled' })]).state, 'pending');
  assert.equal(candidateVerdict([row({ status: 'in_progress', conclusion: null })]).state, 'running');
  assert.equal(candidateVerdict([row({ conclusion: 'failure' })]).state, 'red');
  const newer = row({ databaseId: 8, createdAt: '2026-10-18T01:00:00Z' });
  assert.equal(candidateVerdict([row({ conclusion: 'failure' }), newer]).run?.databaseId, 8);
});

test('a skipped run or a skipped job is red, never a pass', async () => {
  assert.equal(candidateVerdict([row({ conclusion: 'skipped' })]).state, 'red');
  const jobs = { jobs: [{ name: 'test', conclusion: 'skipped', steps: [] }, { name: 'lint', conclusion: 'success', steps: [] }] };
  const judged = await candidateStep(fakeCtx({ reads: [[row()]], jobs }).ctx, { head: HEAD, tag: 'v1.2.3', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, false);
  assert.deepEqual(judged.data.failing, ['test (skipped)']);
  assert.match(judged.lines.at(-1) as string, /^candidate CI red: .*failing: test \(skipped\)/);
});

test('a green run whose jobs cannot be read is not green: the wait ends unknown', async () => {
  const { ctx } = fakeCtx({ reads: [[row()]] });
  const spawn = ctx.spawn;
  Object.assign(ctx, { spawn: (command: string, args: readonly string[]) => (command === 'gh' && args[1] === 'view' ? { status: 1, stdout: '' } : spawn(command, args)) });
  const judged = await candidateStep(ctx, { head: HEAD, tag: 'v1.2.3', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, false);
  assert.match(judged.lines.at(-1) as string, /^candidate CI unknown/);
});

test('a green candidate pushes HEAD to the candidate ref first and reports the run', async () => {
  const { ctx, calls } = fakeCtx({ reads: [[], [row({ status: 'in_progress', conclusion: null })], [row()]] });
  const judged = await candidateStep(ctx, { head: HEAD, tag: 'v1.2.3', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, true);
  assert.equal(judged.data.state, 'green');
  assert.deepEqual(calls[0], ['git', 'push', 'origin', `+${HEAD}:refs/heads/release/candidate-1.2.3`]);
  assert.ok(calls.some((call) => call.join(' ') === `gh run list --workflow ci.yml --commit ${HEAD} --limit 20 --json databaseId,headSha,status,conclusion,url,event,createdAt`));
  assert.match(judged.lines.at(-1) as string, /candidate CI {3}green https:\/\/example\.invalid\/runs\/7/);
});

test('a red candidate refuses and names the failing jobs and steps; nothing else is pushed', async () => {
  const jobs = { jobs: [{ name: 'test', conclusion: 'failure', steps: [{ name: 'unit', conclusion: 'failure' }, { name: 'checkout', conclusion: 'success' }] }, { name: 'fast', conclusion: 'success', steps: [] }] };
  const { ctx, calls } = fakeCtx({ reads: [[row({ conclusion: 'failure' })]], jobs });
  const judged = await candidateStep(ctx, { head: HEAD, tag: 'v1.2.3', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, false);
  assert.deepEqual(judged.data.failing, ['test (failure): unit']);
  assert.match(judged.lines.at(-1) as string, /^candidate CI red: .*failing: test \(failure\): unit\. Nothing reached the default branch/);
  assert.equal(calls.filter((call) => call[0] === 'git' && call[1] === 'push').length, 1, 'only the candidate push ran');
});

test('a red candidate has no override: an old override record on disk changes nothing', async (t: TestContext) => {
  const common = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-candidate-'));
  t.after(() => fs.rmSync(common, { recursive: true, force: true }));
  fs.mkdirSync(path.join(common, 'starci-release'));
  const record = { schema: 'starci/ci-override@1', sha: HEAD, reason: 'flaky runner accepted', by: 'owner', at: '2026-10-18T00:00:00Z', runUrl: '' };
  fs.writeFileSync(path.join(common, 'starci-release', `${HEAD}.ci-override.json`), JSON.stringify(record));
  const { ctx } = fakeCtx({ reads: [[row({ conclusion: 'failure' })]], common });
  const judged = await candidateStep(ctx, { head: HEAD, tag: 'v1.2.3', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, false);
  assert.equal(judged.data.override, undefined);
  assert.match(judged.lines.at(-1) as string, /^candidate CI red: /);
});

test('no run within the grace refuses as a missing candidate trigger; an endless run times out; unreadable GitHub is unknown', async () => {
  const unstarted = await candidateStep(fakeCtx({ reads: [[]] }).ctx, { head: HEAD, tag: 'v1.0.0', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(unstarted.ok, false);
  assert.match(unstarted.lines.at(-1) as string, /^candidate CI timeout: no ci\.yml run started .* release\/candidate-\*/);
  const endless = await waitForCandidate(fakeCtx({ reads: [[row({ status: 'in_progress', conclusion: null })]] }).ctx, HEAD, WAIT);
  assert.equal(endless.state, 'timeout');
  const blind = await candidateStep(fakeCtx({ reads: [null] }).ctx, { head: HEAD, tag: 'v1.0.0', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(blind.ok, false);
  assert.match(blind.lines.at(-1) as string, /^candidate CI unknown/);
});

test('a refused candidate push stops before any wait', async () => {
  const { ctx, calls } = fakeCtx({ push: { status: 1, stderr: 'RIGHTS_PUSH_NOT_RELEASE: refused\n' } });
  const judged = await candidateStep(ctx, { head: HEAD, tag: 'v1.0.0', prefix: 'v', remote: 'origin', wait: WAIT });
  assert.equal(judged.ok, false);
  assert.equal(judged.data.state, 'push-failed');
  assert.equal(calls.filter((call) => call[0] === 'gh').length, 0);
});


for (const edition of ['lite', 'full']) {
  test(`${edition}: generated CI judges pull requests, main, candidates and tags; images and the deploy are reusable workflows and nothing else starts a run`, () => {
    const targets = renderTargets({ ...structuredClone(APP), edition }, PRESETS);
    const workflows = targets.filter(target => target.path.startsWith('.github/workflows/'));
    const ci = workflows.find(target => target.path === '.github/workflows/ci.yml') as RenderedTarget;
    const doc = parseWorkflow(ci.content);
    assert.deepEqual(doc.on.push, { branches: ['main', 'release/candidate-*'], tags: ['v*'] });
    assert.deepEqual(doc.on.pull_request, { branches: ['main'] });
    for (const target of workflows) {
      const on = parseWorkflow(target.content).on;
      if (/stack-deploy/.test(target.path)) assert.deepEqual(Object.keys(on).sort(), ['workflow_call', 'workflow_dispatch']);
      if (/images/.test(target.path)) assert.deepEqual(Object.keys(on), ['workflow_call']);
      if (/stack-key-restore/.test(target.path)) assert.deepEqual(Object.keys(on), ['workflow_dispatch']);
    }
    const files = workflows.map(target => `packages/hfs/templates/app/ci-workflows/${target.path.slice(1)}`);
    assert.deepEqual(gitTriggerFindings({ files, read: (file: string) => (workflows[files.indexOf(file)] as RenderedTarget).content }), []);
    const file = files.find(file => file.endsWith('/ci.yml')) as string;
    const bad = structuredClone(doc);
    bad.on.push.branches = ['feature'];
    assert.ok(gitTriggerFindings({ files: [file], read: () => JSON.stringify(bad) }).length > 0);
    const noBranches = structuredClone(doc);
    delete noBranches.on.push.branches;
    assert.ok(gitTriggerFindings({ files: [file], read: () => JSON.stringify(noBranches) }).length > 0);
  });

  test(`${edition}: a pull request is judged in ci.yml only, to main only, and pull_request_target, workflow_run and schedules never start a run`, () => {
    const targets = renderTargets({ ...structuredClone(APP), edition }, PRESETS);
    const ci = parseWorkflow((targets.find(target => target.path === '.github/workflows/ci.yml') as RenderedTarget).content);
    const findings = (file: string, mutate: (on: Record<string, unknown>) => void) => {
      const doc = structuredClone(ci);
      mutate(doc.on);
      return gitTriggerFindings({ files: [file], read: () => JSON.stringify(doc) }).map(finding => finding.message);
    };
    const CI = 'packages/hfs/templates/app/ci-workflows/.github/workflows/ci.yml';
    assert.deepEqual(findings(CI, () => {}), []);
    assert.match(findings(CI, (on) => { on.pull_request = { branches: ['feature'] }; }).join('\n'), /pull_request\.branches/u);
    assert.match(findings(CI, (on) => { on.pull_request = { branches: ['main'], paths: ['be/**'] }; }).join('\n'), /pull_request\.paths/u);
    assert.match(findings(CI, (on) => { on.pull_request = null; }).join('\n'), /pull_request\.branches/u);
    for (const event of ['pull_request_target', 'workflow_run', 'schedule', 'issue_comment']) {
      assert.ok(findings(CI, (on) => { on[event] = {}; }).join('\n').includes(`the trigger \`${event}\` is not allowed`), event);
    }
    assert.match(findings('.github/workflows/images.yml', (on) => { on.pull_request = { branches: ['main'] }; }).join('\n'), /may start only ci\.yml/u, 'no other workflow runs the code of a pull request');
  });
}
