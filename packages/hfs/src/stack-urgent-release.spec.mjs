// The one-command urgent release (owner ruling urgent-typecheck-build 2026-10-30): `stack deploy --urgent --reason` with no images and no source
// commit releases HEAD (unless it already has a pushed urgent record), builds and pushes its images on this machine, and hands the digests to the
// urgent deploy; a dry run stops before anything is tagged or built, and a red step stops the chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { contextOf } from '../release/index.mjs';
import { URGENT_SCHEMA, writeUrgent } from '../release/records.mjs';
import { oneCommand, prepareUrgentRelease } from '../stack/urgent-release.mjs';

const git = (cwd, ...args) => {
  const run = spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

function repo(t) {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-urgent-one-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'one', version: '1.0.0', private: true }));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'one');
  return { root, head: git(root, 'rev-parse', 'HEAD'), ctx: contextOf({ cwd: root, env: { ...process.env } }) };
}

/** Fakes of the release push and the build that record their calls. */
function fakes({ pushOk = true, buildOk = true } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      loadReleaseConfig: () => ({ gates: [] }),
      releaseUrgentPush: async (_ctx, _config, options) => { calls.push(['push', options.execute, options.reason]); return { ok: pushOk, lines: ['urgent push'], data: {} }; },
      buildImages: async (_ctx, _config, options) => {
        calls.push(['build', options.push, options.execute]);
        return { ok: buildOk, lines: ['build'], data: { sha: 'f'.repeat(40), images: options.execute ? { api: 'ghcr.io/o/api@sha256:' + 'a'.repeat(64) } : {} } };
      },
    },
  };
}

test('only an urgent deploy naming neither images nor a source commit is the one-command form', () => {
  assert.equal(oneCommand({ urgent: true, images: {} }), true);
  assert.equal(oneCommand({ urgent: true, images: {}, sourceSha: 'a'.repeat(40) }), false);
  assert.equal(oneCommand({ urgent: true, images: { api: 'x' } }), false);
  assert.equal(oneCommand({ urgent: false, images: {} }), false);
});

test('without an urgent record of HEAD the one-command deploy needs a reason', async (t) => {
  const { ctx } = repo(t);
  const { deps } = fakes();
  await assert.rejects(prepareUrgentRelease(ctx, {}, { urgent: true, execute: true }, deps), (error) => error.code === 'STACK_URGENT_REASON_MISSING');
});

test('a dry run plans the urgent release and stops before any tag or build', async (t) => {
  const { ctx } = repo(t);
  const { deps, calls } = fakes();
  const result = await prepareUrgentRelease(ctx, {}, { urgent: true, execute: false, reason: 'hotfix' }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.images, undefined, 'no digests, so the deploy does not run');
  assert.deepEqual(calls, [['push', false, 'hotfix']]);
});

test('execute releases HEAD, builds and pushes on this machine, and hands the digests and commit to the deploy', async (t) => {
  const { ctx } = repo(t);
  const { deps, calls } = fakes();
  const result = await prepareUrgentRelease(ctx, {}, { urgent: true, execute: true, reason: 'hotfix' }, deps);
  assert.deepEqual(calls, [['push', true, 'hotfix'], ['build', true, true]]);
  assert.deepEqual(result.images, { api: 'ghcr.io/o/api@sha256:' + 'a'.repeat(64) });
  assert.equal(result.sourceSha, 'f'.repeat(40));
});

test('a pushed urgent record of HEAD is reused: no second release, straight to the build', async (t) => {
  const { ctx, root, head } = repo(t);
  writeUrgent(path.join(root, '.git', 'starci-release'), { schema: URGENT_SCHEMA, head, tag: 'v1.0.0', pushed: true, checks: [] });
  const { deps, calls } = fakes();
  const result = await prepareUrgentRelease(ctx, {}, { urgent: true, execute: true }, deps);
  assert.deepEqual(calls, [['build', true, true]]);
  assert.ok(result.lines.some((line) => /v1\.0\.0 .*reused/u.test(line)));
});

test('a red release or a red build stops the chain before the deploy', async (t) => {
  const { ctx } = repo(t);
  const red = fakes({ pushOk: false });
  const stopped = await prepareUrgentRelease(ctx, {}, { urgent: true, execute: true, reason: 'hotfix' }, red.deps);
  assert.equal(stopped.ok, false);
  assert.deepEqual(red.calls, [['push', true, 'hotfix']]);
  const broken = fakes({ buildOk: false });
  const failed = await prepareUrgentRelease(ctx, {}, { urgent: true, execute: true, reason: 'hotfix' }, broken.deps);
  assert.equal(failed.ok, false);
  assert.equal(failed.images, undefined);
});
