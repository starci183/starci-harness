import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// The resolver of the root packages' unit projects: a `.js` specifier whose file is absent resolves to the `.ts` (`.tsx`, `.mts`) file beside it; a real `.js` stays.
const require = createRequire(import.meta.url);
const resolver = require('../dist/ts-extension-resolver.js') as (request: string, options: { defaultResolver: (request: string, options: unknown) => string }) => string;

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'starci-ts-resolver-'));
test.after(() => fs.rmSync(path.resolve(folder), { recursive: true, force: true }));
for (const file of ['a.ts', 'b.tsx', 'c.mts', 'real.js', 'real.ts']) fs.writeFileSync(path.join(folder, file), '');

/** A default resolver over the folder: an existing relative file, else the error jest throws. */
const options = { defaultResolver: (request: string): string => {
  const file = path.join(folder, request);
  if (!/^\.{1,2}\//.test(request) || !fs.existsSync(file)) throw new Error(`Cannot find module '${request}'`);
  return file;
} };

test('a .js specifier resolves to the .ts, .tsx or .mts file beside it when the .js file does not exist', () => {
  assert.equal(resolver('./a.js', options), path.join(folder, 'a.ts'));
  assert.equal(resolver('./b.js', options), path.join(folder, 'b.tsx'));
  assert.equal(resolver('./c.js', options), path.join(folder, 'c.mts'));
});

test('a real .js file is left alone, and a request that resolves directly is not touched', () => {
  assert.equal(resolver('./real.js', options), path.join(folder, 'real.js'), 'the .js file wins over a .ts of the same stem');
  assert.equal(resolver('./a.ts', options), path.join(folder, 'a.ts'));
});

test('an unresolvable request keeps its own error: a missing file, a bare package, a non-.js specifier', () => {
  assert.throws(() => resolver('./missing.js', options), /Cannot find module '\.\/missing\.js'/);
  assert.throws(() => resolver('left-pad.js', options), /Cannot find module 'left-pad\.js'/);
  assert.throws(() => resolver('./missing.json', options), /Cannot find module '\.\/missing\.json'/);
});
