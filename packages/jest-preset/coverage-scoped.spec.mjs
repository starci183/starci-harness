import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const jestBin = require.resolve('jest/bin/jest');
const tsJestPreset = require.resolve('ts-jest/jest-preset.js');
const tsJestTransformer = require.resolve('ts-jest');
const metrics = ['lines', 'branches', 'functions', 'statements'];
const coveredFile = 'src/modules/domain/cart/covered.service.ts';
const partialFile = 'src/modules/platform/access/partial.guard.ts';
const unloadedFile = 'src/modules/integrations/remote/unloaded.client.ts';

/** The same declared roots contain covered, partially covered and unloaded subjects in every fixture. */
function fixture(t, partial = false) {
  const fixtureParent = path.resolve(os.tmpdir());
  const app = fs.mkdtempSync(path.join(fixtureParent, 'starci-coverage-scoped-'));
  t.after(() => {
    const target = path.resolve(app);
    assert.equal(path.dirname(target), fixtureParent);
    assert.ok(path.basename(target).startsWith('starci-coverage-scoped-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (relative, text) => {
    const file = path.join(app, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  write('package.json', JSON.stringify({ name: 'coverage-scoped-fixture', private: true }));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', strict: true, esModuleInterop: true, isolatedModules: true } }));
  write('jest.config.cjs', `const config = require(${JSON.stringify(path.join(here, 'index.cjs'))}).starciJestConfig({ coverage: {
    roots: ['src/modules/domain/*/', 'src/modules/integrations/*/', 'src/modules/platform/*/'],
    roles: ['service', 'guard', 'client'], excludes: []
  } })
const defaults = require(${JSON.stringify(tsJestPreset)}).transform
for (const project of config.projects) {
    project.preset = ${JSON.stringify(path.dirname(tsJestPreset))}
    project.transform = Object.fromEntries(Object.entries({ ...project.transform, ...defaults, ...project.transform }).map(([pattern, entry]) => [
        pattern, Array.isArray(entry) && entry[0] === "ts-jest" ? [${JSON.stringify(tsJestTransformer)}, ...entry.slice(1)] : entry,
    ]))
}
module.exports = config
`);
  fs.mkdirSync(path.join(app, 'apps'), { recursive: true });
  const methods = Array.from({ length: 120 }, (_, index) => `    m${index}(flag: boolean): number {\n        if (flag) return ${index}\n        return ${index + 1}\n    }`).join('\n');
  const assertions = Array.from({ length: 120 }, (_, index) => `    expect(subject.m${index}(true)).toBe(${index})\n    expect(subject.m${index}(false)).toBe(${index + 1})`).join('\n');
  write(coveredFile, `export class CoveredService {\n${methods}\n}\n`);
  write('src/modules/domain/cart/covered.service.spec.ts', `import { CoveredService } from "./covered.service"\ntest("covers every source branch", () => {\n    const subject = new CoveredService()\n${assertions}\n})\n`);
  write(partialFile, `export class PartialGuard {
    accept(flag: boolean): string {
        if (flag) return "yes"
        return "no"
    }
    unused(): number {
        return 7
    }
}
`);
  write(unloadedFile, `export class UnloadedClient {
    request(): string {
        return "unloaded"
    }
}
`);
  if (partial) {
    write('src/modules/platform/access/partial.guard.spec.ts', 'import { PartialGuard } from "./partial.guard"\ntest("covers one path", () => { expect(new PartialGuard().accept(false)).toBe("no") })\n');
  }
  return app;
}

/** Invoke the actual scoped collection option the app gate supplies, retaining the preset's threshold contract. */
function run(app, scopedFiles) {
  const args = [jestBin, '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--no-cache', '--coverageReporters=json-summary', '--coverageReporters=text-summary'];
  if (scopedFiles) args.push(...scopedFiles.map((file) => `--collectCoverageFrom=${file}`));
  const result = spawnSync(process.execPath, args, { cwd: app, encoding: 'utf8', timeout: 300_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.signal, null, output);
  assert.equal(typeof result.status, 'number', output);
  const report = path.join(app, 'coverage', 'coverage-summary.json');
  assert.ok(fs.existsSync(report), output);
  return { result, output, summary: JSON.parse(fs.readFileSync(report, 'utf8')) };
}

/** Locate a real source file in Jest's report independently of the platform's path separators. */
function measured(summary, file) {
  const key = Object.keys(summary).find((name) => name.replaceAll('\\', '/').endsWith(file));
  assert.ok(key, `coverage report omits ${file}`);
  return summary[key];
}

test('scoped coverage passes for a fully covered file while other declared roots have unloaded logic', (t) => {
  const app = fixture(t);
  const { result, output, summary } = run(app, [coveredFile]);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /Coverage data .* was not found/);
  for (const metric of metrics) assert.equal(measured(summary, coveredFile)[metric].pct, 100, metric);
  assert.equal(Object.keys(summary).filter((name) => name !== 'total').length, 1, 'only the requested file is measured');
});

test('full coverage scope retains unloaded logic and refuses it below the per-file thresholds', (t) => {
  const app = fixture(t);
  const { result, output, summary } = run(app);
  assert.equal(result.status, 1, output);
  assert.match(output, /Test Suites:\s+1 passed/);
  assert.match(output, /unloaded\.client\.ts.*coverage threshold/is);
  for (const metric of metrics) {
    assert.equal(measured(summary, coveredFile)[metric].pct, 100, metric);
    assert.ok(measured(summary, unloadedFile)[metric].pct < 100, `${metric} of unloaded logic remains in the denominator`);
  }
  assert.ok(Object.keys(summary).some((name) => name.replaceAll('\\', '/').endsWith(partialFile)), 'the other unloaded root is measured too');
});

test('a partially covered file fails all four per-file metrics despite a large fully covered file in the union', (t) => {
  const app = fixture(t, true);
  const { result, output, summary } = run(app, [coveredFile, partialFile]);
  assert.equal(result.status, 1, output);
  assert.match(output, /Test Suites:\s+2 passed/);
  assert.doesNotMatch(output, /Coverage data .* was not found/);
  for (const metric of metrics) {
    assert.equal(measured(summary, coveredFile)[metric].pct, 100, metric);
    const actual = measured(summary, partialFile)[metric].pct;
    assert.ok(actual < 100, `${metric} of the partial file is below 100`);
    assert.ok(summary.total[metric].pct > actual, `${metric} average does not hide the smaller file`);
    assert.match(output, new RegExp(`partial\\.guard\\.ts.*coverage threshold for ${metric} \\(100%\\) not met`), metric);
  }
});
