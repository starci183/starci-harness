// proves: HFS_CANON_PIN_DRIFT@lite
// proves: HFS_CANON_PIN_DRIFT@full
// R15 and the Grammar's same-minor range (decision grammar-patch-range): an app's Grammar family pin meets `~x.y.z` when it is an exact version of
// that minor at or above the floor; every other @starci pin stays exact. A pre-release meets a range only when the range names one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRangePin, meetsPin, pinFloor, pinMiss } from '../runtime/scripts/lib/pin-range.mjs';
import { pinFindings } from '../runtime/scripts/hfs/pin-findings.mjs';
import type { CanonPins } from '../runtime/scripts/hfs/canon-pins.mjs';

test('an exact pin meets only itself; a same-minor range meets an exact version of its minor at or above its floor', () => {
  assert.equal(meetsPin('5.11.3', '5.11.3'), true, 'exact');
  assert.equal(meetsPin('5.11.3', '5.11.4'), false, 'an exact pin takes no other version');
  assert.equal(meetsPin('~0.21.38', '0.21.38'), true, 'the floor');
  assert.equal(meetsPin('~0.21.38', '0.21.41'), true, 'a later patch, in range');
  assert.equal(meetsPin('~0.21.38', '0.21.37'), false, 'below the floor');
  assert.equal(meetsPin('~0.21.38', '0.22.0'), false, 'the next minor is out of range');
  assert.equal(meetsPin('~0.21.38', '1.21.38'), false, 'another major');
  assert.equal(meetsPin('~0.21.38', '0.21.39-beta.1'), false, 'a pre-release is refused unless the range names one');
  assert.equal(meetsPin('~0.21.39-beta.0', '0.21.39-beta.1'), true, 'an explicit pre-release range takes a later pre-release of that version');
  assert.equal(meetsPin('~0.21.39-beta.0', '0.21.39'), true, 'and the release itself');
  assert.equal(meetsPin('~0.21.39-beta.0', '0.21.40-beta.0'), false, 'never a pre-release of another version');
  for (const loose of ['^0.21.38', '~0.21.38', 'latest', '0.21']) assert.equal(meetsPin('~0.21.38', loose), false, `${loose}: an app pins an exact version`);
  assert.equal(isRangePin('~0.21.38'), true);
  assert.equal(isRangePin('0.21.38'), false);
  assert.equal(pinFloor('~0.21.38'), '0.21.38');
  assert.match(pinMiss('~0.21.38', '0.22.0') ?? '', /declared 0\.22\.0, pinned the range ~0\.21\.38 \(at least 0\.21\.38, below the next minor\)/u);
  assert.match(pinMiss('~0.21.38', '0.21.39-beta.1') ?? '', /a pre-release meets a range only when the range names one/u);
});

const PINS: CanonPins = {
  '@starci/grammar': { version: '0.21.38', range: '~0.21.38', group: 'starci', side: 'fe' },
  '@starci/eslint-canon-fe': { version: '9.14.3', group: 'starci', side: 'fe' },
};

for (const edition of ['lite', 'full']) {
  test(`HFS_CANON_PIN_DRIFT@${edition}: R15 accepts a Grammar pin inside its range and refuses one outside it, while a canon stays exact`, (t) => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-pin-range-'));
    t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
    const drift = (grammar: string, canon: string) => {
      fs.writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ private: true, dependencies: { '@starci/grammar': grammar }, devDependencies: { '@starci/eslint-canon-fe': canon } }));
      return pinFindings({ repoRoot, files: ['package.json'], profile: 'app', pins: PINS }).map((finding) => [finding.dependency, finding.pinned, finding.declared]);
    };
    assert.deepEqual(drift('0.21.38', '9.14.3'), [], 'exact at the floor');
    assert.deepEqual(drift('0.21.40', '9.14.3'), [], 'a Grammar patch inside the range needs no other pin');
    assert.deepEqual(drift('0.22.0', '9.14.3'), [['@starci/grammar', '~0.21.38', '0.22.0']], 'the next minor is drift');
    assert.deepEqual(drift('0.21.39-beta.1', '9.14.3'), [['@starci/grammar', '~0.21.38', '0.21.39-beta.1']], 'a pre-release is drift');
    assert.deepEqual(drift('0.21.38', '9.14.4'), [['@starci/eslint-canon-fe', '9.14.3', '9.14.4']], 'a canon stays exact');
  });
}
