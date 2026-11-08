// Spec: the release gate trusts the warm committed cache and a red nightly verify locks it.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { lockOf, readVerifyLock, VERIFY_LOCKED, VERIFY_WORKFLOW, type VerifyRun } from '../release/cache-verify-lock.mjs';
import { APP_CHECK_COMMAND, normalizeRelease, releaseGate, rowCommand } from '../release/gate.mjs';
import type { VerbContext } from '../release/index.mjs';

const HEAD = 'd'.repeat(40);
const run = (id: number, conclusion: string, createdAt: string, status = 'completed'): VerifyRun => ({ databaseId: id, status, conclusion, createdAt, url: `https://ci.example.invalid/${id}` });

/** A context whose gh answers `gh` (status and stdout, or a throw) and whose git answers a clean checkout at HEAD. */
function contextOf(t: TestContext, gh: { status: number; stdout: string } | 'throw'): { ctx: VerbContext; asked: string[][] } {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-cache-verify-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const asked: string[][] = [];
  const spawn = (command: string, args: string[]) => {
    if (command === 'gh') {
      asked.push(args);
      if (gh === 'throw') throw new Error('gh is not installed');
      return gh;
    }
    if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { status: 0, stdout: 'main' };
    if (args[0] === 'rev-parse' && args[1] === '--git-common-dir') return { status: 0, stdout: path.join(root, '.git') };
    if (args[0] === 'rev-parse') return { status: 0, stdout: HEAD };
    return { status: 0, stdout: '' };
  };
  // reason: the gate reads only cwd, spawn, now and env of the context; the rest of the stack context is not needed for a dry run.
  return { ctx: { cwd: root, spawn, now: () => 1000, env: {} } as unknown as VerbContext, asked };
}

const gate = (ctx: VerbContext, options: { full?: boolean } = {}) => {
  const { config } = normalizeRelease({ gates: [{ name: 'unit', command: ['unit-probe'] }] });
  return releaseGate(ctx, { ...config!, version: '1.0.0' }, { platform: 'linux', ...options });
};

test('the lock is open on a green newest verify or none yet, locked on a red one, and a cancelled, skipped or running run is no verdict', () => {
  assert.equal(lockOf([]).state, 'open');
  assert.match(lockOf([]).line, /no finished cache-verify\.yml run yet/u);
  assert.equal(lockOf([run(1, 'failure', '2026-11-01T00:00:00Z'), run(2, 'success', '2026-11-02T00:00:00Z')]).state, 'open');
  const red = lockOf([run(3, 'success', '2026-11-01T00:00:00Z'), run(4, 'failure', '2026-11-02T00:00:00Z'), run(5, 'cancelled', '2026-11-03T00:00:00Z'), run(6, 'skipped', '2026-11-03T00:00:00Z'), run(7, '', '2026-11-04T00:00:00Z', 'in_progress')]);
  assert.equal(red.state, 'locked');
  assert.match(red.line, new RegExp(`^${VERIFY_LOCKED}: the newest cache verify concluded failure \\(https://ci\\.example\\.invalid/4\\)`, 'u'));
  assert.equal(lockOf([{ databaseId: 9, status: 'completed' }]).state, 'locked', 'a finished run with no conclusion is no green');
  assert.match(lockOf([{ databaseId: 9, status: 'completed' }]).line, /concluded unknown \(9\)/u);
  assert.match(lockOf([{ databaseId: 8, status: 'completed', conclusion: 'success' }]).line, /green \(8\)/u);
  assert.equal(lockOf([run(10, 'success', '2026-11-02T00:00:00Z'), run(11, 'failure', '2026-11-02T00:00:00Z')]).state, 'locked', 'one instant: the higher run id is the newer');
  assert.equal(lockOf(null).state, 'unread');
});

test('the lock is read from the verify workflow of the default branch, and an unreadable answer locks', (t) => {
  const { ctx, asked } = contextOf(t, { status: 0, stdout: JSON.stringify([run(1, 'failure', '2026-11-02T00:00:00Z')]) });
  assert.equal(readVerifyLock(ctx, 'trunk').state, 'locked');
  assert.deepEqual(asked[0]?.slice(0, 6), ['run', 'list', '--workflow', VERIFY_WORKFLOW, '--branch', 'trunk']);
  assert.equal(readVerifyLock(contextOf(t, { status: 1, stdout: '' }).ctx, 'main').state, 'unread');
  assert.equal(readVerifyLock(contextOf(t, { status: 0, stdout: 'not json' }).ctx, 'main').state, 'unread');
  assert.equal(readVerifyLock(contextOf(t, { status: 0, stdout: '{}' }).ctx, 'main').state, 'unread');
  assert.equal(readVerifyLock(contextOf(t, 'throw').ctx, 'main').state, 'unread');
});

test('a red nightly verify refuses the release gate before any row runs; the full gate (--full) never reads the cache and passes the lock', async (t) => {
  const red = contextOf(t, { status: 0, stdout: JSON.stringify([run(1, 'failure', '2026-11-02T00:00:00Z')]) });
  const locked = await gate(red.ctx);
  assert.equal(locked.ok, false);
  assert.equal(locked.data!.locked, true);
  assert.match((locked.lines ?? []).join('\n'), new RegExp(`RED: ${VERIFY_LOCKED}`, 'u'));
  const full = await gate(contextOf(t, { status: 0, stdout: JSON.stringify([run(1, 'failure', '2026-11-02T00:00:00Z')]) }).ctx, { full: true });
  assert.equal(full.ok, true);
  assert.match((full.lines ?? []).join('\n'), /full gate \(--full\): the app-check row runs `app check --env prod --fresh`/u);
  const green = await gate(contextOf(t, { status: 0, stdout: JSON.stringify([run(2, 'success', '2026-11-03T00:00:00Z')]) }).ctx);
  assert.equal(green.ok, true);
  assert.match((green.lines ?? []).join('\n'), /diff-only against the committed cache; cache verify {3}green/u);
});

test('every gate row reads the warm cache by default, and only the full gate runs the app-check row as --fresh', () => {
  const check = [...APP_CHECK_COMMAND];
  assert.deepEqual(check.slice(-2), ['--env', 'prod'], 'the release gate judges as prod');
  assert.deepEqual(rowCommand(check, false), check);
  assert.deepEqual(rowCommand(check, true), [...check, '--fresh']);
  assert.deepEqual(rowCommand(['npm', 'run', 'lint'], true), ['npm', 'run', 'lint'], 'the other rows reuse the records the fresh row just wrote');
});

const onSha = (id: number, conclusion: string, createdAt: string, sha = HEAD): VerifyRun => ({ ...run(id, conclusion, createdAt), headSha: sha });

test('a green verify of the release sha, dispatched on another branch, clears a red verify of main; a newer red verify of main locks again', () => {
  const redMain = run(1, 'failure', '2026-11-06T02:00:00Z');
  const greenOnDev = onSha(2, 'success', '2026-11-08T09:00:00Z');
  const cleared = lockOf([redMain], [greenOnDev], HEAD);
  assert.equal(cleared.state, 'open');
  assert.match(cleared.line, /green for this sha \(https:\/\/ci\.example\.invalid\/2\)/u);
  assert.equal(lockOf([redMain], [], HEAD).state, 'locked', 'without a verify of this sha the red main verify stands');
  const newerRed = run(3, 'failure', '2026-11-09T02:00:00Z');
  assert.equal(lockOf([redMain, newerRed], [greenOnDev], HEAD).state, 'locked', 'a newer red verify of main locks the release again');
  assert.equal(lockOf([redMain], [onSha(4, 'failure', '2026-11-08T10:00:00Z')], HEAD).state, 'locked', 'a red verify of this very sha locks it');
  assert.match(lockOf([redMain], [onSha(4, 'failure', '2026-11-08T10:00:00Z')], HEAD).line, /newest cache verify for this sha concluded failure/u);
  assert.equal(lockOf([redMain, greenOnDev], [greenOnDev], HEAD).state, 'open', 'a run listed twice counts once');
});

test('the gate asks gh for the runs of the release sha too, and a green one on dev lets the release through a red main verify', async (t) => {
  const answers = (args: string[]): { status: number; stdout: string } => (args.includes('--commit')
    ? { status: 0, stdout: JSON.stringify([onSha(2, 'success', '2026-11-08T09:00:00Z')]) }
    : { status: 0, stdout: JSON.stringify([run(1, 'failure', '2026-11-06T02:00:00Z')]) });
  const { ctx } = contextOf(t, { status: 0, stdout: '[]' });
  const asked: string[][] = [];
  const spawn = ctx.spawn;
  // reason: the probe wraps the spawn of the test context to answer gh by its arguments.
  const probed = { ...ctx, spawn: (command: string, args: string[], options: unknown) => { if (command === 'gh') { asked.push(args); return answers(args); } return (spawn as (c: string, a: string[], o: unknown) => unknown)(command, args, options); } } as unknown as VerbContext;
  const result = await gate(probed);
  assert.equal(result.ok, true);
  assert.match((result.lines ?? []).join(String.fromCharCode(10)), /diff-only against the committed cache; cache verify {3}green for this sha/u);
  assert.ok(asked.some((args) => args.includes('--commit') && args.includes(HEAD)), 'gh was asked for the runs of the release sha');
  assert.ok(asked.some((args) => args.includes('--branch') && args.includes('main')), 'and for those of the default branch');
  assert.equal(readVerifyLock(probed, 'main', HEAD).state, 'open');
  const unreadableSha = { ...ctx, spawn: (command: string, args: string[]) => (args.includes('--commit') ? { status: 1, stdout: '' } : { status: 0, stdout: JSON.stringify([run(1, 'failure', '2026-11-06T02:00:00Z')]) }) } as unknown as VerbContext;
  assert.equal(readVerifyLock(unreadableSha, 'main', HEAD).state, 'locked', 'runs of the sha that cannot be read leave the main verdict standing');
});
