// proves: HFS_STACKS_SHAPE@lite
// proves: HFS_STACKS_SHAPE@full
// `tests: { integration: { workers }, e2e: { workers } }` of application-stacks.yaml sizes the world slots of a run (contexts/code/be/test.md BE-TEST-17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApplicationStacks } from '../runtime/scripts/hfs/stacks-gate.mjs';
import { swarmFixture } from './helpers/swarm-stack-fixture.mjs';

for (const edition of ['lite'] as const) {
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

for (const edition of ['lite'] as const) {
  test(`tests.<kind>.workers ${edition}: more than one is allowed (slots are a library feature, not an edition one)`, t => {
    const fixture = swarmFixture(t, edition);
    fixture.manifest.tests = { integration: { workers: 3 }, e2e: { workers: 8 } };
    fixture.write();
    const errors = checkApplicationStacks({ repoRoot: fixture.root, environment: 'production', deploymentModelFile: fixture.modelFile, repo: { edition } }).errors;
    assert.deepEqual(errors.filter(item => item.path.includes('tests')), []);
  });
}
