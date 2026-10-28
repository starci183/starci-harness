// The ESLint child of `starci app lint` and `starci app check` runs on the heap the starci CLI hands it (STARCI_ESLINT_HEAP_MB, from the eslint
// memory of ops/liveness.yaml): a typed lint of a large back end outgrew node's default 4 GB heap. Unset, ESLint runs on node's default.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempRoot } from '../runtime/engine/temp-root.mjs';
import { ESLINT_HEAP_ENV, eslintHeapArgs, runLinter } from '../lint/run.mjs';

/** A side folder whose installed `eslint` is a stand-in reporting the node flags it was started with. */
function side(t) {
  const root = fs.mkdtempSync(path.join(tempRoot(), 'hfs-lint-heap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'node_modules', 'eslint');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"side","private":true}');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'eslint', version: '0.0.0', bin: { eslint: 'bin/eslint.js' } }));
  fs.writeFileSync(path.join(pkg, 'bin', 'eslint.js'), "process.stdout.write(JSON.stringify([{ filePath: 'a.ts', messages: [{ message: process.execArgv.join(' ') }] }])); process.exitCode = 1;\n");
  return root;
}

const withHeap = (t, value) => {
  const previous = process.env[ESLINT_HEAP_ENV];
  if (value === undefined) delete process.env[ESLINT_HEAP_ENV]; else process.env[ESLINT_HEAP_ENV] = value;
  t.after(() => { if (previous === undefined) delete process.env[ESLINT_HEAP_ENV]; else process.env[ESLINT_HEAP_ENV] = previous; });
};

test('the ESLint child runs on the heap the CLI sets', async (t) => {
  withHeap(t, '8192');
  const linted = await runLinter({ cwd: side(t), pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'] });
  assert.match(linted.results[0].messages[0].message, /--max-old-space-size=8192/u);
});

test('without the CLI the ESLint child keeps node\'s default heap', async (t) => {
  withHeap(t, undefined);
  const linted = await runLinter({ cwd: side(t), pkg: 'eslint', bin: 'eslint', args: ['--format', 'json', '.'] });
  assert.doesNotMatch(linted.results[0].messages[0].message, /max-old-space-size/u);
});

test('a heap that is not a whole positive number of MiB is ignored', () => {
  assert.deepEqual(eslintHeapArgs({ [ESLINT_HEAP_ENV]: 'lots' }), []);
  assert.deepEqual(eslintHeapArgs({ [ESLINT_HEAP_ENV]: '0' }), []);
  assert.deepEqual(eslintHeapArgs({ [ESLINT_HEAP_ENV]: '8192' }), ['--max-old-space-size=8192']);
});
