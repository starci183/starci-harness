// proves: HFS_PACKAGE_SLOT_UNPLACED@lite
// proves: HFS_PACKAGE_SLOT_UNPLACED@full
// Package-declared inner slots (PROJECT-LINT-3, R382): a root workspace package declares packages/<name>/slots.yaml and hfs holds its tree to it as it
// holds the be and fe sides; its coverage follows the slots, every file measured at 100 per file but its barrels, its type files and the slots that opt
// out with a reason.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PACKAGE_SLOTS_INVALID, PACKAGE_SLOT_DISALLOWED, PACKAGE_SLOT_MISSING, PACKAGE_SLOT_UNPLACED, packageSlotProblems, readPackageSlots, unmeasuredGlobs } from '../runtime/scripts/hfs/package-slots.mjs';
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
  assert.deepEqual(packageSlotProblems('packages/blocks-core', manifest, TREE).map((problem) => [problem.code, problem.path]).sort(), [
    [PACKAGE_SLOT_DISALLOWED, 'packages/blocks-core/src/blocks/list/notes.md'],
    [PACKAGE_SLOT_MISSING, 'packages/blocks-core/src/blocks/list/renderer.tsx'],
    [PACKAGE_SLOT_UNPLACED, 'packages/blocks-core/src/stray.ts'],
  ]);
  assert.match(packageSlotProblems('packages/blocks-core', manifest, TREE).find((problem) => problem.code === PACKAGE_SLOT_MISSING)?.message ?? '',
    /packages\/blocks-core\/src\/blocks\/list\/ is a block of packages\/blocks-core\/slots\.yaml and lacks renderer\.tsx \(requires schema\.ts, renderer\.tsx, <id>\.spec\.ts\) \(R382\)/u);
  const open = readPackageSlots(MANIFEST.replace('slots:\n', 'closed: false\nslots:\n'));
  assert.ok(!packageSlotProblems('packages/blocks-core', open, TREE).some((problem) => problem.code === PACKAGE_SLOT_UNPLACED), 'closed: false leaves unplaced files alone');
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
  const read = (file: string): string | null => (file === 'packages/blocks-core/slots.yaml' ? MANIFEST : null);
  const scope = packagesCoverage(['packages/blocks-core', 'packages/agent-sdk'], declaredPackageScopes(read));
  const measured = packageMeasuredBy(scope);
  assert.equal(measured('packages/blocks-core/src/blocks/card/schema.ts'), true);
  assert.equal(measured('packages/blocks-core/src/workbench/view.ts'), false, 'the opted-out slot');
  assert.equal(measured('packages/blocks-core/src/index.ts'), false, 'a barrel');
  assert.equal(measured('packages/blocks-core/src/client/api.ts'), true, 'a manifest replaces the default exclusions: client/ is measured unless a slot opts out');
  assert.equal(measured('packages/agent-sdk/src/client/api.ts'), false, 'a package without a manifest keeps the default scope');
  const broken = packagesCoverage(['packages/blocks-core'], declaredPackageScopes(() => 'schema: nope\n'));
  assert.equal(packageMeasuredBy(broken)('packages/blocks-core/src/client/api.ts'), false, 'an unreadable manifest sets no scope (its finding is R382)');
});

function app(t: TestContext): { root: string; files: string[] } {
  const root = mkdtemp(t, 'starci-package-slots-');
  const files = TREE.map((file) => `packages/blocks-core/${file}`);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file.endsWith('slots.yaml') ? MANIFEST : 'export {}\n');
  }
  return { root, files: [...files, 'packages/agent-sdk/package.json', 'packages/agent-sdk/src/index.ts', 'packages/agent-sdk/src/anything.ts'] };
}

for (const edition of ['lite', 'full']) {
  test(`${edition}: the app check judges every root package that declares slots.yaml, and leaves one without alone`, (t) => {
    const { root, files } = app(t);
    const found = packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: true });
    assert.deepEqual(found.map((finding) => finding.code).sort(), [PACKAGE_SLOT_DISALLOWED, PACKAGE_SLOT_MISSING, PACKAGE_SLOT_UNPLACED]);
    assert.ok(found.every((finding) => finding.path.startsWith('packages/blocks-core/')), 'agent-sdk declares no manifest');
    assert.deepEqual(packageSlotFindings({ repoRoot: root, files, repo: { kind: 'app', profile: 'app', edition }, isRoot: false }), []);
  });
}
