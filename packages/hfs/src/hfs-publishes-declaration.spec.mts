/** An app declares the workspace packages it publishes to the local registry in hfs.json `publishes` (`starci deps publish-local`; contexts/authority/packages.md "The local registry"). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { declarationShapeProblems } from '../runtime/scripts/hfs/declaration-shape.mjs';
import { loadSlotManifest } from '../runtime/scripts/hfs/slots.mjs';

const manifest = loadSlotManifest();
const declaration = (extra: Record<string, unknown>) => ({ hfs: manifest.major, kind: 'app', project: 'demo', sides: { be: { apps: [{ name: 'api', kind: 'api', contract: 'rest' }], kinds: ['api'] } }, ...extra });

test('publishes is a non-empty unique list of package folders, and an app without it is unchanged', () => {
  assert.deepEqual(declarationShapeProblems(declaration({}), ['be', 'fe']), []);
  assert.deepEqual(declarationShapeProblems(declaration({ publishes: ['packages/nivoos-sdk', 'packages/nivoos-cli', 'packages/provider-templates'] }), ['be', 'fe']), []);
});

test('a malformed publishes is refused in the words of the declaration', () => {
  for (const bad of [[], 'packages/x', ['../x'], ['/abs'], ['packages\\x'], ['packages/x', 'packages/x'], [3]]) {
    assert.match(declarationShapeProblems(declaration({ publishes: bad }), ['be', 'fe']).join('\n'), /publishes must be a non-empty unique list of workspace package folders/);
  }
});

test('deps.devAllowsLocalRegistry is true or left out, and deps takes no other key', () => {
  const problems = (deps: unknown) => declarationShapeProblems(declaration({ deps }), ['be', 'fe']).join(' | ');
  assert.equal(problems({ devAllowsLocalRegistry: true }), '');
  assert.equal(problems({}), '');
  assert.match(problems({ devAllowsLocalRegistry: false }), /deps.devAllowsLocalRegistry is `true`/);
  assert.match(problems({ allowLocal: true }), /deps has unknown key allowLocal/);
  assert.match(problems(true), /deps must be an object/);
});
