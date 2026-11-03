// `starci app codemod seeds-layout` moves an app's seed data into the seed levels of .starcistacks (ruling seed-levels): db/seed.sql to the
// shared level's sql/reference.sql, each loose SQL file of <env>/seeds/ to that level's sql/, each declared in its level's seeds.yaml, and
// every level gets its manifest and a .gitkeep per empty kind folder; a dry run writes nothing, a second run finds nothing to do, and a
// conflict, a loose seed that is no SQL and a source that names an old seed home are left for a person.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEMODS, codemodMain } from '../codemod/main.mjs';
import { migrateSeedsLayout, seedsLayoutMarkdown } from '../codemod/seeds-layout.mjs';
import { seedsFindings } from '../runtime/scripts/hfs/rules/seeds.mjs';
import { readSeedLevel } from '../runtime/scripts/hfs/stack-seeds-config.mjs';

const DECLARATION = 'schema: starci/application-stacks@1\nenvironments:\n  dev: {runtime: docker-compose}\n  production: {runtime: docker-swarm}\n';

function app(t: TestContext, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-seeds-layout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

/** Every file under `root` but the stack declaration, app-relative and sorted. */
const listing = (root: string): string[] => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .filter((file) => file !== '.starcistacks/application-stacks.yaml')
  .sort();

test('seeds-layout is one of the codemods', () => {
  assert.ok(CODEMODS.includes('seeds-layout'));
});

test('a dry run reports and writes nothing; --execute moves, declares and completes the levels; the result is green and a rerun has nothing to do', (t) => {
  const root = app(t, {
    '.starcistacks/application-stacks.yaml': DECLARATION,
    '.starcistacks/dev/seeds/Primary Notes.sql': "insert into notes values (1) on conflict do nothing;\n",
    '.starcistacks/dev/README.md': '# dev\n',
    'db/seed.sql': "insert into plans values ('free') on conflict do nothing;\n",
  });
  const before = listing(root);
  const dry = migrateSeedsLayout({ root });
  assert.deepEqual(listing(root), before, 'a dry run writes nothing');
  assert.deepEqual(dry.moves, [
    { from: '.starcistacks/dev/seeds/Primary Notes.sql', to: '.starcistacks/dev/seeds/sql/Primary Notes.sql', entry: 'primary-notes', action: 'move' },
    { from: 'db/seed.sql', to: '.starcistacks/seeds/sql/reference.sql', entry: 'reference', action: 'move' },
  ]);
  assert.match(seedsLayoutMarkdown(dry), /2 seed file\(s\) would be moved, 8 level file\(s\) would be created, 0 left for a person/u);

  const done = migrateSeedsLayout({ root, write: true });
  assert.equal(done.moves.length, 2);
  assert.equal(fs.existsSync(path.join(root, 'db/seed.sql')), false);
  for (const env of [null, 'dev', 'production']) assert.deepEqual(readSeedLevel(root, env).problems, [], String(env));
  assert.deepEqual(readSeedLevel(root, 'dev').entries.map((entry) => [entry.id, entry.path, entry.target, entry.mode]), [['primary-notes', 'sql/Primary Notes.sql', 'primary', 'upsert']]);
  assert.deepEqual(seedsFindings({ repoRoot: root, files: listing(root) }), []);
  const markdown = seedsLayoutMarkdown(done);
  assert.match(markdown, /## Moved[\s\S]*## Created\n\n- \.starcistacks\/seeds\/data\/\.gitkeep/u);

  const again = migrateSeedsLayout({ root, write: true });
  assert.deepEqual([again.moves, again.created, again.findings], [[], [], []]);
});

test('a target with the same bytes drops the old copy; other bytes, a loose seed that is no SQL and an old reference are left for a person', (t) => {
  const root = app(t, {
    '.starcistacks/application-stacks.yaml': DECLARATION,
    '.starcistacks/dev/seeds/same.sql': 'select 1;\n',
    '.starcistacks/dev/seeds/sql/same.sql': 'select 1;\n',
    '.starcistacks/production/seeds/other.sql': 'select 2;\n',
    '.starcistacks/production/seeds/sql/other.sql': 'select 3;\n',
    '.starcistacks/production/seeds/modules.json': '{}\n',
    'be/src/modules/platform/database/seed-runner.service.ts': 'const SEED_FILE = "db/seed.sql"\n',
    'be/src/modules/platform/database/seed-connections.client.ts': 'export const seedDirectoryOf = (env: string): string => join(".starcistacks", env, "seeds")\n',
    'be/src/clean.ts': 'export const x = 1\n',
  });
  const report = migrateSeedsLayout({ root, write: true });
  assert.deepEqual(report.moves, [{ from: '.starcistacks/dev/seeds/same.sql', to: '.starcistacks/dev/seeds/sql/same.sql', entry: 'same', action: 'drop' }]);
  assert.equal(fs.existsSync(path.join(root, '.starcistacks/dev/seeds/same.sql')), false);
  assert.deepEqual(report.findings.map((item) => `${item.code} ${item.file}`), [
    'SEEDS_LAYOUT_NOT_SQL .starcistacks/production/seeds/modules.json',
    'SEEDS_LAYOUT_CONFLICT .starcistacks/production/seeds/other.sql',
    'SEEDS_LAYOUT_REFERENCE be/src/modules/platform/database/seed-connections.client.ts:1',
    'SEEDS_LAYOUT_REFERENCE be/src/modules/platform/database/seed-runner.service.ts:1',
  ]);
  assert.equal(fs.readFileSync(path.join(root, '.starcistacks/production/seeds/sql/other.sql'), 'utf8'), 'select 3;\n', 'a conflict keeps both copies');
  assert.match(seedsLayoutMarkdown(report), /## Left for a person/u);
});

test('an app with no stack declaration gets the shared level only', (t) => {
  const root = app(t, { 'package.json': '{}\n' });
  const report = migrateSeedsLayout({ root, write: true });
  assert.deepEqual([report.environments, report.moves], [[], []]);
  assert.deepEqual(report.created, ['.starcistacks/seeds/seeds.yaml', '.starcistacks/seeds/sql/.gitkeep', '.starcistacks/seeds/data/.gitkeep', '.starcistacks/seeds/files/.gitkeep']);
  assert.deepEqual(readSeedLevel(root, null).problems, []);
});

test('codemodMain runs seeds-layout dry by default and exits 1 while a case is left for a person', (t) => {
  const clean = app(t, { '.starcistacks/application-stacks.yaml': DECLARATION, 'db/seed.sql': 'select 1;\n' });
  const out: string[] = [];
  assert.equal(codemodMain(['seeds-layout'], { cwd: clean, stdout: (text) => out.push(text) }), 0);
  assert.equal(fs.existsSync(path.join(clean, 'db/seed.sql')), true);
  assert.equal(codemodMain(['seeds-layout', '--execute', '--json'], { cwd: clean, stdout: (text) => out.push(text) }), 0);
  assert.equal(JSON.parse(out.at(-1) ?? '{}').schema, 'starci/seeds-layout-report@1');
  const left = app(t, { '.starcistacks/application-stacks.yaml': DECLARATION, '.starcistacks/dev/seeds/x.csv': '' });
  assert.equal(codemodMain(['seeds-layout'], { cwd: left, stdout: () => undefined }), 1);
});
