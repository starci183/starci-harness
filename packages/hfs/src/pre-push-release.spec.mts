// Both app editions render the same light push policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTargets } from '../sync/index.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';
import { git, push, ref, repository, ZERO } from './helpers/pre-push-fixture.mjs';
import { hookShapeFindings } from '../runtime/scripts/hfs/runtime-rules/hook-shape.mjs';

for (const edition of ['lite', 'full']) {
  test(`${edition}: the rendered hook permits clean main and candidate pushes without release evidence`, t => {
    const target = renderTargets({ ...structuredClone(APP), edition }, PRESETS).find(item => item.path === '.husky/pre-push');
    assert.ok(target);
    const repo = repository(t, target.content);
    const result = push(repo, [ref('refs/heads/main', repo.head, repo.older), ref('refs/heads/release/candidate-1.2.3', repo.head)]);
    assert.equal(result.status, 0, result.stderr);
    const file = 'packages/hfs/templates/app/hooks/husky/pre-push';
    assert.deepEqual(hookShapeFindings({ fileSet: new Set([file]), read: () => target.content }), []);
  });

  test(`${edition}: an annotated tag can leave with main; a lightweight tag or deleted main refuses the whole push`, t => {
    const target = renderTargets({ ...structuredClone(APP), edition }, PRESETS).find(item => item.path === '.husky/pre-push');
    assert.ok(target);
    const repo = repository(t, target.content);
    git(repo.root, 'tag', '-a', 'v1.2.3', '-m', 'notes');
    const tag = git(repo.root, 'rev-parse', 'refs/tags/v1.2.3');
    assert.equal(push(repo, [ref('refs/heads/main', repo.head), ref('refs/tags/v1.2.3', tag)]).status, 0);
    for (const row of [ref('refs/tags/v1.2.4', repo.head), ref('refs/heads/main', ZERO, repo.head)]) {
      const result = push(repo, [ref('refs/backup/lane', repo.head), row]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /RIGHTS_PUSH_NOT_RELEASE/);
    }
  });
}
