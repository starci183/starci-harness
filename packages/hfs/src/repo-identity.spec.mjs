// repo-identity.spec.mjs - a repository is named by its origin remote, whatever folder it is cloned into: the README
// title (HFS_README_TITLE_INVALID) and the stack project name read repositoryName, so a clone into a folder of another
// name must not change them. The folder names it only when no origin remote does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repositoryName } from '../runtime/scripts/hfs/repo-identity.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid', ...args], { stdio: 'ignore' });

/** A repository with one commit in `<base>/<folder>`, with `origin` set when given. */
function repository(base, folder, origin) {
  const dir = path.join(base, folder);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"@scope/package-name"}\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}

test('the origin remote names a clone, not the folder it is cloned into', (t) => {
  const base = mkdtemp(t, 'starci-repo-identity-');
  for (const origin of ['https://github.com/acme/starci-next.git', 'git@github.com:acme/starci-next.git', 'https://github.com/acme/starci-next/']) {
    const dir = repository(base, `clone-${fs.readdirSync(base).length}`, origin);
    assert.equal(repositoryName(dir), 'starci-next', origin);
  }
});

test('a worktree of a clone carries the origin name too', (t) => {
  const base = mkdtemp(t, 'starci-repo-identity-');
  const main = repository(base, 'checkout-folder', 'https://github.com/acme/starci-next.git');
  const lane = path.join(base, 'lanes', 'lane-1');
  git(main, 'worktree', 'add', '-q', '-b', 'lane-1', lane);
  assert.equal(repositoryName(lane), 'starci-next');
});

test('without an origin remote the main checkout folder names the repository and its worktrees', (t) => {
  const base = mkdtemp(t, 'starci-repo-identity-');
  const main = repository(base, 'local-product');
  const lane = path.join(base, 'lanes', 'lane-1');
  git(main, 'worktree', 'add', '-q', '-b', 'lane-1', lane);
  assert.equal(repositoryName(main), 'local-product');
  assert.equal(repositoryName(lane), 'local-product');
});

test('a folder inside a repository is named by its own folder, and a folder outside Git by its package', (t) => {
  const base = mkdtemp(t, 'starci-repo-identity-');
  const main = repository(base, 'host', 'https://github.com/acme/host.git');
  const nested = path.join(main, 'examples', 'nested-product');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(repositoryName(nested), 'nested-product');
  const loose = path.join(base, 'loose');
  fs.mkdirSync(loose);
  fs.writeFileSync(path.join(loose, 'package.json'), '{"name":"@scope/loose-product"}\n');
  assert.equal(repositoryName(loose), 'loose-product');
});
