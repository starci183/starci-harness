// lint-chunk.spec.mts - the chunk helpers, and the ESLint launch of a long changed list: one launch, the list outside the command line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chunkByChars, mapBounded, mergeRuns } from '../lint/chunk.mjs';
import { eslintRepository } from '../lint/run.mjs';
import type { LinterRunner } from '../lint/run.mjs';

test('chunks keep order, cover every item once and stay within the budget', () => {
  const items = Array.from({ length: 500 }, (_, i) => `src/dir/file-${String(i).padStart(4, '0')}.ts`);
  const chunks = chunkByChars(items, 2_000);
  assert.deepEqual(chunks.flat(), items);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.reduce((n, a) => n + a.length + 3, 0) <= 2_000);
});

test('an item that exactly fills the budget stays, the next one opens a new chunk', () => {
  const a = 'a'.repeat(97), b = 'b'.repeat(97);
  assert.deepEqual(chunkByChars([a, b], 100), [[a], [b]]);
  assert.deepEqual(chunkByChars(['x', 'y'], 100), [['x', 'y']]);
  assert.deepEqual(chunkByChars([]), []);
});

test('a single path larger than the budget gets its own chunk and is not dropped', () => {
  const huge = 'h'.repeat(500);
  assert.deepEqual(chunkByChars(['a', huge, 'b'], 100), [['a'], [huge], ['b']]);
});

test('bounded concurrency never exceeds the limit and keeps chunk order', async () => {
  let live = 0, peak = 0;
  const out = await mapBounded([1, 2, 3, 4, 5, 6, 7], async (n) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { results: [n] }; }, 2);
  assert.equal(peak, 2);
  assert.deepEqual(out.map((r) => (r as { results: number[] }).results[0]), [1, 2, 3, 4, 5, 6, 7]);
});

test('a throwing chunk becomes an error record', async () => {
  const out = await mapBounded([1], () => { throw new Error('spawn ENAMETOOLONG'); });
  assert.match(out[0]?.error ?? '', /ENAMETOOLONG/);
});

test('merge keeps every result in order and each distinct error once', () => {
  assert.deepEqual(mergeRuns([{ results: [1] }, { results: [2, 3] }]), { results: [1, 2, 3] });
  assert.deepEqual(mergeRuns([{ error: 'x' }, { error: 'x' }]), { error: 'x' });
  assert.deepEqual(mergeRuns([{ results: [1], error: 'a' }, { error: 'b' }]), { results: [1], error: 'a ; b' });
});

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-chunk-'));
  fs.mkdirSync(path.join(root, 'fe'));
  return root;
};
const app = { sides: true };
const file = (i: number) => `fe/${'d'.repeat(120)}/f${i}.ts`;

test('eslintRepository sends a long changed list to ONE launch, as a list and not as arguments', async () => {
  const root = fixture();
  const existing = Array.from({ length: 600 }, (_, i) => file(i));
  const calls: { args: string[]; list: readonly string[] | undefined }[] = [];
  const run: LinterRunner = async ({ cwd, args, list }) => {
    calls.push({ args, list });
    return { results: (list ?? []).map((f) => ({ filePath: path.join(cwd, f), messages: [] })) };
  };
  const out = await eslintRepository({ repoRoot: root, app, opts: { side: 'fe' }, changed: [...new Set(existing)], existing, run });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.list?.length, 600);
  assert.ok((calls[0]?.args.join(' ').length ?? Infinity) < 200, 'the command line holds the options alone');
  assert.equal(out.raw.length, 600);
  assert.deepEqual(out.errors, []);
  assert.equal(out.engine.sides['fe']?.files, 600);
});

test('a spawn failure is an eslint error entry, not an escaped rejection', async () => {
  const root = fixture();
  const existing = [file(1), file(2)];
  const run = async () => { throw new Error('spawn ENAMETOOLONG'); };
  const out = await eslintRepository({ repoRoot: root, app, opts: { side: 'fe' }, changed: [...new Set(existing)], existing, run });
  assert.ok(out.errors.some((e) => /ENAMETOOLONG/.test(e)));
});

test('a scope the caller enumerated is not enumerated again, and its size is what the eslint budget scales with', async () => {
  const root = fixture();
  const scope = Array.from({ length: 5 }, (_, i) => `src/f${i}.ts`);
  const calls: { args: string[]; files: number | undefined }[] = [];
  const run: LinterRunner = async ({ cwd, args, files }) => {
    calls.push({ args, files });
    return { results: scope.map((f) => ({ filePath: path.join(cwd, f), messages: [] })) };
  };
  // the fixture side holds no installed canon: without the handed scope the launch would be a scope error
  const out = await eslintRepository({ repoRoot: root, app, opts: { side: 'fe' }, run, scopes: { fe: scope } });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(calls, [{ args: ['--format', 'json', '.'], files: 5 }]);
  assert.equal(out.raw.length, 5);
});
