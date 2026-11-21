// `stack up` clears a front end's `.next` only when its route folders moved since the last up (a route group renamed from `(auth)` to `(entry)` kept
// serving the old groups out of next dev's cache), never while a process of the environment still runs, and keeps it when the tree is unchanged.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearMovedRoutes, routeTreeDigest } from '../stack/local-up.mjs';
import { readRecord, writeRecord } from '../stack/local-state.mjs';
import { stateOf } from '../stack/local-run.mjs';
import type { StackContext } from '../stack/context.mjs';
import type { LocalConfig } from '../stack/local-config.mjs';

function setup(t: TestContext): { ctx: StackContext; local: LocalConfig; root: string; next: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'app', 'fe', 'apps', 'web', 'src', 'app', '[locale]', '(auth)', 'sign-in'), { recursive: true });
  const next = path.join(root, 'app', 'fe', 'apps', 'web', '.next');
  fs.mkdirSync(path.join(next, 'server'), { recursive: true });
  const ctx = { env: { STARCI_LOCAL_ROOT: path.join(root, 'state') } } as unknown as StackContext;
  const local = { repoRoot: path.join(root, 'app'), project: 'demo', env: 'dev' } as unknown as LocalConfig;
  return { ctx, local, root, next };
}

const rename = (root: string, from: string, to: string): void => fs.renameSync(path.join(root, 'app', 'fe', 'apps', 'web', 'src', 'app', '[locale]', from), path.join(root, 'app', 'fe', 'apps', 'web', 'src', 'app', '[locale]', to));

test('the route tree digest reads folder names only: a file edit keeps it, a moved route group changes it', (t) => {
  const { root } = setup(t);
  const web = path.join(root, 'app', 'fe', 'apps', 'web');
  const before = routeTreeDigest(web);
  fs.writeFileSync(path.join(web, 'src', 'app', '[locale]', '(auth)', 'sign-in', 'page.tsx'), 'export default () => null\n');
  assert.equal(routeTreeDigest(web), before);
  rename(root, '(auth)', '(entry)');
  assert.notEqual(routeTreeDigest(web), before);
  assert.equal(routeTreeDigest(path.join(root, 'nothing')), null);
});

test('up clears .next once for an unrecorded tree, keeps it while the tree holds, and clears it again when a route group moved', async (t) => {
  const { ctx, local, root, next } = setup(t);
  assert.deepEqual(await clearMovedRoutes(ctx, local), ['routes: fe/apps/web route folders changed since the last up; cleared its .next']);
  assert.equal(fs.existsSync(next), false);
  fs.mkdirSync(next);
  assert.deepEqual(await clearMovedRoutes(ctx, local), [], 'an unchanged tree keeps its cache');
  assert.equal(fs.existsSync(next), true);
  rename(root, '(auth)', '(entry)');
  assert.equal((await clearMovedRoutes(ctx, local)).length, 1);
  assert.equal(fs.existsSync(next), false);
  assert.ok(readRecord(stateOf(ctx, local)).receipts.routes?.['fe/apps/web'] !== undefined, 'the digest is recorded in the dev state');
});

test('while a process of the environment runs, .next is kept and nothing is recorded', async (t) => {
  const { ctx, local, next } = setup(t);
  const dir = stateOf(ctx, local);
  const record = readRecord(dir);
  record.processes['web'] = { pid: 4242, startedAt: '2026-11-21T00:00:00.000Z', port: null };
  writeRecord(dir, record);
  const lines = await clearMovedRoutes(ctx, local, { alive: () => true });
  assert.match(lines.join('\n'), /\.next kept while process web runs/u);
  assert.equal(fs.existsSync(next), true);
  assert.equal(readRecord(dir).receipts.routes, undefined);
  assert.equal((await clearMovedRoutes(ctx, local, { alive: () => false })).length, 1, 'once it stopped, the next up clears it');
  assert.equal(fs.existsSync(next), false);
});
