/** The nivoos packages a project declares (PROJECT-BUSINESS-1, R436): `sides.nivoos.packages` in hfs.json, the slot app.nivoos-package, the tree findings and the `nivoos package check` step of `starci app check`. */
// proves: HFS_NIVOOS_PACKAGE_MISSING
// proves: HFS_NIVOOS_PACKAGE_MISSING
// proves: HFS_NIVOOS_UNDECLARED
// proves: HFS_NIVOOS_UNDECLARED
// proves: HFS_NIVOOS_PACKAGE_CHECK
// proves: HFS_NIVOOS_PACKAGE_CHECK
// proves: HFS_NIVOOS_SPEC_MISSING
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NIVOOS_PACKAGE_CHECK, declaredNivoosPackages, nivoosCli, runNivoosPackageChecks } from '../cache/nivoos-package-check.mjs';
import type { ParityRun } from '../cache/parity-family.mjs';
import { declaredPackageScopes } from '../runtime/scripts/hfs/coverage-scope.mjs';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { dependsOnNivoosSdk, nivoosPackagesOf, nivoosSideProblems } from '../runtime/scripts/hfs/nivoos-side.mjs';
import { nivoosFindings } from '../runtime/scripts/hfs/rules/nivoos.mjs';
import { coverageObligationsOff } from '../runtime/scripts/hfs/coverage-tiers.mjs';
import { serviceFindings } from '../runtime/scripts/hfs/rules/services.mjs';
import { declaredAppSides, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { declaredPackagesHfsView } from '../runtime/scripts/hfs/view.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { appSource, renderTargets, type AppSourceFacts } from '../sync/index.mjs';
import { formatFindings } from '../sync/format.mjs';
import { parseYaml } from '../runtime/engine/yaml.mjs';
import { createRequire } from 'node:module';

// reason: hfs.json declarations are JSON trees the assertions build and judge.
type Json = any;
const RUNTIME = fileURLToPath(new URL('../runtime', import.meta.url));
const manifest = loadSlotManifest();
const BE = { apps: [{ name: 'api', kind: 'api', contract: 'rest' }], kinds: ['api'] };
const NIVOOS = { packages: [{ name: 'biz' }] };
const declarationOf = (sides: Json) => ({ hfs: manifest.major, kind: 'app', project: 'demo', sides });
const declare = (sides: Json) => resolveRepoDeclaration(manifest, declarationOf(sides));

test('the declaration: sides.nivoos holds a non-empty unique list of packages with an optional entry and out, and implies the packages side', () => {
  assert.deepEqual(declarationShapeProblems(declarationOf({ be: BE, nivoos: NIVOOS }), ['be', 'fe']), []);
  assert.deepEqual(declare({ be: BE, nivoos: NIVOOS }).declaredSides, ['be', 'packages'], 'a nivoos package lives in packages/, so the packages side is declared with it');
  assert.deepEqual(declaredAppSides(declare({ be: BE, nivoos: NIVOOS })), ['be']);
  assert.deepEqual(declare({ be: BE, packages: {}, nivoos: NIVOOS }).declaredSides, ['be', 'packages'], 'beside an explicit packages side it is the same side');
  assert.deepEqual(nivoosPackagesOf({ nivoos: { packages: [{ name: 'zeta', entry: 'src/main.package.ts', out: 'dist-seed' }, { name: 'biz' }] } }), [
    { name: 'biz', entry: 'src/biz.package.ts', out: 'seed' },
    { name: 'zeta', entry: 'src/main.package.ts', out: 'dist-seed' },
  ], 'defaults applied, sorted by name');
  for (const [value, words] of [
    [{}, /non-empty list/],
    [{ packages: [] }, /non-empty list/],
    [{ packages: [{ name: 'Biz' }] }, /kebab-case folder name/],
    [{ packages: [{ name: 'biz' }, { name: 'biz' }] }, /declared twice/],
    [{ packages: [{ name: 'biz', entry: '../x.ts' }] }, /entry must be a package-relative \.ts path/],
    [{ packages: [{ name: 'biz', out: '/abs' }] }, /out must be a package-relative folder/],
    [{ packages: [{ name: 'biz', other: 1 }] }, /unknown key other/],
    [{ packages: [{ name: 'biz' }], extra: 1 }, /unknown key extra/],
    ['biz', /must be an object/],
  ] as Array<[Json, RegExp]>) assert.match(nivoosSideProblems(value).join('\n'), words);
  assert.match(declarationShapeProblems(declarationOf({ be: BE, nivoos: { packages: [] } }), ['be', 'fe']).join('\n'), /sides\.nivoos\.packages must be a non-empty list/);
  assert.match(declarationShapeProblems(declarationOf({ be: BE, nivoo: NIVOOS }), ['be', 'fe']).join('\n'), /sides\.nivoo is not a side/);
});

test('the slot: a declared package folder is app.nivoos-package and any other folder of packages/ stays app.packages', () => {
  const view = declaredPackagesHfsView({ runtimeRoot: RUNTIME, declaration: declarationOf({ be: BE, nivoos: NIVOOS }), repoRoot: '/app', side: 'be' });
  assert.equal(view.slotOf('packages/biz/src/biz.package.ts'), 'app.nivoos-package');
  assert.equal(view.slotOf('packages/biz/seed/biz@1.0.0.json'), 'app.nivoos-package', 'the seed and every other file of the folder belong to it');
  assert.equal(view.slotOf('packages/shared/src/index.ts'), 'app.packages', 'an undeclared folder is no nivoos package');
  assert.equal(view.slot('app.nivoos-package')?.lintProfile, 'nivoos');
  assert.deepEqual(view.packageLint?.nivoos, ['packages/biz/src/**']);
  const plain = declaredPackagesHfsView({ runtimeRoot: RUNTIME, declaration: declarationOf({ be: BE, packages: {} }), repoRoot: '/app', side: 'be' });
  assert.equal(plain.slotOf('packages/biz/src/biz.package.ts'), 'app.packages', 'declared nowhere, it is a plain root package');
  assert.deepEqual(plain.packageLint?.nivoos, []);
});

test('R436 the tree: a declared package has its files, and a package that depends on the SDK is declared', (t) => {
  const repoRoot = mkdtemp(t, 'starci-nivoos-tree-');
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true }); fs.writeFileSync(path.join(repoRoot, file), text); };
  write('packages/biz/package.json', JSON.stringify({ name: '@demo/biz', devDependencies: { nivoos: 'file:../x' } }));
  write('packages/other/package.json', JSON.stringify({ name: '@demo/other', dependencies: { '@nivoos-lite/nivoos-sdk': '0.1.0' } }));
  write('packages/shared/package.json', JSON.stringify({ name: '@demo/shared', dependencies: { zod: '4.6.7' } }));
  const repo = declare({ be: BE, nivoos: NIVOOS });
  const all = ['packages/biz/package.json', 'packages/biz/tsconfig.json', 'packages/other/package.json', 'packages/shared/package.json'];
  const found = nivoosFindings({ repoRoot, files: all, repo });
  assert.deepEqual(found.map((finding) => [finding.code, finding.path]), [
    ['HFS_NIVOOS_PACKAGE_MISSING', 'packages/biz/src/biz.package.ts'],
    ['HFS_NIVOOS_UNDECLARED', 'packages/other/package.json'],
  ], 'the entry is missing, the SDK package nobody declared is refused, the shared package and the declared one are not');
  assert.match(found[1]!.message, /add \{ "name": "other" \} to sides\.nivoos\.packages/);
  assert.deepEqual(nivoosFindings({ repoRoot, files: [...all, 'packages/biz/src/biz.package.ts'].filter((file) => !file.includes('other')), repo }), []);
  assert.equal(dependsOnNivoosSdk({ devDependencies: { nivoos: '1.0.0' } }), true);
  assert.equal(dependsOnNivoosSdk({ dependencies: { '@nivoos/sdk': '1.0.0' } }), true);
  assert.equal(dependsOnNivoosSdk({ devDependencies: { '@starci/nivoos-cli': '1.0.0' } }), true);
  assert.equal(dependsOnNivoosSdk({ dependencies: { '@starci/nivoos-sdk': '1.0.0' } }), true);
  assert.equal(dependsOnNivoosSdk({ dependencies: { zod: '1.0.0' } }), false);
});

test('R436 publishes: the published packages of the platform and the SDK itself are no business package', (t) => {
  const repoRoot = mkdtemp(t, 'starci-nivoos-publishes-');
  const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true }); fs.writeFileSync(path.join(repoRoot, file), text); };
  write('packages/nivoos-sdk/package.json', JSON.stringify({ name: '@starci/nivoos-sdk', dependencies: { '@nivoos/sdk': '1.0.0' } }));
  write('packages/nivoos-cli/package.json', JSON.stringify({ name: '@nivoos-lite/nivoos-cli', dependencies: { '@nivoos-lite/nivoos-sdk': '0.1.0' } }));
  write('packages/provider-templates/package.json', JSON.stringify({ name: '@nivoos-lite/provider-templates', dependencies: { '@nivoos-lite/nivoos-sdk': '0.1.0' } }));
  write('packages/biz/package.json', JSON.stringify({ name: '@demo/biz', dependencies: { '@nivoos-lite/nivoos-sdk': '0.1.0' } }));
  const files = ['packages/nivoos-sdk/package.json', 'packages/nivoos-cli/package.json', 'packages/provider-templates/package.json', 'packages/biz/package.json'];
  const withPublishes = resolveRepoDeclaration(manifest, { ...declarationOf({ be: BE }), publishes: ['packages/nivoos-sdk', 'packages/nivoos-cli', 'packages/provider-templates'] });
  assert.deepEqual(nivoosFindings({ repoRoot, files, repo: withPublishes }).map((finding) => finding.path), ['packages/biz/package.json'], 'only the unlisted business package is refused');
  const without = declare({ be: BE });
  assert.deepEqual(nivoosFindings({ repoRoot, files, repo: without }).map((finding) => finding.path), ['packages/nivoos-cli/package.json', 'packages/provider-templates/package.json', 'packages/biz/package.json'], 'without publishes the CLI and the catalogue are refused, the SDK package never is');
});

test('a declared package at packages/<name>/ is no service root, while the same manifest at the app root is still refused', () => {
  const repo = declare({ be: BE, nivoos: NIVOOS });
  const placed = (files: string[]) => serviceFindings({ repoRoot: '/nowhere', files, repo }).filter((finding) => finding.code === 'HFS_SERVICE_PLACEMENT').map((finding) => finding.path);
  assert.deepEqual(placed(['packages/biz/package.json', 'packages/biz/src/biz.package.ts']), [], 'a package of packages/ is a workspace package, declared or not');
  assert.deepEqual(placed(['biz/package.json']), ['biz/package.json'], 'a folder of the app root with a manifest is a service root, declared or not');
});

test('the coverage: a declared package is measured but its barrels and type modules (owner 2026-11-25), a plain package keeps the barrel and type rules', () => {
  const read = (file: string): string | null => (file === 'hfs.json' ? JSON.stringify(declarationOf({ be: BE, nivoos: NIVOOS })) : null);
  const scopes = declaredPackageScopes(read);
  assert.deepEqual(scopes('packages/biz'), ['src/**/index.ts', 'src/**/*.types.ts', 'src/**/*-types.ts']);
  assert.equal(scopes('packages/shared'), null);
});

test('HFS_NIVOOS_SPEC_MISSING: every cell and flow of a declared package has its spec beside it; other files and undeclared packages need none', (t) => {
  const repoRoot = mkdtemp(t, 'starci-nivoos-specs-');
  const repo = declare({ be: BE, nivoos: NIVOOS });
  const base = ['packages/biz/package.json', 'packages/biz/tsconfig.json', 'packages/biz/src/biz.package.ts'];
  const tree = [...base,
    'packages/biz/src/booking/book-lead.cell.ts', 'packages/biz/src/booking/book-lead.cell.spec.ts',
    'packages/biz/src/booking/tell-booking.cell.ts',
    'packages/biz/src/booking/reminder/reminder.workflow.ts', 'packages/biz/src/booking/reminder/reminder.flow.spec.ts',
    'packages/biz/src/leads/capture.workflow.ts', 'packages/biz/src/leads/capture.workflow.spec.ts',
    'packages/biz/src/report/week.workflow.ts', 'packages/biz/src/report/other/week.flow.spec.ts',
    'packages/biz/src/booking/booking-made.event.ts', 'packages/biz/src/booking/steps/send.step.ts',
    'packages/shared/src/x.cell.ts'];
  const found = nivoosFindings({ repoRoot, files: tree, repo });
  assert.deepEqual(found.map((finding) => [finding.code, finding.path]), [
    ['HFS_NIVOOS_SPEC_MISSING', 'packages/biz/src/booking/tell-booking.cell.ts'],
    ['HFS_NIVOOS_SPEC_MISSING', 'packages/biz/src/report/week.workflow.ts'],
  ], 'a cell without its .cell.spec.ts and a flow whose spec is in another folder are findings; a step, an event and an undeclared package are not');
  assert.match(found[0]!.message, /add packages\/biz\/src\/booking\/tell-booking\.cell\.spec\.ts/);
  assert.match(found[1]!.message, /a flow of the business package biz/);
  // A spec per cell and flow is a test obligation: an app that declares its test (or coverage) gate off is not judged for it (PROJECT-LINT-4).
  for (const gates of ['gates:\n  test: {run: off, reason: "specs after the release"}\n  coverage: {run: off, reason: "reads the unit run"}\n  codecov: {run: off, reason: "reads the coverage"}\n  sonar: {run: off, reason: "reads the coverage"}\n',
    'gates:\n  coverage: {run: off, reason: "coverage after the release"}\n  codecov: {run: off, reason: "reads the coverage"}\n']) {
    fs.mkdirSync(path.join(repoRoot, '.starcistacks'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.starcistacks/application-stacks.yaml'), gates);
    assert.deepEqual(nivoosFindings({ repoRoot, files: tree, repo }).filter((finding) => finding.code === 'HFS_NIVOOS_SPEC_MISSING'), [], 'declared off: no HFS_NIVOOS_SPEC_MISSING');
    assert.equal(coverageObligationsOff(repoRoot)?.endsWith(')'), true);
    assert.match(coverageObligationsOff(repoRoot) ?? '', /^(test|coverage): off \(declared: /);
  }
  fs.rmSync(path.join(repoRoot, '.starcistacks'), { recursive: true, force: true });
  assert.equal(nivoosFindings({ repoRoot, files: tree, repo }).length, 2, 'the gates back on: the findings are back');
});

/** An app root holding `files` (app-relative path -> text), hfs.json declaring the package `biz`. */
function appWith(t: TestContext, files: Record<string, string>): string {
  const root = mkdtemp(t, 'starci-nivoos-check-');
  const all = { 'hfs.json': JSON.stringify(declarationOf({ be: BE, nivoos: { packages: [{ name: 'biz', entry: 'src/biz.package.ts', out: 'seed' }] } })), ...files };
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** The installed nivoos CLI a package holds: its manifest names the bin, and the bin is the script `script` prints and exits with. */
const cliFiles = (script: string): Record<string, string> => ({
  'packages/biz/node_modules/nivoos/package.json': JSON.stringify({ name: 'nivoos', bin: { nivoos: './main.js' } }),
  'packages/biz/node_modules/nivoos/main.js': script,
});

/** The parity port as a plain child: what the governed one runs, and every argv it was asked for. */
function recordingRun(): { run: ParityRun; asked: { label: string; argv: readonly string[]; cwd: string; kind: string }[] } {
  const asked: { label: string; argv: readonly string[]; cwd: string; kind: string }[] = [];
  const run: ParityRun = async ({ kind, label, cwd, argv, env }) => {
    asked.push({ kind, label, cwd, argv });
    const [command = '', ...args] = argv;
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { run, asked };
}

test('the check step runs `nivoos package check <entry> --out <out>` from the package folder with this Node: exit 0 is one green line', async (t) => {
  const root = appWith(t, cliFiles("process.stdout.write('(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: noise\\n');\nprocess.stdout.write('nivoos package check: the committed seed and secrets template are current\\n');\n"));
  assert.deepEqual(declaredNivoosPackages(root), [{ name: 'biz', entry: 'src/biz.package.ts', out: 'seed' }]);
  const { run, asked } = recordingRun();
  const result = await runNivoosPackageChecks({ repoRoot: root, run, env: process.env });
  assert.deepEqual(asked.map((call) => [call.kind, call.label, [path.basename(call.argv[1] ?? ''), ...call.argv.slice(2)], path.resolve(call.cwd)]), [
    ['build', 'app check nivoos package check biz', ['main.js', 'package', 'check', 'src/biz.package.ts', '--out', 'seed'], path.resolve(root, 'packages/biz')],
  ]);
  assert.equal(asked[0]?.argv[0], process.execPath);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.lines, ['  nivoos package check biz: green (exit 0): nivoos package check: the committed seed and secrets template are current']);
});

test('HFS_NIVOOS_PACKAGE_CHECK: a red check names the package, its exit and the output without the Node warnings', async (t) => {
  const root = appWith(t, cliFiles("process.stdout.write('(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: noise\\n');\nprocess.stderr.write('seed/biz@1.0.0.json: differs at character 783\\n');\nprocess.exit(1);\n"));
  const { run } = recordingRun();
  const result = await runNivoosPackageChecks({ repoRoot: root, run, env: process.env });
  assert.deepEqual(result.findings.map((finding) => [finding.code, finding.level, finding.path]), [[NIVOOS_PACKAGE_CHECK, 'error', 'packages/biz/src/biz.package.ts']]);
  assert.match(String(result.findings[0]?.message), /nivoos package check biz failed \(exit 1\)/);
  assert.match(String(result.findings[0]?.message), /differs at character 783/);
  assert.doesNotMatch(String(result.findings[0]?.message), /MODULE_TYPELESS/);
  assert.deepEqual(result.lines, ['  nivoos package check biz: red (exit 1)']);
});

test('HFS_NIVOOS_PACKAGE_CHECK: without the nivoos CLI nothing runs and the finding says how to add it', async (t) => {
  const root = appWith(t, {});
  assert.equal(nivoosCli(root, 'biz'), null);
  const { run, asked } = recordingRun();
  const result = await runNivoosPackageChecks({ repoRoot: root, run, env: process.env });
  assert.deepEqual(asked, [], 'a package whose CLI is missing is never run');
  assert.deepEqual(result.findings.map((finding) => [finding.code, finding.path]), [[NIVOOS_PACKAGE_CHECK, 'packages/biz/package.json']]);
  assert.match(String(result.findings[0]?.message), /add "@starci\/nivoos-cli" to the devDependencies of packages\/biz\/package\.json/);
  assert.deepEqual(result.lines, ['  nivoos package check biz: red, the nivoos CLI is not installed']);
  const rootOnly = appWith(t, { 'node_modules/nivoos/package.json': JSON.stringify({ name: 'nivoos', bin: 'cli.js' }), 'node_modules/nivoos/cli.js': 'process.exit(0);\n' });
  assert.ok(nivoosCli(rootOnly, 'biz')?.endsWith('cli.js'), 'the CLI of the app root serves a package that holds none');
  const scoped = appWith(t, { 'node_modules/@starci/nivoos-cli/package.json': JSON.stringify({ name: '@starci/nivoos-cli', bin: { nivoos: 'dist/main.js' } }), 'node_modules/@starci/nivoos-cli/dist/main.js': 'process.exit(0);\n' });
  assert.ok(nivoosCli(scoped, 'biz')?.endsWith('main.js'), 'the published CLI @starci/nivoos-cli provides the nivoos bin');
});

const WORKBENCH = { 'packages/biz/workbench/sales/package.json': JSON.stringify({ name: 'sales', dependencies: { vite: '1.0.0' } }), 'packages/biz/workbench/sales/package-lock.json': '{}' };
const STAMP = 'packages/biz/workbench/sales/node_modules/.package-lock.json';

test('a workbench without node_modules is installed before the package is judged, and a failed install is no verdict and nothing is recorded', async (t) => {
  const root = appWith(t, { ...cliFiles('process.exit(0);\n'), ...WORKBENCH });
  const calls: string[] = [];
  const installing: ParityRun = async ({ kind, label, cwd, argv }) => {
    calls.push(`${kind}:${label}`);
    if (kind === 'install') { fs.mkdirSync(path.join(cwd, 'node_modules'), { recursive: true }); fs.writeFileSync(path.join(root, STAMP), '{}'); return { status: 0, stdout: '', stderr: '' }; }
    return { status: 0, stdout: argv.join(' '), stderr: '' };
  };
  const ok = await runNivoosPackageChecks({ repoRoot: root, run: installing, env: process.env });
  assert.deepEqual(calls, ['install:app check workbench install packages/biz/workbench/sales', 'build:app check nivoos package check biz'], 'the install comes first');
  assert.deepEqual(ok.findings, []);
  calls.length = 0;
  await runNivoosPackageChecks({ repoRoot: root, run: installing, env: process.env });
  assert.deepEqual(calls, ['build:app check nivoos package check biz'], 'an installed workbench is not installed again');
  const broken = appWith(t, { ...cliFiles('process.exit(0);\n'), ...WORKBENCH });
  const failing: ParityRun = async ({ kind }) => { calls.push(kind); return { status: 1, stdout: '', stderr: 'ENOTFOUND' }; };
  calls.length = 0;
  const red = await runNivoosPackageChecks({ repoRoot: broken, run: failing, env: process.env });
  assert.deepEqual(calls, ['install'], 'a failed install stops the package from being judged');
  assert.match(String(red.findings[0]?.message), /could not be installed.*not judged/s);
  assert.deepEqual(red.lines, ['  nivoos package check biz: red, the workbench install failed (not judged, not recorded)']);
});

test('an app that declares no nivoos package runs no check', async (t) => {
  const root = mkdtemp(t, 'starci-nivoos-none-');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declarationOf({ be: BE })));
  const { run, asked } = recordingRun();
  assert.deepEqual(await runNivoosPackageChecks({ repoRoot: root, run, env: process.env }), { findings: [], lines: [] });
  assert.deepEqual(asked, []);
});

// ---------------------------------------------------------------------------------------------------- sync and format

const PRESETS = { sonarExclusions: '**/*.spec.ts' };
const STACK = { images: [], passEnv: [], imageEnvironments: {}, environments: [], imageCache: 'gha' };
/** The root files sync renders for an app declaring the nivoos package `biz` (seed folder `out`) over source facts that list the folders `rootPackages`. */
const rendered = (rootPackages: string[], out?: string, rootPackageSpecs?: string[]) => {
  const sides = { be: BE, nivoos: { packages: [{ name: 'biz', ...(out === undefined ? {} : { out }) }] } };
  const source = { files: [], read: () => '', rootPackages, ...(rootPackageSpecs === undefined ? {} : { rootPackageSpecs }), packageScopes: {}, stack: STACK, hasImage: () => true } as unknown as AppSourceFacts;
  const targets = renderTargets(declarationOf(sides), PRESETS, { source });
  return (file: string): string => targets.find((target) => target.path === file)?.content ?? '';
};

test('sync: a declared package is measured at the business bar (jest packages, a Codecov path and the tier-business component), but is no Sonar source, tsconfig, build:modules or dev watch entry', () => {
  const render = rendered(['biz', 'shared']);
  for (const file of ['sonar-project.properties', 'package.json']) {
    const text = render(file);
    assert.ok(text.length > 0, `${file} is rendered`);
    assert.equal(text.includes('packages/biz'), false, `${file} names no declared package`);
  }
  assert.match(render('sonar-project.properties'), /^sonar\.sources=be\/apps,be\/src,packages\/shared\/src$/m);
  const jest = render('be/jest.config.js');
  assert.ok(jest.includes('"packages/biz/src/**/*.ts"') && jest.includes('"packages/shared/src/**/*.ts"'), 'both packages are measured by the unit run');
  const codecov = parseYaml(render('codecov.yml'));
  assert.ok(codecov.coverage.status.patch.default.paths.includes('packages/biz/src/**'));
  const components: { component_id: string; paths: string[]; statuses?: { type: string; target: string }[] }[] = codecov.component_management.individual_components;
  assert.equal(components.some((component) => component.component_id === 'package-biz'), false, 'no library component of it');
  const business = components.find((component) => component.component_id === 'tier-business');
  assert.deepEqual(business?.paths, ['packages/biz/src/**']);
  assert.deepEqual(business?.statuses?.map((status) => `${status.type} ${status.target}`), ['project 60%', 'patch 80%']);
  assert.ok(components.some((component) => component.component_id === 'package-shared'), 'the library package keeps its component');
});

test('sync: a declared package is a measured folder of the unit run whether or not it holds specs, so it is never a spec-only tests entry', () => {
  const plain = rendered(['biz', 'shared'])('be/jest.config.js');
  assert.equal(rendered(['biz', 'shared'], undefined, ['biz', 'shared'])('be/jest.config.js'), plain, 'its specs add nothing: it is already a measured folder');
  assert.equal(plain.includes('tests:'), false);
  const only = rendered(['biz'])('be/jest.config.js');
  assert.ok(only.includes('        folders: ["packages/biz"],'), 'a project whose only package is a declared one still measures it');
  for (const file of ['codecov.yml', 'sonar-project.properties', 'package.json']) assert.equal(rendered(['biz', 'shared'], undefined, ['biz', 'shared'])(file), rendered(['biz', 'shared'])(file), `${file} is the same: the specs add no coverage scope`);
});

test('sync: appSource lists the root packages that hold a spec', (t) => {
  const root = mkdtemp(t, 'starci-package-specs-');
  const put = (file: string): void => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), '{}'); };
  for (const name of ['with', 'nested', 'bare', 'built']) put(`packages/${name}/package.json`);
  put('packages/with/src/a.spec.ts'); put('packages/nested/src/deep/er/b.spec.ts'); put('packages/bare/src/c.ts'); put('packages/built/src/dist/d.spec.ts');
  const facts = appSource(root);
  assert.deepEqual(facts.rootPackages, ['bare', 'built', 'nested', 'with']);
  assert.deepEqual(facts.rootPackageSpecs, ['nested', 'with']);
});

test('sync: a project whose only package is a declared one has no library scope, yet its root eslint config still lints the package', () => {
  const render = rendered(['biz']);
  assert.equal(render('package.json').includes('build:modules'), false);
  assert.equal(render('sonar-project.properties').includes('packages/biz'), false);
  assert.ok(render('eslint.config.mjs').includes('starciBePackagesConfig'), 'the lint config reaches the package');
});

test('sync: the seed folder of each declared package is in the managed .prettierignore (out defaults to seed, a custom out is normalised); an app declaring none gains no line', () => {
  assert.match(rendered(['biz'])('.prettierignore'), /^packages\/biz\/seed\/$/m);
  assert.match(rendered(['biz'], './build/seed/')('.prettierignore'), /^packages\/biz\/build\/seed\/$/m);
  const source = { files: [], read: () => '' } as unknown as AppSourceFacts;
  const plain = renderTargets(declarationOf({ be: BE }), PRESETS, { source }).find((target) => target.path === '.prettierignore')?.content ?? '';
  assert.equal(plain.includes('packages/'), false);
  assert.ok(plain.endsWith('**/i18n/messages/**\n'));
});

test('format: the format gate reformats the raw seed the nivoos build wrote, until the rendered .prettierignore lists its folder', async (t) => {
  const root = mkdtemp(t, 'starci-nivoos-format-');
  const seed = 'packages/biz/seed/biz@1.0.0.json';
  fs.mkdirSync(path.join(root, 'packages/biz/seed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.dirname(createRequire(import.meta.url).resolve('prettier/package.json')), path.join(root, 'node_modules/prettier'), 'junction');
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
  fs.writeFileSync(path.join(root, seed), '{"package":{"key":"biz"},"cells":[ ]}\n');
  assert.equal((await formatFindings({ repoRoot: root, files: [seed] })).length, 1, 'unignored, the raw seed is a finding');
  fs.writeFileSync(path.join(root, '.prettierignore'), rendered(['biz'])('.prettierignore'));
  assert.deepEqual(await formatFindings({ repoRoot: root, files: [seed] }), [], 'ignored by the managed file');
});
