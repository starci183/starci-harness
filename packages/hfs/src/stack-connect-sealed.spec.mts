// `starci app stack connect` in CI (ruling app-cicd-auto-deploy): the transport of the deploy is the sealed member vps-ci of the environment, opened with the server
// identity the job holds. The key, the pinned host keys, the host and the account leave GitHub, and the log of a public repository never names the host.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeployConfig } from '../stack/config.mjs';
import type { StackContext } from '../stack/context.mjs';
import { CI_MEMBER, connectCi } from '../stack/remote.mjs';

// The fixture is shaped like a key without writing a key block into the repository (the secret scan reads this file).
const pem = (edge: string) => ['-----' + edge, 'OPENSSH', 'PRIVATE', 'KEY-----'].join(' ');
const KEY = [pem('BEGIN'), 'fixture', pem('END')].join('\n');
const SEALED = { VPS_SSH_KEY: KEY, VPS_KNOWN_HOSTS: 'manager.example ssh-ed25519 AAAAfixture', VPS_HOST: 'manager.example', VPS_USER: 'deploy' };

interface Scene { home: string; githubEnv: string; secretsDir: string; ctx: StackContext; config: DeployConfig; decrypted: string[] }

function scene(t: TestContext, { member = SEALED as Record<string, unknown> | null, env = {} as Record<string, string>, releasesBase = '/srv/shop-releases' } = {}): Scene {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-connect-sealed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const secretsDir = path.join(root, 'secrets');
  fs.mkdirSync(secretsDir, { recursive: true });
  const githubEnv = path.join(root, 'github-env');
  fs.writeFileSync(githubEnv, '');
  const decrypted: string[] = [];
  // The sealed file is ciphertext; the seam hands back the map a sops decrypt would.
  if (member) fs.writeFileSync(path.join(secretsDir, `${CI_MEMBER}.enc.yaml`), 'sops: {}\nciphertext: ENC[fixture]\n');
  const sops = { decrypt: (file: string) => { decrypted.push(path.basename(file)); return member as Record<string, string>; } };
  // reason: connectCi reads only env and the sops seam of the context, and secretsDir and remote of the config.
  const ctx = { env: { GITHUB_ACTIONS: 'true', HOME: home, GITHUB_ENV: githubEnv, ...env }, sops } as unknown as StackContext;
  const config = { secretsDir, remote: { host: 'vps', releasesBase } } as unknown as DeployConfig;
  return { home, githubEnv, secretsDir, ctx, config, decrypted };
}

test('connect opens the sealed member vps-ci: the key, the pinned host keys and the ssh block come from it, nothing from GitHub variables', async (t) => {
  const { home, githubEnv, ctx, config, decrypted } = scene(t);
  const result = await connectCi(ctx, config, { execute: true });
  assert.equal(result.ok, true);
  assert.deepEqual(decrypted, ['vps-ci.enc.yaml']);
  assert.equal(fs.readFileSync(path.join(home, '.ssh', 'deploy_key'), 'utf8'), `${KEY}\n`);
  assert.equal(fs.readFileSync(path.join(home, '.ssh', 'known_hosts'), 'utf8'), `${SEALED.VPS_KNOWN_HOSTS}\n`);
  const block = fs.readFileSync(path.join(home, '.ssh', 'config'), 'utf8');
  assert.match(block, /HostName manager\.example/u);
  assert.match(block, /User deploy/u);
  assert.match(block, /StrictHostKeyChecking yes/u, 'a new host key is never accepted');
  assert.equal(fs.readFileSync(githubEnv, 'utf8'), 'DOCKER_HOST=ssh://vps\n');
  assert.equal(result.data?.['sealed'], true);
});

test('connect masks the host, the account and the releases root before any later line can carry them', async (t) => {
  const { ctx, config } = scene(t);
  const result = await connectCi(ctx, config, { execute: true });
  const masks = result.lines.filter((line) => line.startsWith('::add-mask::'));
  assert.deepEqual(masks, ['::add-mask::manager.example', '::add-mask::deploy', '::add-mask::/srv/shop-releases']);
  assert.ok(result.lines.indexOf(masks[0]!) < result.lines.findIndex((line) => line.startsWith('wrote ')), 'the masks come first');
  assert.equal(result.lines.join('\n').includes(KEY.split('\n')[1]!), false, 'the key is never printed');
});

test('a sealed member wins over variables of the job, and a dry run opens it and writes nothing', async (t) => {
  const { home, ctx, config } = scene(t, { env: { VPS_SSH_KEY: 'not a key', VPS_HOST: 'other.example', VPS_USER: 'x', VPS_KNOWN_HOSTS: 'y' } });
  const dry = await connectCi(ctx, config);
  assert.equal(dry.ok, true);
  assert.match(dry.lines.join('\n'), /dry run: would write .*from the sealed member vps-ci/u);
  assert.equal(fs.existsSync(path.join(home, '.ssh')), false);
});

test('a member that lacks a value is refused naming the key, and a member that cannot be opened is refused naming the member', async (t) => {
  const { ctx, config } = scene(t, { member: { ...SEALED, VPS_HOST: '' } });
  await assert.rejects(() => connectCi(ctx, config, { execute: true }), (error: Error & { code?: string }) => error.code === 'STACK_CONNECT_MISSING' && /vps-ci holds no VPS_HOST/u.test(error.message));
  const bad = scene(t, { member: { ...SEALED, VPS_SSH_KEY: 'not a key' } });
  await assert.rejects(() => connectCi(bad.ctx, bad.config, { execute: true }), (error: Error & { code?: string }) => error.code === 'STACK_CONNECT_INVALID' && /not a PEM private key/u.test(error.message));
  const broken = scene(t);
  broken.ctx.sops.decrypt = () => { throw new Error('no identity matched'); };
  await assert.rejects(() => connectCi(broken.ctx, broken.config, { execute: true }), (error: Error & { code?: string }) => error.code === 'STACK_SECRET_MEMBER_UNREADABLE' && /vps-ci/u.test(error.message));
});

test('without the sealed member the variables of the job are the transport, as before; with neither the refusal names both', async (t) => {
  const env = { VPS_SSH_KEY: KEY, VPS_KNOWN_HOSTS: 'known', VPS_HOST: 'manager.example', VPS_USER: 'deploy' };
  const legacy = scene(t, { member: null, env });
  const result = await connectCi(legacy.ctx, legacy.config, { execute: true });
  assert.equal(result.ok, true);
  assert.equal(result.data?.['sealed'], false);
  assert.deepEqual(result.lines.filter((line) => line.startsWith('::add-mask::')), []);
  assert.deepEqual(legacy.decrypted, []);
  const none = scene(t, { member: null });
  await assert.rejects(() => connectCi(none.ctx, none.config, { execute: true }), (error: Error & { code?: string }) => error.code === 'STACK_CONNECT_MISSING' && /no sealed member vps-ci/u.test(error.message));
});

test('connect tells the deploy to use the gate only for a vps-ci member that says VPS_GATE=1', async (t) => {
  const gated = scene(t, { member: { ...SEALED, VPS_GATE: '1' } });
  const result = await connectCi(gated.ctx, gated.config, { execute: true });
  assert.equal(result.data?.['gated'], true);
  assert.equal(fs.readFileSync(gated.githubEnv, 'utf8'), ['DOCKER_HOST=ssh://vps', 'STARCI_SSH_GATE=1', ''].join(String.fromCharCode(10)));
  const plain = scene(t);
  assert.equal((await connectCi(plain.ctx, plain.config, { execute: true })).data?.['gated'], false);
  assert.doesNotMatch(fs.readFileSync(plain.githubEnv, 'utf8'), /STARCI_SSH_GATE/u);
});
