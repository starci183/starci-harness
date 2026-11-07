// A unit spec's closure key holds its Jest project's configuration by a digest that one commit gives alike in every checkout: the paths of the Jest
// root and of the app root (where the preset, the transform and the setup files resolve into the install) are host paths, never content, so a clone
// in another folder, a worktree or a CI runner reuses the committed records instead of running every spec again.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectConfigHash } from '../cache/test-family.mjs';

/** The configuration Jest normalises for an app at `app`: its root, and the paths outside it that its install resolves to. */
const configAt = (app: string) => ({
  rootDir: path.join(app, 'be'),
  roots: [path.join(app, 'be', 'src')],
  moduleNameMapper: [['^@modules/(.*)$', path.join(app, 'be', 'src', 'modules', '$1')]],
  transform: [['^.+\\.ts$', path.join(app, 'node_modules', 'ts-jest', 'dist', 'index.js'), {}]],
  setupFiles: [path.join(app, 'node_modules', '@starci', 'jest-preset', 'dist', 'setup.js')],
  cacheDirectory: path.join(app, '.cache', 'jest'),
  id: 'host-specific',
}) as unknown as Parameters<typeof projectConfigHash>[0];

test('one configuration hashes alike in two checkouts of one commit, its install under each app root', () => {
  const left = path.resolve('/work/one/app');
  const right = path.resolve('/runner/_work/two/clone');
  assert.equal(projectConfigHash(configAt(left), left), projectConfigHash(configAt(right), right));
});

test('a configuration that changes still changes its digest', () => {
  const app = path.resolve('/work/one/app');
  const changed = { ...configAt(app), setupFiles: [] } as unknown as Parameters<typeof projectConfigHash>[0];
  assert.notEqual(projectConfigHash(configAt(app), app), projectConfigHash(changed, app));
});
