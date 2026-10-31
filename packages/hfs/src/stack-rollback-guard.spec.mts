// The manual rollback guard: a rollback to a release older than an applied contract migration is refused unless the owner acknowledges the data effect,
// judged from the contract marker each journaled attempt carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractFinding, enforceContractGuard } from '../stack/rollback-guard.mjs';
import { rollbackRelease } from '../stack/deploy.mjs';
import type { DeployDeps } from '../stack/deploy.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import { openAttempt } from '../stack/journal.mjs';
import { recordsDouble } from './stack-records-double.mjs';

const [Q, P, C, D] = ['1', '2', '3', '4'].map((digit) => digit.repeat(16)) as [string, string, string, string];
const at = (n: number) => `2026103${n}T000000Z-0000000${n}`;
/** One journaled attempt that accepted `release` and applied `contract` migrations after it. */
const accepted = (n: number, release: string, contract: string[] = []) => ({ attempt: at(n), kind: 'deploy', releaseId: release, phases: [{ phase: 'lock', verdict: 'ok' }, { phase: 'accept', verdict: 'ok' }], contract });

test('no contract migration in the journal blocks nothing', () => {
  assert.equal(contractFinding([accepted(1, Q), accepted(2, P), accepted(3, C)], Q).blocked, false);
  assert.equal(contractFinding([], Q).blocked, false);
});

test('a contract migration is safe for the release that ran it and the one before it, and blocks every older one', () => {
  const journal = [accepted(1, Q), accepted(2, P), accepted(3, C, ['20261031_contract_drop_x'])];
  assert.equal(contractFinding(journal, C).blocked, false);
  assert.equal(contractFinding(journal, P).blocked, false, 'the previous release is what the deploy guaranteed it for');
  const older = contractFinding(journal, Q);
  assert.equal(older.blocked, true);
  assert.deepEqual(older.migrations, ['20261031_contract_drop_x']);
  assert.match(older.reason, /20261031_contract_drop_x/u);
});

test('a release the journal never saw is blocked once any contract migration is recorded', () => {
  const finding = contractFinding([accepted(1, P), accepted(2, C, ['m_contract'])], D);
  assert.equal(finding.blocked, true);
  assert.match(finding.reason, /no record/u);
});

test('a rollback is one more acceptance: after rolling back to P, Q stays blocked and P and C are free', () => {
  const journal = [accepted(1, Q), accepted(2, P), accepted(3, C, ['m_contract']), accepted(4, P)];
  assert.equal(contractFinding(journal, Q).blocked, true);
  assert.equal(contractFinding(journal, P).blocked, false);
  assert.equal(contractFinding(journal, C).blocked, false);
});

test('a document that never accepted, or carries no usable evidence, is ignored', () => {
  const failed = { attempt: at(3), kind: 'deploy', releaseId: C, phases: [{ phase: 'deploy', verdict: 'failed' }], contract: ['m_contract'] };
  assert.equal(contractFinding([accepted(1, Q), accepted(2, P), failed, { junk: true }, { releaseId: 7, phases: 'x' }], Q).blocked, false);
});

test('the guard refuses STACK_ROLLBACK_CONTRACT unless the data effect is acknowledged, and then says so', () => {
  const finding = contractFinding([accepted(1, Q), accepted(2, P), accepted(3, C, ['m_contract'])], Q);
  assert.throws(() => enforceContractGuard(finding, false), (error: { code?: string; message?: string }) => error.code === 'STACK_ROLLBACK_CONTRACT' && /--data-acknowledged/u.test(error.message ?? ''));
  assert.match(enforceContractGuard(finding, true).join(' '), /--data-acknowledged/u);
  assert.deepEqual(enforceContractGuard(contractFinding([], Q), false), []);
});

// reason: the rollback verb reads the few members these doubles give; the full context and config shapes are not needed.
const contextOf = (seams: object): StackContext => seams as unknown as StackContext;
const configOf = (fields: object): DeployConfig => fields as unknown as DeployConfig;

function rollbackWorld(history: Record<string, unknown>[]) {
  const records = recordsDouble({ history });
  const touched: string[] = [];
  const store = {
    current: async () => C, previous: async () => P, accept: async () => {}, store: async () => {},
    fetch: async (_id: string, dir: string) => { touched.push('fetch'); return dir; },
    ...records,
  };
  const deps = { releaseStore: () => store, ssh: async () => ({ cleanup() {} }) } as unknown as Partial<DeployDeps>;
  const ctx = contextOf({ spawn: () => ({ status: 0, stdout: '', stderr: '' }), env: {}, now: () => 1000, sleep: async () => {} });
  return { records, touched, deps, ctx, config: configOf({ stack: 'shop', env: 'production' }) };
}

test('stack rollback --release <older> is refused after a contract migration, even as a dry run, and nothing is fetched or journaled', async () => {
  const { records, touched, deps, ctx, config } = rollbackWorld([accepted(1, Q), accepted(2, P), accepted(3, C, ['m_contract'])]);
  for (const execute of [false, true]) {
    await assert.rejects(rollbackRelease(ctx, config, { release: Q, execute }, deps), (error: { code?: string }) => error.code === 'STACK_ROLLBACK_CONTRACT');
  }
  assert.deepEqual(touched, []);
  assert.equal(records.documents.size, 0);
});

test('the default rollback target (the previous release) is not blocked, and --data-acknowledged lets the older one through with a notice', async () => {
  const world = rollbackWorld([accepted(1, Q), accepted(2, P), accepted(3, C, ['m_contract'])]);
  const dry = await rollbackRelease(world.ctx, world.config, { execute: false }, world.deps);
  assert.equal(dry.ok, true);
  const older = await rollbackRelease(world.ctx, world.config, { release: Q, execute: false, dataAcknowledged: true }, world.deps);
  assert.equal(older.ok, true);
  assert.match(older.lines.join('\n'), /--data-acknowledged: rolling back past m_contract/u);
});

test('an attempt records the contract migrations it applied as its marker', async () => {
  const records = recordsDouble();
  const store = { ...records } as unknown as Parameters<typeof openAttempt>[2];
  const ctx = contextOf({ env: {}, now: () => Date.UTC(2026, 9, 31, 8, 30, 15) });
  const recorder = await openAttempt(ctx, configOf({ stack: 'shop', env: 'production' }), store, { kind: 'deploy', trigger: 'ci' });
  assert.deepEqual(records.documents.get(recorder.id)?.contract, []);
  recorder.note({ contract: ['20261031_contract_drop_x'] });
  await recorder.phase('contract', async () => 1);
  assert.deepEqual(records.documents.get(recorder.id)?.contract, ['20261031_contract_drop_x']);
});
