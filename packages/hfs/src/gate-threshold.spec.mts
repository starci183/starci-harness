// The app check and lint verdict (owner ruling gate-threshold-20, 2026-10-30): green under 20 error findings with no hard blocker;
// a plaintext secret, a failed boot proof or a broken migration is red at any count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_ERROR_LIMIT, HARD_BLOCKERS, gateErrorLimit, gateVerdict } from '../runtime/scripts/hfs/gate-threshold.mjs';

const errors = (count: number, code = 'BE_TRANSPORT_SHAPE') => Array.from({ length: count }, () => ({ code }));

test('no finding is green with nothing to say', () => {
  assert.deepEqual(gateVerdict([]), { pass: true, count: 0, hard: [], line: null });
});

test('fewer than the limit of ordinary findings is green and says so; the limit itself is red', () => {
  assert.equal(GATE_ERROR_LIMIT, 20);
  const under = gateVerdict(errors(19));
  assert.equal(under.pass, true);
  assert.match(under.line!,/green under the threshold, 19 error finding\(s\) < 20/u);
  const at = gateVerdict(errors(20));
  assert.equal(at.pass, false);
  assert.match(at.line!,/red, 20 error finding\(s\)/u);
});

test('a plaintext secret, the boot proof or a migration finding is red at any count, named in the line', () => {
  for (const code of ['HFS_PLAINTEXT_SECRET', 'BE_APP_BOOT_PROOF_MISSING', 'DB_MIGRATION_SHAPE']) {
    assert.ok(HARD_BLOCKERS.has(code));
    const verdict = gateVerdict([{ code }]);
    assert.equal(verdict.pass, false, code);
    assert.deepEqual(verdict.hard, [code]);
    assert.match(verdict.line!,new RegExp(`${code} blocks at any count`, 'u'));
  }
  assert.equal(gateVerdict([...errors(3), { code: 'RT_SECRET_TRACKED' }]).pass, false);
});

test('the limit comes from policy/quality.yaml through STARCI_GATE_ERROR_LIMIT, else 20', () => {
  assert.equal(gateErrorLimit({}), 20);
  assert.equal(gateErrorLimit({ STARCI_GATE_ERROR_LIMIT: '5' }), 5);
  assert.equal(gateErrorLimit({ STARCI_GATE_ERROR_LIMIT: 'zero' }), 20, 'an unreadable value keeps the default');
  assert.equal(gateErrorLimit({ STARCI_GATE_ERROR_LIMIT: '0' }), 20);
  assert.equal(gateVerdict(errors(5), 5).pass, false);
  assert.equal(gateVerdict(errors(4), 5).pass, true);
});
