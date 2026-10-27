/** Cold source imports obey the same package contracts as installed Grammar lint dependencies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { withSourcePackageImports } from '../runtime/scripts/lib/source-package-imports.mjs';

function fixture(t, { dependency = '1.0.0', exports = { './lib/*.mjs': { types: './types/*.d.ts', import: './lib/*.mjs' } } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-source-imports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return pathToFileURL(file).href;
  };
  write('shared/package.json', JSON.stringify({ name: '@fixture/canon', version: '1.0.0', type: 'module', exports }));
  write('shared/lib/token.mjs', 'export const value = "candidate source";');
  write('shared/private.mjs', 'export const value = "private";');
  write('family/package.json', JSON.stringify({ name: '@fixture/grammar', version: '0.1.0', type: 'module', exports: { '.': './index.mjs' }, dependencies: { '@fixture/canon': dependency } }));
  const entry = write('family/index.mjs', 'import { value } from "@fixture/canon/lib/token.mjs"; export { value };');
  const privateEntry = write('family/private.mjs', 'import { value } from "@fixture/canon/private.mjs"; export { value };');
  const external = write('unrelated.mjs', 'import { value } from "@fixture/canon/lib/token.mjs"; export { value };');
  const packages = {
    '@fixture/canon': { version: '1.0.0', source: 'shared/package.json' },
    '@fixture/grammar': { version: '0.1.0', source: 'family/package.json' },
  };
  return { root, packages, entry, privateEntry, external };
}

test('cold package imports reach the declared candidate export without a workspace install, then return to normal resolution', async t => {
  const app = fixture(t);
  await assert.rejects(import(`${app.entry}?before`), { code: 'ERR_MODULE_NOT_FOUND' });
  const loaded = await withSourcePackageImports(app, () => import(`${app.entry}?active`));
  assert.equal(loaded.value, 'candidate source');
  await assert.rejects(import(`${app.entry}?after`), { code: 'ERR_MODULE_NOT_FOUND' });
});

function consumerFixture(t) {
  const app = fixture(t);
  const write = (relative, text) => {
    const file = path.join(app.root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return pathToFileURL(file).href;
  };
  for (const [base, origin] of [['consumer', 'consumer install'], ['family', 'source install']]) {
    write(`${base}/node_modules/@fixture/dependency/package.json`, JSON.stringify({ name: '@fixture/dependency', version: '1.0.0', main: './index.cjs', exports: { '.': './index.cjs' } }));
    write(`${base}/node_modules/@fixture/dependency/index.cjs`, `module.exports = { origin: ${JSON.stringify(origin)}, token: {} };`);
  }
  write('family/package.json', JSON.stringify({ name: '@fixture/grammar', version: '0.1.0', type: 'module', exports: { '.': './index.mjs' }, dependencies: { '@fixture/dependency': '1.0.0' } }));
  write('family/index.mjs', [
    'import imported from "@fixture/dependency";',
    'import { createRequire } from "node:module";',
    'const required = createRequire(import.meta.url)("@fixture/dependency");',
    'export const same = imported === required;',
    'export const origin = imported.origin;',
  ].join('\n'));
  write('consumer/package.json', JSON.stringify({ name: 'consumer', version: '1.0.0', type: 'module' }));
  write('consumer/node_modules/@fixture/grammar/package.json', JSON.stringify({ name: '@fixture/grammar', version: '0.0.1', type: 'module', exports: { '.': './index.mjs' } }));
  write('consumer/node_modules/@fixture/grammar/index.mjs', 'export const origin = "released grammar"; export const same = false;');
  const consumerEntry = write('consumer/app.mjs', 'export { origin, same } from "@fixture/grammar";');
  return { ...app, consumerRoot: path.join(app.root, 'consumer'), consumerEntry };
}

test('consumer mode shares one dependency instance between source ESM imports and createRequire, then restores native resolution', async t => {
  const app = consumerFixture(t);
  assert.equal((await import(`${app.consumerEntry}?before`)).origin, 'released grammar');
  const candidate = await withSourcePackageImports(app, () => import(`${app.consumerEntry}?active`));
  assert.equal(candidate.origin, 'consumer install');
  assert.equal(candidate.same, true);
  assert.equal((await import(`${app.consumerEntry}?after`)).origin, 'released grammar');
  assert.equal((await import(`${app.entry}?native`)).origin, 'source install');
});

test('consumer mode removes its source and dependency redirection when the awaited action fails', async t => {
  const app = consumerFixture(t);
  await assert.rejects(withSourcePackageImports(app, async () => {
    const candidate = await import(`${app.consumerEntry}?failure`);
    assert.equal(candidate.origin, 'consumer install');
    assert.equal(candidate.same, true);
    throw new Error('measurement failed');
  }), /measurement failed/);
  assert.equal((await import(`${app.consumerEntry}?restored`)).origin, 'released grammar');
});

test('private source files remain unimportable and a rejected import removes its resolver hook', async t => {
  const app = fixture(t);
  await assert.rejects(withSourcePackageImports(app, () => import(app.privateEntry)), /not a published source-package export/);
  await assert.rejects(import(`${app.entry}?after-private`), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('source resolution requires the exact declared dependency and never affects an unrelated importer', async t => {
  const wrong = fixture(t, { dependency: '0.9.0' });
  await assert.rejects(withSourcePackageImports(wrong, () => import(wrong.entry)), /must declare its source dependency/);
  const app = fixture(t);
  await assert.rejects(withSourcePackageImports(app, () => import(app.external)), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('an export target cannot escape its package source', async t => {
  const app = fixture(t, { exports: { './lib/*': './../outside/*.mjs' } });
  await assert.rejects(withSourcePackageImports(app, () => import(app.entry)), /invalid source-package export target/);
});
