import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// The root workspace packages of an app (`packages/<name>` beside `be/`, PROJECT-3) run their specs in the back end's unit project, so the
// test gate, the CI shards and the merged coverage proof count them: the packages option adds each package's `src/` to the unit roots, and
// the measured files of a package come through the rendered coverage scope like any other declared logic file.
const require = createRequire(import.meta.url);
const jestBin = require.resolve('jest/bin/jest');
const presetIndex = require.resolve('../dist/index.js');
const tsJestPreset = require.resolve('ts-jest/jest-preset.js');
const tsJestTransformer = require.resolve('ts-jest');
const preset = require(presetIndex) as { starciJestConfig(options: unknown): { projects: Array<{ displayName?: unknown; roots?: string[] }> } };

const scope = { roots: ['src/modules/domain/*/'], roles: ['service'], files: [], excludes: [] };
const packages = { folders: ['packages/sdk'], files: ['packages/sdk/src/**/*.ts'], excludes: ['packages/sdk/src/**/index.ts', 'packages/sdk/src/workbench/**'] };

function fixture(t: TestContext, { covered }: { covered: boolean }): string {
  const parent = path.resolve(os.tmpdir());
  const app = fs.mkdtempSync(path.join(parent, 'starci-coverage-packages-'));
  t.after(() => {
    const target = path.resolve(app);
    assert.equal(path.dirname(target), parent);
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (relative: string, text: string): void => {
    const file = path.join(app, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('be/package.json', JSON.stringify({ name: 'coverage-packages-fixture', private: true }));
  write('be/tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', strict: true, esModuleInterop: true, isolatedModules: true } }));
  write('be/jest.config.cjs', `const config = require(${JSON.stringify(presetIndex)}).starciJestConfig({ coverage: ${JSON.stringify(scope)}, packages: ${JSON.stringify(packages)} })
const defaults = require(${JSON.stringify(tsJestPreset)}).transform
for (const project of config.projects) {
    project.preset = ${JSON.stringify(path.dirname(tsJestPreset))}
    project.transform = Object.fromEntries(Object.entries({ ...project.transform, ...defaults, ...project.transform }).map(([pattern, entry]) => [
        pattern, Array.isArray(entry) && entry[0] === "ts-jest" ? [${JSON.stringify(tsJestTransformer)}, ...entry.slice(1)] : entry,
    ]))
}
module.exports = config
`);
  fs.mkdirSync(path.join(app, 'be', 'apps'), { recursive: true });
  write('be/src/modules/domain/cart/cart.service.ts', 'export const total = (a: number, b: number): number => a + b\n');
  write('be/src/modules/domain/cart/cart.service.spec.ts', 'import { total } from "./cart.service"\ntest("adds", () => { expect(total(1, 2)).toBe(3) })\n');
  write('packages/sdk/src/index.ts', 'export { pick } from "./pick"\n');
  write('packages/sdk/src/pick.ts', 'export const pick = (flag: boolean): string => (flag ? "yes" : "no")\n');
  write('packages/sdk/src/workbench/view.ts', 'export const view = (): string => "drawn by the front end"\n');
  const checks = covered ? 'expect(pick(true)).toBe("yes")\n    expect(pick(false)).toBe("no")' : 'expect(pick(false)).toBe("no")';
  write('packages/sdk/src/pick.spec.ts', `import { pick } from "./pick"\ntest("picks", () => {\n    ${checks}\n})\n`);
  return app;
}

function run(app: string): { status: number | null; output: string; files: string[] } {
  const args = [jestBin, '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--no-cache', '--coverageReporters=json-summary', '--coverageReporters=text'];
  const result = spawnSync(process.execPath, args, { cwd: path.join(app, 'be'), encoding: 'utf8', timeout: 300_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.error, undefined, output);
  const report = path.join(app, 'be', 'coverage', 'coverage-summary.json');
  assert.ok(fs.existsSync(report), output);
  const files = Object.keys(JSON.parse(fs.readFileSync(report, 'utf8')) as Record<string, unknown>).filter((name) => name !== 'total').map((name) => name.replaceAll('\\', '/'));
  return { status: result.status, output, files };
}

test('the unit project runs the specs of a root package beside the back end and measures its logic, not its barrels or its workbench', (t) => {
  const { status, output, files } = run(fixture(t, { covered: true }));
  assert.equal(status, 0, output);
  assert.match(output, /Test Suites:\s+2 passed/, 'the back-end spec and the package spec');
  assert.ok(files.some((file) => file.endsWith('/packages/sdk/src/pick.ts')), 'the package logic is measured');
  assert.ok(files.some((file) => file.endsWith('/be/src/modules/domain/cart/cart.service.ts')), 'the back-end logic is measured');
  assert.ok(!files.some((file) => file.endsWith('/packages/sdk/src/index.ts')), 'a barrel is not measured');
  assert.ok(!files.some((file) => file.includes('/packages/sdk/src/workbench/')), 'the workbench is a front end');
});

test('a root package file below 100 fails the per-file threshold of the unit run', (t) => {
  const { status, output } = run(fixture(t, { covered: false }));
  assert.equal(status, 1, output);
  assert.match(output, /pick\.ts.*coverage threshold for branches \(100%\) not met/is);
});

test('the per-spec records of the check cache name a package spec and its sources from the jest root, as the back end names its own', (t) => {
  const app = fixture(t, { covered: true });
  const dir = path.join(app, 'records');
  const result = spawnSync(process.execPath, [jestBin, '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--no-cache'], { cwd: path.join(app, 'be'), encoding: 'utf8', timeout: 300_000, env: { ...process.env, STARCI_SPEC_COVERAGE_DIR: dir } });
  assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
  const records = fs.readdirSync(dir).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { spec: string; passed: boolean; sources: Record<string, unknown> });
  const own = records.find((record) => record.spec === '../packages/sdk/src/pick.spec.ts');
  assert.ok(own, JSON.stringify(records.map((record) => record.spec)));
  assert.equal(own.passed, true);
  assert.deepEqual(Object.keys(own.sources), ['../packages/sdk/src/pick.ts']);
  assert.ok(records.some((record) => record.spec === 'src/modules/domain/cart/cart.service.spec.ts'));
});

test('a CI shard measures the package files its specs load, for the merged proof', (t) => {
  const app = fixture(t, { covered: true });
  const result = spawnSync(process.execPath, [jestBin, '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--no-cache', '--shard=1/1'], { cwd: path.join(app, 'be'), encoding: 'utf8', timeout: 300_000, env: { ...process.env, STARCI_COVERAGE_SHARD: '1' } });
  assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
  const final = Object.keys(JSON.parse(fs.readFileSync(path.join(app, 'be', 'coverage', 'coverage-final.json'), 'utf8')) as Record<string, unknown>).map((name) => name.replaceAll('\\', '/'));
  assert.ok(final.some((file) => file.endsWith('/packages/sdk/src/pick.ts')), JSON.stringify(final));
});

test('the root packages are a second unit project rooted at the app root, and a packages option that is not the rendered shape is refused', () => {
  const units = preset.starciJestConfig({ coverage: scope, packages: { folders: ['packages/sdk', 'packages/module-shop'], files: ['packages/sdk/src/**/*.ts'], excludes: [] } }).projects.filter((project) => project.displayName === 'unit');
  assert.equal(units.length, 2);
  assert.deepEqual(units[1]?.roots, ['<rootDir>/packages/sdk/src', '<rootDir>/packages/module-shop/src']);
  assert.equal((units[1] as { rootDir?: string }).rootDir, '..');
  assert.equal(preset.starciJestConfig({ coverage: scope }).projects.filter((project) => project.displayName === 'unit').length, 1);
  for (const packagesOption of ['packages/sdk', { folders: ['packages/sdk'] }, { folders: [''], files: [], excludes: [] }]) {
    assert.throws(() => preset.starciJestConfig({ coverage: scope, packages: packagesOption }), /needs the root packages starci app sync renders/);
  }
});
