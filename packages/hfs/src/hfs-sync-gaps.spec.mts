// Three gaps an app showed (lane hfs-sync-gaps): the lockfile of a managed sub-package after `starci app sync` renders its package.json, the lite starter's
// statics/ and seed levels, and a gallery that fails inside `stack up` while the api and the web are fine.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundledPresets, runSync } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { NESTED_LOCK_STEP, lockDifference, nestedLockDrift, nestedLockFix, nestedPackageDirs } from '../sync/nested-lock.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { isAdvisoryRow, loadLocalConfig } from '../stack/local-config.mjs';
import { runSetup } from '../stack/local-prepare.mjs';
import { waitReady } from '../stack/local-up.mjs';
import { stackContext } from '../stack/context.mjs';
import type { StackIo } from '../stack/context.mjs';

const at = (root: string, ...parts: string[]): string => path.join(root, ...parts);

function starter(t: TestContext, edition = 'lite'): string {
  const into = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sync-gaps-'));
  t.after(() => fs.rmSync(into, { recursive: true, force: true }));
  return scaffoldApp({ name: 'demo', harness: { version: '1.1.0-alpha.3' }, into, edition, presets: bundledPresets(), lock: (root) => { fs.writeFileSync(at(root, 'package-lock.json'), '{}\n'); return { ok: true }; }, initGit: init }).root;
}

/** The gallery lockfile an earlier render left: it records vite alone, not the @starci/gallery the render now adds. */
const staleGalleryLock = (root: string): void => {
  const manifest = JSON.parse(fs.readFileSync(at(root, 'gallery', 'package.json'), 'utf8'));
  const { vite } = manifest.devDependencies;
  fs.writeFileSync(at(root, 'gallery', 'package-lock.json'), `${JSON.stringify({ name: manifest.name, lockfileVersion: 3, requires: true, packages: { '': { name: manifest.name, devDependencies: { vite } } } })}\n`);
};

test('lockDifference names the dependency ranges the lockfile does not record, and a lockfile with no root entry', () => {
  const manifest = { dependencies: { a: '1.0.0' }, devDependencies: { b: '2.0.0', c: '3.0.0' } };
  assert.deepEqual(lockDifference(manifest, { packages: { '': { dependencies: { a: '1.0.0' }, devDependencies: { b: '2.0.0', c: '3.0.0' } } } }), []);
  assert.deepEqual(lockDifference(manifest, { packages: { '': { dependencies: { a: '1.0.0' }, devDependencies: { b: '2.1.0', z: '9.0.0' } } } }), ['b', 'c', 'z']);
  assert.deepEqual(lockDifference(manifest, { lockfileVersion: 1 }), ['lockfileVersion']);
  assert.deepEqual(nestedPackageDirs(['package.json', 'gallery/package.json', 'gallery/vite.config.js', 'desktop/package.json']), ['desktop', 'gallery']);
});

test('sync --execute resolves the gallery lockfile again after it renders gallery/package.json, and a dry run and the managed check name the mismatch with the fix', async (t) => {
  const root = starter(t);
  staleGalleryLock(root);
  assert.deepEqual(nestedLockDrift(root, ['gallery/package.json']).map((item) => [item.dir, item.names]), [['gallery', ['@starci/gallery']]]);
  const found = (await managedFindings({ repoRoot: root, tracked: ['hfs.json'], presets: bundledPresets() })).filter((finding) => finding.path === 'gallery/package-lock.json');
  assert.deepEqual(found.map((finding) => [finding.code, finding.level]), [['HFS_MANAGED_FILE_DRIFT', 'error']]);
  assert.ok((found[0]?.message ?? '').includes(nestedLockFix('gallery')), found[0]?.message);
  const lines: string[] = [];
  const out = (line: string): void => { lines.push(line); };
  assert.equal(await runSync(['--cwd', root], { cwd: root, out, presets: bundledPresets() }), 1, 'a dry run is drift');
  assert.ok(lines.some((line) => line.startsWith('HFS_SYNC_DRIFT gallery/package-lock.json') && line.includes('@starci/gallery') && line.includes(nestedLockFix('gallery'))), lines.join('\n'));
  const resolved: string[] = [];
  const lock = (dir: string): { ok: true } => {
    resolved.push(path.relative(root, dir).replaceAll('\\', '/'));
    const manifest = JSON.parse(fs.readFileSync(at(dir, 'package.json'), 'utf8'));
    fs.writeFileSync(at(dir, 'package-lock.json'), `${JSON.stringify({ lockfileVersion: 3, packages: { '': { devDependencies: manifest.devDependencies } } })}\n`);
    return { ok: true };
  };
  lines.length = 0;
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets(), lock }), 0, lines.join('\n'));
  assert.deepEqual(resolved, ['gallery']);
  assert.ok(lines.some((line) => line.includes('wrote gallery/package-lock.json') && line.includes(NESTED_LOCK_STEP)), lines.join('\n'));
  assert.deepEqual(nestedLockDrift(root, ['gallery/package.json']), []);
  resolved.length = 0;
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets(), lock }), 0);
  assert.deepEqual(resolved, [], 'a lockfile that matches is left alone');
});

test('sync --execute exits non-zero and prints the command when npm cannot resolve the lockfile; a gallery with no lockfile is not judged', async (t) => {
  const root = starter(t);
  staleGalleryLock(root);
  const lines: string[] = [];
  const out = (line: string): void => { lines.push(line); };
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets(), lock: () => ({ ok: false, detail: 'exit 1: ETARGET' }) }), 1);
  assert.ok(lines.some((line) => line.includes('could not resolve the lockfile (exit 1: ETARGET)') && line.includes(nestedLockFix('gallery'))), lines.join('\n'));
  fs.rmSync(at(root, 'gallery', 'package-lock.json'));
  assert.deepEqual(nestedLockDrift(root, ['gallery/package.json']), []);
  assert.equal(await runSync(['--execute', '--cwd', root], { cwd: root, out, presets: bundledPresets(), lock: () => ({ ok: false, detail: 'never called' }) }), 0);
});

test('the starter carries what the full one does for statics/ and the seed levels, and the managed storage image', (t) => {
  for (const root of [starter(t, 'lite'), starter(t, 'full')]) {
    assert.ok(fs.existsSync(at(root, 'statics', '.gitkeep')), 'statics/ is tracked from the first commit');
    for (const level of ['.starcistacks/seeds', '.starcistacks/dev/seeds', '.starcistacks/production/seeds']) {
      assert.ok(fs.existsSync(at(root, ...level.split('/'), 'seeds.yaml')), `${level}/seeds.yaml`);
      for (const folder of ['sql', 'data', 'files']) assert.ok(fs.readdirSync(at(root, ...level.split('/'), folder)).length > 0, `${level}/${folder} is tracked (a .gitkeep or the full starter's demo seed)`);
    }
    assert.ok(fs.existsSync(at(root, '.starcistacks', 'images', 'storage', 'Dockerfile')), 'the managed storage image');
  }
});

const stubCtx = (t: TestContext, io: StackIo = {}) => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sync-gaps-state-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  return stackContext({ env: { ...process.env, STARCI_LOCAL_ROOT: state } as NodeJS.ProcessEnv, sleep: () => Promise.resolve(), ...io });
};

test('isAdvisoryRow marks the gallery rows and nothing else', () => {
  assert.deepEqual(['gallery', 'gallery-install', 'gallery-live', 'api', 'web', 'web-live', 'xgallery'].map(isAdvisoryRow), [true, true, true, false, false, false, false]);
});

test('stack up: a failing gallery install is listed and the other setup commands still run; without the collector, and for any other command, it still stops', async (t) => {
  const local = loadLocalConfig({ repoRoot: starter(t), env: 'dev' });
  const ran: string[] = [];
  const spawn = ((_command: string, _args: string[], options: { cwd: string }) => {
    ran.push(path.basename(options.cwd));
    return path.basename(options.cwd) === 'gallery' ? { status: 1, stdout: '', stderr: 'npm error code ETARGET\n' } : { status: 0, stdout: '', stderr: '' };
  }) as unknown as StackIo['spawn'];
  const plain = { ...local, setup: local.setup.map((run) => ({ ...run, skipIfExists: null, heavy: 'none' as const })) };
  const advisory: string[] = [];
  const lines = await runSetup(stubCtx(t, { spawn }), plain, null, advisory);
  assert.deepEqual(advisory, ['gallery-install']);
  assert.ok(lines.some((line) => line.startsWith('FAIL  setup gallery-install:') && line.includes('ETARGET')), lines.join('\n'));
  assert.equal(ran.length, plain.setup.length, 'every declared setup command ran');
  await assert.rejects(runSetup(stubCtx(t, { spawn }), plain, null), /gallery-install/u, 'without a collector the failure stops as before');
  const own = plain.setup.find((run) => !isAdvisoryRow(run.name));
  if (own) await assert.rejects(runSetup(stubCtx(t, { spawn: (() => ({ status: 1, stdout: '', stderr: 'boom' })) as unknown as StackIo['spawn'] }), { ...plain, setup: [own] }, null, []), /boom/u, 'a non-gallery command is never advisory');
});

test('stack up: a gallery that does not answer is reported by name and listed, while a failing non-gallery readiness row stops up', async (t) => {
  const local = loadLocalConfig({ repoRoot: starter(t), env: 'dev' });
  let clock = 0;
  const answers = (down: readonly string[]): StackIo['fetch'] => ((url: string) => {
    const name = local.ready.find((row) => url === row.url.replaceAll(/\$\{port\.([a-z][a-z0-9-]*)\}/gu, (_whole, port: string) => String(local.ports[port])))?.name ?? '';
    return Promise.resolve({ status: down.includes(name) ? 502 : 200, text: () => Promise.resolve('') } as Response);
  }) as StackIo['fetch'];
  const ctx = (down: readonly string[]) => stubCtx(t, { fetch: answers(down), now: () => (clock += 400) });
  const advisory: string[] = [];
  const lines = await waitReady(ctx(['gallery-live']), local, 2, advisory);
  assert.deepEqual(advisory, ['gallery-live']);
  assert.equal(lines.filter((line) => line.startsWith('FAIL  ready gallery-live')).length, 1, lines.join('\n'));
  assert.ok(lines.filter((line) => line.startsWith('ok    ready')).length >= 1, 'the rows that answer are reported ok');
  const other = local.ready.find((row) => !isAdvisoryRow(row.name));
  assert.ok(other, 'the starter declares a non-gallery readiness row');
  await assert.rejects(waitReady(ctx([other.name]), local, 2, []), (error: { code?: string; message?: string }) => error.code === 'STACK_LOCAL_READY' && (error.message ?? '').includes(other.name));
});

test('stack up: the readiness window opens when the wait starts, so time up spent before it (a heavy-slot queue, the migrate) never shortens it', async (t) => {
  const local = loadLocalConfig({ repoRoot: starter(t), env: 'dev' });
  // A dev sync on a busy host: compose up queued for a heavy slot and the migrate ran past the 180 s timeout before the api was spawned;
  // the api then needed about 40 s to boot and up refused STACK_LOCAL_READY on its first probe though the api was healthy.
  const upStarted = 0;
  let clock = upStarted + 200_000;
  const bootedAt = clock + 40_000;
  const fetch = (() => Promise.resolve(clock >= bootedAt ? { status: 200, text: () => Promise.resolve('') } as Response : Promise.reject(new Error('fetch failed')))) as unknown as StackIo['fetch'];
  const ctx = stubCtx(t, { fetch, now: () => (clock += 1000) });
  const lines = await waitReady(ctx, local, 180, []);
  assert.ok(lines.length > 0 && lines.every((line) => line.startsWith('ok    ready')), lines.join('
'));
});
