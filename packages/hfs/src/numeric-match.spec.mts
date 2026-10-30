import assert from 'node:assert/strict';
import test from 'node:test';
import { numericMatch } from '../runtime/scripts/lib/numeric-match.mjs';

test('numeric recognizers retain their own accepted language and reject unmatched input', () => {
  const engine = /^starci\/engine@(\d+)$/;
  const semver = /^[\^~>=v\s]*(\d+)(?:\.|$)/;
  assert.equal(numericMatch('starci/engine@3', engine), 3);
  assert.equal(numericMatch('^9.2.1', semver), 9);
  assert.equal(numericMatch('starci/engine@3', semver), null);
  assert.equal(numericMatch('^9.2.1', engine), null);
  assert.equal(numericMatch('starci/engine@3.0', engine), null);
  for (const value of [undefined, null, '', 'workspace:*']) assert.equal(numericMatch(value, semver), null);
});
