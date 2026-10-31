// The forced-command gate of the CI SSH key (stack/ssh-gate.mts), for real `sh`: what it admits, everything it refuses, and the whole release store
// (locks, releases, pointers, journal) running through it exactly as it runs ungated.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReleaseStore } from '../stack/release-store.mjs';
import type { RemoteResult } from '../stack/remote.mjs';
import { ciKey } from '../stack/ci-key.mjs';
import { AUTHORIZED_OPTIONS, GATE_OPS, authorizedKeysLine, gateIsOn, gateOp, gateScript, gatedCommand, inlineCommand } from '../stack/ssh-gate.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';

const posix = (file: string) => (process.platform === 'win32' ? file.replace(/^([A-Za-z]):/u, (_all, drive: string) => `/${drive.toLowerCase()}`) : file).split(path.sep).join('/');
const TOKEN = 'c'.repeat(32);
const RELEASE = '0123456789abcdef';
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFakeFakeFakeFakeFakeFakeFake starci-ci-demo';

function scene(t: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-gate-'));
  t.after(() => {
    for (const release of fs.existsSync(path.join(dir, 'base', 'releases')) ? fs.readdirSync(path.join(dir, 'base', 'releases')) : []) fs.chmodSync(path.join(dir, 'base', 'releases', release), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'base'));
  const gate = path.join(dir, 'starci-ssh-gate');
  fs.writeFileSync(gate, gateScript(), { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), '#!/bin/sh\necho "docker $*"\n', { mode: 0o755 });
  // the forced command: sshd runs the gate with the client's command in SSH_ORIGINAL_COMMAND
  const viaGate = (command: string | undefined, input?: string): RemoteResult => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` };
    if (command === undefined) delete env.SSH_ORIGINAL_COMMAND; else env.SSH_ORIGINAL_COMMAND = command;
    const run = spawnSync('sh', [posix(gate)], { env, input, encoding: 'utf8', windowsHide: true });
    return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr };
  };
  const base = posix(path.join(dir, 'base'));
  return { dir, base, viaGate };
}

test('the gate admits the docker transport and nothing like it', (t) => {
  const { viaGate } = scene(t);
  const admitted = viaGate('docker system dial-stdio');
  assert.equal(admitted.status, 0, admitted.stderr);
  assert.equal(admitted.stdout, 'docker system dial-stdio\n');
  for (const near of ['docker system dial-stdio ', 'docker system dial-stdio; id', 'docker ps', 'docker system dial-stdio --help', 'DOCKER system dial-stdio']) {
    assert.equal(viaGate(near).status, 126, near);
  }
});

test('the gate refuses a shell, an unknown name, a wrong count and every argument outside its alphabet, saying nothing about the request', (t) => {
  const { viaGate, base } = scene(t);
  const refused = [
    undefined, '', 'sh', 'bash -c id', 'id', 'starci-op', 'starci-op nothing', 'starci-op pointer', `starci-op pointer ${base}`, `starci-op pointer ${base} current extra`,
    `starci-op pointer ${base} sideways`, 'starci-op pointer relative/path current', `starci-op pointer ${base}/../etc current`, `starci-op pointer ${base};id current`,
    `starci-op pointer ${base}$(id) current`, `starci-op pointer ${base}\`id\` current`, `starci-op pointer ${base}\nid current`, `starci-op pointer '${base}' current`,
    `starci-op pointer ${base}/* current`, `starci-op read ${base} ${RELEASE.toUpperCase()}`, `starci-op read ${base} ${RELEASE}0`, `starci-op read ${base} abc`,
    `starci-op lock-acquire ${base} ${TOKEN} root 10`, `starci-op lock-acquire ${base} ${TOKEN} ci -1`, `starci-op lock-acquire ${base} ${TOKEN} ci 1000000`,
    `starci-op lock-acquire ${base} ${TOKEN.slice(1)} ci 10`, `starci-op journal-write ${base} 2026-10-31`, `starci-op journal-write ${base} 20261031T083015Z-zzzzzzzz`,
    `STARCI-OP pointer ${base} current`,
  ];
  for (const command of refused) {
    const answer = viaGate(command);
    assert.equal(answer.status, 126, JSON.stringify(command));
    assert.equal(answer.stdout, '');
    assert.equal(answer.stderr, 'starci-ssh-gate: command refused\n');
  }
});

test('the client refuses to compose an operation the gate would refuse', () => {
  assert.throws(() => gatedCommand('pointer', ['/srv/app', 'current;id']), (error: { code?: string }) => error.code === 'STACK_GATE_ARGUMENT');
  assert.throws(() => gatedCommand('pointer', ['/srv/app']), (error: { code?: string }) => error.code === 'STACK_GATE_ARGUMENT');
  assert.throws(() => gatedCommand('shell', []), (error: { code?: string }) => error.code === 'STACK_GATE_OP');
  assert.throws(() => inlineCommand('read', ['/srv/../app', RELEASE]), (error: { code?: string }) => error.code === 'STACK_GATE_ARGUMENT');
  assert.equal(gatedCommand('read', ['/srv/app', RELEASE]), `starci-op read /srv/app ${RELEASE}`);
});

test('every named operation is a script that swallows no failure and the gate has a case for each', () => {
  const script = gateScript();
  for (const op of GATE_OPS) {
    assert.doesNotMatch(op.body, /\|\|\s*true/u, op.name);
    assert.match(script, new RegExp(`^  ${op.name}\\) `, 'mu'), op.name);
    assert.equal(gateOp(op.name), op);
  }
  assert.ok(gateIsOn({ STARCI_SSH_GATE: '1' }));
  assert.ok(!gateIsOn({}));
});

test('an operation through the gate is the same operation as its ungated command', (t) => {
  const { dir, viaGate, base } = scene(t);
  fs.mkdirSync(path.join(dir, 'base', 'releases', RELEASE), { recursive: true });
  fs.symlinkSync(path.join(dir, 'base', 'releases', RELEASE), path.join(dir, 'base', 'current'), 'junction');
  const gated = viaGate(gatedCommand('pointer', [base, 'current']));
  assert.equal(gated.status, 0, gated.stderr);
  const plain = spawnSync('sh', ['-c', inlineCommand('pointer', [base, 'current'])], { encoding: 'utf8', windowsHide: true });
  assert.equal(gated.stdout, plain.stdout);
  assert.equal(gated.stdout, `${RELEASE}\n`);
});

test('the release store works through the gate: lock, release, pointers, list and journal', async (t) => {
  const { dir, base, viaGate } = scene(t);
  const store = createReleaseStore({ stack: 'shop', remote: { releasesBase: base } } as unknown as Parameters<typeof createReleaseStore>[0], (command, options) => viaGate(command, options.input), { gated: true });
  assert.deepEqual(await store.tryLock(TOKEN, 'ci'), { acquired: true });
  const busy = await store.tryLock('d'.repeat(32), 'urgent');
  assert.equal(busy.acquired, false);
  assert.equal(await store.refreshLock(TOKEN), true);
  assert.equal(await store.unlock(TOKEN), true);
  assert.equal(fs.existsSync(path.join(dir, 'base', 'deploy.lock')), false);

  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'stack.yaml'), 'services: {}\n');
  fs.writeFileSync(path.join(out, 'release.json'), '{"id":"x"}\n');
  await store.store(out, RELEASE);
  await store.accept(RELEASE);
  // Git for Windows' `ln -s` copies instead of linking, so the pointers are asserted where symlinks are real (the Linux CI).
  if (process.platform !== 'win32') {
    assert.equal(await store.current(), RELEASE);
    assert.equal(await store.previous(), '');
    assert.deepEqual(await store.list(), [{ id: RELEASE, current: true, previous: false }]);
  }
  const read = await store.read(RELEASE);
  assert.equal(read.stackYaml, 'services: {}\n');

  const attempt = '20261031T083015Z-0a1b2c3d';
  const journal = store.journal(attempt);
  await journal.write({ attempt, outcome: 'running', contract: [] });
  await journal.write({ attempt, outcome: 'accepted', contract: ['1_contract_x'] });
  await journal.index({ attempt, event: 'start' });
  assert.deepEqual(await store.journals(), [{ attempt, outcome: 'accepted', contract: ['1_contract_x'] }]);
  assert.match(fs.readFileSync(path.join(dir, 'base', 'deploys.jsonl'), 'utf8'), /"event":"start"/u);
});

test('the authorized_keys line carries the forced command and refuses a private key, options in front or a second line', () => {
  const line = authorizedKeysLine(`${PUBLIC_KEY}\n`);
  assert.equal(line, `${AUTHORIZED_OPTIONS.join(',')} ${PUBLIC_KEY}`);
  assert.match(line, /^restrict,command="starci-ssh-gate",no-pty,no-port-forwarding,/u);
  for (const bad of ['a private key text, PRIVATE KEY, not a .pub', `command="id" ${PUBLIC_KEY}`, `${PUBLIC_KEY}\n${PUBLIC_KEY}`, '', 'ssh-ed25519']) {
    assert.throws(() => authorizedKeysLine(bad), (error: { code?: string }) => /^STACK_CI_KEY_/u.test(error.code ?? ''), bad);
  }
});

test('stack ci-key prints the gate or the authorized_keys line alone, and the install steps without a flag', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-ci-key-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pubFile = path.join(dir, 'ci.pub');
  fs.writeFileSync(pubFile, `${PUBLIC_KEY}\n`);
  // reason: the verb reads only the environment name of the config; the context is unused.
  const config = { env: 'production' } as unknown as DeployConfig;
  const ctx = {} as unknown as StackContext;
  const gate = await ciKey(ctx, config, { printGate: true });
  assert.deepEqual(gate.lines, [gateScript().trimEnd()]);
  const keys = await ciKey(ctx, config, { printAuthorizedKeys: true, publicKey: pubFile });
  assert.deepEqual(keys.lines, [`${AUTHORIZED_OPTIONS.join(',')} ${PUBLIC_KEY}`]);
  await assert.rejects(ciKey(ctx, config, { printAuthorizedKeys: true }), (error: { code?: string }) => error.code === 'STACK_USAGE');
  await assert.rejects(ciKey(ctx, config, { printAuthorizedKeys: true, printGate: true }), (error: { code?: string }) => error.code === 'STACK_USAGE');
  const steps = await ciKey(ctx, config, {});
  assert.ok(steps.lines.some((line) => line.includes('--print-gate')));
  assert.ok(steps.lines.some((line) => line.includes('--print-authorized-keys')));
});
