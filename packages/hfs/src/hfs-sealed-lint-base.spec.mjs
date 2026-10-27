// proves: HFS_SIZE_GROWTH
// The sealed copy's isolated git tree must give the size-growth ratchet (R20, starci-be/file-size-growth) a real
// recorded size: a baseline commit whose tree is the source app's subtree at the source repository's lint base,
// not the "unavailable" verdict a historyless tree forced on every over-budget file in every sealed lint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../runtime/scripts/hfs/example-secrets.mjs', import.meta.url));
const { withMaterializedExample } = await import(new URL('../runtime/scripts/hfs/example-secrets.mjs', import.meta.url));

const git = (cwd, args, options = {}) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', ...options });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? r.error?.message ?? '').trim() };
};

const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

const commit = (cwd, message) => {
  assert.equal(git(cwd, ['add', '-A']).ok, true);
  const r = git(cwd, ['-c', 'user.name=spec', '-c', 'user.email=spec@starci.invalid', 'commit', '-q', '-m', message]);
  assert.equal(r.ok, true, r.err);
};

/** A source repository at `root` holding an example app under `examples/app`, `files` committed at the base commit. */
function sourceRepo(t, root, files) {
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  assert.equal(git(root, ['init', '-b', 'main', '-q']).ok, true);
  commit(root, 'base');
  return path.join(root, 'examples', 'app');
}

test('the sealed copy bases its snapshot on the app subtree at the recorded lint base', async (t) => {
  const app = sourceRepo(t, fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-base-')), {
    'examples/app/hfs.json': JSON.stringify({ kind: 'app' }),
    'examples/app/be/src/big.ts': 'a\nb\nc\n',
  });
  write(app, 'be/src/big.ts', 'a\nb\nc\nd\ne\n'); // the working file grew vs the recorded 3 lines
  write(app, 'be/src/new.ts', 'x\n');
  await withMaterializedExample(app, '.', async (copy, lintBaseRef) => {
    assert.match(lintBaseRef, /^[0-9a-f]{40}$/);
    assert.equal(git(copy, ['rev-parse', 'HEAD']).ok, true, 'the copy commits its snapshot');
    assert.equal(git(copy, ['merge-base', 'HEAD', lintBaseRef]).out, lintBaseRef, 'the lint base is the snapshot parent');
    assert.equal(git(copy, ['show', `${lintBaseRef}:./be/src/big.ts`]).out, 'a\nb\nc', 'the base reads the recorded file');
    assert.equal(git(copy, ['ls-tree', '--name-only', lintBaseRef, '--', './be/src/new.ts']).out, '', 'a file new since the base records null');
  });
});

test('an app absent at the lint base still records: every file is new', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-new-app-'));
  const app = sourceRepo(t, root, { 'hfs.json': JSON.stringify({ kind: 'runtime' }) });
  write(app, 'be/src/big.ts', 'a\nb\n');
  await withMaterializedExample(app, '.', async (copy, lintBaseRef) => {
    assert.match(lintBaseRef, /^[0-9a-f]{40}$/);
    assert.equal(git(copy, ['ls-tree', '--name-only', '-r', lintBaseRef]).out, '', 'the empty tree means recorded null, never unavailable');
  });
});

test('a repository without a resolvable lint base fails instead of measuring against HEAD', async (t) => {
  const app = sourceRepo(t, fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-missing-base-')), {
    'examples/app/be/src/big.ts': 'a\n',
  });
  assert.equal(git(app, ['branch', '-m', 'feature']).ok, true);
  write(app, 'be/src/big.ts', 'a\nb\nc\n');
  commit(app, 'committed growth');
  let called = false;
  await assert.rejects(withMaterializedExample(app, '.', () => { called = true; }), /sealed lint baseline unavailable: set STARCI_BASE_REF/);
  assert.equal(called, false, 'lint must not run with a weakened baseline');
});

test('the --run command fails clearly when no lint base resolves', (t) => {
  const app = sourceRepo(t, fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-missing-env-')), {
    'examples/app/be/src/big.ts': 'a\n',
  });
  assert.equal(git(app, ['branch', '-m', 'feature']).ok, true);
  const r = spawnSync(process.execPath, [SCRIPT, '--run', app, '--', process.execPath, '-e', 'process.exit(0)'], {
    encoding: 'utf8', env: { ...process.env, STARCI_BASE_REF: 'missing-lint-base' },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sealed lint baseline unavailable: set STARCI_BASE_REF/);
});

test('a source outside any repository still commits its snapshot', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-norepo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'be/src/big.ts', 'a\n');
  await withMaterializedExample(root, '.', async (copy, lintBaseRef) => {
    assert.equal(lintBaseRef, null);
    assert.equal(git(copy, ['rev-parse', 'HEAD']).ok, true, 'HEAD resolves on the snapshot commit');
  });
});

test('the --run command sees STARCI_BASE_REF as the copy lint base', async (t) => {
  const app = sourceRepo(t, fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-sealed-env-')), {
    'examples/app/hfs.json': JSON.stringify({ kind: 'app' }),
    'examples/app/be/src/big.ts': 'a\n',
  });
  const probe = "const{execSync}=require('node:child_process');const b=process.env.STARCI_BASE_REF;process.stdout.write(b+'|'+execSync('git merge-base HEAD '+b,{cwd:process.cwd(),encoding:'utf8'}).trim())";
  const r = spawnSync(process.execPath, [SCRIPT, '--run', app, '--', process.execPath, '-e', probe], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const [base, mergeBase] = r.stdout.trim().split('|');
  assert.match(base, /^[0-9a-f]{40}$/);
  assert.equal(mergeBase, base, 'the env names the base commit the copy can resolve');
});
