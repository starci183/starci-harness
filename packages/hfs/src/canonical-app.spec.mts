// The canonical spellings of the app verbs, proven through `main`: scaffold --cwd, add service|spec|image, check --staged, sync (dry by
// default, --execute writes), slot, world, upgrade (dry by default, --execute applies), lint --json --out, codemod --execute --out --json,
// the managed hook and scripts that call them, and that an old spelling is an unknown verb or flag (exit 2, nothing written).
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from './main.mjs';
import { bundledPresets } from '../sync/index.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };
const lockedOk = (root: string) => { fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n'); return { ok: true as const }; };
const temp = (t: TestContext, prefix: string) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
/** Runs `main` and returns { code, out, err }. */
async function run(argv: string[], options: NonNullable<Parameters<typeof main>[1]> = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, { harness: HARNESS, lock: lockedOk, stdout: (text) => { out += text; }, stderr: (text) => { err += text; }, ...options });
  return { code, out, err };
}
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
};
const files = (dir: string) => fs.readdirSync(dir, { recursive: true }).map((file) => String(file).split(path.sep).join('/')).sort();

/** A scaffolded lite app whose @starci/jest-preset resolves offline to the copy this package ships, so sync renders without an install. */
async function scaffolded(t: TestContext, name = 'shop') {
  const base = temp(t, 'hfs-canonical-app-');
  const created = await run(['scaffold', name, '--cwd', base]);
  assert.equal(created.code, 0, created.err);
  const root = path.join(base, name);
  const preset = path.join(root, 'node_modules', '@starci', 'jest-preset');
  fs.mkdirSync(preset, { recursive: true });
  fs.writeFileSync(path.join(preset, 'package.json'), JSON.stringify({ name: '@starci/jest-preset', version: '0.0.0', main: 'index.cjs' }));
  fs.writeFileSync(path.join(preset, 'index.cjs'), `module.exports = { sonarExclusions: () => ${JSON.stringify(bundledPresets().sonarExclusions)} };\n`);
  return root;
}

test('scaffold creates <--cwd>/<name>', async (t) => {
  const base = temp(t, 'hfs-canonical-cwd-');
  const created = await run(['scaffold', 'shop', '--cwd', 'target'], { cwd: base });
  assert.equal(created.code, 0, created.err);
  assert.equal(created.err, '');
  assert.equal(fs.existsSync(path.join(base, 'target', 'shop', 'hfs.json')), true);
  assert.match(created.out, /next: npm ci/);
  const inline = await run(['scaffold', 'other', '--cwd=target'], { cwd: base });
  assert.equal(inline.code, 0, inline.err);
  assert.equal(fs.existsSync(path.join(base, 'target', 'other', 'hfs.json')), true);
  assert.deepEqual(files(path.join(base, 'target')).filter((file) => !file.includes('/')), ['other', 'shop']);
});

test('add image, add service and add spec run the generators and refuse what a noun does not take', async (t) => {
  const root = await scaffolded(t);
  const dockerfile = files(root).find((file) => file.endsWith('Dockerfile') && !file.includes('node_modules') && !file.startsWith('.'));
  assert.ok(dockerfile, 'the scaffold holds a Dockerfile');
  fs.rmSync(path.join(root, dockerfile));
  const first = await run(['add', 'image'], { cwd: root });
  assert.equal(first.code, 0, first.err);
  assert.equal(first.out, `created ${dockerfile}\n`);
  const second = await run(['add', 'image'], { cwd: root });
  assert.deepEqual([second.code, second.out, second.err], [0, '', ''], 'never overwrites: nothing left to write');
  const outside = await run(['add', 'service', 'fe/x', 'cart'], { cwd: root });
  assert.equal(outside.code, 2);
  assert.match(outside.err, /HFS_NEW_BACKEND_ONLY: starci app add service \| spec writes back-end services under be\//);
  const missing = await run(['add', 'spec', 'be/missing.service.ts'], { cwd: root });
  assert.equal(missing.code, 2);
  assert.doesNotMatch(missing.err, /unknown flag|usage/i);
  for (const [argv, message] of [
    [['add', 'job', 'x', '--inject', 'A=b'], 'starci app add job takes no --inject; only add service does'],
    [['add', 'image', '--inject', 'A=b'], 'starci app add image takes no --inject; only add service does'],
    [['add', 'spec', 'be/x.service.ts', '--event', 'e'], 'starci app add spec takes no --event'],
    [['add', 'service', 'be/x', 'y', '--shapes', 'a'], 'starci app add service takes no --shapes'],
    [['add', 'image', 'extra'], 'starci app add takes `service <dir> <name> [--inject ...]`, `spec <file>.service.ts` or `image`'],
  ] as [string[], string][]) {
    const result = await run(argv, { cwd: root });
    assert.equal(result.code, 2, argv.join(' '));
    assert.ok(result.err.startsWith(`starci app: ${message}\n`), `${argv.join(' ')}: ${result.err.split('\n')[0]}`);
  }
});

test('check --staged is the pre-commit guard alone', async (t) => {
  const root = temp(t, 'hfs-canonical-staged-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'hfs.json'), '{}\n');
  const clean = await run(['check', '--staged'], { cwd: root });
  assert.deepEqual([clean.code, clean.err], [0, '']);
  assert.match(clean.out, /^starci app check --staged: 0 staged file\(s\) checked, 0 finding\(s\), 0 ledger finding\(s\)\n$/);
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=abc\n');
  git(root, 'add', '-f', '.env');
  const blocked = await run(['check', '--staged'], { cwd: root });
  assert.equal(blocked.code, 1);
  assert.match(blocked.out, /\.env/);
  for (const flag of [['--json'], ['--fast'], ['--wiring'], ['--base', 'main'], ['--coverage-from', 'x.lcov'], ['--edition', 'lite']]) {
    const refused = await run(['check', '--staged', ...flag], { cwd: root });
    assert.equal(refused.code, 2, flag.join(' '));
    assert.match(refused.err, /^starci app: starci app check --staged is the pre-commit guard alone and takes no /, flag.join(' '));
  }
});

test('sync is a dry run that exits 1 on drift, and --execute writes', async (t) => {
  const root = await scaffolded(t);
  const properties = path.join(root, 'sonar-project.properties');
  const clean = await run(['sync'], { cwd: root });
  assert.equal(clean.code, 0, clean.out + clean.err);
  assert.match(clean.out, /starci app sync: (\d+) of \1 in sync\n$/);
  const original = fs.readFileSync(properties, 'utf8');
  const drifted = original.replace(/^sonar\.cpd\.exclusions=.*$/m, 'sonar.cpd.exclusions=hand/**');
  fs.writeFileSync(properties, drifted);
  const dry = await run(['sync'], { cwd: root });
  assert.equal(dry.code, 1);
  assert.match(dry.out, /HFS_SYNC_DRIFT sonar-project\.properties/);
  assert.match(dry.out, /run "npx --no-install starci app sync --execute"/);
  assert.equal(fs.readFileSync(properties, 'utf8'), drifted, 'the dry run writes nothing');
  const executed = await run(['sync', '--execute'], { cwd: root });
  assert.equal(executed.code, 0, executed.out);
  assert.match(executed.out, /wrote sonar-project\.properties\n/);
  assert.equal(fs.readFileSync(properties, 'utf8'), original, 'the sonar block is the render again');
  assert.equal((await run(['sync'], { cwd: root })).code, 0);
});

test('slot names the slot that owns a path', async (t) => {
  const root = await scaffolded(t);
  const slot = await run(['slot', 'hfs.json', '--json'], { cwd: root });
  assert.deepEqual([slot.code, slot.err], [0, '']);
  assert.equal(JSON.parse(slot.out).path, 'hfs.json');
  assert.equal((await run(['slot'], { cwd: root })).code, 2);
});

test('world dispatches up, down and status to the installed test-world cli, and refuses a lite app', async (t) => {
  const base = temp(t, 'hfs-canonical-world-');
  fs.mkdirSync(path.join(base, 'app'));
  const calls: { argv: string[]; cwd: string }[] = [];
  const stackMain = async (argv: string[], io: { cwd: string }) => { calls.push({ argv, cwd: io.cwd }); return 0; };
  for (const action of ['up', 'down', 'status']) {
    const result = await run(['world', action, '--k3d', '--cwd', 'app'], { cwd: base, stackMain });
    assert.deepEqual([result.code, result.err], [0, ''], action);
  }
  assert.deepEqual(calls.map((call) => call.argv), [['up', '--k3d'], ['down', '--k3d'], ['status', '--k3d']]);
  assert.ok(calls.every((call) => call.cwd === path.join(base, 'app')));
  assert.match((await run(['world', 'logs'], { cwd: base, stackMain })).err, /starci app: starci app world takes up, down, status/);
  fs.writeFileSync(path.join(base, 'app', 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'lite', edition: 'lite' }));
  const lite = await run(['world', 'up', '--cwd', 'app'], { cwd: base, stackMain });
  assert.equal(lite.code, 2);
  assert.match(lite.err, /manage the local test world of the full edition/);
  assert.equal(calls.length, 3);
  const none = await run(['world', 'status'], { cwd: temp(t, 'hfs-canonical-world-none-') });
  assert.equal(none.code, 2);
  assert.match(none.err, /needs @starci\/test-world installed in the app/);
});

test('upgrade is dry by default and --execute applies', async (t) => {
  const root = temp(t, 'hfs-canonical-upgrade-');
  const declaration = { hfs: 3, kind: 'app', project: 'shop', sides: { be: { apps: [{ name: 'core', kind: 'api' }, { name: 'cli', kind: 'cli' }], kinds: ['api', 'cli'], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'database' }] }, fe: { apps: [{ name: 'landing', kind: 'next' }], reads: ['be/contracts/'] } } };
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const tools = ['@nestjs/testing', '@starci/jest-preset', '@starci/test-world', '@types/jest', 'jest', 'ts-jest'];
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shop', devDependencies: Object.fromEntries(tools.map((name) => [name, '1.0.0'])) }));
  const dry = await run(['upgrade'], { cwd: root });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /starci app upgrade: 8 steps planned; no file written\n$/);
  assert.equal(fs.existsSync(path.join(root, 'be')), false);
  const applied = await run(['upgrade', '--execute'], { cwd: root });
  assert.equal(applied.code, 0, applied.err);
  assert.match(applied.out, /starci app upgrade --execute: 8 steps applied\n$/);
  assert.equal(fs.existsSync(path.join(root, 'be/src/tests/world/test-world.config.ts')), true);
});

test('lint takes --json and --out, codemod --execute, --out and --json', async (t) => {
  const { parseLintArgs } = await import('../lint/run.mjs');
  assert.deepEqual({ ...parseLintArgs(['--json', '--out', 'r.json']) }, { changed: null, fix: false, format: 'json', out: 'r.json', workspace: undefined });
  const root = temp(t, 'hfs-canonical-codemod-');
  fs.mkdirSync(path.join(root, 'fe'));
  const executed = await run(['codemod', 'button-intent', '--execute', '--json', '--out', 'migration.json'], { cwd: root });
  assert.deepEqual([executed.code, executed.err], [0, '']);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'migration.json'), 'utf8'));
  assert.equal(report.write, true);
  assert.equal(executed.out, fs.readFileSync(path.join(root, 'migration.json'), 'utf8'));
  const dry = await run(['codemod', 'button-intent'], { cwd: root });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Dry run/);
});

test('an old spelling is an unknown verb or flag: exit 2, nothing written or misread', async (t) => {
  const root = await scaffolded(t);
  const properties = path.join(root, 'sonar-project.properties');
  const drifted = fs.readFileSync(properties, 'utf8').replace(/^sonar\.cpd\.exclusions=.*$/m, 'sonar.cpd.exclusions=hand/**');
  fs.writeFileSync(properties, drifted);
  const before = files(root);
  for (const argv of [['explain', 'hfs.json'], ['hygiene'], ['new', 'image'], ['sonar'], ['sonar', '--write'], ['stack', 'up'],
    ['sync', '--write'], ['sync', '--check'], ['lint', '--format', 'json'], ['lint', '--sonar', 'r.json'], ['upgrade', '--plan'],
    ['codemod', 'button-intent', '--write'], ['codemod', 'button-intent', '--report', 'r.json'], ['scaffold', 'again', '--into', 'x']]) {
    const result = await run(argv, { cwd: root, stackMain: async () => { throw new Error('the test world must not run'); } });
    assert.equal(result.code, 2, `${argv.join(' ')}: ${result.out}${result.err}`);
  }
  assert.deepEqual(files(root), before, 'no file was created');
  assert.equal(fs.readFileSync(properties, 'utf8'), drifted, 'sync --write was not read as an execute');
});

test('the managed pre-commit hook and the scripts call the current spellings', () => {
  const hook = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-commit', import.meta.url), 'utf8');
  assert.match(hook, /^npx --no-install starci app check --staged \|\| exit \$\?$/m);
  assert.match(hook, /^npx --no-install starci app sync \|\| exit \$\?$/m);
  const scripts = fs.readFileSync(new URL('../templates/app/package-scripts/package.json', import.meta.url), 'utf8');
  assert.match(scripts, /"test:world": "starci app world up"/);
  assert.doesNotMatch(scripts, /test:stack/);
});
