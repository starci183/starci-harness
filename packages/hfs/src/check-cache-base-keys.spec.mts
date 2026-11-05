// The db records and the Sonar and Codecov baselines are keyed by what they read at the base, never by its sha (7c.9a): a second run on an
// unchanged tree rewrites nothing, and neither does a commit or a merge that moves the base without moving what those records read (a cache
// commit, a merge of unrelated work). A base whose db inputs or tree content change moves them, as it must.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { baseInputs } from '../cache/db-family.mjs';
import { baseContent } from '../cache/app-families.mjs';
import { baselineRecords } from '../cache/quality-baselines.mjs';
import { serializeRecords } from '../cache/jsonl.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';

const GATE = fs.readFileSync(path.join(import.meta.dirname, '..', 'runtime', 'knowledge', 'sonar-gate.yaml'), 'utf8');
const CODECOV = 'coverage:\n  status:\n    project:\n      default:\n        target: 90%\n    patch:\n      default:\n        target: 95%\n';

function repo(t: TestContext) {
  const root = mkdtemp(t, 'starci-base-keys-');
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=spec', '-c', 'user.email=spec@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }).trim();
  const commit = (files: Record<string, string>, message: string): string => {
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    git('add', '-A');
    git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q');
  return { root, git, commit, run: (args: readonly string[]): string | undefined => { try { return git(...args); } catch { return undefined; } } };
}

const baselines = (gitRun: (args: readonly string[]) => string | undefined, base: string): string => {
  const records = baselineRecords({ baseCommit: base, baseContent: baseContent(gitRun, base), sonarGateYaml: GATE, sonarProperties: 'sonar.projectKey=app\nsonar.sources=be/src\n', codecovYaml: CODECOV });
  return serializeRecords([...records.sonar, ...records.codecov]);
};

test('a cache commit and an unrelated commit move the base sha but neither the db inputs at the base nor the baselines', (t) => {
  const r = repo(t);
  const first = r.commit({ 'hfs.json': '{}\n', 'db/migrations/20260101000000_create_note.sql': 'CREATE TABLE note (id int);\n', 'be/src/a.ts': 'export const a = 1;\n' }, 'base');
  const cache = r.commit({ '.starcistacks/cache/check/db/root.jsonl': '{"path":"db"}\n' }, 'the cache');
  assert.equal(baseInputs(r.root, cache), baseInputs(r.root, first), 'a cache commit leaves the db inputs alone');
  assert.equal(baselines(r.run, cache), baselines(r.run, first), 'and the baselines byte for byte: the second run rewrites nothing');
  const unrelated = r.commit({ 'fe/src/page.ts': 'export const page = 1;\n' }, 'unrelated work');
  assert.equal(baseInputs(r.root, unrelated), baseInputs(r.root, first), 'a merge or commit of unrelated work keeps the db record');
  assert.notEqual(baselines(r.run, unrelated), baselines(r.run, first), 'the new code base moves with the code it measures');
  const migration = r.commit({ 'db/migrations/20260102000000_add_note_title.sql': 'ALTER TABLE note ADD COLUMN title text;\n' }, 'a migration');
  assert.notEqual(baseInputs(r.root, migration), baseInputs(r.root, unrelated), 'a base whose db inputs changed judges the rules again');
  assert.equal(baseInputs(r.root, 'none'), 'none');
});
