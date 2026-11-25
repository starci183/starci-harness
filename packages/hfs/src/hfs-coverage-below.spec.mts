// proves: HFS_COVERAGE_BELOW
// proves: HFS_COVERAGE_BELOW
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { byCodeUnit } from '../runtime/scripts/lib/list.mjs';
import type { CoverageFromOptions } from '../runtime/scripts/hfs/coverage-from.mjs';
import { coverageFrom, coverageFromMain, formatCoverageReport } from '../runtime/scripts/hfs/coverage-from.mjs';
import { HFS_COVERAGE_BELOW, coverageBelowFindings, coverageBelowReport } from '../runtime/scripts/hfs/rules/coverage-below.mjs';
import { a15Findings } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';

interface Finding { code: string; level: string; path: string; message: string }
interface Context { repoRoot: string; repo: ReturnType<typeof resolveRepoDeclaration>; manifest: ReturnType<typeof loadSlotManifest>; files: string[]; coverageFrom?: string }

const manifest = loadSlotManifest();
const LOGIC = 'be/src/modules/domain/orders/orders.service.ts';
const POLICY = 'be/src/modules/platform/access/access.policy.ts';
const OUTSIDE = [
  'be/src/features/api/orders/application/place-order.handler.ts',
  'be/src/features/cli/seed/seed.cli.ts',
  'be/src/features/webhooks/stripe/transport/http/stripe.webhook.ts',
  'be/src/modules/domain/orders/persistence/orders.mapper.ts',
  'be/src/modules/domain/orders/orders.module.ts',
];
const declaration = (edition: string, coverageTiers?: Record<string, string[]>) => ({
  hfs: 3, kind: 'app', project: 'coverage-demo', edition,
  sides: {
    be: { apps: [{ name: 'core', kind: 'api' }, { name: 'cli', kind: 'cli' }], connections: [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'database', provider: 'postgres' }], ...(coverageTiers === undefined ? {} : { coverageTiers }) },
    fe: { apps: [{ name: 'web', kind: 'next' }] },
  },
});

const record = (file: string, { line = 1, fn = 1, branch = 1 }: { line?: number; fn?: number; branch?: number | '-' } = {}) => [
  `SF:${file}`, 'FN:1,run', `FNDA:${fn},run`, 'FNF:1', `FNH:${fn > 0 ? 1 : 0}`,
  `DA:1,${line}`, 'LF:1', `LH:${line > 0 ? 1 : 0}`,
  `BRDA:1,0,0,${branch}`, 'BRF:1', `BRH:${branch !== '-' && branch > 0 ? 1 : 0}`, 'end_of_record', '',
].join('\n');

/** A record of `found` lines of which the first `hit` ran, its one function run and no branch: a file at hit/found lines. */
const spread = (file: string, hit: number, found: number) => [
  `SF:${file}`, 'FN:1,run', 'FNDA:1,run', 'FNF:1', 'FNH:1',
  ...Array.from({ length: found }, (_, at) => `DA:${at + 1},${at < hit ? 1 : 0}`), `LF:${found}`, `LH:${hit}`, 'BRF:0', 'BRH:0', 'end_of_record', '',
].join('\n');

/** The per-file findings of a report (a tier finding is filed on the report). */
const fileFindings = (report: Record<string, unknown>, file: string): Finding[] => (report.findings as Finding[]).filter((finding) => finding.path === file);

function fixture(t: TestContext, edition: string, report: string | undefined, files = [LOGIC, ...OUTSIDE], coverageTiers?: Record<string, string[]>): Context {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-coverage-below-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'hfs.json'), JSON.stringify(declaration(edition, coverageTiers)));
  fs.mkdirSync(path.join(dir, 'coverage'));
  if (report !== undefined) fs.writeFileSync(path.join(dir, 'coverage/lcov.info'), report);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), 'export class Subject { run() { return 1; } }\n');
  }
  const repo = resolveRepoDeclaration(manifest, declaration(edition, coverageTiers));
  return { repoRoot: dir, repo, manifest, files, coverageFrom: 'coverage/lcov.info' };
}

for (const edition of ['lite'] as const) {
  test(`HFS_COVERAGE_BELOW ${edition}: refuses each metric below the per-file floor of a measured file`, (t) => {
    for (const partial of [{ line: 0 }, { fn: 0 }, { branch: '-' }] as const) {
      const report = coverageBelowReport(fixture(t, edition, record(LOGIC, partial)));
      assert.equal(report.ok, false);
      assert.deepEqual(fileFindings(report, LOGIC).map((finding: Finding) => [finding.code, finding.level, finding.path]), [[HFS_COVERAGE_BELOW, 'error', LOGIC]]);
      assert.match(fileFindings(report, LOGIC)[0]!.message, /0\/1 \(0\.00%\) is below the per-file floor of 50%/);
    }
  });

  test(`HFS_COVERAGE_BELOW ${edition}: accepts a fully covered file and lists features, cli and webhooks outside measured scope`, (t) => {
    const report = coverageFrom(fixture(t, edition, record(LOGIC) + OUTSIDE.map((file) => record(file, { line: 0, fn: 0, branch: 0 })).join('')));
    assert.equal(report.ok, true);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.measured, [LOGIC]);
    assert.deepEqual(report.unmeasured, [...OUTSIDE].sort(byCodeUnit));
    assert.ok(report.unmeasuredScopes.includes('be/src/features/api/*/'));
    assert.ok(report.unmeasuredScopes.includes('be/src/features/cli/'));
    assert.ok(report.unmeasuredScopes.includes('be/src/features/webhooks/*/'));
    const output = formatCoverageReport(report);
    for (const file of OUTSIDE) assert.ok(output.includes(file), file);
    assert.match(output, /unmeasured scope:/);
    assert.match(output, /statement coverage is enforced by the unit runner/);
  });

  test(`HFS_COVERAGE_BELOW ${edition}: missing measured SF records cannot shrink the denominator`, (t) => {
    const context = fixture(t, edition, record(LOGIC), [LOGIC, POLICY]);
    const report = coverageBelowReport(context);
    assert.equal(report.ok, false);
    assert.deepEqual(report.measured, [LOGIC, POLICY]);
    assert.deepEqual(report.findings.map((finding: Finding) => finding.path), [POLICY]);
    assert.match(report.findings[0].message, /no lcov source record/);
  });

  test(`HFS_COVERAGE_BELOW ${edition}: unreadable and empty reports refuse rather than skip`, (t) => {
    const absent = coverageBelowReport(fixture(t, edition, undefined));
    assert.equal(absent.ok, false);
    assert.equal(absent.findings[0].code, HFS_COVERAGE_BELOW);
    assert.match(absent.findings[0].message, /cannot be read/);
    const empty = coverageBelowReport(fixture(t, edition, ''));
    assert.equal(empty.ok, false);
    assert.match(empty.findings[0].message, /no source records/);
    assert.ok(empty.findings.some((finding: Finding) => finding.path === LOGIC));
  });

  test(`HFS_COVERAGE_BELOW ${edition}: ordinary app check has no coverage opt-in and no changed behavior`, (t) => {
    const context = fixture(t, edition, record(LOGIC, { line: 0 }));
    delete context.coverageFrom;
    assert.deepEqual(coverageBelowFindings(context), []);
    assert.equal(coverageBelowReport(context).enabled, false);
    assert.deepEqual(coverageBelowFindings({ ...context, repo: context.repo.sides!.fe, coverageFrom: 'coverage/lcov.info' }), []);
  });
}

test('HFS_COVERAGE_BELOW: the alpha.15 registry judges an explicit report and accepts its covered replacement', (t) => {
  const context = fixture(t, 'full', record(LOGIC, { line: 0 }));
  const own = (list: Finding[]) => list.filter((finding: Finding) => finding.code === HFS_COVERAGE_BELOW);
  const findings = own(a15Findings(context));
  assert.deepEqual(findings.map((finding: Finding) => [finding.code, finding.level, finding.path]), [[HFS_COVERAGE_BELOW, 'error', LOGIC], [HFS_COVERAGE_BELOW, 'error', 'coverage/lcov.info']], 'the file below the floor, and its tier below its bar');
  fs.writeFileSync(path.join(context.repoRoot, context.coverageFrom!), record(LOGIC));
  assert.deepEqual(own(a15Findings(context)), []);
});

test('HFS_COVERAGE_BELOW: app and be-relative SF paths, absolute POSIX/Windows paths, file URIs and CRLF resolve the same measured file', (t) => {
  const context = fixture(t, 'lite', record(LOGIC));
  const posixSource = path.posix.join(path.posix.sep, 'ci', 'project', LOGIC);
  const windowsSource = path.win32.resolve('C:', os.tmpdir(), 'ci', 'project', LOGIC);
  const sources = [
    LOGIC, LOGIC.slice(3), `./${LOGIC}`, path.join(context.repoRoot, LOGIC),
    posixSource, windowsSource, windowsSource.toUpperCase(),
    pathToFileURL(path.join(context.repoRoot, LOGIC)).href,
  ];
  for (const source of sources) {
    const report = coverageBelowReport({ ...context, lcov: `\uFEFF${record(source).replaceAll('\n', '\r\n')}` });
    assert.equal(report.ok, true, `${source}: ${JSON.stringify(report.findings)}`);
  }
});

test('HFS_COVERAGE_BELOW: checking the be side reports side-relative paths and shares the app boundary', (t) => {
  const app = fixture(t, 'full', record(LOGIC));
  const context = { ...app, repoRoot: path.join(app.repoRoot, 'be'), repo: app.repo.sides!.be, files: app.files.map((file) => file.slice(3)), coverageFrom: '../coverage/lcov.info' };
  const report = coverageFrom(context);
  assert.equal(report.ok, true);
  assert.deepEqual(report.measured, [LOGIC.slice(3)]);
  assert.deepEqual(report.unmeasured, OUTSIDE.map((file) => file.slice(3)).sort(byCodeUnit));
});

test('HFS_COVERAGE_BELOW: duplicate test-name records merge covered identities, not totals or percentages', (t) => {
  const base = fixture(t, 'lite', record(LOGIC));
  const part = (name: string, first: number, second: number) => [
    `TN:${name}`, `SF:${LOGIC}`, 'FN:1,run', 'FNDA:1,run', 'FNF:1', 'FNH:1',
    `DA:1,${first}`, `DA:2,${second}`, 'LF:2', 'LH:1',
    `BRDA:1,0,0,${first}`, `BRDA:1,0,1,${second}`, 'BRF:2', 'BRH:1', 'end_of_record', '',
  ].join('\n');
  const good = coverageBelowReport({ ...base, lcov: part('first', 1, 0) + part('second', 0, 1) });
  assert.equal(good.ok, true);
  assert.deepEqual(good.results[0].metrics.lines, { found: 2, hit: 2, percent: 100 });
  const bad = coverageBelowReport({ ...base, lcov: part('first', 1, 0) + part('second', 1, 0) });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.results[0].metrics.branches, { found: 2, hit: 1, percent: 50 });
});

test('HFS_COVERAGE_BELOW: invalid counts and contradictory summary metadata refuse a nominally covered report', (t) => {
  const context = fixture(t, 'full', record(LOGIC));
  for (const lcov of [record(LOGIC).replace('DA:1,1', 'DA:1,-1'), record(LOGIC).replace('LF:1', 'LF:2'), record(LOGIC).replace('LH:1', 'LH:2')]) {
    const report = coverageBelowReport({ ...context, lcov });
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((finding: Finding) => finding.path === LOGIC));
    assert.match(report.findings.at(-1).message, /invalid DA|disagrees/);
  }
});

test('HFS_COVERAGE_BELOW: metrics missing from lcov are unavailable while explicit zero denominators pass', (t) => {
  const context = fixture(t, 'full', record(LOGIC));
  const missing = coverageBelowReport({ ...context, lcov: `SF:${LOGIC}\nDA:1,1\nLF:1\nLH:1\nend_of_record\n` });
  assert.equal(missing.ok, false);
  assert.match(missing.findings[0].message, /functions coverage is unavailable/);
  const zero = coverageBelowReport({ ...context, lcov: `SF:${LOGIC}\nDA:1,1\nLF:1\nLH:1\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n` });
  assert.equal(zero.ok, true);
  assert.deepEqual(zero.results[0].metrics.functions, { found: 0, hit: 0, percent: 100 });
});

test('HFS_COVERAGE_BELOW: summary-only reports require each record to prove the floor, with no percentage rounding escape', (t) => {
  const context = fixture(t, 'lite', record(LOGIC));
  const summary = (found: number, hit: number) => `SF:${LOGIC}\nLF:${found}\nLH:${hit}\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n`;
  assert.equal(coverageBelowReport({ ...context, lcov: summary(2, 2) + summary(1, 1) }).ok, true);
  const below = coverageBelowReport({ ...context, lcov: summary(2000000, 999999) });
  assert.equal(below.ok, false);
  assert.equal(below.results[0].metrics.lines.hit, 999999);
  assert.match(fileFindings(below, LOGIC)[0]!.message, /is below the per-file floor of 50%/, '49.99995% is below 50, never rounded up to it');
});

test('HFS_COVERAGE_BELOW: a tier is judged over its files as a whole, against the bar of the tier the app declares (owner 2026-11-25)', (t) => {
  // orders at 70% lines: above the per-file floor (50), below tier A (85) and the default tier B (75), above tier C (60).
  const lcov = spread(LOGIC, 7, 10);
  const undeclared = coverageBelowReport(fixture(t, 'lite', lcov));
  assert.deepEqual(fileFindings(undeclared, LOGIC), [], 'the file reaches the per-file floor');
  assert.deepEqual(undeclared.tiers.map((tier: { tier: string; files: string[]; ok: boolean }) => [tier.tier, tier.files, tier.ok]), [['B', [LOGIC], false]], 'an undeclared module is in the default tier');
  assert.match(undeclared.findings.at(-1).message, /coverage tier B \(1 measured files\): lines 7\/10 \(70\.00%\) is below the tier B bar of 75%/);
  const money = coverageBelowReport(fixture(t, 'lite', lcov, undefined, { A: ['domain/orders'] }));
  assert.equal(money.ok, false);
  assert.match(money.findings.at(-1).message, /below the tier A bar of 85%/);
  const integration = coverageBelowReport(fixture(t, 'lite', lcov, undefined, { C: ['domain/*'] }));
  assert.equal(integration.ok, true, 'a module the app puts in tier C is held to 60');
  const exact = coverageBelowReport(fixture(t, 'lite', lcov, undefined, { A: ['domain/orders'], C: ['domain/*'] }));
  assert.equal(exact.tiers[0].tier, 'A', 'an entry without * wins over a pattern');
});

test('HFS_COVERAGE_BELOW: the tiers sum their files, so a covered module carries a weaker one of the same tier, never one of another', (t) => {
  const files = [LOGIC, POLICY, ...OUTSIDE];
  const lcov = spread(LOGIC, 10, 10) + spread(POLICY, 6, 10);
  const together = coverageBelowReport(fixture(t, 'lite', lcov, files));
  assert.equal(together.ok, true, 'B: 16/20 lines is 80%, above 75');
  const apart = coverageBelowReport(fixture(t, 'lite', lcov, files, { A: ['platform/access'] }));
  assert.equal(apart.ok, false, 'A holds access alone at 60%');
  assert.deepEqual(apart.tiers.map((tier: { tier: string; ok: boolean }) => [tier.tier, tier.ok]), [['A', false], ['B', true]]);
});

test('HFS_COVERAGE_BELOW: a business package (hfs.json sides.nivoos) is measured but its barrels, and held to the business bar of 60 as a whole', (t) => {
  const CELL = 'packages/biz/src/book-lead.cell.ts';
  const STEP = 'packages/biz/src/steps/send.step.ts';
  const files = [LOGIC, CELL, STEP, 'packages/biz/package.json', 'packages/biz/tsconfig.json', 'packages/biz/src/biz.package.ts', 'packages/biz/src/index.ts'];
  const judged = (lcov: string) => {
    const context = fixture(t, 'lite', lcov, files);
    const sides = { ...declaration('lite').sides, nivoos: { packages: [{ name: 'biz' }] } };
    fs.writeFileSync(path.join(context.repoRoot, 'hfs.json'), JSON.stringify({ ...declaration('lite'), sides }));
    return coverageBelowReport({ ...context, all: files, repo: resolveRepoDeclaration(manifest, { ...declaration('lite'), sides }) });
  };
  const entry = record('../packages/biz/src/biz.package.ts');
  const above = judged(record(LOGIC) + entry + spread(`../${CELL}`, 7, 10) + spread(`../${STEP}`, 6, 10));
  assert.ok(above.measured.includes(CELL) && above.measured.includes(STEP), 'the cells and steps of the package are measured');
  assert.ok(above.unmeasured.includes('packages/biz/src/index.ts'), 'its barrel is not');
  assert.deepEqual(above.tiers.map((tier: { tier: string; ok: boolean }) => [tier.tier, tier.ok]), [['B', true], ['business', true]], '14/21 lines is above 60');
  const below = judged(record(LOGIC) + entry + spread(`../${CELL}`, 5, 10) + spread(`../${STEP}`, 5, 10));
  assert.equal(below.ok, false);
  assert.match(below.findings.at(-1).message, /coverage tier business \(3 measured files\): lines 11\/21 \(52\.38%\) is below the tier business bar of 60%/);
});

const GATES_OFF = (gate: 'test' | 'coverage') => [
  'gates:',
  ...(gate === 'test' ? ['  test: {run: off, reason: "specs are written after the release"}', '  sonar: {run: off, reason: "reads the coverage"}'] : []),
  `  coverage: {run: off, reason: "${gate === 'test' ? 'reads the unit run' : 'coverage comes after the release'}"}`,
  '  codecov: {run: off, reason: "reads the coverage"}',
  '',
].join('\n');

test('HFS_COVERAGE_BELOW: the floor, the tiers and the business bar are test and coverage obligations: a declared-off gate judges none of them and says off (declared)', (t) => {
  for (const gate of ['test', 'coverage'] as const) {
    const context = fixture(t, 'lite', record(LOGIC, { line: 0 }));
    const on = coverageBelowReport(context);
    assert.equal(on.ok, false, 'with the gates on, the file below the floor and its tier are findings');
    assert.ok(on.findings.length >= 2);
    fs.mkdirSync(path.join(context.repoRoot, '.starcistacks'), { recursive: true });
    fs.writeFileSync(path.join(context.repoRoot, '.starcistacks/application-stacks.yaml'), GATES_OFF(gate));
    const off = coverageBelowReport(context);
    assert.deepEqual(off.findings, [], `${gate} declared off: no R273 finding`);
    assert.deepEqual(off.tiers, []);
    assert.match(off.off, new RegExp(`^${gate}: off \\(declared: `));
    assert.match(formatCoverageReport(off), /^coverage: (test|coverage): off \(declared: .*not counted as passed/);
    const side = coverageBelowReport({ ...context, repoRoot: path.join(context.repoRoot, 'be'), repo: context.repo.sides!.be, files: context.files.map((file) => file.slice(3)), coverageFrom: '../coverage/lcov.info' });
    assert.equal(typeof side.off, 'string', 'a be-side run reads the declaration of its app root');
  }
});

test('HFS_COVERAGE_BELOW: manifest coverage changes alter the denominator', (t) => {
  const context = fixture(t, 'lite', record(LOGIC), [LOGIC, POLICY]);
  const changed = { ...manifest, slots: manifest.slots.map((slot) => slot.id === 'be.domain' ? { ...slot, coverage: 'none' } : slot) };
  const unmeasured = coverageBelowReport({ ...context, manifest: changed, lcov: record(POLICY) });
  assert.equal(unmeasured.ok, true);
  assert.deepEqual(unmeasured.measured, [POLICY]);
  assert.ok(unmeasured.unmeasured.includes(LOGIC));
  const measured = coverageBelowReport({ ...context, lcov: record(POLICY) });
  assert.equal(measured.ok, false);
  assert.ok(measured.findings.some((finding: Finding) => finding.path === LOGIC));
});

test('HFS_COVERAGE_BELOW: CLI accepts cwd, inline report and JSON and returns refusal status for an uncovered file', (t) => {
  const context = fixture(t, 'lite', record(LOGIC));
  let output = '';
  let errors = '';
  const run = (opts: CoverageFromOptions) => coverageFrom({ ...context, ...opts });
  const io = { cwd: context.repoRoot, stdout: (text: string) => { output += text; }, stderr: (text: string) => { errors += text; }, run };
  assert.equal(coverageFromMain(['--cwd', '.', '--coverage-from=coverage/lcov.info', '--json'], io), 0);
  assert.equal(errors, '');
  assert.deepEqual(JSON.parse(output).measured, [LOGIC]);
  fs.writeFileSync(path.join(context.repoRoot, 'coverage/lcov.info'), record(LOGIC, { fn: 0 }));
  output = '';
  assert.equal(coverageFromMain(['--coverage-from', 'coverage/lcov.info'], io), 2);
  assert.match(output, /HFS_COVERAGE_BELOW/);
  assert.match(output, /unmeasured source files:/);
});

test('HFS_COVERAGE_BELOW: CLI refuses missing and duplicate flags without running the proof', () => {
  let errors = '';
  const io = { stderr: (text: string) => { errors += text; }, run: () => assert.fail('invalid CLI must not run') };
  for (const argv of [[], ['--coverage-from'], ['--coverage-from=x', '--coverage-from=y'], ['--coverage-from=x', '--unknown']]) {
    assert.equal(coverageFromMain(argv, io), 2);
  }
  assert.match(errors, /needs a value/);
  assert.match(errors, /may be given only once/);
  assert.match(errors, /unknown argument/);
});

test('HFS_COVERAGE_BELOW: an explicit coverage proof refuses an fe side instead of reporting an empty pass', (t) => {
  const app = fixture(t, 'lite', record(LOGIC));
  const context = { ...app, repo: app.repo.sides!.fe, files: [] };
  assert.throws(() => coverageFrom(context), /requires an app root or its be side/);
  let output = '';
  let errors = '';
  const io = {
    stdout: (text: string) => { output += text; }, stderr: (text: string) => { errors += text; },
    run: (options: CoverageFromOptions) => coverageFrom({ ...context, ...options }),
  };
  assert.equal(coverageFromMain(['--coverage-from', 'missing-lcov.info'], io), 2);
  assert.equal(output, '');
  assert.match(errors, /requires an app root or its be side/);
});

test('HFS_COVERAGE_BELOW measures the logic of the root packages at the app root, named from the jest root in the lcov, and refuses one below the floor', (t) => {
  const PACKAGE_LOGIC = 'packages/sdk/src/registry.ts';
  // No folder name of a package is unmeasured: a plain .ts file beside a view is logic like any other.
  const PACKAGE_VIEW = 'packages/sdk/src/views/view.ts';
  const files = [LOGIC, PACKAGE_LOGIC, 'packages/sdk/package.json', 'packages/sdk/src/index.ts', 'packages/sdk/src/registry.spec.ts', PACKAGE_VIEW, 'packages/sdk/src/views/View.tsx',
    'packages/modules/package.json', 'packages/modules/src/index.ts', 'packages/notes/README.md'];
  const covered = fixture(t, 'lite', `${record('src/modules/domain/orders/orders.service.ts')}${record('../packages/sdk/src/registry.ts')}${record('../packages/sdk/src/views/view.ts')}`, files);
  const report = coverageBelowReport(covered);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.measured, [LOGIC, PACKAGE_LOGIC, PACKAGE_VIEW]);
  assert.ok(report.unmeasured.includes('packages/sdk/src/index.ts'));
  assert.ok(report.unmeasuredScopes.includes('packages/sdk/src/**/index.ts'));
  assert.deepEqual(report.unmeasuredScopes.filter((glob: string) => glob.startsWith('packages/sdk/')), ['packages/sdk/src/**/index.ts', 'packages/sdk/src/**/*.types.ts', 'packages/sdk/src/**/*-types.ts'], 'no folder of a package is unmeasured by name');
  assert.ok(report.unmeasured.includes('packages/modules/src/index.ts'), 'packages/modules is a root package like any other');
  const missing = coverageBelowReport(fixture(t, 'lite', record('src/modules/domain/orders/orders.service.ts'), files));
  assert.deepEqual(missing.findings.map((finding: Finding) => finding.path), [PACKAGE_LOGIC, PACKAGE_VIEW]);
  assert.match(missing.findings[0].message, /no lcov source record/);
  const partial = coverageBelowReport(fixture(t, 'full', `${record('src/modules/domain/orders/orders.service.ts')}${record('../packages/sdk/src/registry.ts', { branch: 0 })}${record('../packages/sdk/src/views/view.ts')}`, files));
  assert.deepEqual(partial.findings.map((finding: Finding) => finding.path), [PACKAGE_LOGIC]);
});

test('HFS_COVERAGE_BELOW leaves a root package\'s type modules out of the unit run, and refuses a type module that holds runtime code', (t) => {
  const PACKAGE_LOGIC = 'packages/sdk/src/registry.ts';
  const TYPES = ['packages/sdk/src/node/node.types.ts', 'packages/ui-kit/src/blocks/schema-types.ts', 'packages/ui-kit/src/views/views.types.ts'];
  const RUNTIME_TYPES = 'packages/sdk/src/template/format.types.ts';
  const files = [LOGIC, PACKAGE_LOGIC, 'packages/sdk/package.json', 'packages/ui-kit/package.json', 'packages/ui-kit/src/blocks/card-grid.block.ts', ...TYPES, RUNTIME_TYPES];
  const lcov = `${record('src/modules/domain/orders/orders.service.ts')}${record('../packages/sdk/src/registry.ts')}${record('../packages/ui-kit/src/blocks/card-grid.block.ts')}`;
  const context = fixture(t, 'lite', lcov, files);
  const typeOnly = [
    'import type { z } from "zod"',
    'import type { BadgeTone } from "@starci/grammar/common" with { "resolution-mode": "import" }',
    'export type { Other } from "./other"',
    '/** A row. */',
    'export interface Row { readonly id: string }',
    'export type Rows = ReadonlyArray<Row>',
    'declare const brand: unique symbol',
    '',
  ].join('\n');
  for (const file of TYPES) fs.writeFileSync(path.join(context.repoRoot, file), typeOnly);
  fs.writeFileSync(path.join(context.repoRoot, RUNTIME_TYPES), 'export interface Format { readonly width: number }\nexport const MAX_PARAMETERS = 20\n');
  const report = coverageBelowReport(context);
  assert.deepEqual(report.measured, [LOGIC, 'packages/sdk/src/registry.ts', 'packages/ui-kit/src/blocks/card-grid.block.ts']);
  for (const file of [...TYPES, RUNTIME_TYPES]) assert.ok(report.unmeasured.includes(file), file);
  for (const glob of ['packages/ui-kit/src/**/*.types.ts', 'packages/ui-kit/src/**/*-types.ts']) assert.ok(report.unmeasuredScopes.includes(glob), glob);
  assert.deepEqual(report.findings.map((finding: Finding) => finding.path), [RUNTIME_TYPES], 'only the type module that runs code is refused');
  assert.match(report.findings[0].message, /holds runtime code \(`export const MAX_PARAMETERS = 20`\)/u);
  fs.writeFileSync(path.join(context.repoRoot, RUNTIME_TYPES), 'import { helper } from "./helper"\nexport type Format = ReturnType<typeof helper>\n');
  assert.match(coverageBelowReport(context).findings[0]?.message ?? '', /holds runtime code \(`import \{ helper \} from "\.\/helper"`\)/u, 'a value import is emitted, so it is runtime code');
});
