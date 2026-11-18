// The managed storage image (slot app.storage.image, PROJECT-STATICS-2): `starci app sync` renders .starcistacks/images/storage/Dockerfile and its Dockerfile.dockerignore for a
// project that has statics/ or whose back end needs storage and for no other, adds the starter statics/.gitkeep, and the image builds mc from a pinned source tag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppSourceFacts } from '../sync/index.mjs';
import { bundledPresets, imageApps, renderTargets, upgradeEdits, validateHfs } from '../sync/index.mjs';
import { MC } from '../db/image.mjs';
import { STORAGE_IMAGE } from '../sync/dev-services.mjs';
import { starterDeclaration } from '../scaffold/app.mjs';

const DOCKERFILE = '.starcistacks/images/storage/Dockerfile';
const IGNORE = '.starcistacks/images/storage/Dockerfile.dockerignore';
// reason: the spec renders from a source with only the facts sync reads for this slot.
const source = (storageNeeded?: boolean): AppSourceFacts => ({ files: [], read: () => '', ...(storageNeeded === undefined ? {} : { storageNeeded }) }) as unknown as AppSourceFacts;
const rendered = (edition: 'lite' | 'full', storageNeeded?: boolean): Map<string, string> => new Map(renderTargets(starterDeclaration('demo', undefined, edition), bundledPresets(), { source: source(storageNeeded) }).map((target) => [target.path, String(target.content)]));

for (const edition of ['lite', 'full'] as const) {
  test(`${edition}: the storage image is rendered from the pinned MinIO and a source-built mc, with a dockerignore that admits statics/ only`, () => {
    const files = rendered(edition, true);
    const dockerfile = files.get(DOCKERFILE) as string;
    assert.ok(dockerfile, 'a project that needs storage gets the storage image');
    assert.ok(dockerfile.includes(`FROM ${STORAGE_IMAGE}\n`), 'the final stage is the pinned MinIO');
    assert.ok(dockerfile.includes(`FROM ${MC.buildImage} AS mc\n`), 'mc is compiled in a builder stage of the Dockerfile');
    assert.ok(dockerfile.includes(`ADD --checksum=sha256:${MC.sha256} ${MC.source} /tmp/mc.tar.gz`), 'the mc source is verified by sha256');
    assert.match(dockerfile, /^COPY --chown=minio:minio statics\/ \/statics\/$/mu);
    assert.match(dockerfile, /mc mirror --overwrite --quiet \/statics /u);
    assert.doesNotMatch(dockerfile, /^\s*mc mirror.*--remove/mu, 'the entrypoint never deletes');
    assert.match(dockerfile, /mc anonymous set "\$STATICS_PUBLIC" "local\/\$STATICS_BUCKET\/\$STATICS_PREFIX\/"/u, 'the public policy is the prefix, never the bucket');
    assert.doesNotMatch(dockerfile, /\{\{/u, 'every variable is rendered');
    assert.equal(files.get(IGNORE), '*\n!statics/\n');
  });

  test(`${edition}: a project with no statics and no storage use gets no storage image`, () => {
    const files = rendered(edition, false);
    assert.equal(files.has(DOCKERFILE), false);
    assert.equal(files.has(IGNORE), false);
    assert.equal(rendered(edition, true).has(DOCKERFILE), true);
    assert.equal(rendered(edition).has(DOCKERFILE), false, 'without source facts nothing is assumed: a tree with no storage need renders no storage image');
  });
}

test('a lite app that needs storage builds the image in the managed images workflow; one that does not, does not', () => {
  const lite = starterDeclaration('demo', undefined, 'lite');
  const apps = (needed: boolean): string[] => imageApps(validateHfs(lite), { storageNeeded: needed }).map((image) => image.name);
  assert.deepEqual(apps(true).slice(-2), ['db', 'storage']);
  assert.deepEqual(apps(false).slice(-1), ['db']);
  const named = imageApps(validateHfs(lite), { storageNeeded: false }, [{ app: 'storage' }]).map((image) => image.name);
  assert.deepEqual(named.slice(-2), ['db', 'storage'], 'a deploy that names the storage image builds it even before statics/ holds a file');
});

test('sync adds the starter statics/.gitkeep to an app that needs storage and has no folder, and nothing when the folder exists', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', edition: 'lite', project: 'demo', sides: { be: {}, fe: {} } }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@starci/object-storage': '1.0.0' } }));
  assert.deepEqual(upgradeEdits(root).edits.filter((edit) => edit.path.startsWith('statics/')).map((edit) => edit.path), ['statics/.gitkeep']);
  fs.mkdirSync(path.join(root, 'statics'));
  assert.deepEqual(upgradeEdits(root).edits.filter((edit) => edit.path.startsWith('statics/')), []);
  fs.rmSync(path.join(root, 'statics'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  assert.deepEqual(upgradeEdits(root).edits.filter((edit) => edit.path.startsWith('statics/')), [], 'no storage need, no folder is forced');
});
