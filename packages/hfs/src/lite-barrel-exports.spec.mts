import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const be = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'be');
const read = (...parts: string[]) => fs.readFileSync(path.join(be, ...parts), 'utf8');
const barrel = (tree: string, folder: string) => read(tree, 'src', 'modules', 'platform', folder, 'index.ts');

test('the lite logging barrel exports exactly what the full starter exports, since no lite file consumes the correlation surface', () => {
  assert.equal(barrel('skeleton-lite', 'logging'), barrel('skeleton', 'logging'));
});

test('the lite primitives barrel does not export eachInOrder while no lite file imports it', () => {
  assert.doesNotMatch(barrel('skeleton-lite', 'primitives'), /eachInOrder/);
});
