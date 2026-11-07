// proves: COVERAGE_NEW_CODE_BELOW@lite
// proves: COVERAGE_NEW_CODE_BELOW@full
// proves: LINT_NEW_CODE_FINDING@lite
// proves: LINT_NEW_CODE_FINDING@full
// New code is never loosened by a branch profile (cache/new-code.mts): the predicted new-code coverage of the lines changed since the merge-base with main must reach the minimum
// main's Sonar gate holds, and an ESLint finding on a changed line blocks; the lint half runs end to end in branch-profile.spec.mts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeSession } from '../cache/fake-session.mjs';
import { runSonarForApp } from '../cache/app-families.mjs';
import { COVERAGE_NEW_CODE, LINT_NEW_CODE, newCodeCoverageFindings, newCodeLintFinding, onChangedLine } from '../cache/new-code.mjs';
import type { CacheRecord } from '../cache/types.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-verdict.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const specRecord = (source: string, lines: number, covered: readonly number[]): CacheRecord => ({
  path: 'be/src/a.spec.ts', step: 'unit-spec', hash: 'k', findings: [],
  data: { sources: { [source]: { s: Array.from({ length: lines }, (_, i) => [i + 1, 0, i + 1, 9, covered.includes(i + 1) ? 1 : 0]), f: [], b: [] } } },
});

function predictions(t: Parameters<typeof mkdtemp>[0], covered: readonly number[], changed: readonly number[]) {
  const root = mkdtemp(t, 'starci-new-code-');
  fs.writeFileSync(path.join(root, 'sonar-project.properties'), 'sonar.projectKey=app\nsonar.sources=be/src\n');
  fs.writeFileSync(path.join(root, 'codecov.yml'), 'coverage:\n  status:\n    project:\n      default:\n        target: 90%\n    patch:\n      default:\n        target: 95%\n');
  const session = createFakeSession({});
  session.replace('test-coverage', [specRecord('be/src/a.service.ts', 6, covered)]);
  const since = { base: 'a'.repeat(40), changed: { 'be/src/a.service.ts': [...changed] }, git: () => undefined };
  return runSonarForApp(session, { repoRoot: root, since })?.predictions ?? [];
}

test('new-code coverage below the minimum main\'s Sonar gate holds is a blocking finding on a branch profile', t => {
  const below = newCodeCoverageFindings(predictions(t, [1, 2, 3], [1, 2, 3, 4]), 'dev');
  assert.equal(below.length, 1);
  assert.equal(below[0]?.['code'], COVERAGE_NEW_CODE);
  assert.match(String(below[0]?.['message']), /predicted new-code coverage is 75% \(3 of 4 coverable changed lines\), below the 100% main's Sonar gate holds it to: on dev/);
  assert.equal(below[0]?.['level'], 'error', 'a plain error, never report-only');
  assert.equal(gateVerdict(below).pass, false, 'one error makes the verdict red');
});

test('covered new code, nothing measurable and the other predictions never block', t => {
  assert.deepEqual(newCodeCoverageFindings(predictions(t, [1, 2, 3, 4], [1, 2, 3, 4]), 'dev'), [], 'every changed line covered');
  assert.deepEqual(newCodeCoverageFindings(predictions(t, [], [9, 10]), 'dev'), [], 'no changed line is instrumented: not measurable');
  const all = predictions(t, [1], [1, 2, 3, 4]);
  assert.ok(all.some((prediction) => prediction.provider === 'codecov' && prediction.value !== undefined && prediction.value < 95), 'the Codecov patch prediction is low as well');
  assert.equal(newCodeCoverageFindings(all, 'dev').length, 1, 'only the Sonar new-code coverage is judged locally; Codecov and the server gate stay report-only');
});

test('a lint finding blocks only as an ESLint error on a line of the changed set', () => {
  const finding = { engine: 'eslint', level: 'error', rule: 'fixture/no-bad', path: 'be/src/a.ts', line: 3, message: 'BAD' };
  assert.equal(onChangedLine(finding, { 'be/src/a.ts': [3, 4] }), true);
  assert.equal(onChangedLine(finding, { 'be/src/a.ts': [1, 2] }), false, 'an old finding on an untouched line reports');
  assert.equal(onChangedLine({ ...finding, level: 'warning' }, { 'be/src/a.ts': [3] }), false);
  assert.equal(onChangedLine(finding, undefined), false, 'no changed set (a full-gate branch)');
  const blocked = newCodeLintFinding(finding, 'dev');
  assert.equal(blocked['code'], LINT_NEW_CODE);
  assert.match(String(blocked['message']), /be\/src\/a\.ts:3: fixture\/no-bad: BAD \(a line this branch changed since the merge-base with main/);
  assert.equal(blocked['level'], 'error');
  assert.equal(blocked['report'], undefined);
});
