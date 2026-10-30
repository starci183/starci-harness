// Owning-package behavior proof: synthetic custody and injected tools never reach a real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSealedSession } from '../stack/remote.mjs';
import { withDockerTransport } from '../stack/docker-transport.mjs';
import { stackMain } from '../stack/cli.mjs';
import { parseTargetBinding, bindStackTarget, assertBoundCustody } from '../stack/target-binding.mjs';

const STACK = { kind: 'docker-swarm', environment: 'staging', stack: 'fixture', host: 'host.example', user: 'ops', port: 22 };
const stamp = '20261018000000_base.sql';

function files(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-native-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  return { root, write };
}

test('a wrong sealed account stops before opening a key, writing session files or invoking a tool', () => {
  let keyReads = 0, tools = 0;
  const ctx = { env: {}, spawn: () => { tools += 1; }, sops: {
    decrypt: () => ({ VPS_HOST: 'other.example', VPS_USER: 'ops' }), decryptBinary: () => { keyReads += 1; throw new Error('unexpected private key open'); },
  } };
  assert.throws(() => openSealedSession(ctx, { remote: { sealed: { ops: 'ops', sshKey: 'key', knownHosts: 'known' } }, secretsDir: 'synthetic', nativeTarget: STACK }), /differs from the accepted native target/);
  assert.equal(keyReads, 0);
  assert.equal(tools, 0);
});

test('a bound private Docker session pins the accepted SSH port and closes its owned temporary files', async t => {
  const f = files(t), secretsDir = path.join(f.root, 'secrets');
  for (const member of ['ops', 'key', 'known']) f.write(`secrets/${member}.enc`, 'synthetic envelope');
  const calls = [], env = { HOME: f.root, PATH: '' };
  const ctx = { env, platform: 'linux', sshPath: 'ssh', stderr: () => {},
    spawn: (file, args, options) => { calls.push({ file, args, options }); return { status: 0, stdout: '', stderr: '' }; },
    sops: { decrypt: () => ({ VPS_HOST: STACK.host, VPS_USER: STACK.user }),
      decryptBinary: file => file.endsWith('key.enc') ? 'synthetic PRIVATE KEY' : 'host.example ssh-ed25519 synthetic' },
  };
  const config = bindStackTarget(ctx, { repoRoot: f.root, env: 'staging', stack: 'fixture', secretsDir,
    remote: { sealed: { ops: 'ops', sshKey: 'key', knownHosts: 'known' } }, verify: { http: [] } }, STACK);
  let temporaryHome;
  await withDockerTransport(ctx, config, {}, async bound => {
    bound.spawn('docker', ['info']);
    const ssh = calls.find(call => call.file === 'ssh' && call.args.includes('-MNf'));
    assert.ok(ssh);
    assert.equal(ssh.args[ssh.args.indexOf('-p') + 1], '22');
    temporaryHome = ssh.options.env.HOME;
    assert.match(fs.readFileSync(path.join(temporaryHome, '.ssh/config'), 'utf8'), /\n  Port 22\n/);
  });
  assert.ok(calls.some(call => call.file === 'ssh' && call.args.includes('exit')));
  assert.equal(fs.existsSync(temporaryHome), false);
});

test('only a bound stack tool boundary removes AGE aliases while preserving lazy custody and explicit tool options', async t => {
  const f = files(t);
  f.write('hfs.json', JSON.stringify({ kind: 'app', project: 'fixture', edition: 'lite' }));
  f.write('.starcistacks/staging/stack.yml', 'services: {}\n');
  f.write('.starcistacks/application-stacks.yaml', JSON.stringify({ environments: { staging: {
    runtime: 'docker-swarm', composeFiles: ['stack.yml'], deploy: { stack: 'fixture',
      remote: { sealed: 'vps' } },
  } } }));
  f.write('.starcistacks/staging/secrets/vps.enc.yaml', 'synthetic envelope');
  const inherited = { sops_age_key: 'synthetic-age', SOPS_AGE_KEY_FILE: 'synthetic-key-file', HOME: f.root, PATH: '' };
  const calls = [];
  let custodyReads = 0;
  // The one member holds the host, the user, the private key and the pinned known_hosts.
  const sops = { decrypt: () => { custodyReads += 1; assert.equal(inherited.sops_age_key, 'synthetic-age');
    return { VPS_HOST: STACK.host, VPS_USER: STACK.user, privateKey: 'synthetic PRIVATE KEY', knownHosts: 'host.example ssh-ed25519 synthetic' }; } };
  const spawn = (file, args, options) => { calls.push({ file, args, options }); return { status: 0, stdout: '', stderr: '' }; };
  const io = { cwd: f.root, env: inherited, platform: 'linux', sshPath: 'ssh', stdout: () => {}, stderr: () => {}, spawn, sops,
    importer: async () => ({ verifyStack: async ctx => {
      assert.equal(ctx.env, inherited);
      assert.equal(ctx.sops, sops);
      assert.equal(Object.hasOwn(ctx, 'sops'), false);
      ctx.spawn('docker', ['info']);
      ctx.spawn('implicit-tool', []);
      ctx.spawn('explicit-tool', [], { input: 'public-input', background: true,
        env: { SoPs_AgE_KeY: 'synthetic-explicit-age', PUBLIC_VALUE: 'kept' } });
      return { ok: true, lines: [], data: {} };
    } }) };
  assert.equal(await stackMain(['verify', '--env', 'staging', '--target-binding', JSON.stringify(STACK)], io), 0);
  assert.ok(custodyReads > 0);
  assert.ok(calls.some(call => call.file === 'ssh' && call.args.includes('exit')));
  assert.ok(calls.every(call => !Object.keys(call.options.env).some(key => /^SOPS_/i.test(key))));
  const explicit = calls.find(call => call.file === 'explicit-tool').options;
  assert.equal(explicit.input, 'public-input');
  assert.equal(explicit.background, true);
  assert.equal(explicit.env.PUBLIC_VALUE, 'kept');
  assert.equal(inherited.sops_age_key, 'synthetic-age');
  calls.length = 0;
  assert.equal(await stackMain(['verify', '--env', 'staging'], io), 0);
  assert.ok(calls.some(call => call.options.env?.sops_age_key === 'synthetic-age'));
});

test('a native stack binding refuses ambient Docker routing and preserves explicitly selected native verification', t => {
  const f = files(t), config = { repoRoot: f.root, env: 'staging', stack: 'fixture', secretsDir: f.root,
    remote: { sealed: { ops: 'ops', sshKey: 'key', knownHosts: 'known' } }, verify: { http: [] } };
  for (const name of ['ops', 'key', 'known']) f.write(`${name}.enc`, 'synthetic');
  assert.throws(() => bindStackTarget({ env: { DOCKER_HOST: 'ssh://other.example' } }, config, STACK));
  const selected = { ...config, verify: { http: [{ method: 'POST' }], exec: [{ command: ['declared-command'] }] } };
  assert.deepEqual(bindStackTarget({ env: {} }, selected, STACK).verify, selected.verify);
});

test('losing a declared sealed member after admission cannot select ambient Docker', async t => {
  const f = files(t);
  let calls = 0, bodyCalls = 0;
  const ctx = { env: {}, platform: 'linux', spawn: () => { calls += 1; }, sops: { decrypt: () => { throw new Error('synthetic missing custody'); } } };
  await assert.rejects(withDockerTransport(ctx, { nativeTarget: STACK, secretsDir: f.root,
    remote: { host: 'unrelated-alias', sealed: { ops: 'missing', sshKey: 'key', knownHosts: 'known' } } }, {},
  async () => { bodyCalls += 1; }), /cannot open the sealed member/);
  assert.equal(calls, 0);
  assert.equal(bodyCalls, 0);
});

test('a bound custody path cannot traverse a directory junction outside its app', t => {
  const f = files(t);
  f.write('outside/member.enc', 'synthetic envelope');
  fs.mkdirSync(path.join(f.root, 'app'));
  fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.root, 'app', 'secrets'), 'junction');
  assert.throws(() => assertBoundCustody(path.join(f.root, 'app'), path.join(f.root, 'app', 'secrets', 'member.enc')));
});

test('a stack binding carries no undeclared fields', () => {
  assert.throws(() => parseTargetBinding(JSON.stringify({ ...STACK, shell: 'arbitrary' }), 'docker-swarm'));
  assert.throws(() => parseTargetBinding(JSON.stringify(STACK), 'supabase-db'));
});
