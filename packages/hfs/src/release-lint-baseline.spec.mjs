// The lint of an urgent release judged against a baseline tag (release/lint-baseline.mjs, owner ruling urgent-lint-baseline): a finding is the
// baseline's when engine, rule, file and message match (lines move), or, left over, engine, rule and message (a moved file); the rest is new.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { contextOf } from '../release/index.mjs';
import { baselineLint, newFindings, sonarFindings } from '../release/lint-baseline.mjs';

const finding = (file, rule, message, line = 1) => ({ engine: 'eslint', rule, file, line, message });

test('a finding the baseline holds is not new, whatever line it moved to', () => {
  const baseline = [finding('be/a.ts', 'schema-owner', 'reads x', 3)];
  assert.deepEqual(newFindings([finding('be/a.ts', 'schema-owner', 'reads x', 40)], baseline), []);
});

test('a finding beyond the baseline count is new', () => {
  const baseline = [finding('be/a.ts', 'r', 'm')];
  const head = [finding('be/a.ts', 'r', 'm', 1), finding('be/a.ts', 'r', 'm', 9)];
  assert.equal(newFindings(head, baseline).length, 1);
});

test('a finding of a moved file matches a left-over baseline finding on engine, rule and message', () => {
  const baseline = [finding('be/old/a.ts', 'r', 'm')];
  assert.deepEqual(newFindings([finding('be/new/a.ts', 'r', 'm')], baseline), []);
});

test('a baseline finding matched exactly is not reused for a moved one', () => {
  const baseline = [finding('be/a.ts', 'r', 'm')];
  const head = [finding('be/a.ts', 'r', 'm'), finding('be/b.ts', 'r', 'm')];
  assert.deepEqual(newFindings(head, baseline), [finding('be/b.ts', 'r', 'm')]);
});

test('another rule or message on the same file is new', () => {
  const baseline = [finding('be/a.ts', 'r', 'm')];
  assert.equal(newFindings([finding('be/a.ts', 'r2', 'm'), finding('be/a.ts', 'r', 'other')], baseline).length, 2);
});

test('sonarFindings reads a Generic Issue Import file and refuses a missing or malformed one', (t) => {
  const dir = fs.mkdtempSync(path.join(tempRoot(), 'hfs-lint-baseline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'r.json');
  fs.writeFileSync(file, JSON.stringify({ rules: [], issues: [{ engineId: 'eslint', ruleId: 'r', primaryLocation: { message: 'm', filePath: 'be/a.ts', textRange: { startLine: 4 } } }] }));
  assert.deepEqual(sonarFindings(file), [finding('be/a.ts', 'r', 'm', 4)]);
  assert.equal(sonarFindings(path.join(dir, 'missing.json')), null);
  fs.writeFileSync(file, '{"issues": 3}');
  assert.equal(sonarFindings(file), null);
});

const git = (cwd, ...args) => {
  const run = spawnSync('git', ['-c', 'user.email=bench@example.invalid', '-c', 'user.name=bench', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout.trim();
};

// The stand-in managed lint: `npm run lint -- --sonar <file>` writes the issues of findings.json (tracked, so each commit has its own) and
// exits 1 when there is one; it also reads a module from node_modules, which only the borrowed install provides.
const LINT = [
  "import fs from 'node:fs';",
  "import { mark } from './node_modules/stand-in/index.mjs';",
  "const out = process.argv[process.argv.indexOf('--sonar') + 1];",
  "const found = JSON.parse(fs.readFileSync('findings.json', 'utf8'));",
  "fs.writeFileSync(out, JSON.stringify({ rules: [], issues: found.map(([file, rule, message]) => ({ engineId: 'eslint', ruleId: rule, primaryLocation: { message: mark + message, filePath: file, textRange: { startLine: 1 } } })) }));",
  'process.exit(found.length > 0 ? 1 : 0);',
].join('\n');

/** An app at tag v1.0.0 with `base` findings, then a HEAD commit with `head` findings; node_modules is untracked, as an install is. */
function lintApp(t, base, head) {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-lint-baseline-app-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'lint-app', version: '1.0.0', private: true, scripts: { lint: 'node lint.mjs' } }));
  fs.writeFileSync(path.join(root, 'lint.mjs'), `${LINT}\n`);
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'stand-in'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'stand-in', 'index.mjs'), "export const mark = '';\n");
  fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify(base));
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'release 1.0.0');
  git(root, 'tag', 'v1.0.0');
  fs.writeFileSync(path.join(root, 'findings.json'), JSON.stringify(head));
  git(root, 'commit', '-q', '-am', 'cleanup');
  return { root, ctx: contextOf({ cwd: root, env: { ...process.env } }) };
}

const GATE = { name: 'lint', command: ['npm', 'run', 'lint'], env: {} };

test('a HEAD whose findings the baseline tag already had is green, and the borrowed install is unlinked intact', (t) => {
  const backlog = [['be/a.ts', 'schema-owner', 'reads x'], ['be/b.ts', 'dead-export', 'y']];
  const { root, ctx } = lintApp(t, backlog, [...backlog].reverse());
  const dir = path.join(root, '.git', 'starci-release', 'head');
  const row = baselineLint(ctx, GATE, { tag: 'v1.0.0', dir, platform: process.platform });
  assert.equal(row.pass, true, row.detail);
  assert.equal(row.baseline.findings, 2);
  assert.equal(row.baseline.newFindings, 0);
  assert.ok(fs.existsSync(path.join(root, 'node_modules', 'stand-in', 'index.mjs')), 'unlinking the junction left the install in place');
  assert.deepEqual(git(root, 'worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length, 1);
});

test('a finding new since the baseline tag is red and listed in lint-new.json', (t) => {
  const { root, ctx } = lintApp(t, [['be/a.ts', 'r', 'm']], [['be/a.ts', 'r', 'm'], ['be/c.ts', 'r', 'fresh']]);
  const dir = path.join(root, '.git', 'starci-release', 'head');
  const row = baselineLint(ctx, GATE, { tag: 'v1.0.0', dir, platform: process.platform });
  assert.equal(row.pass, false);
  assert.equal(row.baseline.newFindings, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'lint-new.json'), 'utf8')).map((one) => one.file), ['be/c.ts']);
});

test('a lint baseline naming no commit is refused', (t) => {
  const { root, ctx } = lintApp(t, [], [['be/a.ts', 'r', 'm']]);
  assert.throws(() => baselineLint(ctx, GATE, { tag: 'v9.9.9', dir: path.join(root, 'x'), platform: process.platform }), (error) => error.code === 'RELEASE_URGENT_LINT_BASELINE_TAG');
});
