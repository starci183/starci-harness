// proves: HFS_DEV_BRANCH_MISSING@lite
// proves: HFS_DEV_BRANCH_MISSING@full
// An app repository keeps main and dev (contexts/project/branches.md PROJECT-BRANCH-1): the whole app check warns when dev is missing, and never asks the harness repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_BRANCH_MISSING, devBranchFinding } from '../runtime/scripts/hfs/dev-branch.mjs';
import { git } from './helpers/pre-push-fixture.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const repo = (t: Parameters<typeof mkdtemp>[0], kind: string) => {
  const root = mkdtemp(t, 'starci-dev-branch-');
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind, project: 'fixture' }));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'first');
  return root;
};

test('an app with no dev branch, local or origin, is warned; either one silences it', t => {
  const root = repo(t, 'app');
  const found = devBranchFinding(root);
  assert.equal(found?.code, DEV_BRANCH_MISSING);
  assert.equal(found?.level, 'warning');
  assert.match(found?.message ?? '', /an app keeps exactly main and dev/);
  git(root, 'branch', 'dev');
  assert.equal(devBranchFinding(root), null);
  git(root, 'branch', '-D', 'dev');
  git(root, 'update-ref', 'refs/remotes/origin/dev', 'HEAD');
  assert.equal(devBranchFinding(root), null, 'origin/dev counts');
});

test('the harness repository (kind runtime), a directory with no git history and one with no hfs.json are never warned', t => {
  assert.equal(devBranchFinding(repo(t, 'runtime')), null);
  assert.equal(devBranchFinding(mkdtemp(t, 'starci-dev-branch-empty-')), null);
});
