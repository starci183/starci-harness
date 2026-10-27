import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { main } from './main.mjs';

const familyCode = 'FE_APP_SHELL_FRAME';

function installedPackage(root, name, source) {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), source);
  return pathToFileURL(path.join(directory, 'index.mjs')).href;
}

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-check-eslint-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: {
    be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar: 'core', apps: [{ name: 'web', kind: 'next' }] },
  } }));
  const files = { be: ['src/backend.ts'], fe: ['src/universal.ts', 'src/family.tsx'] };
  const entries = {};
  for (const side of ['be', 'fe']) {
    const cwd = path.join(root, side);
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    for (const file of files[side]) fs.writeFileSync(path.join(cwd, file), 'export const value = 1;\n');
    const factory = side === 'be' ? 'starciBeConfig' : 'starciFeConfig';
    entries[side] = installedPackage(root, `@starci/eslint-canon-${side}`, [
      "import fs from 'node:fs';", "import path from 'node:path';", "import { fileURLToPath } from 'node:url';",
      `export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.${side};`,
      'export let calls = 0;',
      `export const ${factory} = () => { calls++; return [{ files: ['src/**/*.ts'], settings: { universal: '${side}' } }]; };`,
    ].join('\n'));
    fs.writeFileSync(path.join(cwd, 'eslint.config.mjs'), [
      `import { loadHfs, ${factory} } from '@starci/eslint-canon-${side}';`,
      ...(side === 'fe' ? ["import { coreGrammarConfig } from '@starci/eslint-grammar-core';"] : []),
      'const hfs = loadHfs(import.meta.url);',
      `export default [...${factory}({ hfs })${side === 'fe' ? ', ...coreGrammarConfig({ hfs })' : ''}];`,
    ].join('\n'));
  }
  entries.family = installedPackage(root, '@starci/eslint-grammar-core', [
    'export let calls = 0;',
    "export const coreGrammarConfig = ({ hfs }) => { if(hfs.grammar !== 'core') throw new Error('wrong family'); calls++; return [{ files: ['src/**/*.tsx'], settings: { family: 'core' } }]; };",
  ].join('\n'));
  return { root, files, entries };
}

const cleanCheck = (root, findings = []) => ({ ok: findings.length === 0, repoRoot: root, profile: 'app', manifest: '3.4.0', tracked: 3,
  findings, counts: { error: findings.length, warning: 0, info: 0 }, machine: { status: 'ran', files: 3, kinds: ['backend', 'frontend'] } });

function transport(fixture, calls) {
  return async ({ cwd, pkg, args }) => {
    assert.equal(pkg, 'eslint');
    const side = path.basename(cwd);
    calls.push({ side, args });
    const universal = await import(fixture.entries[side]);
    const family = side === 'fe' ? await import(fixture.entries.family) : null;
    const before = { universal: universal.calls, family: family?.calls };
    const { default: config } = await import(pathToFileURL(path.join(cwd, 'eslint.config.mjs')).href);
    assert.equal(universal.calls - before.universal, 1, 'one universal factory call in the ESLint invocation');
    if (family) {
      assert.equal(family.calls - before.family, 1, 'one family factory call in the same ESLint invocation');
      assert.deepEqual(config.map(block => block.settings), [{ universal: 'fe' }, { family: 'core' }]);
    }
    const selected = args.at(-1) === '.' ? fixture.files[side] : fixture.files[side].filter(file => args.includes(file));
    return { results: selected.map(file => ({ filePath: path.join(cwd, file), messages: file.endsWith('family.tsx')
      ? [{ ruleId: 'starci-grammar/app-shell-frame', message: `[${familyCode}] Fixed frame is required.`, line: 1, column: 1 }]
      : [] })) };
  };
}

async function invoke(argv, fixture, checkApp, runLinter) {
  let stdout = '', stderr = '';
  const exit = await main([...argv, '--json'], { cwd: fixture.root, checkApp, runLinter,
    stdout: text => { stdout += text; }, stderr: text => { stderr += text; } });
  assert.equal(stderr, '');
  return { exit, report: JSON.parse(stdout) };
}

test('CLI app check executes both FE packages in one ESLint invocation, retains HFS findings and reports the family code', async context => {
  const app = fixture(context), runs = [];
  let checks = 0;
  const checked = await invoke(['check'], app, ({ repoRoot }) => {
    checks++;
    return cleanCheck(repoRoot, [{ code: 'HFS_MANAGED_FILE_DRIFT', level: 'error', path: 'package.json', message: 'Managed output differs.' }]);
  }, transport(app, runs));
  assert.equal(checks, 1);
  assert.deepEqual(runs.map(run => run.side), ['be', 'fe']);
  assert.equal(checked.exit, 1);
  assert.equal(checked.report.ok, false);
  assert.equal(checked.report.counts.error, 2);
  assert.deepEqual(checked.report.findings.map(finding => finding.code), ['HFS_MANAGED_FILE_DRIFT', familyCode]);
  assert.equal(checked.report.findings[1].rule, 'starci-grammar/app-shell-frame');
  assert.deepEqual(checked.report.eslint.sides, { be: { files: 1 }, fe: { files: 2 } });
});

test('app lint uses the shared ESLint execution once and calls the in-process HFS checker without recursively invoking app check', async context => {
  const app = fixture(context), runs = [];
  let checks = 0;
  const checked = await invoke(['lint', '--changed', 'fe/src/family.tsx'], app, ({ repoRoot }) => { checks++; return cleanCheck(repoRoot); }, transport(app, runs));
  assert.equal(checks, 1);
  assert.deepEqual(runs.map(run => run.side), ['fe']);
  assert.equal(checked.exit, 1);
  assert.equal(checked.report.schema, 'starci/lint@1');
  assert.deepEqual(checked.report.findings.map(finding => finding.code), [familyCode]);
});

test('CLI app check refuses an unavailable ESLint transport with exit 2 and preserves its tool errors', async context => {
  const app = fixture(context), runs = [];
  const checked = await invoke(['check'], app, ({ repoRoot }) => cleanCheck(repoRoot), async ({ cwd }) => {
    runs.push(path.basename(cwd));
    return { error: 'ESLint transport did not complete.' };
  });
  assert.deepEqual(runs, ['be', 'fe']);
  assert.equal(checked.exit, 2);
  assert.equal(checked.report.ok, false);
  assert.deepEqual(checked.report.eslint.errors, ['ESLint transport did not complete.', 'ESLint transport did not complete.']);
});

test('CLI app check --fast runs the combined FE config only over changed source files', async context => {
  const app = fixture(context), runs = [];
  execFileSync('git', ['init', '-q', '-b', 'main', app.root]);
  execFileSync('git', ['-C', app.root, 'add', '--', 'hfs.json', 'package.json', 'be', 'fe']);
  execFileSync('git', ['-C', app.root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'Fixture']);
  fs.appendFileSync(path.join(app.root, 'fe/src/family.tsx'), 'export const changed = 2;\n');
  const checked = await invoke(['check', '--fast'], app, ({ repoRoot, fast }) => {
    assert.equal(fast, true);
    return cleanCheck(repoRoot);
  }, transport(app, runs));
  assert.deepEqual(runs.map(run => [run.side, run.args]), [['fe', ['--format', 'json', 'src/family.tsx']]]);
  assert.equal(checked.exit, 1);
  assert.deepEqual(checked.report.findings.map(finding => finding.code), [familyCode]);
});
