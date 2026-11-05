// R383 (decision ci-parity): the pre-push gate runs the commands of the app's managed CI that no other family runs. The build and audit families read
// them from the rendered workflow (never restated), leave CI's own expressions and NODE_OPTIONS to CI, give a build its own SWC cache root, and a step
// that fails locally is CI_PARITY_STEP_FAILED with its last lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCacheEnv, familyOfStep, parityStepsOf, runParityFamilies, shellArgv, type ParityRun } from '../cache/parity-family.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const WORKFLOW = `name: ci
jobs:
  fast:
    steps:
      - uses: actions/checkout@v4
      - name: production dependency audit
        run: npm audit --omit=dev --audit-level=high
      - name: format
        run: npx --no-install starci app check --gate format
      - name: typecheck
        run: npm run typecheck
        env:
          NODE_OPTIONS: --max-old-space-size=6144
  coverage:
    steps:
      - name: merge
        run: npx --no-install starci app coverage merge --out be/coverage/lcov.info be/coverage/shards
  build:
    steps:
      - name: build be
        run: npm run build:be
      - name: build fe web
        run: npm run build:modules --silent && npm run codegen --silent && npx --no-install turbo run build --filter=./fe/apps/web
        env:
          NEXT_PUBLIC_API_URL: https://api.example.invalid
          NEXT_PUBLIC_TOKEN: \${{ secrets.TOKEN }}
      - name: build fe landing
        run: echo \${{ github.sha }}
`;

test('the parity steps are the workflow\'s audit, typecheck and build steps, with CI\'s expressions and NODE_OPTIONS left to CI', () => {
  const steps = parityStepsOf(WORKFLOW);
  assert.deepEqual(steps.map((step) => [step.family, step.job, step.name]), [
    ['audit', 'fast', 'production dependency audit'],
    ['build', 'fast', 'typecheck'],
    ['build', 'build', 'build be'],
    ['build', 'build', 'build fe web'],
  ], 'format and the coverage merge belong to other families; a step reading an expression is CI\'s alone');
  assert.deepEqual(steps[1]?.env, {}, 'the memory plan sizes the heap locally');
  assert.deepEqual(steps[3]?.env, { NEXT_PUBLIC_API_URL: 'https://api.example.invalid' }, 'a secret CI injects is not invented locally');
  assert.equal(familyOfStep('lint', 'typecheck'), null);
  assert.deepEqual(parityStepsOf('not: [yaml'), []);
});

test('a build owns its SWC cache root, and the steps run through the shell CI uses', (t) => {
  const app = mkdtemp(t, 'starci-parity-');
  const env = buildCacheEnv(app, { STARCI_CACHE_HOME: path.join(app, 'home') });
  assert.equal(env.LOCALAPPDATA, env.XDG_CACHE_HOME);
  assert.ok(env.LOCALAPPDATA?.startsWith(path.join(app, 'home')) && fs.existsSync(env.LOCALAPPDATA), 'under the app\'s tool cache, never the user\'s %LOCALAPPDATA%');
  assert.deepEqual(shellArgv('a && b', 'linux'), ['/bin/sh', '-c', 'a && b']);
  assert.deepEqual(shellArgv('a && b', 'win32', { ComSpec: 'C:/Windows/system32/cmd.exe' }), ['C:/Windows/system32/cmd.exe', '/d', '/s', '/c', 'a && b']);
});

test('a step that fails locally is CI_PARITY_STEP_FAILED naming the job, the step and its last lines; the families report every step', async (t) => {
  const app = mkdtemp(t, 'starci-parity-run-');
  const calls: { kind: string; argv: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
  const run: ParityRun = async (request) => {
    calls.push({ kind: request.kind, argv: request.argv, env: request.env });
    const failing = request.argv.at(-1)?.includes('turbo') === true;
    return { status: failing ? 1 : 0, stdout: failing ? 'Error occurred prerendering page "/"\nExport encountered errors' : '', stderr: '' };
  };
  const session = createFakeSession({ root: app });
  const { findings, reports } = await runParityFamilies(session, { repoRoot: app, families: new Set(['build', 'audit']), env: { STARCI_CACHE_HOME: path.join(app, 'home') }, run, steps: parityStepsOf(WORKFLOW) });
  assert.deepEqual(calls.map((call) => call.kind), ['install', 'build', 'build', 'build'], 'the audit first, then the builds under the build kind');
  assert.ok(calls.slice(1).every((call) => String(call.env.LOCALAPPDATA ?? '').includes('build-cache')), 'every build has its own SWC cache root');
  assert.equal(calls[0]?.env.LOCALAPPDATA, undefined, 'the audit does not');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, 'CI_PARITY_STEP_FAILED');
  assert.match(String(findings[0]?.message), /build \/ build fe web .*exit 1.*prerendering page/u);
  assert.deepEqual(reports.map((report) => [report.family, report.checked, report.newFindings]), [['audit', 1, 0], ['build', 3, 1]]);
});
