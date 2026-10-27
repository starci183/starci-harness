// The release-wave naming (owner ruling release-waves): one counter alpha.N.M, SemVer order, the next release derived from the tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, nextReleases, nextWave, releaseLine, releaseVersionRefusal, taggedVersions, waveOf } from '../runtime/scripts/lib/release-version.mjs';

const ORDER = ['1.0.0-alpha.30', '1.0.0-alpha.31', '1.0.0-alpha.31.1', '1.0.0-alpha.31.2', '1.0.0-alpha.32', '1.0.0-alpha.32.1', '1.0.0'];

test('SemVer precedence orders a line, its waves and the next line: alpha.31 < alpha.31.1 < alpha.31.2 < alpha.32 < alpha.32.1', () => {
  for (const [i, lower] of ORDER.entries()) {
    for (const higher of ORDER.slice(i + 1)) {
      assert.equal(compareVersions(lower, higher), -1, `${lower} < ${higher}`);
      assert.equal(compareVersions(higher, lower), 1, `${higher} > ${lower}`);
    }
    assert.equal(compareVersions(lower, lower), 0);
  }
  assert.deepEqual([...ORDER].reverse().sort(compareVersions), ORDER);
  assert.equal(compareVersions('1.0.0-alpha.31.10', '1.0.0-alpha.31.9'), 1);
});

test('the legacy -fix form is read as the wave it counted and orders with the new form, never as a later line', () => {
  assert.deepEqual(waveOf('1.0.0-alpha.31-fix.1'), { base: '1.0.0-alpha.31', wave: 1, legacy: true });
  assert.deepEqual(waveOf('1.0.0-alpha.31.2'), { base: '1.0.0-alpha.31', wave: 2, legacy: false });
  assert.deepEqual(waveOf('1.0.0-alpha.31'), { base: '1.0.0-alpha.31', wave: 0, legacy: false });
  assert.equal(compareVersions('1.0.0-alpha.31-fix.1', '1.0.0-alpha.31.1'), 0);
  assert.equal(compareVersions('1.0.0-alpha.31-fix.2', '1.0.0-alpha.32'), -1);
  assert.equal(compareVersions('1.0.0-alpha.31-fix.2', '1.0.0-alpha.31.1'), 1);
  assert.equal(releaseLine('1.0.0-alpha.31-fix.1'), releaseLine('1.0.0-alpha.32.1'));
});

test('the next wave counts from the highest wave of its base and never produces the -fix form', () => {
  assert.equal(nextWave('1.0.0-alpha.31'), '1.0.0-alpha.31.1');
  assert.equal(nextWave('1.0.0-alpha.31', ['1.0.0-alpha.31.1']), '1.0.0-alpha.31.2');
  assert.equal(nextWave('1.0.0-alpha.31', ['1.0.0-alpha.31-fix.3', '1.0.0-alpha.30.7']), '1.0.0-alpha.31.4');
  assert.equal(nextWave('1.0.0-alpha.31-fix.1'), '1.0.0-alpha.31.2');
  assert.equal(nextWave('1.2.3'), '1.2.3.1');
  assert.doesNotMatch(nextWave('1.2.3-fix.2', ['1.2.3-fix.5']), /-fix/);
});

test('the next releases are derived from the highest tag: its next wave or the next line', () => {
  const tags = taggedVersions('v1.0.0-alpha.29\nv1.0.0-alpha.30\r\nv1.0.0-alpha.31\nnot-a-release\n');
  assert.deepEqual(tags, ['1.0.0-alpha.29', '1.0.0-alpha.30', '1.0.0-alpha.31']);
  assert.deepEqual(nextReleases(tags), { highest: '1.0.0-alpha.31', family: '1.0.0-alpha', wave: '1.0.0-alpha.31.1', line: '1.0.0-alpha.32' });
  assert.equal(nextReleases([...tags, '1.0.0-alpha.31.1']).wave, '1.0.0-alpha.31.2');
  assert.equal(nextReleases([...tags, '1.0.0-alpha.31-fix.2']).wave, '1.0.0-alpha.31.3');
  assert.equal(nextReleases(['1.0.0']), null);
});

test('only the next wave or the next line may be released; a skipped M, an older line and the legacy form are refused', () => {
  const released = ['1.0.0-alpha.30', '1.0.0-alpha.31'];
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.1', released), null);
  assert.equal(releaseVersionRefusal('1.0.0-alpha.32', released), null);
  assert.match(releaseVersionRefusal('1.0.0-alpha.31.2', released), /next release is 1\.0\.0-alpha\.31\.1 .* or 1\.0\.0-alpha\.32/);
  const afterWave = [...released, '1.0.0-alpha.31.1'];
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.2', afterWave), null);
  assert.match(releaseVersionRefusal('1.0.0-alpha.33', afterWave), /does not follow 1\.0\.0-alpha\.31\.1/);
  assert.match(releaseVersionRefusal('1.0.0-alpha.31.2', [...afterWave, '1.0.0-alpha.32']), /next release is 1\.0\.0-alpha\.32\.1/);
  assert.match(releaseVersionRefusal('1.0.0-alpha.31-fix.2', afterWave), /legacy -fix form.*1\.0\.0-alpha\.31\.2/);
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.1', [...afterWave]), null, 'a re-cut of the tagged release judges it against the other tags');
  assert.equal(releaseVersionRefusal('1.0.0', afterWave), null);
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.1', []), null);
});

test('the next release is judged within the candidate family: legacy tags of other families never outrank the runtime line', () => {
  const tags = ['1.0.0-alpha.30', '2.0.1-alpha.1', '2.0.1-alpha.2', '2.1.4', '6.1.1'];
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31', tags), null);
  assert.equal(releaseVersionRefusal('1.0.0-alpha.30.1', tags), null);
  assert.match(releaseVersionRefusal('1.0.0-alpha.32', tags), /does not follow 1\.0\.0-alpha\.30/, 'a skipped line is refused, as after a wave');
  assert.match(releaseVersionRefusal('1.0.0-alpha.29', tags), /does not follow 1\.0\.0-alpha\.30; .*1\.0\.0-alpha\.30\.1 .* or 1\.0\.0-alpha\.31/);
  assert.match(releaseVersionRefusal('1.0.0-alpha.31-fix.1', tags), /legacy -fix form/);
  assert.deepEqual(nextReleases(tags, '1.0.0-alpha.31'), { highest: '1.0.0-alpha.30', family: '1.0.0-alpha', wave: '1.0.0-alpha.30.1', line: '1.0.0-alpha.31' });
  assert.equal(nextReleases(tags).highest, '2.0.1-alpha.2', 'without a candidate the highest overall stays');
  const tagged = [...tags, '1.0.0-alpha.31'];
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.1', tagged), null);
  assert.match(releaseVersionRefusal('1.0.0-alpha.31.2', tagged), /next release is 1\.0\.0-alpha\.31\.1 /);
  assert.equal(releaseVersionRefusal('1.0.0-alpha.31.2', [...tagged, '1.0.0-alpha.31.1']), null);
});

test('a family with no tag keeps the rule: only a later release than the highest overall may open it', () => {
  const tags = ['1.0.0-alpha.30', '2.0.1-alpha.2'];
  assert.equal(releaseVersionRefusal('2.1.0-beta.1', tags), null);
  assert.equal(releaseVersionRefusal('3.0.0', tags), null);
  assert.match(releaseVersionRefusal('1.5.0-beta.1', tags), /does not follow 2\.0\.1-alpha\.2/);
});
