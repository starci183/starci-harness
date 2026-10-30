// proves: HFS_BYPASS_MARKER@lite
// proves: HFS_BYPASS_MARKER@full
// No bypass lands unnoticed (owner ruling loosening-always-red). One marker table (scripts/lib/bypass-markers.mjs) serves both readers of a tree as it stands:
//   - the runtime's loosening-state self-check (scripts/lib/loosening-state.mjs, specified by src/loosening-state.spec.mjs);
//   - the product rule HFS_BYPASS_MARKER (scripts/hfs/rules/bypass-markers.mjs) and `starci app check --staged` (the pre-commit hook), which judge a tree and the index.
// The forbidden spellings live in fixtures/loosening/, the declared fixture folder of knowledge/hfs/design-truths.yaml.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bypassesIn } from '../runtime/scripts/lib/bypass-markers.mjs';
import { bypassMarkerFindings } from '../runtime/scripts/hfs/rules/bypass-markers.mjs';
import { judge as hygieneJudge, runWorkHygiene } from '../sync/hygiene.mjs';
import { FORBIDDEN, LOOKALIKES } from './fixtures/loosening/forms.mjs';
import { FORBIDDEN_INDEX, LOOKALIKES_INDEX } from './fixtures/bypass-index.mjs';

const markers = [...FORBIDDEN, ...FORBIDDEN_INDEX].filter((form) => form.kind === 'bypass');

for (const form of markers) {
  test(`the table reads ${form.id}`, () => {
    assert.ok(bypassesIn(form.file, form.text).length > 0, form.text);
  });
}

for (const lookalike of [...LOOKALIKES, ...LOOKALIKES_INDEX]) {
  test(`the table leaves ${lookalike.id}`, () => {
    assert.deepEqual(bypassesIn(lookalike.file, lookalike.text), []);
  });
}

test('the table reports the line and the label of a marker, and a file of no kind has none', () => {
  const [hit] = bypassesIn('fe/src/a.tsx', 'const a = 1;\n// eslint-disable-next-line x\n');
  assert.deepEqual([hit.line, hit.label], [2, 'eslint-disable']);
  assert.deepEqual(bypassesIn('README.md', '// eslint-disable\n'), []);
  assert.equal(bypassesIn('node_modules/x/index.js', '// eslint-disable\n').length, 1, 'a file is read wherever it is tracked');
});

const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (cwd, ...args) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
};
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
const form = (id) => FORBIDDEN.find((entry) => entry.id === id).text;

/** A git repository holding `files` in its index (the staged guard reads the index); removed after the test. */
const stagedRepo = (t, files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-bypass-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  git(root, 'add', '-A');
  return root;
};

test('HFS_BYPASS_MARKER: the tree rule and the staged pre-commit guard refuse a bypass, also in a front end that has no specs', async (t) => {
  const root = stagedRepo(t, {
    'fe/src/ok.ts': 'export const ok = 1;\n',
    'fe/src/bad.ts': `export const bad = 1;\n${form('eslint-disable line')}`,
    'be/src/bad.service.spec.ts': form('describe.skip'),
    '.husky/pre-commit': form('or true in a hook'),
  });
  const files = ['fe/src/ok.ts', 'fe/src/bad.ts', 'be/src/bad.service.spec.ts', '.husky/pre-commit'];
  const found = bypassMarkerFindings({ repoRoot: root, files });
  assert.deepEqual(found.map((finding) => finding.path), ['fe/src/bad.ts', 'be/src/bad.service.spec.ts', '.husky/pre-commit']);
  assert.ok(found.every((finding) => finding.code === 'HFS_BYPASS_MARKER' && finding.level === 'error'));
  const lines = [];
  assert.equal(await runWorkHygiene({ cwd: root, out: (line) => lines.push(line) }), 1);
  assert.equal(lines.filter((line) => line.startsWith('HFS_BYPASS_MARKER ')).length, 3, lines.join('\n'));
  assert.match(lines.find((line) => line.includes('fe/src/bad.ts')), /fe\/src\/bad\.ts:2 spells/);
});

test('HFS_BYPASS_MARKER: a relaxed gate configuration of an app is the same code, and its managed lists stay with the drift check', (t) => {
  const root = stagedRepo(t, {
    'codecov.yml': form('codecov target below 100'),
    'be/tsconfig.json': form('tsconfig strict off'),
    'sonar-project.properties': form('extra sonar exclusion'),
    'modules/kernel/approvals.yaml': form('an approvals file'),
  });
  const found = bypassMarkerFindings({ repoRoot: root, files: ['codecov.yml', 'be/tsconfig.json', 'sonar-project.properties', 'modules/kernel/approvals.yaml'] });
  assert.deepEqual(found.map((finding) => finding.path).sort(), ['be/tsconfig.json', 'codecov.yml', 'modules/kernel/approvals.yaml']);
  assert.ok(found.every((finding) => finding.code === 'HFS_BYPASS_MARKER'));
});

for (const edition of ['lite', 'full']) {
  test(`HFS_BYPASS_MARKER ${edition}: the tree rule and the staged guard refuse an inline disable in a front end`, (t) => {
    const root = stagedRepo(t, { 'fe/src/bad.ts': `export const bad = 1;\n${form('eslint-disable line')}` });
    assert.equal(bypassMarkerFindings({ repoRoot: root, files: ['fe/src/bad.ts'] })[0].code, 'HFS_BYPASS_MARKER');
    assert.equal(hygieneJudge(root, ['fe/src/bad.ts']).findings[0].code, 'HFS_BYPASS_MARKER');
  });
  test(`HFS_BYPASS_MARKER ${edition}: the tree rule and the staged guard accept a clean front end`, (t) => {
    const root = stagedRepo(t, { 'fe/src/ok.ts': 'export const ok = 1;\n' });
    assert.deepEqual(bypassMarkerFindings({ repoRoot: root, files: ['fe/src/ok.ts'] }), []);
    assert.deepEqual(hygieneJudge(root, ['fe/src/ok.ts']).findings, []);
  });
}

test('the pre-commit hook ends on every failing step: the stylelint step cannot be skipped', () => {
  const hook = fs.readFileSync(new URL('../templates/app/hooks/husky/pre-commit', import.meta.url), 'utf8');
  const commands = hook.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith('#') && !line.includes('{{'));
  const pipelines = commands.join('\n').split(/\n(?=\S)/);
  assert.ok(pipelines.length >= 6, 'hygiene, sync check, eslint per side, stylelint, prettier');
  for (const pipeline of pipelines) assert.match(pipeline, /\|\| exit \$\?\s*$/, `${pipeline.split('\n')[0]} ends the hook when it fails`);
  assert.match(hook, /starci app check --staged \|\| exit/);
  assert.match(hook, /starci app sync \|\| exit/);
  assert.match(hook, /npx stylelint "\$@"/);
  assert.doesNotMatch(hook, /if \[ -n "\$styles" \]/);
  assert.deepEqual(bypassesIn('.husky/pre-commit', hook), [], 'the hook the canon renders holds no bypass of its own');
});
