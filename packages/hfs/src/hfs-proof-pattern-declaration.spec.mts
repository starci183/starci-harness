import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSlotManifest, resolveRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { declaredHfsView } from '../runtime/scripts/hfs/view.mjs';

const declaration = (edition: string, side: string, pattern: string) => ({
  hfs: 3, kind: 'app', project: 'demo', edition,
  sides: {
    be: { apps: [{ name: 'api', kind: 'api' }], patterns: side === 'be' ? [pattern] : [] },
    fe: { apps: [{ name: 'web', kind: 'next' }], patterns: side === 'fe' ? [pattern] : [] },
  },
});

for (const edition of ['lite', 'full']) {
  test(`${edition} exposes declared proof patterns as immutable lint metadata`, () => {
    const view = declaredHfsView({
      runtimeRoot: fileURLToPath(new URL('../runtime/', import.meta.url)),
      declaration: declaration(edition, 'be', 'idempotency'),
      repoRoot: process.cwd(), side: 'be',
    });
    assert.deepEqual(view.patterns, ['idempotency']);
    assert.throws(() => (view.patterns as string[]).push('projection'), TypeError); // reason: the readonly type is what the test proves is also frozen at run time
  });

  test(`${edition} admits a cross-cutting pattern owned by the backend proof catalog`, () => {
    assert.doesNotThrow(() => resolveRepoDeclaration(loadSlotManifest(), declaration(edition, 'be', 'idempotency')));
  });

  test(`${edition} still refuses unknown patterns and a backend proof pattern on the frontend`, () => {
    for (const [side, pattern] of [['be', 'no-such-pattern'], ['fe', 'idempotency']] as const) {
      assert.throws(() => resolveRepoDeclaration(loadSlotManifest(), declaration(edition, side, pattern)), /HFS_DECLARATION_INVALID/);
    }
  });
}
