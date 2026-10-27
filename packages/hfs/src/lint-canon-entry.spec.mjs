// lint-canon-entry.spec.mjs - ownCanonEntry resolves the "." export of the app's installed canon with the import conditions of
// the import() that loads it (lint/run.mjs): a canon publishing only an `import` target resolves on every supported Node, where
// require.resolve cannot be told the import condition (its registerHooks resolve hook skips require.resolve before Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ownCanonEntry } from '../lint/run.mjs';

const install = (files) => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'starci-canon-entry-'));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
};

const entryOf = (root, packageName) => ownCanonEntry({ repoRoot: root, cwd: path.join(root, 'fe') }, packageName);

test('a canon that publishes only an import target resolves its entry', () => {
  const root = install({
    'fe/package.json': { name: 'app' },
    'fe/node_modules/@starci/eslint-grammar-core/package.json': {
      name: '@starci/eslint-grammar-core', type: 'module',
      exports: { '.': { types: './index.d.ts', import: './index.mjs' } },
    },
    'fe/node_modules/@starci/eslint-grammar-core/index.mjs': 'export {};\n',
  });
  assert.equal(entryOf(root, '@starci/eslint-grammar-core'), path.join(root, 'fe/node_modules/@starci/eslint-grammar-core/index.mjs'));
});

test('nested conditions resolve in the manifest\'s own order and fall back to default', () => {
  const root = install({
    'fe/package.json': { name: 'app' },
    'fe/node_modules/canon/package.json': {
      name: 'canon', type: 'module',
      exports: { '.': { types: './index.d.ts', node: { import: './esm/index.mjs' }, default: './fallback.mjs' } },
    },
    'fe/node_modules/canon/esm/index.mjs': 'export {};\n',
    'fe/node_modules/canon/fallback.mjs': 'export {};\n',
    'fe/node_modules/plain/package.json': { name: 'plain', main: './lib/main.mjs' },
    'fe/node_modules/plain/lib/main.mjs': 'export {};\n',
    'fe/node_modules/bare/package.json': { name: 'bare' },
    'fe/node_modules/bare/index.js': 'export {};\n',
  });
  assert.equal(entryOf(root, 'canon'), path.join(root, 'fe/node_modules/canon/esm/index.mjs'));
  assert.equal(entryOf(root, 'plain'), path.join(root, 'fe/node_modules/plain/lib/main.mjs'));
  assert.equal(entryOf(root, 'bare'), path.join(root, 'fe/node_modules/bare/index.js'));
});

test('a missing package, an exports without an import target and a missing target all fail closed', () => {
  const root = install({
    'fe/package.json': { name: 'app' },
    'fe/node_modules/require-only/package.json': {
      name: 'require-only', exports: { '.': { types: './index.d.ts', require: './index.cjs' } },
    },
    'fe/node_modules/require-only/index.cjs': 'module.exports = {};\n',
    'fe/node_modules/broken/package.json': {
      name: 'broken', exports: { '.': { import: './gone.mjs' } },
    },
  });
  assert.throws(() => entryOf(root, 'absent'), /Cannot find package 'absent'/);
  assert.throws(() => entryOf(root, 'require-only'), /no "exports" import target/);
  assert.throws(() => entryOf(root, 'broken'), /does not exist/);
});

test('a canon resolving outside the app root cannot prove its lint contract', () => {
  const root = install({ 'fe/package.json': { name: 'app' } });
  const outer = install({
    'node_modules/foreign/package.json': { name: 'foreign', exports: { '.': './index.mjs' } },
    'node_modules/foreign/index.mjs': 'export {};\n',
  });
  // The app's node_modules lookup reaches the outer install through a shared ancestor of both.
  const shared = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'starci-canon-shared-'));
  fs.mkdirSync(path.join(shared, 'app'), { recursive: true });
  fs.renameSync(root, path.join(shared, 'app', 'root'));
  fs.renameSync(path.join(outer, 'node_modules'), path.join(shared, 'node_modules'));
  const appRoot = path.join(shared, 'app', 'root');
  assert.throws(() => entryOf(appRoot, 'foreign'), /outside the app root/);
});

test('the lookup walks up from the side folder to the app root\'s node_modules', () => {
  const root = install({
    'fe/package.json': { name: 'app' },
    'node_modules/canon/package.json': { name: 'canon', exports: { '.': { import: './index.mjs' } } },
    'node_modules/canon/index.mjs': 'export {};\n',
  });
  assert.equal(entryOf(root, 'canon'), path.join(root, 'node_modules/canon/index.mjs'));
});
