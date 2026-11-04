// R374 (rules/stacks-service-images.mjs): a customised service is an image the app builds from .starcistacks/images/<name>/, never an upstream image with code mounted
// into it, and dev and production run the same image. Also: the fork list equals the harness's images/sources.json, and a fresh app of each edition raises nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { forkImages, stacksServiceImageFindings } from '../runtime/scripts/hfs/rules/stacks-service-images.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import type { LockResult } from '../scaffold/app.mjs';
import { bundledPresets } from '../sync/index.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;

interface Fixture {
  compose?: string;
  swarm?: string;
  dockerfile?: { name: string; text: string };
}

/** An app with a dev compose environment and a production swarm environment, each declaring the services of the fixture. */
function app(t: { after: (fn: () => void) => void }, { compose = 'services:\n  db:\n    image: postgres\n', swarm = 'services:\n  db:\n    image: postgres\n', dockerfile }: Fixture = {}): string {
  const root = mkdtemp(t as never, 'hfs-stacks-images-');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project: 'demo' }));
  const stacks = path.join(root, '.starcistacks');
  for (const [environment, file, text] of [['dev', 'infra/compose/compose.yaml', compose], ['production', 'infra/swarm/stack.yaml', swarm]] as const) {
    fs.mkdirSync(path.dirname(path.join(stacks, environment, file)), { recursive: true });
    fs.writeFileSync(path.join(stacks, environment, file), text);
  }
  if (dockerfile !== undefined) {
    fs.mkdirSync(path.join(stacks, 'images', dockerfile.name), { recursive: true });
    fs.writeFileSync(path.join(stacks, 'images', dockerfile.name, 'Dockerfile'), dockerfile.text);
  }
  fs.writeFileSync(path.join(stacks, 'application-stacks.yaml'), `schema: starci/application-stacks@1\nenvironments:\n  dev:\n    status: supported\n    runtime: docker-compose\n    composeFiles: [infra/compose/compose.yaml]\n  production:\n    status: supported\n    runtime: docker-swarm\n    composeFiles: [infra/swarm/stack.yaml]\n`);
  return root;
}

const codes = (root: string): string[] => stacksServiceImageFindings({ repoRoot: root, repo: { kind: 'app', edition: 'lite' } as never, isRoot: true }).map((finding) => finding.code);

test('R374 an upstream service with a named volume, a data bind, a socket and a read-only data file raises nothing', (t) => {
  const compose = `services:\n  db:\n    image: postgres\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n      - \${data}/pg:/backup\n      - /var/run/docker.sock:/var/run/docker.sock:ro\n      - ./config/app.json:/etc/app.json:ro\n`;
  assert.deepEqual(codes(app(t, { compose })), []);
});

test('R374 a bind of code, a script, a plugin directory or a writable config file is STACKS_CODE_BIND_MOUNT', (t) => {
  const bad = (volume: string): string[] => codes(app(t, { compose: `services:\n  openclaw:\n    image: upstream/openclaw\n    volumes:\n      - ${volume}\n` }));
  assert.deepEqual(bad('./wrapper/start.sh:/start.sh:ro'), ['STACKS_CODE_BIND_MOUNT']);
  assert.deepEqual(bad('./plugins:/plugins:ro'), ['STACKS_CODE_BIND_MOUNT']);
  assert.deepEqual(bad('./config/app.json:/etc/app.json'), ['STACKS_CODE_BIND_MOUNT']);
  const long = codes(app(t, { swarm: 'services:\n  openclaw:\n    image: upstream/openclaw\n    volumes:\n      - {type: bind, source: ./plugin.mjs, target: /plugin.mjs, read_only: true}\n' }));
  assert.deepEqual(long, ['STACKS_CODE_BIND_MOUNT']);
});

test('R374 an image folder is FROM a digest-pinned base, and the harness fork where the harness owns one', (t) => {
  const folder = (name: string, from: string) => ({ name, text: `FROM ${from}\nCOPY wrapper /wrapper\n` });
  assert.deepEqual(codes(app(t, { dockerfile: folder('tool', `node:22@${DIGEST}`) })), []);
  assert.deepEqual(codes(app(t, { dockerfile: folder('tool', 'node:22') })), ['STACKS_IMAGE_BASE_UNPINNED']);
  assert.deepEqual(codes(app(t, { dockerfile: folder('openclaw', `ghcr.io/openclaw/openclaw:1@${DIGEST}`) })), ['STACKS_IMAGE_BASE_NOT_FORK']);
  assert.deepEqual(codes(app(t, { dockerfile: folder('openclaw', `ghcr.io/starci183/openclaw-runtime:1.0.0@${DIGEST}`) })), []);
  const staged = { name: 'tool', text: `FROM node:22@${DIGEST} AS build\nRUN true\nFROM build\n` };
  assert.deepEqual(codes(app(t, { dockerfile: staged })), []);
});

test('R374 a service with an image folder runs the folder image in every environment', (t) => {
  const dockerfile = { name: 'openclaw', text: `FROM ghcr.io/starci183/openclaw-runtime:1@${DIGEST}\n` };
  const built = 'services:\n  openclaw:\n    build: {context: ../../images/openclaw}\n';
  const owned = 'services:\n  openclaw:\n    image: demo/openclaw:1.0.0\n';
  const upstream = 'services:\n  openclaw:\n    image: ghcr.io/openclaw/openclaw:latest\n';
  assert.deepEqual(codes(app(t, { dockerfile, compose: built, swarm: owned })), []);
  assert.deepEqual(codes(app(t, { dockerfile, compose: upstream, swarm: owned })), ['STACKS_IMAGE_ENV_DIVERGES']);
  assert.deepEqual(codes(app(t, { dockerfile, compose: built, swarm: upstream })), ['STACKS_IMAGE_ENV_DIVERGES']);
});

test('R374 a project image the deploy renders (registry/<owner>/<project>-<name>, its placeholder digest) is the folder image; a foreign one diverges', (t) => {
  const dockerfile = { name: 'db', text: `FROM postgres:17@${DIGEST}\n` };
  const built = 'services:\n  db:\n    build: {context: ../../images/db}\n';
  const rendered = `services:\n  db:\n    image: ghcr.io/owner/demo-db@sha256:${'0'.repeat(64)}\n`;
  const bare = 'services:\n  db:\n    image: demo:1.0.0\n';
  const foreign = `services:\n  db:\n    image: ghcr.io/owner/demonstration-db@sha256:${'0'.repeat(64)}\n`;
  assert.deepEqual(codes(app(t, { dockerfile, compose: built, swarm: rendered })), []);
  assert.deepEqual(codes(app(t, { dockerfile, compose: built, swarm: bare })), []);
  assert.deepEqual(codes(app(t, { dockerfile, compose: built, swarm: foreign })), ['STACKS_IMAGE_ENV_DIVERGES']);
});

test('R374 the fork list is the harness images/sources.json', () => {
  const sources = JSON.parse(fs.readFileSync(new URL('../../../images/sources.json', import.meta.url), 'utf8')) as Record<string, { layerOf?: string; image?: string; base?: string; published: { reference: string } | null }>;
  const repository = (reference: string): string => reference.replace(/@sha256:[0-9a-f]+$/u, '').replace(/:[^/:]+$/u, '');
  // A service runs the harness layer built on its fork when the harness ships one, else the fork itself.
  const expected: Record<string, string> = {};
  for (const [name, image] of Object.entries(sources)) if (image.layerOf === undefined && image.published !== null) expected[name] = repository(image.published.reference);
  for (const image of Object.values(sources)) if (image.layerOf !== undefined) expected[image.layerOf] = image.image ?? '';
  assert.deepEqual(forkImages(), expected);
});

for (const edition of ['lite', 'full']) {
  test(`R374 a fresh ${edition} app raises nothing`, (t) => {
    const lock = (root: string): LockResult => { fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n'); return { ok: true }; };
    const { root } = scaffoldApp({ name: 'demo', into: mkdtemp(t, `starci-images-${edition}-`), harness: { version: '1.1.0-alpha.3' }, edition, presets: bundledPresets(), lock, initGit: init });
    assert.deepEqual(stacksServiceImageFindings({ repoRoot: root, repo: { kind: 'app', edition } as never, isRoot: true }), []);
  });
}

test('R374 the OpenClaw runtime layer is built on the recorded fork digest and ships the wrapper an app image extends', () => {
  const sources = JSON.parse(fs.readFileSync(new URL('../../../images/sources.json', import.meta.url), 'utf8')) as Record<string, { base?: string; published: { reference: string } | null; pluginDirectory?: string }>;
  const layer = sources['openclaw-runtime'];
  assert.ok(layer?.base);
  assert.equal(layer.base, sources['openclaw']?.published?.reference);
  const folder = new URL('../../../images/openclaw-runtime/', import.meta.url);
  const dockerfile = fs.readFileSync(new URL('Dockerfile', folder), 'utf8');
  assert.ok(dockerfile.split(/\r?\n/u).includes(`FROM ${layer.base}`));
  assert.ok(dockerfile.includes(layer.pluginDirectory ?? 'missing'));
  for (const file of ['entrypoint.sh', 'openclaw-init.mjs', 'openclaw-relay.mjs']) assert.ok(fs.existsSync(new URL(file, folder)), file);
  assert.doesNotMatch(dockerfile + fs.readFileSync(new URL('openclaw-init.mjs', folder), 'utf8'), /nivo/iu);
});
