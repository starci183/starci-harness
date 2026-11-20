// The base a lane's gallery coupling and UI audit judge from (lint/ratchet.mts landingBase): off main and dev, the merge-base of HEAD with STARCI_BASE_REF,
// else origin/dev, else origin/main. A lane with no commit of its own yet sits on origin/dev's tip: its base is HEAD (only the work tree is judged), never
// the merge-base with origin/main, which judged all of dev's history since main as the lane's own.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { landingBase } from '../lint/ratchet.mjs';

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};
const commit = (root: string, name: string): string => {
  fs.writeFileSync(path.join(root, `${name}.txt`), name);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', name);
  return git(root, 'rev-parse', 'HEAD');
};

/** main at m1, dev two commits on (d1, d2), refs/remotes/origin/{main,dev} at them, and the lane branch checked out at dev's tip. */
function repo(t: TestContext): { root: string; main: string; dev: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-landing-base-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'n');
  git(root, 'config', 'commit.gpgsign', 'false');
  const main = commit(root, 'm1');
  git(root, 'update-ref', 'refs/remotes/origin/main', main);
  git(root, 'switch', '-q', '-c', 'dev');
  commit(root, 'd1');
  const dev = commit(root, 'd2');
  git(root, 'update-ref', 'refs/remotes/origin/dev', dev);
  git(root, 'switch', '-q', '-c', 'lane/x');
  return { root, main, dev };
}

test('a lane with no commit of its own is judged from HEAD, not from its merge-base with origin/main', (t) => {
  const { root, dev } = repo(t);
  const landing = landingBase(root, {}, 'lane/x');
  assert.equal(landing.base, dev);
  assert.match(landing.source, /origin\/dev already holds/u);
});

test('a lane with its own commits is judged from its merge-base with origin/dev, and STARCI_BASE_REF names another ref', (t) => {
  const { root, main, dev } = repo(t);
  commit(root, 'l1');
  assert.equal(landingBase(root, {}, 'lane/x').base, dev);
  assert.equal(landingBase(root, { STARCI_BASE_REF: 'origin/main' }, 'lane/x').base, main);
});
