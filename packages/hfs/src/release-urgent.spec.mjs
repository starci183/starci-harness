// The urgent release path (owner ruling urgent-release 2026-10-29), on a real git repository and a bare remote: `release push --urgent` runs the
// fast local checks (typecheck and the build, owner ruling urgent-typecheck-build 2026-10-30), tags and pushes atomically and writes the URGENT record; `release gate --backfill <tag>` runs the full gate on that commit,
// promoting the record to L4 when green and opening a fix ticket when red; a file a declared dev server rewrites never makes the tree dirty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { contextOf } from '../release/index.mjs';
import { dirtyPaths, normalizeRelease, releaseGate } from '../release/gate.mjs';
import { readUrgent } from '../release/records.mjs';
import { releaseUrgentPush } from '../release/urgent.mjs';

const git = (cwd, ...args) => {
  const run = spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

const GATES = (red = []) => ['typecheck', 'build-be', 'app-check', 'lint', 'test'].map((name) => ({ name, command: ['node', red.includes(name) ? 'fail.mjs' : 'ok.mjs'] }));

/** An app repository at version 1.0.0 with a bare origin; `red` names the gates that fail. Returns { root, remote, head, config, ctx }. */
function app(t, red = []) {
  const base = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'app');
  const remote = path.join(base, 'remote.git');
  fs.mkdirSync(root);
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'init', '-q', '-b', 'main');
  // The release code tags with plain `git`, so the scratch repository carries its own identity: a runner has no global one.
  for (const [key, value] of [['user.email', 'bench@example.invalid'], ['user.name', 'bench'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']]) git(root, 'config', key, value);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'urgent-app', version: '1.0.0', private: true }));
  fs.writeFileSync(path.join(root, 'ok.mjs'), 'process.exit(0)\n');
  fs.writeFileSync(path.join(root, 'fail.mjs'), "process.stderr.write('red on purpose\\n'); process.exit(1)\n");
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'release 1.0.0');
  git(root, 'remote', 'add', 'origin', remote);
  const { config } = normalizeRelease({ gates: GATES(red) }, {}, { audit: { mode: 'disabled' } });
  return { root, remote, head: git(root, 'rev-parse', 'HEAD'), config: { ...config, version: '1.0.0' }, ctx: contextOf({ cwd: root, env: { ...process.env } }) };
}

const common = (root) => path.join(root, '.git', 'starci-release');

test('an urgent release without a reason is refused before anything runs', async (t) => {
  const { ctx, config } = app(t);
  await assert.rejects(releaseUrgentPush(ctx, config, { execute: true, reason: '  ' }), (error) => error.code === 'RELEASE_URGENT_REASON_MISSING');
});

test('urgent push runs the fast checks, tags and pushes atomically, and writes the URGENT record', async (t) => {
  const { ctx, config, root, remote, head } = app(t, ['app-check', 'lint', 'test']);
  const result = await releaseUrgentPush(ctx, config, { execute: true, reason: 'CI budget exhausted', role: 'owner' });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), head);
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v1.0.0^{commit}'), head);
  const record = readUrgent(common(root), head);
  assert.equal(record.reason, 'CI budget exhausted');
  assert.equal(record.role, 'owner');
  assert.equal(record.pushed, true);
  assert.deepEqual(record.checks.map((row) => [row.name, row.pass]), [['typecheck', true], ['build-be', true]]);
  assert.equal(record.checks.some((row) => ['app-check', 'lint', 'test'].includes(row.name)), false, 'app check, lint and the tests wait for the back-fill, red or not');
});

test('--lint-baseline is retired with lint itself: refused before anything runs', async (t) => {
  const { ctx, config } = app(t);
  await assert.rejects(releaseUrgentPush(ctx, config, { execute: true, reason: 'hotfix', lintBaseline: 'v0.9.0' }), (error) => error.code === 'RELEASE_URGENT_LINT_BASELINE_RETIRED');
});

test('a red fast check refuses the urgent release: nothing tagged, nothing pushed', async (t) => {
  const { ctx, config, root, remote } = app(t, ['typecheck']);
  await assert.rejects(releaseUrgentPush(ctx, config, { execute: true, reason: 'hotfix' }), (error) => error.code === 'RELEASE_URGENT_CHECK_RED');
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/tags/v1.0.0'], { cwd: root }).status, 1);
  assert.equal(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: remote }).status, 1);
});

test('a green row the gate recorded for HEAD is reused, not run again', async (t) => {
  const { ctx, config, root } = app(t, ['test']);
  await releaseGate(ctx, config, { execute: true, platform: process.platform });
  const result = await releaseUrgentPush(ctx, config, { execute: true, reason: 'gate red on test only' });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(readUrgent(common(root), git(root, 'rev-parse', 'HEAD')).checks.every((row) => row.reused === true));
});

test('back-fill green promotes the urgent record to L4 with no new tag and no push', async (t) => {
  const { ctx, config, root, remote, head } = app(t);
  await releaseUrgentPush(ctx, config, { execute: true, reason: 'tonight' });
  const before = git(remote, 'for-each-ref');
  const result = await releaseGate(ctx, config, { execute: true, backfill: 'v1.0.0', platform: process.platform, openTicket: () => assert.fail('no ticket on green') });
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.equal(result.data.promoted, true);
  const l4 = JSON.parse(fs.readFileSync(path.join(common(root), `${head}.l4.json`), 'utf8'));
  assert.equal(l4.promotedFrom.reason, 'tonight');
  assert.equal(readUrgent(common(root), head).backfill.state, 'promoted');
  assert.equal(git(remote, 'for-each-ref'), before, 'the remote is untouched');
  const again = await releaseGate(ctx, config, { execute: true, backfill: 'v1.0.0', platform: process.platform });
  assert.equal(again.data.promoted, true);
  assert.equal(again.data.executed, false, 'a promoted release is not judged twice');
});

test('back-fill red opens one fix ticket and changes nothing else', async (t) => {
  const { ctx, config, root, head } = app(t, ['lint']);
  await releaseUrgentPush(ctx, config, { execute: true, reason: 'tonight' });
  const tickets = [];
  const result = await releaseGate(ctx, config, { execute: true, backfill: 'v1.0.0', platform: process.platform, openTicket: (input) => { tickets.push(input); return 'tk-000000000001'; } });
  assert.equal(result.ok, false);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].code, 'RELEASE_BACKFILL_RED');
  assert.match(tickets[0].title, /lint/u);
  assert.equal(fs.existsSync(path.join(common(root), `${head}.l4.json`)), false);
  assert.deepEqual(readUrgent(common(root), head).backfill, { ...readUrgent(common(root), head).backfill, state: 'red', ticket: 'tk-000000000001', failed: ['lint'] });
});

test('back-fill refuses a tag that is not HEAD or not an urgent release', async (t) => {
  const { ctx, config } = app(t);
  await assert.rejects(releaseGate(ctx, config, { execute: true, backfill: 'v9.9.9' }), (error) => error.code === 'RELEASE_BACKFILL_TAG_UNKNOWN');
  const gated = await releaseGate(ctx, config, { execute: true, platform: process.platform });
  assert.equal(gated.ok, true, gated.lines.join('\n'));
  await assert.rejects(releaseGate(ctx, config, { execute: true, backfill: 'v1.0.0' }), (error) => error.code === 'RELEASE_BACKFILL_NOT_URGENT');
});

test('an untracked AGENTS.md next dev rewrote in an fe app is no dirt; any other untracked file is', (t) => {
  const { ctx, root } = app(t);
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'full', project: 'urgent-app', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } }));
  git(root, 'add', 'hfs.json');
  git(root, 'commit', '-q', '-m', 'declare');
  fs.mkdirSync(path.join(root, 'fe', 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fe', 'apps', 'web', 'AGENTS.md'), 'written by next dev\n');
  assert.deepEqual(dirtyPaths(ctx), []);
  fs.writeFileSync(path.join(root, 'fe', 'apps', 'web', 'NOTES.md'), 'mine\n');
  assert.deepEqual(dirtyPaths(ctx), ['?? fe/apps/web/NOTES.md']);
});
