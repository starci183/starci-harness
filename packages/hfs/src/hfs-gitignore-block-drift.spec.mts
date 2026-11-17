// proves: HFS_GITIGNORE_BLOCK_DRIFT@lite
// proves: HFS_GITIGNORE_BLOCK_DRIFT@full
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderTargets, writeTargets } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { APP, PRESETS } from './helpers/hfs-cli-fixture.mjs';

const synced = (context: TestContext, edition: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-proof-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const declaration = structuredClone(APP);
  declaration.edition = edition;
  if (edition === 'lite') declaration.sides.be.connections = [
    { name: 'primary', envPrefix: 'PRIMARY_DB', owner: 'core', isolation: 'schema', provider: 'postgres' },
  ];
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const targets = renderTargets(declaration, PRESETS);
  writeTargets(root, targets);
  const tracked = ['hfs.json', ...targets.map(target => target.path)];
  return { root, tracked, findings: () => managedFindings({ repoRoot: root, tracked, presets: PRESETS }) };
};

for (const edition of ['lite', 'full']) {
  test(`${edition}: a changed managed ignore block fails and its render passes`, async context => {
    const { root, findings } = synced(context, edition);
    const file = path.join(root, '.gitignore');
    const rendered = fs.readFileSync(file, 'utf8');
    assert.deepEqual(await findings(), []);
    const changed = rendered.replace('node_modules/\n', '');
    assert.notEqual(changed, rendered);
    fs.writeFileSync(file, changed);
    const found = await findings();
    assert.deepEqual(found.map(finding => [finding.code, finding.path, finding.level]), [
      ['HFS_GITIGNORE_BLOCK_DRIFT', '.gitignore', 'error'],
    ]);
    assert.match(found[0]?.message ?? '', /managed block of \.gitignore is not its render/);
    fs.writeFileSync(file, `# application ignores\nlocal-notes/\n${rendered}\n.idea/\n`);
    assert.deepEqual(await findings(), []);
  });
}

// Direct checker calls also expose these real mutation cases to the coverage proof analysis.
for (const edition of ['lite', 'full']) {
  test(`${edition}: a missing managed ignore block is invalid and restoring its render passes`, async context => {
    const { root, tracked } = synced(context, edition);
    const input = { repoRoot: root, tracked, presets: PRESETS };
    const file = path.join(root, '.gitignore');
    const rendered = fs.readFileSync(file, 'utf8');
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), []);
    fs.writeFileSync(file, '# application ignores\nlocal-notes/\n');
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), ['HFS_GITIGNORE_BLOCK_DRIFT']);
    fs.writeFileSync(file, rendered);
    assert.deepEqual((await managedFindings(input)).map(finding => finding.code), []);
  });
}

// The AGENTS.md `next dev` writes into an app under fe/apps is ignored; a root AGENTS.md, and one anywhere else, stays tracked.
for (const edition of ['lite', 'full']) {
  test(`${edition}: the managed ignore block ignores fe/apps/*/AGENTS.md and no other AGENTS.md`, context => {
    const { root } = synced(context, edition);
    const rendered = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.match(rendered, /^fe\/apps\/\*\/AGENTS\.md$/mu);
    assert.doesNotMatch(rendered, /^\/?AGENTS\.md$/mu);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const ignored = (file: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '--quiet', '--no-index', file], { cwd: root });
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(ignored('fe/apps/web/AGENTS.md'), true);
    assert.equal(ignored('fe/apps/admin/AGENTS.md'), true);
    assert.equal(ignored('AGENTS.md'), false);
    assert.equal(ignored('fe/AGENTS.md'), false);
    assert.equal(ignored('be/apps/api/AGENTS.md'), false);
  });
}

// The design canvas (PROJECT-GALLERY-6) is tracked under .starcistacks/canvas/; the rest of .starcistacks stays denied.
for (const edition of ['lite', 'full']) {
  test(`${edition}: the managed ignore block keeps .starcistacks/canvas tracked`, context => {
    const { root } = synced(context, edition);
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    const ignored = (file: string): boolean => {
      try {
        execFileSync('git', ['check-ignore', '--quiet', '--no-index', file], { cwd: root });
        return true;
      } catch {
        return false;
      }
    };
    assert.equal(ignored('.starcistacks/canvas/design.json'), false);
    assert.equal(ignored('.starcistacks/canvas/customers/list.html'), false);
    assert.equal(ignored('.starcistacks/canvas/shots/customers-list-1440.png'), false);
    assert.equal(ignored('.starcistacks/local/notes.txt'), true);
  });
}
