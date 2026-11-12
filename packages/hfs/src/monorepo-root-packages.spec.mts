// proves: HFS_MONO_WORKSPACES@lite
// proves: HFS_MONO_WORKSPACES@full
// The npm workspaces of an app are the fe ones, plus `packages/*` once the app tracks a root package (slot app.packages): the workspace the
// module packages and the agent SDK build through, which `starci app sync` leaves alone (it manages the scripts block only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ROOT_PACKAGES_WORKSPACE, WORKSPACES, monorepoFindings, workspacesFor } from '../runtime/scripts/hfs/rules/monorepo.mjs';

const repo = { project: 'demo', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { apps: [] } } };

function findings(t: test.TestContext, workspaces: string[], files: string[]): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-root-packages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', packageManager: 'npm@11.6.2', workspaces, devDependencies: { turbo: '2.9.3' } }));
  return monorepoFindings({ repoRoot: root, files: ['package.json', ...files], repo: repo as never })
    .filter((finding) => finding.code === 'HFS_MONO_WORKSPACES').map((finding) => String(finding.message));
}

test('the workspaces an app calls for: the fe ones, and packages/* once a root package tracks its package.json', () => {
  assert.deepEqual(workspacesFor(['package.json', 'be/src/a.ts']), WORKSPACES);
  assert.deepEqual(workspacesFor(['packages/sdk/package.json']), [...WORKSPACES, ROOT_PACKAGES_WORKSPACE]);
  assert.deepEqual(workspacesFor(['packages/module-loyalty/package.json', 'packages/modules/package.json']), [...WORKSPACES, 'packages/*']);
  assert.deepEqual(workspacesFor(['packages/sdk/src/package.json']), WORKSPACES, 'only a package.json at the package root counts');
});

test('an app without root packages declares exactly the fe workspaces', (t) => {
  assert.deepEqual(findings(t, [...WORKSPACES], []), []);
  assert.equal(findings(t, [...WORKSPACES, 'packages/*'], []).length, 1);
});

test('an app with a root package declares packages/* after the fe workspaces, and a root without it is refused', (t) => {
  const files = ['packages/sdk/package.json'];
  assert.deepEqual(findings(t, [...WORKSPACES, 'packages/*'], files), []);
  const refused = findings(t, [...WORKSPACES], files);
  assert.equal(refused.length, 1);
  assert.match(refused[0] ?? '', /packages\/\*/);
});
