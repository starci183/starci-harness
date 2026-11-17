// proves: STACK_BUILD_NO_DOCKERFILE@lite
// proves: STACK_BUILD_NO_DOCKERFILE@full
// proves: STACK_BUILD_AMBIGUOUS@lite
// proves: STACK_BUILD_AMBIGUOUS@full
// `starci app stack build` resolves the Dockerfile of a deploy image: .starcistacks/images/<app>/Dockerfile when the stacks keep one (the managed db and storage
// images, PROJECT-STATICS-5), else the Dockerfile of the app under be/apps or fe/apps; ambiguity and absence are refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dockerfileOf } from '../stack/build.mjs';
import type { DeployConfig } from '../stack/config.mjs';

/** A repository holding the given files, as the one `dockerfileOf` reads. */
function repo(t: { after: (cleanup: () => void) => void }, files: string[]): DeployConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'FROM scratch\n'); }
  return { repoRoot: root } as DeployConfig; // reason: dockerfileOf reads the repository root alone
}

test('an app with an image folder of the stacks builds that file: the storage image resolves like the db image', (t) => {
  const config = repo(t, ['.starcistacks/images/db/Dockerfile', '.starcistacks/images/storage/Dockerfile', 'be/apps/api/Dockerfile', 'fe/apps/web/Dockerfile']);
  assert.equal(dockerfileOf(config, 'storage'), '.starcistacks/images/storage/Dockerfile');
  assert.equal(dockerfileOf(config, 'db'), '.starcistacks/images/db/Dockerfile');
  assert.equal(dockerfileOf(config, 'api'), 'be/apps/api/Dockerfile');
  assert.equal(dockerfileOf(config, 'web'), 'fe/apps/web/Dockerfile');
});

test('the ambiguity and absence refusals of an app Dockerfile are unchanged', (t) => {
  const config = repo(t, ['be/apps/core/Dockerfile', 'fe/apps/core/Dockerfile']);
  assert.throws(() => dockerfileOf(config, 'core'), /STACK_BUILD_AMBIGUOUS|both sides/u);
  assert.throws(() => dockerfileOf(config, 'storage'), /no Dockerfile for app storage/u);
});
