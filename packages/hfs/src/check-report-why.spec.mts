// The catalog explanation of a finding: every code the Sonar scan emits has an entry, and a code with none is a named internal error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skillRoot } from '../runtime/engine/runtime-root.mjs';
import { readWhy } from '../runtime/scripts/hfs/check.mjs';
import { withWhy } from '../runtime/scripts/hfs/check-results.mjs';
import { GATE_FAILED, SCAN_FAILED, SCAN_SKIPPED } from '../cache/sonar-scan-family.mjs';

test('every finding code of the Sonar scan, the skipped warning included, has a catalog entry that withWhy attaches', () => {
  const codes = [SCAN_SKIPPED, SCAN_FAILED, GATE_FAILED];
  const findings = withWhy(codes.map((code) => ({ code, level: 'warning' })), readWhy(skillRoot, codes));
  assert.ok(findings.every((finding) => typeof finding.title === 'string' && typeof finding.titleVi === 'string' && typeof finding.nextStepVi === 'string'));
});

test('a finding whose code was not read from the catalog is an internal error naming the code, never a TypeError', () => {
  assert.throws(() => withWhy([{ code: 'NOT_READ_CODE', level: 'error' }], {}), (error: Error) => !(error instanceof TypeError) && /NOT_READ_CODE/u.test(error.message) && /internal error/u.test(error.message));
});

test('a code the catalog does not hold is refused by name when it is read', () => {
  assert.throws(() => readWhy(skillRoot, ['NO_SUCH_CATALOG_CODE']), /NO_SUCH_CATALOG_CODE/u);
});
