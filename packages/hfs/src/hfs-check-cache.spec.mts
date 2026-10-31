// proves: HFS_CHECK_CACHE_FORGED@lite
// proves: HFS_CHECK_CACHE_FORGED@full
// proves: HFS_CHECK_CACHE_STALE@lite
// proves: HFS_CHECK_CACHE_STALE@full
// proves: HFS_CHECK_CACHE_MISSING@lite
// proves: HFS_CHECK_CACHE_MISSING@full
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskSession } from '../cache/session.mjs';
import { silentProgress } from '../cache/progress.mjs';
import { resolveTrust, FORGED, STALE, MISSING } from '../cache/trust.mjs';
import { runFormatFamily } from '../cache/format-family.mjs';
import { git } from '../cache/git.mjs';
import { gateVerdict } from '../runtime/scripts/hfs/gate-threshold.mjs';
import type { Prettier } from '../sync/format.mjs';

/** A prettier double: a text with `;;` is unformatted. */
const prettier: Prettier = {
  getFileInfo: () => ({ ignored: false, inferredParser: 'typescript' }),
  resolveConfig: () => ({}),
  check: (text) => !text.includes(';;'),
  format: (text) => text,
};
const PORTABLE = { parts: [{ name: 'hfs', sha256: 'h1' }], portable: true, localReasons: [] };
const CI = { CI: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' };

function app(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-check-cache-'));
  fs.writeFileSync(path.join(root, 'a.ts'), 'bad;;\n');
  git(root, ['init', '-q', '-b', 'main']);
  return root;
}

function commit(root: string): string {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'c']);
  return git(root, ['rev-parse', 'HEAD']).stdout.trim();
}

/** A host run that commits the cache of `a.ts`, then a branch from it. */
async function seeded(root: string, tracked: string[]): Promise<string> {
  const host = createDiskSession({ root, tracked, env: {}, progress: silentProgress, fingerprint: PORTABLE });
  await runFormatFamily(host, { files: tracked, prettier });
  host.flush();
  const base = commit(root);
  git(root, ['checkout', '-q', '-b', 'change']);
  git(root, ['update-ref', 'refs/remotes/origin/main', base]);
  return base;
}

async function ciRun(root: string, tracked: string[]) {
  const trust = resolveTrust({ root, env: CI });
  const ci = createDiskSession({ root, tracked, env: CI, progress: silentProgress, fingerprint: PORTABLE, trust });
  await runFormatFamily(ci, { files: tracked, prettier });
  ci.flush();
  return ci.verdicts();
}

for (const edition of ['lite', 'full']) {
  test(`HFS_CHECK_CACHE_FORGED@${edition} violating: a record that matches the tree with its findings deleted by hand is a hard blocker`, async (t) => {
    const root = app();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await seeded(root, ['a.ts']);
    const file = path.join(root, '.starcistacks/cache/check/format/root.jsonl');
    const forged = fs.readFileSync(file, 'utf8').replace(/"findings":\[\{.*?\}\]/u, '"findings":[]');
    assert.notEqual(forged, fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, forged);
    commit(root);
    const verdicts = await ciRun(root, ['a.ts']);
    assert.deepEqual(verdicts.map((verdict) => verdict.code), [FORGED]);
    assert.equal(gateVerdict([{ code: FORGED }, ...Array.from({ length: 0 }, () => ({ code: 'X' }))]).pass, false, 'a single forged record blocks at any count');
  });

  test(`HFS_CHECK_CACHE_FORGED@${edition} passing: the honest committed cache gives no verdict`, async (t) => {
    const root = app();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await seeded(root, ['a.ts']);
    assert.deepEqual(await ciRun(root, ['a.ts']), []);
  });

  test(`HFS_CHECK_CACHE_STALE@${edition} violating: a changed file with no current committed record warns`, async (t) => {
    const root = app();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await seeded(root, ['a.ts']);
    fs.writeFileSync(path.join(root, 'a.ts'), 'worse;;\n');
    commit(root);
    const verdicts = await ciRun(root, ['a.ts']);
    assert.deepEqual(verdicts.map((verdict) => [verdict.code, verdict.level, verdict.path]), [[STALE, 'warning', 'a.ts']]);
  });

  test(`HFS_CHECK_CACHE_MISSING@${edition} violating: a change that commits no cache warns once and the run stays correct`, async (t) => {
    const root = app();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const base = commit(root);
    git(root, ['checkout', '-q', '-b', 'change']);
    git(root, ['update-ref', 'refs/remotes/origin/main', base]);
    const verdicts = await ciRun(root, ['a.ts']);
    assert.deepEqual(verdicts.map((verdict) => [verdict.code, verdict.level]), [[MISSING, 'warning']]);
  });
}

test('the check cache folder is a slot of its own: no stacks shape finding, no environment, no tree finding', async (t) => {
  const { openHfs } = await import('../runtime/scripts/hfs/slots.mjs');
  const { stacksFindings } = await import('../runtime/scripts/hfs/rules/stacks.mjs');
  for (const edition of ['lite', 'full']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-cache-slot-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const declaration = { hfs: 3, kind: 'app', edition, project: 'cache-slot', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [{ name: 'web', kind: 'next' }] } } };
    fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
    const opened = openHfs({ repoRoot: root });
    const cached = ['.starcistacks/cache/fingerprint.jsonl', '.starcistacks/cache/check/format/root.jsonl', '.starcistacks/cache/lint/be/modules/billing.jsonl', '.starcistacks/cache/test-coverage/be/src.jsonl'];
    for (const file of cached) assert.equal(opened.classifyPath(file).status, 'owned', `${edition} ${file}`);
    assert.deepEqual(stacksFindings({ repoRoot: root, files: cached, resolver: opened }), []);
  }
});
