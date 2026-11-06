// The read budget of the tree checks: a SQL migration has its own explicit budget, every other file keeps the generic one.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_MIGRATION_READ_BYTES, readBudgetOf, readText } from '../runtime/scripts/hfs/rules/read.mjs';

const MIB = 1024 * 1024;
const made: string[] = [];

/** A repo root holding the given files, each filled with `size` bytes of harmless SQL comment text. */
function repoWith(files: Record<string, number>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-read-budget-'));
  made.push(root);
  for (const [rel, size] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '-- x\n'.repeat(Math.ceil(size / 5)).slice(0, size));
  }
  return root;
}

test.after(() => {
  for (const root of made) fs.rmSync(root, { recursive: true, force: true });
});

test('a migration over 1 MiB is read: a baseline is one file by design', () => {
  const root = repoWith({ 'db/migrations/20261112000700_baseline.sql': 1_400_000 });
  const text = readText(root, 'db/migrations/20261112000700_baseline.sql');
  assert.notEqual(text, null);
  assert.equal(text?.length, 1_400_000);
});

test('the archive and the bootstrap have the migration budget too', () => {
  const root = repoWith({ 'db/migrations/archive/20261013142504_lite-baseline.sql': 2 * MIB, 'db/bootstrap.sql': 2 * MIB });
  assert.notEqual(readText(root, 'db/migrations/archive/20261013142504_lite-baseline.sql'), null);
  assert.notEqual(readText(root, 'db/bootstrap.sql'), null);
});

test('a migration over its own budget is still not read', () => {
  const root = repoWith({ 'db/migrations/20261112000700_dump.sql': MAX_MIGRATION_READ_BYTES + 1 });
  assert.equal(readText(root, 'db/migrations/20261112000700_dump.sql'), null);
});

test('every other file keeps the 1 MiB budget, SQL outside the schema tree included', () => {
  const root = repoWith({ 'notes.txt': MIB + 1, 'src/seed.sql': MIB + 1, 'db/other/readme.sql': MIB + 1, 'notes-small.txt': 1000 });
  assert.equal(readText(root, 'notes.txt'), null);
  assert.equal(readText(root, 'src/seed.sql'), null);
  assert.equal(readText(root, 'db/other/readme.sql'), null);
  assert.equal(readText(root, 'notes-small.txt')?.length, 1000);
});

test('the budget of a path is a function of the path alone, on either separator', () => {
  assert.equal(readBudgetOf('db/migrations/20261112000700_baseline.sql'), MAX_MIGRATION_READ_BYTES);
  assert.equal(readBudgetOf('db\\migrations\\20261112000700_baseline.sql'), MAX_MIGRATION_READ_BYTES);
  assert.equal(readBudgetOf('db/migrations/notes.txt'), MIB);
  assert.equal(readBudgetOf('README.md'), MIB);
  assert.ok(MAX_MIGRATION_READ_BYTES > 1_400_000);
});
