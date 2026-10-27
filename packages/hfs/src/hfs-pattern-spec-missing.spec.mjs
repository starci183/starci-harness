// proves: BE_PATTERN_SPEC_MISSING@lite
// proves: BE_PATTERN_SPEC_MISSING@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { patternSpecFindings } from '../runtime/scripts/hfs/rules/event-bus.mjs';
import { liteProofLaneFindings } from '../runtime/scripts/hfs/rules/lite-proof-lane.mjs';
import { createSlotResolver, loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { checkReachability } from '../runtime/scripts/hfs/architecture/reachability.mjs';

const SPEC = 'be/src/tests/integration/projection/proofs.integration-spec.ts';
const FIRST = "test('projection/recompute-is-idempotent: repeated input preserves the result', () => {});\n";
const SECOND = "it('projection/replay-rebuilds: replay restores the view', () => {});\n";
const repo = (edition) => ({ edition, sides: { be: { patterns: ['projection'] } } });

function fixture(t, files) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-pattern-spec-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(repoRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { repoRoot, files: Object.keys(files) };
}

test('full rejects a declared pattern with a missing scenario in its integration spec', (t) => {
  const input = { ...fixture(t, { [SPEC]: FIRST }), repo: repo('full') };
  assert.deepEqual(patternSpecFindings(input).map((finding) => [finding.code, finding.scenario]), [
    ['BE_PATTERN_SPEC_MISSING', 'projection/replay-rebuilds'],
  ]);
});

test('full accepts all declared pattern scenarios in an integration spec', (t) => {
  const input = { ...fixture(t, { [SPEC]: FIRST + SECOND }), repo: repo('full') };
  assert.deepEqual(patternSpecFindings(input), []);
});

test('full accepts declared pattern scenarios in its e2e proof lane', (t) => {
  const files = { 'be/src/tests/e2e/projection/proofs.e2e-spec.ts': FIRST + SECOND };
  const input = { ...fixture(t, files), repo: repo('full') };
  assert.deepEqual(patternSpecFindings(input), []);
});

test('lite rejects a declared pattern with a missing scenario in its integration spec', (t) => {
  const input = { ...fixture(t, { [SPEC]: FIRST }), repo: repo('lite') };
  assert.deepEqual(liteProofLaneFindings(input).map((finding) => [finding.code, finding.scenario]), [
    ['BE_PATTERN_SPEC_MISSING', 'projection/replay-rebuilds'],
  ]);
});

test('lite accepts all declared pattern scenarios in its integration spec', (t) => {
  const input = { ...fixture(t, { [SPEC]: FIRST + SECOND }), repo: repo('lite') };
  assert.deepEqual(liteProofLaneFindings(input), []);
});

test('lite rejects e2e specs as evidence of declared pattern scenarios', (t) => {
  const files = { 'be/src/tests/e2e/projection/proofs.e2e-spec.ts': FIRST + SECOND };
  const input = { ...fixture(t, files), repo: repo('lite') };
  assert.deepEqual(liteProofLaneFindings(input).filter((finding) => finding.code === 'BE_PATTERN_SPEC_MISSING')
    .map((finding) => finding.scenario), ['projection/recompute-is-idempotent', 'projection/replay-rebuilds']);
});

test('client idempotency requires both replay and changed-body refusal proofs in either edition', (t) => {
  const file = 'be/src/tests/integration/idempotency/client.integration-spec.ts';
  const replay = "it('idempotency/repeat-returns-same-outcome: replays the receipt', () => {});\n";
  const refusal = "it('idempotency/reused-key-other-body-is-refused: rejects different input', () => {});\n";
  for (const edition of ['full', 'lite']) {
    const declaration = { edition, sides: { be: { patterns: ['idempotency'] } } };
    const check = edition === 'full' ? patternSpecFindings : liteProofLaneFindings;
    const missing = { ...fixture(t, { [file]: replay }), repo: declaration };
    assert.deepEqual(check(missing).map((finding) => finding.scenario), ['idempotency/reused-key-other-body-is-refused']);
    assert.deepEqual(check({ ...fixture(t, { [file]: replay + refusal }), repo: declaration }), []);
  }
});

for (const edition of ['lite', 'full']) {
  test(`${edition}: logging remains a required measured owner before its proof pattern is declared`, () => {
    const manifest = loadSlotManifest();
    const declaration = {
      hfs: 3, kind: 'app', project: 'correlation', edition,
      sides: { be: { kinds: ['api'], apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } },
    };
    const resolver = createSlotResolver(manifest, resolveRepoDeclaration(manifest, declaration, { side: 'be' }));
    const path = 'src/modules/platform/logging/correlation.service.ts';
    assert.equal(resolver.classifyPath(path).status, 'owned');
    assert.equal(resolver.slotOf(path).id, 'be.platform.logging');
    assert.equal(resolver.slotOf(path).coverage, 'required');
    assert.equal(resolver.slotOf(path).tests, 'unit-beside');
    assert.deepEqual(resolver.requiredFiles(path), ['src/modules/platform/logging/index.ts']);
    assert.equal(resolver.requiredPaths().paths.filter((entry) => entry.path === 'src/modules/platform/logging/').length, 1);
    const app = 'apps/api/src/app.module.ts';
    const entry = 'src/modules/platform/logging/index.ts';
    const graph = {
      profile: 'be',
      files: new Map([
        [app, { owner: { slot: 'be.app.api', root: 'apps/api/src' } }],
        [entry, { owner: resolver.ownerOf(entry) }],
      ]),
      edges: [],
    };
    assert.deepEqual(checkReachability({ graph }).violations.map((finding) => [finding.ruleId, finding.path]), [
      ['BE_FEATURE_NOT_COMPOSED', entry],
    ]);
    graph.edges.push({ from: app, to: entry, runtime: true });
    assert.deepEqual(checkReachability({ graph }).violations, []);
    declaration.sides.be.patterns = ['logging'];
    assert.doesNotThrow(() => resolveRepoDeclaration(manifest, declaration));
  });

  test(`${edition}: correlation logging requires its queue propagation scenario when declared`, (t) => {
    const file = 'be/src/tests/integration/logging/correlation.integration-spec.ts';
    const input = {
      ...fixture(t, { [file]: 'test("unrelated: a queue is configured", () => {});\n' }),
      repo: { edition, sides: { be: { patterns: ['logging'] } } },
    };
    const findings = edition === 'lite' ? liteProofLaneFindings : patternSpecFindings;
    assert.deepEqual(findings(input).map((finding) => [finding.code, finding.scenario]), [
      ['BE_PATTERN_SPEC_MISSING', 'logging/correlation-survives-queue'],
    ]);
    fs.writeFileSync(path.join(input.repoRoot, file), 'test("logging/correlation-survives-queue: the original id reaches the worker", () => {});\n');
    assert.deepEqual(findings(input), []);
  });
}
