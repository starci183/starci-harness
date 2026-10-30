// The `--sonar` family of the app check cache: the baselines hold reference data and digests only, never a server's result; the predictions come from the merged coverage and
// the changed lines, every one is labelled as a prediction, and none passes or fails a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFakeSession } from '../cache/fake-session.mjs';
import { serializeRecords } from '../cache/jsonl.mjs';
import {
  CODECOV_FOLDER, PREDICTION, SONAR_FOLDER, baselineDrift, baselineRecords, changedLinesFromDiff, formatPredictions, lineCoverageOf, predict, readCodecovTargets, readSonarGate,
  recordsAtCommit, runQualityFamily, scopeDigest,
} from '../cache/quality-baselines.mjs';
import type { BaselineSources, QualityInputs } from '../cache/quality-baselines.mjs';
import type { CacheRecord } from '../cache/types.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'));
const GATE = fs.readFileSync(path.join(here, '..', 'runtime', 'knowledge', 'sonar-gate.yaml'), 'utf8');
const CODECOV = 'codecov:\n  require_ci_to_pass: true\ncoverage:\n  status:\n    project:\n      default:\n        target: 90%\n        threshold: 0%\n    patch:\n      default:\n        target: 95%\n        threshold: 0%\n';
const PROPERTIES = 'sonar.projectKey=app\nsonar.sources=be/src\nsonar.exclusions=**/*.spec.ts\nsonar.coverage.exclusions=be/src/features/**\nsonar.host.url=http://localhost:9000\n';

const sources = (over: Partial<BaselineSources> = {}): BaselineSources => ({ baseCommit: 'a'.repeat(40), sonarGateYaml: GATE, sonarProperties: PROPERTIES, codecovYaml: CODECOV, ...over });

/** A spec record with one source: `lines` statements on lines 1..n, those in `covered` covered. */
const specRecord = (spec: string, source: string, lines: number, covered: readonly number[]): CacheRecord => ({
  path: spec, step: 'unit-spec', hash: 'k', findings: [],
  data: { sources: { [source]: { s: Array.from({ length: lines }, (_, i) => [i + 1, 0, i + 1, 9, covered.includes(i + 1) ? 1 : 0]), f: [], b: [] } } },
});

test('the baselines read the gate and the targets from their owners and hold reference data and digests only', () => {
  const gate = readSonarGate(GATE);
  assert.deepEqual(gate, { coverageMinPercent: 100, duplicationMaxPercent: 3 });
  assert.deepEqual(readCodecovTargets(CODECOV), { project: 90, patch: 95 });
  assert.throws(() => readCodecovTargets('coverage: {}\n'), /codecov\.yml is not declared at coverage\.status\.project\.default\.target/u);
  const records = baselineRecords(sources());
  assert.deepEqual(records.sonar.map((record) => record.path), ['new-code-base', 'quality-gate', 'analysis-scope']);
  assert.deepEqual(records.codecov.map((record) => record.path), ['base', 'targets']);
  for (const record of [...records.sonar, ...records.codecov]) {
    assert.equal(record.step, 'reference');
    assert.deepEqual(record.findings, [], 'a baseline holds no finding and no server result');
    assert.match(record.hash, /^[0-9a-f]{40,64}$/u);
  }
  const text = serializeRecords([...records.sonar, ...records.codecov]);
  assert.ok(!/passed|failed|quality_gate|status":"(OK|ERROR)"|measures/u.test(text), 'no server result in the bytes');
  assert.equal(serializeRecords([...baselineRecords(sources()).sonar, ...baselineRecords(sources()).codecov]), text, 'equal inputs, equal bytes');
});

test('the scope digest follows the scope settings and nothing else; drift names the part whose owner moved', () => {
  const base = scopeDigest(PROPERTIES);
  assert.equal(scopeDigest(PROPERTIES.replace('http://localhost:9000', 'http://other:9000').replace('sonar.projectKey=app', 'sonar.projectKey=other')), base);
  assert.equal(scopeDigest(PROPERTIES.replace(/\n/gu, '\r\n')), base);
  assert.notEqual(scopeDigest(PROPERTIES.replace('be/src/features/**', 'be/src/features/**,be/src/x/**')), base);
  const stored = baselineRecords(sources());
  assert.deepEqual(baselineDrift(stored.sonar, baselineRecords(sources()).sonar), []);
  const moved = baselineRecords(sources({ baseCommit: 'b'.repeat(40), sonarGateYaml: GATE.replace('minPercent: 100', 'minPercent: 95') }));
  assert.deepEqual(baselineDrift(stored.sonar, moved.sonar), ['new-code-base', 'quality-gate']);
  assert.deepEqual(baselineDrift(stored.codecov, moved.codecov), ['base']);
});

test('changed lines come from a zero-context diff: added and changed lines per file, none for a deleted file or a pure deletion', () => {
  const diff = [
    'diff --git a/be/src/a.ts b/be/src/a.ts', '--- a/be/src/a.ts', '+++ b/be/src/a.ts', '@@ -3 +3,2 @@', '-old', '+new', '+newer', '@@ -10,2 +11,0 @@', '-gone', '-gone too',
    'diff --git a/be/src/b.ts b/be/src/b.ts', '--- a/be/src/b.ts', '+++ /dev/null', '@@ -1,3 +0,0 @@',
    'diff --git a/be/src/c.ts b/be/src/c.ts', '--- /dev/null', '+++ b/be/src/c.ts', '@@ -0,0 +1,2 @@', '+x', '+y', '',
  ].join('\n');
  assert.deepEqual(changedLinesFromDiff(diff), { 'be/src/a.ts': [3, 4], 'be/src/c.ts': [1, 2] });
});

const inputs = (over: Partial<QualityInputs> = {}): QualityInputs => ({
  changed: { 'be/src/a.service.ts': [1, 2, 3, 4, 9], 'be/src/b.ts': [1, 2] },
  coverage: lineCoverageOf([specRecord('s1', 'be/src/a.service.ts', 6, [1, 2, 3]), specRecord('s2', 'be/src/a.service.ts', 6, [1, 5])]),
  baseCoverage: lineCoverageOf([specRecord('s1', 'be/src/a.service.ts', 6, [1, 2])]),
  clones: [{ path: 'be/src/b.ts', startLine: 2, endLine: 8 }, { path: 'be/src/a.service.ts', startLine: 4, endLine: 4 }],
  gate: { coverageMinPercent: 100, duplicationMaxPercent: 3 },
  targets: { project: 90, patch: 95 },
  measured: (file) => file.endsWith('.service.ts'),
  ...over,
});

test('line coverage is the union of what every spec covers over the lines a statement starts on', () => {
  const coverage = lineCoverageOf([specRecord('s1', 'x.ts', 4, [1]), specRecord('s2', 'x.ts', 4, [3]), { path: 'o', step: 'other', hash: 'h', findings: [] }]);
  assert.deepEqual(coverage, { 'x.ts': { instrumented: [1, 2, 3, 4], covered: [1, 3] } });
});

test('the predictions: new-code coverage and duplication, patch coverage and the project change against the base total', () => {
  const byMetric = Object.fromEntries(predict(inputs()).map((prediction) => [`${prediction.provider} ${prediction.metric}`, prediction]));
  // a.service.ts changed lines 1,2,3,4,9: line 9 is not instrumented; 1,2,3 are covered, 4 is not. b.ts is outside the measured scope.
  assert.equal(byMetric['sonar new-code coverage']?.value, 75);
  assert.equal(byMetric['sonar new-code coverage']?.basis, '3 of 4 coverable changed lines');
  assert.equal(byMetric['codecov patch coverage']?.value, 75);
  // duplication over the analysed changed lines: a.service.ts 5 lines (line 4 in a clone), b.ts 2 lines (line 2 in a clone) = 2 of 7.
  assert.equal(byMetric['sonar new-code duplication']?.value, 28.57);
  assert.equal(byMetric['sonar new-code duplication']?.target, '<= 3%');
  // project: now 1,2,3,5 of 6 = 66.67; base 1,2 of 6 = 33.33: +33.34 (rounded values subtracted).
  assert.equal(byMetric['codecov project change']?.value, 33.34);
  assert.match(byMetric['codecov project change']?.basis ?? '', /66\.67% now against 33\.33% at the base commit/u);
});

test('every prediction is labelled a prediction, says it is not the server\'s result, and no verdict exists to fail a run', () => {
  const predictions = predict(inputs());
  assert.ok(predictions.every((prediction) => prediction.label === PREDICTION));
  for (const line of formatPredictions(predictions)) assert.match(line, /\[prediction from the local run, not the server's result; the server holds it to .+\]$/u);
  assert.ok(predictions.every((prediction) => !('ok' in prediction) && !('passed' in prediction)));
  const below = predict(inputs({ changed: { 'be/src/a.service.ts': [4, 6] }, coverage: lineCoverageOf([specRecord('s', 'be/src/a.service.ts', 6, [])]) }));
  assert.equal(below[0]?.value, 0, 'far below the gate, and still only a number with its target beside it');
  assert.equal(formatPredictions(below)[0], "sonar: new-code coverage 0% (0 of 2 coverable changed lines) [prediction from the local run, not the server's result; the server holds it to >= 100%]");
});

test('nothing measurable is said so, and an unreadable base gives no project change', () => {
  const none = predict(inputs({ changed: { 'docs/readme.md': [1] }, baseCoverage: undefined }));
  const values = Object.fromEntries(none.map((prediction) => [prediction.metric, prediction.value]));
  assert.deepEqual(values, { 'new-code coverage': undefined, 'new-code duplication': 0, 'patch coverage': undefined, 'project change': undefined });
  assert.match(formatPredictions(none)[0] ?? '', /new-code coverage not measurable/u);
  assert.match(none[3]?.basis ?? '', /no readable coverage records/u);
});

test('the base total is computed from the base commit\'s committed records, read with git show', () => {
  const baseText = serializeRecords([specRecord('be/src/a.spec.ts', 'be/src/a.service.ts', 4, [1, 2, 3, 4])]);
  const calls: string[] = [];
  const git = (args: readonly string[]): string | undefined => {
    calls.push(args.join(' '));
    if (args[0] === 'ls-tree') return '.starcistacks/cache/test-coverage/be.jsonl\n.starcistacks/cache/test-coverage/README.md\n';
    if (args[0] === 'show') return baseText;
    return undefined;
  };
  const records = recordsAtCommit('c'.repeat(40), git);
  assert.deepEqual(calls, [`ls-tree -r --name-only ${'c'.repeat(40)} -- .starcistacks/cache/test-coverage`, `show ${'c'.repeat(40)}:.starcistacks/cache/test-coverage/be.jsonl`]);
  assert.deepEqual(lineCoverageOf(records), { 'be/src/a.service.ts': { instrumented: [1, 2, 3, 4], covered: [1, 2, 3, 4] } });
  assert.deepEqual(recordsAtCommit('d'.repeat(40), () => undefined), []);
});

test('the family writes both baseline folders, predicts from this run\'s records and reports no finding', () => {
  const session = createFakeSession({ records: { 'sonar-baseline': baselineRecords(sources({ baseCommit: 'e'.repeat(40) })).sonar } });
  session.replace('test-coverage', [specRecord('be/src/a.spec.ts', 'be/src/a.service.ts', 4, [1, 2, 3, 4])]);
  const result = runQualityFamily({
    session, sources: sources(), changed: { 'be/src/a.service.ts': [1, 2, 3, 4] }, clones: [], baseCoverage: undefined,
    measured: (file) => file.endsWith('.service.ts'),
  });
  assert.deepEqual([...session.replaced.keys()].sort(), ['codecov-baseline', 'sonar-baseline', 'test-coverage']);
  assert.deepEqual(session.replaced.get(SONAR_FOLDER)?.map((record) => record.path), ['new-code-base', 'quality-gate', 'analysis-scope']);
  assert.deepEqual(session.replaced.get(CODECOV_FOLDER)?.map((record) => record.path), ['base', 'targets']);
  assert.deepEqual(result.drift, ['new-code-base']);
  assert.equal(result.predictions[0]?.value, 100);
  assert.equal(result.lines.length, 4);
  assert.equal(session.reports[0]?.family, 'sonar');
  assert.equal(session.reports[0]?.newFindings, 0);
});
