// The per-host state base of @starci/hfs: a checkout keeps it in <runtime root>/.runtime, an installed or locally sourced copy below a
// node_modules folder keeps it outside every package (installedStateBase), so `npm ci` and `starci deps source --local` never delete a
// running stack's data; the state an installed copy kept inside itself moves out once, and refuses while a running stack holds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_ROOT_ENV, LegacyStateHeld, adoptLegacyState, installedRoot, installedStateBase, runtimeStateDir, starciLocalRoot } from '../runtime/engine/runtime-root.mjs';
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
  const env = { LOCALAPPDATA: path.join(dir, 'user') };
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

test('without LOCALAPPDATA the base is XDG_STATE_HOME, else ~/.local/state', () => {
  assert.equal(installedStateBase({ XDG_STATE_HOME: path.join(os.tmpdir(), 'xdg') }), path.join(os.tmpdir(), 'xdg', 'starci-harness', 'state'));
  assert.equal(installedStateBase({}), path.join(os.homedir(), '.local', 'state', 'starci-harness', 'state'));
});

test('the state an installed copy kept inside itself moves out once, an entry the base holds is kept aside, and a second run does nothing', (t) => {
  const { root, env, base } = installed(t);
  write(path.join(root, '.runtime', 'stack', 'nivo', 'dev', 'state.json'), '{}\n');
  write(path.join(root, '.runtime', 'machine.sqlite'), 'legacy');
  write(path.join(base, 'machine.sqlite'), 'current');
  const adopted = adoptLegacyState(env, root, () => new Date('2026-11-04T01:02:03.000Z'));
  assert.deepEqual(adopted, { from: path.join(root, '.runtime'), to: base, moved: ['stack'], kept: ['machine.sqlite'] });
  assert.equal(fs.readFileSync(path.join(base, 'stack', 'nivo', 'dev', 'state.json'), 'utf8'), '{}\n');
  assert.equal(fs.readFileSync(path.join(base, 'machine.sqlite'), 'utf8'), 'current');
  assert.equal(fs.readFileSync(path.join(base, 'legacy-20261104010203', 'machine.sqlite'), 'utf8'), 'legacy');
  assert.equal(fs.existsSync(path.join(root, '.runtime')), false);
  assert.equal(fs.existsSync(path.join(root, '.runtime.adopting')), false);
  assert.equal(adoptLegacyState(env, root), null);
});

test('an interrupted adoption resumes from .runtime.adopting; a checkout or STARCI_LOCAL_ROOT adopts nothing', (t) => {
  const { dir, root, env, base } = installed(t);
  write(path.join(root, '.runtime.adopting', 'artifacts', 'ab', 'blob'), 'x');
  assert.deepEqual(adoptLegacyState(env, root)?.moved, ['artifacts']);
  assert.equal(fs.readFileSync(path.join(base, 'artifacts', 'ab', 'blob'), 'utf8'), 'x');
  const checkout = path.join(dir, 'harness', 'runtime');
  write(path.join(checkout, '.runtime', 'machine.sqlite'), 'mine');
  assert.equal(adoptLegacyState(env, checkout), null);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'later');
  assert.equal(adoptLegacyState({ ...env, [LOCAL_ROOT_ENV]: path.join(dir, 'probe') }, root), null);
  assert.equal(fs.existsSync(path.join(root, '.runtime', 'machine.sqlite')), true);
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
  assert.match(first.err, /moved the state this installed copy kept in .* \(machine\.sqlite already there; the older copy is kept under legacy-\*\)/u);
  fs.rmSync(path.join(base, 'stack'), { recursive: true });
  write(path.join(root, '.runtime', 'stack', 'state.json'), '{}');
  const second = await run();
  assert.match(second.err, /moved the state this installed copy kept in \S+ to \S+\n/u);
  write(path.join(root, '.runtime', 'machine.sqlite'), 'held');
  const rename = fs.renameSync;
  t.after(() => { fs.renameSync = rename; });
  fs.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
  const held = await run();
  assert.equal(held.code, 2);
  assert.match(held.err, /^HFS_STATE_LEGACY_HELD: .*starci app stack down/u);
});
