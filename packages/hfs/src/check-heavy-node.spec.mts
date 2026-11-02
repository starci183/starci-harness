import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completedNode, runHeavyNode } from '../runtime/scripts/api/node/run-node.mjs';
import { contractEmitFindings, contractEmitFindingsAsync } from '../runtime/scripts/hfs/rules/contract.mjs';
import { emitContractsAsync } from '../emit/contracts.mjs';
import { createFakeSession } from '../cache/fake-session.mjs';
import { RecordSet, scopedStep } from '../cache/records.mjs';
import { mapBounded } from '../lint/chunk.mjs';
import { main } from './main.mjs';

test('missing child admission refuses at a live execution request, while nonheavy help remains usable', async () => {
  const request = { kind: 'tsc' as const, label: 'tsc', args: ['tsc'], cwd: process.cwd(), maxBuffer: 1024 };
  await assert.rejects(runHeavyNode(undefined, request), /HFS_NODE_GOVERNOR_MISSING/u);
  assert.equal(await main(['--help'], { stdout: () => undefined, stderr: () => undefined }), 0);
  assert.throws(() => completedNode({ status: null, signal: null, stdout: 'partial diagnostic', stderr: '', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) }, 'tsc'), /did not complete/u);
});

for (const code of ['HOST_HELD', 'CLI_TOOL_INCOMPLETE', 'HFS_NODE_GOVERNOR_MISSING', 'HEAVY_DEFERRED', 'HFS_NODE_INCOMPLETE']) {
  test(`${code} stops new lint chunks, settles children already launched and preserves the same refusal`, async () => {
    const held = Object.assign(new Error('execution incomplete'), { code, exitCode: code === 'HOST_HELD' ? 75 : 2 });
    const launched: number[] = [];
    let finish: (() => void) | undefined;
    let settled = false;
    const active = new Promise<void>((resolve) => { finish = resolve; });
    const run = mapBounded([0, 1, 2, 3], async (chunk) => {
      launched.push(chunk);
      if (chunk === 0) throw held;
      await active;
      settled = true;
      return { results: [] };
    }, 2);
    await Promise.resolve();
    assert.deepEqual(launched, [0, 1]);
    assert.equal(settled, false);
    finish?.();
    await assert.rejects(run, (error) => error === held);
    assert.equal(settled, true);
    assert.deepEqual(launched, [0, 1]);
  });
}

test('ordinary lint child failures retain their measured error behavior', async () => {
  const rows = await mapBounded([0, 1], async (chunk) => {
    if (chunk === 0) throw new Error('tool unavailable');
    return { results: [1] };
  }, 1);
  assert.match(JSON.stringify(rows[0]), /tool unavailable/u);
  assert.deepEqual(rows[1], { results: [1] });
});

test('cold contract compilation admits each native worker and the async snapshot proof preserves the synchronous judgement', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-admission-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests: string[] = [];
  const emitted = await emitContractsAsync({ repoRoot: root, declaration: { apps: [{ name: 'api', kind: 'api' }] }, execute: async request => {
    assert.equal(request.kind, 'tsc');
    assert.equal(request.cwd, root);
    requests.push(path.basename(request.args[0] ?? ''));
    return { status: 0, signal: null, stderr: '', stdout: request.args[0]?.endsWith('schema-worker.mjs') ? 'type Query { ping: String }' : '{"openapi":"3.1.0"}' };
  } });
  assert.deepEqual(requests, ['schema-worker.mjs', 'operations-worker.mjs']);
  assert.deepEqual(emitted.written, ['contracts/api/schema.graphql', 'contracts/api/openapi.json']);
  const input = { repoRoot: root, files: emitted.written, repo: { profile: 'be', apps: [{ name: 'api', kind: 'api' }] }, emit: ({ outDir }: { outDir: string }) => {
    for (const file of emitted.written) {
      fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(outDir, file));
    }
    return emitted;
  } };
  const sync = contractEmitFindings(input);
  assert.deepEqual(await contractEmitFindingsAsync(input), sync);
  assert.deepEqual(sync.findings, []);
});

test('an incomplete cold contract worker cannot become a completed scoped cache record', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-incomplete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = createFakeSession({ files: {} });
  const records = new RecordSet();
  await assert.rejects(scopedStep(session, records, {
    path: 'be', step: 'contract-emit', key: 'source-key', reuse: false, inputs: [],
    compute: async () => JSON.parse(JSON.stringify(await contractEmitFindingsAsync({ repoRoot: root, files: [], repo: { profile: 'be', apps: [{ name: 'api', kind: 'api' }] }, emit: (request: Parameters<typeof emitContractsAsync>[0]) => emitContractsAsync({ ...request, execute: async () => ({ status: null, signal: null, stdout: 'partial schema', stderr: '', error: Object.assign(new Error('deadline'), { code: 'ETIMEDOUT' }) }) }) }))),
    compact: () => [],
  }), { code: 'HFS_NODE_INCOMPLETE' });
  assert.deepEqual(records.toArray(), []);
});
