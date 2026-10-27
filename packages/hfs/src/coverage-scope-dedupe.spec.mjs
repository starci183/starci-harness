// The sonar.coverage.exclusions (and the Codecov ignores rendered from them) never repeat what a broader glob already excludes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';
import { coverageScope, withoutCovered } from '../runtime/scripts/hfs/coverage-scope.mjs';

test('an entry that another glob already matches is not emitted, an uncovered one is', () => {
  assert.deepEqual(withoutCovered(['be/src/modules/platform/*/index.ts', 'be/src/modules/platform/logging/index.ts']), ['be/src/modules/platform/*/index.ts']);
  assert.deepEqual(withoutCovered(['be/src/modules/platform/*/index.ts', 'be/src/modules/domain/orders/index.ts']), ['be/src/modules/platform/*/index.ts', 'be/src/modules/domain/orders/index.ts']);
  assert.deepEqual(withoutCovered(['be/src/**', 'be/src/modules/a/b.ts', 'fe/**']), ['be/src/**', 'fe/**']);
});

test('a single-segment star never covers a deeper path or a double star', () => {
  assert.deepEqual(withoutCovered(['be/*/index.ts', 'be/a/b/index.ts']), ['be/*/index.ts', 'be/a/b/index.ts']);
  assert.deepEqual(withoutCovered(['be/*/index.ts', 'be/**/index.ts']), ['be/**/index.ts']);
  assert.deepEqual(withoutCovered(['be/a*/index.ts', 'be/b/index.ts']), ['be/a*/index.ts', 'be/b/index.ts']);
  assert.deepEqual(withoutCovered(['be/a*/index.ts', 'be/abc/index.ts']), ['be/a*/index.ts']);
  assert.deepEqual(withoutCovered(['be/a*c/x.ts', 'be/ac/x.ts', 'be/abbc/x.ts', 'be/abd/x.ts']), ['be/a*c/x.ts', 'be/abd/x.ts']);
});

test('the real manifest emits the platform barrel glob and no pattern barrel it already covers', () => {
  const { sonar } = coverageScope(loadSlotManifest(), []);
  assert.ok(sonar.includes('be/src/modules/platform/*/index.ts'));
  for (const pattern of ['event-bus', 'jobs', 'logging', 'queue']) assert.equal(sonar.includes(`be/src/modules/platform/${pattern}/index.ts`), false);
  assert.equal(sonar.length, new Set(sonar).size);
});
