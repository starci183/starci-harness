// stack-runtime-public-env.spec.mts - one image per sha (owner, 2026-11-21: "1 ảnh chỉnh theo môi trường chứ?"): an image that declares
// `runtimePublicEnv: true` is built without its NEXT_PUBLIC_* values (images.yml, stack build-args) and the deploy passes them to the service at
// runtime; without the declaration everything renders as before.
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildTimeArgs, normalizeDeploy, runtimePublicArgs } from '../runtime/scripts/hfs/stack-deploy-config.mjs';
import { parseWorkflow } from '../runtime/scripts/hfs/runtime-rules/workflow-source.mjs';
import { buildArgs } from '../stack/build-args.mjs';
import type { DeployConfig } from '../stack/config.mjs';
import type { Spawn, StackContext } from '../stack/context.mjs';
import { renderRelease } from '../stack/render.mjs';
import { renderTargets } from '../sync/index.mjs';
import { declaredStack } from '../sync/stack-images.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { stackConfigModels } from './helpers/stack-compose.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

// reason: a workflow document is parsed-YAML-shaped data the cases read freely.
type Doc = any;
// reason: the stub carries only the facts the workflow templates read.
type AppSource = NonNullable<NonNullable<Parameters<typeof renderTargets>[2]>['source']>;

const PUBLIC_VALUES = { NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SITE_URL: 'https://example.com' };
const webImage = (optIn: boolean, extra: Record<string, string> = {}) => ({
  app: 'web',
  buildArgs: { values: { ...PUBLIC_VALUES, ...extra }, sealed: { member: 'web', keys: ['NEXT_PUBLIC_MAPS_KEY'] } },
  ...(optIn ? { runtimePublicEnv: true } : {}),
});

/** A declaration that deploys web (sealed public values) and api in staging and production. */
const declaration = (optIn: boolean) => ({
  environments: {
    staging: { deploy: { auto: true, images: { api: { app: 'core' }, web: webImage(optIn) } } },
    production: { deploy: { auto: true, images: { api: { app: 'core' }, web: webImage(optIn) } } },
  },
});

function imagesWorkflow(optIn: boolean): Doc {
  const source = { files: [], read: () => '', stack: declaredStack(declaration(optIn)), hasImage: () => true } as unknown as AppSource;
  const targets = renderTargets({ ...structuredClone(APP), edition: 'lite' }, PRESETS, { source });
  const text = targets.find((target) => target.path === '.github/workflows/images.yml')?.content;
  assert.ok(text, 'images.yml is rendered');
  return parseWorkflow(text);
}

test('normalisation: runtimePublicEnv true is kept, absent leaves the entry exactly as before, a non-boolean is a problem', () => {
  const probe = { exists: () => true, services: new Set(['web']), members: new Set(['web']) };
  const on = normalizeDeploy({ images: { web: webImage(true) } }, { project: 'demo', probe });
  assert.deepEqual(on.problems, []);
  assert.equal(on.config?.images.web?.runtimePublicEnv, true);
  const off = normalizeDeploy({ images: { web: webImage(false) } }, { project: 'demo', probe });
  assert.deepEqual(off.config?.images.web, { app: 'web', buildArgs: { values: PUBLIC_VALUES, sealed: { member: 'web', keys: ['NEXT_PUBLIC_MAPS_KEY'] } } });
  const bad = normalizeDeploy({ images: { web: { app: 'web', runtimePublicEnv: 'yes' } } }, { project: 'demo', probe });
  assert.deepEqual(bad.problems.map((problem: { at: string }) => problem.at), ['deploy.images.web.runtimePublicEnv']);
});

test('the split: the build keeps the other keys, the runtime takes the NEXT_PUBLIC_* ones; without the opt-in the build keeps all', () => {
  const entry = webImage(true, { SENTRY_RELEASE: 'r1' });
  assert.deepEqual(buildTimeArgs(entry), { values: { SENTRY_RELEASE: 'r1' }, sealed: null });
  assert.deepEqual(runtimePublicArgs(entry), { values: PUBLIC_VALUES, sealed: { member: 'web', keys: ['NEXT_PUBLIC_MAPS_KEY'] } });
  const legacy = webImage(false, { SENTRY_RELEASE: 'r1' });
  assert.equal(buildTimeArgs(legacy), legacy.buildArgs, 'the default path hands back buildArgs itself');
  assert.deepEqual(runtimePublicArgs(legacy), { values: {}, sealed: null });
  assert.deepEqual(buildTimeArgs({ runtimePublicEnv: true }), { values: {}, sealed: null });
});

test('images.yml without the opt-in: the public values are build arguments, and the sealed ones bind the release environment', () => {
  const images = imagesWorkflow(false);
  assert.deepEqual(Object.keys(images.jobs), ['image', 'image-sealed', 'collect']);
  assert.equal(images.jobs['image-sealed'].environment, 'production');
  const web = images.jobs['image-sealed'].strategy.matrix.include.find((entry: Doc) => entry.name === 'web');
  assert.equal(web.args, true);
  const step = images.jobs['image-sealed'].steps.find((item: Doc) => item.id === 'args');
  assert.match(step.run, /starci app stack build-args --env production --app "\$IMAGE_APP"/u);
});

test('images.yml with the opt-in: one image per sha, no build values, no environment, no secret', () => {
  const images = imagesWorkflow(true);
  assert.deepEqual(Object.keys(images.jobs), ['image', 'collect'], 'no image-sealed job: nothing environment-specific is built in');
  assert.equal(images.jobs.image.environment, undefined);
  const web = images.jobs.image.strategy.matrix.include.find((entry: Doc) => entry.name === 'web');
  assert.equal(web.args, false, 'the build-args step is skipped');
  assert.equal(images.jobs.image.steps.some((item: Doc) => item.env?.SOPS_AGE_KEY), false);
  const collect = images.jobs.collect.steps.find((item: Doc) => item.id === 'refs');
  assert.match(collect.run, /web web false\n/u, 'the web digest is collected on every pushed run, not only a release');
});

test('stack build-args with the opt-in prints no NEXT_PUBLIC_* key and opens no sealed member that holds only public keys', async () => {
  const sops = { decrypt: () => assert.fail('no sealed member is opened for public keys') };
  // reason: buildArgs reads only env and the sops seam of the context, and the images of the config.
  const ctx = { env: {}, sops } as unknown as StackContext;
  const config = { images: { web: { ...webImage(true, { SENTRY_RELEASE: 'r1' }) } }, secretsDir: '/nowhere' } as unknown as DeployConfig;
  const result = await buildArgs(ctx, config, { app: 'web' });
  assert.deepEqual(result.lines, ['SENTRY_RELEASE=r1']);
  const legacy = await buildArgs(ctx, { ...config, images: { web: { app: 'web', buildArgs: { values: PUBLIC_VALUES, sealed: null } } } } as unknown as DeployConfig, { app: 'web' });
  assert.deepEqual(legacy.lines, ['NEXT_PUBLIC_API_URL=https://api.example.com', 'NEXT_PUBLIC_SITE_URL=https://example.com']);
});

/** A render of web with the given image entry and deploy.environment; the sealed member `web` holds NEXT_PUBLIC_MAPS_KEY. */
function renderScene(t: TestContext, image: Record<string, unknown>, environment: Record<string, unknown> = {}) {
  const root = mkdtemp(t, 'hfs-stack-runtime-public-');
  const stackFile = path.join(root, 'stack.yaml');
  fs.writeFileSync(stackFile, 'services:\n  web:\n    image: registry.example/web:old\n');
  const secretsDir = path.join(root, 'secrets');
  fs.mkdirSync(secretsDir);
  fs.writeFileSync(path.join(secretsDir, 'web.enc.yaml'), 'sops: {}\n');
  const services = new Set(['web']);
  const members = new Set(['web']);
  const normalized = normalizeDeploy({ images: { web: image }, environment }, { project: 'demo', probe: { exists: () => true, services, members } });
  assert.deepEqual(normalized.problems, []);
  const config: DeployConfig = { ...normalized.config!, env: 'staging', project: 'demo', members, services, repoRoot: root, envDir: root, secretsDir, stackFile };
  const opened: string[] = [];
  const ctx = {
    env: { STARCI_SECRET_VERSION_KEY: 'fixture-version-value' }, now: () => 0,
    sops: { decrypt: (file: string) => { opened.push(path.basename(file)); return { NEXT_PUBLIC_MAPS_KEY: 'maps-public' }; } },
    spawn: ((_command: string, args: readonly string[]) => ({ status: 0, stdout: JSON.stringify(stackConfigModels(args)[1]), stderr: '' })) as unknown as Spawn, // reason: a fake of the foreground overload only
  } as unknown as StackContext; // reason: the render reads only env, now, sops and spawn of the context
  const out = path.join(root, 'out');
  return { ctx, config, out, opened, run: async () => {
    await renderRelease(ctx, config, { sourceSha: 'b'.repeat(40), out, images: { web: `registry.example/web@sha256:${'a'.repeat(64)}` } });
    return { override: JSON.parse(fs.readFileSync(path.join(out, 'stack.generated.yaml'), 'utf8')), release: JSON.parse(fs.readFileSync(path.join(out, 'release.json'), 'utf8')) };
  } };
}

test('the deploy passes the NEXT_PUBLIC_* values to the web service at runtime, deploy.environment over them', async (t) => {
  const environment = { web: { values: { NEXT_PUBLIC_SITE_URL: 'https://staging.example.com', PORT: '3000' } } };
  const scene = renderScene(t, webImage(true), environment);
  const { override, release } = await scene.run();
  assert.deepEqual(override.services.web.environment, {
    NEXT_PUBLIC_API_URL: 'https://api.example.com', NEXT_PUBLIC_SITE_URL: 'https://staging.example.com', NEXT_PUBLIC_MAPS_KEY: 'maps-public', PORT: '3000',
  });
  assert.deepEqual(scene.opened, ['web.enc.yaml']);
  const other = await renderScene(t, webImage(true, { NEXT_PUBLIC_API_URL: 'https://api.other.example' }), environment).run();
  assert.notEqual(other.release.configDigest, release.configDigest, 'a changed runtime public value is a changed release');
});

test('without the opt-in the deploy passes no build value: the rendered override is what it was', async (t) => {
  const scene = renderScene(t, { app: 'web', buildArgs: { values: PUBLIC_VALUES } });
  const { override } = await scene.run();
  assert.deepEqual(override.services.web, { image: `registry.example/web@sha256:${'a'.repeat(64)}` });
  assert.deepEqual(scene.opened, []);
});
