// `starci app add app <name>` (scaffold/add-app.mts) adds one Next workspace from the skeleton and registers it in hfs.json, or
// writes nothing. It writes no Dockerfile: an image of the new app is the app's own file, never planned by the verb.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { addApp } from '../scaffold/add-app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';

const HARNESS = { version: '1.1.0-alpha.3' };

const lockedOk = (root: string): LockResult => {
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  return { ok: true };
};

/** A fresh starter in a temporary folder; its app root. */
function starter(t: TestContext): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-add-app-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({ name: 'demo', harness: HARNESS, into, presets: bundledPresets(), lock: lockedOk, initGit: init }).root;
}

const refusedWith = (code: string) => (error: unknown) => error instanceof Error && (error as Error & { code?: string }).code === code;

test('an app gains a Next workspace, registered in hfs.json', (t) => {
  const root = starter(t);
  const result = addApp({ root, name: 'admin' });
  assert.deepEqual(result.registered, { app: 'admin', workspace: 'fe/apps/*' });
  assert.ok(!result.created.includes('fe/apps/admin/Dockerfile'));
  assert.ok(result.created.includes('fe/apps/admin/package.json'));
  assert.ok(fs.existsSync(path.join(root, 'fe', 'apps', 'admin', 'tsconfig.json')));
  const declaration = JSON.parse(fs.readFileSync(path.join(root, 'hfs.json'), 'utf8'));
  assert.ok(declaration.sides.fe.apps.some((app: { name: string; kind: string }) => app.name === 'admin' && app.kind === 'next'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'fe', 'apps', 'admin', 'package.json'), 'utf8')).name, '@demo/admin');
});

test('add app refuses a bad name, a folder that is no app, a declared name, an existing folder and an app with no Next source', (t) => {
  const root = starter(t);
  assert.throws(() => addApp({ root, name: 'Admin_App' }), refusedWith('HFS_ADD_NAME_INVALID'));
  assert.throws(() => addApp({ root: path.join(root, 'be'), name: 'admin' }), refusedWith('HFS_ADD_NOT_AN_APP'));
  assert.throws(() => addApp({ root, name: 'web' }), refusedWith('HFS_ADD_EXISTS'));
  fs.mkdirSync(path.join(root, 'fe', 'apps', 'admin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fe', 'apps', 'admin', 'package.json'), '{}\n');
  assert.throws(() => addApp({ root, name: 'admin' }), refusedWith('HFS_ADD_EXISTS'));
  fs.rmSync(path.join(root, 'fe', 'apps', 'web', 'package.json'));
  assert.throws(() => addApp({ root, name: 'ops' }), refusedWith('HFS_ADD_APP_PACKAGE_SOURCE'));
});

test('add app that cannot write a file removes what it wrote and leaves hfs.json and package.json as they were', (t) => {
  const root = starter(t);
  const before = ['hfs.json', 'package.json'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  // A file where the workspace's src/ folder goes: no planned path exists yet, so the clash check passes, next.config.ts is written and the
  // first write under src/ fails.
  fs.mkdirSync(path.join(root, 'fe', 'apps', 'admin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fe', 'apps', 'admin', 'src'), 'not a folder\n');
  assert.throws(() => addApp({ root, name: 'admin' }));
  assert.equal(fs.existsSync(path.join(root, 'fe', 'apps', 'admin')), false);
  assert.deepEqual(['hfs.json', 'package.json'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')), before);
});
