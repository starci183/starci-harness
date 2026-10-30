import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordSet, keyOfPaths, scopedStep } from '../cache/records.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import { programsOf } from '../cache/app-families.mjs';
import { compareFindings, familyLine, makeReport } from '../cache/report.mjs';
import { hashText } from '../cache/hash.mjs';
import type { Finding } from '../cache/types.mjs';

const finding = (rule: string, path = 'a.ts', message = 'm'): Finding => ({ path, line: 1, column: 1, rule, message });

test('a scoped step reuses a record whose key matches and computes otherwise', async () => {
  const session = createFakeSession({ files: { 'db/a.sql': 'x' } });
  const records = new RecordSet([{ path: 'db', step: 'db-rules', hash: 'k1', findings: [], data: [{ stale: true }] }]);
  let runs = 0;
  const step = (key: string, reuse = true) => scopedStep(session, records, { path: 'db', step: 'db-rules', key, reuse, inputs: ['db/a.sql'], compute: () => { runs += 1; return [{ fresh: true }]; }, compact: () => [] });
  assert.deepEqual(await step('k1'), { value: [{ stale: true }], reused: true });
  assert.equal(runs, 0);
  assert.deepEqual((await step('k2')).reused, false);
  assert.equal(runs, 1);
  assert.deepEqual((await step('k2')).reused, true, 'the new key was stored');
  assert.deepEqual((await step('k2', false)).reused, false, 'a full run never reads');
});

test('a result is not stored when its inputs changed during the run or the step says no', async () => {
  const session = createFakeSession({ files: { 'be/a.ts': 'x' } });
  const records = new RecordSet();
  const base = { path: 'be', step: 'boot-proof', key: 'k', reuse: true, inputs: ['be/a.ts'], compact: () => [] as Finding[] };
  await scopedStep(session, records, { ...base, compute: () => { session.setFile('be/a.ts', 'edited'); return 1; } });
  assert.equal(records.toArray().length, 0);
  const calm = createFakeSession({ files: { 'be/a.ts': 'x' } });
  await scopedStep(calm, records, { ...base, compute: () => 'timeout', store: () => false });
  assert.equal(records.toArray().length, 0);
});

test('records of a deleted path are retained away, and keys cover every member and its absence', () => {
  const records = new RecordSet([{ path: 'a', step: 'machine', hash: 'h', findings: [] }, { path: 'gone', step: 'machine', hash: 'h', findings: [] }]);
  records.retain('machine', new Set(['a']));
  assert.deepEqual(records.toArray().map((r) => r.path), ['a']);
  const present = { paths: ['x'], hashOf: (f: string) => (f === 'x' ? hashText('1') : undefined) };
  assert.notEqual(keyOfPaths(present, ['x']), keyOfPaths(present, ['x', 'y']));
  assert.notEqual(keyOfPaths(present, ['x'], { 'merge-base': 'a' }), keyOfPaths(present, ['x'], { 'merge-base': 'b' }));
});

test('findings compare as new, known and fixed, and the family prints its line', () => {
  assert.deepEqual(compareFindings([finding('A'), finding('B')], [finding('B'), finding('C')]), { newFindings: 1, knownFindings: 1, fixedFindings: 1 });
  const report = makeReport({ family: 'db', mode: 'diff', reason: 'against the cache', checked: 2, reused: 9, previous: [], current: [finding('A')] });
  assert.equal(familyLine(report), 'db: diff (against the cache), checked 2, reused 9; findings 1 new, 0 known, 0 fixed');
});

test('tsc programs are the back end and each front-end workspace', () => {
  assert.deepEqual(programsOf(['be/tsconfig.json', 'fe/apps/web/tsconfig.json', 'fe/packages/ui/tsconfig.json', 'fe/tsconfig.json', 'fe/apps/web/src/x.ts']).map((p) => p.name), ['be', 'fe/apps/web', 'fe/packages/ui']);
});
