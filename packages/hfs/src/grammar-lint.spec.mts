import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { grammarLintFor, resolveGrammarFamily } from '../runtime/scripts/lib/grammar-lint.mjs';
import { canonScope, installedLintConfig } from '../lint/run.mjs';
import type { RenderedTarget } from '../sync/index.mjs';
import { render, renderTargets, writeTargets } from '../sync/index.mjs';
import { managedFindings } from '../sync/managed.mjs';
import { starterDeclaration } from '../scaffold/app.mjs';
import { PRESETS } from './helpers/hfs-cli-fixture.mjs';

const temporaryRoot = (context: TestContext) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-grammar-lint-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

function packageAt(root: string, name: string, source: string, exports: string | Record<string, unknown> = './index.mjs') {
  const directory = path.join(root, 'node_modules', ...name.split('/'));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, type: 'module', exports }));
  fs.writeFileSync(path.join(directory, 'index.mjs'), source);
}

function installedFixture(context: TestContext, family: string | undefined) {
  const root = temporaryRoot(context);
  const cwd = path.join(root, 'fe');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify({ sides: { fe: { ...(family === undefined ? {} : { grammar: family }) } } }));
  packageAt(root, '@starci/eslint-canon-fe', [
    "import fs from 'node:fs';", "import { fileURLToPath } from 'node:url';", "import path from 'node:path';",
    "export const loadHfs = url => JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(url)), '../hfs.json'), 'utf8')).sides.fe;",
    "export const starciFeConfig = ({ hfs }) => [{ files: ['src/**/*.ts'], settings: { universal: true, grammar: hfs.grammar } }];",
  ].join('\n'));
  return { root, cwd };
}

test('family lint selection has no default and refuses missing or unsupported selections', () => {
  for (const family of [undefined, null, '', ' ']) assert.throws(() => grammarLintFor(family), /explicitly name/);
  for (const family of ['unlisted', 'common']) assert.throws(() => grammarLintFor(family), /no declared lint contract/);
});

test('the selected family chooses its own package and factory', () => {
  assert.deepEqual(grammarLintFor('core'), {
    family: 'core', package: '@starci/eslint-grammar-core', factory: 'coreGrammarConfig', prefix: 'starci-grammar',
  });
  assert.deepEqual(grammarLintFor('offset-pop'), {
    family: 'offset-pop', package: '@starci/eslint-grammar-offset-pop', factory: 'offsetPopGrammarConfig', prefix: 'starci-grammar',
  });
});

test('only core and offset-pop resolve; any other id, starci and starci-core included, has no lint contract', () => {
  assert.deepEqual(resolveGrammarFamily('core'), { id: 'core' });
  assert.deepEqual(resolveGrammarFamily('offset-pop'), { id: 'offset-pop' });
  for (const family of ['starci', 'starci-core', 'StarCi', 'core ', 'paper']) {
    assert.throws(() => resolveGrammarFamily(family), /no declared lint contract/);
  }
  assert.notEqual(grammarLintFor('offset-pop').family, grammarLintFor('core').family);
});

test('commented template variables render active JavaScript and absent optional lines disappear', () => {
  assert.equal(render('// {{importLine}}\n// {{optionalLine}}\n', { importLine: 'import value from "package"', optionalLine: '' }), 'import value from "package"\n');
});

test('both editions render the universal canon and the explicitly selected family factory', () => {
  for (const edition of ['full', 'lite']) {
    const declaration = starterDeclaration('demo', undefined, edition);
    const config = (renderTargets(declaration, PRESETS).find(target => target.path === 'fe/eslint.config.mjs') as RenderedTarget).content;
    assert.match(config, /from "@starci\/eslint-canon-fe"/);
    assert.match(config, /from "@starci\/eslint-grammar-core"/);
    assert.match(config, /\.\.\.starciFeConfig\(\{ hfs \}\)/);
    assert.match(config, /\.\.\.coreGrammarConfig\(\{ hfs \}\)/);
    // reason: the starter declaration's sides are readonly; the spec edits the one view of the fe grammar it owns.
    const fe = declaration.sides.fe as { grammar?: string };
    fe.grammar = 'offset-pop';
    const selected = (renderTargets(declaration, PRESETS).find(target => target.path === 'fe/eslint.config.mjs') as RenderedTarget).content;
    assert.match(selected, /from "@starci\/eslint-grammar-offset-pop"/);
    assert.match(selected, /\.\.\.offsetPopGrammarConfig\(\{ hfs \}\)/);
    assert.doesNotMatch(selected, /from "@starci\/eslint-grammar-core"/);
    delete fe.grammar;
    assert.throws(() => renderTargets(declaration, PRESETS), /explicitly name/);
  }
});

test('app check refuses removal of the family block from the managed config', async context => {
  const root = temporaryRoot(context);
  const declaration = starterDeclaration('demo');
  fs.writeFileSync(path.join(root, 'hfs.json'), JSON.stringify(declaration));
  const targets = renderTargets(declaration, PRESETS);
  writeTargets(root, targets);
  const config = path.join(root, 'fe/eslint.config.mjs');
  assert.deepEqual(await managedFindings({ repoRoot: root, tracked: ['hfs.json', ...targets.map(target => target.path)], presets: PRESETS }), []);
  fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(', ...coreGrammarConfig({ hfs })', ''));
  const findings = await managedFindings({ repoRoot: root, tracked: ['hfs.json', ...targets.map(target => target.path)], presets: PRESETS });
  assert.deepEqual(findings.map(finding => [finding.code, finding.path]), [['HFS_RULE_OFF_WITHOUT_REPLACEMENT', 'fe/eslint.config.mjs']]);
});

test('lint scope combines the app-installed universal and selected family configurations', async context => {
  const { root, cwd } = installedFixture(context, 'core');
  packageAt(root, '@starci/eslint-grammar-core', "export const coreGrammarConfig = ({ hfs }) => [{ files: ['family/**/*.tsx'], settings: { family: hfs.grammar } }];");
  const config = await installedLintConfig({ repoRoot: root, cwd, side: 'fe' });
  assert.deepEqual(config.map(block => block.settings), [{ universal: true, grammar: 'core' }, { family: 'core' }]);
  const scope = canonScope(config);
  assert.equal(scope.source('src/operation.ts'), true);
  assert.equal(scope.source('family/control.tsx'), true);
});

test('the installed family entry uses its import-only public export and leaves require resolution unchanged', async context => {
  const { root, cwd } = installedFixture(context, 'core');
  const packageName = '@starci/eslint-grammar-core';
  packageAt(root, packageName, "export const coreGrammarConfig = () => [{ files: ['family/**/*.tsx'], settings: { imported: true } }];",
    { '.': { types: './index.d.ts', import: './index.mjs' } });
  const require = createRequire(path.join(cwd, 'package.json'));
  assert.throws(() => require.resolve(packageName), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
  const config = await installedLintConfig({ repoRoot: root, cwd, side: 'fe' });
  assert.equal(config.at(-1).settings.imported, true);
  assert.equal(canonScope(config).source('family/control.tsx'), true);
  assert.throws(() => require.resolve(packageName), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED');
});

test('lint refuses absent selection, the wrong family package and unsupported family factories', async context => {
  const missing = installedFixture(context, undefined);
  await assert.rejects(() => installedLintConfig({ repoRoot: missing.root, cwd: missing.cwd, side: 'fe' }), /explicitly name/);
  const selected = installedFixture(context, 'offset-pop');
  packageAt(selected.root, '@starci/eslint-grammar-core', 'export const coreGrammarConfig = () => [];');
  await assert.rejects(() => installedLintConfig({ repoRoot: selected.root, cwd: selected.cwd, side: 'fe' }), /eslint-grammar-offset-pop/);
  const unsupported = installedFixture(context, 'offset-pop');
  packageAt(unsupported.root, '@starci/eslint-grammar-offset-pop', 'export const unrelated = () => [];');
  await assert.rejects(() => installedLintConfig({ repoRoot: unsupported.root, cwd: unsupported.cwd, side: 'fe' }), /no supported offsetPopGrammarConfig factory/);
});
