// Spec: the release gate reuses what `app check` already judged and governs what it still runs. The `app-check` row is `app check --env prod` (whole run,
// governed step by step); the rows it covers (format, typecheck, build, lint, db lint, test + coverage, audit, entity drift) run nothing and take its verdict
// for the same sha, the L4 record says from which run; a red `app-check` stops the gate; Sonar on the main project and the tag stay real; every row that still
// runs a heavy command goes through the governor (`ctx.heavy`), never as a raw child. (contexts/project/check-cache.md "Release with starci app release gate")
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { qualityServices } from '../runtime/scripts/hfs/ci-declaration.mjs';
import { coveredBy, heavyKindOf, normalizeRelease, releaseGate } from '../release/gate.mjs';
import type { Gate } from '../release/gate.mjs';
import type { VerbContext } from '../release/index.mjs';

const HEAD = 'd'.repeat(40);
const SCRIPTS = Object.fromEntries(['format:check', 'typecheck', 'build:be', 'lint', 'db:lint', 'build:fe', 'test', 'test:integration', 'test:e2e', 'test:contract'].map((name) => [name, 'x']));
const COVERED_ROWS = ['audit', 'format-check', 'typecheck', 'build-be', 'lint', 'db-lint', 'build-fe', 'test', 'db-drift'];
const WORLD_ROWS = ['test-integration', 'test-e2e', 'test-contract'];

interface Call { command: string; args: string[]; env?: NodeJS.ProcessEnv | undefined }
interface Heavy { kind: string; label: string; cwd: string; argv: string[]; env: NodeJS.ProcessEnv }
interface Row { name: string; pass: boolean; reused?: boolean; log: string; logSha256: string; seconds: number; command: string; reusedFrom?: { gate: string; head: string; log: string; logSha256: string } }

/** A checkout whose git answers like a clean one at HEAD, with doubles for the spawn and the governor: every command a row runs lands in `plain` or `governed`. */
function world(t: TestContext, options: { appCheck?: { status: number; stdout: string } } = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-release-reuse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'be'));
  fs.mkdirSync(path.join(root, 'fe'));
  const plain: Call[] = [];
  const governed: Heavy[] = [];
  const git: Call[] = [];
  const answer = (argv: string[]) => ({ status: 0, stdout: `ran ${argv.join(' ')}\n` });
  const spawn = (command: string, args: string[], spawnOptions: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) => {
    if (command === 'gh') return { status: 0, stdout: '[]' };
    if (command === 'git') {
      git.push({ command, args });
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { status: 0, stdout: HEAD };
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main' };
      if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { status: 0, stdout: path.join(root, '.git') };
      if (['status', 'tag', 'ls-remote', 'cat-file'].includes(args[0]!)) return { status: 0, stdout: '' };
      throw new Error(`unexpected git ${args.join(' ')}`);
    }
    plain.push({ command, args, env: spawnOptions.env });
    if (command === 'npx' && args.slice(0, 4).join(' ') === 'starci app check --env') return options.appCheck ?? { status: 0, stdout: 'app check: green\n' };
    if (command === 'npx' && args[0] === 'starci' && args.includes('--out')) {
      const file = path.join(spawnOptions.cwd!, args[args.indexOf('--out') + 1]!);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ rules: [], issues: [] }));
      return { status: 0, stdout: 'lint ok' };
    }
    return answer([command, ...args]);
  };
  const heavy = async (request: Heavy) => {
    governed.push(request);
    if (request.argv.includes('@sonar/scan@4.3.0')) {
      fs.mkdirSync(path.join(request.cwd, '.scannerwork'), { recursive: true });
      fs.writeFileSync(path.join(request.cwd, '.scannerwork', 'report-task.txt'), ['projectKey=product', 'serverUrl=https://quality.example.invalid', 'ceTaskId=AX-task', ''].join(String.fromCharCode(10)));
    }
    return answer(request.argv);
  };
  const ctx = (extra: object = {}) => ({ cwd: root, spawn, heavy, now: () => 1000, env: {}, ...extra }) as unknown as VerbContext;
  return { root, plain, governed, git, ctx };
}

const configOf = (block: unknown = undefined, services: object = {}) => {
  const { config, problems } = normalizeRelease(block, SCRIPTS, services, { entities: true });
  assert.ok(config, String(problems));
  return { ...config, version: '1.0.0' };
};

const recordOf = (result: { data?: Record<string, unknown> }): { gates: Row[] } => JSON.parse(fs.readFileSync(result.data!.record as string, 'utf8'));
const argvs = (calls: Call[]) => calls.map((call) => [call.command, ...call.args].join(' '));
const tagged = (git: Call[]) => git.some((call) => call.command === 'git' && call.args[0] === 'tag' && call.args[1] === '-a');
const children = (plain: Call[]) => argvs(plain.filter((call) => call.command !== 'git' && call.command !== 'gh'));

test('a green app-check row is the verdict of every row it covers: they run no child, and the L4 record names the run they stand on', async (t) => {
  const { ctx, plain, governed, git } = world(t);
  const config = configOf();
  assert.deepEqual(config.gates.map((gate) => gate.name), ['app-check', 'audit', 'format-check', 'typecheck', 'build-be', 'lint', 'db-lint', 'build-fe', 'test', ...WORLD_ROWS, 'db-drift']);
  const result = await releaseGate(ctx(), config, { execute: true, platform: 'linux' });
  assert.equal(result.ok, true, result.lines!.join('\n'));
  // the only plain child of the gate is app check itself: no typecheck, build, lint, test, audit or drift child is spawned
  assert.deepEqual(children(plain), ['npx starci app check --env prod']);
  assert.deepEqual(governed.map((call) => call.argv.join(' ')), ['npm run test:integration', 'npm run test:e2e', 'npm run test:contract']);
  const record = recordOf(result);
  const appCheck = record.gates.find((row) => row.name === 'app-check')!;
  assert.equal(appCheck.reused, undefined);
  for (const name of COVERED_ROWS) {
    const row = record.gates.find((item) => item.name === name)!;
    assert.equal(row.pass, true, name);
    assert.equal(row.reused, true, `${name} is reused`);
    assert.equal(row.seconds, 0);
    assert.deepEqual(row.reusedFrom, { gate: 'app-check', head: HEAD, command: appCheck.command, log: appCheck.log, logSha256: appCheck.logSha256 }, `${name} names the app-check run it stands on`);
    assert.equal(row.log, appCheck.log);
  }
  for (const name of WORLD_ROWS) assert.equal(record.gates.find((row) => row.name === name)!.reused, undefined, `${name} is a real row`);
  assert.equal(result.lines!.filter((line) => line.startsWith('REUSED ')).length, COVERED_ROWS.length);
  assert.equal(tagged(git), true, 'the annotated tag is created');
  assert.deepEqual(result.data!.reuses, COVERED_ROWS);
});

test('the printed plan says which rows reuse the app-check verdict and which run, and how', async (t) => {
  const { ctx, plain, governed } = world(t);
  const result = await releaseGate(ctx(), configOf(), { platform: 'linux', readLock: () => ({ state: 'open', line: 'cache verify   none' }) });
  assert.equal(result.ok, true);
  const text = result.lines!.join('\n');
  for (const name of COVERED_ROWS) assert.match(text, new RegExp(`^  ${name.padEnd(17)} .*\\[reuses the app-check verdict, runs no command`, 'mu'), name);
  assert.match(text, /^ {2}app-check\s+npx starci app check --env prod {2}\[runs: app check governs each of its own steps\]/mu);
  for (const name of WORLD_ROWS) assert.match(text, new RegExp(`^  ${name.padEnd(17)} npm run .*\\[runs, governed \\(heavy slot, kind test: heap caps, worker sizing\\)\\]`, 'mu'), name);
  assert.match(text, /db-drift .*runs governed instead when app-check had no database \(CI_PARITY_DB_SKIPPED\)/u);
  assert.deepEqual(result.data!.reuses, COVERED_ROWS);
  assert.deepEqual([children(plain), governed], [[], []], 'a dry run runs nothing');
});

test('--full runs the app-check row as --fresh and the covered rows still reuse it', async (t) => {
  const { ctx, plain, governed } = world(t);
  const result = await releaseGate(ctx(), configOf(), { execute: true, full: true, platform: 'linux' });
  assert.equal(result.ok, true, result.lines!.join('\n'));
  assert.deepEqual(children(plain), ['npx starci app check --env prod --fresh']);
  assert.equal(governed.length, 3);
  assert.match(result.lines!.join('\n'), /full gate \(--full\): the app-check row runs `app check --env prod --fresh`[^\n]*covers reuse that verdict/u);
  assert.equal(recordOf(result).gates.filter((row) => row.reused).length, COVERED_ROWS.length);
});

test('a red app-check row stops the gate: no covered row runs or is reused, no world layer, no record, no tag', async (t) => {
  const { ctx, plain, governed, git } = world(t, { appCheck: { status: 1, stdout: 'app check: 3 findings\n' } });
  const result = await releaseGate(ctx(), configOf(), { execute: true, platform: 'linux' });
  assert.equal(result.ok, false);
  assert.deepEqual(children(plain), ['npx starci app check --env prod']);
  assert.deepEqual(governed, []);
  assert.match(result.lines!.join('\n'), /gate\(s\) red: app-check\. No L4 record, no tag\./u);
  assert.equal(tagged(git), false);
  assert.equal((result.data!.results as Row[]).length, 1);
});

test('app check without a database leaves the drift row to run; every other covered row is still reused', async (t) => {
  const { ctx, plain } = world(t, { appCheck: { status: 0, stdout: 'warning CI_PARITY_DB_SKIPPED: no Docker\n' } });
  const result = await releaseGate(ctx(), configOf(), { execute: true, platform: 'linux' });
  assert.equal(result.ok, true, result.lines!.join('\n'));
  assert.ok(children(plain).includes('npx starci app db drift'), 'drift ran as its own row');
  const rows = recordOf(result).gates;
  assert.equal(rows.find((row) => row.name === 'db-drift')!.reused, undefined);
  assert.deepEqual(rows.filter((row) => row.reused).map((row) => row.name), COVERED_ROWS.filter((name) => name !== 'db-drift'));
});

test('a row an app declares of its own under a covered name still runs, through the governor when it is heavy', async (t) => {
  const { ctx, plain, governed } = world(t);
  const config = configOf({ gates: [
    { name: 'app-check', command: ['npx', 'starci', 'app', 'check', '--env', 'prod'] },
    { name: 'test', command: ['npx', 'jest', '--ci'] },
    { name: 'lint', command: ['npm', 'run', 'lint'] },
    { name: 'smoke', command: ['npm', 'run', 'test:smoke'] },
  ] });
  const result = await releaseGate(ctx(), config, { execute: true, platform: 'linux' });
  const rows = (result.data!.results as Row[]);
  assert.deepEqual(rows.map((row) => [row.name, row.reused === true]), [['app-check', false], ['test', false], ['lint', true], ['smoke', false], ['audit', true], ['db-drift', true]]);
  assert.deepEqual(governed.map((call) => [call.kind, call.argv.join(' ')]), [['test', 'npx jest --ci'], ['test', 'npm run test:smoke']]);
  assert.equal(children(plain).some((line) => line.includes('jest') || line.includes('test:smoke')), false, 'a heavy row is never a raw child');
});

test('a row that runs a heavy command is admitted by the governor with its kind, its label and the whole environment, and a starci verb or an audit is no heavy child', async (t) => {
  const { ctx, plain, governed } = world(t);
  const result = await releaseGate(ctx({ env: { KEEP_PUBLIC: 'kept' } }), configOf(), { execute: true, platform: 'linux' });
  assert.equal(result.ok, true);
  assert.deepEqual(governed.map((call) => [call.kind, call.label, call.argv.join(' ')]), [
    ['test', 'release gate test-integration', 'npm run test:integration'],
    ['test', 'release gate test-e2e', 'npm run test:e2e'],
    ['test', 'release gate test-contract', 'npm run test:contract'],
  ]);
  for (const call of governed) assert.equal(call.env.KEEP_PUBLIC, 'kept', 'the governor gets the environment the row would have run in');
  assert.equal(plain.some((call) => call.command === 'npm'), false);
  const gate = (name: string, command: string[]): Gate => ({ name, command, summary: null, env: {} });
  assert.equal(heavyKindOf(gate('app-check', ['npx', 'starci', 'app', 'check', '--env', 'prod'])), null);
  assert.equal(heavyKindOf(gate('audit', ['npm', 'audit', '--audit-level=high'])), null);
  assert.equal(heavyKindOf(gate('test', ['npm', 'run', 'test'])), 'test');
  assert.equal(heavyKindOf(gate('unit', ['node', 'node_modules/jest/bin/jest.js'])), 'test');
  assert.equal(heavyKindOf(gate('build', ['npm', 'run', 'build'])), 'build');
  assert.equal(heavyKindOf(gate('sonar', ['npx', '--yes', '@sonar/scan@4.3.0'])), 'build');
});

test('without a governor (the package on its own) a heavy row is a plain child', async (t) => {
  const { ctx, plain } = world(t);
  const config = configOf({ gates: [{ name: 'test-e2e', command: ['npm', 'run', 'test:e2e'] }] });
  const result = await releaseGate(ctx({ heavy: undefined }), config, { execute: true, platform: 'linux' });
  assert.equal(result.ok, true, result.lines!.join('\n'));
  assert.ok(children(plain).includes('npm run test:e2e'));
});

test('a covered row is recognised by its default command alone', () => {
  const gate = (name: string, command: string[]): Gate => ({ name, command, summary: null, env: {} });
  assert.deepEqual(coveredBy(gate('test', ['npm', 'run', 'test'])), { family: 'test (the unit specs, the merged coverage and its per-file threshold)', needsDatabase: false });
  assert.equal(coveredBy(gate('test', ['npm', 'run', 'test:ci'])), null);
  assert.equal(coveredBy(gate('test-e2e', ['npm', 'run', 'test:e2e'])), null, 'the world layers are not judged by app check');
  assert.equal(coveredBy(gate('sonar', ['npx', '--yes', '@sonar/scan@4.3.0'])), null, 'Sonar on the main project is not what app check scans');
  assert.equal(coveredBy(gate('audit', ['npm', 'audit', '--omit=dev', '--audit-level=high']))?.family.startsWith('audit'), true);
  assert.equal(coveredBy(gate('db-drift', ['npx', 'starci', 'app', 'db', 'drift']))?.needsDatabase, true);
});

test('the Sonar row on the main project key and the annotated tag still run after the reused rows, the scanner governed', async (t) => {
  const { root, ctx, plain, governed, git } = world(t);
  const secret = 'fixture-private-analysis-value';
  const services = { audit: { mode: 'disabled' }, sonar: { provider: 'sonarqube', mode: 'hosted', optional: false,
    host: { public: 'https://quality.example.invalid' }, auth: 'token',
    projects: [{ repository: 'product', key: 'product:key' }],
    credentials: [{ id: 'analysis', project: 'product:key', key: 'SONAR_TOKEN', custody: { repository: 'product', path: '.starcistacks/dev/secrets/sonar.enc.yaml' } }],
    ci: { token: 'SONAR_APP_TOKEN', secrets: [{ name: 'SONAR_APP_TOKEN', credential: 'analysis' }] } } };
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'product' }));
  fs.mkdirSync(path.join(root, '.starcistacks/dev/secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, '.starcistacks/dev/secrets/sonar.enc.yaml'), 'SONAR_TOKEN: ENC[AES256_GCM,data:AA==,iv:AA==,tag:AA==,type:str]\nsops:\n  version: 3.13.2\n');
  const declaration = { services, environments: { dev: {} } };
  const normalized = normalizeRelease({ gates: [
    { name: 'app-check', command: ['npx', 'starci', 'app', 'check', '--env', 'prod'] },
    { name: 'typecheck', command: ['npm', 'run', 'typecheck'] },
    { name: 'test', command: ['npm', 'run', 'test'], summary: 'jest' },
  ] }, {}, services, { repository: 'product' });
  assert.ok(normalized.config);
  const fetch = async (url: string) => ({ ok: true, json: async () => {
    if (url.includes('/api/system/status')) return { status: 'UP' };
    if (url.includes('/api/ce/task')) return { task: { status: 'SUCCESS', analysisId: 'AN-1' } };
    if (url.includes('/api/qualitygates/project_status')) return { projectStatus: { status: 'OK', conditions: [] } };
    throw new Error(`unexpected Sonar request ${url}`);
  } });
  const result = await releaseGate(ctx({ fetch, sops: { decrypt: () => ({ SONAR_TOKEN: secret }) } }),
    { ...normalized.config!, services: { ...qualityServices(declaration, { repository: 'product' }), declaration }, version: '1.0.0' }, { execute: true, platform: 'linux' });
  assert.equal(result.ok, true, result.lines!.join('\n'));
  const rows = recordOf(result).gates;
  assert.deepEqual(rows.map((row) => [row.name, row.reused === true]), [['app-check', false], ['typecheck', true], ['test', true], ['sonar', false]]);
  assert.equal(governed.length, 1);
  assert.equal(governed[0]!.kind, 'build');
  assert.ok(governed[0]!.argv.includes('-Dsonar.projectKey=product:key'), 'the main project key, not the derived -local one');
  assert.equal(governed[0]!.env.SONAR_TOKEN, secret);
  assert.equal(plain.some((call) => call.args.includes('@sonar/scan@4.3.0')), false, 'the scanner is no raw child');
  assert.equal(tagged(git), true);
});
