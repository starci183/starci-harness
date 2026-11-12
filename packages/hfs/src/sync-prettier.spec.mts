// proves: HFS_FORMAT@sync
// Every file `starci app sync` manages passes the app's `prettier --check` (R19 HFS_FORMAT, the pre-commit hook) with the canon config as it is
// rendered, so formatting a managed file never makes HFS_SYNC_DRIFT: the root eslint.config.mjs of the root packages and the managed
// templates. The layout numbers of sync/canon-layout.mts are the canon config's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { CANON_INDENT, CANON_JSON_INDENT, CANON_PRINT_WIDTH, canonImport, canonJson, canonList } from '../sync/canon-layout.mjs';
import { bundledPresets, renderRepo, writeTargets } from '../sync/index.mjs';
import { scaffoldApp } from '../scaffold/app.mjs';
import { init } from '../runtime/scripts/api/git/init.mjs';
import { mkdtemp } from './helpers/tmpdir.mjs';
import type { Prettier } from '../sync/format.mjs';

const require = createRequire(import.meta.url);
const prettier = require('prettier') as Prettier;
const CANON_CONFIG = path.resolve(import.meta.dirname, '..', '..', 'prettier-config', 'dist', 'index.js');
const canon = require(CANON_CONFIG) as { printWidth: number; tabWidth: number; overrides: { files: string[]; options: { tabWidth?: number } }[] };

/** Installs the canon config under the app the way an app has it (its .prettierrc names `@starci/prettier-config`). */
const installCanon = (root: string): void => {
  const folder = path.join(root, 'node_modules', '@starci', 'prettier-config');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: '@starci/prettier-config', main: 'index.js' }));
  fs.writeFileSync(path.join(folder, 'index.js'), `module.exports = require(${JSON.stringify(CANON_CONFIG)})\n`);
};

const write = (root: string, file: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

/** The root packages of the fixture, enough of them with long names that the managed lists naming them are longer than a line. */
const writePackages = (root: string, scope: string): void => {
  for (const name of ['ui-kit', 'design-tokens', 'chart-widgets', 'notification-templates', 'report-builder-components']) {
    write(root, `packages/${name}/package.json`, JSON.stringify({ name: `@${scope}/${name}`, private: true }));
    write(root, `packages/${name}/src/index.ts`, 'export const value = 1\n');
  }
};

/** The managed files of a sync of `root` (written as sync writes them) that the app's prettier does not pass. */
const unformatted = async (root: string): Promise<string[]> => {
  installCanon(root);
  const { targets } = await renderRepo(root, { presets: bundledPresets() });
  writeTargets(root, targets);
  const found: string[] = [];
  for (const target of targets) {
    const file = path.join(root, target.path);
    const info = await prettier.getFileInfo(file, { ignorePath: path.join(root, '.prettierignore'), resolveConfig: true });
    if (info.ignored || info.inferredParser === null) continue;
    const options = { ...(await prettier.resolveConfig(file, { editorconfig: false })), filepath: file };
    if (!(await prettier.check(fs.readFileSync(file, 'utf8'), options))) found.push(target.path);
  }
  return found;
};

test('the layout of canon-layout is the canon config: its print width, its code indent and its JSON indent', () => {
  assert.equal(CANON_PRINT_WIDTH, canon.printWidth);
  assert.equal(CANON_INDENT.length, canon.tabWidth);
  assert.equal(CANON_JSON_INDENT.length, canon.overrides.find((entry) => entry.files.includes('*.json'))?.options.tabWidth);
});

for (const grammar of ['core', 'offset-pop']) {
  test(`a sync of an app with root packages (grammar ${grammar}) renders every managed file prettier-clean, the root eslint.config.mjs included`, async (t) => {
    const root = mkdtemp(t, 'starci-sync-prettier-');
    write(root, 'hfs.json', JSON.stringify({ hfs: 3, kind: 'app', project: 'fixture', sides: { be: { apps: [{ name: 'api', kind: 'api' }] }, fe: { grammar, apps: [{ name: 'web', kind: 'next' }] } } }));
    write(root, 'package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }));
    writePackages(root, 'fixture');
    assert.deepEqual(await unformatted(root), []);
    const config = fs.readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8');
    assert.ok(config.split('\n').every((line) => line.length <= CANON_PRINT_WIDTH), config);
  });
}

test('a sync of a lite starter renders its managed sign-in files prettier-clean', async (t) => {
  const root = scaffoldApp({
    name: 'demo',
    into: mkdtemp(t, 'starci-sync-prettier-lite-'),
    harness: { version: '1.1.0-alpha.3' },
    edition: 'lite',
    presets: bundledPresets(),
    lock: (at: string) => {
      fs.writeFileSync(path.join(at, 'package-lock.json'), '{}\n');
      return { ok: true };
    },
    initGit: init,
  }).root;
  writePackages(root, 'demo');
  assert.deepEqual(await unformatted(root), []);
});

test('canonList and canonJson print what prettier prints: one line while it fits, else one item a line', async () => {
  const check = async (text: string, filepath: string): Promise<boolean> => prettier.check(text, { ...canon, ...(filepath.endsWith('.json') ? { tabWidth: CANON_JSON_INDENT.length } : {}), overrides: [], filepath });
  const short = `${canonList({ head: 'export default ', items: ['a', 'b'] })}\n`;
  assert.equal(short, 'export default [a, b]\n');
  const long = `${canonList({ head: 'export const values = ', items: Array.from({ length: 12 }, (_, index) => `VALUE_NUMBER_${String(index)}`) })}\n`;
  assert.ok(long.includes('\n    VALUE_NUMBER_0,\n'));
  const from = `@${'a'.repeat(70)}/module/template`;
  const one = `${canonImport({ names: ['A_VERY_LONG_IMPORTED_NAME_OF_A_MODULE_SERVER'], from })}\n`;
  const two = `${canonImport({ names: ['A_VERY_LONG_IMPORTED_NAME', 'B_VERY_LONG_IMPORTED_NAME'], from, type: true })}\n`;
  assert.equal(one.split('\n').length, 2, 'an import of one name is never broken');
  assert.ok(two.startsWith('import type {\n    A_VERY_LONG_IMPORTED_NAME,\n'));
  assert.equal(canonList({ head: 'export default ', items: [] }), 'export default []');
  const value = { extends: './base.json', include: ['src/**/*.ts'], paths: { '@a/*': ['./a/*'] }, empty: {}, none: [], rows: [{ id: 1 }], long: Array.from({ length: 30 }, (_, index) => `entry-${String(index)}`) };
  for (const [text, file] of [[short, 'a.mjs'], [long, 'b.ts'], [one, 'c.ts'], [two, 'd.ts'], [canonJson(value), 'tsconfig.json']] as const) {
    assert.ok(await check(text, file), `${file}:\n${text}`);
  }
});
