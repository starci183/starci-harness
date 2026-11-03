// `starci app stack up` builds the harness runtime layer an app image stands on when the layer is not published (images/README.md "The OpenClaw
// runtime layer", hard rule 8: the build is a governed heavy command), from the recipe this package ships; a layer the host holds or can pull is left alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { StackContext } from '../stack/context.mjs';
import type { LocalConfig } from '../stack/local-config.mjs';
import { ensureRuntimeLayers, layerPlan, layersUsed, recipeDirectory } from '../stack/runtime-layers.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const REFERENCE = `ghcr.io/starci183/openclaw-runtime:2026.10.10-starci.1@${DIGEST}`;
const REPOSITORY = path.resolve(import.meta.dirname, '..', '..', '..');

function app(t: test.TestContext, froms: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-runtime-layer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, from] of Object.entries(froms)) {
    fs.mkdirSync(path.join(root, '.starcistacks', 'images', name), { recursive: true });
    fs.writeFileSync(path.join(root, '.starcistacks', 'images', name, 'Dockerfile'), `FROM ${from}\nCOPY plugin /opt/starci/plugins/plugin\n`);
  }
  return root;
}

interface Run { command: string; args: readonly string[]; heavy: boolean }

/** A context whose docker answers by `inspect` (the local store) and `manifest` (the registry); every call is recorded. */
function context(held: boolean, published: boolean, failBuild = false): { ctx: StackContext; runs: Run[] } {
  const runs: Run[] = [];
  const answer = (command: string, args: readonly string[], heavy: boolean) => {
    runs.push({ command, args, heavy });
    const sub = `${args[0] ?? ''} ${args[1] ?? ''}`;
    const status = sub === 'image inspect' ? (held ? 0 : 1) : sub.startsWith('manifest inspect') ? (published ? 0 : 1) : (failBuild && args[0] === 'build' ? 1 : 0);
    return { status, stdout: '', stderr: status === 0 ? '' : 'build failed\nmore' };
  };
  const ctx = {
    env: {},
    spawn: (command: string, args: readonly string[]) => answer(command, args, false),
    heavy: (request: { argv: readonly string[] }) => Promise.resolve(answer(request.argv[0] ?? '', request.argv.slice(1), true)),
  } as unknown as StackContext;
  return { ctx, runs };
}

const local = (root: string): LocalConfig => ({ repoRoot: root, project: 'demo' }) as unknown as LocalConfig;

test('the layers an app builds on are the harness layers its image folders start FROM, once each, tag without the digest', (t) => {
  const root = app(t, { openclaw: REFERENCE, other: 'node:22', again: REFERENCE, minio: 'ghcr.io/starci183/minio:1.0.0' });
  assert.deepEqual(layersUsed(root), [{ layer: 'openclaw-runtime', reference: REFERENCE, tag: 'ghcr.io/starci183/openclaw-runtime:2026.10.10-starci.1', dockerfile: '.starcistacks/images/again/Dockerfile' }]);
  assert.deepEqual(layersUsed(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-no-images-'))), []);
  assert.match(layerPlan(local(root))[0] ?? '', /^plan runtime layer openclaw-runtime: ghcr\.io\/starci183\/openclaw-runtime:2026\.10\.10-starci\.1 is built from the shipped recipe/);
});

test('an unpublished layer is built from the shipped recipe as a governed heavy command and tagged for the app image', async (t) => {
  const root = app(t, { openclaw: REFERENCE });
  const { ctx, runs } = context(false, false);
  const lines = await ensureRuntimeLayers(ctx, local(root));
  const build = runs.find((run) => run.args[0] === 'build');
  assert.deepEqual(build, { command: 'docker', args: ['build', '-t', 'ghcr.io/starci183/openclaw-runtime:2026.10.10-starci.1', recipeDirectory('openclaw-runtime')], heavy: true });
  assert.match(lines.join('\n'), /is not published; built ghcr\.io\/starci183\/openclaw-runtime:2026\.10\.10-starci\.1 from the recipe this package ships/);
});

test('a layer the host holds, or the registry serves, is not built', async (t) => {
  const root = app(t, { openclaw: REFERENCE });
  for (const [held, published] of [[true, false], [false, true]] as const) {
    const { ctx, runs } = context(held, published);
    const lines = await ensureRuntimeLayers(ctx, local(root));
    assert.equal(runs.some((run) => run.args[0] === 'build'), false);
    assert.match(lines[0] ?? '', /is available/);
  }
});

test('a failed build is a coded failure that names the first line of docker', async (t) => {
  const root = app(t, { openclaw: REFERENCE });
  await assert.rejects(ensureRuntimeLayers(context(false, false, true).ctx, local(root)), (error: Error & { code?: string }) => /STACK_LOCAL_RUNTIME_LAYER/.test(`${error.code ?? ''}${error.message}`) && /build failed/.test(error.message));
});

test('the recipe this package ships is byte-equal to the harness images/openclaw-runtime that owns it', () => {
  const owner = path.join(REPOSITORY, 'images', 'openclaw-runtime');
  const shipped = recipeDirectory('openclaw-runtime');
  assert.deepEqual(fs.readdirSync(shipped).sort(), fs.readdirSync(owner).sort());
  for (const name of fs.readdirSync(owner)) assert.ok(fs.readFileSync(path.join(shipped, name)).equals(fs.readFileSync(path.join(owner, name))), `${name}: run npm run bundles in packages/hfs`);
});

test('the layer starts as root only to hand its state folder to the one runtime user the Dockerfile names, then drops to it', () => {
  const recipe = recipeDirectory('openclaw-runtime');
  const dockerfile = fs.readFileSync(path.join(recipe, 'Dockerfile'), 'utf8');
  const entrypoint = fs.readFileSync(path.join(recipe, 'entrypoint.sh'), 'utf8');
  assert.deepEqual(dockerfile.match(/^USER .+$/gmu)?.at(-1), 'USER root', 'the entrypoint needs root to give a host-created bind folder away');
  assert.deepEqual(dockerfile.match(/^ENV STARCI_RUNTIME_USER=.+$/gmu), ['ENV STARCI_RUNTIME_USER=node'], 'one place names the runtime user');
  assert.doesNotMatch(entrypoint, /\bnode:|--reuid=node|chown -R node/u, 'the entrypoint reads the user, it never names it');
  const drop = entrypoint.indexOf('exec setpriv --reuid="$user" --regid="$user" --init-groups');
  assert.ok(drop > 0 && drop < entrypoint.indexOf('file="/run/secrets/$name"'), 'nothing reads a secret or starts a process before the drop');
  assert.match(entrypoint, /if \[ "\$\(stat -c %u "\$state"\)" != "\$\(id -u "\$user"\)" \]; then chown -R "\$user:" "\$state"; fi/u, 'the folder is given away only when the user does not own it yet');
});
