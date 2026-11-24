// The per-host state base of @starci/hfs: a checkout keeps it in <runtime root>/.runtime, an installed copy below a
// node_modules folder keeps it outside every package (installedStateBase), so `npm ci` never deletes a
// running stack's data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_ROOT_ENV, installedRoot, installedStateBase, runtimeStateDir, starciLocalRoot } from '../runtime/engine/runtime-root.mjs';

const temp = (t: { after(fn: () => void): void }): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-state-base-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/** An installed copy below node_modules and a per-user state folder, both in a temp tree. */
const installed = (t: { after(fn: () => void): void }) => {
  const dir = temp(t);
  const root = path.join(dir, 'app', 'node_modules', '@starci', 'hfs', 'runtime');
  fs.mkdirSync(root, { recursive: true });
  const env = { XDG_STATE_HOME: path.join(dir, 'user') };
  return { dir, root, env, base: path.join(dir, 'user', 'starci-harness', 'state') };
};

test('a checkout keeps its state in .runtime, an installed copy outside every package, and STARCI_LOCAL_ROOT replaces both', (t) => {
  const { dir, root, env, base } = installed(t);
  const checkout = path.join(dir, 'harness', 'packages', 'hfs', 'runtime');
  assert.equal(installedRoot(checkout), false);
  assert.equal(installedRoot(root), true);
  assert.equal(starciLocalRoot(env, checkout), runtimeStateDir(checkout));
  assert.equal(starciLocalRoot(env, root), base);
  assert.equal(starciLocalRoot({ ...env, [LOCAL_ROOT_ENV]: path.join(dir, 'probe') }, root), path.join(dir, 'probe'));
});

test('the base is XDG_STATE_HOME, else ~/.local/state, on every platform: never %LOCALAPPDATA%, which an MSIX-packaged app virtualizes', () => {
  assert.equal(installedStateBase({ LOCALAPPDATA: path.join(os.tmpdir(), 'appdata') }), path.join(os.homedir(), '.local', 'state', 'starci-harness', 'state'));
  assert.equal(installedStateBase({ XDG_STATE_HOME: path.join(os.tmpdir(), 'xdg') }), path.join(os.tmpdir(), 'xdg', 'starci-harness', 'state'));
  assert.equal(installedStateBase({}), path.join(os.homedir(), '.local', 'state', 'starci-harness', 'state'));
});
