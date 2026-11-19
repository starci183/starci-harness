// stack-render-version.spec.mts - managed overrides match the source's Compose version, incompatible extras refuse before custody opens, and the rendered stack keeps literal dollars escaped for docker stack deploy.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeDeploy } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import type { SourceEntry } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import { renderRelease, edgeLabels } from '../stack/render.mjs';
import { edgeOf } from '../stack/config.mjs';
import type { RenderOptions } from '../stack/render.mjs';
import type { Spawn, StackContext } from '../stack/context.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import { stackConfigModels } from './helpers/stack-compose.mjs';

/** The context the render reads: the seams of StackContext, writable so a test can swap one. */
type FakeContext = { -readonly [K in keyof StackContext]: StackContext[K] };

function renderFixture(t: TestContext, versionLine = '') {
  const root = mkdtemp(t, 'hfs-stack-render-version-');
  const stackFile = path.join(root, 'stack.yaml');
  fs.writeFileSync(stackFile, `${versionLine}services:\n  api:\n    image: registry.example/api:old\n`);
  const services = new Set(['api']);
  const members = new Set<string>();
  const normalized = normalizeDeploy({ images: { api: { app: 'api' } } }, { project: 'demo', probe: { exists: () => true, services, members } });
  assert.deepEqual(normalized.problems, []);
  const config: DeployConfig = { ...normalized.config!, env: 'production', project: 'demo', members, services, repoRoot: root, envDir: root, secretsDir: path.join(root, 'secrets'), stackFile };
  const calls = { spawn: 0, sops: 0, decrypt: 0 };
  const ctx = {
    env: { STARCI_SECRET_VERSION_KEY: 'fixture-version-value' }, now: () => 0,
    get sops() {
      calls.sops += 1;
      return { decrypt: () => { calls.decrypt += 1; assert.fail('this fixture opens no sealed members'); } };
    },
    spawn: ((command: string, args: readonly string[]) => {
      calls.spawn += 1;
      assert.equal(command, 'docker');
      assert.deepEqual(args.slice(0, 2), ['stack', 'config']);
      const models = stackConfigModels(args);
      return { status: 0, stdout: JSON.stringify(models[1]), stderr: '' };
    }) as unknown as Spawn, // reason: a fake of the foreground overload only
  } as unknown as FakeContext; // reason: the render reads only env, now, sops and spawn of the context
  const options: RenderOptions & { out: string } = { sourceSha: 'b'.repeat(40), out: path.join(root, 'out'),
    images: { api: `registry.example/api@sha256:${'a'.repeat(64)}` } };
  const extra = (name: string, line: string) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, `${line}services: {}\n`);
    return file;
  };
  return { root, config, ctx, options, calls, extra };
}

for (const [label, line, version] of [
  ['a pinned string', 'version: "3.8"\n', '3.8'],
  ['an absent version', '', undefined],
  ['a YAML number', 'version: 3.8\n', 3.8],
  ['the default major string', 'version: "3"\n', '3'],
  ['the default major number', 'version: 3\n', 3],
  ['an empty version string', 'version: ""\n', ''],
] as [string, string, string | number | undefined][]) {
  test(`render mirrors ${label} without changing its type`, async (t) => {
    const { ctx, config, options, calls } = renderFixture(t, line);
    const result = await renderRelease(ctx, config, options);
    assert.equal(result.ok, true);
    assert.equal(calls.spawn, 1);
    const override = JSON.parse(fs.readFileSync(path.join(options.out, 'stack.generated.yaml'), 'utf8'));
    assert.equal(override.version, version);
    assert.equal(Object.hasOwn(override, 'version'), version !== undefined);
  });
}

for (const [source, extra] of [
  ['version: "3.8"\n', 'version: "3.9"\n'],
  ['version: "3.8"\n', ''],
  ['', 'version: "3.8"\n'],
  ['version: "3.10"\n', 'version: 3.10\n'],
] as [string, string][]) {
  test(`incompatible extra ${extra.trim() || '(none)'} refuses source ${source.trim() || '(none)'} before effects`, async (t) => {
    const fixture = renderFixture(t, source);
    const { ctx, config, options, calls } = fixture;
    config.secrets.grants = [{ service: 'api', filePointers: true, from: [{ member: 'database', keys: null } as SourceEntry] }]; // reason: the fixture names only the fields the refusal reads
    options.extraCompose = [fixture.extra('matching.yaml', source), fixture.extra('mismatch.yaml', extra)];
    await assert.rejects(renderRelease(ctx, config, options), (error: Error & { code?: string; exit?: number }) => {
      assert.equal(error.code, 'STACK_COMPOSE_VERSION_MISMATCH');
      assert.equal(error.exit, 2);
      assert.match(error.message, /mismatch\.yaml.*docker stack config refuses files whose versions differ/u);
      return true;
    });
    assert.deepEqual(calls, { spawn: 0, sops: 0, decrypt: 0 });
    assert.equal(fs.existsSync(options.out), false);
  });
}

for (const source of ['', 'version: "3"\n', 'version: ""\n']) {
  test(`default-version extras merge with source ${source.trim() || '(none)'}`, async (t) => {
    const { ctx, config, options, calls, extra } = renderFixture(t, source);
    options.extraCompose = [extra('absent.yaml', ''), extra('major.yaml', 'version: "3"\n'), extra('empty.yaml', 'version: ""\n')];
    assert.equal((await renderRelease(ctx, config, options)).ok, true);
    assert.equal(calls.spawn, 1);
  });
}

test('numeric and string versions with the same Docker text merge', async (t) => {
  const { ctx, config, options, extra } = renderFixture(t, 'version: "3.8"\n');
  options.extraCompose = [extra('numeric.yaml', 'version: 3.8\n')];
  assert.equal((await renderRelease(ctx, config, options)).ok, true);
});

test('the Docker seam rejects the original pinned-source and unversioned-override regression', (t) => {
  const { config, extra } = renderFixture(t, 'version: "3.8"\n');
  const override = extra('override.yaml', '');
  assert.throws(() => stackConfigModels(['stack', 'config', '-c', config.stackFile, '-c', override]), /version mismatched between two composefiles/u);
});

test('a literal dollar in the rendered stack survives the second interpolation of docker stack deploy', async (t) => {
  const { ctx, config, options } = renderFixture(t);
  ctx.spawn = (() => ({ status: 0, stdout: 'services:\n  redis:\n    healthcheck:\n      test: ["CMD-SHELL", "REDISCLI_AUTH=$(cat /run/secrets/PW) redis-cli ping"]\n', stderr: '' })) as unknown as Spawn; // reason: a fake of the foreground overload only
  assert.equal((await renderRelease(ctx, config, options)).ok, true);
  const written = fs.readFileSync(path.join(options.out, 'stack.yaml'), 'utf8');
  assert.match(written, /REDISCLI_AUTH=\$\$\(cat \/run\/secrets\/PW\)/u);
  assert.doesNotMatch(written, /[^$]\$\(cat/u);
});

test('a shared edge renders the Traefik labels and the edge network from the declaration, and refuses a route to a service the stack lacks', (t) => {
  const { config, ctx, options, extra } = renderFixture(t);
  const edge = { network: 'edge', certResolver: 'letsencrypt', entrypoint: 'websecure', routes: [
    { host: 'b.example.test', service: 'api', port: 3000 }, { host: 'a.example.test', service: 'api', port: 3000 }, { host: 'admin.example.test', service: 'api', port: 3100 } ] };
  assert.deepEqual(edgeLabels(edge, 'web', 'stk'), []);
  const labels = edgeLabels(edge, 'api', 'stk');
  assert.ok(labels.includes('traefik.http.routers.stk-api-3000.rule=Host(`a.example.test`) || Host(`b.example.test`)'));
  assert.ok(labels.includes('traefik.http.routers.stk-api-3100.rule=Host(`admin.example.test`)'));
  assert.ok(labels.includes('traefik.http.routers.stk-api-3000.entrypoints=websecure'));
  assert.ok(labels.includes('traefik.http.routers.stk-api-3000.tls.certresolver=letsencrypt'));
  assert.ok(labels.includes('traefik.http.services.stk-api-3100.loadbalancer.server.port=3100'));
  assert.ok(labels.includes('traefik.docker.network=edge'));
  assert.ok(labels.includes('traefik.swarm.network=edge'));
  void extra;
  return renderRelease(ctx as StackContext, { ...config, edge: { ...edge, routes: [edge.routes[0]!] } }, options).then(() => {
    const generated = JSON.parse(fs.readFileSync(path.join(String(options.out), 'stack.generated.yaml'), 'utf8'));
    assert.deepEqual(generated.services.api.deploy.labels.filter((label: string) => label.includes('.rule=')), ['traefik.http.routers.' + config.stack + '-api.rule=Host(`b.example.test`)']);
    assert.deepEqual(generated.services.api.networks, ['default', 'edge'], 'a service with no network of its own keeps the default network');
    assert.deepEqual(generated.networks, { edge: { external: true } });
  }).then(() => {
    assert.throws(() => edgeOf({ kind: 'shared-edge', network: 'edge', certResolver: 'le', routes: [{ host: 'a.example.test', service: 'ghost', port: 80 }] }, new Set(['api']), 'staging'), /names the service ghost/);
    assert.equal(edgeOf({ component: 'ingress' }, new Set(['api']), 'staging'), null);
  });
});
