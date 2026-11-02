// The per-file rules of the structure pass (`perFileRules` of check.mts), proved the way the lint cache proves its crossFileInputs: by running them under a file-system recorder.
// A per-file rule judges a file from that file's bytes and its declared `deps` alone: its findings over many files are the findings over each file on its own, every finding carries
// the path of the file it judges, and running it on one file reads that file and its deps under the app root and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { perFileRules, trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { createSlotResolver, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { RULE_FILES, appRepo, filesOf, recordFs } from './check-cache-structure-support.mjs';

for (const scope of ['', 'be', 'fe'] as const) {
  test(`per-file rules ${scope === '' ? 'of the app root' : `of the ${scope} side`} judge a file from that file and its declared deps alone`, (t) => {
    const root = appRepo(t, RULE_FILES);
    const declaration = readRepoDeclaration(loadSlotManifest(), root);
    const resolver = createSlotResolver(loadSlotManifest(), declaration);
    const repo = scope === '' ? declaration : declaration.sides![scope]!;
    const scoped = scope === '' ? resolver : resolver.sides![scope]!;
    const scopeRoot = scope === '' ? root : path.join(root, scope);
    const prefix = scope === '' ? '' : `${scope}/`;
    const tracked = trackedFiles(root).filter((file) => (scope === '' ? !file.startsWith('be/') && !file.startsWith('fe/') : file.startsWith(prefix))).map((file) => file.slice(prefix.length));
    const rules = perFileRules({ repoRoot: scopeRoot, repo, resolver: scoped, inScope: () => true, isRoot: scope === '' });
    const render = (findings: readonly object[]): string[] => findings.map((finding) => JSON.stringify(finding, Object.keys(finding).sort())).sort();
    let judged = 0;
    for (const rule of rules) {
      const together = rule.run([...tracked]);
      const apart: unknown[] = [];
      for (const file of tracked) {
        const deps = rule.deps?.(file) ?? [];
        const { value, accessed } = recordFs(scopeRoot, () => rule.run([file]));
        const allowed = new Set([file, ...deps].map((each) => each));
        const stray = [...filesOf(accessed)].filter((each) => !allowed.has(each) && each !== '.');
        assert.deepEqual(stray, [], `${rule.id} on ${file} read files it did not declare`);
        for (const finding of value) assert.equal(finding.path, file, `${rule.id}: a finding of ${file} names another path`);
        apart.push(...value);
      }
      judged += together.length;
      assert.deepEqual(render(together), render(apart as object[]), `${rule.id}: the findings over all files are the findings over each file alone`);
    }
    assert.ok(judged > 0, 'the fixture makes the rules find something in this scope');
  });
}

test('the README\'s secret findings do read the manifest beside it, and the rule declares it', (t) => {
  const root = appRepo(t, RULE_FILES);
  const declaration = readRepoDeclaration(loadSlotManifest(), root);
  const rule = perFileRules({ repoRoot: root, repo: declaration, resolver: createSlotResolver(loadSlotManifest(), declaration), inScope: () => true, isRoot: true }).find((each) => each.id === 'secret')!;
  const { accessed } = recordFs(root, () => rule.run(['docs/README.md']));
  assert.ok(filesOf(accessed).has('docs/.starcistacks/application-stacks.yaml'));
  assert.deepEqual(rule.deps?.('docs/README.md'), ['docs/.starcistacks/application-stacks.yaml']);
  assert.deepEqual(rule.deps?.('be/src/clean.ts') ?? [], []);
});
