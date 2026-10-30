// `starci app stack <action>` takes only its own flags (stack/cli.mjs FLAGS), names its environment for every action with an effect, and
// refuses the deploy flag combinations whose flags would otherwise be dropped. Every refusal here comes before the app is read: the folder is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ACTIONS, FLAGS, READ_ONLY, stackMain } from '../stack/cli.mjs';

async function stack(t, argv) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-stack-flags-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  let err = '';
  const code = await stackMain(argv, { cwd, env: {}, stdout: () => {}, stderr: (text) => { err += text; }, importer: async () => { throw new Error('no action module may load'); } });
  return { code, err };
}

test('a flag of another action is refused with the action named, never ignored', async (t) => {
  for (const argv of [
    ['doctor', '--execute'],
    ['verify', '--env', 'production', '--execute'],
    ['render', '--ssh-cmd', 'ssh x'],
    ['connect', '--env', 'production', '--ssh-cmd', 'ssh x'],
    ['converge', '--env', 'production', '--release', '0123456789abcdef'],
    ['backup', '--env', 'production', '--urgent'],
    ['rollback', '--env', 'production', '--reason', 'why'],
    ['prepare', '--env', 'production', '--target-binding', '{}'],
  ]) {
    const run = await stack(t, argv);
    assert.equal(run.code, 2, argv.join(' '));
    const flag = argv.slice(1).find((arg) => arg.startsWith('--') && arg !== '--env');
    assert.match(run.err, new RegExp(`^starci app stack: STACK_USAGE: stack ${argv[0]} takes no ${flag}: its flags are --env, --json`), argv.join(' '));
  }
});

test('an unknown flag and a value flag followed by a flag are refused', async (t) => {
  assert.match((await stack(t, ['deploy', '--env', 'production', '--bogus'])).err, /STACK_USAGE: unknown flag --bogus/);
  assert.match((await stack(t, ['deploy', '--env', '--execute'])).err, /STACK_USAGE: --env needs a value/);
});

test('every action with an effect names its environment; the read-only actions default to production', async (t) => {
  for (const action of ACTIONS.filter((name) => !READ_ONLY.includes(name))) {
    const run = await stack(t, [action]);
    assert.equal(run.code, 2, action);
    assert.match(run.err, new RegExp(`STACK_USAGE: stack ${action} has an effect: name its environment with --env <env>`), action);
  }
  for (const action of READ_ONLY) {
    const run = await stack(t, [action]);
    assert.equal(run.code, 2, action);
    assert.doesNotMatch(run.err, /STACK_USAGE/, `${action} reads the production environment of the (empty) app`);
  }
});

test('--reason and --remote belong to the one-command urgent deploy, never beside --image or --source-sha', async (t) => {
  for (const argv of [
    ['deploy', '--env', 'production', '--urgent', '--reason', 'hotfix', '--source-sha', 'abcdef1'],
    ['deploy', '--env', 'production', '--urgent', '--remote', 'origin', '--image', 'api=ghcr.io/o/api@sha256:00'],
  ]) {
    const run = await stack(t, argv);
    assert.equal(run.code, 2, argv.join(' '));
    assert.match(run.err, /STACK_USAGE: --reason and --remote belong to the one-command urgent deploy without --image and --source-sha/, argv.join(' '));
  }
  assert.match((await stack(t, ['deploy', '--env', 'production', '--reason', 'hotfix'])).err, /--reason and --remote release HEAD in the one-command urgent deploy: add --urgent/);
});

test('the flag table covers every action', () => {
  assert.deepEqual(new Set(Object.keys(FLAGS)), new Set(ACTIONS));
  for (const action of READ_ONLY) assert.ok(!FLAGS[action].includes('--execute'), `${action} is read-only and takes no --execute`);
});
