// proves: FE_ERROR_BOUNDARY_MISSING@lite
// proves: FE_ERROR_BOUNDARY_MISSING@full
// proves: FE_SUSPENSE_NULL_FALLBACK@lite
// proves: FE_SUSPENSE_NULL_FALLBACK@full
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { noNullSuspenseFallback } from './next-conventions.ts';
import { checkRequiredFiles } from '#runtime/scripts/hfs/architecture/required-files.mjs';
import { openHfs, type OpenedHfs } from '#runtime/scripts/hfs/slots.mjs';
import { canonTester } from '../fixtures/typed/tester.ts';
import { RUNTIME_ROOT as RUNTIME } from './lib/package-root.ts';

const RUNTIME_ROOT = RUNTIME;
const BOUNDARIES = [
  'apps/web/src/app/global-error.tsx',
  'apps/web/src/app/[locale]/error.tsx',
  'apps/web/src/app/[locale]/not-found.tsx',
  'apps/web/src/app/[locale]/loading.tsx',
];

function put(root: string, relative: string): void {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'export {};\n');
}

/** A repository on disk with every boundary in place, and its opened slot resolver. */
interface BoundaryFixture {
  readonly root: string;
  readonly hfs: OpenedHfs;
}

function boundaryFixture(t: TestContext, edition: 'lite' | 'full'): BoundaryFixture {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'starci-r53-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('starci-r53-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const boundary of BOUNDARIES) put(root, boundary);
  put(root, 'apps/web/src/app/[locale]/layout.tsx');
  const connections = edition === 'lite'
    ? [{ name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'supabase' }]
    : [];
  const declaration = {
    hfs: 3, kind: 'app', project: 'r53-fixture', edition,
    sides: {
      be: { apps: [{ name: 'core', kind: 'api' }], connections },
      fe: { apps: [{ name: 'web', kind: 'next' }] },
    },
  };
  const hfs = openHfs({ root: RUNTIME_ROOT, declaration, side: 'fe' });
  return { root, hfs };
}

function boundaryFindings(fixture: BoundaryFixture) {
  return checkRequiredFiles({ config: { root: fixture.root, hfs: fixture.hfs } }).violations
    .filter((finding) => finding.ruleId === 'FE_ERROR_BOUNDARY_MISSING');
}

for (const edition of ['lite', 'full'] as const) {
  test(`${edition} accepts complete boundaries and rejects each missing error or loading boundary`, (t) => {
    const fixture = boundaryFixture(t, edition);
    assert.deepEqual(boundaryFindings(fixture), []);
    for (const boundary of BOUNDARIES) {
      fs.rmSync(path.join(fixture.root, boundary));
      assert.deepEqual(boundaryFindings(fixture).map((finding) => finding.ruleId), ['FE_ERROR_BOUNDARY_MISSING']);
      assert.deepEqual(boundaryFindings(fixture).map((finding) => finding.path), [boundary]);
      put(fixture.root, boundary);
      assert.deepEqual(boundaryFindings(fixture), []);
    }
  });

  test(`${edition} accepts visible Suspense fallbacks and rejects null or absent loading states`, () => {
    const tester = canonTester(new RuleTester({
      languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    }));
    assert.doesNotThrow(() => tester.run('no-null-suspense-fallback', noNullSuspenseFallback, {
      valid: [
        { code: 'const Pending = () => <Suspense fallback={<Skeleton />}><Content /></Suspense>' },
        { code: 'const Pending = () => <React.Suspense fallback={<Skeleton />}><Content /></React.Suspense>' },
      ],
      invalid: [
        { code: 'const Pending = () => <Suspense fallback={null}><Content /></Suspense>', errors: [{ messageId: 'nullFallback' }] },
        { code: 'const Pending = () => <Suspense><Content /></Suspense>', errors: [{ messageId: 'nullFallback' }] },
        { code: 'const Pending = () => <Suspense fallback={undefined}><Content /></Suspense>', errors: [{ messageId: 'nullFallback' }] },
      ],
    }));
  });
}
