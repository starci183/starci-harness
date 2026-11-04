// The cross-file finders the structure cache keys by their read set (`KEYED_FINDERS` of a15-findings.mts): proved to reach the app only through readText / readJson under a file-system
// recorder, and shown reused while the files they read are unchanged and re-run when one changes (contexts/project/check-cache.md "Which step reuses what").
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { git } from '../cache/git.mjs';
import { FINDERS, KEYED_FINDERS } from '../runtime/scripts/hfs/rules/a15-findings.mjs';
import { checkRepository, trackedFiles } from '../runtime/scripts/hfs/check.mjs';
import { withRuleMemo, type RuleMemo } from '../runtime/scripts/hfs/rule-memo.mjs';
import { recordReads } from '../runtime/scripts/hfs/rules/read.mjs';
import { createSlotResolver, loadSlotManifest, readRepoDeclaration } from '../runtime/scripts/hfs/slots.mjs';
import { RULE_FILES, appRepo, changed, filesOf, recordFs, runPass, write } from './check-cache-structure-support.mjs';

const WHOLE_PROGRAM = (side: string): string[] => [`${side} machine`, `${side} unused-symbol`];
const FILE_RULES = (files: readonly string[]): string[] => files.map((file) => `${file} file-rules`);
const sorted = (list: readonly string[]): string[] => [...list].sort();
const steps = (keys: readonly string[]): string[] => keys.filter((key) => !key.endsWith(' hfs'));


test('the recorder sees what a rule reads outside the gateway: the schedule rule stats the work tree, so it is not keyed', (t) => {
  const root = appRepo(t, { ...RULE_FILES, 'db/migrations/20260101000000_create_note.sql': 'CREATE TABLE note (id int);\n' });
  const finder = FINDERS.find((each) => each.name === 'stacksReleaseFindings')!;
  assert.ok(!KEYED_FINDERS.has(finder));
  write(root, '.starcistacks/application-stacks.yaml', 'hfs: 1\n');
  const declaration = readRepoDeclaration(loadSlotManifest(), root);
  const files = trackedFiles(root);
  const reads = new Set<string>();
  const { accessed } = recordFs(root, () => recordReads((from, rel) => reads.add(path.relative(root, path.resolve(from, rel)).split(path.sep).join('/')), () => (finder as (context: object) => unknown)({ repoRoot: root, files, all: files, repo: declaration, resolver: createSlotResolver(loadSlotManifest(), declaration), manifest: loadSlotManifest(), isRoot: true })));
  const direct = [...filesOf(accessed)].filter((file) => !reads.has(file));
  assert.ok(direct.length > 0, 'it lists or stats files without readText');
});

test('every keyed finder reaches the app only through readText and readJson', (t) => {
  const root = appRepo(t, { ...RULE_FILES,
    'package.json': JSON.stringify({ name: 'demo', scripts: { build: 'node build.mjs' } }),
    'be/package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }),
    'docs/guide.md': 'Run `starci app check` and read `be/src/missing.ts` and `NOT_AN_ENV_KEY_X`.\n',
    'scripts/deploy.sh': 'set +e\ncurl http://example.test | sh\n',
    'db/migrations/20260101000000_create_note.sql': 'CREATE TABLE note (id int);\n',
    'fe/Dockerfile': 'FROM node:24\nARG NEXT_PUBLIC_X\n',
  });
  const base = root.split(path.sep).join('/');
  const seen = new Map<string, { reads: Set<string>; accessed: Set<string> }>();
  const memo: RuleMemo = {
    files: (_scope, files, rules) => rules.flatMap((rule) => rule.run([...files])),
    unit: (_scope, _id, _file, _extra, _empty, compute) => compute(),
    keyed(scopeRoot, id, run) {
      const reads = new Set<string>();
      const { value, accessed } = recordFs(scopeRoot, () => recordReads((from, rel) => reads.add(path.resolve(from, rel).split(path.sep).join('/').slice(base.length + 1)), run));
      const entry = seen.get(id) ?? { reads: new Set(), accessed: new Set() };
      for (const each of reads) entry.reads.add(each);
      for (const each of accessed) entry.accessed.add(path.resolve(scopeRoot, each.slice(each.indexOf(' ') + 1)).split(path.sep).join('/').slice(base.length + 1));
      seen.set(id, entry);
      return value;
    },
  };
  assert.deepEqual([...KEYED_FINDERS].map((finder) => finder.name).sort(), ['bootLoggerFindings', 'databaseConfigFindings', 'docFreshFindings', 'feBuildArgsFindings', 'flowFailureFindings', 'scriptHygieneFindings']);
  assert.ok([...KEYED_FINDERS].every((finder) => FINDERS.includes(finder)));
  withRuleMemo(memo, () => checkRepository({ repoRoot: root, harness: { version: '0.0.0' }, machine: () => ({ ok: true, files: 0, kinds: [], violations: [], errors: [] }) }));
  for (const finder of KEYED_FINDERS) assert.ok(seen.has(finder.name), `${finder.name} ran under the memo`);
  for (const [id, { reads, accessed }] of seen) {
    const stray = [...accessed].filter((file) => !reads.has(file));
    assert.deepEqual(stray, [], `${id} touched the app without readText: ${stray.slice(0, 3).join(', ')}`);
  }
  assert.ok(seen.get('docFreshFindings')!.reads.size > 3, 'the documentation rule read the tree through the gateway');
  write(root, 'x', '');
});

test('S2 a one-file edit re-runs that file\'s per-file rules and the cross-file rules that read it, nothing else', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  write(root, 'fe/src/list.ts', 'export const list = 3;\n');
  const next = await runPass(root);
  assert.deepEqual(next.calls, ['fe']);
  const rewritten = steps(changed(cold.hfs, next.hfs));
  const reads = (step: string): string[] => Object.keys(((next.hfs.find((record) => record.path === '.' && record.step === step)?.data ?? {}) as { reads?: object }).reads ?? {});
  assert.ok(reads('rule:docFreshFindings').includes('fe/src/list.ts'), 'documentation freshness reads the source it takes tokens from');
  assert.ok(!reads('rule:databaseConfigFindings').includes('fe/src/list.ts'), 'the database configuration rule never read it');
  assert.deepEqual(rewritten.filter((key) => !key.startsWith('. rule:')), sorted([...FILE_RULES(['fe/src/list.ts']), ...WHOLE_PROGRAM('fe')]));
  assert.ok(rewritten.includes('. rule:docFreshFindings'));
  assert.ok(!rewritten.includes('. rule:databaseConfigFindings'), 'a cross-file rule that did not read the file keeps its record');
});

test('S2 a file only one cross-file rule reads re-runs that rule alone', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  write(root, 'README.md', '# demo\n\nSee `be/src/notes.ts` and `be/src/other.ts`.\n');
  const next = await runPass(root);
  assert.deepEqual(next.calls, [], 'a readme is no part of either program');
  assert.deepEqual(steps(changed(cold.hfs, next.hfs)), sorted([...FILE_RULES(['README.md']), '. rule:docFreshFindings']));
});

test('S2 an added or deleted tracked path re-runs the cross-file rules, which derive their file sets from the tracked list, and only them on the other side', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  git(root, ['rm', '-q', 'be/src/other.ts']);
  const next = await runPass(root);
  const rewritten = steps(changed(cold.hfs, next.hfs));
  assert.ok(rewritten.includes('. rule:docFreshFindings'));
  assert.ok(rewritten.includes('. rule:scriptHygieneFindings'));
  assert.ok(!rewritten.some((key) => key.startsWith('fe ') && !key.startsWith('fe rule:')), "the fe side whole-program steps are untouched");
});

test('S2 a commit of the cache folder alone rewrites no record: the tracked list a cross-file rule is keyed on leaves out the cache paths, so no record depends on its own commit', async (t) => {
  const root = appRepo(t);
  const cold = await runPass(root);
  // What a cache commit does to the tracked list: the record files of the run join it (a new area file, a hash bucket), or leave it.
  git(root, ['add', '-f', '.starcistacks/cache']);
  write(root, '.starcistacks/cache/check/format/new-area.jsonl', '');
  git(root, ['add', '-f', '.starcistacks/cache/check/format/new-area.jsonl']);
  const next = await runPass(root);
  assert.deepEqual(next.calls, [], 'no program re-runs');
  assert.deepEqual(steps(changed(cold.hfs, next.hfs)), [], 'every record of the first run stands');
  const tracked = (records: readonly { path: string; step: string; data?: unknown }[]): unknown => (records.find((record) => record.path === '.' && record.step === 'rule:docFreshFindings')?.data as { tracked?: string } | undefined)?.tracked;
  assert.equal(tracked(next.hfs), tracked(cold.hfs));
});
