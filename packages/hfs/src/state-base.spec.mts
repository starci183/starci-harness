// The per-host state base of @starci/hfs: a checkout keeps it in <runtime root>/.runtime, an installed copy below a
// node_modules folder keeps it outside every package (installedStateBase), so `npm ci` never deletes a
// running stack's data; the state an installed copy kept inside itself moves out once, and refuses while a running stack holds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_ROOT_ENV, LegacyStateHeld, adoptLegacyState, formerStateBase, installedRoot, installedStateBase, runtimeStateDir, starciLocalRoot } from '../runtime/engine/runtime-root.mjs';
import { main } from './main.mjs';

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

const write = (file: string, text: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
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

test('the state an installed copy kept inside itself moves out once, an entry the base holds is kept aside, and a second run does nothing', (t) => {
  const { root, env, base } = installed(t);
  write(path.join(root, '.runtime', 'stack', 'demo', 'dev', 'state.json'), '{}\n');
  write(path.join(root, '.runtime', 'machine.sqlite'), 'legacy');
  write(path.join(base, 'machine.sqlite'), 'current');
  const adopted = adoptLegacyState(env, root, () => new Date('2026-11-04T01:02:03.000Z'));
  assert.deepEqual(adopted, [{ from: path.join(root, '.runtime'), to: base, moved: ['stack'], kept: ['machine.sqlite'] }]);
  assert.equal(fs.readFileSync(path.join(base, 'stack', 'demo', 'dev', 'state.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(base, 'machine.sqlite'), 'utf8'), 'current');
  assert.equal(fs.readFileSync(path.join(base, 'legacy-20261104010203', 'machine.sqlite'), 'utf8'), 'legacy');
  assert.equal(fs.existsSync(path.join(root, '.runtime')), false);
  assert.equal(fs.existsSync(path.join(root, '.runtime.adopting')), false);
  assert.deepEqual(adoptLegacyState(env, root), []);
});

test('a copy that ships .runtime/data/standards again over a base that already has data/standards merges it in and keeps nothing aside, run after run', (t) => {
  const { root, env, base } = installed(t);
  write(path.join(base, 'data', 'standards', 'app-standard.git', 'HEAD'), 'ref: refs/heads/main\n');
  write(path.join(base, 'stack', 'app', 'dev', 'data', 'relay-dev', 'manifest-signing.pem'), 'key');
  for (const [run, repo] of [[1, 'spec-repo-a.git'], [2, 'spec-repo-b.git']] as const) {
    write(path.join(root, '.runtime', 'data', 'standards', repo, 'HEAD'), 'ref: refs/heads/main\n');
    write(path.join(root, '.runtime', 'data', 'standards', 'app-standard.git', 'HEAD'), 'ref: refs/heads/main\n');
    const adopted = adoptLegacyState(env, root, () => new Date(`2026-11-2${String(run)}T00:00:00.000Z`));
    assert.deepEqual(adopted.map((item) => item.kept), [[]], `run ${String(run)} keeps nothing aside`);
    assert.equal(fs.existsSync(path.join(base, 'data', 'standards', repo, 'HEAD')), true);
  }
  assert.deepEqual(fs.readdirSync(base).filter((name) => name.startsWith('legacy-')), [], 'no legacy-* folder for data already there');
  assert.equal(fs.readFileSync(path.join(base, 'stack', 'app', 'dev', 'data', 'relay-dev', 'manifest-signing.pem'), 'utf8'), 'key');
});

test('on Windows the former %LOCALAPPDATA% base, where an MSIX-packaged app and the host each saw their own files, merges into the one base', (t) => {
  const { dir, root, env, base } = installed(t);
  const winEnv = { ...env, LOCALAPPDATA: path.join(dir, 'appdata') };
  const former = path.join(dir, 'appdata', 'starci-harness', 'state');
  assert.equal(formerStateBase(winEnv, 'win32'), former);
  assert.equal(formerStateBase(winEnv, 'linux'), null);
  assert.equal(formerStateBase({ ...winEnv, XDG_STATE_HOME: path.join(dir, 'appdata') }, 'win32'), null, 'never itself');
  // The door's key the packaged app's process wrote, the receipts the host's process wrote, and one file both hold with other bytes.
  write(path.join(former, 'stack', 'app', 'dev', 'data', 'relay-dev', 'manifest-signing.pem'), 'key');
  write(path.join(former, 'stack', 'app', 'dev', 'state.json'), '{"host":true}');
  write(path.join(former, 'data', 'standards', 'app-standard.git', 'HEAD'), 'same');
  write(path.join(base, 'data', 'standards', 'app-standard.git', 'HEAD'), 'same');
  write(path.join(base, 'stack', 'app', 'dev', 'state.json'), '{"base":true}');
  const adopted = adoptLegacyState(winEnv, root, () => new Date('2026-11-23T00:00:00.000Z'), 'win32');
  assert.deepEqual(adopted, [{ from: former, to: base, moved: [], kept: ['stack/app/dev/state.json'] }]);
  assert.equal(fs.readFileSync(path.join(base, 'stack', 'app', 'dev', 'data', 'relay-dev', 'manifest-signing.pem'), 'utf8'), 'key', 'the door finds the key in the one base');
  assert.equal(fs.readFileSync(path.join(base, 'stack', 'app', 'dev', 'state.json'), 'utf8'), '{"base":true}');
  assert.equal(fs.readFileSync(path.join(base, 'legacy-20261123000000', 'stack', 'app', 'dev', 'state.json'), 'utf8'), '{"host":true}');
  assert.equal(fs.existsSync(former), false);
  assert.deepEqual(adoptLegacyState(winEnv, root, undefined, 'win32'), []);
  write(path.join(former, 'machine.sqlite'), 'held');
  const rename = fs.renameSync;
  t.after(() => { fs.renameSync = rename; });
  fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  assert.throws(() => adoptLegacyState(winEnv, root, undefined, 'win32'), (error: unknown) => error instanceof LegacyStateHeld && error.legacy === former);
  assert.equal(fs.readFileSync(path.join(former, 'machine.sqlite'), 'utf8'), 'held');
});

test('an interrupted adoption resumes from .runtime.adopting; a checkout or STARCI_LOCAL_ROOT adopts nothing', (t) => {
  const { dir, root, env, base } = installed(t);
  write(path.join(root, '.runtime.adopting', 'artifacts', 'ab', 'blob'), 'x');
  assert.deepEqual(adoptLegacyState(env, root)[0]?.moved, ['artifacts']);
  assert.equal(fs.readFileSync(path.join(base, 'artifacts', 'ab', 'blob'), 'utf8'), 'x');
  const checkout = path.join(dir, 'harness', 'runtime');
  write(path.join(checkout, '.runtime', 'machine.sqlite'), 'mine');
  assert.deepEqual(adoptLegacyState(env, checkout), []);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'later');
  assert.deepEqual(adoptLegacyState({ ...env, [LOCAL_ROOT_ENV]: path.join(dir, 'probe') }, root), []);
  assert.equal(fs.existsSync(path.join(root, '.runtime', 'machine.sqlite')), true);
});

test('an entry moves by rename where it can, and across volumes is copied with its mode and owner kept (a bind folder a container user owns)', (t) => {
  const { root, env, base } = installed(t);
  const folder = path.join(root, '.runtime', 'stack', 'demo', 'dev', 'data', 'worker-state');
  write(path.join(folder, 'worker.json'), '{}\n');
  fs.chmodSync(path.join(folder, 'worker.json'), 0o444);
  const parked = path.join(root, '.runtime.adopting', 'stack', 'demo', 'dev', 'data', 'worker-state');
  const mode = (file: string): number => fs.lstatSync(file).mode & 0o7777;
  const rename = fs.renameSync;
  const lstat = fs.lstatSync;
  const lchown = fs.lchownSync;
  const owners: Array<[string, number, number]> = [];
  t.after(() => { fs.renameSync = rename; fs.lchownSync = lchown; });
  let parking = true;
  fs.renameSync = (from, to) => {
    if (parking) { parking = false; rename(from, to); return; }
    throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
  };
  // The source folder belongs to the container user (uid 1000); the copy is the caller's until its owner is given back.
  t.mock.method(fs, 'lstatSync', (file: fs.PathLike, options?: fs.StatSyncOptions) => {
    const stats = lstat(file, options);
    return stats !== undefined && String(file).startsWith(parked) ? Object.assign(stats, { uid: 1000, gid: 1000 }) : stats;
  });
  fs.lchownSync = (file, uid, gid) => { owners.push([path.relative(base, String(file)), uid, gid]); };
  const sourceMode = mode(path.join(folder, 'worker.json'));
  assert.deepEqual(adoptLegacyState(env, root)[0]?.moved, ['stack']);
  const moved = path.join(base, 'stack', 'demo', 'dev', 'data', 'worker-state');
  assert.equal(mode(path.join(moved, 'worker.json')), sourceMode);
  assert.deepEqual(owners.filter(([file]) => file.includes('worker-state')).map(([file, uid, gid]) => [file.split(path.sep).join('/'), uid, gid]),
    [['stack/demo/dev/data/worker-state', 1000, 1000], ['stack/demo/dev/data/worker-state/worker.json', 1000, 1000]]);
  assert.equal(fs.existsSync(path.join(root, '.runtime.adopting')), false);
  fs.renameSync = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  write(path.join(root, '.runtime.adopting', 'machine.sqlite'), 'parked');
  assert.throws(() => adoptLegacyState(env, root), /denied/u, 'a rename failing for another reason is thrown, not copied');
});

test('a legacy state a running stack holds refuses HFS_STATE_LEGACY_HELD and stays where it is; any other failure is thrown as it is', (t) => {
  const { root, env } = installed(t);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'held');
  const rename = fs.renameSync;
  t.after(() => { fs.renameSync = rename; });
  fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
  assert.throws(() => adoptLegacyState(env, root), (error: unknown) => error instanceof LegacyStateHeld && error.code === 'HFS_STATE_LEGACY_HELD'
    && error.legacy === path.join(root, '.runtime') && /starci app stack down/u.test(error.message));
  fs.renameSync = () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
  assert.throws(() => adoptLegacyState(env, root), /gone/u);
  assert.equal(fs.readFileSync(path.join(root, '.runtime', 'machine.sqlite'), 'utf8'), 'held');
});

test('`starci app` moves the legacy state before a verb and says so, and prints the refusal code of a held one with exit 2', async (t) => {
  const { dir, root, env, base } = installed(t);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'legacy');
  write(path.join(base, 'machine.sqlite'), 'current');
  write(path.join(root, '.runtime', 'stack', 'state.json'), '{}');
  const run = async (): Promise<{ code: number; err: string }> => {
    let err = '';
    const code = await main(['slot', 'not-a-path'], { cwd: dir, env, stateRoot: root, stderr: (text: string) => { err += text; }, stdout: () => undefined });
    return { code, err };
  };
  const first = await run();
  assert.match(first.err, /moved the state kept in .* \(machine\.sqlite differed from the copy already there; the older one is kept under legacy-\*\)/u);
  fs.rmSync(path.join(base, 'stack'), { recursive: true });
  write(path.join(root, '.runtime', 'stack', 'state.json'), '{}');
  const second = await run();
  assert.match(second.err, /moved the state kept in \S+ to \S+\n/u);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'held');
  const rename = fs.renameSync;
  t.after(() => { fs.renameSync = rename; });
  fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
  const held = await run();
  assert.equal(held.code, 2);
  assert.match(held.err, /^HFS_STATE_LEGACY_HELD: .*starci app stack down/u);
});
