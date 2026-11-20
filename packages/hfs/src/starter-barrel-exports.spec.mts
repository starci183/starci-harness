import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const be = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'be');
const read = (...parts: string[]) => fs.readFileSync(path.join(be, ...parts), 'utf8');
const barrel = (tree: string, folder: string) => read(tree, 'src', 'modules', 'platform', folder, 'index.ts');

test('the primitives barrel does not export eachInOrder while no starter file imports it', () => {
  assert.doesNotMatch(barrel('skeleton', 'primitives'), /eachInOrder/);
});
