// proves: HFS_PACKAGE_SLOT_UNPLACED@lite
// proves: HFS_PACKAGE_SLOT_UNPLACED@full
// proves: HFS_PACKAGE_SLOTS_MOVED@lite
// proves: HFS_PACKAGE_SLOTS_MOVED@full
// A package's inner slots (PROJECT-LINT-3, R382): the project declares them in ext/manifest.json (packages, by folder) and hfs holds the package's tree to
// them as it holds the be and fe sides; a package's own slots.yaml is the read path of one more minor; its coverage follows the slots, every file measured at 100 per file but its barrels, its type files and the slots that opt
// out with a reason.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_SLOTS_INVALID, PACKAGE_SLOTS_MOVED, PACKAGE_SLOT_DISALLOWED, PACKAGE_SLOT_MISSING, PACKAGE_SLOT_UNPLACED, frontEndGlobs, judgePackageSlots, packageSlotProblems, readPackageSlots, unmeasuredGlobs } from '../runtime/scripts/hfs/package-slots.mjs';
import { packageSlotFindings } from '../runtime/scripts/hfs/rules/app-extension-findings.mjs';
import { declaredPackageScopes, packageMeasuredBy, packagesCoverage } from '../runtime/scripts/hfs/coverage-scope.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const MANIFEST = `schema: starci/package-slots@1
slots:
  - id: block
    path: src/blocks/<id>/
    requires: [schema.ts, renderer.tsx, <id>.spec.ts]
    allows: ['*.ts', '*.tsx']
  - id: workbench
    path: src/workbench/**
    coverage: { none: "front-end views of the workbench, proven by the front end's own gates" }
  - { id: barrel, path: src/index.ts }
`;

const TREE = [
  'package.json', 'slots.yaml', 'src/index.ts',
  'src/blocks/card/schema.ts', 'src/blocks/card/renderer.tsx', 'src/blocks/card/card.spec.ts',
  'src/blocks/list/schema.ts', 'src/blocks/list/list.spec.ts', 'src/blocks/list/notes.md',
  'src/workbench/view.tsx', 'src/stray.ts',
];

test('a package slot manifest is enforced like the side slots: a missing required file, a disallowed file and a file of no slot are findings', () => {
  const manifest = readPackageSlots(MANIFEST);
  assert.deepEqual(manifest.problems, []);
  assert.deepEqual(packageSlotProblems('packages/ui-kit', manifest, TREE).map((problem) => [problem.code, problem.path]).sort(), [
    [PACKAGE_SLOT_DISALLOWED, 'packages/ui-kit/src/blocks/list/notes.md'],
    [PACKAGE_SLOT_MISSING, 'packages/ui-kit/src/blocks/list/renderer.tsx'],
    [PACKAGE_SLOT_UNPLACED, 'packages/ui-kit/src/stray.ts'],
  ]);
  assert.match(packageSlotProblems('packages/ui-kit', manifest, TREE).find((problem) => problem.code === PACKAGE_SLOT_MISSING)?.message ?? '',
    /packages\/ui-kit\/src\/blocks\/list\/ is a block of packages\/ui-kit\/slots\.yaml and lacks renderer\.tsx \(requires schema\.ts, renderer\.tsx, <id>\.spec\.ts\) \(R382\)/u);
  const open = readPackageSlots(MANIFEST.replace('slots:\n', 'closed: false\nslots:\n'));
  assert.ok(!packageSlotProblems('packages/ui-kit', open, TREE).some((problem) => problem.code === PACKAGE_SLOT_UNPLACED), 'closed: false leaves unplaced files alone');
});

test(`${PACKAGE_SLOTS_INVALID}: an unreadable manifest, and a coverage opt-out without its reason, are findings`, () => {
  const cases: [string, RegExp][] = [
    ['schema: other@1\nslots: []\n', /is not a starci\/package-slots@1 manifest/u],
    ['schema: starci/package-slots@1\nslots: []\n', /declares no slot/u],
    ['schema: starci/package-slots@1\nslots:\n  - { id: x, path: lib/** }\n', /path is a package-relative path below src\//u],
    ['schema: starci/package-slots@1\nslots:\n  - { id: x, path: src/**, coverage: none }\n', /coverage is measured \(the default\) or \{ none: "<why this slot is not measured>" \}/u],
    ['schema: starci/package-slots@1\nslots:\n  - { id: x, path: src/**, coverage: { none: short } }\n', /with its reason/u],
    ['schema: starci/package-slots@1\nslots:\n  - { id: x, path: src/a.ts, requires: [b.ts] }\n', /only a folder slot \(a path ending in \/\) requires files/u],
    ['schema: starci/package-slots@1\nextra: 1\nslots:\n  - { id: x, path: src/** }\n', /has unknown key extra/u],
  ];
  for (const [text, expected] of cases) {
    const problems = packageSlotProblems('packages/p', readPackageSlots(text), ['src/a.ts']);
    assert.ok(problems.length > 0 && problems.every((problem) => problem.code === PACKAGE_SLOTS_INVALID && problem.path === 'packages/p/slots.yaml'), text);
    assert.ok(problems.some((problem) => expected.test(problem.message)), `${text}: ${problems.map((problem) => problem.message).join(' | ')}`);
  }
});

test('coverage follows the slots: a package with a manifest measures everything but its barrels, type files and opted-out slots; one without keeps the default', () => {
  const manifest = readPackageSlots(MANIFEST);
  assert.deepEqual(unmeasuredGlobs(manifest), ['src/**/index.ts', 'src/**/*.types.ts', 'src/**/*-types.ts', 'src/workbench/**']);
  const read = (file: string): string | null => (file === 'packages/ui-kit/slots.yaml' ? MANIFEST : null);
  const scope = packagesCoverage(['packages/ui-kit', 'packages/sdk'], declaredPackageScopes(read));
  const measured = packageMeasuredBy(scope);
  assert.equal(measured('packages/ui-kit/src/blocks/card/schema.ts'), true);
  assert.equal(measured('packages/ui-kit/src/workbench/view.ts'), false, 'the opted-out slot');
  assert.equal(measured('packages/ui-kit/src/index.ts'), false, 'a barrel');
  assert.equal(measured('packages/ui-kit/src/client/api.ts'), true, 'a manifest replaces the default exclusions: client/ is measured unless a slot opts out');
  assert.equal(measured('packages/sdk/src/client/api.ts'), false, 'a package without a manifest keeps the default scope');
  const broken = packagesCoverage(['packages/ui-kit'], declaredPackageScopes(() => 'schema: nope\n'));
  assert.equal(packageMeasuredBy(broken)('packages/ui-kit/src/client/api.ts'), false, 'an unreadable manifest sets no scope (its finding is R382)');
});

function app(t: TestContext): { root: string; files: string[] } {
  const root = mkdtemp(t, 'starci-package-slots-');
  const files = TREE.map((file) => `packages/ui-kit/${file}`);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file.endsWith('slots.yaml') ? MANIFEST : 'export {}\n');
  }
  return { root, files: [...files, 'packages/sdk/package.json', 'packages/sdk/src/index.ts', 'packages/sdk/src/anything.ts'] };
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: the app check judges every root package that declares slots.yaml, and leaves one without alone`, (t) => {
    const { root, files } = app(t);
    const found = packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: true });
    assert.deepEqual(found.map((finding) => finding.code).sort(), [PACKAGE_SLOTS_MOVED, PACKAGE_SLOT_DISALLOWED, PACKAGE_SLOT_MISSING, PACKAGE_SLOT_UNPLACED]);
    assert.deepEqual(found.filter((finding) => finding.code === PACKAGE_SLOTS_MOVED).map((finding) => [finding.path, finding.level]), [['packages/ui-kit/slots.yaml', 'warning']], 'the package file is still read, with a warning that it moves');
    assert.ok(found.every((finding) => finding.path.startsWith('packages/ui-kit/')), 'sdk declares no manifest');
    assert.deepEqual(packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: false }), []);
  });
}

const DECLARED = {
  slots: [
    { id: 'part', path: 'src/parts/<id>/', requires: ['schema.ts', '<id>.spec.ts'], allows: ['*.ts', '*.tsx'] },
    { id: 'views', path: 'src/views/**', lint: 'fe', coverage: { none: "front-end views, proven by the front end's own gates" } },
    { id: 'barrel', path: 'src/index.ts' },
  ],
};
const UI_TREE = ['package.json', 'src/index.ts', 'src/parts/card/schema.ts', 'src/parts/card/card.spec.ts', 'src/parts/list/schema.ts', 'src/views/page.tsx', 'src/stray.ts'];

/** An app whose ext/manifest.json declares `packages` (and no rule), with the root package packages/ui. */
function projectApp(t: TestContext, packages: unknown, extra: string[] = []): { root: string; files: string[] } {
  const root = mkdtemp(t, 'starci-project-slots-');
  const files = [...UI_TREE.map((file) => `packages/ui/${file}`), 'ext/manifest.json', ...extra];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file === 'ext/manifest.json' ? JSON.stringify({ schema: 'starci/project-ext@1', api: 1, packages }) : file.endsWith('slots.yaml') ? MANIFEST : 'export {}\n');
  }
  return { root, files };
}

test('the project declares the slots of a package in ext/manifest.json: the package is held to them, and a slot names its canon and its coverage', (t) => {
  const manifest = judgePackageSlots(DECLARED);
  assert.deepEqual(manifest.problems, []);
  assert.deepEqual(frontEndGlobs(manifest), ['src/views/**']);
  assert.deepEqual(unmeasuredGlobs(manifest), ['src/**/index.ts', 'src/**/*.types.ts', 'src/**/*-types.ts', 'src/views/**']);
  assert.ok(judgePackageSlots({ slots: [{ id: 'x', path: 'src/**', lint: 'grammar' }] }).problems.some((problem) => /lint is be \(the default\) or fe/u.test(problem)));
  const { root, files } = projectApp(t, { 'packages/ui': DECLARED });
  for (const edition of ['lite', 'full']) {
    const found = packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: true });
    assert.deepEqual(found.map((finding) => [finding.code, finding.path]).sort(), [
      [PACKAGE_SLOT_MISSING, 'packages/ui/src/parts/list/list.spec.ts'],
      [PACKAGE_SLOT_UNPLACED, 'packages/ui/src/stray.ts'],
    ]);
    assert.match(found.find((finding) => finding.code === PACKAGE_SLOT_MISSING)?.message ?? '', /is a part of ext\/manifest\.json packages\["packages\/ui"\] and lacks list\.spec\.ts/u);
  }
  const scope = packagesCoverage(['packages/ui'], declaredPackageScopes((file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } }));
  assert.equal(packageMeasuredBy(scope)('packages/ui/src/views/page.ts'), false, 'the opted-out slot of the manifest');
  assert.equal(packageMeasuredBy(scope)('packages/ui/src/parts/card/schema.ts'), true);
});

test(`${PACKAGE_SLOTS_INVALID}: a declaration the manifest cannot hold is red at the manifest: an unreadable one, a folder that is no root package, a package declared twice`, (t) => {
  const codes = (packages: unknown, extra: string[] = []): [string, string][] => {
    const { root, files } = projectApp(t, packages, extra);
    return packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition: 'lite' }, isRoot: true, inScope: () => false }).map((finding): [string, string] => [finding.code, finding.path]);
  };
  assert.deepEqual(codes({ 'packages/ui': { slots: [{ id: 'x', path: 'lib/**' }] } }), [[PACKAGE_SLOTS_INVALID, 'ext/manifest.json']]);
  assert.deepEqual(codes({ 'packages/ui': { slots: [{ id: 'all', path: 'src/**' }] }, 'packages/gone': { slots: [{ id: 'all', path: 'src/**' }] } }), [[PACKAGE_SLOTS_INVALID, 'ext/manifest.json']]);
  const { root, files } = projectApp(t, { 'packages/ui': { slots: [{ id: 'all', path: 'src/**' }] } }, ['packages/ui/slots.yaml']);
  assert.deepEqual(packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition: 'lite' }, isRoot: true }).map((finding) => [finding.code, finding.path, finding.level]), [[PACKAGE_SLOTS_INVALID, 'packages/ui/slots.yaml', 'error']]);
});
