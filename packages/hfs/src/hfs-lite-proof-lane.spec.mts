// proves: BE_LITE_PROOF_LANE_MISSING, BE_PATTERN_SPEC_MISSING
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRepo } from '../runtime/scripts/hfs/check.mjs';
import { liteProofLaneFindings } from '../runtime/scripts/hfs/rules/lite-proof-lane.mjs';
import { loadRuleCatalog, loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const SCENARIOS: Record<string, string[]> = {
  'event-bus': ['atomic-with-transaction', 'relay-only-after-commit', 'redelivery-then-dead-letter', 'duplicate-delivery-is-a-noop'],
  queue: ['enqueue-atomic-with-transaction', 'relay-job-id-is-outbox-id', 'scheduler-fires-once'],
  webhooks: ['bad-signature-is-refused', 'replay-is-refused', 'accepted-delivery-publishes-once'],
  realtime: ['subscriber-receives-push', 'foreign-topic-is-isolated', 'disconnect-releases-subscription', 'push-crosses-replicas', 'resume-after-reconnect'],
  'fenced-job': ['claim-bumps-token', 'zombie-fenced-out', 'redispatch-isolated'],
  projection: ['recompute-is-idempotent', 'replay-rebuilds'],
  saga: ['compensation-on-failure', 'step-order', 'state-version-fences', 'consumer-dedupes'],
  idempotency: ['repeat-returns-same-outcome', 'reused-key-other-body-is-refused'],
};
const SPEC = 'be/src/tests/integration/patterns/proofs.integration-spec.ts';
interface Fixture { repoRoot: string; files: string[]; all?: string[] }
const declaration = (patterns: string[]) => ({
  hfs: 3, kind: 'app', project: 'demo',
  sides: {
    be: { apps: [{ name: 'core', kind: 'api' }], patterns },
    fe: { apps: [{ name: 'web', kind: 'next' }] },
  },
});
const tree = (t: TestContext, files: Record<string, string>) => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-lite-proof-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repoRoot, file)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, file), content);
  }
  return { repoRoot, files: Object.keys(files) };
};
const ids = (patterns: string[]) => patterns.flatMap((pattern) => (SCENARIOS[pattern] as string[]).map((scenario) => `${pattern}/${scenario}`));
const spec = (scenarios: string[]) => scenarios.map((id, index) => {
  const title = JSON.stringify(`${id}: proves the outcome`);
  return `${index % 2 ? 'test' : 'it'}(${title}, () => { expect(true).toBe(true); });`;
}).join('\n');
const find = (fixture: Fixture, patterns: string[]) => liteProofLaneFindings({ ...fixture, repo: declaration(patterns) });
const proofFindings = (result: ReturnType<typeof checkRepo>) => result.findings.filter((finding) => ['BE_LITE_PROOF_LANE_MISSING', 'BE_PATTERN_SPEC_MISSING'].includes(finding.code));

test('BE_LITE_PROOF_LANE_MISSING: every declared lite pattern without integration specs is refused', (t) => {
  const fixture = tree(t, {});
  for (const pattern of Object.keys(SCENARIOS)) {
    const findings = find(fixture, [pattern]);
    assert.deepEqual(findings.filter((finding) => finding.code === 'BE_LITE_PROOF_LANE_MISSING').map((finding) => finding.path), ['hfs.json']);
    assert.deepEqual(findings.filter((finding) => finding.code === 'BE_PATTERN_SPEC_MISSING').map((finding) => finding.scenario), ids([pattern]));
    assert.ok(findings.every((finding) => finding.level === 'error'));
  }
});

test('BE_LITE_PROOF_LANE_MISSING: integration specs proving every declared pattern scenario pass', (t) => {
  for (const pattern of Object.keys(SCENARIOS)) {
    const fixture = tree(t, { [SPEC]: spec(ids([pattern])) });
    assert.deepEqual(find(fixture, [pattern]), [], pattern);
  }
});

test('BE_PATTERN_SPEC_MISSING: a present lane still owes every exact scenario title, and unrelated patterns add no requirements', (t) => {
  const patterns = Object.keys(SCENARIOS);
  const missing = 'saga/state-version-fences';
  const fixture = tree(t, { [SPEC]: spec(ids(patterns).filter((id) => id !== missing)) });
  const findings = find(fixture, patterns);
  assert.deepEqual(findings.map((finding) => [finding.code, finding.pattern, finding.scenario]), [['BE_PATTERN_SPEC_MISSING', 'saga', missing]]);
  assert.deepEqual(find(fixture, ['queue']), []);
  assert.deepEqual(find(fixture, []), []);
});

test('BE_LITE_PROOF_LANE_MISSING: e2e, contract, unit and front-end specs cannot supply the lite integration lane', (t) => {
  const files = [
    'be/src/tests/e2e/queue/proofs.e2e-spec.ts',
    'be/src/tests/contract/queue/proofs.contract-spec.ts',
    'be/src/modules/queues/queue.spec.ts',
    'fe/src/tests/integration/proofs.integration-spec.ts',
    'be/src/tests/integration/queue/proofs.spec.ts',
  ];
  const fixture = tree(t, Object.fromEntries(files.map((file) => [file, spec(ids(['queue']))])));
  const findings = find(fixture, ['queue']);
  assert.equal(findings.filter((finding) => finding.code === 'BE_LITE_PROOF_LANE_MISSING').length, 1);
  assert.equal(findings.filter((finding) => finding.code === 'BE_PATTERN_SPEC_MISSING').length, (SCENARIOS.queue as string[]).length);
});

test('BE_PATTERN_SPEC_MISSING: comments, strings, skipped/todo calls, dynamic titles and missing callbacks do not prove a scenario', (t) => {
  const id = 'projection/recompute-is-idempotent';
  const fixture = tree(t, { [SPEC]: [
    `// it('${id}: comment', () => {});`,
    `const example = "it('${id}: string', () => {});";`,
    `it.skip('${id}: skipped', () => {});`,
    `test.todo('${id}: todo');`,
    `const title = '${id}: dynamic'; it(title, () => {});`,
    `test('${id}: no callback');`,
    `it('${id}: undefined callback', undefined);`,
    `it('${id}: null callback', null);`,
    `describe.skip('disabled suite', () => { it('${id}: skipped suite', () => {}); });`,
    `xdescribe('disabled suite', () => { it('${id}: disabled suite', () => {}); });`,
    `it('wrong/${id}: wrong prefix', () => {});`,
    spec(['projection/replay-rebuilds']),
  ].join('\n') });
  const findings = find(fixture, ['projection']);
  assert.deepEqual(findings.map((finding) => [finding.code, finding.scenario]), [['BE_PATTERN_SPEC_MISSING', id]]);
});

test('BE_PATTERN_SPEC_MISSING: titles may use literal templates and proofs may be split across tracked integration specs', (t) => {
  const fixture = tree(t, {
    [SPEC]: 'test(`projection/recompute-is-idempotent: a literal template`, () => {});',
    'be/src/tests/integration/replay/replay.integration-spec.ts': spec(['projection/replay-rebuilds']),
  });
  assert.deepEqual(find(fixture, ['projection']), []);
  const rootPass = { ...fixture, files: ['hfs.json'], all: fixture.files };
  assert.deepEqual(find(rootPass, ['projection']), [], 'the app-root pass reads the full tracked tree');
  const untracked = { ...fixture, files: [] };
  assert.equal(find(untracked, ['projection'])[0]?.code, 'BE_LITE_PROOF_LANE_MISSING', 'files on disk alone are not tracked proof');
});

test('BE_PATTERN_SPEC_MISSING: the manifest supplies scenario ids, including saga when configured', (t) => {
  const manifest = structuredClone(loadSlotManifest());
  manifest.ruleParams.be.patternScenarios.saga = ['configured-saga-proof'];
  manifest.ruleParams.be.patternScenarios.projection = ['configured-projection-proof'];
  const scenarios = ['saga/configured-saga-proof', 'projection/configured-projection-proof'];
  const passing = tree(t, { [SPEC]: spec(scenarios) });
  const missing = tree(t, { [SPEC]: spec(ids(['saga', 'projection'])) });
  const repo = declaration(['saga', 'projection']);
  assert.deepEqual(liteProofLaneFindings({ ...passing, repo, manifest }), []);
  const findings = liteProofLaneFindings({ ...missing, repo, manifest });
  assert.deepEqual(findings.map((finding) => finding.scenario), scenarios);
  assert.ok(findings.every((finding) => finding.code === 'BE_PATTERN_SPEC_MISSING'));
});

test('BE_LITE_PROOF_LANE_MISSING: no patterns, non-pattern capabilities and side passes add no findings', (t) => {
  const fixture = tree(t, {});
  assert.deepEqual(find(fixture, []), []);
  assert.deepEqual(find(fixture, ['cqrs']), []);
  assert.deepEqual(liteProofLaneFindings({ ...fixture, repo: { profile: 'be', patterns: ['queue'] } }), []);
});

test('BE_PATTERN_SPEC_MISSING: starci app check wires the proof lane', (t) => {
  {
    const repo = declaration(['projection']);
    const empty = tree(t, { 'hfs.json': JSON.stringify(repo) });
    const missing = proofFindings(checkRepo({ ...empty, declaration: repo, tree: false }));
    assert.deepEqual(missing.filter((finding) => finding.code === 'BE_PATTERN_SPEC_MISSING').map((finding) => finding.scenario as string).sort((a, b) => a.localeCompare(b)), ids(['projection']).sort((a, b) => a.localeCompare(b)));
    assert.equal(missing.filter((finding) => finding.code === 'BE_LITE_PROOF_LANE_MISSING').length, 1);
    const passing = tree(t, { 'hfs.json': JSON.stringify(repo), [SPEC]: spec(ids(['projection'])) });
    assert.deepEqual(proofFindings(checkRepo({ ...passing, declaration: repo, tree: false })), []);
    const e2e = tree(t, { 'hfs.json': JSON.stringify(repo), 'be/src/tests/e2e/projection/proofs.e2e-spec.ts': spec(ids(['projection'])) });
    assert.equal(proofFindings(checkRepo({ ...e2e, declaration: repo, tree: false })).length, 3);
  }
});

test('R284 owns BE_LITE_PROOF_LANE_MISSING once and R155 retains BE_PATTERN_SPEC_MISSING', () => {
  const catalog = loadRuleCatalog();
  const lane = catalog.rules.find((rule) => rule.id === 'R284');
  assert.equal(lane?.code, 'BE_LITE_PROOF_LANE_MISSING');
  assert.deepEqual(lane?.failureCodes, ['BE_LITE_PROOF_LANE_MISSING']);
  assert.deepEqual(catalog.rules.filter((rule) => rule.failureCodes.includes('BE_PATTERN_SPEC_MISSING')).map((rule) => rule.id), ['R155']);
  assert.deepEqual(catalog.rules.find((rule) => rule.id === 'R155')?.enforcers, [
    { kind: 'hfs', id: 'lite-proof-lane', at: 'scripts/hfs/rules/lite-proof-lane.mjs', planned: false },
  ]);
});

