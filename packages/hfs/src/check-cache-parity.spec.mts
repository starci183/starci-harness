// R383: the pre-push gate runs the commands of the app's managed CI that no other family runs. The build and audit families read
// them from the rendered workflow (never restated), leave CI's own expressions and NODE_OPTIONS to CI, give a build its own SWC cache root, and a step
// that fails locally is CI_PARITY_STEP_FAILED with its last lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildCacheEnv, familyOfStep, parityStepsOf, runParityFamilies, shellArgv, swcBindingCacheFor, type ParityRun } from '../cache/parity-family.mjs';
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
      - name: database migration checks
        run: npm run db:lint && npx starci app db drift
        env:
          NODE_OPTIONS: --max-old-space-size=6144
`;

test('the parity steps are the workflow\'s audit, typecheck and build steps, with CI\'s expressions and NODE_OPTIONS left to CI', () => {
  const steps = parityStepsOf(WORKFLOW);
  assert.deepEqual(steps.map((step) => [step.family, step.job, step.name]), [
    ['audit', 'fast', 'production dependency audit'],
    ['build', 'fast', 'typecheck'],
    ['build', 'build', 'build be'],
    ['build', 'build', 'build fe web'],
    ['build', 'build', 'database migration checks'],
  ], 'the migrations applied to a scratch database and checked against the entity manifest are the build job\'s last step; format and the coverage merge belong to other families; a step reading an expression is CI\'s alone');
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

test('on Windows a build gets a short SWC native binding cache under the user profile, per app, and keeps one the caller set', (t) => {
  const app = mkdtemp(t, 'starci-parity-swc-');
  const other = mkdtemp(t, 'starci-parity-swc-other-');
  const profile = mkdtemp(t, 'starci-parity-profile-');
  const env = { STARCI_CACHE_HOME: path.join(app, 'home'), USERPROFILE: profile };
  const mine = buildCacheEnv(app, env, 'win32');
  const binding = mine.SWC_NATIVE_BINDING_CACHE;
  assert.ok(binding !== undefined && binding.startsWith(path.join(profile, 'sw')) && fs.existsSync(binding), 'under the user profile');
  // The addon's lock adds `\swc\swc-native-<SID>\v1\<128 hex>.lock` (about 190 characters): the folder adds only `sw\<8 hex>` to the profile, so the lock fits a normal profile under MAX_PATH.
  assert.ok(path.relative(profile, binding ?? '').length <= 11, 'short: sw plus eight hex under the profile');
  assert.equal(buildCacheEnv(app, env, 'win32').SWC_NATIVE_BINDING_CACHE, binding, 'deterministic per app');
  assert.notEqual(buildCacheEnv(other, env, 'win32').SWC_NATIVE_BINDING_CACHE, binding, 'one folder per app');
  assert.equal(swcBindingCacheFor(app, env), binding);
  assert.equal(buildCacheEnv(app, { ...env, SWC_NATIVE_BINDING_CACHE: 'D:/mine' }, 'win32').SWC_NATIVE_BINDING_CACHE, undefined, 'a caller value is not overridden (the spread keeps it)');
  assert.equal(buildCacheEnv(app, env, 'linux').SWC_NATIVE_BINDING_CACHE, undefined, 'only Windows needs it');
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
  assert.deepEqual(calls.map((call) => call.kind), ['install', 'build', 'build', 'build', 'build'], 'the audit first, then the builds under the build kind');
  assert.ok(calls.slice(1).every((call) => String(call.env.LOCALAPPDATA ?? '').includes('build-cache')), 'every build has its own SWC cache root');
  assert.equal(calls[0]?.env.LOCALAPPDATA, undefined, 'the audit does not');
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.code, 'CI_PARITY_STEP_FAILED');
  assert.match(String(findings[0]?.message), /build \/ build fe web .*exit 1.*prerendering page/u);
  assert.deepEqual(reports.map((report) => [report.family, report.checked, report.newFindings]), [['audit', 1, 0], ['build', 4, 1]]);
});

test('the database migration step runs as CI runs it: a drift is a failure, a host with no database is a warning (CI judges), never a green verdict', async (t) => {
  const app = mkdtemp(t, 'starci-parity-db-');
  const steps = parityStepsOf(WORKFLOW).filter((step) => step.name === 'database migration checks');
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.run, 'npm run db:lint && npx starci app db drift');
  const env = { STARCI_CACHE_HOME: path.join(app, 'home') };
  const outcome = async (status: number, stdout: string) => {
    const run: ParityRun = async () => ({ status, stdout, stderr: '' });
    return runParityFamilies(createFakeSession({ root: app }), { repoRoot: app, families: new Set(['build']), env, run, steps });
  };
  const drift = await outcome(1, 'BE_ENTITY_SCHEMA_DRIFT: entity manifest lacks CHECK constraint chk_x');
  assert.deepEqual(drift.findings.map((finding) => [finding.code, finding.level]), [['CI_PARITY_STEP_FAILED', 'error']]);
  assert.match(String(drift.findings[0]?.message), /BE_ENTITY_SCHEMA_DRIFT/u);
  const noDatabase = await outcome(2, 'DB_DRIFT_NEEDS_DATABASE: needs Docker or --db-url-env');
  assert.deepEqual(noDatabase.findings.map((finding) => [finding.code, finding.level]), [['CI_PARITY_DB_SKIPPED', 'warning']]);
  assert.match(String(noDatabase.findings[0]?.message), /needs Docker/u);
  assert.equal((await outcome(2, 'some other refusal')).findings[0]?.code, 'CI_PARITY_STEP_FAILED', 'only the no-database refusal is skipped');
  assert.deepEqual((await outcome(0, '')).findings, []);
});
