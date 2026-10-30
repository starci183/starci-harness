// The per-spec coverage of the check cache (spec-coverage-reporter.ts): with STARCI_SPEC_COVERAGE_DIR the unit run writes, per spec file, the covered and the
// not-covered items of each measured source (never hit counts); a failed spec stores nothing; a re-run of one spec merged with the other specs' records equals the
// full run, and the same run writes the same bytes. Proven with real jest runs over a small back end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const preset: typeof import('../src/index.ts') = require('../dist/index.js');
const SCOPE = { coverage: { roots: ['src/modules/domain/*/'], roles: ['service'], excludes: [] } };

const SOURCES: Record<string, string> = {
  'src/modules/domain/alpha/alpha.service.ts': 'export class AlphaService {\n  pick(value: number): string {\n    if (value > 0) return "positive";\n    return value < 0 ? "negative" : "zero";\n  }\n  constant(): number {\n    return 1;\n  }\n}\n',
  'src/modules/domain/alpha/alpha.service.spec.ts': 'import { AlphaService } from "./alpha.service";\ntest("pick", () => {\n  const alpha = new AlphaService();\n  expect([alpha.pick(1), alpha.pick(-1), alpha.pick(0), alpha.constant()]).toEqual(["positive", "negative", "zero", 1]);\n});\n',
  'src/modules/domain/beta/beta.service.ts': 'import { AlphaService } from "../alpha/alpha.service";\nexport class BetaService {\n  private readonly alpha = new AlphaService();\n  run(flag: boolean): string {\n    return flag ? this.alpha.pick(1) : "off";\n  }\n}\n',
  'src/modules/domain/beta/beta.service.spec.ts': 'import { BetaService } from "./beta.service";\ntest("run", () => {\n  const beta = new BetaService();\n  expect([beta.run(true), beta.run(false)]).toEqual(["positive", "off"]);\n});\n',
  'src/modules/domain/gamma/gamma.service.ts': 'export class GammaService {\n  id(): string {\n    return "gamma";\n  }\n}\n',
  'src/modules/domain/gamma/gamma.service.spec.ts': 'import { GammaService } from "./gamma.service";\ntest("id", () => expect(new GammaService().id()).toBe("gamma"));\n',
  'src/modules/domain/delta/delta.service.ts': 'export class DeltaService {\n  never(): number {\n    return 0;\n  }\n}\n',
};

function fixture(): { root: string; be: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-merge-'));
  const be = path.join(root, 'be');
  for (const [file, source] of Object.entries({ ...SOURCES, 'apps/.keep': '', 'src/tests/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'commonjs', target: 'es2022', isolatedModules: true } }) })) {
    fs.mkdirSync(path.dirname(path.join(be, file)), { recursive: true });
    fs.writeFileSync(path.join(be, file), source);
  }
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ edition: 'lite' }));
  fs.writeFileSync(path.join(be, 'jest.config.js'), `const config = require(${JSON.stringify(require.resolve('../dist/index.js'))}).starciJestConfig(${JSON.stringify(SCOPE)})
for (const project of config.projects) {
  delete project.preset
  for (const entry of Object.values(project.transform)) entry[0] = require.resolve(entry[0])
}
module.exports = config
`);
  return { root, be };
}

function jest(be: string, args: string[], env: Record<string, string> = {}, status = 0): void {
  const jestPackage = require.resolve('jest/package.json');
  const result = spawnSync(process.execPath, [path.join(path.dirname(jestPackage), 'bin', 'jest.js'), '--selectProjects', 'unit', '--coverage', '--ci', '--runInBand', '--cacheDirectory', path.join(be, '.jest-cache'), ...args], {
    cwd: be, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.dirname(path.dirname(jestPackage)), ...env }, timeout: 180_000,
  });
  assert.equal(result.status, status, result.stdout + result.stderr);
}

type Totals = Partial<Record<'LF' | 'LH' | 'FNF' | 'FNH' | 'BRF' | 'BRH', number>>;

/** Per source file (relative to be/): the lcov totals {LF, LH, FNF, FNH, BRF, BRH}. */
function totals(lcov: string, be: string): Record<string, Totals> {
  const out: Record<string, Totals> = {};
  let current: Totals | null = null;
  for (const line of fs.readFileSync(lcov, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const source = line.slice(3);
      current = {};
      out[path.relative(be, path.resolve(be, source)).split(path.sep).join('/')] = current;
    } else if (current && /^(LF|LH|FNF|FNH|BRF|BRH):/.test(line)) {
      const [tag = '', value] = line.split(':');
      Reflect.set(current, tag, Number(value));
    }
  }
  return out;
}


const SPECS = ['alpha', 'beta', 'gamma'].map((name) => `src/modules/domain/${name}/${name}.service.spec.ts`);
const GAMMA = 'src/modules/domain/gamma/gamma.service.ts';

function recordsOf(dir: string): Record<string, import('../src/spec-coverage.ts').SpecCoverageFile> {
  const { readSpecCoverage }: typeof import('../src/spec-coverage.ts') = require('../dist/spec-coverage.js');
  return Object.fromEntries(readSpecCoverage(dir).map((file) => [file.spec, file]));
}

function mergeRecords(be: string, files: Array<import('../src/spec-coverage.ts').SpecCoverageFile>, outDir: string): Record<string, Totals> {
  const { mergeSpecCoverage }: typeof import('../src/spec-coverage.ts') = require('../dist/spec-coverage.js');
  mergeSpecCoverage({ records: files.map((file) => file.sources), outDir, projectRoot: be });
  return totals(path.join(outDir, 'lcov.info'), be);
}

test('every passing spec writes covered and not-covered items of the measured sources only, as flags and never counts', () => {
  const { root, be } = fixture();
  try {
    const dir = path.join(be, 'spec-cov');
    jest(be, ['--coverageThreshold={}'], { STARCI_SPEC_COVERAGE_DIR: dir });
    const records = recordsOf(dir);
    assert.deepEqual(Object.keys(records), SPECS);
    const beta = records[SPECS[1] as string];
    assert.equal(beta?.passed, true);
    assert.deepEqual(Object.keys(beta?.sources ?? {}), ['src/modules/domain/alpha/alpha.service.ts', 'src/modules/domain/beta/beta.service.ts']);
    const alpha = beta?.sources['src/modules/domain/alpha/alpha.service.ts'];
    assert.ok(alpha && alpha.f.some((item) => item[3] === 0), 'beta never calls AlphaService.constant: an instrumented function it does not cover');
    assert.ok(alpha?.f.some((item) => item[3] === 1));
    for (const item of alpha?.s ?? []) assert.ok(item[4] === 0 || item[4] === 1, 'a flag, never a count');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the merge of the per-spec records equals the unsharded run per file, and so does a partial re-run merged with the kept records', () => {
  const { root, be } = fixture();
  try {
    jest(be, ['--coverageThreshold={}', '--coverageDirectory', path.join(be, 'coverage', 'whole')]);
    const whole = totals(path.join(be, 'coverage', 'whole', 'lcov.info'), be);
    const dir = path.join(be, 'spec-cov');
    jest(be, ['--coverageThreshold={}'], { STARCI_SPEC_COVERAGE_DIR: dir });
    const all = Object.values(recordsOf(dir));
    const merged = mergeRecords(be, all, path.join(be, 'coverage', 'merged'));
    for (const file of ['alpha', 'beta', 'gamma'].map((name) => `src/modules/domain/${name}/${name}.service.ts`)) assert.deepEqual(merged[file], whole[file], file);
    assert.equal(merged['src/modules/domain/delta/delta.service.ts'], undefined);
    // A warm run: only the gamma spec runs again; the other specs keep their records.
    const warm = path.join(be, 'spec-cov-warm');
    jest(be, ['--coverageThreshold={}', '--runTestsByPath', SPECS[2] as string], { STARCI_SPEC_COVERAGE_DIR: warm });
    const rerun = recordsOf(warm);
    assert.deepEqual(Object.keys(rerun), [SPECS[2]]);
    const kept = all.filter((file) => file.spec !== SPECS[2]);
    const after = mergeRecords(be, [...kept, ...Object.values(rerun)], path.join(be, 'coverage', 'warm'));
    assert.deepEqual(after, merged);
    // Without the gamma record the total drops to what the other specs cover: the union needs every spec.
    assert.equal(mergeRecords(be, kept, path.join(be, 'coverage', 'partial'))[GAMMA], undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a failed spec stores no coverage, and the same run writes the same bytes', () => {
  const { root, be } = fixture();
  try {
    fs.writeFileSync(path.join(be, "src/modules/domain/gamma/gamma.service.spec.ts"), [`import { GammaService } from "./gamma.service";`, `test("id", () => expect(new GammaService().id()).toBe("other"));`, ""].join('\n'));
    const first = path.join(be, 'spec-cov-1');
    const second = path.join(be, 'spec-cov-2');
    jest(be, ['--coverageThreshold={}'], { STARCI_SPEC_COVERAGE_DIR: first }, 1);
    jest(be, ['--coverageThreshold={}'], { STARCI_SPEC_COVERAGE_DIR: second }, 1);
    const records = recordsOf(first);
    assert.equal(records[SPECS[2] as string]?.passed, false);
    assert.deepEqual(records[SPECS[2] as string]?.sources, {});
    assert.equal(records[SPECS[0] as string]?.passed, true);
    for (const name of fs.readdirSync(first)) assert.equal(fs.readFileSync(path.join(first, name), 'utf8'), fs.readFileSync(path.join(second, name), 'utf8'), name);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the spec coverage run keeps no threshold and instruments nothing it does not load', () => {
  const previous = process.cwd();
  const { root, be } = fixture();
  try {
    process.chdir(be);
    process.env.STARCI_SPEC_COVERAGE_DIR = path.join(be, 'out');
    const config = preset.starciJestConfig(SCOPE);
    assert.equal(config.collectCoverageFrom, undefined);
    assert.equal(config.coverageThreshold, undefined);
    assert.equal(config.reporters?.length, 2);
  } finally {
    delete process.env.STARCI_SPEC_COVERAGE_DIR;
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
