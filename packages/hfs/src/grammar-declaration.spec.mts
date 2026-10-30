// The Grammar family is explicit frontend metadata and survives the same frozen HFS view every lint package reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { declaredHfsView } from '../runtime/scripts/hfs/view.mjs';

const runtimeRoot = fileURLToPath(new URL('../runtime/', import.meta.url));
interface DeclarationFixture { hfs: number; kind: string; project: string; edition: string; sides: Record<string, Record<string, unknown>> }
const declaration = (grammar: unknown, edition: string): DeclarationFixture => ({
  hfs: 3, kind: 'app', project: 'grammar-proof', edition,
  sides: {
    be: { apps: [{ name: 'api', kind: 'api' }] },
    fe: { apps: [{ name: 'web', kind: 'next' }], ...(grammar === undefined ? {} : { grammar }) },
  },
});

test('a selected Grammar family survives the resolved frontend declaration and immutable lint view in both editions', () => {
  const manifest = loadSlotManifest();
  for (const edition of ['lite', 'full']) for (const grammar of ['starci', 'offset-pop']) {
    const app = declaration(grammar, edition);
    assert.equal(resolveRepoDeclaration(manifest, app).sides?.fe?.grammar, grammar);
    assert.equal(resolveRepoDeclaration(manifest, app, { side: 'fe' }).grammar, grammar);
    const view = declaredHfsView({ runtimeRoot, declaration: app, repoRoot: '/grammar-proof/fe', side: 'fe' });
    assert.equal(view.grammar, grammar);
    assert.equal(Object.isFrozen(view), true);
  }
});

test('an absent Grammar family stays absent rather than choosing a family', () => {
  const manifest = loadSlotManifest();
  const app = declaration(undefined, 'lite');
  assert.equal(Object.hasOwn(resolveRepoDeclaration(manifest, app).sides!.fe!, 'grammar'), false);
  const view = declaredHfsView({ runtimeRoot, declaration: app, repoRoot: '/grammar-proof/fe', side: 'fe' });
  assert.equal(Object.hasOwn(view, 'grammar'), false);
});

test('a Grammar family must be a frontend family identifier', () => {
  const manifest = loadSlotManifest();
  for (const grammar of ['', 'StarCi', 'starci/common', null, 5, ['starci'], { family: 'core' }]) {
    assert.throws(() => resolveRepoDeclaration(manifest, declaration(grammar, 'full')), /sides\.fe\.grammar must name a Grammar family/);
  }
  const app = declaration('starci', 'lite');
  app.sides.be!.grammar = 'starci';
  assert.throws(() => resolveRepoDeclaration(manifest, app), /grammar belongs to the fe side/);
});
