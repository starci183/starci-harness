// proves: HFS_STACKS_SHAPE@lite
// proves: HFS_STACKS_SHAPE@full
// `tests: { integration: { workers }, e2e: { workers } }` of application-stacks.yaml sizes the world slots of a run (contexts/code/be/test.md BE-TEST-17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApplicationStacks } from '../runtime/scripts/hfs/stacks-gate.mjs';
import { swarmFixture } from './helpers/swarm-stack-fixture.mjs';

const code = 'HFS_STACKS_SHAPE';

for (const edition of ['lite', 'full']) {
  const findings = (fixture: ReturnType<typeof swarmFixture>) => checkApplicationStacks({ repoRoot: fixture.root, environment: 'production', deploymentModelFile: fixture.modelFile, repo: { edition } }).errors;

  test(`tests.<kind>.workers ${edition}: absent is sequential and one is accepted`, t => {
    const fixture = swarmFixture(t, edition);
    assert.deepEqual(findings(fixture).filter(item => item.path.startsWith('tests') || item.path.startsWith('/tests')), []);
    fixture.manifest.tests = { integration: { workers: 1 }, e2e: { workers: 1 } };
    fixture.write();
    assert.deepEqual(findings(fixture).filter(item => item.path.includes('tests')), []);
  });

  test(`tests.<kind>.workers ${edition}: a wrong shape is a finding`, t => {
    for (const wrong of [3, { unit: { workers: 2 } }, { e2e: 2 }, { e2e: { workers: 0 } }, { e2e: { workers: 9 } }, { e2e: { workers: 1.5 } }, { e2e: { workers: '2' } }, { e2e: { workers: 2, more: true } }, { integration: {} }]) {
      const fixture = swarmFixture(t, edition);
      fixture.manifest.tests = wrong;
      fixture.write();
      assert.ok(findings(fixture).some(item => item.code === 'schema-shape-invalid' && item.path.includes('tests')), JSON.stringify(wrong));
    }
  });
}

test('tests.<kind>.workers above one is a full app\'s: a lite app has no world data slots', t => {
  const lite = swarmFixture(t, 'lite');
  lite.manifest.tests = { e2e: { workers: 3 } };
  lite.write();
  const refused = checkApplicationStacks({ repoRoot: lite.root, environment: 'production', deploymentModelFile: lite.modelFile, repo: { edition: 'lite' } }).errors;
  assert.ok(refused.some(item => item.code === code && item.path === 'tests.e2e.workers'), JSON.stringify(refused));
  const full = swarmFixture(t, 'full');
  full.manifest.tests = { integration: { workers: 3 }, e2e: { workers: 8 } };
  full.write();
  const accepted = checkApplicationStacks({ repoRoot: full.root, environment: 'production', deploymentModelFile: full.modelFile, repo: { edition: 'full' } }).errors;
  assert.deepEqual(accepted.filter(item => item.path.includes('tests')), []);
});
