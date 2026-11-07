// The app check verdict: green only with zero error findings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gateVerdict } from '../runtime/scripts/hfs/gate-verdict.mjs';

const errors = (count: number, code = 'BE_TRANSPORT_SHAPE') => Array.from({ length: count }, () => ({ code }));

test('no error finding is green with nothing to say', () => {
  assert.deepEqual(gateVerdict([]), { pass: true, count: 0, line: null });
});

test('one error finding makes the gate red and the line counts it', () => {
  const one = gateVerdict(errors(1));
  assert.equal(one.pass, false);
  assert.equal(one.line, 'gate: red, 1 error finding(s)');
});

test('every count above zero is red, whatever the code', () => {
  for (const count of [2, 19, 20, 21, 500]) {
    const verdict = gateVerdict(errors(count));
    assert.equal(verdict.pass, false, String(count));
    assert.equal(verdict.line, `gate: red, ${count} error finding(s)`);
  }
  for (const code of ['HFS_PLAINTEXT_SECRET', 'BE_APP_BOOT_PROOF_MISSING', 'DB_MIGRATION_SHAPE', 'TS_DIAGNOSTIC']) {
    assert.equal(gateVerdict([{ code }]).pass, false, code);
  }
});
